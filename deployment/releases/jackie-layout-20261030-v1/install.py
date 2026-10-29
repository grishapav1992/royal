"""Publish the compatible layout package while preserving the running host and all other games."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
GAME = 'original-jackie-chan'
PREVIOUS = Path('/opt/royal-releases/jackie-chan-20261029-v2')


def require(value, message):
    if not value:
        raise RuntimeError(message)


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True)
    args = parser.parse_args()
    release = json.loads((ROOT / 'release-manifest.json').read_text())
    receipt = json.loads((ROOT / 'release-github.json').read_text())
    require(release['scope'] == 'modules' and release['modules'] == ['jackie-chan'], 'Unexpected release scope')
    require(release['sourceCommit'] == receipt['sourceCommit'], 'GitHub source receipt differs')
    require(release['packages'] == [{'gameId': GAME, 'version': '1.0.1-b1c164533d84',
                                   'pointer': 'module-dist/' + GAME + '/active.json'}], 'Unexpected package')
    package = Path(args.package).resolve()
    prefix = 'module-dist/' + GAME + '/versions/' + package.name + '/'
    expected = {name[len(prefix):]: digest for name, digest in release['files'].items() if name.startswith(prefix)}
    require(len(expected) == 37, 'Incomplete release package')
    for name, digest in expected.items():
        require(hashlib.sha256((package / name).read_bytes()).hexdigest() == digest, 'Prepared bytes differ: ' + name)
    snapshot = load_module('production_snapshot', PREVIOUS / 'snapshot.py')
    publisher = load_module('module_publisher', ROOT / 'game-module-release.py')
    locks = []
    for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock',
                 '/opt/royal-game-modules-state/module.lock']:
        handle = open(name, 'a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(handle)
    before = snapshot.snapshot()
    save('before.json', before)
    previous = json.loads((PREVIOUS / 'after.json').read_text())
    stable = ['sourceRevision', 'source', 'financeSource', 'program', 'financialProgram',
              'configuration', 'hostContract', 'moduleHost', 'preparedImage']
    for key in stable:
        require(before[key] == previous[key], 'Production baseline differs: ' + key)
    options = SimpleNamespace(operation='check', package=str(package), version=None, game=GAME,
        expected_sha='dc4c78141d146d8380b0e6b61e02301d66b4bfc9b462da29d499863c5bbbf9b0',
        root='/opt/royal-game-modules', state='/opt/royal-game-modules-state')
    checked = publisher.run(options)
    save('package-check.json', checked)
    require(before['freeBytes'] >= 5 * 1024**3 + checked['bytes'] + 2 * 1024**2, 'Need 5 GiB reserve after publication')
    backup = Path('/opt/royal-backups') / ROOT.name
    backup.mkdir(mode=0o700)
    archive = backup / 'game-source.tgz'
    with tarfile.open(archive, 'w:gz') as output:
        output.add('/opt/royal/games/jackie-chan', arcname='games/jackie-chan', recursive=True)
        output.add('/opt/royal-game-modules/original-jackie-chan/active.json', arcname='active.json')
        output.add('/opt/royal-game-modules-state/host.json', arcname='host.json')
    old_image = before['containers']['royal-game-1']['image']
    tag = 'royal-game:before-' + ROOT.name
    subprocess.run(['docker', 'tag', old_image, tag], check=True)
    save('backup.json', {'path': str(archive), 'bytes': archive.stat().st_size,
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'image': old_image, 'tag': tag,
        'retainedPriorPackage': '/opt/royal-game-modules/original-jackie-chan/versions/1.0.0-ebe2d87de8aa',
        'fullSourceBackup': '/opt/royal-backups/jackie-chan-20261029-v2', 'databaseTouched': False})
    options.operation = 'install'
    result = publisher.run(options)
    save('published.json', result)
    after = snapshot.snapshot()
    save('after.json', after)
    for key in [*stable, 'containers']:
        require(before[key] == after[key], 'Unexpected production change: ' + key)
    pointer = '/opt/royal-game-modules/' + GAME + '/active.json'
    version = '/opt/royal-game-modules/' + GAME + '/versions/' + package.name + '/'
    preserved = {name: digest for name, digest in after['modules'].items() if name != pointer and not name.startswith(version)}
    require(preserved == {name: digest for name, digest in before['modules'].items() if name != pointer}, 'Another module changed')
    require(after['freeBytes'] >= 5 * 1024**3, 'Less than 5 GiB reserve')
    save('verification.json', {'sourceCommit': release['sourceCommit'], 'version': result['version'],
        'manifestSha256': expected['manifest.json'], 'activeSha256': result['activeSha256'],
        'preservedRuntimeFiles': len(before['program']), 'preservedSourceFiles': len(before['source']),
        'preservedFinanceSourceFiles': len(before['financeSource']), 'preservedServices': len(before['containers']),
        'preservedOtherPointers': sum(name.endswith('/active.json') and name != pointer for name in before['modules']),
        'freeBefore': before['freeBytes'], 'freeAfter': after['freeBytes'], 'restartRequired': False,
        'databaseTouched': False, 'verified': True})
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
