#!/usr/bin/env python3
"""Private, bounded stand supervisor for 31.56.189.118 only.

The Docker budget includes game processes, PostgreSQL, Redis and Caddy.
CPU/RAM/PID caps affect measured results and do not prove uncapped capacity.
No fixture tokens or control secrets are returned by this helper.
"""
import argparse
from contextlib import contextmanager
import errno
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import stat
import subprocess
import time
import uuid

HOST = '31.56.189.118'
HOST_LOCK = Path('/opt/royal-load-admission.lock')
PURPOSE = 'royal.load.purpose=dedicated-stand'
INACTIVE = {'created', 'exited', 'dead'}
HEX = re.compile(r'[a-f0-9]{64}')
CLIENT_ORIGIN = 'http://127.0.0.1:17100'
LIMITS_NOTE = 'Container caps include game, PostgreSQL, Redis and Caddy; they affect capacity measurements.'
TLS_GATEWAY = {'port': 26443, 'serverName': 'royal-load.test'}
TLS_REFUSED_CODES = {'stop-requested-before-start', 'ready-stand-required-before-tls', 'fresh-tls-gateway-required',
    'fresh-tls-assets-required', 'exact-running-tls-container-required', 'container-ownership-changed',
    'bounded-command-failed', 'private-tls-asset-required', 'tls-asset-size-changed', 'invalid-generated-tls-assets',
    'invalid-tls-upstream-port', 'invalid-tls-process-identity', 'tls-attestation-deadline',
    'invalid-private-tls-attestation', 'tls-peer-certificate-mismatch', 'tls-attestation-rejected',
    'tls-attestation-mismatch', 'tls-attestation-malformed-response', 'tls-certificate-digest-mismatch', 'tls-asset-digest-mismatch',
    'tls-process-changed', 'tls-stand-run-changed', 'tls-gateway-readiness-lost', 'tls-gateway-provenance-mismatch',
    'lifecycle-lock-timeout', 'private-lifecycle-lock-required'}


class Refused(RuntimeError):
    pass


def tls_failure_code(error):
    if isinstance(error, Refused) and str(error) in TLS_REFUSED_CODES:
        return str(error)
    if isinstance(error, subprocess.TimeoutExpired):
        return 'bounded-command-timeout'
    if isinstance(error, ssl.SSLCertVerificationError):
        return 'tls-certificate-rejected'
    if isinstance(error, ssl.SSLError):
        return 'tls-failed'
    if isinstance(error, OSError):
        return {errno.EACCES: 'permission-denied', errno.EPERM: 'permission-denied', errno.ENOENT: 'asset-missing',
                errno.EADDRINUSE: 'port-in-use', errno.ECONNREFUSED: 'tls-listener-unavailable'}.get(error.errno, 'operating-system-failed')
    return 'interrupted' if isinstance(error, KeyboardInterrupt) else 'dedicated-stand-failed'


def private_json(path, limit=65536):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > limit:
        raise Refused('private-bounded-file-required')
    return json.loads(path.read_text())


def write_private(path, value):
    temporary = path.with_name(path.name + '.tmp-' + str(uuid.uuid4()))
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
            json.dump(value, stream, separators=(',', ':'))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def digest(path, limit=1024 * 1024):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise Refused('regular-bounded-asset-required')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(plan):
    try:
        run = plan['runId']
        canonical = str(uuid.UUID(run)) == run
    except (KeyError, ValueError, TypeError, AttributeError):
        raise Refused('canonical-run-uuid-required')
    if type(plan.get('protocol')) is not int or plan['protocol'] != 1 or not canonical or plan.get('targetHost') != HOST:
        raise Refused('dedicated-host-and-protocol-required')
    if plan.get('ownedRoot') != '/opt/royal-load-' + run or plan.get('containerName') != 'royal-load-' + run + '-test':
        raise Refused('exact-owned-target-required')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', str(plan.get('imageId', ''))):
        raise Refused('immutable-image-id-required')
    for key in ('metadataSha256', 'bundleSha256', 'machineIdSha256', 'helperSha256'):
        if not HEX.fullmatch(str(plan.get(key, ''))):
            raise Refused('pinned-digests-required')
    count, processes, seconds = plan.get('clients'), plan.get('gameProcesses', 4), plan.get('seconds')
    if type(processes) is not int or not 1 <= processes <= 24 or type(count) is not int or not 4 <= count <= min(6000, processes * 300):
        raise Refused('invalid-client-or-process-limit')
    if type(seconds) is not int or not 1 <= seconds <= 1800:
        raise Refused('invalid-measurement-seconds')
    budget = plan.get('budget', {'cpus': 18, 'memoryMiB': 40960, 'pidsLimit': 2048})
    if not isinstance(budget, dict) or set(budget) != {'cpus', 'memoryMiB', 'pidsLimit'}:
        raise Refused('invalid-container-budget')
    if type(budget['cpus']) not in (int, float) or not 1 <= budget['cpus'] <= 18:
        raise Refused('invalid-cpu-budget')
    if type(budget['memoryMiB']) is not int or not 1024 <= budget['memoryMiB'] <= 40960:
        raise Refused('invalid-memory-budget')
    if type(budget['pidsLimit']) is not int or not 64 <= budget['pidsLimit'] <= 2048:
        raise Refused('invalid-pid-budget')
    if 'tlsGateway' in plan and (not isinstance(plan['tlsGateway'], dict) or plan['tlsGateway'] != TLS_GATEWAY
                               or type(plan['tlsGateway'].get('port')) is not int):
        raise Refused('fixed-test-tls-gateway-required')
    if 'sameHostGenerators' in plan and (plan['sameHostGenerators'] is not True or 'tlsGateway' in plan):
        raise Refused('isolated-loopback-generators-required')
    return {**plan, 'gameProcesses': processes, 'budget': budget}


