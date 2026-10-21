"""Publish Dracona with the shared host while preserving live data and existing modules."""
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
NAME = 'dracona-20261022-v1'
BACKUP = Path('/opt/royal-backups') / NAME
STATE = Path('/opt/royal-game-modules-state')
HOST = STATE / 'host.json'
COMPOSE = ['compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']
M = json.loads((ROOT / 'install-manifest.json').read_text())
BASE = {row['path']: row['sha256'] for row in M['baseline']}
CHANGES = M['changed']
MODULES = M['moduleBaseline']
DIGEST = re.compile(r'[a-f0-9]{64}')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def write(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2) + '\n')


def image(ref):
    return run(['docker', 'image', 'inspect', ref, '--format', '{{.Id}}'])


def snapshot(recovery=False):
    return json.loads(run(['python3', str(ROOT / 'snapshot.py'), *(['--recovery'] if recovery else [])]))


def compose():
    return run(['docker', 'compose', *[value for name in COMPOSE for value in ['-f', name]],
                'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'game'], cwd=LIVE)


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'Missing regular inventory directory')
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Inventory symlinks rejected')
        if path.is_file():
            result[str(path.relative_to(root))] = sha(path)
    return result


def sources(state):
    return {name: digest for name, digest in state['source'].items() if not name.endswith(('.orig', '.bak'))}


def source_guard(state, published=False, mixed=False):
    actual = sources(state)
    expected = {**BASE, **CHANGES} if published else BASE
    if mixed:
        require(set(actual) in [set(BASE), set(BASE) | set(CHANGES)]
                or set(BASE).issubset(actual) and set(actual).issubset(set(BASE) | set(CHANGES)),
                'Concurrent source inventory prevents recovery')
        for name, digest in actual.items():
            require(digest in {value for value in [BASE.get(name), CHANGES.get(name)] if value},
                    'Concurrent source prevents recovery: ' + name)
    else:
        require(actual == expected, 'Source changed since review')


def settings_guard(state, host_hash=None, recovery=False):
    before = M['before']
    require(state['configHashes'] == before['configHashes'], 'Production configurations changed')
    for key in (['mounts', 'host', 'runtimeHash', 'composeFiles'] if state['container'] is not None else []):
        actual, previous = state['container'][key], before['container'][key]
        if key == 'mounts':
            actual, previous = [sorted(rows, key=lambda row: row['Destination']) for rows in [actual, previous]]
        require(actual == previous, 'Runtime settings changed: ' + key)
    require(state['moduleFiles'] == before['moduleFiles'], 'External independent modules changed')
    require(state['moduleHostContract'] == (host_hash or before['moduleHostContract']), 'Installed host contract changed')
    require({name: row for name, row in state['services'].items() if name != '/royal-game-1'}
            == {name: row for name, row in before['services'].items() if name != '/royal-game-1'},
            'Another persistent service changed')
    require(recovery or state['container'] is not None, 'Game container disappeared')
    if state['realMoneyFlags'] is not None:
        require(state['realMoneyFlags'] == before['realMoneyFlags'], 'Money runtime flags changed')


def baseline_guard():
    state = snapshot()
    source_guard(state)
    settings_guard(state)
    for key in ['id', 'image', 'startedAt', 'health']:
        require(state['container'][key] == M['before']['container'][key], 'Running game changed: ' + key)
    require(state['container']['health'] == 'healthy', 'Current game is not healthy')
    require(state['preparedImage'] == M['before']['preparedImage'] and state['program'] == M['before']['program']
            and state['preparedProgram'] == state['program'],
            'Runtime or prepared image changed')
    source_bytes = sum((LIVE / name).stat().st_size for name in BASE)
    static_bytes = int(run(['docker', 'exec', 'royal-game-1', 'node', '-e',
        "const f=require('fs'),p=require('path');function size(d){return f.readdirSync(d).reduce((n,x)=>{const q=p.join(d,x),s=f.lstatSync(q);return n+(s.isDirectory()?size(q):s.size);},0)}console.log(size('/app/dist'))"]))
    payload_bytes = sum((ROOT / 'prebuilt/module-dist' / name).stat().st_size for name in MODULES)
    payload_bytes += sum((ROOT / 'prebuilt/dist' / name).stat().st_size for name in M['delta'])
    payload_bytes += (ROOT / 'prebuilt/index.js').stat().st_size
    # Budget full uncompressed backups, three payload copies and a 1 GiB reserve.
    required = max(2 * 1024**3, source_bytes + static_bytes + payload_bytes * 3 + 1024**3)
    if (BACKUP / 'source.tgz').is_file() and (ROOT / 'runtime-context').is_dir():
        required = max(768 * 1024**2, payload_bytes * 2 + 256 * 1024**2)
    require(state['availableBytes'] > required, 'Insufficient free disk')
    return state


def safe_name(name):
    require(isinstance(name, str), 'Invalid release filename')
    path = PurePosixPath(name)
    require(str(path) == name and not path.is_absolute() and all(part not in ['.', '..']
            and not part.startswith('.env') and part not in ['data', 'secrets', '.ssh', 'node_modules', '.git']
            for part in path.parts), 'Unsafe release path')


def plain(root, name):
    safe_name(name)
    path = root
    for part in PurePosixPath(name).parts:
        path = path / part
        require(not path.is_symlink(), 'Release symlink rejected')
    require(path.is_file(), 'Release payload file missing: ' + name)
    return path


def contracts_guard():
    desired = json.loads((ROOT / 'prebuilt/host.json').read_text())
    public = json.loads((ROOT / 'prebuilt/module-dist/host-contracts.json').read_text())
    require(desired == public and isinstance(desired.get('games'), dict) and desired['games'],
            'Private and bundled host contracts differ')
    old_hash = M['before']['moduleHostContract']
    require(sha(HOST) in [old_hash, M['hostContractSha256']], 'An unrelated host contract was installed')
    old = json.loads((BACKUP / 'host.json' if (BACKUP / 'host.json').exists() else HOST).read_text())
    require(isinstance(old.get('games'), dict), 'Invalid previous host contract')
    require(all(desired['games'].get(game) == contract for game, contract in old['games'].items()),
            'A previously supported game contract changed')
    for game, contract in desired['games'].items():
        require(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', game), 'Invalid registered game')
        require(isinstance(contract, dict) and set(contract) == {'apiVersion', 'rulesVersion', 'progressVersion'}
                and type(contract['apiVersion']) is int and contract['apiVersion'] == 1
                and all(type(contract[key]) is int and contract[key] > 0 for key in ['rulesVersion', 'progressVersion']),
                'Invalid registered game contract')
    require({name.split('/')[0] for name in MODULES if name.endswith('/active.json')} == set(desired['games']),
            'Bundled active pointers and host games differ')
    return desired


def payload_guard():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release directory')
    require(re.fullmatch(r'[a-f0-9]{40}', M['sourceCommit']), 'Missing reviewed source commit')
    require(sha(ROOT / 'deploy.py') == M['helperSha256'], 'Deployment helper changed')
    require(sha(ROOT / 'snapshot.py') == M['snapshotSha256'], 'Snapshot helper changed')
    require(set(CHANGES).isdisjoint({'.env', *COMPOSE, 'deployment/SERVER.md'}), 'Protected production source in release delta')
    for name in [*BASE, *CHANGES, *M['delta'], *MODULES]:
        safe_name(name)
    for name, digest in CHANGES.items():
        require(DIGEST.fullmatch(digest) and sha(plain(ROOT / 'source', name)) == digest, 'Source payload differs: ' + name)
    require(inventory(ROOT / 'source') == CHANGES, 'Unexpected source payload files')
    require(inventory(ROOT / 'prebuilt/dist') == M['delta'], 'Client payload differs')
    require(inventory(ROOT / 'prebuilt/module-dist') == MODULES, 'Module baseline payload differs')
    require(sha(ROOT / 'prebuilt/index.js') == M['serverSha256'], 'Server payload differs')
    require(sha(ROOT / 'prebuilt/package.json') == M['packageSha256'], 'Package metadata payload differs')
    require(CHANGES.get('package.json', BASE.get('package.json')) == M['packageSha256'], 'Package metadata differs from source')
    require(sha(ROOT / 'prebuilt/host.json') == M['hostContractSha256'], 'Expanded host contract payload differs')
    require(MODULES.get('host-contracts.json') == M['hostContractSha256'], 'Bundled host contract bytes differ')
    require('package-lock.json' not in CHANGES, 'A dependency lock change requires a full reviewed image build')
    contracts_guard()


def verify_tar(path, expected):
    with tarfile.open(path) as archive:
        members = archive.getmembers()
        require(all(member.isfile() for member in members), 'Backup contains nonregular entries')
        actual = {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in members}
        require(len(actual) == len(members) and actual == expected, 'Source backup differs')


def build():
    payload_guard()
    old = baseline_guard()
    BACKUP.mkdir(mode=0o700, exist_ok=True)
    if not (BACKUP / 'source.tgz').exists():
        with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
            for name, digest in BASE.items():
                require(sha(LIVE / name) == digest, 'Source changed during backup')
                archive.add(LIVE / name, arcname=name, recursive=False)
    verify_tar(BACKUP / 'source.tgz', BASE)
    shutil.copy2(HOST, BACKUP / 'host.json')
    require(sha(BACKUP / 'host.json') == old['moduleHostContract'], 'Private host contract backup differs')
    (BACKUP / 'host-permissions.json').write_text(json.dumps({'mode': HOST.stat().st_mode & 0o7777,
                                                           'uid': HOST.stat().st_uid, 'gid': HOST.stat().st_gid}) + '\n')
    write('before-runtime.json', {'runningImage': old['container']['image'], 'preparedImage': old['preparedImage'],
                                  'sourceCommit': M['sourceCommit'], 'databaseRestored': False})
    run(['docker', 'tag', old['container']['image'], 'royal-game:before-' + NAME])
    run(['docker', 'tag', old['preparedImage'], 'royal-game:before-' + NAME + '-prepared'])
    if not (BACKUP / 'dist').exists():
        run(['docker', 'cp', 'royal-game-1:/app/dist', str(BACKUP / 'dist')])
    require({'dist/' + name: digest for name, digest in inventory(BACKUP / 'dist').items()}
            == {name: digest for name, digest in old['program'].items() if name.startswith('dist/')}, 'Client backup differs')
    context = ROOT / 'runtime-context'
    context.mkdir(exist_ok=True)
    shutil.copytree(ROOT / 'prebuilt/dist', context / 'dist-delta', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'prebuilt/module-dist', context / 'module-dist', dirs_exist_ok=True)
    require(inventory(context / 'dist-delta') == M['delta'] and inventory(context / 'module-dist') == MODULES,
            'Resumed build context differs')
    shutil.copy2(ROOT / 'prebuilt/index.js', context / 'index.js')
    shutil.copy2(ROOT / 'prebuilt/package.json', context / 'package.json')
    old_package = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-p', 'JSON.stringify(require("/app/package.json"))']))
    new_package = json.loads((context / 'package.json').read_text())
    require({key: value for key, value in old_package.items() if key != 'scripts'}
            == {key: value for key, value in new_package.items() if key != 'scripts'}, 'Runtime dependency metadata changed')
    (context / 'Dockerfile').write_text('FROM ' + old['preparedImage'] + '\n'
        'COPY --chown=node:node dist-delta/ /app/dist/\n'
        'COPY --chown=node:node module-dist/ /app/module-dist/\n'
        'COPY --chown=node:node index.js /app/dist-server/index.js\n'
        'COPY --chown=node:node package.json /app/package.json\n'
        'LABEL org.opencontainers.image.revision="' + M['sourceCommit'] + '"\n')
    (context / '.dockerignore').write_text('**\n!Dockerfile\n!.dockerignore\n!index.js\n!package.json\n!dist-delta\n!dist-delta/**\n!module-dist\n!module-dist/**\n')
    baseline_guard()
    with (ROOT / 'build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'royal-game:' + NAME, '.'], cwd=context,
                       check=True, stdout=log, stderr=subprocess.STDOUT)
    candidate = image('royal-game:' + NAME)
    node = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');walk('/app/module-dist');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    files = json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', candidate, '-e', node]))
    expected = {**old['program'], **{'dist/' + name: digest for name, digest in M['delta'].items()},
                **{'module-dist/' + name: digest for name, digest in MODULES.items()},
                'dist-server/index.js': M['serverSha256'], 'package.json': M['packageSha256']}
    require(files == expected, 'Candidate runtime differs from reviewed release')
    parent, child = json.loads(run(['docker', 'image', 'inspect', old['preparedImage'], candidate]))
    for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image configuration changed: ' + key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'], 'Baseline layers changed')
    result = {'image': candidate, 'program': expected, 'sourceCommit': M['sourceCommit'],
              'sourceBackupSha256': sha(BACKUP / 'source.tgz'), 'hostBackupSha256': sha(BACKUP / 'host.json')}
    write('build-result.json', result)
    return {'built': True, 'image': candidate, 'oldAssetsPreserved': True, 'moduleFiles': len(MODULES)}


