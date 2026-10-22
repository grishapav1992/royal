"""Publish a reviewed client image while preserving backend, modules and production data."""
from pathlib import Path, PurePosixPath
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
NAME = 'royal-catalog-characters-20261022-v1'
BACKUP = Path('/opt/royal-backups') / NAME
STATE = Path('/opt/royal-game-modules-state')
HOST = STATE / 'host.json'
COMPOSE = ['compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
CHANGES = M['changed']
DELTA = M['delta']
DIGEST = re.compile(r'[a-f0-9]{64}')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def snapshot(recovery=False):
    return json.loads(run(['python3', str(ROOT / 'snapshot.py'), *(['--recovery'] if recovery else [])]))


def compose():
    return run(['docker', 'compose', *[value for name in COMPOSE for value in ['-f', name]],
                'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'game'], cwd=LIVE)


def image(ref):
    return run(['docker', 'image', 'inspect', ref, '--format', '{{.Id}}'])


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'Missing regular payload directory')
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Payload symlink rejected')
        if path.is_file():
            result[str(path.relative_to(root))] = sha(path)
    return result


def sources(state):
    return {name: digest for name, digest in state['source'].items() if not name.endswith(('.orig', '.bak'))}


BASE = sources(OLD)


def safe_name(name):
    require(isinstance(name, str), 'Invalid filename')
    path = PurePosixPath(name)
    require(str(path) == name and not path.is_absolute() and all(part not in ['.', '..']
            and not part.startswith('.env') and part not in ['data', 'secrets', '.ssh', 'node_modules', '.git']
            for part in path.parts), 'Unsafe release path')


def settings(state, recovery=False):
    for key in ['configHashes', 'moduleFiles', 'moduleHostContract']:
        require(state[key] == OLD[key], 'Protected production state changed: ' + key)
    for key in (['mounts', 'host', 'runtimeHash', 'composeFiles'] if state['container'] is not None else []):
        require(state['container'][key] == OLD['container'][key], 'Runtime settings changed: ' + key)
    require({name: row for name, row in state['services'].items() if name != '/royal-game-1'}
            == {name: row for name, row in OLD['services'].items() if name != '/royal-game-1'},
            'Another persistent service changed')
    require(recovery or state['container'] is not None, 'Game container disappeared')
    if state['realMoneyFlags'] is not None:
        require(state['realMoneyFlags'] == OLD['realMoneyFlags'], 'Money runtime flags changed')


def baseline():
    state = snapshot()
    settings(state)
    require(state['container'] == OLD['container'], 'Running game changed since review')
    require(state['container']['health'] == 'healthy', 'Current game is not healthy')
    require(sources(state) == BASE, 'Production source changed since review')
    require(state['program'] == OLD['program'] and state['preparedProgram'] == OLD['preparedProgram']
            and state['preparedImage'] == OLD['preparedImage'], 'Runtime or prepared image changed')
    require(state['program'] == state['preparedProgram'], 'Prepared image does not match the running files')
    return state


def payload():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release path')
    require(re.fullmatch(r'[a-f0-9]{40}', M['sourceCommit']), 'Missing reviewed source commit')
    require(sha(ROOT / 'deploy.py') == M['helperSha256'], 'Deployment helper changed')
    require(sha(ROOT / 'snapshot.py') == M['snapshotSha256'], 'Snapshot helper changed')
    require(CHANGES and DELTA and 'index.html' in DELTA, 'Incomplete client release')
    for name in [*CHANGES, *DELTA]:
        safe_name(name)
    require(all(name.startswith(('src/', 'public/', 'scripts/', 'docs/')) for name in CHANGES),
            'Only client sources, assets, documentation and their generation scripts may change')
    for name, digest in CHANGES.items():
        require(DIGEST.fullmatch(digest), 'Invalid source digest')
    for name, digest in DELTA.items():
        require(DIGEST.fullmatch(digest), 'Invalid client digest')
        require(name == 'index.html' or 'dist/' + name not in OLD['program']
                or digest == OLD['program']['dist/' + name], 'Existing asset URL would change: ' + name)
    require(inventory(ROOT / 'source') == CHANGES, 'Source payload differs')
    require(inventory(ROOT / 'dist-delta') == DELTA, 'Client payload differs')


def atomic(source, target):
    require(not target.is_symlink() and not any(parent.is_symlink() for parent in target.parents),
            'Target symlink rejected')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.royal-catalog-next-' + uuid.uuid4().hex)
    try:
        with source.open('rb') as input_file, temporary.open('xb') as output:
            shutil.copyfileobj(input_file, output)
            os.fchmod(output.fileno(), source.stat().st_mode & 0o777)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def healthy():
    for _ in range(60):
        state = json.loads(run(['docker', 'inspect', 'royal-game-1']))[0]['State']
        if state.get('Health', {}).get('Status') == 'healthy':
            result = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e',
                "fetch('http://127.0.0.1:2567/healthz').then(async r=>{if(!r.ok)process.exit(1);const d=await r.json();if(d.ok!==true)process.exit(1);console.log(JSON.stringify({ok:true}));}).catch(()=>process.exit(1))"]))
            require(result.get('ok') is True, 'Game health endpoint failed')
            return
        time.sleep(1)
    raise RuntimeError('Game did not become healthy')


