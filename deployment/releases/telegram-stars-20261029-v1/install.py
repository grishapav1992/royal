"""Guarded payment-service-only owner probe. Never installs host or game outputs."""
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import uuid

NAME = 'telegram-stars-20261029-v1'
LIVE = Path('/opt/royal')
ROOT = Path(__file__).resolve().parent
BACKUP = Path('/opt/royal-backups') / NAME
MINIMUM = 5 * 1024**3
SCOPE = {'server/crypto/store.ts', 'server/payments/app.ts', 'server/payments/index.ts',
         'server/payments/runtime.ts', 'server/payments/telegram-provider.ts',
         'server/payments/telegram-stars.ts', 'src/shared/cryptoWallet.ts'}
CADDY = 'deployment/Caddyfile'
PROVIDER = Path('/opt/royal-payment-secrets/provider.env')
BLOCK = '    handle /api/telegram-stars/* {\n        reverse_proxy payments:2570\n    }\n'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha(path):
    require(not path.is_symlink(), 'Symlink rejected')
    return digest(path.read_bytes())


def run(args, **kwargs):
    return subprocess.check_output(args, cwd=LIVE, text=True, timeout=180, **kwargs).strip()


def read(path):
    require(not path.is_symlink(), 'Manifest symlink rejected')
    return json.loads(path.read_text())


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


@contextlib.contextmanager
def locks():
    handles = []
    try:
        for name in ['/opt/royal-releases/themed-publish.lock', str(LIVE/'.client-presentation-deploy.lock'),
                     '/opt/royal-game-modules-state/module.lock']:
            path = Path(name)
            require(not path.is_symlink(), 'Lock symlink rejected')
            handle = path.open('a')
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            handles.append(handle)
        yield
    finally:
        for handle in reversed(handles):
            handle.close()


def inventory(directory):
    result = {}
    for path in sorted(directory.rglob('*')):
        if path.is_file():
            require(not path.is_symlink(), 'Source symlink rejected')
            result[str(path.relative_to(directory))] = sha(path)
    return result