def atomic(source, target, private=False):
    require(not target.is_symlink() and not any(parent.is_symlink() for parent in target.parents), 'Target symlink rejected')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.modular-next-' + uuid.uuid4().hex)
    try:
        with source.open('rb') as input_file, temporary.open('xb') as output:
            shutil.copyfileobj(input_file, output)
            os.fchmod(output.fileno(), 0o600 if private else source.stat().st_mode & 0o777)
            output.flush()
            os.fsync(output.fileno())
        if private:
            permissions = json.loads((BACKUP / 'host-permissions.json').read_text())
            os.chmod(temporary, permissions['mode'])
            os.chown(temporary, permissions['uid'], permissions['gid'])
        os.replace(temporary, target)
        directory = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


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


def rollback():
    payload_guard()
    built = json.loads((ROOT / 'build-result.json').read_text())
    state = snapshot(recovery=True)
    require((state['container'] is None or state['container']['image'] in [M['before']['container']['image'], M['before']['preparedImage'], built['image']])
            and state['preparedImage'] in [M['before']['preparedImage'], built['image']], 'A later image prevents rollback')
    source_guard(state, mixed=True)
    require(state['moduleHostContract'] in [M['before']['moduleHostContract'], M['hostContractSha256']], 'A later contract prevents rollback')
    settings_guard(state, state['moduleHostContract'], recovery=True)
    require(sha(BACKUP / 'source.tgz') == built['sourceBackupSha256'] and sha(BACKUP / 'host.json') == built['hostBackupSha256'],
            'Recovery backup changed')
    verify_tar(BACKUP / 'source.tgz', BASE)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        for name in CHANGES:
            if name in BASE:
                target = ROOT / 'restore' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(name).read())
                os.chmod(target, archive.getmember(name).mode)
                atomic(target, LIVE / name)
            elif (LIVE / name).exists():
                (LIVE / name).unlink()
    # Remove newly advertised interfaces before the previous host resumes serving.
    atomic(BACKUP / 'host.json', HOST, private=True)
    run(['docker', 'tag', M['before']['preparedImage'], 'royal-game:latest'])
    compose()
    healthy()
    shutil.copytree(BACKUP / 'dist', LIVE / 'dist', dirs_exist_ok=True)
    recovered = snapshot()
    settings_guard(recovered)
    source_guard(recovered)
    require(recovered['program'] == M['before']['program'] and recovered['preparedProgram'] == recovered['program']
            and recovered['preparedImage'] == M['before']['preparedImage'], 'Rollback runtime differs')
    write('recovered.json', {'restored': True, 'databaseRestored': False, 'externalModulesPreserved': True})
    return {'restored': True, 'databaseRestored': False}


