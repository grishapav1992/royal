"""Read source and runtime fingerprints without exposing configuration secrets or player data."""
from pathlib import Path
import hashlib
import json
import subprocess

LIVE = Path('/opt/royal')
FINANCE = Path('/opt/royal-finance')
ROOTS = ['src', 'server', 'public', 'scripts', 'docs', 'games']
INPUTS = ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'index.html', 'admin.html',
          'tsconfig.json', 'tsconfig.finance.json', 'vite.config.ts', 'vite.admin.config.ts']
PROGRAM = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}for(const d of ['dist','dist-server','module-dist'])walk('/app/'+d);for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"


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
    return json.loads(run(['docker', 'inspect', name]))[0]


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
    ids = run(['docker', 'ps', '--format', '{{.Names}}']).splitlines()
    for name in ids:
        if name in ['royal-nile-reconcile-once', 'royal-nile-account-views-once']:
            continue
        row = inspect(name)
        containers[name] = {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt'],
                            'health': row['State'].get('Health', {}).get('Status')}
        if name in ['royal-game-1', 'royal-payments-1', 'royal-nile-play']:
            containers[name].update({'profile': profile(row), 'stableProfile': profile(row, True),
                'composeFiles': row['Config'].get('Labels', {}).get('com.docker.compose.project.config_files', '').split(',')})
    game = inspect('royal-game-1')
    prepared = run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])
    return {'source': sources(LIVE), 'financeSource': sources(FINANCE), 'containers': containers,
            'preparedImage': prepared,
            'program': json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', PROGRAM])) if include_program else None,
            'preparedProgram': json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', prepared, '-e', PROGRAM])) if include_prepared else None,
            'configuration': {str(p): sha(p) for p in [LIVE / '.env', *[Path(n) for n in containers['royal-game-1']['composeFiles']],
                *[Path(n) for n in containers['royal-nile-play']['composeFiles']]]},
            'modules': {str(p): sha(p) for p in Path('/opt/royal-game-modules').rglob('*') if p.is_file() and not p.is_symlink()},
            'hostContract': sha('/opt/royal-game-modules-state/host.json')}


if __name__ == '__main__':
    print(json.dumps(snapshot(), indent=2))
