"""Publish only the Cosmic client after the reviewed application is healthy."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent
NAME = 'cosmic-origin-20261026-v1'
EXPECTED_ROOT = Path('/opt/royal-releases') / NAME
LIVE = Path('/opt/royal')
STATE = Path('/opt/royal-game-modules-state')
MODULES = Path('/opt/royal-game-modules')
BACKUP = Path('/opt/royal-backups') / NAME
GAME = 'studio-cosmic-escape'
CONTRACT = {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 1}
DIGEST = re.compile(r'[a-f0-9]{64}')
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}')
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
            result[str(path.relative_to(root))] = sha(path)
        else:
            require(path.is_dir(), 'Nonregular module resource rejected')
    return result


def atomic_bytes(path, data, mode=0o600):
    regular(path.parent, directory=True)
    require(not path.is_symlink(), 'Atomic target symlink rejected')
    temporary = path.with_name('.cosmic-module-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as output:
            output.write(data)
            os.fchmod(output.fileno(), mode)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write(name, value):
    atomic_bytes(ROOT / name, (json.dumps(value, indent=2) + '\n').encode())


def read_json(path):
    return json.loads(regular(path).read_text())


def snapshot():
    return json.loads(subprocess.check_output(['python3', str(ROOT / 'snapshot.py')], text=True))


def sources(state):
    return {name: digest for name, digest in state['source'].items() if not name.endswith(('.orig', '.bak'))}


def expected_program():
    return {**OLD['program'], **M.get('runtimePackages', {}),
            **{'dist/' + name: digest for name, digest in M['delta'].items()},
            **{'dist-server/' + name: digest for name, digest in M['serverDelta'].items()}}


def row():
    packages = M.get('modulePackages')
    require(isinstance(packages, list) and len(packages) == 1 and isinstance(packages[0], dict),
            'Exactly one Cosmic module package is required')
    value = packages[0]
    require(set(value) == {'gameId', 'version', 'beforeSha256'} and value['gameId'] == GAME
            and isinstance(value['version'], str) and VERSION.fullmatch(value['version']), 'Unexpected module package identity')
    require(value['beforeSha256'] == 'none' or isinstance(value['beforeSha256'], str)
            and DIGEST.fullmatch(value['beforeSha256']), 'Invalid reviewed pointer hash')
    expected = OLD['moduleFiles'].get(str(MODULES / GAME / 'active.json'), 'none')
    require(value['beforeSha256'] == expected, 'Pointer baseline differs from the production snapshot')
    return value


def load_installer():
    path = regular(LIVE / 'scripts/game-module-release.py')
    expected = M['changed'].get('scripts/game-module-release.py', OLD['source'].get('scripts/game-module-release.py'))
    require(expected is not None and sha(path) == expected, 'Installed module installer changed')
    spec = importlib.util.spec_from_file_location('cosmic_reviewed_module_installer', path)
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    return installer


def payload():
    require(ROOT == EXPECTED_ROOT and M['release'] == NAME, 'Unexpected module release path')
    require(isinstance(M['sourceCommit'], str) and re.fullmatch(r'[a-f0-9]{40}', M['sourceCommit']),
            'Missing reviewed source commit')
    for name, key in [('modules.py', 'modulesHelperSha256'), ('deploy.py', 'helperSha256'),
                      ('snapshot.py', 'snapshotSha256')]:
        require(sha(regular(ROOT / name)) == M[key], 'Release helper changed: ' + name)
    value = row()
    prefix = GAME + '/versions/' + value['version'] + '/'
    delta = M.get('moduleDelta')
    require(isinstance(delta, dict) and delta and prefix + 'manifest.json' in delta, 'Missing Cosmic module inventory')
    for name, digest in delta.items():
        require(isinstance(name, str) and name.startswith(prefix), 'Only the reviewed Cosmic version may be published')
        relative = PurePosixPath(name)
        require(str(relative) == name and all(part not in ['.', '..'] for part in relative.parts), 'Unsafe module payload path')
        require(isinstance(digest, str) and DIGEST.fullmatch(digest), 'Invalid module payload digest')
        old = OLD['moduleFiles'].get(str(MODULES / name))
        require(old is None or old == digest, 'Immutable module URL would change: ' + name)
    require(inventory(ROOT / 'modules') == delta, 'Module payload inventory differs')
    host = read_json(ROOT / 'host.json')
    require(sha(ROOT / 'host.json') == M['hostContractSha256'] == OLD['moduleHostContract'],
            'Host contract bytes must remain unchanged')
    require(host == OLD['moduleHost'] and host.get('games', {}).get(GAME) == CONTRACT,
            'Cosmic requires the existing 1/2/1 host contract')
    installer = load_installer()
    package = ROOT / 'modules' / GAME / 'versions' / value['version']
    metadata, total = installer.verify(package, CONTRACT, GAME)
    require(metadata['version'] == value['version'], 'Module manifest version differs')
    require(set(delta) == {prefix + name for name in ['manifest.json', *metadata['files']]},
            'Cosmic package inventory differs from its manifest')
    return installer, metadata, total


def application_guard(state):
    built, after, published = [read_json(ROOT / name) for name in ['build-result.json', 'after.json', 'published.json']]
    require(built['sourceCommit'] == published['sourceCommit'] == M['sourceCommit'], 'Application release source differs')
    require(published.get('published') is True and built['program'] == expected_program(), 'Application build inventory differs')
    require(published['runningImage'] == published['preparedImage'] == built['image'], 'Published application image differs')
    for current in [after, state]:
        require(current['sourceRevision'] == M['sourceCommit'] and sources(current) == {**sources(OLD), **M['changed']},
                'Application source changed before module publication')
        require(current['container'] is not None and current['container']['health'] == 'healthy'
                and current['container']['image'] == current['preparedImage'] == built['image'], 'Application image or health changed')
        require(current['program'] == current['preparedProgram'] == built['program'], 'Application runtime files changed')
        for key in ['configHashes', 'moduleHostContract', 'moduleHost', 'realMoneyFlags']:
            require(current[key] == OLD[key], 'Protected production state changed: ' + key)
        for key in ['mounts', 'host', 'runtimeHash', 'composeFiles']:
            require(current['container'][key] == OLD['container'][key], 'Application settings changed: ' + key)
        require({name: value for name, value in current['services'].items() if name != '/royal-game-1'}
                == {name: value for name, value in OLD['services'].items() if name != '/royal-game-1'},
                'Another persistent service changed')
    require(after['moduleFiles'] == OLD['moduleFiles'], 'Application publication changed external modules')
    require(state['container'] == after['container'] and state['services'] == after['services'],
            'Running application changed since its publication')
    require(sha(regular(STATE / 'host.json')) == M['hostContractSha256'], 'Installed host contract changed')
    return built, after


def pointer_value(metadata):
    prefix = GAME + '/versions/' + metadata['version'] + '/manifest.json'
    return {'format': 1, 'gameId': GAME, 'manifest': '/game-modules/' + prefix, 'sha256': M['moduleDelta'][prefix]}


def installed_sha(metadata):
    return hashlib.sha256((json.dumps(pointer_value(metadata), indent=2) + '\n').encode()).hexdigest()


def module_guard(state, pointer_hash, installed=False):
    expected = dict(OLD['moduleFiles'])
    if installed:
        expected.update({str(MODULES / name): digest for name, digest in M['moduleDelta'].items()})
    pointer = str(MODULES / GAME / 'active.json')
    if pointer_hash == 'none':
        expected.pop(pointer, None)
    else:
        expected[pointer] = pointer_hash
    actual = {str(MODULES / name): digest for name, digest in inventory(MODULES).items()}
    require(state['moduleFiles'] == actual == expected, 'Unrelated module or immutable version changed')


def arguments(operation):
    value = row()
    return SimpleNamespace(operation=operation, game=GAME, version=None,
                           package=str(ROOT / 'modules' / GAME / 'versions' / value['version']),
                           root=str(MODULES), state=str(STATE), expected_sha=value['beforeSha256'])


def backup(metadata):
    regular(BACKUP, directory=True)
    value = row()
    record = {'sourceCommit': M['sourceCommit'], 'gameId': GAME, 'version': value['version'],
              'beforeSha256': value['beforeSha256'], 'installedSha256': installed_sha(metadata),
              'hostContractSha256': M['hostContractSha256']}
    record_path, pointer_path, host_path = [BACKUP / name for name in ['cosmic-module-backup.json', 'cosmic-active.json', 'module-host.json']]
    if record_path.exists():
        require(read_json(record_path) == record, 'Retained module backup provenance differs')
    else:
        require(not pointer_path.exists() and not host_path.exists(), 'Incomplete module backup requires review')
        if value['beforeSha256'] != 'none':
            content = regular(MODULES / GAME / 'active.json').read_bytes()
            require(hashlib.sha256(content).hexdigest() == value['beforeSha256'], 'Pointer changed before backup')
            atomic_bytes(pointer_path, content)
        atomic_bytes(host_path, regular(STATE / 'host.json').read_bytes())
        atomic_bytes(record_path, (json.dumps(record, indent=2) + '\n').encode())
    require(sha(regular(host_path)) == record['hostContractSha256'], 'Retained host backup differs')
    if value['beforeSha256'] == 'none':
        require(not pointer_path.exists() and not pointer_path.is_symlink(), 'Unexpected pointer backup')
    else:
        require(sha(regular(pointer_path)) == value['beforeSha256'], 'Retained pointer backup differs')
    return record


def restore_pointer(installer, metadata):
    record = backup(metadata)
    pointer = MODULES / GAME / 'active.json'
    current = installer.active_sha(pointer)
    require(current == record['installedSha256'], 'Later Cosmic pointer prevents recovery')
    require(sha(regular(STATE / 'host.json')) == record['hostContractSha256'], 'Later host contract prevents recovery')
    if record['beforeSha256'] == 'none':
        pointer.unlink()
        sync_directory(pointer.parent)
    else:
        atomic_bytes(pointer, regular(BACKUP / 'cosmic-active.json').read_bytes(), mode=0o644)
    require(installer.active_sha(pointer) == record['beforeSha256'], 'Recovered Cosmic pointer differs')


def check():
    installer, metadata, total = payload()
    state = snapshot()
    application_guard(state)
    module_guard(state, row()['beforeSha256'])
    require(installer.active_sha(MODULES / GAME / 'active.json') == row()['beforeSha256'], 'Cosmic pointer changed since review')
    result = installer.run(arguments('check'))
    require(result.get('verified') is True and result['gameId'] == GAME and result['version'] == metadata['version'],
            'Module installer check differs')
    require(shutil.disk_usage(MODULES).free > 5 * 1024**3 + 3 * total, 'Insufficient module publication capacity')
    return installer, metadata, result


def publish():
    installer, metadata, checked = check()
    require(not (ROOT / 'modules-published.json').exists(), 'Module publication already recorded')
    backup(metadata)
    try:
        result = installer.run(arguments('install'))
        require(result.get('published') is True and result['gameId'] == GAME and result['version'] == metadata['version']
                and result['activeSha256'] == installed_sha(metadata), 'Published Cosmic pointer differs')
        current = snapshot()
        application_guard(current)
        module_guard(current, installed_sha(metadata), installed=True)
        output = {'published': True, 'sourceCommit': M['sourceCommit'], 'packages': [result],
                  'hostContractSha256': M['hostContractSha256'], 'oldModuleBytesPreserved': True,
                  'hostProgramTouched': False, 'databaseTouched': False, 'applicationRollbackPerformed': False}
        write('modules-published.json', output)
        return output
    except BaseException as error:
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, signal.SIG_IGN)
        recovered = False
        pointer_hash = installer.active_sha(MODULES / GAME / 'active.json')
        if pointer_hash != row()['beforeSha256']:
            require(pointer_hash == installed_sha(metadata), 'Later Cosmic pointer prevents failure recovery')
            application_guard(snapshot())
            restore_pointer(installer, metadata)
            recovered = True
        write('modules-failed.json', {'errorType': type(error).__name__, 'reason': str(error),
              'pointerRestored': recovered, 'applicationRollbackPerformed': False, 'databaseTouched': False})
        raise


def rollback():
    installer, metadata, _total = payload()
    require((BACKUP / 'cosmic-module-backup.json').is_file(), 'Missing reviewed module backup')
    record = backup(metadata)
    current = snapshot()
    application_guard(current)
    module_guard(current, record['installedSha256'], installed=True)
    restore_pointer(installer, metadata)
    after = snapshot()
    application_guard(after)
    module_guard(after, record['beforeSha256'], installed=True)
    result = {'restored': True, 'gameId': GAME, 'sourceCommit': M['sourceCommit'], 'oldModuleBytesPreserved': True,
              'immutableVersionRetained': True, 'applicationRollbackPerformed': False, 'databaseTouched': False}
    write('modules-recovered.json', result)
    return result


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'publish', 'rollback'], 'Unexpected module operation')
    for path in [LIVE, STATE, MODULES, ROOT, BACKUP]:
        regular(path, directory=True)
    paths = [Path('/opt/royal-releases/themed-publish.lock'), LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock']
    for path in paths:
        regular(path.parent, directory=True)
        require(not path.is_symlink(), 'Deployment lock symlink rejected')
    with paths[0].open('a') as themed, paths[1].open('a') as shared, paths[2].open('a') as module:
        for handle in [themed, shared, module]:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

        def interrupted(number, _frame):
            raise InterruptedError('Module publication interrupted: ' + str(number))

        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, interrupted)
        if sys.argv[1] == 'check':
            _installer, _metadata, result = check()
        else:
            result = globals()[sys.argv[1]]()
        print(json.dumps(result))


if __name__ == '__main__':
    main()