def snapshot():
    rows = json.loads(run(['docker', 'inspect', *run(['docker', 'ps', '-q']).split()]))
    services = {}
    payment = None
    for row in rows:
        if row['HostConfig']['RestartPolicy']['Name'] in ['always', 'unless-stopped', 'on-failure']:
            services[row['Name']] = {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt'],
                'configuration': digest(json.dumps({'config': row['Config'], 'host': row['HostConfig'],
                    'mounts': row['Mounts']}, sort_keys=True).encode())}
        if row['Name'] == '/royal-payments-1':
            payment = row
    require(payment is not None and payment['State'].get('Health', {}).get('Status') == 'healthy', 'Payment service unhealthy')
    env = dict(item.split('=', 1) for item in payment['Config']['Env'])
    require(all(env.get(key, 'false') == 'false' for key in
        ['NOWPAYMENTS_ENABLED', 'NOWPAYMENTS_GAMES_ENABLED', 'NOWPAYMENTS_WITHDRAWALS_ENABLED']), 'Real-money activation is outside this probe')
    source, canonical = {}, {}
    for folder in ['server', 'src']:
        for name, value in inventory(LIVE/folder).items():
            key = folder + '/' + name
            source[key] = value
            canonical[key] = digest((LIVE/key).read_bytes().replace(b'\r\n', b'\n'))
    source[CADDY] = sha(LIVE/CADDY)
    settings = {str(p): sha(p) for p in [PROVIDER, *[LIVE/name for name in
        ['.env', 'compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml',
         'compose.nowpayments-sandbox.yaml', 'deployment/SERVER.md']]] if p.is_file()}
    node = (ROOT/'runtime-inventory.cjs').read_text()
    programs = {name: json.loads(run(['docker', 'exec', name, 'node', '-e', node]))
                for name in ['royal-game-1', 'royal-payments-1']}
    versions = json.loads(run(['docker', 'exec', 'royal-payments-1', 'node', '-e',
        "const f=require('fs');console.log(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(f.readFileSync('node_modules/.package-lock.json')).packages).map(([k,v])=>[k,v.version]))))"]))
    return {'source': source, 'sourceLF': canonical, 'settings': settings, 'services': services, 'programs': programs,
        'dependencies': versions, 'prepared': run(['docker', 'image', 'inspect', 'royal-payments:latest', '--format', '{{.Id}}']),
        'compose': payment['Config']['Labels']['com.docker.compose.project.config_files'].split(','),
        'paymentRuntime': {key: payment[key] for key in ['Mounts', 'HostConfig']},
        'paymentEnvironmentHash': digest(json.dumps({key: value for key, value in env.items()
            if not key.startswith('TELEGRAM_')}, sort_keys=True).encode()),
        'paymentProcessHash': digest(json.dumps({key: payment['Config'].get(key) for key in
            ['User', 'WorkingDir', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']}, sort_keys=True).encode()),
        'moduleFiles': inventory(Path('/opt/royal-game-modules')),
        'hostContract': sha(Path('/opt/royal-game-modules-state/host.json'))}


def capacity():
    require(shutil.disk_usage(LIVE).free > MINIMUM + 128*1024**2, 'Insufficient server space')


def copy_source(source, target):
    require(not source.is_symlink() and not target.is_symlink(), 'Copy symlink rejected')
    target.parent.mkdir(parents=True, exist_ok=True)
    # The Caddy mount points to this inode. Reload occurs only after a complete fsynced write.
    with source.open('rb') as reader, target.open('wb') as writer:
        shutil.copyfileobj(reader, writer)
        writer.flush()
        os.fsync(writer.fileno())
    target.chmod(0o644)


def environment(value):
    allowed = {'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET',
        'TELEGRAM_STARS_ENABLED', 'TELEGRAM_STARS_TRIAL', 'TELEGRAM_STARS_TRIAL_ACCOUNT_IDS',
        'TELEGRAM_STARS_USDT_UNITS_PER_STAR', 'TELEGRAM_STARS_TERMS_URL', 'TELEGRAM_STARS_SUPPORT_URL',
        'TELEGRAM_STARS_PUBLIC_ORIGIN'}
    require(set(value) == allowed, 'Unexpected Telegram configuration fields')
    require(value['TELEGRAM_STARS_ENABLED'] == 'true' and value['TELEGRAM_STARS_TRIAL'] == 'true'
        and value['TELEGRAM_STARS_USDT_UNITS_PER_STAR'] == '10000', 'Only the owner trial is authorized')
    require(all(isinstance(item, str) and '\n' not in item and '\r' not in item for item in value.values()), 'Invalid configuration value')
    require(str(uuid.UUID(value['TELEGRAM_STARS_TRIAL_ACCOUNT_IDS'])) == value['TELEGRAM_STARS_TRIAL_ACCOUNT_IDS'], 'Exactly one trial account is required')
    lines = PROVIDER.read_text().splitlines()
    require(not any(line.split('=', 1)[0].endswith('_FILE') and line.split('=', 1)[0][:-5] in allowed for line in lines), 'Preserve existing Telegram file secrets')
    previous = [line for line in lines if line.split('=', 1)[0] not in allowed]
    pending = PROVIDER.with_name('provider.env.' + NAME + '.pending')
    descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write('\n'.join([*previous, *[key+'='+item for key, item in value.items()]])+'\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(pending, PROVIDER)


def healthy(gate):
    for _ in range(60):
        row = json.loads(gate.run(['docker', 'inspect', 'royal-payments-1']))[0]
        if row['State'].get('Health', {}).get('Status') == 'healthy':
            return row
        gate.check()
        time.sleep(1)
    raise RuntimeError('Payment service did not become healthy')


def backup_payments():
    path = BACKUP/'payments.dump'
    require(BACKUP.is_dir() and not BACKUP.is_symlink() and not path.exists(), 'Unexpected backup state')
    command = ['docker', 'exec', 'royal-finance-sim-finance-db-1', 'sh', '-ec',
        'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_payments']
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        with path.open('xb') as output:
            path.chmod(0o600)
            total = 0
            while True:
                chunk = process.stdout.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                require(total <= 64*1024**2, 'Payment backup budget exceeded')
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        require(process.wait(timeout=10) == 0 and total > 1000, 'Payment backup incomplete')
        with path.open('rb') as input_file:
            listing = subprocess.check_output(['docker', 'exec', '-i', 'royal-finance-sim-finance-db-1', 'pg_restore', '--list'], stdin=input_file, timeout=30)
        require(b'royal_payments' in listing, 'Payment backup is unreadable')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def release(private):
    manifest = read(ROOT/'install-manifest.json')
    old = manifest['before']
    receipt = read(ROOT/'release-github.json')
    release_manifest = read(ROOT/'release-manifest.json')
    for name, value in manifest['helpers'].items():
        require(name in ['install.py', 'probe.py', 'runtime-inventory.cjs', 'quiesce.cjs', 'financial_gate.py'] and sha(ROOT/name) == value, 'Installer helper changed')
    require(manifest['sourceCommit'] == receipt['sourceCommit'] == release_manifest['sourceCommit'], 'Source identity differs')
    require(release_manifest['build']['passed'] and release_manifest['githubVerified'], 'Unverified release')
    require(set(manifest['changed']) <= SCOPE, 'Unrelated source delta')
    for name, value in manifest['inputs'].items():
        require(name in SCOPE or old['sourceLF'].get(name) == value, 'Unrelated payment input changed: '+name)
    for name, value in manifest['changed'].items():
        require(sha(ROOT/'source'/name) == value == manifest['inputs'][name], 'Source payload changed')
    binary = ROOT/'payments.js'
    require(sha(binary) == release_manifest['files']['dist-server/payments.js'], 'Payment bundle changed')
    require(snapshot() == old, 'Production changed since review')
    updates = manifest['dependencyUpdates']
    require(set(updates) <= {'node_modules/body-parser', 'node_modules/qs'}, 'Unreviewed dependency update')
    require([name for name, version in manifest['dependencies'].items() if old['dependencies'].get(name) != version] == updates, 'Dependency update scope differs')
    require(sha(ROOT/'package-lock.json') == manifest['lockHash'], 'Committed dependency lock differs')
    package_lock = read(ROOT/'package-lock.json')
    for name, value in manifest['dependencyFiles'].items():
        require(any(name.startswith(folder+'/') for folder in updates)
            and '..' not in Path(name).parts and sha(ROOT/'dependencies'/name) == value, 'Dependency payload changed')
    for folder in updates:
        require(all(name in manifest['dependencyFiles'] for name in old['programs']['royal-payments-1'] if name.startswith(folder+'/')), 'Obsolete dependency files require a separate reviewed release')
    candidate_caddy = (ROOT/'Caddyfile').read_text()
    require(candidate_caddy.count(BLOCK) == 1 and candidate_caddy.replace(BLOCK, '') == (LIVE/CADDY).read_text(), 'Caddy changes exceed the Stars route')
    capacity()
    require(not BACKUP.exists() and not (ROOT/'published.json').exists(), 'Release already started; reconcile before retry')
    BACKUP.mkdir(mode=0o700)
    for name in [*manifest['changed'], CADDY]:
        path = LIVE/name
        if path.is_file():
            saved = BACKUP/'source'/name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    shutil.copy2(PROVIDER, BACKUP/'provider.env')
    (BACKUP/'provider.env').chmod(0o600)
    with tarfile.open(BACKUP/'source.tgz', 'w:gz') as output:
        output.add(BACKUP/'source', arcname='source')
    old_image = old['services']['/royal-payments-1']['image']
    run(['docker', 'tag', old_image, 'royal-payments:before-'+NAME])
    require(old['prepared'] == old_image, 'Prepared payment image differs from the running base')
    context = ROOT/'runtime-context'
    context.mkdir()
    shutil.copy2(binary, context/'payments.js')
    if updates:
        shutil.copytree(ROOT/'dependencies'/'node_modules', context/'node_modules')
        # Retain all unrelated installed metadata; replace only records pinned by the committed lock.
        script = "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/app/node_modules/.package-lock.json'));const v=JSON.parse(process.argv[1]);Object.assign(p.packages,v);process.stdout.write(JSON.stringify(p,null,2)+'\\n');"
        records = {name: package_lock['packages'][name] for name in updates}
        metadata = run(['docker', 'exec', 'royal-payments-1', 'node', '-e', script, json.dumps(records)]) + '\n'
        (context/'node_modules'/'.package-lock.json').write_text(metadata)
    (context/'Dockerfile').write_text('FROM royal-payments:before-'+NAME+'\nCOPY --chown=1000:1000 payments.js /app/dist-server/payments.js\n'
        + ('COPY --chown=1000:1000 node_modules/ /app/node_modules/\n' if updates else '')
        + 'LABEL org.opencontainers.image.revision="'+manifest['sourceCommit']+'"\n')
    run(['docker', 'build', '--pull=false', '-t', 'royal-payments:'+NAME, str(context)])
    built = run(['docker', 'image', 'inspect', 'royal-payments:'+NAME, '--format', '{{.Id}}'])
    node = (ROOT/'runtime-inventory.cjs').read_text()
    expected_program = {**old['programs']['royal-payments-1'], **manifest['dependencyFiles'], 'dist-server/payments.js': sha(binary)}
    if updates:
        expected_program['node_modules/.package-lock.json'] = sha(context/'node_modules'/'.package-lock.json')
    actual = json.loads(run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'node', built, '-e', node]))
    require(actual == expected_program, 'Candidate changes exceed payments.js')
    require(snapshot() == old, 'Production changed during image preparation')
    capacity()
    spec = importlib.util.spec_from_file_location('financial_gate', ROOT/'financial_gate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    game_compose = json.loads(run(['docker', 'inspect', 'royal-game-1']))[0]['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    gate = module.FinancialGate(['docker', 'compose', *[v for name in game_compose for v in ['-f', name]],
        'run', '--rm', '--no-deps', '-T', '--entrypoint', 'node', 'game', '-e', (ROOT/'quiesce.cjs').read_text()],
        cwd=LIVE, log_path=ROOT/'financial-gate.log', min_free_bytes=MINIMUM, disk_paths=(LIVE, ROOT, BACKUP))
    compose = ['docker', 'compose', *[v for name in old['compose'] for v in ['-f', name]]]
    mutated = False
    try:
        gate.acquire()
        require(json.loads(gate.run(['python3', str(__file__), 'snapshot-unlocked'])) == old, 'Production changed before installation')
        gate.run(['python3', '-c', "import subprocess,sys;subprocess.run(['docker','exec','-i','royal-caddy-1','caddy','validate','--config','/dev/stdin','--adapter','caddyfile'],input=open(sys.argv[1]).read(),text=True,check=True)", str(ROOT/'Caddyfile')])
        # Never restore a database during recovery. This is a private financial backup only.
        gate.run(['python3', str(__file__), 'backup-payments'], timeout=90)
        gate.confirm()
        mutated = True
        environment(private)
        for name in manifest['changed']:
            gate.check()
            copy_source(ROOT/'source'/name, LIVE/name)
        gate.run(['docker', 'tag', built, 'royal-payments:latest'])
        gate.run([*compose, 'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'payments'])
        healthy(gate)
        copy_source(ROOT/'Caddyfile', LIVE/CADDY)
        gate.run(['docker', 'exec', 'royal-caddy-1', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
        gate.confirm()
        after = json.loads(gate.run(['python3', str(__file__), 'snapshot-unlocked']))
        require(after['programs']['royal-game-1'] == old['programs']['royal-game-1'], 'Game runtime changed')
        require(after['programs']['royal-payments-1'] == expected_program, 'Payment runtime differs')
        require({n: v for n, v in after['services'].items() if n != '/royal-payments-1'} ==
                {n: v for n, v in old['services'].items() if n != '/royal-payments-1'}, 'Another persistent service changed')
        require(after['source'] == {**old['source'], **manifest['changed'], CADDY: sha(ROOT/'Caddyfile')}, 'Unrelated source changed')
        require(after['settings'] == {**old['settings'], str(PROVIDER): sha(PROVIDER)}, 'Protected settings changed')
        for key in ['moduleFiles', 'hostContract', 'paymentRuntime', 'paymentEnvironmentHash', 'paymentProcessHash', 'compose']:
            require(after[key] == old[key], 'Protected state changed: '+key)
        require(after['dependencies'] == {**old['dependencies'], **{name: manifest['dependencies'][name] for name in updates}}, 'Unrelated dependency versions changed')
        require(after['services']['/royal-payments-1']['image'] == built, 'Running payment image differs')
        gate.release()
        result = {'release': NAME, 'sourceCommit': manifest['sourceCommit'], 'image': built,
            'published': True, 'changedSources': sorted(manifest['changed']), 'gameAndOtherServicesPreserved': True,
            'runtimeFilesVerified': {name: len(files) for name, files in after['programs'].items()},
            'dependencyUpdates': {name: manifest['dependencies'][name] for name in updates},
            'sourceBackupBytes': (BACKUP/'source.tgz').stat().st_size, 'sourceBackupSha256': sha(BACKUP/'source.tgz'),
            'paymentBackupBytes': (BACKUP/'payments.dump').stat().st_size, 'paymentBackupSha256': sha(BACKUP/'payments.dump'),
            'freeBytesAfter': shutil.disk_usage(LIVE).free, 'at': time.time()}
        save(ROOT/'published.json', result)
        return result
    except BaseException:
        save(ROOT/'recovery-required.json', {'mutated': mutated, 'at': time.time(),
            'instruction': 'Inspect the running image, source, settings and active callbacks before recovery. Never restore the database over accepted payments.'})
        raise
    finally:
        gate.close()


if __name__ == '__main__':
    def interrupted(number, _frame):
        raise InterruptedError('Payment publication interrupted: '+str(number))
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
        signal.signal(number, interrupted)
    require(sys.argv[1:] in [['snapshot'], ['snapshot-unlocked'], ['backup-payments'], ['release']], 'Unexpected operation')
    if sys.argv[1] == 'snapshot-unlocked':
        print(json.dumps(snapshot()))
    elif sys.argv[1] == 'backup-payments':
        backup_payments()
    else:
        with locks():
            if sys.argv[1] == 'snapshot':
                print(json.dumps(snapshot()))
            else:
                print(json.dumps(release(json.load(sys.stdin))))