def publish():
    payload_guard()
    baseline_guard()
    built = json.loads((ROOT / 'build-result.json').read_text())
    require(image('royal-game:' + NAME) == built['image'], 'Candidate image changed')
    try:
        for name in CHANGES:
            atomic(ROOT / 'source' / name, LIVE / name)
        run(['docker', 'tag', built['image'], 'royal-game:latest'])
        compose()
        healthy()
        running = snapshot()
        settings_guard(running)
        source_guard(running, published=True)
        require(running['container']['image'] == built['image'] and running['preparedImage'] == built['image']
                and running['program'] == built['program'] and running['preparedProgram'] == built['program'], 'Published runtime differs')
        # Expand private publication authority only after the compatible host is healthy.
        atomic(ROOT / 'prebuilt/host.json', HOST, private=True)
        after = snapshot()
        settings_guard(after, M['hostContractSha256'])
        source_guard(after, published=True)
        require(after['container']['image'] == built['image'] and after['preparedImage'] == built['image']
                and after['program'] == built['program'] and after['preparedProgram'] == built['program'], 'Host changed during publication')
        shutil.copytree(ROOT / 'prebuilt/dist', LIVE / 'dist', dirs_exist_ok=True)
        write('after.json', after)
        result = {'published': True, 'image': built['image'], 'sourceCommit': M['sourceCommit'], 'databaseRestored': False,
                  'configurationsAndMountsPreserved': True, 'otherPersistentServicesPreserved': len(after['services']) - 1,
                  'externalModuleFilesPreserved': len(after['moduleFiles']), 'oldAssetsPreserved': True,
                  'expandedHostContractSha256': M['hostContractSha256']}
        write('published.json', result)
        return result
    except BaseException as error:
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, signal.SIG_IGN)
        write('publication-failed.json', {'errorType': type(error).__name__, 'reason': str(error), 'databaseRestored': False})
        rollback()
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'rollback'], 'Unexpected operation')
    require(not HOST.is_symlink() and not STATE.is_symlink(), 'Private host state symlink rejected')
    payload_guard()
    lock_path = LIVE / '.client-presentation-deploy.lock'
    module_lock_path = STATE / 'module.lock'
    require(not lock_path.is_symlink() and not module_lock_path.is_symlink(), 'Deployment lock symlink rejected')
    with lock_path.open('a') as shared_lock, module_lock_path.open('a') as module_lock:
        fcntl.flock(shared_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(number, _frame):
            raise InterruptedError('Deployment interrupted: ' + str(number))
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, interrupted)
        operation = sys.argv[1]
        if operation == 'check':
            baseline_guard()
            print(json.dumps({'ready': True, 'sourceFiles': len(CHANGES), 'moduleFiles': len(MODULES)}))
        else:
            print(json.dumps(globals()[operation]()))
