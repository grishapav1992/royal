"""Install the three reviewed autoplay packages under the shared publication locks."""

from contextlib import ExitStack
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
from types import SimpleNamespace

NAME = 'autoplay-spin-count-20261120-v1'
SLUGS = ('cosmic-escape', 'caramel-carnival', 'last-convoy')
GAMES = tuple('studio-' + slug for slug in SLUGS)
SOURCES = {
    'src/ui/CosmicEscapeUI.ts', 'src/ui/cosmic-guardians.css',
    'src/ui/CaramelCarnivalUI.ts', 'src/ui/caramel-fair.css',
    'games/last-convoy/LastConvoyUI.ts', 'games/last-convoy/last-convoy.css',
}
LIVE = Path('/opt/royal')
ROOT = Path('/opt/royal-releases') / NAME
HELPERS = ROOT.parent / 'password-login-20261119-v1'
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
LOCKS = (ROOT.parent / 'themed-publish.lock', LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock')
PUBLISHER = LIVE / 'scripts/game-module-release.py'
MIN_FREE = 5 * 1024**3
CONTRACT = {'apiVersion': 1, 'rulesVersion': 2, 'progressVersion': 1}
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}')
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


def atomic(path, data, mode=0o644):
    temporary = safe(path).with_name(path.name + '.' + NAME + '.partial')
    with temporary.open('xb') as stream:
        try:
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def save(name, value):
    atomic(ROOT / name, (json.dumps(value, indent=2) + '\n').encode())


