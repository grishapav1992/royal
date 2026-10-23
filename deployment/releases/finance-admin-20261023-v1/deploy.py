"""Publish the owner dashboard without rebuilding or replacing the game client."""
from contextlib import ExitStack
from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from snapshot import snapshot, inspect, profile, sha, sources, PROGRAM

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
FINANCE = Path('/opt/royal-finance')
NAME = 'finance-admin-20261023-v1'
BACKUP = Path('/opt/royal-backups') / NAME
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
SERVICES = {'game': 'royal-game-1', 'payments': 'royal-payments-1', 'nile': 'royal-nile-play'}
TAGS = {'game': 'royal-game:latest', 'payments': 'royal-payments:latest', 'nile': 'royal-nile-play:local'}


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def atomic(source, target):
    target = Path(target)
    assert target.resolve().is_relative_to(LIVE) or target.resolve().is_relative_to(FINANCE)
    assert not target.is_symlink()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.finance-admin-partial')
    assert not temporary.exists()
    shutil.copyfile(source, temporary)
    os.replace(temporary, target)


def payload():
    for name, digest in M['payload'].items():
        path = ROOT / name
        assert path.resolve().is_relative_to(ROOT) and not path.is_symlink() and sha(path) == digest, name


def guard():
    assert sources(LIVE) == OLD['source'], 'Published source changed; take another snapshot'
    assert sources(FINANCE) == OLD['financeSource'], 'Financial source changed; take another snapshot'
    assert OLD['program'] == OLD['preparedProgram'], 'Prepared image does not preserve the active client'
    assert json.loads(run(['docker', 'exec', SERVICES['game'], 'node', '-e', PROGRAM])) == OLD['program']
    for name, row in OLD['containers'].items():
        current = inspect(name)
        assert current['Id'] == row['id'] and current['Image'] == row['image'], 'Service changed: ' + name
    for name, digest in OLD['configuration'].items():
        assert sha(name) == digest, 'Configuration changed: ' + name
    assert {str(p): sha(p) for p in Path('/opt/royal-game-modules').rglob('*') if p.is_file() and not p.is_symlink()} == OLD['modules']
    assert sha('/opt/royal-game-modules-state/host.json') == OLD['hostContract']


def backup():
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    for root, key, filename in [(LIVE, 'source', 'source.tgz'), (FINANCE, 'financeSource', 'finance-source.tgz')]:
        with tarfile.open(BACKUP / filename, 'w:gz') as archive:
            for name, row in OLD[key].items():
                assert sha(root / name) == row['sha256']
                archive.add(root / name, arcname=name, recursive=False)
        with tarfile.open(BACKUP / filename) as archive:
            assert {p.name: hashlib.sha256(archive.extractfile(p).read()).hexdigest() for p in archive if p.isfile()} == {n: r['sha256'] for n, r in OLD[key].items()}
    for name in OLD['configuration']:
        target = BACKUP / 'configuration' / name.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(name, target)
    for component, container in SERVICES.items():
        run(['docker', 'tag', OLD['containers'][container]['image'], TAGS[component].split(':')[0] + ':before-' + NAME])
    run(['docker', 'tag', OLD['preparedImage'], 'royal-game:before-' + NAME + '-prepared'])
    command = ['docker', 'exec', 'royal-finance-sim-finance-db-1', 'sh', '-ec',
        'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_game --schema=royal_payments --schema=royal_nile_play']
    with (BACKUP / 'financial-schemas.dump').open('wb') as output:
        subprocess.run(command, stdout=output, check=True)
    os.chmod(BACKUP / 'financial-schemas.dump', 0o600)
    return {name: sha(BACKUP / name) for name in ['source.tgz', 'finance-source.tgz', 'financial-schemas.dump']}


def build():
    payload()
    guard()
    backups = backup()
    results = {}
    for component, file in [('game', 'index.js'), ('payments', 'payments.js'), ('nile', 'play.js')]:
        directory = ROOT / ('build-' + component)
        directory.mkdir(exist_ok=False)
        base = OLD['preparedImage'] if component == 'game' else OLD['containers'][SERVICES[component]]['image']
        target = '/app/dist-server/' + file if component != 'nile' else '/app/play.js'
        shutil.copyfile(ROOT / 'runtime' / file, directory / file)
        dockerfile = 'FROM ' + base + '\nCOPY --chown=node:node ' + file + ' ' + target + '\n'
        if component == 'game':
            shutil.copytree(ROOT / 'admin', directory / 'admin')
            dockerfile += 'COPY --chown=node:node admin/ /app/dist/\n'
        dockerfile += 'RUN node --check ' + target + '\n'
        (directory / 'Dockerfile').write_text(dockerfile)
        tag = TAGS[component].split(':')[0] + ':' + NAME
        with (ROOT / (component + '-build.log')).open('w') as log:
            subprocess.run(['docker', 'build', '--network=none', '-t', tag, str(directory)], stdout=log, stderr=subprocess.STDOUT, check=True)
        results[component] = run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])
    save('build-result.json', {'images': results, 'backups': backups})
    print(json.dumps({'built': results, 'backupsVerified': True}))


