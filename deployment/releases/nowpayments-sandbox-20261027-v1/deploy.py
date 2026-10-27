"""Publish HTTP decoder and public combat state security fixes without changing accepted wagers."""
from pathlib import Path, PurePosixPath
import base64
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
NAME = 'nowpayments-sandbox-20261027-v1'
BACKUP = Path('/opt/royal-backups') / NAME
STATE = Path('/opt/royal-game-modules-state')
HOST = STATE / 'host.json'
COMPOSE = ['compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
CHANGES = M['changed']
DELTA = M['delta']
SERVER_DELTA = M['serverDelta']
DELETED = M['deleted']
SCOPE = set(json.loads((ROOT/'scope.json').read_text()))
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


def compose(gate=None):
    command = ['docker', 'compose', *[value for name in active_compose() for value in ['-f', name]],
               'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'game']
    return gate.run(command, cwd=LIVE) if gate else run(command, cwd=LIVE)


def active_compose():
    return COMPOSE + (['compose.nowpayments-sandbox.yaml'] if (LIVE/'compose.nowpayments-sandbox.yaml').is_file() else [])


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


def owned_module_state(state):
    actual = state['moduleFiles']; previous = OLD['moduleFiles']
    approved = {'/opt/royal-game-modules/'+name:digest for name,digest in M['moduleDelta'].items()}
    expected = {**previous, **{name:digest for name,digest in approved.items() if name in actual}}
    for row in M['modulePackages']:
        prefix = row['gameId']+'/versions/'+row['version']+'/'
        relative = prefix+'manifest.json'
        pointer = '/opt/royal-game-modules/'+row['gameId']+'/active.json'
        value = {'format':1,'gameId':row['gameId'],'manifest':'/game-modules/'+relative,'sha256':M['moduleDelta'][relative]}
        active = hashlib.sha256((json.dumps(value,indent=2)+'\n').encode()).hexdigest()
        if actual.get(pointer) != previous.get(pointer):
            package_files = {'/opt/royal-game-modules/'+name:digest for name,digest in M['moduleDelta'].items() if name.startswith(prefix)}
            require(actual.get(pointer) == active and package_files and all(actual.get(name) == digest for name,digest in package_files.items()), 'Incomplete or unrelated active module')
            expected[pointer] = active
    require(actual == expected, 'Unreviewed module change prevents recovery')


def settings(state, recovery=False, owned_modules=False, sandbox=False):
    from sandbox_config import check_settings
    check_settings(state, OLD, M, sandbox=sandbox, recovery=recovery)
    for key in ['moduleHostContract']:
        require(state[key] == OLD[key], 'Protected production state changed: ' + key)
    if recovery or owned_modules: owned_module_state(state)
    else: require(state['moduleFiles'] == OLD['moduleFiles'], 'Protected production state changed: moduleFiles')
    for key in (['mounts', 'host'] if state['container'] is not None else []):
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


def expected_program():
    dependencies = {'node_modules/' + name: digest for name, digest in M['dependencyFiles'].items()}
    return {**OLD['program'], **M['runtimePackages'], **dependencies,
            **{'dist/' + name: digest for name, digest in DELTA.items()},
            **{'dist-server/' + name: digest for name, digest in SERVER_DELTA.items()}}


def recovery_guard(current, built):
    settings(current, recovery=True)
    require((current['container'] is None or current['container']['image'] in [OLD['container']['image'], OLD['preparedImage'], built['image']])
            and current['preparedImage'] in [OLD['preparedImage'], built['image']], 'Later image prevents rollback')
    actual = sources(current)
    require((set(BASE) - set(DELETED)).issubset(actual) and set(actual).issubset(set(BASE) | set(CHANGES)),
            'Later source inventory prevents rollback')
    for name, digest in actual.items():
        require(digest in {value for value in [BASE.get(name), CHANGES.get(name)] if value},
                'Later source prevents rollback: ' + name)
    if current.get('program') is not None:
        expected = built['program'] if current['container']['image'] == built['image'] else OLD['program']
        require(current['program'] == expected, 'Later running files prevent rollback')


def lock_transition(before, after):
    require(before == after, 'A Sandbox release must preserve the complete dependency lock')


def payment_source(name):
    return name in SCOPE


def package_transition(before, after):
    require(before == after, 'Sandbox release must preserve package metadata and scripts')


def git_tree(data):
    result, offset = {}, 0
    while offset < len(data):
        space, end = data.find(b' ',offset), data.find(b'\0',offset)
        require(space > offset and end > space and end+21 <= len(data), 'Malformed helper Git tree')
        mode, name = data[offset:space], data[space+1:end]
        require(name and b'/' not in name and name not in result, 'Invalid helper Git tree entry')
        result[name] = (mode, data[end+1:end+21].hex())
        offset = end+21
    return result


def verify_helper_source(proof):
    operational = M.get('operationalHelpers', {})
    require(not operational or set(operational) == {
        'cpu-priority-release-v3.py', 'publication-priority.py', 'run-publication.py'},
        'Unexpected operational helper inventory')
    source_files = {**M['helpers'], **operational}
    def object_bytes(kind, encoded, expected):
        require(isinstance(encoded,str) and len(encoded) <= 262144, 'Oversized helper Git object')
        raw = base64.b64decode(encoded, validate=True)
        digest = hashlib.sha1((kind+' '+str(len(raw))).encode()+b'\0'+raw).hexdigest()
        require(digest == expected, 'Helper Git object does not match its pinned revision')
        return raw
    require(proof['sourceCommit'] == M['helperSourceCommit'] and proof['applicationSourceCommit'] == M['sourceCommit']
            and re.fullmatch(r'[0-9a-f]{40}', proof['originMain']) and proof['files'] == source_files,
            'Deployment helper source does not match this application envelope')
    raw = object_bytes('commit',proof['commit'],M['helperSourceCommit'])
    first = raw.split(b'\n',1)[0]
    require(re.fullmatch(rb'tree [0-9a-f]{40}',first), 'Invalid helper source commit')
    tree_id, used = first[5:].decode(), set()
    for name in [b'deployment',b'releases',NAME.encode()]:
        entries = git_tree(object_bytes('tree',proof['trees'][tree_id],tree_id));used.add(tree_id)
        require(name in entries and entries[name][0] == b'40000', 'Missing helper source directory')
        tree_id = entries[name][1]
    entries = git_tree(object_bytes('tree',proof['trees'][tree_id],tree_id));used.add(tree_id)
    require(set(proof['trees']) == used, 'Unexpected helper proof objects')
    for name in source_files:
        require(name.encode() in entries and entries[name.encode()][0] in {b'100644',b'100755'}, 'Invalid helper source mode')
        raw = (ROOT/name).read_bytes()
        digest = hashlib.sha1(('blob '+str(len(raw))).encode()+b'\0'+raw).hexdigest()
        require(digest == entries[name.encode()][1], 'Helper bytes differ from the pinned Git source')


def payload():
    require(ROOT == Path('/opt/royal-releases') / NAME and M['release'] == NAME, 'Unexpected release path')
    require(re.fullmatch(r'[a-f0-9]{40}', M['sourceCommit']), 'Missing reviewed source commit')
    helper_names = ['deploy.py','snapshot.py','runtime-inventory.cjs','quiesce.cjs','verify-runtime.cjs','financial_gate.py','sandbox_config.py','scope.json','compose.nowpayments-sandbox.yaml']
    require(set(M['helpers']) == set(helper_names), 'Unexpected deployment helper inventory')
    require(re.fullmatch(r'[0-9a-f]{40}', M['helperSourceCommit'])
            and sha(ROOT/'helpers-source.json') == M['helperProofSha256'], 'Deployment helper provenance changed')
    proof = json.loads((ROOT/'helpers-source.json').read_text())
    verify_helper_source(proof)
    for name in helper_names:
        require(sha(ROOT/name) == M['helpers'][name], 'Release helper changed: '+name)
    for name, digest in M.get('operationalHelpers', {}).items():
        require(sha(ROOT/name) == digest, 'Operational helper changed: '+name)
    require(CHANGES and set(SERVER_DELTA) == {'index.js'}, 'The reviewed main backend is required')
    require(all(name in ['index.html','admin.html'] or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name) for name in DELTA), 'Unexpected client change')
    for name in [*CHANGES, *DELETED, *DELTA]: safe_name(name)
    require(set(DELETED).issubset(SCOPE) and set(DELETED).issubset(BASE) and not set(DELETED).intersection(CHANGES), 'Unreviewed source deletion')
    require(all(name in ['package-lock.json','package.json'] or name.startswith(('src/','server/','scripts/','docs/','games/')) for name in CHANGES), 'Unexpected source path')
    for name in CHANGES:
        require(not any(part.startswith(('._','.env')) or part in
            {'node_modules','__pycache__','data','secrets','.git','.DS_Store'} for part in PurePosixPath(name).parts)
            and not name.endswith(('.orig','.bak','.pyc','.pyo')), 'Generated or unobservable source path: '+name)
    require(all(name in ['package-lock.json', 'package.json']
                or payment_source(name) for name in CHANGES), 'Unrelated source is outside the payment release')
    require(CHANGES.get('src/shared/luelonSlotsLines.ts', OLD['sourceLF'].get('src/shared/luelonSlotsLines.ts'))
            == 'cc9e2528bae03e8965c154f82aa271b3c9976bb3d817130ba51dedf6e8eb67ee',
            'Cosmic validator differs from the qualified source')
    critical = ['server/combatGame.ts','server/combatRoom.ts','server/combatGuard.ts','server/commonCombatWallet.ts',
        'server/pvp/virtual-wallet.ts','server/finance/combat-escrow.ts','server/finance/pvp-money.ts',
        'src/shared/combat.ts','src/shared/combatEscrow.ts','src/shared/pvp.ts']
    require(all(name not in CHANGES and name in BASE for name in critical), 'Wallet or fight rules may not change in this security release')
    require(OLD['moduleHost']['games']['mortal-kombat'] == {'apiVersion':1,'rulesVersion':2,'progressVersion':1}, 'Rollback requires the same virtual combat contract')
    require(set(M['preservedBackend']) == {'payments.js','crypto-reconcile.js'}, 'Independent backend retention requires both source graphs')
    for name, retained in M['preservedBackend'].items():
        require(retained['runtimeSha256'] == OLD['program']['dist-server/'+name] and retained['sourceInputs'], 'Retained backend bytes changed')
        require(all(path not in CHANGES and digest == OLD['sourceLF'].get(path) for path,digest in retained['sourceInputs'].items()), 'Retained backend source changed')
    for name, digest in DELTA.items():
        require(DIGEST.fullmatch(digest), 'Invalid client digest')
        require(name in ['index.html','admin.html'] or 'dist/'+name not in OLD['program'] or digest == OLD['program']['dist/'+name], 'Immutable client URL collision')
    require(M['runtimePackages'] == {name:CHANGES.get(name, OLD['sourceLF'][name]) for name in ['package-lock.json','package.json']}, 'Only reviewed package metadata may change')
    require(sha(ROOT/'old-package.json') == OLD['sourceLF']['package.json'], 'Baseline application package differs')
    package_transition(json.loads((ROOT/'old-package.json').read_text()), json.loads((ROOT/'metadata/package.json').read_text()))
    require(inventory(ROOT/'source') == CHANGES and inventory(ROOT/'metadata') == M['runtimePackages'], 'Source or metadata payload differs')
    require(inventory(ROOT/'dist-delta') == DELTA and inventory(ROOT/'server-delta') == SERVER_DELTA, 'Runtime delta differs')
    require(inventory(ROOT/'dependency-delta') == M['dependencyFiles'], 'Dependency payload differs')
    require(inventory(ROOT/'modules') == M['moduleDelta'], 'Module payload differs')
    require(M['modulePackages'] == [] and M['moduleDelta'] == {}, 'Game packages must remain unchanged')
    from sandbox_config import validate_staged
    validate_staged(ROOT, M)
    require(sha(ROOT/'old-lock.json') == OLD['sourceLF']['package-lock.json'], 'Baseline lock metadata differs')
    old_lock = json.loads((ROOT/'old-lock.json').read_text()); new_lock = json.loads((ROOT/'metadata/package-lock.json').read_text())
    lock_transition(old_lock, new_lock)
    require(M['dependencyFiles'] == {}, 'A Sandbox release must not replace dependency files')


def atomic(source, target):
    require(not target.is_symlink() and not any(parent.is_symlink() for parent in target.parents),
            'Target symlink rejected')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.mk-next-' + uuid.uuid4().hex)
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


def source_backup_entries():
    return {name: digest for name, digest in OLD['source'].items() if name in CHANGES or name in DELETED}


def verify_tar(path):
    with tarfile.open(path) as archive:
        members = archive.getmembers()
        require(all(member.isfile() for member in members), 'Nonregular source backup entry')
        result = {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in members}
        require(len(result) == len(members) and result == source_backup_entries(), 'Source backup differs')


def reusable_source_backup(candidate):
    if not candidate.is_file() or candidate.is_symlink() or candidate.parent.is_symlink():
        return None
    if candidate.stat().st_dev != BACKUP.parent.stat().st_dev:
        return None
    try:
        verify_tar(candidate)
    except (RuntimeError, tarfile.TarError, OSError):
        return None
    return candidate


WALLET_BACKUP_LIMIT = 64 * 1024**2
DISK_RESERVE = 5 * 1024**3
BUILD_MARGIN = 64 * 1024**2


def bounded_dump(command, path, limit=WALLET_BACKUP_LIMIT):
    with path.open('xb') as output:
        process = subprocess.Popen(command, stdout=subprocess.PIPE)
        try:
            for block in iter(lambda: process.stdout.read(65536), b''):
                require(output.tell() + len(block) <= limit, 'Wallet backup exceeds reserved capacity')
                output.write(block)
            require(process.wait() == 0, 'Wallet backup command failed')
        except BaseException:
            if process.poll() is None:
                process.kill()
            process.wait()
            path.unlink(missing_ok=True)
            raise
        finally:
            process.stdout.close()


PROGRAM = (ROOT / 'runtime-inventory.cjs').read_text()


def backup_guard(built):
    require(sha(BACKUP / 'source.tgz') == built['sourceBackupSha256'], 'Source backup changed')
    verify_tar(BACKUP / 'source.tgz')
    require(sha(BACKUP / 'index.html') == OLD['program']['dist/index.html'], 'Client index backup changed')


def retained_backup():
    require(not (ROOT / 'build-result.json').exists() and not (ROOT / 'published.json').exists(),
            'Use the verified publish operation for an already built release')
    require(BACKUP.is_dir() and not BACKUP.is_symlink(), 'Invalid retained backup')
    verify_tar(BACKUP / 'source.tgz')
    require(sha(BACKUP / 'index.html') == OLD['program']['dist/index.html'], 'Retained client index differs')
    dump = BACKUP / 'game-wallet.dump'
    require(dump.is_file() and not dump.is_symlink() and 1000 < dump.stat().st_size <= WALLET_BACKUP_LIMIT,
            'Retained wallet backup is incomplete')
    with dump.open('rb') as source:
        subprocess.run(['docker', 'exec', '-i', 'royal-finance-sim-finance-db-1', 'pg_restore', '--list'],
                       stdin=source, stdout=subprocess.DEVNULL, check=True)
    for suffix, ref in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        require(image('royal-game:before-' + NAME + suffix) == ref, 'Retained rollback tag differs')


def bounded_archive(path, limit):
    class Writer:
        def write(self, data):
            require(output.tell()+len(data) <= limit, 'Source archive exceeds reserved capacity')
            return output.write(data)
        def tell(self): return output.tell()
        def flush(self): return output.flush()
    try:
        with path.open('xb') as output:
            with tarfile.open(fileobj=Writer(), mode='w|gz') as archive:
                for name, digest in source_backup_entries().items():
                    require(sha(LIVE/name) == digest, 'Source changed during backup')
                    archive.add(LIVE/name, arcname=name, recursive=False)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def backup_budget(available, runtime_bytes, retained):
    reserve = DISK_RESERVE + BUILD_MARGIN + runtime_bytes*4
    require(available > reserve, 'Insufficient reserve for the reviewed runtime overlay')
    if retained: return None
    limit = available - reserve - WALLET_BACKUP_LIMIT
    require(limit > 1024**2, 'Insufficient reserve for streamed source backup')
    return limit


def build():
    payload()
    require(M['moduleDelta'] == {} and M['modulePackages'] == [], 'Game modules must be retained')
    old = baseline()
    runtime_bytes = sum((ROOT/folder/name).stat().st_size for folder, rows in [
        ('dist-delta',DELTA),('server-delta',SERVER_DELTA),('metadata',M['runtimePackages']),('dependency-delta',M['dependencyFiles'])] for name in rows)
    retained = BACKUP.exists()
    archive_limit = backup_budget(old['availableBytes'],runtime_bytes,retained)
    if retained: retained_backup()
    else:
        BACKUP.mkdir(mode=0o700, exist_ok=False)
        command = ['docker','exec','royal-finance-sim-finance-db-1','sh','-c',
            'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_game']
        bounded_dump(command, BACKUP/'game-wallet.dump'); os.chmod(BACKUP/'game-wallet.dump',0o600)
        require((BACKUP/'game-wallet.dump').stat().st_size > 1000, 'Wallet backup is incomplete')
        bounded_archive(BACKUP/'source.tgz', archive_limit)
        verify_tar(BACKUP/'source.tgz')
        run(['docker','cp','royal-game-1:/app/dist/index.html',str(BACKUP/'index.html')])
        require(sha(BACKUP/'index.html') == OLD['program']['dist/index.html'], 'Client backup differs')
        for suffix, ref in [('',OLD['container']['image']),('-prepared',OLD['preparedImage'])]:
            run(['docker','tag',ref,'royal-game:before-'+NAME+suffix])
        retained_backup()
    require(shutil.disk_usage(LIVE).free > DISK_RESERVE + BUILD_MARGIN + runtime_bytes*4, 'Disk reserve changed during backup')
    context = ROOT/'runtime-context'; context.mkdir(exist_ok=False); overlay = context/'overlay'; overlay.mkdir()
    for folder, target in [('dist-delta','dist'),('server-delta','dist-server'),('dependency-delta','node_modules')]:
        shutil.copytree(ROOT/folder, overlay/target, copy_function=os.link)
    for name in M['runtimePackages']: os.link(ROOT/'metadata'/name, overlay/name)
    (context/'Dockerfile').write_text('FROM royal-game:before-'+NAME+'-prepared\n'
        'COPY --chown=1000:1000 overlay/ /app/\nLABEL org.opencontainers.image.revision="'+M['sourceCommit']+'"\n')
    (context/'.dockerignore').write_text('**\n!Dockerfile\n!.dockerignore\n!overlay\n!overlay/**\n')
    baseline()
    with (ROOT/'build.log').open('w') as log:
        subprocess.run(['docker','build','--pull=false','-t','royal-game:'+NAME,'.'],cwd=context,check=True,stdout=log,stderr=subprocess.STDOUT)
    require(shutil.disk_usage(LIVE).free > DISK_RESERVE, 'Disk reserve changed during build')
    candidate = image('royal-game:'+NAME)
    program = json.loads(run(['docker','run','--rm','--network=none','--read-only','--cpu-shares=65536','--entrypoint','node',candidate,'--v8-pool-size=1','-e',PROGRAM]))
    expected = expected_program(); require(program == expected, 'Candidate files or dependencies differ from the reviewed overlay')
    parent, child = json.loads(run(['docker','image','inspect',OLD['preparedImage'],candidate]))
    require(child['Config'].get('Labels',{}).get('org.opencontainers.image.revision') == M['sourceCommit'], 'Wrong candidate source label')
    for key in ['User','WorkingDir','Env','Entrypoint','Cmd','ExposedPorts','Healthcheck','Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image settings changed: '+key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'], 'Baseline image layers changed')
    probe = json.loads(run(['docker','run','--rm','--network=none','--read-only','--cpu-shares=65536','--entrypoint','node',candidate,'-e',(ROOT/'verify-runtime.cjs').read_text()]))
    require(probe['passed'] and probe['delayedGzip'] == 200 and probe['compressedApplicationBody'] == 415, 'Candidate decoder regression failed')
    result = {'image':candidate,'program':expected,'sourceCommit':M['sourceCommit'],'backup':str(BACKUP),
        'sourceBackupSha256':sha(BACKUP/'source.tgz'),'gameWalletBackupSha256':sha(BACKUP/'game-wallet.dump'),
        'runtimeProbe':probe,'retainedBackup':retained,'availableBytes':shutil.disk_usage(LIVE).free}
    write('build-result.json',result)
    return {'built':True,'image':candidate,'clientDeltaFiles':len(DELTA),'backendDeltaFiles':len(SERVER_DELTA),'runtimeProbe':probe}


def publication_min_free():
    source_bytes = sum((ROOT/'source'/name).stat().st_size for name in CHANGES)
    module_bytes = sum((ROOT/'modules'/name).stat().st_size for name in M['moduleDelta'])
    return DISK_RESERVE + BUILD_MARGIN + 2*source_bytes + 3*module_bytes


def publication_capacity():
    minimum = publication_min_free()
    require(shutil.disk_usage(LIVE).free > minimum, 'Insufficient publication reserve before source mutation')
    return minimum


def publication_backup(built):
    require(built['sourceCommit'] == M['sourceCommit'], 'Candidate belongs to another source revision')
    backup_guard(built)
    dump = BACKUP/'game-wallet.dump'
    require(dump.is_file() and not dump.is_symlink() and 1000 < dump.stat().st_size <= WALLET_BACKUP_LIMIT
            and sha(dump) == built['gameWalletBackupSha256'], 'Reviewed wallet backup changed')
    for suffix, ref in [('', OLD['container']['image']), ('-prepared', OLD['preparedImage'])]:
        require(image('royal-game:before-'+NAME+suffix) == ref, 'Rollback image tag changed before publication')


def quiet_gate(minimum=None):
    from financial_gate import FinancialGate
    command = ['docker','compose',*[value for name in active_compose() for value in ['-f',name]],
        'run','--rm','--no-deps','-T','--entrypoint','node','game','-e',(ROOT/'quiesce.cjs').read_text()]
    gate = FinancialGate(command, cwd=LIVE, log_path=ROOT/'financial-gate.log',
                         min_free_bytes=publication_min_free() if minimum is None else minimum,
                         disk_paths=(LIVE, ROOT, BACKUP))
    try:
        gate.acquire()
        return gate
    except BaseException:
        gate.close()
        raise


def settled_game(rows, built):
    project = OLD['container']['host']['NetworkMode']
    require(project.endswith('_default'), 'Cannot establish the reviewed Compose project')
    project = project[:-8]
    games = []
    for row in rows:
        labels = row.get('Config', {}).get('Labels') or {}
        if labels.get('com.docker.compose.project') != project:
            continue
        if labels.get('com.docker.compose.oneoff', '').lower() == 'true':
            continue
        require(labels.get('com.docker.compose.service') == 'game', 'Unexpected service in game reconciliation')
        games.append(row)
    require(len(games) <= 1, 'Temporary replacement or duplicate game requires reconciliation')
    if not games:
        return None
    row = games[0]
    require(row['Name'] == '/royal-game-1', 'Temporary replacement game requires reconciliation')
    require(row['Image'] in {OLD['container']['image'], built['image']}, 'Unreviewed game image during recovery')
    require(row['State']['Status'] in {'running','created','exited'},
            'Game lifecycle is not settled; inspect the daemon outcome before recovery')
    return {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt'],
            'status': row['State']['Status'], 'health': row['State'].get('Health', {}).get('Status')}


def reconcile_game(built):
    def inspect():
        ids = run(['docker','ps','-aq','--filter','label=com.docker.compose.service=game']).split()
        rows = json.loads(run(['docker','inspect',*ids])) if ids else []
        return settled_game(rows, built)
    first = inspect()
    time.sleep(3)
    require(inspect() == first, 'Game lifecycle changed during reconciliation')
    result = {'observationsMatch': True, 'game': first, 'at': time.time(),
              'daemonRequestCompletionProven': False,
              'cancelledDockerRequestIsNotAnAtomicRollback': True}
    write('reconciliation.json', result)
    return result


def rollback():
    payload()
    # The before and after wallet sources and contracts are identical; retain the current database.
    built = json.loads((ROOT / 'build-result.json').read_text())
    require(built['program'] == expected_program(), 'Reviewed build inventory changed')
    reconcile_game(built)
    current = snapshot(recovery=True)
    if current['container'] is not None:
        try:
            current['program'] = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', PROGRAM]))
        except subprocess.CalledProcessError:
            require(current['container']['health'] != 'healthy', 'Cannot verify files of the healthy game container')
    recovery_guard(current, built)
    backup_guard(built)
    restart = current['container'] is None or current['container']['image'] != OLD['container']['image']
    # Recovery must remain possible when the publication disk reserve was lost.
    gate = quiet_gate(minimum=BUILD_MARGIN) if restart else None
    try:
        if gate: gate.confirm()
        with tarfile.open(BACKUP / 'source.tgz') as archive:
            for name in [*CHANGES, *DELETED]:
                if gate: gate.check()
                if name in BASE:
                    restored = ROOT / 'restore' / name
                    restored.parent.mkdir(parents=True, exist_ok=True)
                    restored.write_bytes(archive.extractfile(name).read())
                    os.chmod(restored, archive.getmember(name).mode)
                    atomic(restored, LIVE / name)
                else:
                    (LIVE / name).unlink(missing_ok=True)
        from sandbox_config import remove_owned
        remove_owned(LIVE, M)
        command = ['docker', 'tag', OLD['preparedImage'], 'royal-game:latest']
        if gate:
            gate.run(command)
            compose(gate)
            gate.release()
        else:
            run(command)
    finally:
        if gate: gate.close()
    if restart: healthy()
    atomic(BACKUP / 'index.html', LIVE / 'dist/index.html')
    after = snapshot()
    settings(after, recovery=True)
    require(sources(after) == BASE and after['preparedImage'] == OLD['preparedImage']
            and after['preparedProgram'] == OLD['preparedProgram'], 'Recovered source or prepared image differs')
    require(after['program'] == OLD['program'], 'Recovered running files differ')
    result = {'restored': True, 'containerRestarted': restart, 'databaseTouched': False, 'externalModulesPreserved': True}
    write('recovered.json', result)
    return result


def publish():
    payload()
    baseline()
    built = json.loads((ROOT / 'build-result.json').read_text())
    require(built['program'] == expected_program(), 'Reviewed build inventory changed')
    require(image('royal-game:' + NAME) == built['image'], 'Candidate image changed')
    publication_backup(built)
    publication_capacity()
    gate = quiet_gate()
    critical_command_inflight = False
    publication_mutated = False
    try:
        try:
            gate.confirm()
            publication_capacity()
            for name in CHANGES:
                gate.check()
                publication_mutated = True
                atomic(ROOT / 'source' / name, LIVE / name)
            for name in DELETED:
                gate.check()
                publication_mutated = True
                (LIVE/name).unlink()
            from sandbox_config import install
            publication_mutated = True
            install(ROOT, LIVE, M)
            critical_command_inflight = True
            gate.run(['docker', 'tag', built['image'], 'royal-game:latest'])
            critical_command_inflight = False
            critical_command_inflight = True
            compose(gate)
            critical_command_inflight = False
            gate.release()
        finally:
            gate.close()
        healthy()
        after = snapshot()
        settings(after, sandbox=True)
        require(sources(after) == {**{name:digest for name,digest in BASE.items() if name not in DELETED}, **CHANGES}, 'Published source differs')
        require(after['container']['image'] == built['image'] and after['program'] == built['program'] and after['preparedProgram'] == built['program']
                and after['preparedImage'] == built['image'], 'Published runtime differs')
        shutil.copytree(ROOT / 'dist-delta', LIVE / 'dist', dirs_exist_ok=True)
        write('after.json', after)
        result = {'published': True, 'preparedImage': built['image'], 'runningImage': after['container']['image'],
                  'containerRestarted': True, 'sourceCommit': M['sourceCommit'], 'changedSources': len(CHANGES),
                  'helperSourceCommit': M['helperSourceCommit'],
                  'clientDeltaFiles': len(DELTA), 'onlySandboxConfigurationAdded': True, 'mountsPreserved': True,
                  'gameDataPreserved': True, 'backendDeltaFiles': len(SERVER_DELTA),
                  'otherBackendProgramsAndModulesPreserved': True, 'oldAssetsPreserved': True,
                  'otherPersistentServicesPreserved': len(after['services']) - 1}
        write('published.json', result)
        return result
    except BaseException as error:
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, signal.SIG_IGN)
        unknown = critical_command_inflight or bool(getattr(error, 'daemon_outcome_unknown', False))
        write('publication-failed.json', {'errorType': type(error).__name__, 'reason': str(error),
                                        'daemonOutcomeUnknown': unknown, 'mutationStarted': publication_mutated,
                                        'databaseTouched': False})
        if unknown:
            # CLI cancellation does not establish when the daemon stops its operation.
            write('recovery-required.json', {'sourceCommit': M['sourceCommit'], 'candidate': built['image'],
                'reason': 'Inspect the cancelled daemon operation and all game containers before explicit rollback',
                'automaticSecondComposeRefused': True, 'databaseTouched': False})
            reconcile_game(built)
            raise
        if publication_mutated: rollback()
        raise



if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'release', 'rollback'], 'Unexpected operation')
    require(not STATE.is_symlink() and not HOST.is_symlink(), 'Module state symlink rejected')
    payload()
    lock_path, module_lock_path = LIVE / '.client-presentation-deploy.lock', STATE / 'module.lock'
    require(not lock_path.is_symlink() and not module_lock_path.is_symlink(), 'Deployment lock symlink rejected')
    with Path('/opt/royal-releases/themed-publish.lock').open('a') as outer_lock, lock_path.open('a') as shared_lock, module_lock_path.open('a') as module_lock:
        fcntl.flock(outer_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(shared_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

        def interrupted(number, _frame):
            raise InterruptedError('Deployment interrupted: ' + str(number))

        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(number, interrupted)
        if sys.argv[1] == 'check':
            baseline()
            print(json.dumps({'ready': True, 'sourceFiles': len(CHANGES), 'clientFiles': len(DELTA), 'backendFiles': len(SERVER_DELTA)}))
        elif sys.argv[1] == 'release':
            print(json.dumps(build()), flush=True)
            print(json.dumps(publish()), flush=True)
        else:
            print(json.dumps(globals()[sys.argv[1]]()))