def load_plan(path):
    plan = validate(private_json(path))
    root = Path(plan['ownedRoot'])
    if path.parent != root or path.name != 'plan.json' or path.stat().st_uid != 0:
        raise Refused('private-owned-plan-path-required')
    if root.is_symlink() or not root.is_dir() or root.stat().st_uid != 0 or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise Refused('private-root-owned-directory-required')
    run = root / 'run'
    if run.is_symlink() or not run.is_dir() or run.stat().st_uid != 1000 or stat.S_IMODE(run.stat().st_mode) != 0o700:
        raise Refused('private-node-run-directory-required')
    machine = Path('/etc/machine-id').read_bytes()
    if hashlib.sha256(machine).hexdigest() != plan['machineIdSha256']:
        raise Refused('dedicated-machine-identity-mismatch')
    if digest(Path(__file__), 1024 * 1024) != plan['helperSha256']:
        raise Refused('supervisor-digest-mismatch')
    return plan


def command(args, timeout=10, limit=131072):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/root'})
    if result.returncode or len(result.stdout) > limit:
        raise Refused('bounded-command-failed')
    return result.stdout.decode().strip()


def process_identity(pid):
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()
    if fields[0] in {'Z', 'X', 'x'}:
        raise Refused('process-not-live')
    return fields[19]


def alive(pid, ticks):
    try:
        return type(pid) is int and pid > 1 and process_identity(pid) == ticks
    except (OSError, IndexError, Refused):
        return False


