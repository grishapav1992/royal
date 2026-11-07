#!/usr/bin/env python3
"""Retire only the standalone Nile test services and superseded SQLite snapshots."""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess


STATE = Path('/opt/royal-finance-state')
ARCHIVE = STATE / 'nile-retired'
LOCKS = (
    Path('/opt/royal-releases/themed-publish.lock'),
    Path('/opt/royal/.client-presentation-deploy.lock'),
    Path('/opt/royal-game-modules-state/module.lock'),
)
TIMERS = ('royal-nile-account-views.timer', 'royal-nile-reconcile.timer')
CONTAINERS = {
    'royal-nile-account-views-once': 'royal-nile-account-views',
    'royal-nile-reconcile-once': 'royal-nile-reconcile',
    'royal-nile-play': 'royal-nile-play',
    'royal-nile-creditor': 'royal-nile-creditor',
    'royal-tron-reader': 'royal-tron-reader',
}
MARKERS = (
    'nile-account-views-required.json', 'nile-reconciliation-required.json',
    'nile-play-required.json', 'nile-creditor-required.json', 'tron-reader-required.json',
)
BACKUPS = {
    'tron-reader': r'nile-\d{8}T\d{9}Z-[a-f0-9]{8}\.sqlite',
    'nile-test': r'nile-credit-\d{8}T\d{9}Z-[a-f0-9]{8}\.sqlite',
    'nile-play': r'nile-play-\d{8}T\d{9}Z\.sqlite',
}
DB = 'royal-finance-sim-finance-db-1'
PROTECTED = ('royal-game-1', 'royal-payments-1', 'royal-caddy-1', DB)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args, timeout=35):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, f'{args[0]} {args[1]} failed ({result.returncode})')
    return result.stdout.strip()


def identity(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, f'Unsafe file: {path}')
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_blocks


