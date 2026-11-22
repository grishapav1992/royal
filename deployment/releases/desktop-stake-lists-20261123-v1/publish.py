"""Switch the verified Dracona and Forest Heart packages on the current host."""
from contextlib import ExitStack
import fcntl
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
from types import SimpleNamespace

sys.dont_write_bytecode = True
NAME = 'desktop-stake-lists-20261123-v1'
ROOT = Path('/opt/royal-releases') / NAME
SLUGS = ('dracona', 'forest-heart')
GAMES = tuple('studio-' + slug for slug in SLUGS)
SOURCES = {f'games/{slug}/priorityStyles.ts' for slug in SLUGS}
CONTRACTS = {
    'studio-dracona': {'apiVersion': 1, 'rulesVersion': 3, 'progressVersion': 2},
    'studio-forest-heart': {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1},
}


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def prepare_packages(guard, operator, before, release, proof, publisher):
    expected_files, packages = {}, {}
    for game in GAMES:
        contract = CONTRACTS[game]
        require(before['moduleHost']['games'][game] == contract, f'Unsupported host contract: {game}')
        package = ROOT / 'packages' / game
        metadata, size = publisher.verify(package, contract, game)
        version = metadata['version']
        manifest = guard.sha(guard.read(package / 'manifest.json'))
        row = operator['packages'][game]
        files = {'manifest.json': manifest, **metadata['files']}
        require(version == row['version'] and files == row['files'], f'Unexpected package: {game}')
        pointer = guard.MODULES / game / 'active.json'
        prior = guard.read(pointer)
        previous = json.loads(prior)
        prior_version = previous['manifest'].split('/')[4]
        require(guard.sha(prior) == before['moduleFiles'][str(pointer)] == row['beforePointerSha256']
                and guard.VERSION.fullmatch(prior_version) and prior_version != version, f'Prior pointer changed: {game}')
        prior_path = guard.MODULES / game / 'versions' / prior_version
        prior_metadata, _ = publisher.verify(prior_path, contract, game)
        prior_manifest = guard.sha(guard.read(prior_path / 'manifest.json'))
        checked = proof['games'][game]
        require(checked['passed'] is True and checked['beforeManifest'] == previous['sha256'] == prior_manifest
                and checked['afterManifest'] == manifest
                and checked['beforeEntry'] == prior_metadata['files'][prior_metadata['entry']]
                and checked['afterEntry'] == metadata['files'][metadata['entry']], f'Program evidence differs: {game}')
        media = lambda file_map: {name: digest for name, digest in file_map.items() if name.startswith('media/')}
        require(media(metadata['files']) == media(prior_metadata['files']), f'Media differs: {game}')
        packages[game] = SimpleNamespace(folder=package, old=prior_path, pointer=pointer, prior=prior, size=size)
        prefix = f'module-dist/{game}/versions/{version}/'
        expected_files.update({prefix + name: digest for name, digest in files.items()})
        expected_files[f'module-dist/{game}/active.json'] = row['pointerSha256']
    require(release['files'] == expected_files and release['packages'] == [
        {'gameId': game, 'version': operator['packages'][game]['version'], 'pointer': f'module-dist/{game}/active.json'}
        for game in GAMES], 'Release package inventory differs')
    return packages


def backup(guard, packages, sources, image, publisher):
    guard.BACKUP.mkdir(mode=0o700)
    saved = {name: data for name, (data, _) in sources.items()}
    saved['host.json'] = guard.read(guard.STATE / 'host.json')
    for game, package in packages.items():
        saved[f'{game}/active.json'] = package.prior
        saved[f'{game}/prior-manifest.json'] = guard.read(package.old / 'manifest.json')
        shutil.copytree(package.old, guard.BACKUP / game, copy_function=os.link)
        publisher.verify(guard.BACKUP / game, CONTRACTS[game], game)
    archive = guard.BACKUP / 'source.tgz'
    with tarfile.open(archive, 'x:gz') as output:
        for name, data in sorted(saved.items()):
            entry = tarfile.TarInfo(name)
            entry.size, entry.mode = len(data), 0o600
            output.addfile(entry, io.BytesIO(data))
    archive.chmod(0o600)
    with tarfile.open(archive) as source:
        require({entry.name: source.extractfile(entry).read() for entry in source} == saved, 'Source backup differs')
    tag = 'royal-game:before-' + NAME
    guard.command(['docker', 'tag', image, tag])
    reader = guard.load_python(guard.HELPERS / 'image_metadata.py', 'desktop_stakes_image_reader')
    require(reader.image(tag) == image, 'Rollback image tag differs')
    return {'sourceArchive': str(archive), 'sha256': guard.sha(guard.read(archive)), 'bytes': archive.stat().st_size,
            'oldVersions': {game: package.old.name for game, package in packages.items()},
            'imageTag': tag, 'image': image, 'oldPackagesHardlinked': True}


def main():
    require(Path(__file__).resolve() == ROOT / 'publish.py' and not sys.argv[1:], 'Unexpected installer invocation')
    operator_path = ROOT / 'operator.json'
    receipt_path = ROOT / 'installer-github.json'
    guard_path = ROOT / 'scope-guard.py'
    require(all(path.is_file() and not path.is_symlink() for path in [operator_path, receipt_path, guard_path]),
            'Missing regular installer evidence')
    operator = json.loads(operator_path.read_bytes())
    receipt = json.loads(receipt_path.read_bytes())
    require(sha256(receipt_path.read_bytes()).hexdigest() == operator['installerReceiptSha256']
            and re.fullmatch('[a-f0-9]{40}', receipt['sourceCommit'])
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and receipt['applicationSourceCommit'] == operator['sourceCommit'], 'Installer receipt differs')
    require(sha256(guard_path.read_bytes()).hexdigest() == receipt['guardSha256']
            and sha256((ROOT / 'publish.py').read_bytes()).hexdigest() == receipt['publishSha256'], 'Installer changed')
    spec = importlib.util.spec_from_file_location('desktop_stakes_scope_guard', guard_path)
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    guard.NAME, guard.ROOT, guard.BACKUP = NAME, ROOT, Path('/opt/royal-backups') / NAME
    guard.HELPERS = ROOT.with_name('royal-stake-100-20261122-v2')
    guard.SLUGS, guard.GAMES, guard.SOURCES = SLUGS, GAMES, SOURCES
    guard.prepare_packages = lambda *args: prepare_packages(guard, *args)
    guard.backup = lambda *args: backup(guard, *args)
    arguments = guard.inputs()
    with ExitStack() as stack:
        for path in guard.LOCKS:
            stream = stack.enter_context(guard.safe(path).open('a'))
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('A production publication lock is busy.', file=sys.stderr)
                return 75
        print(json.dumps(guard.publish(*arguments)), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
