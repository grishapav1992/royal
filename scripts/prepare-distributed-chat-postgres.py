#!/usr/bin/env python3
"""Operate one synthetic PostgreSQL 17 node under a dedicated Linux account.

Keep the 0600 plan outside the repository in /var/lib/royal-chat-load/plans.
An operator on each pinned test host runs prepare, then start. Obtain the
primary systemIdentifier from start before preparing the standby. Once the
standby starts, run verify on the primary and use its minimumReplayLsn for
generator attestation. Stop or destroy only through the original node plan.
"""

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time

ROOT = Path('/var/lib/royal-chat-load')
BIN = Path('/usr/lib/postgresql/17/bin')
OS_USER = 'royal_chat_load'
PURPOSE = 'royal-chat-load-distributed'
CHAT = 'royal_chat_load_chat'
GAME = 'royal_chat_load_game'
STANDBY = 'royal_chat_load_standby'
PRIVATE_NETWORKS = tuple(map(ipaddress.ip_network, ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')))
MAX_BACKUP_BYTES = 512 * 1024 ** 2


class Refused(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def pattern(value, expression):
    return isinstance(value, str) and re.fullmatch(expression, value) is not None


def private_address(value):
    try:
        address = ipaddress.IPv4Address(value) if isinstance(value, str) else None
    except ValueError:
        return False
    return address is not None and any(address in network for network in PRIVATE_NETWORKS)


def valid_path(value):
    return pattern(value, r'/[A-Za-z0-9_./-]{1,255}') and all(part not in ('', '.', '..') for part in value[1:].split('/'))


def valid_system(value):
    return pattern(value, r'[1-9][0-9]{17,19}') and int(value) < 2 ** 64


def validate_plan(value):
    base = {'format', 'purpose', 'role', 'runId', 'hostId', 'expiresAtUnixMs', 'listenAddress', 'port'}
    pair = {'peerAddress', 'replicationPassword'}
    variants = {
        'primary': pair | {'password', 'tlsCertificateFile', 'tlsKeyFile'},
        'standby': pair | {'systemIdentifier', 'primaryPort', 'primaryDnsName', 'tlsRootFile'},
        'game': {'password'},
    }
    require(isinstance(value, dict) and isinstance(value.get('role'), str) and value['role'] in variants, 'invalid-node-role')
    require(set(value) == base | variants[value['role']] and type(value['format']) is int and value['format'] == 1
            and value['purpose'] == PURPOSE, 'invalid-node-plan')
    require(pattern(value['runId'], r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}')
            and pattern(value['hostId'], r'[a-f0-9]{64}'), 'invalid-node-identity')
    require(type(value['expiresAtUnixMs']) is int and value['expiresAtUnixMs'] > 0, 'invalid-node-expiry')
    require(private_address(value['listenAddress']) and type(value['port']) is int and 1024 <= value['port'] <= 65535,
            'invalid-private-listener')
    if value['role'] != 'game':
        require(private_address(value['peerAddress']) and value['peerAddress'] != value['listenAddress']
                and pattern(value['replicationPassword'], r'[a-f0-9]{64}'), 'invalid-private-replication-peer')
    if value['role'] != 'standby':
        require(pattern(value['password'], r'[a-f0-9]{64}') and value['password'] != value.get('replicationPassword'),
                'invalid-node-password')
    if value['role'] == 'primary':
        require(valid_path(value['tlsCertificateFile']) and valid_path(value['tlsKeyFile'])
                and value['tlsCertificateFile'] != value['tlsKeyFile'], 'invalid-primary-tls-files')
    if value['role'] == 'standby':
        require(valid_system(value['systemIdentifier']) and type(value['primaryPort']) is int
                and 1024 <= value['primaryPort'] <= 65535 and valid_path(value['tlsRootFile'])
                and pattern(value['primaryDnsName'], r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?'),
                'invalid-standby-source')
    return value


def read_private_json(path):
    require(path.resolve(strict=True) == path, 'noncanonical-private-file')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as file:
        info = os.fstat(file.fileno())
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.geteuid() and info.st_nlink == 1 and info.st_size <= 8192, 'private-file-required')
        return json.loads(file.read(8193))


def private_dir(path):
    info = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'private-directory-required')


def tls_file(value, secret=False):
    path = Path(value)
    info = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and info.st_uid in {0, os.geteuid()} and not info.st_mode & 0o022
            and (not secret or (info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600)),
            'private-tls-material-required')


def trusted_binary(name):
    executable = BIN / name
    info = executable.lstat()
    require(executable.resolve(strict=True) == executable and stat.S_ISREG(info.st_mode) and info.st_uid == 0
            and not info.st_mode & 0o022 and os.access(executable, os.X_OK), 'untrusted-postgres-binary')
    return executable


def require_unmounted_tree(path):
    prefix = str(path)
    mounts = Path('/proc/self/mountinfo').read_text().splitlines()
    require(all(fields[4] != prefix and not fields[4].startswith(prefix + '/')
                for fields in (line.split() for line in mounts)), 'unexpected-mount-in-test-node')


def extract_tar(archive, target, remaining):
    count = 0
    with tarfile.open(archive, 'r:') as bundle:
        for member in bundle:
            name = PurePosixPath(member.name)
            count += 1
            require(count <= 20000 and not name.is_absolute() and '..' not in name.parts and '\\' not in member.name
                    and (member.isdir() or member.isreg()) and 0 <= member.size <= remaining, 'unsafe-base-backup-member')
            output = target.joinpath(*name.parts)
            if member.isdir():
                output.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, output.open('xb') as destination:
                    shutil.copyfileobj(source, destination, 1024 * 1024)
                remaining -= member.size
    return remaining


class Node:
    def __init__(self, plan, runs=ROOT / 'runs'):
        self.plan = plan
        self.role = plan['role']
        self.db = GAME if self.role == 'game' else CHAT
        self.replication_role = 'royal_chat_replica_' + plan['runId'].replace('-', '')
        self.work = runs / plan['runId']
        self.data = self.work / 'data'
        self.socket = self.work / 'socket'
        self.owner = self.work / 'owner.json'
        self.passfile = self.work / 'replication.pgpass'
        self.identity = {key: plan[key] for key in ('purpose', 'role', 'runId', 'hostId', 'listenAddress', 'port')}

    def invoke(self, binary, args, *, sql=None, timeout=45):
        executable = trusted_binary(binary)
        env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'HOME': str(self.work), 'PGOPTIONS': '-c statement_timeout=8000'}
        result = subprocess.run([str(executable), *map(str, args)], input=sql, text=True,
                                capture_output=True, env=env, timeout=timeout)
        # A COMMIT cancelled while waiting for sync replication can still return success.
        require(result.returncode == 0 and not re.search(r'\bWARNING:', result.stderr), 'postgres-' + binary + '-failed')
        return result.stdout.strip()

    def local_sql(self, sql, database='postgres'):
        return self.invoke('psql', ['-XwAtq', '-v', 'ON_ERROR_STOP=1', '-h', self.socket,
                                    '-p', self.plan['port'], '-U', OS_USER, '-d', database, '-f', '-'], sql=sql)

    def connection(self):
        p = self.plan
        return (f"host={p['primaryDnsName']} hostaddr={p['peerAddress']} port={p['primaryPort']} user={self.replication_role} "
                f"application_name={STANDBY} sslmode=verify-full sslrootcert={p['tlsRootFile']} "
                f"passfile={self.passfile} require_auth=scram-sha-256 connect_timeout=5")

    def password_entry(self):
        p = self.plan
        return f"{p['primaryDnsName']}:{p['primaryPort']}:replication:{self.replication_role}:{p['replicationPassword']}\n"

    def settings(self, bootstrap=False):
        p = self.plan
        bind = '' if bootstrap else p['listenAddress']
        conf = [f"listen_addresses = '{bind}'", f"port = {p['port']}", f"unix_socket_directories = '{self.socket}'",
                "unix_socket_permissions = 0700", 'max_connections = 60', 'fsync = on', 'synchronous_commit = on',
                'full_page_writes = on', "password_encryption = 'scram-sha-256'", 'log_statement = none',
                'log_min_error_statement = panic', "max_wal_size = '512MB'", "wal_keep_size = '256MB'",
                f"royal.chat_load_run_id = '{p['runId']}'", f"royal.chat_load_node_id = '{p['hostId']}'"]
        hba = [f'local all {OS_USER} peer']
        if not bootstrap:
            # SSH on this node opens the forwarded socket from its own private address.
            hba.append(f"hostnossl {self.db} {self.db} {p['listenAddress']}/32 scram-sha-256")
            if self.role == 'primary':
                conf += ['ssl = on', f"ssl_cert_file = '{p['tlsCertificateFile']}'", f"ssl_key_file = '{p['tlsKeyFile']}'",
                         'wal_level = replica', 'max_wal_senders = 4', f"synchronous_standby_names = 'FIRST 1 ({STANDBY})'"]
                hba.append(f"hostssl replication {self.replication_role} {p['peerAddress']}/32 scram-sha-256")
            elif self.role == 'standby':
                conf += ['hot_standby = on', f"primary_conninfo = '{self.connection()}'"]
        return '\n'.join(conf) + '\n', '\n'.join(hba) + '\n'

    def write_settings(self, bootstrap=False):
        for filename, text in zip(('postgresql.conf', 'pg_hba.conf'), self.settings(bootstrap), strict=True):
            (self.data / filename).write_text(text, encoding='utf8')

    def owned(self):
        private_dir(self.work)
        require(read_private_json(self.owner) == self.identity, 'node-owner-mismatch')

    def pid(self):
        file = self.data / 'postmaster.pid'
        if not file.exists() and not file.is_symlink():
            return None
        require(file.resolve(strict=True) == file and file.is_file() and file.stat().st_uid == os.geteuid()
                and file.stat().st_size <= 2048, 'invalid-postmaster-pid-file')
        lines = file.read_text().splitlines()
        require(len(lines) >= 2 and pattern(lines[0], r'[1-9][0-9]{0,9}') and lines[1] == str(self.data), 'invalid-postmaster-pid')
        proc = Path('/proc') / lines[0]
        if not proc.exists():
            return None
        args = (proc / 'cmdline').read_bytes().split(b'\0')
        require(proc.stat().st_uid == os.geteuid() and (proc / 'exe').resolve(strict=True) == BIN / 'postgres'
                and args[1:3] == [b'-D', os.fsencode(self.data)], 'postmaster-process-mismatch')
        return int(lines[0])

    def stop(self):
        if self.pid() is not None:
            self.invoke('pg_ctl', ['-D', self.data, '-m', 'fast', '-w', '-t', '30', 'stop'])
            require(self.pid() is None, 'owned-postmaster-still-running')

    def start(self, bootstrap=False):
        private_dir(self.data)
        private_dir(self.socket)
        require_unmounted_tree(self.work)
        trusted_binary('postgres')
        version = self.data / 'PG_VERSION'
        require(version.resolve(strict=True) == version and version.is_file() and version.stat().st_size <= 16
                and version.read_text().strip() == '17', 'postgres-17-required')
        require(self.pid() is None, 'owned-postmaster-already-running')
        for filename, text in zip(('postgresql.conf', 'pg_hba.conf'), self.settings(bootstrap), strict=True):
            file = self.data / filename
            require(file.resolve(strict=True) == file and file.is_file() and file.stat().st_size <= 8192
                    and file.read_text(encoding='utf8') == text, 'owned-postgres-config-changed')
        auto = self.data / 'postgresql.auto.conf'
        require(auto.resolve(strict=True) == auto and auto.is_file() and auto.stat().st_size <= 8192
                and all(not line.strip() or line.lstrip().startswith('#')
                for line in auto.read_text().splitlines()), 'postgres-auto-configuration-override')
        standby_signal = self.data / 'standby.signal'
        require(not (self.data / 'recovery.signal').exists() and not (self.data / 'recovery.signal').is_symlink()
                and not standby_signal.is_symlink() and standby_signal.is_file() == (self.role == 'standby'), 'unexpected-recovery-mode')
        if self.role == 'standby':
            tls_file(str(self.passfile), secret=True)
            require(self.passfile.read_text() == self.password_entry(), 'invalid-owned-replication-passfile')
        log = self.work / 'postgres.log'
        require(not log.is_symlink() and (not log.exists() or (log.is_file() and log.stat().st_uid == os.geteuid()
                and log.stat().st_nlink == 1)), 'invalid-owned-postgres-log')
        self.invoke('pg_ctl', ['-D', self.data, '-l', log, '-w', '-t', '30', 'start'])
        require(self.pid() is not None, 'owned-postmaster-not-running')

    def prepare_primary(self):
        trusted_binary('postgres')
        self.invoke('initdb', ['-D', self.data, '-U', OS_USER, '--auth-local=peer', '--auth-host=scram-sha-256',
                               '--locale=C', '--encoding=UTF8', '--data-checksums'])
        self.write_settings(bootstrap=True)
        try:
            self.start(bootstrap=True)
            self.local_sql(f"CREATE ROLE {self.db} LOGIN PASSWORD '{self.plan['password']}';\n"
                           f"CREATE DATABASE {self.db} OWNER {self.db};\n"
                           f"REVOKE CONNECT ON DATABASE {self.db} FROM PUBLIC;\n"
                           f"GRANT pg_read_all_stats TO {self.db};")
            self.local_sql(f"GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO {self.db};", self.db)
            if self.role == 'primary':
                self.local_sql(f"CREATE ROLE {self.replication_role} REPLICATION LOGIN PASSWORD '{self.plan['replicationPassword']}';")
                self.local_sql(f"CREATE TABLE public.stand_probe(id uuid PRIMARY KEY); GRANT SELECT ON public.stand_probe TO {self.db};", self.db)
            else:
                self.local_sql(f'CREATE SCHEMA royal_game AUTHORIZATION {self.db};', self.db)
        finally:
            self.stop()

    def prepare_standby(self):
        p = self.plan
        with self.passfile.open('x') as file:
            file.write(self.password_entry())
        connection = self.connection()
        identity = self.invoke('psql', ['-XwAtq', '-F', '\t', '-d', connection + ' replication=true', '-c', 'IDENTIFY_SYSTEM'])
        require(identity.split('\t', 1)[0] == p['systemIdentifier'], 'base-backup-source-identity-mismatch')
        backup = self.work / 'backup'
        backup.mkdir(mode=0o700)
        self.invoke('pg_basebackup', ['-w', '-D', backup, '-F', 'tar', '-X', 'stream', '--no-manifest', '--max-rate=2M', '-d', connection], timeout=300)
        require({file.name for file in backup.iterdir()} == {'base.tar', 'pg_wal.tar'}, 'unexpected-base-backup-archive')
        require(all(file.is_file() and not file.is_symlink() for file in backup.iterdir())
                and sum(file.stat().st_size for file in backup.iterdir()) <= MAX_BACKUP_BYTES, 'base-backup-byte-limit')
        self.data.mkdir(mode=0o700)
        remaining = extract_tar(backup / 'base.tar', self.data, MAX_BACKUP_BYTES)
        (self.data / 'pg_wal').mkdir(mode=0o700, exist_ok=True)
        extract_tar(backup / 'pg_wal.tar', self.data / 'pg_wal', remaining)
        control = self.invoke('pg_controldata', ['-D', self.data])
        require(re.search(r'^Database system identifier:\s+' + re.escape(p['systemIdentifier']) + r'\s*$', control, re.M),
                'restored-base-backup-identity-mismatch')
        with (self.data / 'standby.signal').open('x'):
            pass
        (backup / 'base.tar').unlink()
        (backup / 'pg_wal.tar').unlink()
        backup.rmdir()

    def prepare(self):
        reserve = 5 * 1024 ** 3 + (2 * MAX_BACKUP_BYTES if self.role == 'standby' else 128 * 1024 ** 2)
        require(shutil.disk_usage(self.work.parent).free >= reserve, 'insufficient-test-node-disk-space')
        self.work.mkdir(mode=0o700)
        with self.owner.open('x') as file:
            json.dump(self.identity, file)
        self.socket.mkdir(mode=0o700)
        if self.role == 'standby':
            self.prepare_standby()
        else:
            self.prepare_primary()
        self.write_settings()

    def status(self):
        disk = self.data if self.data.exists() else self.work
        private_dir(disk)
        report = {**self.identity, 'running': self.pid() is not None, 'freeDiskBytes': shutil.disk_usage(disk).free}
        if not report['running']:
            return report
        status = json.loads(self.local_sql(f"""SELECT json_build_object(
          'systemIdentifier',(pg_control_system()).system_identifier::text,'serverVersion',current_setting('server_version_num'),
          'runId',current_setting('royal.chat_load_run_id',true),'hostId',current_setting('royal.chat_load_node_id',true),
          'recovery',pg_is_in_recovery(),'fsync',current_setting('fsync'),'synchronousCommit',current_setting('synchronous_commit'),
          'synchronousStandbyNames',current_setting('synchronous_standby_names'), 'maxConnections',current_setting('max_connections')::int,
          'replayLsn',pg_last_wal_replay_lsn()::text,
          'replication',(SELECT coalesce(json_agg(json_build_object('name', application_name, 'peer', host(client_addr),
            'state', state, 'syncState', sync_state, 'flushLsn', flush_lsn::text)), '[]'::json) FROM pg_stat_replication));"""))
        require(status['runId'] == report['runId'] and status['hostId'] == report['hostId'] and valid_system(status['systemIdentifier'])
                and status['serverVersion'].startswith('17') and status['recovery'] == (self.role == 'standby')
                and (self.role != 'standby' or status['systemIdentifier'] == self.plan['systemIdentifier']), 'running-postgres-identity-mismatch')
        if self.role != 'game':
            status['markerPresent'] = self.local_sql(f"SELECT EXISTS(SELECT 1 FROM public.stand_probe WHERE id='{self.plan['runId']}');", self.db) == 't'
        return {**report, **status}

    def verify(self):
        require(self.role == 'primary', 'verify-requires-chat-primary')
        state = self.status()
        require(state['running'] and state['fsync'] == 'on' and state['synchronousCommit'] == 'on'
                and state['synchronousStandbyNames'] == f'FIRST 1 ({STANDBY})' and len(state['replication']) == 1,
                'synchronous-replica-required')
        replica = state['replication'][0]
        require(replica['name'] == STANDBY and replica['peer'] == self.plan['peerAddress'] and replica['state'] == 'streaming'
                and replica['syncState'] == 'sync' and replica['flushLsn'], 'synchronous-replica-required')
        lsn = self.local_sql(f"BEGIN; INSERT INTO public.stand_probe VALUES ('{self.plan['runId']}') "
                             'ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id; COMMIT; SELECT pg_current_wal_flush_lsn();', self.db)
        require(pattern(lsn, r'[0-9A-F]+/[0-9A-F]+'), 'invalid-readiness-wal-position')
        return {**self.status(), 'minimumReplayLsn': lsn}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=('prepare', 'start', 'status', 'verify', 'stop', 'destroy'))
    parser.add_argument('--plan', type=Path, required=True)
    args = parser.parse_args()
    try:
        require(sys.platform.startswith('linux') and os.geteuid() != 0, 'dedicated-linux-user-required')
        import pwd
        require(pwd.getpwuid(os.geteuid()).pw_name == OS_USER, 'dedicated-linux-user-required')
        def interrupted(_signum, _frame):
            raise KeyboardInterrupt

        signal.signal(signal.SIGTERM, interrupted)
        os.umask(0o077)
        for path in (ROOT, ROOT / 'plans', ROOT / 'runs'):
            private_dir(path)
        require(args.plan.parent == ROOT / 'plans', 'plan-outside-private-test-root')
        plan = validate_plan(read_private_json(args.plan))
        machine_id = Path('/etc/machine-id').read_bytes().strip()
        require(re.fullmatch(rb'[a-f0-9]{32}', machine_id) is not None and machine_id != b'0' * 32,
                'invalid-linux-machine-id')
        require(hashlib.sha256(machine_id).hexdigest() == plan['hostId'], 'node-host-identity-mismatch')
        if args.action in {'prepare', 'start', 'verify'}:
            require(0 < plan['expiresAtUnixMs'] - time.time_ns() // 1_000_000 <= 8 * 60 * 60_000, 'test-node-plan-expired-or-too-long')
            if plan['role'] == 'primary':
                tls_file(plan['tlsCertificateFile'])
                tls_file(plan['tlsKeyFile'], secret=True)
            elif plan['role'] == 'standby':
                tls_file(plan['tlsRootFile'])
        node = Node(plan)
        # Keep a stable lock inode across the destruction and recreation of a run.
        import fcntl
        lock_path = ROOT / 'runs' / '.node.lock'
        with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'rb') as lock:
            info = os.fstat(lock.fileno())
            require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.geteuid()
                    and info.st_nlink == 1, 'invalid-node-lock')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.action == 'prepare':
                node.prepare()
            else:
                node.owned()
                if args.action == 'start':
                    require(node.pid() is None, 'owned-postmaster-already-running')
                    try:
                        node.start()
                        report = node.status()
                    except BaseException:
                        node.stop()
                        raise
                    print(json.dumps(report))
                    return 0
                elif args.action in {'stop', 'destroy'}:
                    node.stop()
                    if args.action == 'destroy':
                        require(shutil.rmtree.avoids_symlink_attacks and node.work.parent == ROOT / 'runs', 'unsafe-test-node-cleanup')
                        require_unmounted_tree(node.work)
                        shutil.rmtree(node.work)
                        print(json.dumps({**node.identity, 'destroyed': True}))
                        return 0
            print(json.dumps(node.verify() if args.action == 'verify' else node.status()))
        return 0
    except (Refused, OSError, ValueError, KeyError, KeyboardInterrupt, subprocess.SubprocessError, tarfile.TarError) as error:
        # Subprocess errors and malformed private inputs may include secrets.
        print(str(error) if isinstance(error, Refused) else 'isolated-postgres-node-operation-failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
