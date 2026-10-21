"""Guarded single-game publication without changing host programs or user data."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import fcntl
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
NAME = 'cr-leo-global-load-20261021-v1'
GAME = 'original-cr-vs-leo'
PUBLIC = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args):
    return subprocess.check_output(args, text=True).strip()


def snapshot():
    return json.loads(run(['python3', str(ROOT / 'snapshot.py')]))


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def publisher():
    spec = importlib.util.spec_from_file_location('reviewed_publisher', ROOT / 'publisher.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def args(operation):
    return SimpleNamespace(operation=operation, package=str(ROOT / 'package'), game=GAME,
                           version=None, expected_sha=M['externalPointerSha256'], root=str(PUBLIC), state=str(STATE))


def unchanged(after):
    for key in ['configHashes', 'container', 'services', 'moduleHostContract', 'realMoneyFlags',
                'preparedImage', 'program', 'preparedProgram']:
        require(after[key] == OLD[key], 'Host or production settings changed: ' + key)


def validate():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release path')
    require(len(M['sourceCommit']) == 40, 'Missing source commit')
    for name, digest in M['helpers'].items():
        require(sha(ROOT / name) == digest, 'Reviewed helper changed: ' + name)
    require(set(M['changes']) == {'src/ui/CrLeoScene.ts', 'src/ui/crLeoAssets.ts', 'docs/cr-vs-leo.md'}, 'Unexpected source delta')
    for collection, folder in [(M['changes'], 'source'), (M['packageFiles'], 'package')]:
        for name, digest in collection.items():
            path = PurePosixPath(name)
            require(str(path) == name and not path.is_absolute() and not any(part in ['..', '.', '.git', 'data', 'secrets'] or part.startswith('.env') for part in path.parts), 'Unsafe payload path')
            target = ROOT / folder / name
            require(target.is_file() and not any(p.is_symlink() for p in [target, *target.parents]), 'Missing or symbolic payload')
            require(sha(target) == digest, 'Payload changed: ' + name)
    checked = publisher().run(args('check'))
    require(checked['version'] == M['moduleVersion'] and checked['beforeSha256'] == M['externalPointerSha256'], 'Module pointer changed')
    before = snapshot()
    unchanged(before)
    for key in ['source', 'moduleFiles']:
        require(before[key] == OLD[key], 'Production baseline changed: ' + key)
    require(before['container']['health'] == 'healthy', 'Application is not healthy')
    require(before['availableBytes'] > 500 * 1024**2, 'Insufficient backup capacity')
    return checked


def atomic(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.cr-leo-next')
    require(not temporary.exists(), 'Unexpected temporary file')
    shutil.copy2(source, temporary)
    temporary.replace(target)


def backup():
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in OLD['source'].items():
            require(sha(LIVE / name) == digest, 'Source changed during backup: ' + name)
            archive.add(LIVE / name, arcname=name, recursive=False)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        saved = {m.name: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers()}
        require(saved == OLD['source'], 'Source backup differs')
    pointer = PUBLIC / GAME / 'active.json'
    if pointer.is_file():
        shutil.copy2(pointer, BACKUP / 'active.json')
    for suffix, ref in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        run(['docker', 'tag', ref, 'royal-game:before-' + NAME + suffix])
    write('backup.json', {'path': str(BACKUP), 'sourceSha256': sha(BACKUP / 'source.tgz'), 'priorExternalPointer': pointer.is_file()})


def restore():
    pointer = PUBLIC / GAME / 'active.json'
    if (BACKUP / 'active.json').is_file():
        atomic(BACKUP / 'active.json', pointer)
    else:
        pointer.unlink(missing_ok=True)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        for name in M['changes']:
            target = ROOT / 'restore' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(name).read())
            atomic(target, LIVE / name)
    write('recovered.json', {'priorPointerAndSourceRestored': True, 'immutableVersionRetained': True, 'databaseTouched': False})


def publish():
    validate()
    backup()
    # Hold both publisher locks through baseline comparison, switch and verification.
    try:
        for name in M['changes']:
            atomic(ROOT / 'source' / name, LIVE / name)
        installed = publisher().run(args('install'))
        after = snapshot()
        unchanged(after)
        require(after['source'] == {**OLD['source'], **M['changes']}, 'Published source differs')
        prefix = str(PUBLIC / GAME / 'versions' / M['moduleVersion']) + '/'
        expected = {**OLD['moduleFiles'], **{prefix + name: digest for name, digest in M['packageFiles'].items()},
                    str(PUBLIC / GAME / 'active.json'): installed['activeSha256']}
        require(after['moduleFiles'] == expected, 'Other module files changed')
        write('after.json', after)
        result = {'published': True, 'release': NAME, 'sourceCommit': M['sourceCommit'],
                  'moduleVersion': M['moduleVersion'], 'module': installed, 'backup': str(BACKUP),
                  'runningImage': after['container']['image'], 'preparedImage': after['preparedImage'],
                  'containerRestarted': False, 'otherModulesPreserved': True, 'programsPreserved': True,
                  'settingsPreserved': True, 'otherServicesPreserved': True, 'databaseTouched': False}
        write('published.json', result)
        return result
    except BaseException:
        restore()
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'publish'], 'Unknown operation')
    with (LIVE / '.client-presentation-deploy.lock').open('a') as shared, (STATE / 'module.lock').open('a') as module:
        fcntl.flock(shared, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(validate() if sys.argv[1] == 'check' else publish()))