def load_python(path, name):
    spec = importlib.util.spec_from_file_location(name, safe(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def command(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=180).strip()


def snapshot():
    return json.loads(command(['python3', str(HELPERS / 'snapshot.py')]))


def check_inventory(actual, expected):
    ignored = {'at', 'availableBytes'}
    changed = sorted(key for key in (actual.keys() | expected.keys()) - ignored
                     if actual.get(key) != expected.get(key))
    require(not changed, f'Unexpected production inventory changes: {changed}')


def inputs():
    operator = json.loads(read(ROOT / 'operator.json'))
    pinned = {ROOT / name: operator[key] for name, key in {
        'publish.py': 'wrapperSha256', 'before.json': 'beforeSha256',
        'release-manifest.json': 'releaseManifestSha256', 'release-github.json': 'receiptSha256',
        'program-proof.json': 'programProofSha256',
    }.items()}
    require(set(operator['helpers']) == {'snapshot.py', 'snapshot-base.py', 'image_metadata.py'}, 'Unexpected inventory helpers')
    pinned.update({HELPERS / name: digest for name, digest in operator['helpers'].items()})
    pinned[PUBLISHER] = operator['publisherSha256']
    for path, digest in pinned.items():
        require(sha(read(path)) == digest, f'Reviewed input changed: {path}')
    before, release, receipt, proof = [json.loads(read(ROOT / name)) for name in (
        'before.json', 'release-manifest.json', 'release-github.json', 'program-proof.json')]
    commit = release['sourceCommit']
    require(commit == operator['sourceCommit'] == receipt['sourceCommit'] == proof['sourceCommit']
            and re.fullmatch('[a-f0-9]{40}', commit) and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and receipt['manifestSha256'] == operator['releaseManifestSha256'], 'GitHub receipt differs')
    require(release['scope'] == 'modules' and release['modules'] == list(SLUGS)
            and release['clean'] and release['build']['passed']
            and release['baseCommit'] == release['moduleProjection']['productionCommit'] == before['sourceCommit'],
            'Unexpected release scope or production baseline')
    require(set(operator['source']) == SOURCES and set(operator['packages']) == set(GAMES)
            and set(proof['games']) == set(GAMES), 'Unexpected release inventory')
    for name, digest in operator['source'].items():
        require(sha(read(ROOT / 'source' / name)) == digest == release['moduleProjection']['inputs'][name],
                f'Unverified source: {name}')
    return operator, before, release, proof


def prepare_packages(operator, before, release, proof, publisher):
    expected_files, packages = {}, {}
    for game in GAMES:
        package = ROOT / 'packages' / game
        row = operator['packages'][game]
        require(before['moduleHost']['games'][game] == CONTRACT, f'Unsupported host contract: {game}')
        metadata, size = publisher.verify(package, CONTRACT, game)
        version = metadata['version']
        manifest = sha(read(package / 'manifest.json'))
        files = {'manifest.json': manifest, **metadata['files']}
        require(version == row['version'] and files == row['files'], f'Unexpected package: {game}')
        pointer = MODULES / game / 'active.json'
        prior = read(pointer)
        old = json.loads(prior)
        old_version = old['manifest'].split('/')[4]
        require(sha(prior) == before['moduleFiles'][str(pointer)] == row['beforePointerSha256']
                and VERSION.fullmatch(old_version) and old_version != version, f'Prior pointer changed: {game}')
        old_path = MODULES / game / 'versions' / old_version
        prior_metadata, _ = publisher.verify(old_path, CONTRACT, game)
        prior_manifest = sha(read(old_path / 'manifest.json'))
        checked = proof['games'][game]
        require(prior_manifest == old['sha256'] == checked['beforeManifest']
                and checked['passed'] is True and checked['afterManifest'] == manifest
                and checked['beforeEntry'] == prior_metadata['files'][prior_metadata['entry']]
                and checked['afterEntry'] == metadata['files'][metadata['entry']], f'Program verification differs: {game}')
        packages[game] = SimpleNamespace(folder=package, old=old_path, pointer=pointer, prior=prior, size=size)
        prefix = f'module-dist/{game}/versions/{version}/'
        expected_files.update({prefix + name: digest for name, digest in files.items()})
        expected_files[f'module-dist/{game}/active.json'] = row['pointerSha256']
    require(release['files'] == expected_files and release['packages'] == [
        {'gameId': game, 'version': operator['packages'][game]['version'], 'pointer': f'module-dist/{game}/active.json'}
        for game in GAMES], 'Release package inventory differs')
    return packages


def backup(packages, sources, image, publisher):
    BACKUP.mkdir(mode=0o700)
    saved = {name: data for name, (data, _) in sources.items()}
    saved['host.json'] = read(STATE / 'host.json')
    for game, package in packages.items():
        saved[f'{game}/active.json'] = package.prior
        saved[f'{game}/prior-manifest.json'] = read(package.old / 'manifest.json')
        shutil.copytree(package.old, BACKUP / game, copy_function=os.link)
        publisher.verify(BACKUP / game, CONTRACT, game)
    archive = BACKUP / 'source.tgz'
    with tarfile.open(archive, 'x:gz') as output:
        for name, data in sorted(saved.items()):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(data), 0o600
            output.addfile(entry, io.BytesIO(data))
    archive.chmod(0o600)
    with tarfile.open(archive) as source:
        require({entry.name: source.extractfile(entry).read() for entry in source} == saved, 'Source backup verification failed')
    tag = 'royal-game:before-' + NAME
    command(['docker', 'tag', image, tag])
    reader = load_python(HELPERS / 'image_metadata.py', 'autoplay_image_metadata')
    require(reader.image(tag) == image, 'Rollback image tag verification failed')
    return {'sourceArchive': str(archive), 'sha256': sha(read(archive)), 'bytes': archive.stat().st_size,
            'oldVersions': {game: package.old.name for game, package in packages.items()},
            'imageTag': tag, 'image': image, 'oldPackagesHardlinked': True}


def publish(operator, before, release, proof):
    require(not (ROOT / 'published.json').exists() and not BACKUP.exists(), 'Publication already attempted')
    current = snapshot()
    check_inventory(current, before)
    require(current['container']['health'] == 'healthy', 'Host is unhealthy')
    publisher = load_python(PUBLISHER, 'autoplay_module_publisher')
    packages = prepare_packages(operator, before, release, proof, publisher)
    require(current['availableBytes'] > MIN_FREE + 3 * sum(package.size for package in packages.values()) + 12 * 1024**2,
            'Server disk reserve would be crossed')
    sources = {name: (read(LIVE / name), stat.S_IMODE((LIVE / name).stat().st_mode)) for name in SOURCES}
    require(all(sha(data) == before['source'][name] for name, (data, _) in sources.items()), 'Production source changed')
    saved = backup(packages, sources, current['container']['image'], publisher)
    save('backup.json', saved)
    results, updated_sources = [], []
    expected = {**before, 'source': {**before['source'], **operator['source']},
                'sourceLF': {**before['sourceLF'], **operator['source']},
                'moduleFiles': {**before['moduleFiles'], **{
                    str(MODULES / name.removeprefix('module-dist/')): digest for name, digest in release['files'].items()}}}
    try:
        for name in sorted(SOURCES):
            atomic(LIVE / name, read(ROOT / 'source' / name), sources[name][1])
            updated_sources.append(name)
        for game, package in packages.items():
            result = publisher.run(SimpleNamespace(operation='install', package=str(package.folder), game=game,
                                                   root=str(MODULES), state=str(STATE), expected_sha=sha(package.prior)))
            require(result['activeSha256'] == operator['packages'][game]['pointerSha256'], f'Installed pointer differs: {game}')
            results.append(result)
        after = snapshot()
        check_inventory(after, expected)
        require(after['availableBytes'] > MIN_FREE, 'Server disk reserve crossed')
        save('after.json', after)
        record = {'published': True, 'release': NAME, 'sourceCommit': operator['sourceCommit'],
                  'baseCommit': before['sourceCommit'], 'backup': saved, 'modules': results,
                  'freeBefore': current['availableBytes'], 'freeAfter': after['availableBytes'],
                  'hostRestarted': False, 'databaseTouched': False, 'otherModulesPreserved': True,
                  'runtimeFilesPreserved': len(before['program']), 'servicesPreserved': len(before['services'])}
        save('published.json', record)
        return record
    except BaseException as error:
        failures = []
        for game, package in reversed(list(packages.items())):
            try:
                active = read(package.pointer)
                if active == package.prior:
                    continue
                require(sha(active) == operator['packages'][game]['pointerSha256'], f'Unexpected pointer during rollback: {game}')
                publisher.run(SimpleNamespace(operation='rollback', version=package.old.name, game=game,
                                              root=str(MODULES), state=str(STATE), expected_sha=sha(active)))
                require(read(package.pointer) == package.prior, f'Prior pointer did not restore: {game}')
            except Exception as rollback_error:
                failures.append(str(rollback_error))
        for name in reversed(updated_sources):
            try:
                atomic(LIVE / name, *sources[name])
            except Exception as rollback_error:
                failures.append(str(rollback_error))
        if failures:
            raise RuntimeError('Publication rollback requires review: ' + ', '.join(failures)) from error
        raise


def main():
    require(Path(__file__).resolve() == ROOT / 'publish.py' and not sys.argv[1:], 'Unexpected installer invocation')
    arguments = inputs()
    with ExitStack() as stack:
        for path in LOCKS:
            stream = stack.enter_context(safe(path).open('a'))
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('A production publication lock is busy.', file=sys.stderr)
                return 75
        print(json.dumps(publish(*arguments)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