def verify_tar(path):
    with tarfile.open(path) as archive:
        members = archive.getmembers()
        require(all(member.isfile() for member in members), 'Nonregular source backup entry')
        result = {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in members}
        require(len(result) == len(members) and result == BASE, 'Source backup differs')


PROGRAM = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');walk('/app/module-dist');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"


def build():
    payload()
    old = baseline()
    source_bytes = sum((LIVE / name).stat().st_size for name in BASE)
    delta_bytes = sum((ROOT / 'dist-delta' / name).stat().st_size for name in DELTA)
    require(old['availableBytes'] > 512 * 1024**2 + source_bytes * 2 + delta_bytes * 6,
            'Insufficient free disk space')
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in BASE.items():
            require(sha(LIVE / name) == digest, 'Source changed during backup')
            archive.add(LIVE / name, arcname=name, recursive=False)
    verify_tar(BACKUP / 'source.tgz')
    run(['docker', 'cp', 'royal-game-1:/app/dist', str(BACKUP / 'dist')])
    require({'dist/' + name: digest for name, digest in inventory(BACKUP / 'dist').items()}
            == {name: digest for name, digest in OLD['program'].items() if name.startswith('dist/')}, 'Client backup differs')
    for suffix, ref in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        run(['docker', 'tag', ref, 'royal-game:before-' + NAME + suffix])
    context = ROOT / 'runtime-context'
    context.mkdir(exist_ok=False)
    shutil.copytree(ROOT / 'dist-delta', context / 'dist-delta')
    (context / 'Dockerfile').write_text('FROM ' + OLD['preparedImage'] + '\n'
        'COPY --chown=node:node dist-delta/ /app/dist/\n'
        'LABEL org.opencontainers.image.revision="' + M['sourceCommit'] + '"\n')
    (context / '.dockerignore').write_text('**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n')
    baseline()
    with (ROOT / 'build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'royal-game:' + NAME, '.'], cwd=context,
                       check=True, stdout=log, stderr=subprocess.STDOUT)
    candidate = image('royal-game:' + NAME)
    program = json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint',
                              'node', candidate, '-e', PROGRAM]))
    expected = {**OLD['program'], **{'dist/' + name: digest for name, digest in DELTA.items()}}
    require(program == expected, 'Candidate runtime differs from the reviewed client delta')
    parent, child = json.loads(run(['docker', 'image', 'inspect', OLD['preparedImage'], candidate]))
    require(child['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == M['sourceCommit'],
            'Candidate revision label differs from the reviewed source')
    for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image configuration changed: ' + key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'],
            'Baseline image layers changed')
    result = {'image': candidate, 'program': expected, 'sourceCommit': M['sourceCommit'],
              'sourceBackupSha256': sha(BACKUP / 'source.tgz'), 'backup': str(BACKUP)}
    write('build-result.json', result)
    return {'built': True, 'image': candidate, 'clientDeltaFiles': len(DELTA), 'backendAndModulesPreserved': True}


