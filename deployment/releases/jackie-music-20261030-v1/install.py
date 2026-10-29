"""Guarded compatible music update, preserving the running host and retained clients."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
from types import SimpleNamespace
from media_storage import deduplicate, plain, sha

ROOT = Path(__file__).resolve().parent
GAME = 'original-jackie-chan'
VERSION = '1.1.0-d7adf4f69d77'
OLD = '1.0.1-b1c164533d84'
PRIOR = Path('/opt/royal-releases/jackie-chan-20261029-v2')
VERSIONS = Path('/opt/royal-game-modules') / GAME / 'versions'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def save(name, value):
    data = (json.dumps(value, indent=2) + '\n').encode()
    if name in ['before.json', 'after.json']:
        (ROOT / (name + '.gz')).write_bytes(gzip.compress(data))
    else:
        (ROOT / name).write_bytes(data)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    import fcntl
    parser = argparse.ArgumentParser(); parser.add_argument('--package', required=True); args = parser.parse_args()
    release = json.loads((ROOT / 'release-manifest.json').read_text())
    receipt = json.loads((ROOT / 'release-github.json').read_text())
    require(release['scope'] == 'modules' and release['modules'] == ['jackie-chan'], 'Unexpected scope')
    require(release['sourceCommit'] == receipt['sourceCommit'], 'GitHub source receipt differs')
    require(release['packages'] == [{'gameId': GAME, 'version': VERSION, 'pointer': 'module-dist/' + GAME + '/active.json'}], 'Unexpected package')
    package = Path(args.package).resolve(strict=True)
    require(package.parent == ROOT and package.name == VERSION, 'Unexpected incoming path')
    prefix = 'module-dist/' + GAME + '/versions/' + VERSION + '/'
    expected = {name[len(prefix):]: digest for name, digest in release['files'].items() if name.startswith(prefix)}
    require(len(expected) == 40 and sha(package / 'manifest.json') == expected['manifest.json'], 'Incomplete prepared package')
    publisher = load_module('module_publisher', ROOT / 'game-module-release.py')
    snapshot = load_module('production_snapshot', PRIOR / 'snapshot.py')
    locks = []
    for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(handle)
    pointer = '/opt/royal-game-modules/' + GAME + '/active.json'
    old_sha = '8b57e1df78b1c227b4f3ed5611afa970103863c5fa460786007b6c6d817da7ac'
    require(publisher.active_sha(Path(pointer)) == old_sha, 'Production module changed')
    contract = json.loads(Path('/opt/royal-game-modules-state/host.json').read_text())['games'][GAME]
    publisher.verify(VERSIONS / OLD, contract, GAME)
    publisher.verify(VERSIONS / '1.0.0-ebe2d87de8aa', contract, GAME)
    save('media-storage-before.json', deduplicate(VERSIONS / '1.0.0-ebe2d87de8aa', VERSIONS / OLD))
    old_manifest = json.loads((VERSIONS / OLD / 'manifest.json').read_text())
    # Do not stage a second physical copy of unchanged artwork.
    for name, digest in expected.items():
        destination = package / name
        if not destination.exists():
            require(name.startswith('media/') and old_manifest['files'].get(name) == digest, 'New resource was not uploaded: ' + name)
            source = plain(VERSIONS / OLD, name); require(sha(source) == digest, 'Retained media differs')
            destination.parent.mkdir(parents=True, exist_ok=True); os.link(source, destination)
        require(sha(plain(package, name)) == digest, 'Prepared bytes differ: ' + name)
    options = SimpleNamespace(operation='check', package=str(package), version=None, game=GAME,
        expected_sha=old_sha, root='/opt/royal-game-modules', state='/opt/royal-game-modules-state')
    checked = publisher.run(options); save('package-check.json', checked)
    before = snapshot.snapshot(); save('before.json', before)
    save('public-baseline.json', {name.replace('/opt/royal-game-modules/', '/game-modules/'): digest
         for name, digest in before['modules'].items() if name.endswith('/active.json') and name != pointer})
    previous = json.loads((PRIOR / 'after.json').read_text())
    overlay = json.loads((ROOT / 'baseline-overlay.json').read_text())
    require(overlay['sourceCommit'] == '0baa69d10ddea384ba7e58c499582d18e702de2c' and
            set(overlay['source']) == {'games/caribbean-treasures/' + name for name in
                ['CaribbeanUI.ts', 'CaribbeanCaptain.ts', 'caribbean.css', 'package.json', 'character-motion.md']}, 'Unexpected reviewed source overlay')
    previous['source'].update(overlay['source'])
    stable = ['sourceRevision', 'source', 'financeSource', 'program', 'financialProgram', 'configuration', 'hostContract', 'moduleHost', 'preparedImage']
    for key in stable:
        require(before[key] == previous[key], 'Production baseline differs: ' + key)
    require(before['freeBytes'] >= 5 * 1024**3 + checked['bytes'] + 2 * 1024**2, 'Need 5 GiB reserve after publication')
    backup = Path('/opt/royal-backups') / ROOT.name; backup.mkdir(mode=0o700)
    archive = backup / 'game-source.tgz'
    with tarfile.open(archive, 'w:gz') as output:
        output.add('/opt/royal/games/jackie-chan', arcname='games/jackie-chan')
        output.add(pointer, arcname='active.json')
        output.add('/opt/royal-game-modules-state/host.json', arcname='host.json')
    old_image = before['containers']['royal-game-1']['image']; tag = 'royal-game:before-' + ROOT.name
    subprocess.run(['docker', 'tag', old_image, tag], check=True)
    save('backup.json', {'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha(archive),
        'image': old_image, 'tag': tag, 'retainedPriorPackage': str(VERSIONS / OLD),
        'fullSourceBackup': '/opt/royal-backups/jackie-chan-20261029-v2', 'databaseTouched': False})
    options.operation = 'install'; result = publisher.run(options); save('published.json', result)
    save('media-storage-after.json', deduplicate(VERSIONS / '1.0.0-ebe2d87de8aa', VERSIONS / VERSION))
    after = snapshot.snapshot(); save('after.json', after)
    for key in [*stable, 'containers']:
        require(before[key] == after[key], 'Unexpected production change: ' + key)
    version_prefix = str(VERSIONS / VERSION) + '/'
    retained = {name: digest for name, digest in after['modules'].items() if name != pointer and not name.startswith(version_prefix)}
    require(retained == {name: digest for name, digest in before['modules'].items() if name != pointer}, 'Another module changed')
    require(after['freeBytes'] >= 5 * 1024**3, 'Less than 5 GiB reserve')
    save('verification.json', {'sourceCommit': release['sourceCommit'], 'version': VERSION,
        'manifestSha256': expected['manifest.json'], 'activeSha256': result['activeSha256'],
        'preservedRuntimeFiles': len(before['program']), 'preservedSourceFiles': len(before['source']),
        'preservedFinanceSourceFiles': len(before['financeSource']), 'preservedServices': len(before['containers']),
        'preservedOtherPointers': sum(name.endswith('/active.json') and name != pointer for name in before['modules']),
        'freeBefore': before['freeBytes'], 'freeAfter': after['freeBytes'], 'restartRequired': False,
        'databaseTouched': False, 'verified': True})
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
