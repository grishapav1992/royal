"""Hash the full reviewed host without printing secrets or reading player data."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
INPUTS = ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'index.html', 'admin.html',
          'tsconfig.json', 'tsconfig.finance.json', 'vite.config.ts', 'vite.admin.config.ts']
SOURCE_ROOTS = ['src', 'server', 'public', 'scripts', 'docs', 'games']
PROTECTED_PROGRAM_NAMES = {'play.js', 'proof.js', 'payments.js', 'crypto-reconcile.js', 'index.js', 'play.cjs', 'proof.cjs',
                           'dist-server/card-engine', 'dist-server/card-engine-v1'}
PROGRAM_HASHER = r"""const f=require('fs'),c=require('crypto'),p=require('path'),out={},buffer=Buffer.allocUnsafe(262144);for(const n of JSON.parse(process.argv[1])){const file=p.join('/app',n),s=f.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>67108864||f.realpathSync(file)!==file)throw Error('Unverifiable protected program');const h=c.createHash('sha256'),fd=f.openSync(file,'r');try{let size;while(size=f.readSync(fd,buffer,0,buffer.length,null))h.update(buffer.subarray(0,size));}finally{f.closeSync(fd);}out[n]=h.digest('hex');}console.log(JSON.stringify(out));"""


def require(ok, reason):
    if not ok: raise RuntimeError(reason)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def inspect_game(recovery):
    result = subprocess.run(['docker', 'inspect', 'royal-game-1'], text=True, capture_output=True)
    if result.returncode:
        missing = result.returncode == 1 and re.search(r'no such (?:object|container):\s*royal-game-1\s*$', result.stderr, re.I)
        require(recovery and missing, 'Game inspection is unavailable or its outcome is uncertain')
        return None
    rows = json.loads(result.stdout)
    require(len(rows) == 1 and rows[0]['Name'] == '/royal-game-1', 'Unexpected game inspection')
    return rows[0]


def consistent_game_inspection(game, rows, recovery):
    matches = [row for row in rows if row['Name'] == '/royal-game-1']
    if game is None:
        require(not matches, 'Game appeared after the confirmed missing-container probe')
        return
    if not matches:
        require(recovery and game['State']['Status'] in ['created', 'exited'], 'Game disappeared during inventory')
        return
    require(len(matches) == 1 and all(matches[0][key] == game[key] for key in ['Id', 'Image'])
            and matches[0]['State']['StartedAt'] == game['State']['StartedAt'], 'Game identity changed during inventory')


def profile_sha(row):
    config, host = dict(row['Config']), row['HostConfig']
    environment = config.get('Env') or []
    values = dict(item.split('=', 1) for item in environment)
    require(len(values) == len(environment), 'Duplicate runtime environment keys')
    config['Env'] = values
    value = {'config': {k: config.get(k) for k in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd']},
        'host': {k: host.get(k) for k in ['CpuShares', 'NanoCpus', 'Memory', 'MemorySwap', 'MemoryReservation',
            'PidsLimit', 'ReadonlyRootfs', 'RestartPolicy', 'PortBindings', 'CapAdd', 'CapDrop', 'SecurityOpt',
            'Privileged', 'Ulimits', 'GroupAdd', 'Dns', 'ExtraHosts']},
        'mounts': sorted([{k: m.get(k) for k in ['Type', 'Source', 'Destination', 'RW', 'Propagation']}
                          for m in row['Mounts']], key=lambda m: m['Destination']),
        'networks': sorted(row['NetworkSettings']['Networks'])}
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def runtime_hash(config):
    rows = config.get('Env', [])
    variables = dict(row.split('=', 1) for row in rows if '=' in row)
    require(len(rows) == len(variables), 'Malformed or duplicate runtime environment')
    value = {k: config.get(k) for k in ['User', 'WorkingDir', 'Entrypoint', 'Cmd']}
    value['Env'] = variables
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def source_inventory():
    result, normalized = {}, {}
    paths = [LIVE / name for name in INPUTS]
    for name in SOURCE_ROOTS: paths.extend(sorted((LIVE / name).rglob('*')))
    for path in paths:
        relative = path.relative_to(LIVE)
        if any(part.startswith(('.env', '._')) or part in ['node_modules', '__pycache__', 'data', 'secrets', '.DS_Store'] for part in relative.parts): continue
        require(not path.is_symlink(), 'Unexpected source symlink')
        if path.is_file():
            data = path.read_bytes()
            result[relative.as_posix()] = hashlib.sha256(data).hexdigest()
            normalized[relative.as_posix()] = hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest() if path.suffix in [
                '.ts', '.js', '.mjs', '.cjs', '.css', '.json', '.html', '.md', '.txt', '.yaml', '.yml'] else result[relative.as_posix()]
    return result, normalized


def module_inventory(root=MODULES):
    require(root.is_dir() and not any(p.is_symlink() for p in [root, *root.parents]), 'Unsafe module root')
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Unexpected external module symlink')
        require(path.is_file() or path.is_dir(), 'Unexpected external module file type')
        if path.is_file(): result[str(path)] = sha(path)
    return result


def host_contract(file=STATE / 'host.json'):
    require(file.is_file() and not any(p.is_symlink() for p in [file, *file.parents]), 'Unsafe host contract')
    return sha(file), json.loads(file.read_text())


def protected_programs(before):
    records = before.get('protectedPrograms')
    require(isinstance(records, dict) and 1 <= len(records) <= 4, 'Missing protected service program inventory')
    result = {}
    for service, files in records.items():
        require(re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,127}', service) and service != 'royal-game-1'
                and '/' + service in before['services'], 'Unknown protected service')
        require(isinstance(files, dict) and 1 <= len(files) <= 8 and set(files).issubset(PROTECTED_PROGRAM_NAMES), 'Unsafe protected program path')
        require(all(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) for value in files.values()), 'Invalid protected program digest')
        actual = json.loads(run(['docker', 'exec', service, 'node', '--v8-pool-size=1', '-e', PROGRAM_HASHER, json.dumps(sorted(files))]))
        require(set(actual) == set(files) and all(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value)
                for value in actual.values()), 'Protected program inventory is incomplete')
        result[service] = actual
    return result


def snapshot(recovery=False):
    manifest = json.loads((ROOT / 'install-manifest.json').read_text())
    before = manifest['before']
    game = inspect_game(recovery)
    identifiers = run(['docker', 'ps', '--no-trunc', '-q']).splitlines()
    require(identifiers, 'Cannot establish persistent service inventory')
    try: rows = json.loads(run(['docker', 'inspect', *identifiers]))
    except subprocess.CalledProcessError as error:
        raise RuntimeError('Docker inventory changed or is uncertain; obtain a new snapshot') from error
    consistent_game_inspection(game, rows, recovery)
    services, profiles = {}, {}
    for row in rows:
        labels = row['Config'].get('Labels') or {}
        if row['HostConfig'].get('RestartPolicy', {}).get('Name', 'no') in ['', 'no'] and (
                labels.get('com.docker.compose.oneoff', '').lower() == 'true' or not labels.get('com.docker.compose.project')): continue
        record = {'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt']}
        services[row['Name']] = record
        profiles[row['Name'].lstrip('/')] = {**record, 'profileSha256': profile_sha(row)}
    protected = set(before['services']) - ({'/royal-game-1'} if recovery else set())
    require(protected.issubset(services), 'A protected persistent service disappeared')
    prepared = run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])
    built_path = ROOT / 'build-result.json'
    built = json.loads(built_path.read_text()) if built_path.is_file() else {}
    if prepared == before['preparedImage']:
        prepared_program = before['preparedProgram']
        source_commit = before['sourceCommit']
    elif prepared == built.get('image'):
        prepared_program = built['program']
        source_commit = manifest['sourceCommit']
    else: raise RuntimeError('Prepared image changed outside the reviewed release')
    program = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '--v8-pool-size=1', '-e',
                             (ROOT / 'runtime-inventory.cjs').read_text()])) if game and not recovery else None
    config = game['Config'] if game else {}
    host_keys = ['CpuShares', 'Memory', 'MemoryReservation', 'MemorySwap', 'NanoCpus', 'CpuPeriod', 'CpuQuota',
        'CpusetCpus', 'RestartPolicy', 'PortBindings', 'ReadonlyRootfs', 'NetworkMode', 'CapAdd', 'CapDrop',
        'SecurityOpt', 'Privileged', 'Ulimits', 'Dns', 'ExtraHosts', 'GroupAdd', 'PidsLimit']
    container = {'id': game['Id'], 'image': game['Image'], 'startedAt': game['State']['StartedAt'],
        'health': game['State'].get('Health', {}).get('Status'), 'runtimeHash': runtime_hash(config),
        'mounts': sorted(game['Mounts'], key=lambda m: m['Destination']),
        'host': {key: game['HostConfig'].get(key) for key in host_keys},
        'composeFiles': (config.get('Labels') or {}).get('com.docker.compose.project.config_files')} if game else None
    hashes = {name: sha(LIVE / name) for name in before['configHashes']}
    source, source_lf = source_inventory()
    modules = module_inventory()
    contract_sha, contract = host_contract()
    retained_programs = protected_programs(before)
    return {'at': time.time(), 'sourceCommit': source_commit, 'sourceRevision': source_commit, 'source': source,
        'sourceLF': source_lf, 'configHashes': hashes, 'container': container, 'services': services, 'serviceProfiles': profiles,
        'preparedImage': prepared, 'program': program, 'preparedProgram': prepared_program if not recovery else None,
        'moduleFiles': modules, 'moduleHostContract': contract_sha,
        'moduleHost': contract, 'realMoneyFlags': None,
        'protectedPrograms': retained_programs,
        'availableBytes': shutil.disk_usage(LIVE).free}


if __name__ == '__main__':
    require(not sys.argv[1:] or sys.argv[1:] == ['--recovery'], 'Unexpected snapshot operation')
    print(json.dumps(snapshot(bool(sys.argv[1:]))))
