"""Publish the reviewed roulette client and preserve the running host inventory."""
from contextlib import ExitStack, contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
from types import SimpleNamespace

NAME = 'roulette-ball-physics-20261105-v1'
GAME = 'royal-roulette'
ROOT = Path('/opt/royal-releases') / NAME
LIVE = Path('/opt/royal')
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
IMAGE_READER = Path('/opt/royal-maintenance/bin/retention-runtime.py')
LOCKS = (ROOT.parent / 'themed-publish.lock', LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock')
SOURCES = {'games/royal-roulette/' + name for name in (
    'SpinTimeline.ts', 'WheelArtwork.ts', 'package.json', 'priorities.css', 'roulette.css',
)}
CONTRACT = {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1}
MIN_FREE = 5 * 1024**3
sys.dont_write_bytecode = True


class PublicationBusy(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def safe(path):
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink rejected')
    return path


def sha(path):
    return hashlib.sha256(safe(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(safe(path).read_bytes())


def save(name, value):
    with safe(ROOT / name).open('x') as out:
        json.dump(value, out, indent=2)
        out.write('\n')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, safe(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def command(*args):
    return subprocess.check_output(args, text=True, timeout=600).strip()


def snapshot(reader):
    return json.loads(command('python3', str(reader)))


def stable(value):
    return {k: v for k, v in value.items() if k not in ('at', 'availableBytes')}


@contextmanager
def publication_locks():
    with ExitStack() as stack:
        for path in LOCKS:
            lock = stack.enter_context(safe(path).open('a'))
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise PublicationBusy('Publication busy; package preserved for explicit retry') from error
        yield


def validate_inputs(before, release, operator, proof):
    require(release['scope'] == 'modules' and release['modules'] == [GAME] and release['build']['passed'],
            'Unexpected release scope')
    require(release['sourceCommit'] == operator['sourceCommit']
            and release['baseCommit'] == operator['buildBaseCommit']
            and before['sourceCommit'] == operator['baseCommit'],
            'Unexpected release source or baseline')
    require(len(release['packages']) == 1 and release['packages'][0]['gameId'] == GAME, 'Foreign package')
    require(set(operator['source']) == SOURCES, 'Unexpected source update')
    require(proof['hostSingletonsExternalized'] and not proof['serverImplementationIncluded'], 'Unexpected module boundary')
    projection = release['moduleProjection']
    require(projection['productionCommit'] == release['baseCommit'], 'Unexpected compilation baseline')
    require(projection['modules'][GAME]['sourceFiles'] == proof['sourceFiles'], 'Compiler input inventory differs')
    inputs = projection['inputs']
    require(SOURCES.issubset(inputs), 'Changed files missing from compilation')
    for name, digest in inputs.items():
        require(digest == operator['source'].get(name, before['sourceLF'].get(name)), 'Unreviewed module input: ' + name)


def validate_after(before, after, source, files, pointer, version):
    expected = {**before, 'source': {**before['source'], **source}, 'sourceLF': {**before['sourceLF'], **source}}
    prefix = str(MODULES / GAME / 'versions' / version) + '/'
    expected['moduleFiles'] = {**before['moduleFiles'], **{prefix + n: h for n, h in files.items()},
                               str(MODULES / GAME / 'active.json'): pointer}
    require(stable(after) == stable(expected), 'Unexpected change outside the roulette source and package')


def replace_source(target, data):
    temporary = safe(target.with_name(target.name + '.' + NAME + '.partial'))
    safe(target)
    with temporary.open('xb') as out:
        out.write(data)
        os.fchmod(out.fileno(), 0o644)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, target)
    directory = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def publish_locked():
    require(not (ROOT / 'published.json').exists() and not BACKUP.exists(), 'Publication already attempted')
    operator = read(ROOT / 'operator.json')
    for name, key in (
        ('before.json', 'beforeSha256'), ('publish.py', 'installerSha256'), ('publisher.py', 'publisherSha256'),
        ('release-manifest.json', 'manifestSha256'), ('release-github.json', 'receiptSha256'),
        ('installer-github.json', 'installerReceiptSha256'), ('module-proof.json', 'proofSha256'),
    ):
        require(sha(ROOT / name) == operator[key], 'Publication input changed: ' + name)
    reader = Path(operator['snapshotReader'])
    require(reader.parent.parent == ROOT.parent and reader.name == 'snapshot.py'
            and re.fullmatch(r'[a-z0-9-]+', reader.parent.name), 'Unexpected snapshot reader')
    helpers = {reader, reader.with_name('snapshot-base.py'), reader.with_name('image_metadata.py'), IMAGE_READER}
    require(set(map(Path, operator['helpers'])) == helpers, 'Wrong production verification helpers')
    for name, digest in operator['helpers'].items():
        require(sha(Path(name)) == digest, 'Unreviewed production helper')
    before, release, receipt, installer, proof = (
        read(ROOT / name) for name in ('before.json', 'release-manifest.json', 'release-github.json',
                                       'installer-github.json', 'module-proof.json')
    )
    validate_inputs(before, release, operator, proof)
    require(release['githubVerified'] is True and receipt['sourceCommit'] == release['sourceCommit']
            and receipt['manifestSha256'] == operator['manifestSha256']
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain']), 'Missing GitHub release receipt')
    require(installer['sourceCommit'] == operator['installerSourceCommit'] and installer['includedInMain'] is True
            and re.fullmatch('[a-f0-9]{40}', installer['remoteMain'])
            and installer['files']['deployment/releases/' + NAME + '/publish.py'] == operator['installerSha256'],
            'Installer differs from the GitHub receipt')
    require(operator['publisherSha256'] == before['source']['scripts/game-module-release.py'], 'Unexpected installer engine')
    for name, digest in operator['source'].items():
        require(sha(ROOT / 'source' / name) == digest, 'Changed source payload: ' + name)
    current = snapshot(reader)
    require(stable(current) == stable(before) and current['container']['health'] == 'healthy',
            'Production changed since review')
    require(read(STATE / 'host.json')['games'][GAME] == CONTRACT, 'Incompatible roulette host')
    publisher = load('roulette_publisher', ROOT / 'publisher.py')
    metadata, size = publisher.verify(ROOT / 'package', CONTRACT, GAME)
    version = release['packages'][0]['version']
    require(metadata['version'] == proof['version'] == version and metadata['sourceSha256'] == proof['sourceSha256'],
            'Unexpected package identity')
    files = {'manifest.json': sha(ROOT / 'package' / 'manifest.json'), **metadata['files']}
    prefix = 'module-dist/' + GAME + '/'
    require(release['files'] == {**{prefix + 'versions/' + version + '/' + n: h for n, h in files.items()},
                                 prefix + 'active.json': operator['pointerSha256']}, 'Unexpected package bytes')
    require(shutil.disk_usage(LIVE).free > MIN_FREE + size * 3 + 12 * 1024**2, 'Five GiB reserve would be crossed')
    active = MODULES / GAME / 'active.json'
    old_pointer = read(active)
    old_version = old_pointer['manifest'].split('/')[4]
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}', old_version), 'Invalid previous version')
    require(old_version == operator['oldVersion'] and version != old_version, 'Unexpected previous package')
    old_package = MODULES / GAME / 'versions' / old_version
    publisher.verify(old_package, CONTRACT, GAME)
    image = current['container']['image']
    tag = 'royal-game:before-' + NAME
    command('docker', 'tag', image, tag)
    image_reader = load('roulette_image_reader', IMAGE_READER)
    tagged = image_reader.image_metadata(image)
    require(tagged['Id'] == image and tag in tagged['RepoTags'], 'Exact rollback image tag missing')
    BACKUP.mkdir(mode=0o700)
    archive_path = BACKUP / 'source.tgz'
    with tarfile.open(archive_path, 'w:gz') as archive:
        for name in sorted(SOURCES):
            archive.add(safe(LIVE / name), arcname=name, recursive=False)
        archive.add(safe(active), arcname='active.json', recursive=False)
        archive.add(safe(old_package / 'manifest.json'), arcname='prior-manifest.json', recursive=False)
        archive.add(safe(STATE / 'host.json'), arcname='host.json', recursive=False)
    archive_path.chmod(0o600)
    expected_pointer = before['moduleFiles'][str(active)]
    expected = {n: before['source'][n] for n in SOURCES}
    expected.update({'active.json': expected_pointer, 'prior-manifest.json': old_pointer['sha256'],
                     'host.json': before['moduleHostContract']})
    with tarfile.open(archive_path, 'r:gz') as archive:
        original = {m.name: archive.extractfile(m).read() for m in archive if m.isfile()}
    require({n: hashlib.sha256(data).hexdigest() for n, data in original.items()} == expected, 'Backup verification failed')
    shutil.copytree(old_package, BACKUP / 'package', copy_function=os.link)
    publisher.verify(BACKUP / 'package', CONTRACT, GAME)
    backup = {'sourceArchive': str(archive_path), 'bytes': archive_path.stat().st_size, 'sha256': sha(archive_path),
              'oldVersion': old_version, 'oldPackageHardlinked': True, 'imageTag': tag, 'image': image}
    save('backup.json', backup)
    options = SimpleNamespace(operation='install', package=str(ROOT / 'package'), game=GAME, root=str(MODULES),
                              state=str(STATE), expected_sha=expected_pointer)
    try:
        for name in sorted(SOURCES):
            require(sha(LIVE / name) == expected[name], 'Source changed before replacement')
            replace_source(LIVE / name, safe(ROOT / 'source' / name).read_bytes())
        mask = os.umask(0o022)
        try:
            result = publisher.run(options)
        finally:
            os.umask(mask)
        require(result['activeSha256'] == operator['pointerSha256'], 'Published pointer differs')
        after = snapshot(reader)
        validate_after(before, after, operator['source'], files, operator['pointerSha256'], version)
        require(shutil.disk_usage(LIVE).free > MIN_FREE, 'Five GiB reserve crossed')
    except Exception:
        if sha(active) == operator['pointerSha256']:
            options.operation, options.version, options.expected_sha = 'rollback', old_version, operator['pointerSha256']
            publisher.run(options)
        require(sha(active) == expected_pointer, 'Unexpected pointer during recovery')
        for name in sorted(SOURCES):
            digest = sha(LIVE / name)
            if digest == operator['source'][name]:
                replace_source(LIVE / name, original[name])
            require(sha(LIVE / name) == expected[name], 'Unexpected source during recovery')
        raise
    save('after.json', after)
    record = {'published': True, 'release': NAME, 'sourceCommit': release['sourceCommit'],
              'baseCommit': before['sourceCommit'], 'buildBaseCommit': release['baseCommit'],
              'installerSourceCommit': operator['installerSourceCommit'], 'module': result, 'backup': backup,
              'freeBefore': before['availableBytes'], 'freeAfter': after['availableBytes'],
              'hostRestarted': False, 'databaseTouched': False, 'otherModulesPreserved': True,
              'sourceFilesPreserved': len(before['source']) - len(SOURCES),
              'runtimeFilesPreserved': len(before['program']), 'servicesPreserved': len(before['services'])}
    save('published.json', record)
    print(json.dumps(record))


def main():
    require(Path(__file__).resolve() == ROOT / 'publish.py' and sys.argv[1:] == ['release'], 'Unexpected installer invocation')
    require(all(safe(path).is_dir() for path in (ROOT, LIVE, MODULES, STATE)), 'Missing production paths')
    try:
        with publication_locks():
            publish_locked()
    except PublicationBusy as error:
        print(str(error), file=sys.stderr)
        return 75
    return 0


if __name__ == '__main__':
    sys.exit(main())
