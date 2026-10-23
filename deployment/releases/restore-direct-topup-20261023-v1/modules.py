"""Publish reviewed client labels through the existing independent module installer."""
from pathlib import Path
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
STATE = Path('/opt/royal-game-modules-state')
MODULES = Path('/opt/royal-game-modules')
NAME = 'restore-direct-topup-20261023-v1'
BACKUP = Path('/opt/royal-backups') / NAME
M = json.loads((ROOT / 'install-manifest.json').read_text())
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')

def publish():
    assert ROOT == Path('/opt/royal-releases') / NAME
    assert sha(ROOT / 'modules.py') == M['modulesHelperSha256']
    assert sha(STATE / 'host.json') == M['before']['moduleHostContract']
    assert all(sha(LIVE / name) == digest for name, digest in M['changed'].items())
    assert all(sha(ROOT / 'modules' / name) == digest for name, digest in M['moduleDelta'].items())
    assert shutil.disk_usage(MODULES).free > 5 * 1024**3 + 3 * sum((ROOT / 'modules' / n).stat().st_size for n in M['moduleDelta'])
    spec = importlib.util.spec_from_file_location('module_installer', LIVE / 'scripts/game-module-release.py')
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    args = []
    before = {}
    for row in M['modulePackages']:
        game = row['gameId']
        pointer = MODULES / game / 'active.json'
        before[game] = json.loads(pointer.read_text()) if pointer.exists() else None
        assert installer.active_sha(pointer) == row['beforeSha256'], 'Module changed since review: ' + game
        value = SimpleNamespace(operation='check', game=game, package=str(ROOT / 'modules' / game / 'versions' / row['version']), root=str(MODULES), state=str(STATE), expected_sha=row['beforeSha256'])
        installer.run(value)
        args.append(value)
    BACKUP.joinpath('module-pointers.json').write_text(json.dumps(before, indent=2) + '\n')
    completed = []
    try:
        for value in args:
            value.operation = 'install'
            completed.append(installer.run(value))
        result = {'published': True, 'sourceCommit': M['sourceCommit'], 'packages': completed, 'databaseTouched': False}
        save('modules-published.json', result)
        return result
    except BaseException:
        for row in reversed(completed):
            game = row['gameId']
            pointer = MODULES / game / 'active.json'
            assert installer.active_sha(pointer) == row['activeSha256'], 'Later publication prevents recovery'
            if before[game] is None:
                pointer.unlink()
            else:
                installer.atomic_json(pointer, before[game])
        save('modules-recovered.json', {'restoredPointers': len(completed)})
        raise

if __name__ == '__main__':
    assert sys.argv[1:] == ['publish']
    with Path('/opt/royal-releases/themed-publish.lock').open('a') as outer, (LIVE / '.client-presentation-deploy.lock').open('a') as app, (STATE / 'module.lock').open('a') as modules:
        for lock in [outer, app, modules]:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(publish()))
