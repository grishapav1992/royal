#!/usr/bin/env python3
"""Read-only container identity guards shared by production retention."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

LIVE = Path('/opt/royal')
ROOTS = (Path('/opt/royal-releases'), Path('/opt/royal-backups'))
IMAGE_RE = re.compile(r'sha256:[a-f0-9]{64}')
RELEASE_RE = re.compile(r'[a-z0-9][a-zA-Z0-9_.-]{0,119}')
BLOCKED_PARTS = {'data', 'database', 'databases', 'secrets', 'node_modules', '.git', '.ssh', 'config', 'configs'}
BLOCKED_SUFFIXES = ('.db', '.sqlite', '.sqlite3', '.dump', '.sql', '.wal', '.shm', '.age', '.key', '.pem', '.env')
ARCHIVES = ('.tar', '.tgz', '.tar.gz', '.tar.xz', '.tar.bz2')
CODE_SUFFIXES = ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.go', '.rs', '.py', '.md')
PERIODIC_NAMES = {'/royal-nile-account-views-once', '/royal-nile-reconcile-once'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=90).strip()


def sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.next')
    with temporary.open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def safe_name(name):
    p = PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or not p.parts:
        return False
    for part in p.parts:
        lower = part.lower()
        if lower in BLOCKED_PARTS or lower.startswith(('.env', 'environment.', 'id_rsa', 'id_ed25519')):
            return False
        if any(token in lower for token in ('secret', 'credential')):
            return False
        if any(token in lower for token in ('database', 'postgres')) and not lower.endswith(CODE_SUFFIXES):
            return False
        if lower.endswith(BLOCKED_SUFFIXES) or lower.endswith(('-wal', '-shm')):
            return False
    return True


def safe_archive(path):
    path = Path(path)
    if path.name in ['source.tgz', 'source.tar.gz'] and path.parent.parent == ROOTS[1]:
        manifest = ROOTS[0] / path.parent.name / 'install-manifest.json'
        if manifest.is_file() and not manifest.is_symlink():
            try:
                verify_source_archive(path, json.loads(manifest.read_text())['baseline'])
                return True
            except (OSError, ValueError, KeyError, RuntimeError, tarfile.TarError):
                pass
    if not str(path).endswith(ARCHIVES):
        return not str(path).endswith(('.gz', '.zip', '.xz', '.bz2', '.7z'))
    try:
        with tarfile.open(path) as archive:
            members = archive.getmembers()
            return bool(members) and all((m.isfile() or m.isdir()) and safe_name(m.name) for m in members)
    except (OSError, tarfile.TarError):
        return False


def verify_source_archive(path, baseline):
    baseline = {x['path']: x['sha256'] for x in baseline} if isinstance(baseline, list) else baseline
    require(baseline and all(not PurePosixPath(p).is_absolute() and '..' not in PurePosixPath(p).parts
                            and not any(x in ['data', '.ssh', '.git', 'secrets'] or x.startswith('.env')
                                        for x in PurePosixPath(p).parts) for p in baseline), 'Unsafe source baseline')
    with tarfile.open(path) as source:
        members = source.getmembers()
        require(all(x.isfile() or x.isdir() for x in members), 'Source backup contains special files')
        files = [x for x in members if x.isfile()]
        require(len(files) == len(baseline) and {x.name for x in files} == set(baseline), 'Source backup differs from complete release baseline')
        require(all(hashlib.sha256(source.extractfile(x).read()).hexdigest() == baseline[x.name] for x in files), 'Source backup content differs from release baseline')


def managed_directory(path):
    path = Path(path)
    return path.parent in ROOTS and RELEASE_RE.fullmatch(path.name) is not None


def file_row(path):
    path = Path(path)
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'Only ordinary unlinked program files are eligible')
    return {'path': str(path), 'bytes': s.st_size, 'allocated_bytes': s.st_blocks * 512,
            'device': s.st_dev, 'inode': s.st_ino, 'mtime_ns': s.st_mtime_ns, 'sha256': sha(path)}


def image_rows():
    ids = list(dict.fromkeys(run(['docker', 'image', 'ls', '-aq', '--no-trunc']).split()))
    if not ids:
        return []
    rows = json.loads(run(['docker', 'image', 'inspect', *ids]))
    return [{'id': x['Id'], 'tags': sorted(x.get('RepoTags') or []), 'created': x['Created']} for x in rows]


def image_row(image_id):
    require(IMAGE_RE.fullmatch(image_id or ''), 'Exact image ID is required')
    try:
        raw = json.loads(run(['docker', 'image', 'inspect', image_id]))
    except subprocess.CalledProcessError as error:
        missing = re.fullmatch(r'(?i:Error:|Error response from daemon:) (?i:No such image:) ' + re.escape(image_id), str(error.stderr or '').strip())
        require(error.returncode == 1 and missing is not None, 'Unexpected exact image inspect failure')
        return None
    require(isinstance(raw, list) and len(raw) == 1 and raw[0].get('Id') == image_id, 'Inspected exact image identity mismatch')
    value = raw[0]
    tags = value.get('RepoTags') or []
    require(isinstance(tags, list) and all(isinstance(tag, str) for tag in tags)
            and isinstance(value.get('Created'), str), 'Malformed exact image metadata')
    return {'id': value['Id'], 'tags': sorted(tags), 'created': value['Created']}


def runtime_template(raw):
    config = dict(raw['Config'])
    host = dict(raw['HostConfig'])
    mounts = raw['Mounts']
    destinations = [m.get('Destination') for m in mounts]
    require(all(isinstance(x, str) and x for x in destinations) and len(destinations) == len(set(destinations)), 'Actual Docker mount destinations must be unique')
    mounts = sorted(mounts, key=lambda m: (m.get('Destination', ''), m.get('Source', '')))
    if raw['Name'] in PERIODIC_NAMES:
        if config.get('Hostname') == raw['Id'][:12]:
            config.pop('Hostname')
        env = config.get('Env')
        if env is not None and len({x.split('=', 1)[0] for x in env}) == len(env):
            config['Env'] = sorted(env)
        labels = dict(config.get('Labels') or {})
        slug = labels.get('com.docker.compose.slug')
        if slug is not None:
            require(re.fullmatch('[a-f0-9]{64}', str(slug)), 'Unexpected generated periodic Compose slug shape')
            labels.pop('com.docker.compose.slug')
            config['Labels'] = labels
        if host.get('Mounts') is not None:
            targets = [m.get('Target', m.get('Destination')) for m in host['Mounts']]
            require(all(isinstance(x, str) and x for x in targets) and len(targets) == len(set(targets)), 'Periodic HostConfig mount targets must be unique')
            host['Mounts'] = sorted(host['Mounts'], key=lambda m: (m.get('Target', m.get('Destination')), m.get('Type', ''), m.get('Source', '')))
    return {'image': raw['Image'], 'config': config, 'hostConfig': host, 'mounts': mounts}


def runtime_fingerprint(raw):
    stable = runtime_template(raw)
    def value_hash(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    config = {key: value_hash(value) for key, value in stable['config'].items()}
    if 'Labels' in stable['config']:
        config['Labels'] = value_hash({key: value_hash(value) for key, value in (stable['config']['Labels'] or {}).items()})
    strong = {'image': stable['image'], 'configFieldFingerprints': config,
              'hostFieldFingerprints': {key: value_hash(value) for key, value in stable['hostConfig'].items()},
              'mountsFingerprint': value_hash(stable['mounts'])}
    return value_hash(strong)


def container_rows():
    rows = None
    for attempt in range(3):
        snapshot = [line.split() for line in run(['docker', 'ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}']).splitlines()]
        require(snapshot and all(len(x) == 2 and re.fullmatch('[a-f0-9]{64}', x[0]) for x in snapshot), 'Malformed Docker container inventory')
        identities = {x[0]: '/' + x[1].lstrip('/') for x in snapshot}
        require(len(identities) == len(snapshot) and len(set(identities.values())) == len(snapshot), 'Duplicate Docker container identity')
        ids = list(identities)
        try:
            rows = json.loads(run(['docker', 'inspect', *ids]))
            break
        except subprocess.CalledProcessError as error:
            lines = str(error.stderr or '').strip().splitlines()
            missing = [re.fullmatch(r'(?i:Error:|Error response from daemon:) (?i:No such (?:object|container):) ([a-f0-9]{64})', line) for line in lines]
            require(lines and all(missing) and all(m.group(1) in identities and identities[m.group(1)] in PERIODIC_NAMES for m in missing), 'Unexpected Docker inspect failure or unknown container disappearance')
            require(attempt < 2, 'Periodic container inventory changed during three complete retries')
    require(rows is not None, 'Docker inventory unavailable')
    require(isinstance(rows, list) and len(rows) == len(identities) and {x.get('Id') for x in rows} == set(identities)
            and all(x.get('Name') == identities.get(x.get('Id')) for x in rows), 'Inspected Docker container identity mismatch')
    return [{'id': x['Id'], 'name': x['Name'], 'image': x['Image'],
             'started': x['State']['StartedAt'], 'status': x['State']['Status'],
             'health': x['State'].get('Health', {}).get('Status'),
             'runtimeFingerprint': runtime_fingerprint(x)} for x in rows]


def periodic_fingerprints(policy):
    values = policy.get('periodicContainerFingerprints', {})
    require(isinstance(values, dict) and set(values) <= PERIODIC_NAMES, 'Only the two reviewed periodic names may rotate')
    require(not values or set(values) == PERIODIC_NAMES, 'Both periodic templates must be pinned together')
    for value in values.values():
        require(IMAGE_RE.fullmatch(str(value.get('image', ''))) and re.fullmatch('[a-f0-9]{64}', str(value.get('runtimeFingerprint', ''))), 'Malformed pinned periodic template')
    return values


def validate_periodic(policy, containers):
    names = [c['name'] for c in containers]
    require(len(names) == len(set(names)), 'Duplicate Docker container name')
    pinned = periodic_fingerprints(policy)
    for row in containers:
        if row['name'] in PERIODIC_NAMES:
            expected = pinned.get(row['name'])
            require(expected and row['image'] == expected['image'] and row.get('runtimeFingerprint') == expected['runtimeFingerprint'], 'Reviewed periodic image or strong configuration changed')


def equivalent_containers(policy, current, expected):
    validate_periodic(policy, current)
    validate_periodic(policy, expected)
    pinned = periodic_fingerprints(policy)
    stable_current = {c['name']: c for c in current if c['name'] not in pinned}
    stable_expected = {c['name']: c for c in expected if c['name'] not in pinned}
    return stable_current == stable_expected


def protected_references(policy, current, expected):
    require(equivalent_containers(policy, current, expected), 'Persistent or unknown container identity or lifecycle changed')
    return {c['image'] for c in current} | {v['image'] for v in periodic_fingerprints(policy).values()}


def runtime_guard(policy):
    require(policy.get('environment') in {'development', 'production'} and policy.get('schema') == 1, 'Verified retention policy required')
    versions = policy['workingVersions']
    require(len(versions) == 2 and len({v['image'] for v in versions}) == 2, 'Exactly two working images required')
    for v in versions:
        require(IMAGE_RE.fullmatch(v['image']) and RELEASE_RE.fullmatch(v['release']), 'Working version malformed')
        require(run(['docker', 'image', 'inspect', v['image'], '--format', '{{.Id}}']) == v['image'], 'Working recovery image is missing')
        for p in v['protectedDirectories']:
            require(managed_directory(p), 'Protected directory escaped managed roots')
        require(v.get('requiredFiles'), 'Working source and program recovery proofs required')
        for row in v['requiredFiles']:
            p = Path(row['path'])
            require(any(p.is_relative_to(x) for x in v['protectedDirectories']), 'Recovery proof escaped protected roots')
            require(p.is_file() and not p.is_symlink() and sha(p) == row['sha256'], 'Working source or program recovery proof changed')
    containers = container_rows()
    validate_periodic(policy, containers)
    game = [c for c in containers if c['name'] == '/royal-game-1']
    require(len(game) == 1 and game[0]['image'] == versions[0]['image'], 'Running image differs from adopted working version')
    require(game[0]['status'] == 'running' and game[0]['health'] == 'healthy', 'Game must be healthy')
    latest = run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])
    require(latest == game[0]['image'], 'Prepared latest differs from running image: skip during deployment')
    return containers

