"""Publish two reviewed clients while the caller holds all three release locks."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent
NAME = 'mk-security-only-20261026-v1' if ROOT.name == 'mk-security-only-20261026-v1' else 'mk-security-20261026-v1'
EXPECTED_ROOT = Path('/opt/royal-releases') / NAME
LIVE = Path('/opt/royal')
STATE = Path('/opt/royal-game-modules-state')
MODULES = Path('/opt/royal-game-modules')
BACKUP = Path('/opt/royal-backups') / NAME
GAMES = ('mortal-kombat', 'studio-cosmic-escape')
CONTRACT = {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 1}
DIGEST = re.compile(r'[a-f0-9]{64}')
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}')
RECORD = 'joint-module-backup.json'
HOST_BACKUP = 'joint-module-host.json'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def regular(path, directory=False):
    require(not any(value.is_symlink() for value in [path, *path.parents]), 'Symlink rejected: ' + str(path))
    require(path.is_dir() if directory else path.is_file(), 'Missing regular path: ' + str(path))
    return path


def inventory(root):
    regular(root, directory=True)
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Module symlink rejected')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = sha(path)
        else:
            require(path.is_dir(), 'Nonregular module path rejected')
    return result


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_bytes(path, content, mode=0o600):
    regular(path.parent, directory=True)
    require(not path.is_symlink(), 'Atomic target symlink rejected')
    temporary = path.with_name('.joint-module-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as output:
            output.write(content)
            os.fchmod(output.fileno(), mode)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    return json.loads(regular(path).read_text())


def write(name, value):
    atomic_bytes(ROOT / name, encoded(value))


def pointer_path(game):
    return MODULES / game / 'active.json'


def pointer_backup(game):
    return BACKUP / ('joint-' + game + '-active.json')


def pointer_hash(path):
    require(not path.is_symlink(), 'Pointer symlink rejected')
    return sha(regular(path)) if path.exists() else 'none'


def installed_sha(ctx, game):
    row = next(value for value in ctx['rows'] if value['gameId'] == game)
    relative = game + '/versions/' + row['version'] + '/manifest.json'
    value = {'format': 1, 'gameId': game, 'manifest': '/game-modules/' + relative,
             'sha256': ctx['manifest']['moduleDelta'][relative]}
    return hashlib.sha256(encoded(value)).hexdigest()


def load_context():
    manifest = read_json(ROOT / 'install-manifest.json')
    require(ROOT == EXPECTED_ROOT and manifest['release'] == NAME, 'Unexpected module release path')
    require(isinstance(manifest['sourceCommit'], str) and re.fullmatch(r'[a-f0-9]{40}', manifest['sourceCommit']),
            'Missing reviewed source commit')
    for name in ['modules.py', 'deploy.py', 'snapshot.py']:
        require(sha(regular(ROOT / name)) == manifest['helpers'][name], 'Release helper changed: ' + name)
    before = manifest['before']
    require(sha(regular(STATE / 'host.json')) == before['moduleHostContract'], 'Installed host contract changed')
    require(read_json(STATE / 'host.json') == before['moduleHost'], 'Installed host contract content differs')
    rows = manifest.get('modulePackages')
    require(isinstance(rows, list) and 1 <= len(rows) <= 2 and all(isinstance(row, dict) for row in rows),
            'One or two reviewed module packages are required')
    scope = manifest.get('moduleScope', 'joint')
    require(scope in ['joint','combat-only'], 'Unknown module release scope')
    require(NAME != 'mk-security-only-20261026-v1' or scope == 'combat-only', 'The isolated release requires combat-only scope')
    games = {'mortal-kombat'} if scope == 'combat-only' else set(GAMES)
    require(len(rows) == len(games) and {row.get('gameId') for row in rows} == games, 'Unexpected module package identities')
    rows = sorted(rows, key=lambda row: GAMES.index(row['gameId']))
    for row in rows:
        require(set(row) == {'gameId', 'version', 'beforeSha256'} and isinstance(row['version'], str)
                and VERSION.fullmatch(row['version']), 'Invalid module package identity')
        old = before['moduleFiles'].get(str(pointer_path(row['gameId'])), 'none')
        require(row['beforeSha256'] == old and (old == 'none' or isinstance(old, str) and DIGEST.fullmatch(old)),
                'Pointer baseline differs from production snapshot')
        require(before['moduleHost']['games'].get(row['gameId']) == CONTRACT, 'Module contract must remain 1/2/1')
    delta = manifest.get('moduleDelta')
    require(isinstance(delta, dict) and delta, 'Missing module payload inventory')
    prefixes = {row['gameId'] + '/versions/' + row['version'] + '/' for row in rows}
    for name, digest in delta.items():
        require(isinstance(name, str), 'Invalid module payload path')
        path = PurePosixPath(name)
        require(str(path) == name and not path.is_absolute() and all(part not in ['.', '..'] for part in path.parts)
                and any(name.startswith(prefix) for prefix in prefixes), 'Only reviewed module versions may be published')
        require(isinstance(digest, str) and DIGEST.fullmatch(digest), 'Invalid module digest')
        old = before['moduleFiles'].get(str(MODULES / name))
        require(old is None or old == digest, 'Immutable module URL would change')
    require(inventory(ROOT / 'modules') == delta, 'Module payload inventory differs')
    installer_path = regular(LIVE / 'scripts/game-module-release.py')
    require(sha(installer_path) == manifest['moduleInstallerSha256'], 'Installed module installer changed')
    spec = importlib.util.spec_from_file_location('joint_reviewed_module_installer', installer_path)
    installer = importlib.util.module_from_spec(spec)
    exec(compile(installer_path.read_bytes(), str(installer_path), 'exec'), installer.__dict__)
    metadatas = {}
    for row in rows:
        game, version = row['gameId'], row['version']
        prefix = game + '/versions/' + version + '/'
        metadata, _size = installer.verify(ROOT / 'modules' / game / 'versions' / version, CONTRACT, game)
        require(metadata['version'] == version, 'Module manifest version differs')
        require({name for name in delta if name.startswith(prefix)} == {prefix + name for name in ['manifest.json', *metadata['files']]},
                'Module package differs from its manifest')
        metadatas[game] = metadata
    total = sum((ROOT / 'modules' / name).stat().st_size for name in delta)
    return {'manifest': manifest, 'before': before, 'rows': rows, 'installer': installer,
            'metadatas': metadatas, 'total': total}


def validate_payload():
    ctx = load_context()
    return {'verified': True, 'games': [row['gameId'] for row in ctx['rows']],
            'files': len(ctx['manifest']['moduleDelta']), 'bytes': ctx['total']}


def module_guard(ctx, current=None, original_pointers=False):
    manifest, before = ctx['manifest'], ctx['before']
    actual = {str(MODULES / name): digest for name, digest in inventory(MODULES).items()}
    if current is not None:
        require(current['moduleFiles'] == actual, 'Snapshot and module files differ')
    approved = {str(MODULES / name): digest for name, digest in manifest['moduleDelta'].items()}
    expected = {**before['moduleFiles'], **{name: digest for name, digest in approved.items() if name in actual}}
    for row in ctx['rows']:
        game, old = row['gameId'], row['beforeSha256']
        pointer = str(pointer_path(game))
        observed = actual.get(pointer, 'none')
        if observed != old:
            prefix = str(MODULES / game / 'versions' / row['version']) + '/'
            require(not original_pointers and observed == installed_sha(ctx, game)
                    and all(actual.get(name) == digest for name, digest in approved.items() if name.startswith(prefix)),
                    'Later or incomplete module pointer prevents recovery')
            expected[pointer] = observed
    require(actual == expected, 'Unrelated module or immutable bytes changed')
    require(sha(regular(STATE / 'host.json')) == before['moduleHostContract'], 'Installed host contract changed')
    return actual


def application_guard(ctx, current=None):
    from deploy import snapshot, settings, sources, expected_program
    manifest, before = ctx['manifest'], ctx['before']
    current = snapshot() if current is None else current
    settings(current, owned_modules=True)
    built, published, after = [read_json(ROOT / name) for name in ['build-result.json', 'published.json', 'after.json']]
    require(built['sourceCommit'] == published['sourceCommit'] == manifest['sourceCommit']
            and published.get('published') is True, 'Application release source differs')
    require(built['program'] == expected_program() and published['runningImage'] == published['preparedImage'] == built['image'],
            'Published application build differs')
    for state in [after, current]:
        settings(state, owned_modules=True)
        require(sources(state) == {**sources(before), **manifest['changed']}, 'Application source changed')
        require(state['sourceRevision'] == manifest['sourceCommit'] and state['container'] is not None
                and state['container']['health'] == 'healthy'
                and state['container']['image'] == state['preparedImage'] == built['image'], 'Application image or health changed')
        require(state['program'] == state['preparedProgram'] == built['program'], 'Application runtime changed')
    require(current['container'] == after['container'] and current['services'] == after['services'],
            'Running application changed since publication')
    require(after['moduleFiles'] == before['moduleFiles'], 'Application publication changed modules')
    module_guard(ctx, current)
    return current


def expected_backup(ctx):
    return {'sourceCommit': ctx['manifest']['sourceCommit'],
            'beforeSnapshotSha256': hashlib.sha256(encoded(ctx['before'])).hexdigest(),
            'moduleDeltaSha256': hashlib.sha256(encoded(ctx['manifest']['moduleDelta'])).hexdigest(),
            'hostContractSha256': ctx['before']['moduleHostContract'],
            'packages': [{**row, 'installedSha256': installed_sha(ctx, row['gameId'])} for row in ctx['rows']]}


def verify_backup(ctx):
    require(read_json(BACKUP / RECORD) == expected_backup(ctx), 'Retained module backup provenance differs')
    require(sha(regular(BACKUP / HOST_BACKUP)) == ctx['before']['moduleHostContract'], 'Retained host backup differs')
    for row in ctx['rows']:
        path = pointer_backup(row['gameId'])
        if row['beforeSha256'] == 'none':
            require(not path.exists() and not path.is_symlink(), 'Unexpected pointer backup')
        else:
            require(sha(regular(path)) == row['beforeSha256'], 'Retained pointer backup differs')


def backup(ctx):
    regular(BACKUP, directory=True)
    if (BACKUP / RECORD).exists():
        verify_backup(ctx)
        return
    require(not (BACKUP / RECORD).is_symlink() and not any(path.exists() or path.is_symlink()
            for path in [BACKUP / HOST_BACKUP, *[pointer_backup(row['gameId']) for row in ctx['rows']]]),
            'Incomplete module backup requires review')
    module_guard(ctx, original_pointers=True)
    for row in ctx['rows']:
        if row['beforeSha256'] != 'none':
            content = regular(pointer_path(row['gameId'])).read_bytes()
            require(hashlib.sha256(content).hexdigest() == row['beforeSha256'], 'Pointer changed before backup')
            atomic_bytes(pointer_backup(row['gameId']), content)
    atomic_bytes(BACKUP / HOST_BACKUP, regular(STATE / 'host.json').read_bytes())
    atomic_bytes(BACKUP / RECORD, encoded(expected_backup(ctx)))
    verify_backup(ctx)


def rollback_pointers(current=None):
    """Restore original raw pointers after preflight, retaining immutable package bytes."""
    ctx = load_context()
    from deploy import snapshot, recovery_guard, expected_program, run, PROGRAM
    current = snapshot(recovery=True) if current is None else current
    built = read_json(ROOT / 'build-result.json')
    require(built['sourceCommit'] == ctx['manifest']['sourceCommit'] and built['program'] == expected_program(),
            'Reviewed application build differs')
    if current['container'] is not None and current.get('program') is None:
        try:
            current['program'] = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', PROGRAM]))
        except subprocess.CalledProcessError:
            require(current['container']['health'] != 'healthy', 'Cannot verify files of the healthy game container')
    recovery_guard(current, built)
    module_guard(ctx, current)
    if not (BACKUP / RECORD).exists():
        require(not (BACKUP / RECORD).is_symlink(), 'Module backup symlink rejected')
        module_guard(ctx, original_pointers=True)
        require(not any(path.exists() or path.is_symlink() for path in
                        [BACKUP / HOST_BACKUP, *[pointer_backup(row['gameId']) for row in ctx['rows']]]),
                'Incomplete module backup requires review')
        return {'restored': True, 'pointerCount': 0, 'immutableVersionsRetained': True}
    verify_backup(ctx)
    changes = []
    for row in ctx['rows']:
        pointer = pointer_path(row['gameId'])
        observed = pointer_hash(pointer)
        require(observed in [row['beforeSha256'], installed_sha(ctx, row['gameId'])], 'Later pointer prevents recovery')
        if observed != row['beforeSha256']:
            changes.append((row, observed))
    for row, observed in changes:
        pointer = pointer_path(row['gameId'])
        require(pointer_hash(pointer) == observed and sha(regular(STATE / 'host.json')) == ctx['before']['moduleHostContract'],
                'Pointer or host changed during recovery')
        if row['beforeSha256'] == 'none':
            pointer.unlink()
            sync_directory(pointer.parent)
        else:
            atomic_bytes(pointer, regular(pointer_backup(row['gameId'])).read_bytes(), mode=0o644)
        require(pointer_hash(pointer) == row['beforeSha256'], 'Recovered pointer differs')
    module_guard(ctx, original_pointers=True)
    return {'restored': True, 'pointerCount': len(changes), 'immutableVersionsRetained': True}


def arguments(ctx, row, operation):
    return SimpleNamespace(operation=operation, game=row['gameId'], version=None,
                           package=str(ROOT / 'modules' / row['gameId'] / 'versions' / row['version']),
                           root=str(MODULES), state=str(STATE), expected_sha=row['beforeSha256'])


def publish():
    ctx = load_context()
    application_guard(ctx)
    metadata_bytes = len(encoded(expected_backup(ctx))) + regular(STATE / 'host.json').stat().st_size
    metadata_bytes += sum(regular(pointer_path(row['gameId'])).stat().st_size
                          for row in ctx['rows'] if row['beforeSha256'] != 'none')
    require(shutil.disk_usage(MODULES).free > 5 * 1024**3 + 3 * (ctx['total'] + metadata_bytes) + 1024**2,
            'Insufficient module publication capacity')
    for row in ctx['rows']:
        result = ctx['installer'].run(arguments(ctx, row, 'check'))
        require(result.get('verified') is True and result['gameId'] == row['gameId'] and result['version'] == row['version'],
                'Module installer check differs')
    backup(ctx)
    completed = []
    try:
        for row in ctx['rows']:
            if pointer_hash(pointer_path(row['gameId'])) == installed_sha(ctx, row['gameId']):
                result = {'published': True, 'gameId': row['gameId'], 'version': row['version'],
                          'activeSha256': installed_sha(ctx, row['gameId']), 'reusedActive': True}
            else:
                previous_mask = os.umask(0o022)
                try:
                    result = ctx['installer'].run(arguments(ctx, row, 'install'))
                finally:
                    os.umask(previous_mask)
                require(result.get('published') is True and result['gameId'] == row['gameId'] and result['version'] == row['version']
                        and result['activeSha256'] == installed_sha(ctx, row['gameId']), 'Published module pointer differs')
            completed.append(result)
            module_guard(ctx)
        application_guard(ctx)
        output = {'published': True, 'sourceCommit': ctx['manifest']['sourceCommit'], 'packages': completed,
                  'hostContractUnchanged': True, 'oldModuleBytesPreserved': True,
                  'hostProgramTouched': False, 'databaseTouched': False}
        write('modules-published.json', output)
        return output
    except BaseException as error:
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, signal.SIG_IGN)
        try:
            recovered = rollback_pointers()
        except BaseException as recovery_error:
            write('modules-failed.json', {'reason': str(error), 'recoveryReason': str(recovery_error),
                  'pointersRestored': False, 'databaseTouched': False})
            raise recovery_error from error
        write('modules-failed.json', {'reason': str(error), 'pointersRestored': True,
              'restoredPointerCount': recovered['pointerCount'], 'databaseTouched': False})
        raise