class Stand:
    def __init__(self, plan, plan_path):
        self.plan, self.plan_path = plan, plan_path
        self.root, self.name, self.run = Path(plan['ownedRoot']), plan['containerName'], plan['runId']
        self.state_path, self.guard_path = self.root / 'state.json', self.root / 'guardian.json'
        self.manifest = self.root / 'run/stand.json'
        self.tls_state_path = self.root / 'tls-gateway.json'

    def tls_enabled(self):
        if self.plan.get('tlsGateway') != TLS_GATEWAY:
            raise Refused('tls-gateway-not-enabled')

    def tls_assets(self):
        return [(self.root / 'tls-public.pem', 0, {0o600}, 16384),
                (self.root / 'tls-private.generated.pem', 0, {0o600}, 16384),
                (self.root / 'tls-certificate.generated.pem', 0, {0o600}, 16384),
                (self.root / 'run/tls-gateway.key.pem', 1000, {0o600}, 16384),
                (self.root / 'run/tls-gateway.cert.pem', 1000, {0o600}, 16384),
                (self.root / 'run/tls-gateway.json', 1000, {0o600}, 65536),
                (self.root / 'run/tls-gateway.pid', 1000, {0o600, 0o644}, 64)]

    def tls_read(self, path, uid, modes, limit):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != uid \
                    or stat.S_IMODE(info.st_mode) not in modes or info.st_size > limit:
                raise Refused('private-tls-asset-required')
            data = stream.read(limit + 1)
            if len(data) > limit:
                raise Refused('tls-asset-size-changed')
            return data

    def tls_write(self, path, data, uid):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as stream:
            stream.write(data)
            os.fchown(stream.fileno(), uid, uid)

    def tls_state(self, identifier):
        if self.tls_state_path.exists() or self.tls_state_path.is_symlink():
            self.tls_read(self.tls_state_path, 0, {0o600}, 65536)
        value = private_json(self.tls_state_path) if self.tls_state_path.exists() else {}
        if value and (value.get('runId') != self.run or value.get('containerId') != identifier
                      or value.get('imageId') != self.plan['imageId']):
            raise Refused('tls-gateway-provenance-mismatch')
        return value

    def tls_config(self, port):
        if type(port) is not int or not 1024 <= port <= 65535 or port == TLS_GATEWAY['port']:
            raise Refused('invalid-tls-upstream-port')
        owners = '|'.join(['main'] + ['worker-' + str(index) for index in range(1, self.plan['gameProcesses'])])
        identifier = '[A-Za-z0-9_-]{1,64}'
        return {'admin': {'disabled': True},
                'logging': {'logs': {'default': {'level': 'ERROR', 'writer': {'output': 'discard'}}}},
                'apps': {'tls': {'certificates': {'load_files': [{'certificate': '/app/run/tls-gateway.cert.pem',
                                                               'key': '/app/run/tls-gateway.key.pem'}]}},
                         'http': {'servers': {'gateway': {'listen': [':26443'], 'protocols': ['h1'],
                             'automatic_https': {'disable': True, 'disable_redirects': True},
                             'tls_connection_policies': [{'alpn': ['http/1.1']}],
                             'routes': [{'match': [{'method': ['GET'], 'path': ['/__load-stand/status']},
                                 {'method': ['POST'], 'path_regexp': {'name': 'matchmake', 'pattern':
                                  '^/matchmake/(?:joinOrCreate/lobby|(?:joinById|reconnect)/' + identifier + ')$'}},
                                 {'method': ['GET'], 'header': {'Upgrade': ['websocket']}, 'path_regexp':
                                  {'name': 'socket', 'pattern': '^/workers/(?:' + owners + ')/' + identifier + '/' + identifier + '$'}}],
                                 'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:' + str(port)}],
                                             'headers': {'request': {'set': {'Host': ['127.0.0.1:' + str(port)]}}}}],
                                 'terminal': True}, {'handle': [{'handler': 'static_response', 'status_code': 404}], 'terminal': True}]}}}}}

    def tls_port_available(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as peer:
            peer.bind(('0.0.0.0', TLS_GATEWAY['port']))

    def tls_exec(self, identifier, args, timeout=10):
        value = self.inspect()
        if not value or value['Id'] != identifier or value['status'] != 'running':
            raise Refused('exact-running-tls-container-required')
        return command(['docker', 'exec', '--user', '1000:1000', '--env', 'HOME=/tmp',
                        '--env', 'XDG_DATA_HOME=/tmp/royal-load-tls-' + self.run,
                        '--env', 'XDG_CONFIG_HOME=/tmp/royal-load-tls-' + self.run,
                        identifier, *args], timeout=timeout, limit=65536)

    def tls_process(self, identifier):
        source = "const f=require('fs');const s=f.readFileSync('/app/run/tls-gateway.pid','utf8').trim();if(!/^[0-9]{1,10}$/.test(s))throw Error();const pid=Number(s);if(pid<2||pid>2147483647)throw Error();const row=f.readFileSync('/proc/'+pid+'/stat','utf8');const fields=row.slice(row.lastIndexOf(')')+2).split(/\\s+/);const uid=f.readFileSync('/proc/'+pid+'/status','utf8').match(/^Uid:\\s+(\\d+)/m);if(fields[0]==='Z'||fields[0]==='X'||!uid||uid[1]!=='1000'||f.readlinkSync('/proc/'+pid+'/exe')!=='/usr/local/bin/caddy')throw Error();console.log(JSON.stringify({pid,ticks:fields[19]}));"
        value = json.loads(self.tls_exec(identifier, ['node', '-e', source]))
        if type(value.get('pid')) is not int or not 2 <= value['pid'] <= 2147483647 \
                or not re.fullmatch(r'[0-9]{1,20}', str(value.get('ticks', ''))):
            raise Refused('invalid-tls-process-identity')
        return value

    def tls_probe(self, fixture, certificate):
        previous = signal.getsignal(signal.SIGALRM)
        timer = signal.getitimer(signal.ITIMER_REAL)
        started = time.monotonic()
        def timed_out(*_):
            raise Refused('tls-attestation-deadline')
        signal.signal(signal.SIGALRM, timed_out)
        signal.setitimer(signal.ITIMER_REAL, 6)
        try:
            self.tls_probe_connection(fixture, certificate)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)
            if timer[0]:
                signal.setitimer(signal.ITIMER_REAL, max(0.001, timer[0] - (time.monotonic() - started)), timer[1])

    def tls_probe_connection(self, fixture, certificate):
        if not HEX.fullmatch(str(fixture.get('secret', ''))):
            raise Refused('invalid-private-tls-attestation')
        context = ssl.create_default_context(cadata=certificate.decode('ascii'))
        context.set_alpn_protocols(['http/1.1'])
        with socket.create_connection(('127.0.0.1', TLS_GATEWAY['port']), timeout=3) as raw:
            with context.wrap_socket(raw, server_hostname=TLS_GATEWAY['serverName']) as connection:
                if connection.getpeercert(binary_form=True) != ssl.PEM_cert_to_DER_cert(certificate.decode('ascii')):
                    raise Refused('tls-peer-certificate-mismatch')
                connection.sendall(('GET /__load-stand/status HTTP/1.1\r\nHost: royal-load.test\r\nAuthorization: Bearer '
                                    + fixture['secret'] + '\r\nConnection: close\r\n\r\n').encode('ascii'))
                response = http.client.HTTPResponse(connection)
                response.begin()
                data = response.read(65537)
                if response.status != 200 or len(data) > 65536:
                    raise Refused('tls-attestation-rejected')
        try:
            value = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise Refused('tls-attestation-malformed-response') from None
        if not isinstance(value, dict):
            raise Refused('tls-attestation-malformed-response')
        if value.get('protocol') != 1 or value.get('role') != 'isolated-test-stand' or any(
                value.get(key) != fixture.get(key) for key in ['runId', 'bundleSha256', 'clients', 'seconds',
                                                              'gameProcesses', 'apiEndpoint', 'expiresAt', 'serverHost']):
            raise Refused('tls-attestation-mismatch')

    def tls_status(self, probe=True):
        self.tls_enabled()
        value = self.inspect()
        if not value:
            raise Refused('exact-tls-container-required')
        state = self.tls_state(value['Id'])
        absent = all(not path.exists() and not path.is_symlink() for path, *_ in self.tls_assets())
        result = {'runId': self.run, 'containerId': value['Id'], **TLS_GATEWAY, 'ready': False,
                  'closed': value['status'] in INACTIVE, 'assetsRemoved': absent}
        for key in ['standRunId', 'certificateSha256', 'configSha256', 'caddyPid', 'caddyStartTicks', 'failureStage', 'failureCode']:
            if key in state:
                result[key] = state[key]
        if value['status'] != 'running' or state.get('phase') != 'active':
            return result
        if not self.status(include_tls=False)['ready']:
            return result
        certificate = self.tls_read(self.root / 'tls-public.pem', 0, {0o600}, 16384)
        if hashlib.sha256(certificate).hexdigest() != state.get('certificateSha256'):
            raise Refused('tls-certificate-digest-mismatch')
        for path, uid, modes, limit in self.tls_assets()[3:6]:
            data = self.tls_read(path, uid, modes, limit)
            expected = state.get({'tls-gateway.key.pem': 'keySha256', 'tls-gateway.cert.pem': 'certificateSha256',
                                  'tls-gateway.json': 'configSha256'}[path.name])
            if hashlib.sha256(data).hexdigest() != expected:
                raise Refused('tls-asset-digest-mismatch')
        self.tls_read(self.root / 'run/tls-gateway.pid', 1000, {0o600, 0o644}, 64)
        current = self.tls_process(value['Id'])
        if current != {'pid': state.get('caddyPid'), 'ticks': state.get('caddyStartTicks')}:
            raise Refused('tls-process-changed')
        fixture = private_json(self.manifest, 2 * 1024 * 1024)
        if fixture.get('runId') != state.get('standRunId'):
            raise Refused('tls-stand-run-changed')
        if probe:
            self.tls_probe(fixture, certificate)
        latest = self.status(include_tls=False)
        if not latest['ready'] or latest.get('containerId') != value['Id'] or latest.get('standRunId') != state.get('standRunId'):
            return result
        result['ready'] = True
        return result

    def tls_certificate(self):
        status = self.tls_status()
        if not status['ready']:
            raise Refused('ready-tls-gateway-required')
        data = self.tls_read(self.root / 'tls-public.pem', 0, {0o600}, 16384)
        return {'runId': self.run, 'containerId': status['containerId'],
                'certificateSha256': status['certificateSha256'], 'certificatePEM': data.decode('ascii')}

    def tls_start(self):
        self.tls_enabled()
        base = self.status(include_tls=False)
        if not base['ready']:
            raise Refused('ready-stand-required-before-tls')
        if self.tls_state_path.exists() or self.tls_state_path.is_symlink():
            raise Refused('fresh-tls-gateway-required')
        began = False
        stage = 'preflight'
        previous = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGINT)}
        for number in previous:
            signal.signal(number, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        try:
            with self.lifecycle():
                self.not_cancelled()
                if self.tls_state_path.exists() or self.tls_state_path.is_symlink():
                    raise Refused('fresh-tls-gateway-required')
                base = self.status(include_tls=False)
                if not base['ready']:
                    raise Refused('ready-stand-required-before-tls')
                self.tls_exec(base['containerId'], ['node', '-e', 'process.exit(0)'])
                if any(path.exists() or path.is_symlink() for path, *_ in self.tls_assets()):
                    raise Refused('fresh-tls-assets-required')
                self.tls_port_available()
                state = {'runId': self.run, 'containerId': base['containerId'], 'imageId': self.plan['imageId'],
                         'standRunId': base['standRunId'], 'phase': 'preparing'}
                began = True
                write_private(self.tls_state_path, state)
                stage = 'certificate-generation'
                old_umask = os.umask(0o077)
                try:
                    command(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
                             '-nodes', '-days', '1', '-subj', '/CN=royal-load.test', '-addext', 'subjectAltName=DNS:royal-load.test',
                             '-keyout', str(self.root / 'tls-private.generated.pem'),
                             '-out', str(self.root / 'tls-certificate.generated.pem')], timeout=10, limit=16384)
                finally:
                    os.umask(old_umask)
                key = self.tls_read(self.root / 'tls-private.generated.pem', 0, {0o600}, 16384)
                certificate = self.tls_read(self.root / 'tls-certificate.generated.pem', 0, {0o600}, 16384)
                if b'PRIVATE KEY' not in key or b'PRIVATE KEY' in certificate:
                    raise Refused('invalid-generated-tls-assets')
                ssl.PEM_cert_to_DER_cert(certificate.decode('ascii'))
                stage = 'asset-prepare'
                config = json.dumps(self.tls_config(base['serverApiPort']), separators=(',', ':')).encode('ascii')
                self.tls_write(self.root / 'run/tls-gateway.key.pem', key, 1000)
                self.tls_write(self.root / 'run/tls-gateway.cert.pem', certificate, 1000)
                self.tls_write(self.root / 'run/tls-gateway.json', config, 1000)
                self.tls_write(self.root / 'tls-public.pem', certificate, 0)
                for name in ['tls-private.generated.pem', 'tls-certificate.generated.pem']:
                    (self.root / name).unlink()
                self.not_cancelled()
                stage = 'config-validate'
                self.tls_exec(base['containerId'], ['/usr/local/bin/caddy', 'validate', '--config', '/app/run/tls-gateway.json'], timeout=15)
                self.not_cancelled()
                stage = 'caddy-start'
                start_source = "const c=require('child_process').spawn('/usr/local/bin/caddy',['start','--config','/app/run/tls-gateway.json','--pidfile','/app/run/tls-gateway.pid'],{stdio:'ignore'});c.once('error',()=>process.exit(1));c.once('close',(code)=>process.exit(code===0?0:1));"
                self.tls_exec(base['containerId'], ['node', '-e', start_source], timeout=15)
                stage = 'process-identity'
                identity = self.tls_process(base['containerId'])
                self.not_cancelled()
                fixture = private_json(self.manifest, 2 * 1024 * 1024)
                stage = 'tls-attestation'
                self.tls_probe(fixture, certificate)
                self.not_cancelled()
                state.update(phase='active', certificateSha256=hashlib.sha256(certificate).hexdigest(),
                             keySha256=hashlib.sha256(key).hexdigest(), configSha256=hashlib.sha256(config).hexdigest(),
                             caddyPid=identity['pid'], caddyStartTicks=identity['ticks'])
                write_private(self.tls_state_path, state)
            stage = 'ready-verify'
            result = self.tls_status()
            if not result['ready']:
                raise Refused('tls-gateway-readiness-lost')
            return result
        except BaseException as error:
            for number in previous:
                signal.signal(number, signal.SIG_IGN)
            if began:
                try:
                    with self.lifecycle():
                        current = self.tls_state(base['containerId'])
                        write_private(self.tls_state_path, {**current, 'failureStage': stage, 'failureCode': tls_failure_code(error)})
                except Exception:
                    # Diagnostics never prevent the existing owned stop and purge.
                    pass
                self.terminate('tls-gateway-start-failed')
            raise Refused(tls_failure_code(error)) from None
        finally:
            for number, handler in previous.items():
                signal.signal(number, handler)

    def cleanup_tls(self, identifier):
        if 'tlsGateway' not in self.plan:
            return True
        value = self.inspect()
        if (value and (value['Id'] != identifier or value['status'] not in INACTIVE)) or (not value and identifier):
            raise Refused('inactive-owned-container-required-for-tls-cleanup')
        state = self.tls_state(identifier)
        for path, uid, modes, limit in self.tls_assets():
            if path.exists() or path.is_symlink():
                self.tls_read(path, uid, modes, limit)
                path.unlink()
        if state:
            write_private(self.tls_state_path, {**state, 'phase': 'closed', 'assetsRemoved': True})
        return all(not path.exists() and not path.is_symlink() for path, *_ in self.tls_assets())

    @contextmanager
    def lifecycle(self):
        descriptor = os.open(self.root / 'lifecycle.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
                raise Refused('private-lifecycle-lock-required')
            deadline = time.monotonic() + 25
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise Refused('lifecycle-lock-timeout')
                    time.sleep(0.1)
            yield
        finally:
            os.close(descriptor)

    def state(self):
        value = private_json(self.state_path) if self.state_path.exists() else {}
        if value and value.get('runId') != self.run:
            raise Refused('state-run-mismatch')
        return value

    def not_cancelled(self):
        marker = self.root / 'stop-requested.json'
        if marker.exists() or marker.is_symlink():
            raise Refused('stop-requested-before-start')

    def request_cancel(self, reason):
        marker = self.root / 'stop-requested.json'
        temporary = self.root / ('cancel.tmp-' + str(uuid.uuid4()))
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'w') as output:
                json.dump({'runId': self.run, 'reason': reason}, output, separators=(',', ':'))
            try:
                # Publish complete JSON without replacing an earlier verdict.
                os.link(temporary, marker, follow_symlinks=False)
                return reason
            except FileExistsError:
                value = private_json(marker)
                if value.get('runId') != self.run:
                    raise Refused('cancel-marker-run-mismatch')
                return value.get('reason')
        finally:
            temporary.unlink(missing_ok=True)

    @contextmanager
    def host_admission(self):
        descriptor = os.open(HOST_LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(descriptor)
            if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
                raise Refused('private-root-owned-host-lock-required')
            deadline = time.monotonic() + 25
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise Refused('host-admission-lock-timeout')
                    time.sleep(0.1)
            yield
        finally:
            os.close(descriptor)

    def require_exclusive_host(self):
        rows = command(['docker', 'ps', '--all', '--no-trunc', '--filter', 'label=' + PURPOSE,
                        '--format', '{{.ID}} {{.State}}']).splitlines()
        for row in rows:
            fields = row.split()
            if len(fields) != 2 or not HEX.fullmatch(fields[0]) or fields[1] not in {'created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'}:
                raise Refused('invalid-stand-inventory')
            if fields[1] not in {'exited', 'dead'}:
                raise Refused('another-dedicated-stand-active')

    def inspect(self):
        pinned = self.state().get('containerId')
        if pinned:
            if not HEX.fullmatch(str(pinned)):
                raise Refused('invalid-pinned-container-id')
            identifier = pinned
        else:
            identifiers = command(['docker', 'ps', '--all', '--no-trunc', '--filter', 'name=^/' + self.name + '$', '--format', '{{.ID}}']).splitlines()
            if not identifiers:
                return None
            if len(identifiers) != 1 or not HEX.fullmatch(identifiers[0]):
                raise Refused('exact-owned-container-required')
            identifier = identifiers[0]
        template = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"label":{{json (index .Config.Labels "royal.load.run-id")}},"status":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}}}'
        value = json.loads(command(['docker', 'inspect', '--format', template, identifier]))
        if value.get('Id') != identifier or value.get('Name') != '/' + self.name or value.get('Image') != self.plan['imageId'] or value.get('label') != self.run:
            raise Refused('container-ownership-changed')
        return value

    def stop_owned(self):
        value = self.inspect()
        if value and value['status'] not in INACTIVE:
            try:
                command(['docker', 'stop', '-t', '5', value['Id']], timeout=10)
            except (Refused, subprocess.TimeoutExpired):
                fresh = self.inspect()
                if fresh and fresh['status'] not in INACTIVE:
                    command(['docker', 'kill', fresh['Id']], timeout=10)
            value = self.inspect()
        if value and value['status'] not in INACTIVE:
            raise Refused('owned-stop-unconfirmed')
        return value

    def cleanup_fixture(self):
        value = self.inspect()
        if value and value['status'] not in INACTIVE:
            raise Refused('inactive-container-required-for-fixture-cleanup')
        if self.manifest.exists() or self.manifest.is_symlink():
            private_json(self.manifest, 2 * 1024 * 1024)
            self.manifest.unlink()
        return not self.manifest.exists()

    def terminate(self, reason):
        # Persist cancellation before waiting for a slow Docker critical section.
        # The first reason wins, including a guardian failure racing with exit 0.
        self.request_cancel(reason)
        with self.lifecycle():
            value = self.stop_owned()
            removed = self.cleanup_fixture()
            tls_removed = self.cleanup_tls(value['Id'] if value else None)
        return {'runId': self.run, 'containerId': value['Id'] if value else None,
                'stopConfirmed': True, 'privateFixtureGone': removed and tls_removed,
                **({'tlsGatewayClosed': True, 'tlsAssetsRemoved': tls_removed} if 'tlsGateway' in self.plan else {})}

    def host_gate(self):
        cpu_count = sum(line.startswith('cpu') and line[3:4].isdigit() for line in Path('/proc/stat').read_text().splitlines())
        available = next(int(line.split()[1]) / 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
        if cpu_count < self.plan['budget']['cpus'] + 2 or available < self.plan['budget']['memoryMiB'] + 6144:
            raise Refused('insufficient-dedicated-host-reserve')

    def create(self):
        self.not_cancelled()
        if self.inspect() or self.manifest.exists():
            raise Refused('fresh-owned-run-required')
        image = json.loads(command(['docker', 'image', 'inspect', '--format', '{"Id":{{json .Id}},"Os":{{json .Os}}}', self.plan['imageId']]))
        if image.get('Id') != self.plan['imageId'] or image.get('Os') != 'linux':
            raise Refused('immutable-linux-image-required')
        budget = self.plan['budget']
        args = ['docker', 'create', '--pull', 'never', '--name', self.name, '--label', 'royal.load.run-id=' + self.run, '--label', PURPOSE,
                '--cpus', str(budget['cpus']), '--memory', str(budget['memoryMiB']) + 'm', '--memory-swap', str(budget['memoryMiB']) + 'm',
                '--pids-limit', str(budget['pidsLimit']), '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--read-only', '--user', '1000:1000', '--network', 'host', '--entrypoint', 'node', '--workdir', '/app',
                '--tmpfs', '/tmp:rw,exec,nosuid,size=4g,uid=1000,gid=1000',
                '--mount', 'type=bind,src=' + str(self.root / 'run') + ',dst=/app/run',
                '--env', 'NODE_ENV=test', '--env', 'HOME=/tmp', '--env', 'ROYAL_REDIS_SERVER_BINARY=/usr/bin/redis-server',
                self.plan['imageId'], '/app/dist-load/database.mjs', '/app/dist-load/cluster.mjs',
                '--metrics-script', '/app/dist-load/metrics.mjs', '--server-bundle', '/app/dist-server/index.js',
                '--proxy-binary', '/usr/local/bin/caddy', '--game-processes', str(self.plan['gameProcesses']),
                '--clients', str(self.plan['clients']), '--seconds', str(self.plan['seconds']),
                '--stand-manifest', '/app/run/stand.json', '--client-origin', CLIENT_ORIGIN,
                '--frame-diagnostics', '--resource-diagnostics', '--input-mode', 'browser-window',
                '--min-rate-percent', '99', '--max-unacknowledged-percent', '0', '--output', '/app/run/server.json']
        if self.plan.get('sameHostGenerators') is True:
            args += ['--generator-completion-file', '/app/run/generator-completion.json']
        with self.host_admission():
            self.require_exclusive_host()
            self.host_gate()
            with self.lifecycle():
                self.not_cancelled()
                identifier = command(args, timeout=120)
                if not HEX.fullmatch(identifier):
                    raise Refused('full-container-id-required')
                state = self.state()
                write_private(self.state_path, {**state, 'runId': self.run, 'containerId': identifier, 'phase': 'created'})
                self.inspect()
        for name, source, expected in [('metadata', '/app/dist-load/metadata.json', self.plan['metadataSha256']),
                                       ('bundle', '/app/dist-server/index.js', self.plan['bundleSha256'])]:
            temporary = self.root / (name + '-verified.copy')
            if temporary.exists() or temporary.is_symlink():
                raise Refused('fresh-image-check-file-required')
            try:
                command(['docker', 'cp', identifier + ':' + source, str(temporary)], timeout=30)
                if digest(temporary, 16 * 1024 * 1024) != expected:
                    raise Refused('image-asset-digest-mismatch')
            finally:
                temporary.unlink(missing_ok=True)
        state = self.state()
        write_private(self.state_path, {**state, 'assetsVerified': True})
        return identifier

    def spawn(self, mode, log_name):
        file = self.root / log_name
        descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as log:
            return subprocess.Popen([os.sys.executable, str(Path(__file__).resolve()), mode, '--plan', str(self.plan_path)],
                                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
                                    env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/root'})

    def start(self):
        with self.lifecycle():
            self.not_cancelled()
            if self.state_path.exists() or self.inspect():
                raise Refused('new-run-uuid-required')
            write_private(self.state_path, {'runId': self.run, 'phase': 'creating', 'deadline': time.monotonic() + 900 + self.plan['seconds'] + 600})
            try:
                child = self.spawn('supervise', 'supervisor.log')
            except BaseException:
                self.request_cancel('supervisor-spawn-failed')
                raise
        return {'runId': self.run, 'phase': 'creating', 'supervisorPid': child.pid}

    def supervise(self):
        state = self.state()
        write_private(self.state_path, {**state, 'supervisorPid': os.getpid(), 'supervisorTicks': process_identity(os.getpid())})
        reason, passed = 'supervisor-runtime-failure', False
        for number in (signal.SIGTERM, signal.SIGINT):
            signal.signal(number, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        try:
            guard = self.spawn('watch', 'guardian.log')
            until = time.monotonic() + 15
            while not self.guard_path.exists():
                if guard.poll() is not None or time.monotonic() >= until:
                    raise Refused('independent-guardian-not-ready')
                time.sleep(0.1)
            guardian = private_json(self.guard_path)
            if guardian.get('runId') != self.run or guardian.get('pid') != guard.pid or not alive(guard.pid, guardian.get('ticks')):
                raise Refused('independent-guardian-not-live')
            identifier = self.create()
            with self.lifecycle():
                self.not_cancelled()
                if not alive(guard.pid, guardian['ticks']):
                    raise Refused('independent-guardian-ended')
                self.inspect()
                command(['docker', 'start', identifier], timeout=30)
            write_private(self.state_path, {**self.state(), 'phase': 'running'})
            while True:
                value = self.inspect()
                if value['status'] in {'exited', 'dead'}:
                    with self.lifecycle():
                        self.not_cancelled()
                        current_guard = private_json(self.guard_path)
                        if current_guard.get('phase') != 'watching' or not alive(guard.pid, guardian['ticks']):
                            raise Refused('guardian-ended-before-completion')
                        if self.request_cancel('container-ended') != 'container-ended':
                            raise Refused('cancelled-before-completion')
                        passed = value['exitCode'] == 0 and not value['oomKilled']
                    reason = 'container-ended' if passed else 'container-failed'
                    break
                if not alive(guard.pid, guardian['ticks']) or time.monotonic() >= state['deadline']:
                    raise Refused('guardian-ended-or-stand-timeout')
                self.not_cancelled()
                time.sleep(1)
        except BaseException as error:
            reason = str(error) if isinstance(error, Refused) else 'supervisor-runtime-failure'
        finally:
            for number in (signal.SIGTERM, signal.SIGINT):
                signal.signal(number, signal.SIG_IGN)
            try:
                stopped = self.terminate(reason)
            except Exception:
                stopped, passed = {'stopConfirmed': False, 'privateFixtureGone': False}, False
                reason = 'owned-stop-or-fixture-cleanup-failed'
            write_private(self.state_path, {**self.state(), 'phase': 'ended' if passed else 'failed', 'reason': reason, 'passed': passed, **stopped})
        return {'runId': self.run, 'phase': 'ended' if passed else 'failed', **stopped}

    def watch(self):
        write_private(self.guard_path, {'runId': self.run, 'pid': os.getpid(), 'ticks': process_identity(os.getpid()), 'phase': 'watching'})
        reason = 'stand-timeout'
        low_memory = 0
        while True:
            try:
                state = self.state()
                if state.get('phase') in {'ended', 'failed'}:
                    reason = 'supervisor-completed'
                    break
                if not alive(state.get('supervisorPid'), state.get('supervisorTicks')):
                    # Completion may have been published after the first state read.
                    final_state = self.state()
                    reason = 'supervisor-completed' if final_state.get('phase') in {'ended', 'failed'} else 'supervisor-not-live'
                    break
                if time.monotonic() >= state['deadline']:
                    break
                available = next(int(line.split()[1]) / 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
                low_memory = low_memory + 1 if available < 2048 else 0
                if low_memory >= 2:
                    reason = 'host-memory-reserve-exhausted'
                    break
            except Exception:
                reason = 'guardian-state-or-resource-failed'
                break
            time.sleep(1)
        self.publish_guardian_verdict(reason)
        try:
            stopped = self.terminate(reason)
        except Exception:
            stopped = {'stopConfirmed': False, 'privateFixtureGone': False}
        write_private(self.guard_path, {'runId': self.run, 'pid': os.getpid(), 'ticks': process_identity(os.getpid()), 'phase': 'ended', 'reason': reason, **stopped})
        return {'runId': self.run, 'reason': reason, **stopped}

    def publish_guardian_verdict(self, reason):
        # A published stopping verdict always has a preceding cancellation claim.
        self.request_cancel(reason)
        write_private(self.guard_path, {'runId': self.run, 'pid': os.getpid(), 'ticks': process_identity(os.getpid()), 'phase': 'stopping', 'reason': reason})

    def status(self, include_tls=True):
        state, value = self.state(), self.inspect()
        marker = self.root / 'stop-requested.json'
        cancelled = marker.exists() or marker.is_symlink()
        guardian = private_json(self.guard_path) if self.guard_path.exists() else {}
        active = guardian.get('runId') == self.run and guardian.get('phase') == 'watching' and alive(guardian.get('pid'), guardian.get('ticks'))
        result = {'runId': self.run, 'targetHost': HOST, 'phase': state.get('phase', 'not-started'),
                  'containerId': value['Id'] if value else None, 'containerState': value['status'] if value else 'missing',
                  'imageId': self.plan['imageId'], 'metadataSha256': self.plan['metadataSha256'],
                  'bundleSha256': self.plan['bundleSha256'], 'budget': self.plan['budget'], 'limitsNote': LIMITS_NOTE,
                  'guardianActive': active, 'ready': False, 'cancelRequested': cancelled,
                  'stopConfirmed': bool(state.get('stopConfirmed')) and (not value or value['status'] in INACTIVE),
                  'passed': state.get('passed', False), 'reason': state.get('reason'),
                  'privateFixtureGone': not self.manifest.exists() and not self.manifest.is_symlink()
                      and ('tlsGateway' not in self.plan or all(not path.exists() and not path.is_symlink()
                                                               for path, *_ in self.tls_assets()))}
        if not cancelled and value and value['status'] == 'running' and state.get('phase') == 'running' and active and state.get('assetsVerified'):
            fixture = private_json(self.manifest, 2 * 1024 * 1024) if self.manifest.exists() else None
            if fixture:
                if fixture.get('protocol') != 1 or fixture.get('role') != 'isolated-test-stand' or fixture.get('apiEndpoint') != CLIENT_ORIGIN or fixture.get('bundleSha256') != self.plan['bundleSha256'] or fixture.get('clients') != self.plan['clients'] or fixture.get('seconds') != self.plan['seconds'] or fixture.get('gameProcesses', 4) != self.plan['gameProcesses']:
                    raise Refused('manifest-attestation-failed')
                ports = [fixture.get('serverApiPort'), fixture.get('serverControlPort')]
                if any(type(port) is not int or not 1024 <= port <= 65535 for port in ports) or ports[0] == ports[1]:
                    raise Refused('invalid-loopback-manifest-ports')
                try:
                    if str(uuid.UUID(fixture['runId'])) != fixture['runId']:
                        raise ValueError()
                except (KeyError, ValueError, TypeError, AttributeError):
                    raise Refused('invalid-stand-run-id')
                result.update(ready=True, standRunId=fixture['runId'], serverApiPort=ports[0], serverControlPort=ports[1],
                              manifestSha256=digest(self.manifest, 2 * 1024 * 1024), clients=self.plan['clients'],
                              gameProcesses=self.plan['gameProcesses'], seconds=self.plan['seconds'])
        if include_tls and 'tlsGateway' in self.plan and value:
            result['tlsGateway'] = self.tls_status(probe=False)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'status', 'stop', 'supervise', 'watch', 'tls-start', 'tls-status', 'tls-certificate'])
    parser.add_argument('--plan', type=Path, required=True)
    args = parser.parse_args()
    stand = Stand(load_plan(args.plan), args.plan)
    result = stand.terminate('operator-stop') if args.action == 'stop' else getattr(stand, args.action.replace('-', '_'))()
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, Refused) else 'dedicated-stand-failed'}, separators=(',', ':')))
        raise SystemExit(1)
