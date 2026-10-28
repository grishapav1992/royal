"""Read source and runtime fingerprints without exposing configuration secrets or player data."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

LIVE = Path('/opt/royal')
FINANCE = Path('/opt/royal-finance')
ROOTS = ['src', 'server', 'public', 'scripts', 'docs', 'games']
INPUTS = ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'index.html', 'admin.html',
          'tsconfig.json', 'tsconfig.finance.json', 'vite.config.ts', 'vite.admin.config.ts']
ROOT = Path(__file__).resolve().parent
PROGRAM = (ROOT/'runtime-inventory.cjs').read_text()



def run(args):
    return subprocess.check_output(args, text=True).strip()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sources(root):
    result = {}
    paths = [root / name for name in INPUTS]
    for name in ROOTS:
        paths += list((root / name).rglob('*'))
    for path in paths:
        name = path.relative_to(root).as_posix()
        if path.is_file() and not path.is_symlink() and not any(p.startswith(('.env', '._')) or p in
                ['node_modules', '__pycache__', 'data', 'secrets', '.DS_Store'] for p in path.relative_to(root).parts):
            data = path.read_bytes()
            result[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'lf': hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()}
    return result


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name], text=True, stderr=subprocess.PIPE))[0]


def container_rows(protected=()):
    rows = {}
    for name in run(['docker', 'ps', '--format', '{{.Names}}']).splitlines():
        try:
            rows[name] = inspect(name)
        except subprocess.CalledProcessError as error:
            if name in protected or error.returncode != 1 or 'No such object:' not in (error.stderr or ''):
                raise
    return rows


def profile(row, without_admin=False):
    config = row['Config']
    env = sorted(v for v in config.get('Env', []) if not without_admin or not v.startswith('FINANCE_ADMIN_ACCOUNT_IDS='))
    host = {k: row['HostConfig'].get(k) for k in ['CpuShares', 'NanoCpus', 'Memory', 'MemorySwap', 'MemoryReservation',
        'PidsLimit', 'ReadonlyRootfs', 'RestartPolicy', 'PortBindings', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Privileged', 'Ulimits', 'GroupAdd', 'Dns', 'ExtraHosts']}
    return {'user': config.get('User'), 'cwd': config.get('WorkingDir'), 'cmd': config.get('Cmd'), 'entrypoint': config.get('Entrypoint'),
            'envHash': hashlib.sha256(json.dumps(env).encode()).hexdigest(), 'host': host,
            'mounts': sorted([{k: v.get(k) for k in ['Type', 'Source', 'Destination', 'RW', 'Propagation']} for v in row['Mounts']], key=lambda v: v['Destination']),
            'networks': sorted(row['NetworkSettings']['Networks'])}


def snapshot(*, include_program=True, include_prepared=True):
    containers = {}
    manifest = ROOT/'install-manifest.json'
    protected = json.loads(manifest.read_text())['before']['containers'] if manifest.exists() else ()
    for name, row in container_rows(protected).items():
        labels = row['Config'].get('Labels') or {}
        if row['HostConfig'].get('RestartPolicy',{}).get('Name','no') in ['','no'] and (labels.get('com.docker.compose.oneoff','').lower()=='true' or not labels.get('com.docker.compose.project')):
            continue
        containers[name] = {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt'],
                            'health': row['State'].get('Health', {}).get('Status')}
        if name in ['royal-game-1', 'royal-payments-1', 'royal-nile-play']:
            containers[name].update({'profile': profile(row), 'stableProfile': profile(row, True),
                'composeFiles': row['Config'].get('Labels', {}).get('com.docker.compose.project.config_files', '').split(',')})
    game = inspect('royal-game-1')
    prepared = run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])
    prior = json.loads(Path('/opt/royal-releases/neopolis-ui-20261028-v1/build-result.json').read_text())
    built = json.loads((ROOT/'build-result.json').read_text()) if (ROOT/'build-result.json').exists() else {}
    if prepared == built.get('game'): prepared_program = built['program']
    elif prepared == prior['image']: prepared_program = prior['program']
    else: raise RuntimeError('Unreviewed prepared image')
    financial = inspect('royal-nile-play')
    finance_program = json.loads(run(['docker','exec','royal-nile-play','node','--v8-pool-size=1','-e',
      "const f=require('fs'),c=require('crypto'),r={};for(const n of ['play.js','proof.js','package.json','package-lock.json','dist-server/card-engine','dist-server/card-engine-v1'])r[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(r))"]))
    configuration = {str(p): sha(p) for p in [LIVE/'.env', LIVE/'.env.nowpayments-sandbox', *[Path(n) for n in containers['royal-game-1']['composeFiles']], *[Path(n) for n in containers['royal-nile-play']['composeFiles']]]}
    return {'sourceRevision':game['Config'].get('Labels',{}).get('org.opencontainers.image.revision'),'moduleHost':json.loads(Path('/opt/royal-game-modules-state/host.json').read_text()),'at':__import__('time').time(),'source': sources(LIVE), 'financeSource': sources(FINANCE), 'containers': containers, 'financialProgram':finance_program,
            'configuration':configuration,'freeBytes':__import__('shutil').disk_usage(LIVE).free,
            'preparedImage': prepared,
            'program': json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '--v8-pool-size=1', '-e', PROGRAM])) if include_program else None,
            'preparedProgram': prepared_program if include_prepared else None,
            'modules': {str(p): sha(p) for p in Path('/opt/royal-game-modules').rglob('*') if p.is_file() and not p.is_symlink()},
            'hostContract': sha('/opt/royal-game-modules-state/host.json')}


if __name__ == '__main__':
    print(json.dumps(snapshot(include_program='--quick' not in sys.argv), indent=2))
