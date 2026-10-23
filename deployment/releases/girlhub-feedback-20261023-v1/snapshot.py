"""Fingerprint production without exposing environment contents or private state."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

P = Path('/opt/royal')
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
            for row in containers}
environment = dict(row.split('=', 1) for row in config.get('Env', []) if '=' in row)
node = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');walk('/app/module-dist');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
prepared = run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])
program = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', node])) if not RECOVERY else None
prepared_program = json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint',
                                  'node', prepared, '-e', node])) if not RECOVERY else None
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
print(json.dumps({'at': time.time(), 'source': inventory(), 'configHashes': settings, 'container': container,
                  'preparedImage': prepared, 'program': program, 'preparedProgram': prepared_program, 'services': services,
                  'realMoneyFlags': {key: environment.get(key, 'false') for key in
                    ['NOWPAYMENTS_ENABLED', 'NOWPAYMENTS_GAMES_ENABLED', 'NOWPAYMENTS_WITHDRAWALS_ENABLED']} if raw else None,
                  'moduleFiles': {str(path): sha(path) for path in sorted(Path('/opt/royal-game-modules').rglob('*'))
                                  if path.is_file() and not path.is_symlink()},
                  'moduleHostContract': sha(Path('/opt/royal-game-modules-state/host.json')),
                  'availableBytes': stat.f_bavail * stat.f_frsize, 'totalBytes': stat.f_blocks * stat.f_frsize}, indent=2))