def backup_plan(verify):
    retained = []
    obsolete = {}
    for kind, pattern in BACKUPS.items():
        root = Path(f'/opt/royal-{kind}-data/backups')
        require(root.is_dir() and root.resolve() == root, f'Unsafe backup directory: {root}')
        names = sorted(path.name for path in root.iterdir())
        complete = [name for name in names if re.fullmatch(pattern, name) and name + '.json' in names]
        require(complete, f'Missing complete backup: {kind}')
        latest = root / complete[-1]
        manifest = latest.with_suffix('.sqlite.json')
        original = {path: identity(path) for path in (latest, manifest)}
        metadata = json.loads(manifest.read_text())
        require(metadata['file'] == latest.name and (metadata.get('ok') is True or
                metadata.get('audit', {}).get('ok') is True), f'Invalid backup receipt: {kind}')
        require(re.fullmatch(r'[a-f0-9]{64}', metadata.get('sha256', '')), f'Missing backup hash: {kind}')
        if verify:
            with latest.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            require(digest == metadata['sha256'], f'Backup checksum differs: {kind}')
            with contextlib.closing(sqlite3.connect(latest.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
                require(db.execute('PRAGMA quick_check').fetchall() == [('ok',)], f'Invalid SQLite backup: {kind}')
            require(all(identity(path) == value for path, value in original.items()), f'Backup changed: {kind}')
        retained.append({'kind': kind, 'file': latest.name, 'sha256': metadata['sha256']})
        for name in names:
            if name in (latest.name, manifest.name):
                continue
            if re.fullmatch(pattern + r'(?:\.json|\.partial)?', name):
                obsolete[root / name] = identity(root / name)
    return retained, obsolete


def container_inventory():
    names = set(run('docker', 'ps', '-a', '--format', '{{.Names}}').splitlines())
    selected = sorted(names.intersection(CONTAINERS).union(PROTECTED))
    result = {row['Name'].lstrip('/'): row for row in
              json.loads(run('docker', 'inspect', '--type', 'container', *selected))}
    for name in PROTECTED:
        require(result[name]['State']['Running'], f'Protected service is down: {name}')
    for name in names.intersection(CONTAINERS):
        row = result[name]
        config = row['Config']
        require(config['Labels'].get('com.docker.compose.project') == CONTAINERS[name],
                f'Unexpected Compose project: {name}')
        env = config.get('Env', [])
        require(any(value in env for value in ('NILE_TEST_NETWORK=nile', 'TRON_READER_NETWORK=nile')),
                f'Container is outside the Nile test network: {name}')
    return result


def stop_container(name, expected):
    lookup = ('docker', 'ps', '-a', '--filter', f'name=^/{name}$', '--format', '{{.ID}}', '--no-trunc')
    container = run(*lookup)
    if not container:
        return False
    require(expected and container == expected['Id'], f'Container changed: {name}')
    try:
        if run('docker', 'inspect', '--type', 'container', '--format', '{{.State.Running}}', container) == 'true':
            run('docker', 'stop', '-t', '15', container)
        run('docker', 'rm', container)
    except RuntimeError:
        # Compose run --rm may remove a one-shot container as its service stops.
        if run(*lookup):
            raise
    return True


def quiescent_ledger():
    sql = """BEGIN READ ONLY;
    SELECT (SELECT count(*) FROM royal_nile_play.demo_casino_sessions)
         + (SELECT count(*) FROM royal_nile_play.demo_flight_sessions)
         + (SELECT count(*) FROM royal_nile_play.demo_mines_sessions)
         + (SELECT count(*) FROM royal_nile_play.pvp_matches WHERE status <> 'finished')
         + (SELECT count(*) FROM royal_nile_play.capro_pending_balances)
         + (SELECT count(*) FROM royal_nile_play.capro_pending_ledger)
         + abs((SELECT count(*) FROM royal_nile_deposits.credits)
             - (SELECT count(*) FROM royal_nile_play.events WHERE kind = 'funding'));
    COMMIT;"""
    count = run('docker', 'exec', '-e', 'PGOPTIONS=-c statement_timeout=7000', DB,
                'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'finance_schema_owner',
                '-d', 'royal_finance_sim', '-c', sql)
    require(count == '0', 'The historical Nile ledger has unfinished work')


def free():
    return shutil.disk_usage('/opt').free


def retire(retained, obsolete):
    with contextlib.ExitStack() as stack:
        for path in LOCKS:
            require(path.parent.is_dir() and not path.is_symlink(), f'Unsafe publication lock: {path}')
            lock = stack.enter_context(path.open('a'))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        initial = container_inventory()
        quiescent_ledger()
        before = free()
        run('systemctl', 'disable', '--now', *TIMERS)
        run('systemctl', 'stop', *(timer.removesuffix('.timer') + '.service' for timer in TIMERS))
        stopped = [name for name in CONTAINERS if stop_container(name, initial.get(name))]
        remaining = container_inventory()
        require(not remaining.keys() & CONTAINERS.keys(), 'A standalone Nile container remains')
        require(all(remaining[name]['Id'] == initial[name]['Id'] for name in PROTECTED),
                'A protected service changed during retirement')
        quiescent_ledger()
        ARCHIVE.mkdir(mode=0o700, exist_ok=True)
        require(ARCHIVE.resolve() == ARCHIVE and ARCHIVE.stat().st_uid == 0 and
                not ARCHIVE.stat().st_mode & 0o077, 'Unsafe retirement record directory')
        for name in MARKERS:
            path = STATE / name
            if path.exists():
                identity(path)
                require(json.loads(path.read_text()).get('network') == 'nile', f'Unexpected marker: {name}')
                require(not (ARCHIVE / name).exists(), f'Marker already archived: {name}')
                path.rename(ARCHIVE / name)
        for timer in TIMERS:
            for name in (timer, timer.removesuffix('.timer') + '.service'):
                path = Path('/etc/systemd/system') / name
                if path.exists():
                    identity(path)
                    require(not (ARCHIVE / name).exists(), f'Unit already archived: {name}')
                    path.rename(ARCHIVE / name)
        run('systemctl', 'daemon-reload')
        require(all(identity(path) == value for path, value in obsolete.items()), 'Backup inventory changed')
        for path in obsolete:
            path.unlink()
        report = {'removed_containers': stopped, 'retained_snapshots': retained,
                  'removed_files': len(obsolete), 'removed_allocated_bytes': sum(s[4] * 512 for s in obsolete.values()),
                  'free_before_bytes': before, 'free_after_bytes': free()}
        record = ARCHIVE / 'result.json'
        with record.open('x') as output:
            json.dump(report, output, indent=2)
            output.write('\n')
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'retire'))
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run as the deployment operator')
    require(not (ARCHIVE / 'result.json').exists(), 'Retirement already recorded')
    os.umask(0o077)
    retained, obsolete = backup_plan(verify=True)
    if args.action == 'check':
        inventory = container_inventory()
        quiescent_ledger()
        report = {'containers': sorted(inventory.keys() & CONTAINERS.keys()),
                  'retained_snapshots': retained, 'obsolete_files': len(obsolete),
                  'obsolete_allocated_bytes': sum(s[4] * 512 for s in obsolete.values())}
    else:
        report = retire(retained, obsolete)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