def rollback():
    payload()
    built = json.loads((ROOT / 'build-result.json').read_text())
    current = snapshot(recovery=True)
    settings(current, recovery=True)
    require((current['container'] is None or current['container']['image'] in [OLD['container']['image'], OLD['preparedImage'], built['image']])
            and current['preparedImage'] in [OLD['preparedImage'], built['image']], 'Later image prevents rollback')
    actual = sources(current)
    require(set(BASE).issubset(actual) and set(actual).issubset(set(BASE) | set(CHANGES)),
            'Later source inventory prevents rollback')
    for name, digest in actual.items():
        require(digest in {value for value in [BASE.get(name), CHANGES.get(name)] if value},
                'Later source prevents rollback: ' + name)
    require(sha(BACKUP / 'source.tgz') == built['sourceBackupSha256'], 'Source backup changed')
    verify_tar(BACKUP / 'source.tgz')
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        for name in CHANGES:
            if name in BASE:
                restored = ROOT / 'restore' / name
                restored.parent.mkdir(parents=True, exist_ok=True)
                restored.write_bytes(archive.extractfile(name).read())
                os.chmod(restored, archive.getmember(name).mode)
                atomic(restored, LIVE / name)
            else:
                (LIVE / name).unlink(missing_ok=True)
    run(['docker', 'tag', OLD['preparedImage'], 'royal-game:latest'])
    compose()
    healthy()
    shutil.copytree(BACKUP / 'dist', LIVE / 'dist', dirs_exist_ok=True)
    after = snapshot()
    settings(after)
    require(sources(after) == BASE and after['preparedImage'] == OLD['preparedImage']
            and after['preparedProgram'] == OLD['preparedProgram'], 'Recovered source or prepared image differs')
    require(after['program'] == OLD['program'], 'Recovered running files differ')
    result = {'restored': True, 'containerRestarted': True, 'databaseTouched': False, 'externalModulesPreserved': True}
    write('recovered.json', result)
    return result


def runtime_index(source):
    run(['docker', 'cp', str(source), 'royal-game-1:/app/dist/index.html.royal-catalog-next'])
    run(['docker', 'exec', '--user', '0', 'royal-game-1', 'node', '-e',
         "require('fs').renameSync('/app/dist/index.html.royal-catalog-next','/app/dist/index.html')"])


def publish():
    payload()
    baseline()
    built = json.loads((ROOT / 'build-result.json').read_text())
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
        run(['docker', 'tag', built['image'], 'royal-game:latest'])
        healthy()
        after = snapshot()
        settings(after)
        require(after['container'] == OLD['container'] and after['services'] == OLD['services'],
                'Running containers changed')
        require(sources(after) == {**BASE, **CHANGES}, 'Published source differs')
        require(after['program'] == built['program'] and after['preparedProgram'] == built['program']
                and after['preparedImage'] == built['image'], 'Published runtime differs')
        write('after.json', after)
        result = {'published': True, 'preparedImage': built['image'], 'runningImage': after['container']['image'],
                  'containerRestarted': False, 'sourceCommit': M['sourceCommit'], 'changedSources': len(CHANGES),
                  'clientDeltaFiles': len(DELTA), 'configurationsAndMountsPreserved': True,
                  'gameDataPreserved': True, 'backendAndModulesPreserved': True, 'oldAssetsPreserved': True,
                  'otherPersistentServicesPreserved': len(after['services']) - 1}
        write('published.json', result)
        return result
    except BaseException as error:
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, signal.SIG_IGN)
        write('publication-failed.json', {'errorType': type(error).__name__, 'reason': str(error), 'databaseTouched': False})
        rollback()
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'rollback'], 'Unexpected operation')
    require(not STATE.is_symlink() and not HOST.is_symlink(), 'Module state symlink rejected')
    payload()
    lock_path, module_lock_path = LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock'
    require(not lock_path.is_symlink() and not module_lock_path.is_symlink(), 'Deployment lock symlink rejected')
    with lock_path.open('a') as shared_lock, module_lock_path.open('a') as module_lock:
        fcntl.flock(shared_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

        def interrupted(number, _frame):
            raise InterruptedError('Deployment interrupted: ' + str(number))

        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, interrupted)
        if sys.argv[1] == 'check':
            baseline()
            print(json.dumps({'ready': True, 'sourceFiles': len(CHANGES), 'clientFiles': len(DELTA)}))
        else:
            print(json.dumps(globals()[sys.argv[1]]()))
