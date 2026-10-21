"""Guarded client and portrait-module publication; no restart or data migration."""
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
NAME = 'vespera-video-20261021-v1'
BACKUP = Path('/opt/royal-backups') / NAME
PUBLIC = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
CHANGES = M['changes']
DELTA = M['delta']
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def snapshot():
    return json.loads(run(['python3', str(ROOT / 'snapshot.py')]))


def image(ref):
    return run(['docker', 'image', 'inspect', ref, '--format', '{{.Id}}'])


def settings(state):
    for key in ['configHashes', 'container', 'services', 'moduleHostContract', 'realMoneyFlags']:
        require(state[key] == OLD[key], 'Production state changed: ' + key)


def baseline():
    state = snapshot()
    settings(state)
    for key in ['source', 'program', 'moduleFiles', 'preparedImage']:
        require(state[key] == OLD[key], 'Production baseline changed: ' + key)
    require(state['preparedProgram'] == state['program'], 'Prepared image differs from running files')
    require(state['container']['health'] == 'healthy', 'Production is not healthy')
    return state


def publisher():
    spec = importlib.util.spec_from_file_location('reviewed_publisher', ROOT / 'source/scripts/game-module-release.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def module_args(operation):
    return SimpleNamespace(operation=operation, package=str(ROOT / 'package'), game='royal-plinko',
                           version=None, expected_sha=M['externalPointerSha256'], root=str(PUBLIC), state=str(STATE))


def payload():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release path')
    require(re.fullmatch(r'[a-f0-9]{40}', M['sourceCommit']), 'Missing source commit')
    require(sha(ROOT / 'deploy.py') == M['deploySha256'] and sha(ROOT / 'snapshot.py') == M['snapshotSha256'], 'Release helper changed')
    for collection, folder in [(CHANGES, 'source'), (DELTA, 'dist-delta'), (M['packageFiles'], 'package')]:
        for name, digest in collection.items():
            path = PurePosixPath(name)
            require(not path.is_absolute() and str(path) == name and not any(part in ['..', '.', '.git', 'secrets', 'data', 'node_modules'] or part.startswith('.env') for part in path.parts), 'Unsafe payload path')
            target = ROOT / folder / name
            require(target.is_file() and not any(parent.is_symlink() for parent in [target, *target.parents]), 'Payload symlink or missing file')
            require(sha(target) == digest, 'Payload changed: ' + name)
    require(not set(CHANGES).intersection({'.env', 'deployment/SERVER.md', 'compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml'}), 'Protected source in delta')
    checked = publisher().run(module_args('check'))
    require(checked['version'] == M['moduleVersion'] and checked['beforeSha256'] == M['externalPointerSha256'], 'Module changed since review')


def atomic(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.vespera-next')
    require(not temporary.exists(), 'Unexpected temporary file')
    shutil.copy2(source, temporary)
    temporary.replace(destination)


def runtime_index(source):
    run(['docker', 'cp', str(source), 'royal-game-1:/app/dist/index.html.vespera-next'])
    run(['docker', 'exec', '--user', '0', 'royal-game-1', 'node', '-e', "require('fs').renameSync('/app/dist/index.html.vespera-next','/app/dist/index.html')"])


def build():
    payload()
    state = baseline()
    require(state['availableBytes'] > 1500 * 1024**2, 'Insufficient disk for verified backups')
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in OLD['source'].items():
            require(sha(LIVE / name) == digest, 'Source changed during backup: ' + name)
            archive.add(LIVE / name, arcname=name, recursive=False)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        saved = {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in archive.getmembers()}
        require(saved == OLD['source'], 'Source backup differs')
    run(['docker', 'cp', 'royal-game-1:/app/dist', str(BACKUP / 'dist')])
    for name, digest in OLD['program'].items():
        if name.startswith('dist/'):
            require(sha(BACKUP / name) == digest, 'Client backup differs: ' + name)
    pointer = PUBLIC / 'royal-plinko/active.json'
    if pointer.exists():
        shutil.copy2(pointer, BACKUP / 'active.json')
    for suffix, ref in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        run(['docker', 'tag', ref, 'royal-game:before-' + NAME + suffix])
    context = ROOT / 'context'
    context.mkdir(exist_ok=False)
    shutil.copytree(ROOT / 'dist-delta', context / 'dist-delta')
    (context / 'Dockerfile').write_text('FROM ' + OLD['preparedImage'] + '\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="' + M['sourceCommit'] + '"\n')
    with (ROOT / 'build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'royal-game:' + NAME, '.'], cwd=context, stdout=log, stderr=subprocess.STDOUT, check=True)
    candidate = image('royal-game:' + NAME)
    code = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}for(const d of ['dist','dist-server','module-dist'])walk('/app/'+d);for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    files = json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', candidate, '-e', code]))
    expected = {**OLD['program'], **{'dist/' + name: digest for name, digest in DELTA.items()}}
    require(files == expected, 'Candidate program differs from client delta')
    parent, child = json.loads(run(['docker', 'image', 'inspect', OLD['preparedImage'], candidate]))
    for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image configuration changed: ' + key)
    result = {'image': candidate, 'program': expected, 'sourceCommit': M['sourceCommit'], 'backup': str(BACKUP), 'sourceBackupSha256': sha(BACKUP / 'source.tgz')}
    write('built.json', result)
    return {'built': True, 'image': candidate, 'backup': str(BACKUP)}


def restore():
    pointer = PUBLIC / 'royal-plinko/active.json'
    if (BACKUP / 'active.json').exists():
        atomic(BACKUP / 'active.json', pointer)
    else:
        pointer.unlink(missing_ok=True)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        for name in CHANGES:
            if name in OLD['source']:
                saved = ROOT / 'restore' / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                saved.write_bytes(archive.extractfile(name).read())
                atomic(saved, LIVE / name)
            else:
                (LIVE / name).unlink(missing_ok=True)
    runtime_index(BACKUP / 'dist/index.html')
    atomic(BACKUP / 'dist/index.html', LIVE / 'dist/index.html')
    run(['docker', 'tag', OLD['preparedImage'], 'royal-game:latest'])
    write('recovered.json', {'sourceRestored': True, 'indexRestored': True, 'priorPointerRestored': True, 'newImmutableResourcesRetained': True, 'databaseTouched': False})


def publish():
    payload()
    baseline()
    built = json.loads((ROOT / 'built.json').read_text())
    require(image('royal-game:' + NAME) == built['image'], 'Candidate image changed')
    assets = ROOT / 'assets-delta'
    assets.mkdir(exist_ok=False)
    for name in DELTA:
        if name != 'index.html':
            target = assets / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / 'dist-delta' / name, target)
    try:
        for name in CHANGES:
            atomic(ROOT / 'source' / name, LIVE / name)
        run(['docker', 'cp', str(assets) + '/.', 'royal-game-1:/app/dist/'])
        for name in DELTA:
            if name != 'index.html':
                atomic(ROOT / 'dist-delta' / name, LIVE / 'dist' / name)
        runtime_index(ROOT / 'dist-delta/index.html')
        atomic(ROOT / 'dist-delta/index.html', LIVE / 'dist/index.html')
        installed = publisher().run(module_args('install'))
        run(['docker', 'tag', built['image'], 'royal-game:latest'])
        after = snapshot()
        settings(after)
        require(after['source'] == {**OLD['source'], **CHANGES}, 'Published sources differ')
        require(after['program'] == built['program'] and after['preparedProgram'] == built['program'], 'Runtime and prepared image differ')
        require(after['preparedImage'] == built['image'], 'Prepared image differs')
        expected_modules = {**OLD['moduleFiles'], **{str(PUBLIC / 'royal-plinko/versions' / M['moduleVersion'] / name): digest for name, digest in M['packageFiles'].items()}, str(PUBLIC / 'royal-plinko/active.json'): installed['activeSha256']}
        require(after['moduleFiles'] == expected_modules, 'Other modules or portrait bytes differ')
        write('after.json', after)
        result = {'published': True, 'release': NAME, 'sourceCommit': M['sourceCommit'], 'moduleVersion': M['moduleVersion'], 'module': installed, 'preparedImage': built['image'], 'runningBaseImage': after['container']['image'], 'containerRestarted': False, 'sourceChanges': len(CHANGES), 'clientDeltaFiles': len(DELTA), 'allOtherModulesPreserved': True, 'configurationsPreserved': True, 'backendPreserved': True, 'gameDataPreserved': True, 'otherServicesPreserved': True, 'backup': str(BACKUP)}
        write('published.json', result)
        return result
    except BaseException:
        restore()
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ['build', 'publish'], 'Unknown operation')
    with (LIVE / '.client-presentation-deploy.lock').open('a') as shared, (STATE / 'module.lock').open('a') as module:
        fcntl.flock(shared, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(globals()[sys.argv[1]]()))
