"""Narrow location-levels overlay using the reviewed publication and recovery engine."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import types

NAME = 'location-levels-20261030-v1'
ROOT = Path(__file__).resolve().parent
MIN_FREE = 5 * 1024**3
DATABASE_BACKUP_LIMIT = 64 * 1024**2
BASE_HELPER_SHA256 = 'f53c960aabf24983d549def3155da240ca253284bb5451063fe8fbbc90cd5fe2'
SUPPORT = {'overlay-base.py', 'financial_gate.py', 'quiesce-base.cjs', 'quiesce.cjs', 'runtime-inventory.cjs'}


def require(ok, reason):
    if not ok: raise RuntimeError(reason)


def read(path):
    require(not path.is_symlink(), 'JSON symlink rejected')
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def configure(root=ROOT):
    manifest = read(root / 'install-manifest.json')
    require((root / 'overlay-base.py').is_file() and not (root / 'overlay-base.py').is_symlink(), 'Unsafe overlay engine')
    require(sha(root / 'overlay-base.py') == BASE_HELPER_SHA256, 'Reviewed overlay engine changed')
    base = types.ModuleType('location_levels_overlay_base')
    base.__file__ = str(root / 'overlay-base.py')
    exec(compile((root / 'overlay-base.py').read_text(), base.__file__, 'exec'), base.__dict__)
    base.NAME, base.ROOT = NAME, root
    base.BACKUP = Path('/opt/royal-backups') / NAME
    base.BASE = dict(manifest['before']['source'])
    base.sources = lambda state: state['source']
    base.PROGRAM = (root / 'runtime-inventory.cjs').read_text()
    compose_files = manifest['before']['container']['composeFiles'].split(',')
    require(compose_files and all(Path(n).parent == base.LIVE and Path(n).name.startswith('compose')
            and Path(n).suffix == '.yaml' for n in compose_files), 'Unexpected Compose files')
    base.COMPOSE = [Path(n).name for n in compose_files]
    original_settings, original_backup_guard = base.settings, base.backup_guard
    original_existing = base.verify_existing_backup

    def settings(state, recovery=False):
        original_settings(state, recovery=recovery)
        require(state['protectedPrograms'] == manifest['before']['protectedPrograms'], 'Protected service program bytes changed')
        old = manifest['before']['serviceProfiles']
        current = state['serviceProfiles']
        require(set(current) == set(old) or recovery and set(current) == set(old) - {'royal-game-1'},
                'Persistent service profile inventory changed')
        for name, row in current.items():
            require(row['profileSha256'] == old[name]['profileSha256'], 'Service configuration changed: ' + name)
            if name != 'royal-game-1': require(row == old[name], 'Persistent service changed: ' + name)

    def backup_guard(built):
        original_backup_guard(built)
        require(database_backup_guard(base) == built['databaseBackup'], 'Database backup evidence changed')

    def existing_backup():
        original_existing()
        database_backup_guard(base)

    base.settings, base.backup_guard, base.verify_existing_backup = settings, backup_guard, existing_backup
    base.payload = lambda: payload(base)
    base.build = lambda: build(base)
    base.quiet_gate = lambda minimum=None: quiet_gate(base, minimum)
    return base


def payload(base):
    m, old, root = base.M, base.OLD, base.ROOT
    require(root == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(re.fullmatch(r'[a-f0-9]{40}', m['sourceCommit']), 'Invalid reviewed source commit')
    require(sha(root / 'deploy.py') == m['helperSha256'] and sha(root / 'snapshot.py') == m['snapshotSha256'], 'Installer bytes changed')
    require(sha(root / 'scope.json') == m['scopeSha256'], 'Reviewed source scope changed')
    scope = read(root / 'scope.json')
    require(scope['release'] == NAME and scope['base'] == m['baseCommit'] == old['sourceCommit'], 'Wrong production baseline')
    protected = old.get('protectedPrograms', {})
    for service, names in scope['requiredProtectedPrograms'].items():
        require('/' + service in old['services'] and names and set(names).issubset(protected.get(service, {})), 'Missing protected service program facts')
    require(set(m['helpers']) == SUPPORT, 'Unexpected support helper set')
    for name, digest in m['helpers'].items():
        require((root / name).is_file() and not (root / name).is_symlink()
                and base.DIGEST.fullmatch(digest) and sha(root / name) == digest, 'Support helper changed: ' + name)
    require(set(base.CHANGES).issubset(scope['allowedSource']) and set(scope['requiredSource']).issubset(base.CHANGES), 'Foreign or incomplete location-levels source')
    require(set(base.SERVER_DELTA) == {'index.js'}, 'Only the main backend bundle may change')
    require('index.html' in base.DELTA and base.DELTA, 'Missing client index')
    for name in [*base.CHANGES, *base.DELTA, *base.SERVER_DELTA]: base.safe_name(name)
    for digest in [*base.CHANGES.values(), *base.DELTA.values(), *base.SERVER_DELTA.values()]: require(base.DIGEST.fullmatch(digest), 'Invalid release digest')
    for name, digest in base.DELTA.items():
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client resource')
        require(name == 'index.html' or 'dist/' + name not in old['program'] or old['program']['dist/' + name] == digest, 'Immutable asset URL collision')
    require(base.inventory(root / 'source') == base.CHANGES and base.inventory(root / 'dist-delta') == base.DELTA
            and base.inventory(root / 'server-delta') == base.SERVER_DELTA, 'Payload inventory differs')
    require(sha(root / 'release-manifest.json') == m['releaseManifestSha256'] and sha(root / 'release-github.json') == m['receiptSha256'], 'Verified release receipt changed')
    release, receipt = read(root / 'release-manifest.json'), read(root / 'release-github.json')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit'] and release['baseCommit'] == m['baseCommit'], 'Wrong release commit or receipt')
    require(release['scope'] == 'application' and release['build']['passed'], 'Application verification did not pass')
    for name, digest in base.DELTA.items(): require(release['files'].get('dist/' + name) == digest, 'Client is not the verified application artifact')
    require(release['files'].get('dist-server/index.js') == base.SERVER_DELTA['index.js'], 'Backend is not the verified application artifact')
    require(sha(root / 'backend-projection-report.json') == m['backendProjectionSha256'], 'Backend projection evidence changed')
    projection = read(root / 'backend-projection-report.json')
    require(projection == release.get('backendProjection') == release['build'].get('backendProjection'), 'Backend projection is not bound to the release')
    require(projection['productionCommit'] == m['baseCommit'] and projection['output']['path'] == 'dist-server/index.js'
            and projection['output']['sha256'] == base.SERVER_DELTA['index.js'], 'Backend projection baseline or output differs')
    require(projection['entries'] == ['server/index.ts'] and projection['config'] == 'deployment/releases/' + NAME + '/backend-projection.json'
            and sha(root / 'backend-projection.json') == projection['sha256'], 'Backend projection configuration changed')
    require(projection.get('inputs'), 'Missing reviewed backend input evidence')
    require(set(projection['inputs']) == set(projection['origins']), 'Backend input provenance is incomplete')
    for name, digest in projection['inputs'].items():
        base.safe_name(name)
        require(projection['origins'][name]['sha256'] == digest, 'Backend input origin differs: ' + name)
        expected = [base.CHANGES[name]] if name in base.CHANGES else [old['source'].get(name), old['sourceLF'].get(name)]
        require(digest in expected, 'Backend input differs from installed source facts: ' + name)
    require(old['program'] == old['preparedProgram'], 'Prepared and running baseline inventories differ')
    for flag in ['hostContractVersionsUnchanged', 'bundledAndExternalModulesRetained', 'dependencyLockEquivalent']:
        require(m['compatibility'].get(flag) is True, 'Missing compatibility evidence: ' + flag)


def database_backup_guard(base):
    proof = read(base.BACKUP / 'database-backup.json')
    file = base.BACKUP / 'game-wallet.dump'
    require(not file.is_symlink() and proof['schema'] == 'royal_game' and proof['format'] == 'custom'
            and proof['tocEntries'] > 10 and 1000 < file.stat().st_size <= DATABASE_BACKUP_LIMIT
            and file.stat().st_size == proof['bytes'] and sha(file) == proof['sha256'], 'Database backup differs')
    return proof


def backup_database(base):
    file = base.BACKUP / 'game-wallet.dump'
    command = ['docker', 'exec', 'royal-finance-sim-finance-db-1', 'sh', '-ec',
        'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_game']
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    try:
        with file.open('xb') as output:
            while chunk := process.stdout.read(65536):
                require(output.tell() + len(chunk) <= DATABASE_BACKUP_LIMIT, 'Database backup exceeds its bounded budget')
                output.write(chunk)
            require(process.wait() == 0, 'Database backup failed')
    except BaseException:
        if process.poll() is None: process.kill()
        process.wait(); file.unlink(missing_ok=True)
        raise
    finally: process.stdout.close()
    file.chmod(0o600)
    with file.open('rb') as source:
        listing = base.run(['docker', 'exec', '-i', 'royal-finance-sim-finance-db-1', 'pg_restore', '--list'], stdin=source)
    proof = {'schema': 'royal_game', 'format': 'custom', 'tocEntries': sum(bool(line) and not line.startswith(';') for line in listing.splitlines()),
             'bytes': file.stat().st_size, 'sha256': sha(file)}
    (base.BACKUP / 'database-backup.json').write_text(json.dumps(proof) + '\n')
    (base.BACKUP / 'database-backup.json').chmod(0o600)
    return database_backup_guard(base)


def dockerfile(base):
    return ('FROM royal-game:before-' + NAME + '-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\n'
        'COPY --chown=node:node server-delta/ /app/dist-server/\nLABEL org.opencontainers.image.revision="' + base.M['sourceCommit'] + '"\n')


def build(base):
    base.payload(); old = base.baseline()
    size = sum((base.ROOT / folder / name).stat().st_size for folder, rows in [('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)] for name in rows)
    reserve = MIN_FREE + size * 3 + 8 * 1024**2
    require(old['availableBytes'] > reserve + DATABASE_BACKUP_LIMIT, 'Five GiB and bounded backup reserve would be crossed')
    if base.BACKUP.exists(): base.verify_existing_backup()
    else:
        base.BACKUP.mkdir(mode=0o700)
        backup_database(base)
        base.backup_sources(old['availableBytes'] - reserve - DATABASE_BACKUP_LIMIT)
        base.verify_tar(base.BACKUP / 'source.tgz')
        base.run(['docker', 'cp', 'royal-game-1:/app/dist/index.html', str(base.BACKUP / 'index.html')])
        require(sha(base.BACKUP / 'index.html') == old['program']['dist/index.html'], 'Index backup differs')
        for suffix, ref in [('', old['container']['image']), ('-prepared', old['preparedImage'])]: base.run(['docker', 'tag', ref, 'royal-game:before-' + NAME + suffix])
    context = base.ROOT / 'runtime-context'; context.mkdir()
    for folder in ['dist-delta', 'server-delta']: shutil.copytree(base.ROOT / folder, context / folder, copy_function=os.link)
    (context / 'Dockerfile').write_text(dockerfile(base))
    (context / '.dockerignore').write_text('**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n!server-delta\n!server-delta/index.js\n')
    base.baseline()
    require(shutil.disk_usage(base.LIVE).free > reserve, 'Disk reserve consumed before image build')
    with (base.ROOT / 'build.log').open('x') as output:
        subprocess.run(['docker', 'build', '--pull=false', '--network=none', '-t', 'royal-game:' + NAME, '.'], cwd=context,
            env={**os.environ, 'DOCKER_BUILDKIT': '0'}, check=True, stdout=output, stderr=subprocess.STDOUT)
    require(shutil.disk_usage(base.LIVE).free > MIN_FREE, 'Image build crossed the disk reserve')
    candidate = base.image('royal-game:' + NAME)
    actual = json.loads(base.run(['docker', 'run', '--rm', '--network=none', '--read-only', '--cpus=.35', '--memory=256m',
                                 '--entrypoint', 'node', candidate, '--v8-pool-size=1', '-e', base.PROGRAM]))
    require(actual == base.expected_program(), 'Candidate changed a protected runtime byte')
    parent, child = json.loads(base.run(['docker', 'image', 'inspect', old['preparedImage'], candidate]))
    require(child['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == base.M['sourceCommit'], 'Candidate revision differs')
    for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image settings changed: ' + key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'], 'Parent image layers changed')
    base.baseline()
    result = {'image': candidate, 'program': base.expected_program(), 'sourceCommit': base.M['sourceCommit'],
        'sourceBackupSha256': sha(base.BACKUP / 'source.tgz'), 'databaseBackup': database_backup_guard(base), 'backup': str(base.BACKUP)}
    base.write('build-result.json', result)
    return {'built': True, 'image': candidate, 'clientDeltaFiles': len(base.DELTA), 'backendDeltaFiles': 1, 'unrelatedRuntimePreserved': True}


def gate_program(base):
    source = (base.ROOT / 'quiesce-base.cjs').read_text()
    return ('const reviewedLease={exports:{},parent:{}};\n(function(module,exports){\n' + source +
            '\n})(reviewedLease,reviewedLease.exports);\nglobalThis.ROYAL_LOCATION_GATE_BASE=reviewedLease.exports;\n' +
            (base.ROOT / 'quiesce.cjs').read_text())


def quiet_gate(base, minimum=None):
    from financial_gate import FinancialGate
    command = ['docker', 'compose', *[value for name in base.COMPOSE for value in ['-f', name]],
        'run', '--rm', '--no-deps', '-T', '--entrypoint', 'node', 'game', '-e', gate_program(base)]
    gate = FinancialGate(command, cwd=base.LIVE, log_path=base.ROOT / 'financial-gate.log',
        min_free_bytes=base.publication_min_free() if minimum is None else minimum, disk_paths=(base.LIVE, base.ROOT, base.BACKUP))
    try: gate.acquire(); return gate
    except BaseException: gate.close(); raise


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME, 'Unexpected installer root')
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'release', 'rollback'], 'Unexpected installer operation')
    base = configure(); base.payload()
    handles = []
    for path in [Path('/opt/royal-releases/themed-publish.lock'), base.LIVE / '.client-presentation-deploy.lock', base.STATE / 'module.lock']:
        require(not path.is_symlink() and not any(p.is_symlink() for p in path.parents), 'Unsafe publication lock')
        handle = path.open('a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); handles.append(handle)
    def interrupted(number, _frame): raise InterruptedError('Publication interrupted: ' + str(number))
    for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
    if sys.argv[1] == 'check': base.baseline(); result = {'ready': True, 'sourceFiles': len(base.CHANGES), 'backendFiles': 1}
    elif sys.argv[1] == 'release': print(json.dumps(base.build()), flush=True); result = base.publish()
    else: result = getattr(base, sys.argv[1])()
    print(json.dumps(result), flush=True)


if __name__ == '__main__': main()
