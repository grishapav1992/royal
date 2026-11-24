"""Publish the reviewed Dracona cabinet package without restarting the Royal host."""

from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile

NAME = 'dracona-cabinet-20261124-v1'
SLUG = 'dracona'
GAME = 'studio-dracona'
LIVE = Path('/opt/royal')
ROOT = Path('/opt/royal-releases') / NAME
HELPERS = ROOT.parent / 'skin-walking-20261124-v1'
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
POINTER = MODULES / GAME / 'active.json'
CONTRACT = {'apiVersion': 1, 'rulesVersion': 3, 'progressVersion': 2}
# Three files are created and eight replaced. The unused compactStyles.ts and priorityStyles.ts of the host release stay untouched.
NEW_SOURCES = {f'games/{SLUG}/{name}' for name in ('board.ts', 'layout.ts', 'text.ts')}
SOURCES = NEW_SOURCES | {f'games/{SLUG}/{name}' for name in (
    'DraconaUI.ts', 'autoplay.ts', 'character.ts', 'effects.ts', 'entry.ts', 'package.json', 'requestStyles.ts', 'styles.ts')}
MIN_FREE = 5 * 1024**3
LOCKS = (ROOT.parent / 'themed-publish.lock', LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock')
sys.dont_write_bytecode = True


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def safe(path):
    require(not any(part.is_symlink() for part in (path, *path.parents)), f'Unsafe path: {path}')
    return path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bytes_at(path):
    return safe(path).read_bytes()


def load_json(path):
    return json.loads(bytes_at(path))


def atomic(path, data):
    path = safe(path)
    partial = path.with_name(path.name + '.' + NAME + '.partial')
    with partial.open('xb') as stream:
        try:
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), 0o644)
            os.fsync(stream.fileno())
            os.replace(partial, path)
        finally:
            partial.unlink(missing_ok=True)


def save(name, value):
    atomic(ROOT / name, (json.dumps(value, indent=2) + '\n').encode())


def command(args, timeout=180):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=timeout).strip()


