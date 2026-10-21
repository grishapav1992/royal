"""Publish only the reviewed GIRLHUB package and its two matching source files."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
NAME = 'girlhub-sidebar-20261021-v1'
BACKUP = Path('/opt/royal-backups') / NAME
PUBLIC = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = json.loads((ROOT / 'before.json').read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args):
    return subprocess.check_output(args, text=True).strip()


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def snapshot():
    return json.loads(run(['python3', str(ROOT / 'snapshot.py')]))


def baseline():
    state = snapshot()
    for key in ['source', 'configHashes', 'container', 'services', 'moduleHostContract',
                'realMoneyFlags', 'preparedImage', 'program', 'preparedProgram', 'moduleFiles']:
        require(state[key] == OLD[key], 'Production changed since inspection: ' + key)
    require(state['container']['health'] == 'healthy', 'Game is not healthy')
    return state


def publisher():
    path = LIVE / 'scripts/game-module-release.py'
    require(sha(path) == M['publisherSha256'], 'Publisher changed')
    spec = importlib.util.spec_from_file_location('reviewed_publisher', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arguments(operation):
    return SimpleNamespace(operation=operation, package=str(ROOT / 'package'),
                           game='studio-afterglow', version=None,
                           expected_sha=M['pointerBeforeSha256'], root=str(PUBLIC), state=str(STATE))


def payload():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release path')
    require(re.fullmatch('[a-f0-9]{40}', M['sourceCommit']), 'Missing pushed source commit')
    require(set(M['changes']) == {'src/ui/afterglow.css', 'games/girlhub/package.json'}, 'Unexpected source changes')
    require(sha(ROOT / 'deploy.py') == M['deploySha256'], 'Deployment helper changed')
    require(sha(ROOT / 'snapshot.py') == M['snapshotSha256'], 'Snapshot helper changed')
    for name, digest in M['requiredSource'].items():
        require(OLD['source'].get(name) == digest, 'Inspected source does not match Git baseline: ' + name)
        require(sha(LIVE / name) == digest, 'Required production source changed: ' + name)
    for name, digest in M['changes'].items():
        require(sha(ROOT / 'source' / name) == digest, 'Source payload changed: ' + name)
    checked = publisher().run(arguments('check'))
    require(checked['version'] == M['moduleVersion'], 'Unexpected module version')
    require(checked['beforeSha256'] == M['pointerBeforeSha256'], 'Active GIRLHUB package changed')
    return checked


def backup():
    require(not BACKUP.exists(), 'Backup already exists; inspect the preceding attempt')
    BACKUP.mkdir(mode=0o700)
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in OLD['source'].items():
            path = PurePosixPath(name)
            require(not path.is_absolute() and not any(part in ['..', '.', 'secrets', 'data', 'node_modules']
                    or part.startswith('.env') for part in path.parts), 'Unsafe source backup path')
            require(sha(LIVE / name) == digest, 'Source changed during backup: ' + name)
            archive.add(LIVE / name, arcname=name, recursive=False)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        saved = {item.name: hashlib.sha256(archive.extractfile(item).read()).hexdigest()
                 for item in archive.getmembers()}
    require(saved == OLD['source'], 'Source backup verification failed')
    shutil.copy2(PUBLIC / 'studio-afterglow/active.json', BACKUP / 'active.json')
    shutil.copy2(ROOT / 'before.json', BACKUP / 'before.json')
    for suffix, image in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        tag = 'royal-game:before-' + NAME + suffix
        run(['docker', 'tag', image, tag])
        require(run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}']) == image, 'Image backup tag differs')
    return sha(BACKUP / 'source.tgz')


def atomic_bytes(path, content):
    temporary = path.with_name(path.name + '.girlhub-next')
    require(not path.is_symlink() and not temporary.exists(), 'Unexpected source path')
    with temporary.open('xb') as target:
        target.write(content)
        target.flush()
        import os
        os.fsync(target.fileno())
    shutil.copymode(path, temporary)
    temporary.replace(path)


def verify():
    after = snapshot()
    expected_source = {**OLD['source'], **M['changes']}
    require(after['source'] == expected_source, 'Published source inventory differs')
    for key in ['configHashes', 'container', 'services', 'moduleHostContract',
                'realMoneyFlags', 'preparedImage', 'program', 'preparedProgram']:
        require(after[key] == OLD[key], 'Protected production state changed: ' + key)
    expected_modules = dict(OLD['moduleFiles'])
    manifest = json.loads((ROOT / 'package/manifest.json').read_text())
    destination = PUBLIC / 'studio-afterglow/versions' / M['moduleVersion']
    for name, digest in {**manifest['files'], 'manifest.json': sha(ROOT / 'package/manifest.json')}.items():
        expected_modules[str(destination / name)] = digest
    pointer = PUBLIC / 'studio-afterglow/active.json'
    expected_modules[str(pointer)] = sha(pointer)
    require(after['moduleFiles'] == expected_modules, 'Unexpected module resource changes')
    require(json.loads(pointer.read_text())['manifest'].split('/')[-2] == M['moduleVersion'], 'Wrong active module')
    write('after.json', after)
    result = {'release': NAME, 'sourceCommit': M['sourceCommit'], 'moduleVersion': M['moduleVersion'],
              'manifestSha256': sha(ROOT / 'package/manifest.json'), 'verified': True,
              'backup': str(BACKUP), 'backupSourceSha256': sha(BACKUP / 'source.tgz'),
              'sourceFiles': len(after['source']), 'sourceChanges': sorted(M['changes']),
              'containerUnchanged': True, 'otherModulesUnchanged': True,
              'settingsAndVolumesUnchanged': True, 'sharedProgramsUnchanged': True}
    write('verified.json', result)
    return result


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'publish', 'verify'], 'Choose check, publish or verify')
    with (LIVE / '.client-presentation-deploy.lock').open('a') as app_lock, (STATE / 'module.lock').open('a') as module_lock:
        fcntl.flock(app_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] == 'verify':
            print(json.dumps(verify()))
            return
        checked = payload()
        baseline()
        if sys.argv[1] == 'check':
            print(json.dumps(checked))
            return
        backup_sha = backup()
        original = {name: (LIVE / name).read_bytes() for name in M['changes']}
        try:
            for name in M['changes']:
                atomic_bytes(LIVE / name, (ROOT / 'source' / name).read_bytes())
            installed = publisher().run(arguments('install'))
        except Exception:
            if sha(PUBLIC / 'studio-afterglow/active.json') == M['pointerBeforeSha256']:
                for name, content in original.items():
                    atomic_bytes(LIVE / name, content)
            raise
        write('published.json', {**installed, 'sourceCommit': M['sourceCommit'], 'backupSourceSha256': backup_sha})
        print(json.dumps(verify()))


if __name__ == '__main__':
    main()
