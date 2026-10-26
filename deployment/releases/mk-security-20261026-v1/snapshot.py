"""Fingerprint production without exposing environment contents or private state."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

P = Path('/opt/royal')
bootstrap_locks=[]
if not (Path(__file__).resolve().parent/'install-manifest.json').exists():
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        h=open(name,'a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);bootstrap_locks.append(h)
ROOTS = ['src', 'server', 'public', 'scripts', 'docs', 'games']
INPUTS = ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json',
          'tsconfig.finance.json', 'vite.config.ts', 'deployment/SERVER.md']
RECOVERY = sys.argv[1:] == ['--recovery']
assert not sys.argv[1:] or RECOVERY, 'Unexpected snapshot operation'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args):
    return subprocess.check_output(args, text=True).strip()


def runtime_fingerprint(config):
    rows = config.get('Env', [])
    variables = dict(row.split('=', 1) for row in rows if '=' in row)
    assert len(variables) == len(rows), 'Duplicate or malformed environment entries'
    runtime = {key: config.get(key) for key in ['User', 'WorkingDir', 'Entrypoint', 'Cmd']}
    runtime['Env'] = variables
    return hashlib.sha256(json.dumps(runtime, sort_keys=True).encode()).hexdigest()


def inventory():
    result = {}
    for name in INPUTS:
        path = P / name
        if path.is_file() and not path.is_symlink():
            result[name] = sha(path)
    for root in ROOTS:
        for path in sorted((P / root).rglob('*')):
            if path.is_file() and not path.is_symlink() and not any(part.startswith(('._', '.env'))
                    or part in {'node_modules', '__pycache__', 'data', 'secrets', '.DS_Store'}
                    for part in path.relative_to(P).parts):
                result[str(path.relative_to(P))] = sha(path)
    return result


inspection = subprocess.run(['docker', 'inspect', 'royal-game-1'], text=True, capture_output=True)
assert inspection.returncode == 0 or RECOVERY, 'Game container missing'
raw = json.loads(inspection.stdout)[0] if inspection.returncode == 0 else None
config = raw['Config'] if raw else {}
labels = config.get('Labels', {})
listed = run(['docker', 'ps', '--format', '{{.ID}}\t{{.Names}}']).splitlines()
ids = [line.split('\t')[0] for line in listed if '/' + line.split('\t')[1]
       not in {'/royal-nile-account-views-once', '/royal-nile-reconcile-once'}]
containers = json.loads(run(['docker', 'inspect', *ids])) if ids else []
services = {row['Name']: {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt']}
            for row in containers
            if row['HostConfig'].get('RestartPolicy', {}).get('Name', 'no') not in ['', 'no']
            or ((row['Config'].get('Labels') or {}).get('com.docker.compose.project')
                and (row['Config'].get('Labels') or {}).get('com.docker.compose.oneoff', '').lower() != 'true')}
environment = dict(row.split('=', 1) for row in config.get('Env', []) if '=' in row)
node = (Path(__file__).resolve().parent/'runtime-inventory.cjs').read_text()
prepared = run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])
program = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '--v8-pool-size=1', '-e', node])) if not RECOVERY else None
program_lf = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '--v8-pool-size=1', '-e', node, '--', '--canonical'])) if not RECOVERY else None
dependency_lock = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', "console.log(require('fs').readFileSync('/app/node_modules/.package-lock.json','utf8'))"])) if not RECOVERY else None
# Image IDs are immutable. Reuse a verified inventory only for that exact image.
release = Path(__file__).resolve().parent
manifest_path=release / 'install-manifest.json'
reviewed = json.loads(manifest_path.read_text())['before'] if manifest_path.exists() else None
built_path = release / 'build-result.json'
built = json.loads(built_path.read_text()) if built_path.is_file() else {}
if reviewed is None:
    assert raw and prepared == raw['Image'], 'A bootstrap snapshot requires identical prepared and running images'
    candidates = [Path('/opt/royal-releases')/name/'build-result.json' for name in ['atelier-live-preview-20261025-v1','skin-npc-context-20261026-v1']]
    verified = [json.loads(path.read_text()) for path in candidates if path.is_file()]
    prior = next((row for row in verified if row['image'] == prepared), None)
    assert prior is not None, 'Bootstrap inventory requires a previously verified immutable image'
    assert {k:v for k,v in program.items() if not k.startswith('node_modules/')} == prior['program'], 'Running application differs from the prior verified image'
    prepared_program = json.loads(run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',prepared,'--v8-pool-size=1','-e',node]))
    assert program == prepared_program, 'Running application or dependencies differ from the immutable baseline image'
elif prepared == reviewed['preparedImage']:
    prepared_program = reviewed['preparedProgram'] if not RECOVERY else None
elif prepared == built.get('image'):
    prepared_program = built['program'] if not RECOVERY else None
else:
    raise RuntimeError('Prepared image changed outside this reviewed release')
settings = {name: sha(P / name) for name in ['.env', 'compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']}
host_keys = ['CpuShares', 'Memory', 'MemoryReservation', 'MemorySwap', 'NanoCpus', 'CpuPeriod', 'CpuQuota',
             'CpusetCpus', 'RestartPolicy', 'PortBindings', 'ReadonlyRootfs', 'NetworkMode', 'CapAdd', 'CapDrop',
             'SecurityOpt', 'Privileged', 'Ulimits', 'Dns', 'ExtraHosts', 'GroupAdd', 'PidsLimit']
container = {'id': raw['Id'], 'image': raw['Image'], 'startedAt': raw['State']['StartedAt'],
             'health': raw['State'].get('Health', {}).get('Status'), 'runtimeHash': runtime_fingerprint(config),
             'mounts': sorted(raw['Mounts'], key=lambda row: row['Destination']),
             'host': {key: raw['HostConfig'].get(key) for key in host_keys},
             'composeFiles': labels.get('com.docker.compose.project.config_files')} if raw else None
stat = os.statvfs(P)
source = inventory()
active={}
for pointer in Path('/opt/royal-game-modules').glob('*/active.json'):
    row=json.loads(pointer.read_text());path=Path('/opt/royal-game-modules')/row['manifest'].removeprefix('/game-modules/')
    assert sha(path)==row['sha256']
    active[pointer.parent.name]=json.loads(path.read_text())
print(json.dumps({'at': time.time(), 'source': source, 'sourceLF': {n:hashlib.sha256((P/n).read_bytes().replace(b'\r\n',b'\n')).hexdigest() for n in source}, 'activeModuleMetadata':active, 'configHashes': settings, 'container': container,
                  'programLF':program_lf,'dependencyLock':dependency_lock,
                  'preparedImage': prepared, 'program': program, 'preparedProgram': prepared_program, 'services': services,
                  'realMoneyFlags': {key: environment.get(key, 'false') for key in
                    ['NOWPAYMENTS_ENABLED', 'NOWPAYMENTS_GAMES_ENABLED', 'NOWPAYMENTS_WITHDRAWALS_ENABLED']} if raw else None,
                  'moduleFiles': {str(path): sha(path) for path in sorted(Path('/opt/royal-game-modules').rglob('*'))
                                  if path.is_file() and not path.is_symlink()},
                  'moduleHostContract': sha(Path('/opt/royal-game-modules-state/host.json')), 'moduleHost': json.loads(Path('/opt/royal-game-modules-state/host.json').read_text()),
                  'availableBytes': stat.f_bavail * stat.f_frsize, 'totalBytes': stat.f_blocks * stat.f_frsize}, indent=2))