def load_python(path, name):
    spec = importlib.util.spec_from_file_location(name, safe(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot():
    return json.loads(command(['python3', str(HELPERS / 'snapshot.py')]))


def stable(value):
    return {key: item for key, item in value.items() if key not in ('at', 'availableBytes')}


def same_inventory(actual, expected):
    different = sorted(key for key in stable(actual).keys() | stable(expected).keys()
                       if stable(actual).get(key) != stable(expected).get(key))
    require(not different, f'Unexpected production inventory changes: {different}')


def read_inputs():
    op = load_json(ROOT / 'operator.json')
    pinned = {
        ROOT / 'publish.py': op['wrapperSha256'],
        ROOT / 'before.json': op['beforeSha256'],
        ROOT / 'release-manifest.json': op['releaseManifestSha256'],
        ROOT / 'release-github.json': op['receiptSha256'],
        LIVE / 'scripts/game-module-release.py': op['publisherSha256'],
    }
    require(set(op['helpers']) == {'snapshot.py', 'snapshot-base.py', 'image_metadata.py'}, 'Unexpected inventory helpers')
    pinned.update({HELPERS / name: digest for name, digest in op['helpers'].items()})
    for path, digest in pinned.items():
        require(sha(bytes_at(path)) == digest, f'Reviewed input changed: {path}')
    before = load_json(ROOT / 'before.json')
    release = load_json(ROOT / 'release-manifest.json')
    receipt = load_json(ROOT / 'release-github.json')
    require(release['scope'] == 'modules' and release['modules'] == [SLUG] and release['build']['passed'], 'Unexpected publication scope')
    require(release['packages'] == [{'gameId': GAME, 'version': op['version'],
                                   'pointer': f'module-dist/{GAME}/active.json'}], 'Unexpected module package')
    require(release['sourceCommit'] == op['sourceCommit'] == receipt['sourceCommit']
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and receipt['manifestSha256'] == op['releaseManifestSha256'], 'Invalid GitHub receipt')
    require(release['baseCommit'] == before['sourceCommit'] and set(op['source']) == SOURCES, 'Unexpected source baseline')
    for name, digest in op['source'].items():
        require(release['moduleProjection']['inputs'][name] == digest
                and sha(bytes_at(ROOT / 'source' / name)) == digest, f'Unverified source: {name}')
    metadata = load_json(ROOT / 'package/manifest.json')
    require(metadata['version'] == op['version'] and metadata['gameId'] == GAME
            and {key: metadata[key] for key in CONTRACT} == CONTRACT, 'Wrong package identity or contract')
    files = {'manifest.json': sha(bytes_at(ROOT / 'package/manifest.json')), **metadata['files']}
    prefix = f'module-dist/{GAME}/versions/{op["version"]}/'
    require(release['files'] == {**{prefix + key: value for key, value in files.items()},
                                 f'module-dist/{GAME}/active.json': op['pointerSha256']}, 'Package inventory differs from release')
    return op, before, files


def backup_source_and_module(old, old_sources, pointer_bytes, before, publisher):
    BACKUP.mkdir(mode=0o700)
    saved = {**old_sources, 'active.json': pointer_bytes, 'prior-manifest.json': bytes_at(old / 'manifest.json'),
             'host.json': bytes_at(STATE / 'host.json')}
    archive = BACKUP / 'source.tgz'
    with tarfile.open(archive, 'x:gz') as output:
        for name, contents in sorted(saved.items()):
            entry = tarfile.TarInfo(name)
            entry.size = len(contents)
            entry.mode = 0o600
            output.addfile(entry, io.BytesIO(contents))
    archive.chmod(0o600)
    with tarfile.open(archive) as source:
        require({entry.name: source.extractfile(entry).read() for entry in source} == saved, 'Source backup verification failed')
    shutil.copytree(old, BACKUP / 'package', copy_function=os.link)
    publisher.verify(BACKUP / 'package', CONTRACT, GAME)
    image = before['container']['image']
    tag = 'royal-game:before-' + NAME
    command(['docker', 'tag', image, tag])
    image_check = load_python(HELPERS / 'image_metadata.py', 'dracona_cabinet_image_check')
    require(image_check.image(tag) == image, 'Rollback image tag verification failed')
    return {'sourceArchive': str(archive), 'sha256': sha(bytes_at(archive)), 'bytes': archive.stat().st_size,
            'oldVersion': old.name, 'imageTag': tag, 'image': image, 'oldPackageHardlinked': True,
            'createdSources': sorted(NEW_SOURCES)}


def publish(op, before, files):
    require(not (ROOT / 'published.json').exists() and not BACKUP.exists(), 'Publication already attempted')
    current = snapshot()
    same_inventory(current, before)
    require(current['container']['health'] == 'healthy', 'Host is unhealthy')
    require(current['moduleHost']['games'][GAME] == CONTRACT, 'Installed host does not support this package')
    incoming_bytes = sum(path.stat().st_size for path in (ROOT / 'package').rglob('*') if path.is_file())
    require(shutil.disk_usage(MODULES).free > MIN_FREE + 3 * incoming_bytes + 12 * 1024**2, 'Server disk reserve would be crossed')
    pointer_bytes = bytes_at(POINTER)
    previous_pointer = sha(pointer_bytes)
    require(previous_pointer == before['moduleFiles'][str(POINTER)], 'Previous Dracona pointer changed')
    old_version = json.loads(pointer_bytes)['manifest'].split('/')[4]
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}', old_version) and old_version != op['version'], 'Unexpected previous version')
    old = MODULES / GAME / 'versions' / old_version
    publisher = load_python(LIVE / 'scripts/game-module-release.py', 'dracona_cabinet_module_publisher')
    publisher.verify(old, CONTRACT, GAME)
    manifest_hash = sha(bytes_at(old / 'manifest.json'))
    require(manifest_hash == op['priorManifestSha256'] == json.loads(pointer_bytes)['sha256'],
            'Previous immutable package differs from review')
    old_sources = {}
    require((LIVE / 'games' / SLUG).is_dir(), 'Live module folder is missing')
    for name in sorted(SOURCES):
        path = safe(LIVE / name)
        if name in NEW_SOURCES:
            require(name not in before['source'] and not path.exists(), f'Production already has {name}')
            continue
        old_sources[name] = bytes_at(path)
        require(sha(old_sources[name]) == before['source'][name], f'Production source changed: {name}')
    backup = backup_source_and_module(old, old_sources, pointer_bytes, before, publisher)
    save('backup.json', backup)

    changed = []
    try:
        for name in sorted(SOURCES):
            atomic(LIVE / name, bytes_at(ROOT / 'source' / name))
            changed.append(name)
        result = publisher.run(SimpleNamespace(operation='install', package=str(ROOT / 'package'), game=GAME,
                                               root=str(MODULES), state=str(STATE), expected_sha=previous_pointer))
        require(result['activeSha256'] == op['pointerSha256'], 'Installed pointer differs from approved bytes')
        after = snapshot()
        folder = MODULES / GAME / 'versions' / op['version']
        expected = {**before, 'source': {**before['source'], **op['source']},
                    'sourceLF': {**before['sourceLF'], **op['source']},
                    'moduleFiles': {**before['moduleFiles'], str(POINTER): op['pointerSha256'],
                                    **{str(folder / name): digest for name, digest in files.items()}}}
        same_inventory(after, expected)
        require(after['availableBytes'] > MIN_FREE, 'Server disk reserve crossed')
        save('after.json', after)
        record = {'published': True, 'release': NAME, 'sourceCommit': op['sourceCommit'], 'baseCommit': before['sourceCommit'],
                  'backup': backup, 'module': result, 'freeBefore': current['availableBytes'], 'freeAfter': after['availableBytes'],
                  'hostRestarted': False, 'databaseTouched': False, 'otherModulesPreserved': True,
                  'runtimeFilesPreserved': len(before['program']), 'servicesPreserved': len(before['services'])}
        save('published.json', record)
        return record
    except BaseException:
        current_pointer = sha(bytes_at(POINTER))
        if current_pointer != previous_pointer:
            require(current_pointer == op['pointerSha256'], 'Unknown pointer state after failed publication')
            publisher.run(SimpleNamespace(operation='rollback', version=old_version, game=GAME,
                                          root=str(MODULES), state=str(STATE), expected_sha=current_pointer))
            require(sha(bytes_at(POINTER)) == previous_pointer, 'Exact previous pointer was not restored')
        for name in reversed(changed):
            if name in NEW_SOURCES:
                safe(LIVE / name).unlink(missing_ok=True)
            else:
                atomic(LIVE / name, old_sources[name])
        raise


def main():
    require(Path(__file__).resolve() == ROOT / 'publish.py' and not sys.argv[1:], 'Unexpected installer invocation')
    op, before, files = read_inputs()
    with ExitStack() as stack:
        for path in LOCKS:
            stream = stack.enter_context(safe(path).open('a'))
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(publish(op, before, files)))


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        print('A production publication lock is busy.', file=sys.stderr)
        sys.exit(75)
