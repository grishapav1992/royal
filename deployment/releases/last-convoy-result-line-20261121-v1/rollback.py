"""Return Last Convoy to the package and sources it had before last-convoy-result-line-20261121-v1.

The v1 installer recorded its publication in the multi-module format, which retention cannot
accept as the successor of one game. This rollback restores the exact prior pointer and source
bytes from the v1 rollback archive, so the same reviewed package can be published again with the
single-game installer. Existing v1 records are left untouched; the outcome goes to rolled-back.json.
"""

from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tarfile

NAME = 'last-convoy-result-line-20261121-v1'
GAME = 'studio-last-convoy'
PRIOR_VERSION = '1.1.1-339adbc4c939'
SOURCES = ('games/last-convoy/LastConvoyUI.ts', 'games/last-convoy/last-convoy.css')
LIVE = Path('/opt/royal')
ROOT = Path('/opt/royal-releases') / NAME
HELPERS = ROOT.parent / 'password-login-20261119-v1'
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
POINTER = MODULES / GAME / 'active.json'
PUBLISHER = LIVE / 'scripts/game-module-release.py'
LOCKS = (ROOT.parent / 'themed-publish.lock', LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock')
sys.dont_write_bytecode = True


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def safe(path):
    require(not any(part.is_symlink() for part in (path, *path.parents)), f'Unsafe path: {path}')
    return path


def read(path):
    return safe(path).read_bytes()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data, mode):
    partial = safe(path).with_name(path.name + '.' + NAME + '.rollback.partial')
    with partial.open('xb') as stream:
        try:
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
            os.replace(partial, path)
        finally:
            partial.unlink(missing_ok=True)


def snapshot():
    output = subprocess.check_output(['python3', str(HELPERS / 'snapshot.py')], text=True, stderr=subprocess.PIPE, timeout=180)
    return json.loads(output)


def same_inventory(actual, expected):
    ignored = {'at', 'availableBytes'}
    changed = sorted(key for key in (actual.keys() | expected.keys()) - ignored if actual.get(key) != expected.get(key))
    require(not changed, f'Unexpected production inventory changes: {changed}')


def load_publisher():
    spec = importlib.util.spec_from_file_location('convoy_result_rollback_publisher', safe(PUBLISHER))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rollback():
    require(not (ROOT / 'rolled-back.json').exists(), 'Rollback already attempted')
    operator, published, before, after = [json.loads(read(ROOT / name)) for name in
                                          ('operator.json', 'published.json', 'before.json', 'after.json')]
    require(published['published'] is True and published['release'] == NAME, 'v1 was not published')
    installed = operator['packages'][GAME]
    require(sha(read(PUBLISHER)) == operator['publisherSha256'], 'Module publisher changed')
    archive = BACKUP / 'source.tgz'
    require(sha(read(archive)) == published['backup']['sha256'], 'Rollback archive changed')
    with tarfile.open(safe(archive)) as saved:
        members = {entry.name: saved.extractfile(entry).read() for entry in saved if entry.isfile()}
    prior_pointer = members[GAME + '/active.json']
    prior_sources = {name: members[name] for name in SOURCES}
    require(sha(prior_pointer) == installed['beforePointerSha256'] == before['moduleFiles'][str(POINTER)], 'Prior pointer differs')
    require(json.loads(prior_pointer)['manifest'] == f'/game-modules/{GAME}/versions/{PRIOR_VERSION}/manifest.json', 'Prior version differs')
    require(all(sha(prior_sources[name]) == before['source'][name] for name in SOURCES), 'Prior sources differ')

    current = snapshot()
    same_inventory(current, after)
    require(current['container']['health'] == 'healthy', 'Host is unhealthy')
    active = read(POINTER)
    require(sha(active) == installed['pointerSha256'], 'Last Convoy pointer changed since v1')
    modes = {}
    for name in SOURCES:
        path = safe(LIVE / name)
        require(sha(read(path)) == operator['source'][name], f'Live source changed since v1: {name}')
        modes[name] = path.stat().st_mode & 0o7777

    publisher = load_publisher()
    restored, result = [], None
    try:
        result = publisher.run(SimpleNamespace(operation='rollback', version=PRIOR_VERSION, game=GAME,
                                               root=str(MODULES), state=str(STATE), expected_sha=sha(active)))
        require(read(POINTER) == prior_pointer, 'Exact prior pointer was not restored')
        for name in SOURCES:
            atomic(LIVE / name, prior_sources[name], modes[name])
            restored.append(name)
        final = snapshot()
        expected = {**after, 'source': {**after['source'], **{n: before['source'][n] for n in SOURCES}},
                    'sourceLF': {**after['sourceLF'], **{n: before['sourceLF'][n] for n in SOURCES}},
                    'moduleFiles': {**after['moduleFiles'], str(POINTER): sha(prior_pointer)}}
        same_inventory(final, expected)
        require(final['container']['health'] == 'healthy', 'Host is unhealthy after rollback')
        record = {'rolledBack': True, 'release': NAME, 'reason': 'Republish with the single-game installer so retention can verify the successor',
                  'module': result, 'pointerSha256': sha(prior_pointer), 'restoredSources': {n: sha(prior_sources[n]) for n in SOURCES},
                  'hostRestarted': False, 'databaseTouched': False, 'availableBytes': final['availableBytes']}
        atomic(ROOT / 'rolled-back.json', (json.dumps(record, indent=2) + '\n').encode(), 0o644)
        return record
    except BaseException as error:
        failures = []
        for name in reversed(restored):
            try:
                atomic(LIVE / name, read(ROOT / 'source' / name), modes[name])
            except Exception as undo:
                failures.append(str(undo))
        try:
            now = read(POINTER)
            if now != active:
                require(now == prior_pointer, 'Unknown pointer during undo')
                publisher.run(SimpleNamespace(operation='install', package=str(MODULES / GAME / 'versions' / installed['version']),
                                              game=GAME, root=str(MODULES), state=str(STATE), expected_sha=sha(now)))
                require(read(POINTER) == active, 'v1 pointer was not restored')
        except Exception as undo:
            failures.append(str(undo))
        if failures:
            raise RuntimeError('Rollback undo requires review: ' + ', '.join(failures)) from error
        raise


def main():
    require(Path(__file__).resolve() == ROOT / 'rollback.py' and not sys.argv[1:], 'Unexpected rollback invocation')
    with ExitStack() as stack:
        for path in LOCKS:
            stream = stack.enter_context(safe(path).open('a'))
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('A production publication lock is busy.', file=sys.stderr)
                return 75
        print(json.dumps(rollback()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