def configure():
    envfile = LIVE / '.env'
    rows = envfile.read_text().splitlines()
    current = [v.split('=', 1)[1] for v in rows if v.startswith('FINANCE_ADMIN_ACCOUNT_IDS=')]
    assert not current or current == [''] or current == [M['ownerId']], 'Unexpected existing administrators'
    rows = [v for v in rows if not v.startswith('FINANCE_ADMIN_ACCOUNT_IDS=')]
    rows.append('FINANCE_ADMIN_ACCOUNT_IDS=' + M['ownerId'])
    game_files = OLD['containers'][SERVICES['game']]['composeFiles'] + [str(LIVE / 'compose.finance-admin.yaml')]
    rows = [v for v in rows if not v.startswith('COMPOSE_FILE=')]
    rows.append('COMPOSE_FILE=' + ':'.join(game_files))
    temporary = ROOT / 'production-env-private'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write('\n'.join(rows) + '\n')
    # This server-only temporary file never enters source archives or the release payload.
    os.replace(temporary, envfile)
    atomic(ROOT / 'compose.finance-admin.yaml', LIVE / 'compose.finance-admin.yaml')
    atomic(ROOT / 'compose.admin.yaml', FINANCE / 'deployment/finance/compose.admin.yaml')
    return game_files


def compose(component, game_files):
    files = game_files if component != 'nile' else OLD['containers'][SERVICES['nile']]['composeFiles'] + [str(FINANCE / 'deployment/finance/compose.admin.yaml')]
    return ['docker', 'compose', '--env-file', str(LIVE / '.env'), *[v for name in files for v in ['-f', name]]]


def install():
    payload()
    guard()
    built = json.loads((ROOT / 'build-result.json').read_text())['images']
    for folder, target in [('source', LIVE), ('finance-source', FINANCE)]:
        for path in (ROOT / folder).rglob('*'):
            if path.is_file():
                atomic(path, target / path.relative_to(ROOT / folder))
    files = configure()
    for component in ['payments', 'nile', 'game']:
        run(['docker', 'tag', built[component], TAGS[component]])
        service = 'nile-play' if component == 'nile' else component
        with (ROOT / (component + '-install.log')).open('w') as log:
            subprocess.run(compose(component, files) + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', service],
                           cwd=LIVE if component != 'nile' else FINANCE, stdout=log, stderr=subprocess.STDOUT, check=True)
        deadline = time.monotonic() + (600 if component == 'nile' else 180)
        while time.monotonic() < deadline:
            row = inspect(SERVICES[component])
            health = row['State'].get('Health', {}).get('Status')
            if health == 'healthy':
                break
            assert row['State']['Running'], 'Service exited: ' + component
            time.sleep(3)
        else:
            raise RuntimeError('Service did not become healthy: ' + component)
        current = inspect(SERVICES[component])
        assert profile(current, True) == OLD['containers'][SERVICES[component]]['stableProfile'], 'Runtime settings changed: ' + component
    save('installed.json', {'images': built, 'sourceCommit': M['sourceCommit'], 'ownerId': M['ownerId'], 'at': time.time()})
    verify()


def verify():
    built = json.loads((ROOT / 'build-result.json').read_text())['images']
    for component, name in SERVICES.items():
        row = inspect(name)
        assert row['Image'] == built[component] and row['State']['Health']['Status'] == 'healthy'
        assert profile(row, True) == OLD['containers'][name]['stableProfile']
        values = [v for v in row['Config']['Env'] if v.startswith('FINANCE_ADMIN_ACCOUNT_IDS=')]
        assert values == ['FINANCE_ADMIN_ACCOUNT_IDS=' + M['ownerId']]
    for name, row in OLD['containers'].items():
        if name not in SERVICES.values():
            assert inspect(name)['Id'] == row['id'], 'Unrelated service restarted: ' + name
    for root, folder in [(LIVE, 'source'), (FINANCE, 'finance-source')]:
        for path in (ROOT / folder).rglob('*'):
            if path.is_file():
                assert sha(root / path.relative_to(ROOT / folder)) == sha(path)
    programs = json.loads(run(['docker', 'exec', SERVICES['game'], 'node', '-e', PROGRAM]))
    for name, digest in OLD['program'].items():
        if name != 'dist-server/index.js':
            assert programs[name] == digest, 'Existing program or asset changed: ' + name
    assert {str(p): sha(p) for p in Path('/opt/royal-game-modules').rglob('*') if p.is_file() and not p.is_symlink()} == OLD['modules']
    assert sha('/opt/royal-game-modules-state/host.json') == OLD['hostContract']
    probe = "Promise.all(['/healthz','/admin','/api/admin/session'].map(async p=>{const r=await fetch('http://127.0.0.1:2567'+p);return[p,r.status]})).then(r=>{console.log(JSON.stringify(r));process.exit(r[0][1]===200&&r[1][1]===200&&r[2][1]===401?0:1)})"
    status = json.loads(run(['docker', 'exec', SERVICES['game'], 'node', '-e', probe]))
    save('verification.json', {'sourceCommit': M['sourceCommit'], 'images': built, 'health': 'healthy', 'http': status,
                              'existingAssetsPreserved': True, 'modulePointersPreserved': True, 'otherServicesPreserved': True,
                              'ownerConfigured': True, 'databaseRestored': False, 'at': time.time()})
    print(json.dumps({'verified': True, 'http': status, 'images': built}))


if __name__ == '__main__':
    assert len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'install', 'verify', 'publish']
    with ExitStack() as stack:
        for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
            assert not Path(name).is_symlink()
            lock = stack.enter_context(open(name, 'a+'))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            if sys.argv[1] == 'check':
                payload()
                guard()
                print('Reviewed source, services, configuration and client assets match')
            elif sys.argv[1] == 'publish':
                build()
                install()
            else:
                globals()[sys.argv[1]]()
        except BaseException as error:
            save('failure.json', {'phase': sys.argv[1], 'type': type(error).__name__, 'reason': str(error)})
            raise
