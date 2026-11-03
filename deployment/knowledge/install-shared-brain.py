#!/usr/bin/env python3
"""Install a small GitHub-bound graph service generation without changing the game."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import uuid

ROOT = Path('/opt/royal-project-brain')
UNIT_ROOT = Path('/etc/systemd/system')
CONFIG_ROOT = Path('/etc/royal-project-brain')
UNIT = 'royal-project-brain-update.service'
HASH = re.compile(r'[a-f0-9]{64}')
COMMIT = re.compile(r'[a-f0-9]{40}')
CORE = {
    'scripts/shared-brain-client.mjs', 'scripts/shared-brain-reader.mjs', 'scripts/shared-brain-store.mjs',
    'scripts/shared-brain-update.mjs', 'scripts/production-brain-build.mjs', 'scripts/production-brain-extract.py',
    'scripts/project-brain.mjs', 'ai-factory/lib/knowledge-graph.mjs',
    'AGENTS.md', 'ai-factory/project-knowledge/graph-seed.json', 'ai-factory/project-knowledge/manifest.json',
    'deployment/knowledge/' + UNIT,
    'deployment/knowledge/install-shared-brain.py', 'deployment/knowledge/install-runtime.py',
}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def trusted_directory(path, owner_uid=0, create=False):
    path = Path(path).absolute()
    for directory in reversed((path, *path.parents)):
        if create:
            directory.mkdir(mode=0o700, exist_ok=True)
        info = directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and not directory.is_symlink()
                and info.st_uid in {0, owner_uid} and not info.st_mode & 0o022, 'Untrusted graph installation directory')
    require(path.resolve() == path, 'Noncanonical graph installation directory')
    return path


def safe_file(path, owner_uid=0, cap=32 * 1024**2):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == owner_uid
                and not before.st_mode & 0o022 and before.st_size <= cap, 'Untrusted graph installation file')
        raw = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
        require(len(raw) == before.st_size and (before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_ino, after.st_size, after.st_mtime_ns), 'Graph installation file changed while reading')
        return raw


def allowed(name):
    if not isinstance(name, str) or not name or re.search(r'[\\\x00\r\n]', name):
        return False
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {'', '.', '..'} for part in name.split('/')):
        return False
    if any(part.startswith('.env') or part in {'.git', '.ssh', 'node_modules', 'data', 'secrets'} for part in path.parts):
        return False
    return name in CORE or name in {'AGENTS.md', 'README.md', 'package.json', 'deployment/SERVER.md',
        'scripts/game-math/rtp-policy.json', 'ai-factory/project-knowledge/manifest.json', 'ai-factory/project-knowledge/PROJECT.md'} \
        or name.startswith('docs/') and path.suffix == '.md' \
        or name.startswith('deployment/') and path.suffix == '.md' \
        or name.startswith('ai-factory/project-knowledge/references/') and path.suffix == '.md'


def validate_bundle(source, receipt_path, root=ROOT, owner_uid=0):
    source, root = Path(source).absolute(), Path(root).absolute()
    trusted_directory(source, owner_uid)
    require(Path(receipt_path).absolute() == source / 'install-receipt.json', 'Receipt must belong to this immutable graph generation')
    receipt = json.loads(safe_file(receipt_path, owner_uid, 2 * 1024**2))
    require(receipt.get('schemaVersion') == 1 and receipt.get('githubVerified') is True
            and COMMIT.fullmatch(str(receipt.get('sourceCommit', ''))), 'Graph installation needs a verified GitHub source commit')
    require(source.parent == root / 'releases' and source.name == receipt['sourceCommit'], 'Unexpected graph generation directory')
    rows = receipt.get('files')
    require(isinstance(rows, list) and 1 <= len(rows) <= 4096
            and all(isinstance(row, dict) and set(row) == {'path', 'sha256'} and allowed(row['path'])
                    and HASH.fullmatch(str(row['sha256'])) for row in rows), 'Invalid graph installation inventory')
    names = {row['path'] for row in rows}
    require(len(names) == len(rows) and CORE <= names, 'Incomplete graph installation inventory')
    actual, total = set(), 0
    for path in source.rglob('*'):
        info = path.lstat()
        require(not path.is_symlink() and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)), 'Unsafe graph generation contents')
        if path.is_dir():
            trusted_directory(path, owner_uid)
            require(any(name.startswith(str(path.relative_to(source)) + '/') for name in names), 'Unreceipted graph generation directory')
        else:
            actual.add(str(path.relative_to(source)))
    require(actual == names | {'install-receipt.json'}, 'Unreceipted graph generation contents')
    for row in rows:
        raw = safe_file(source / row['path'], owner_uid)
        total += len(raw)
        require(total <= 128 * 1024**2 and hashlib.sha256(raw).hexdigest() == row['sha256'], 'Graph generation differs from GitHub receipt')
    context = json.loads(safe_file(source / 'ai-factory/project-knowledge/manifest.json', owner_uid, 1024**2))
    summary, documents = context.get('summary'), context.get('documents')
    require(context.get('schema_version') == 1 and isinstance(summary, str) and PurePosixPath(summary).name == summary
            and summary.endswith('.md') and isinstance(documents, list) and len(documents) <= 256
            and all(isinstance(name, str) and allowed(name) and name.endswith('.md') for name in documents), 'Invalid graph knowledge context manifest')
    require({'ai-factory/project-knowledge/' + summary, *documents} <= names, 'Incomplete graph knowledge context')
    return receipt


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_bytes(path, raw, mode=0o600):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno()); os.fchmod(stream.fileno(), mode)
        os.replace(temporary, path); sync_directory(path.parent)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def pointer(path, root, owner_uid):
    if not path.exists() and not path.is_symlink():
        return None
    require(path.is_symlink(), 'Graph program pointer must be a symbolic link')
    target = (path.parent / os.readlink(path)).absolute()
    require(target.parent == root / 'releases' and COMMIT.fullmatch(target.name), 'Unsafe graph program pointer')
    validate_bundle(target, target / 'install-receipt.json', root, owner_uid)
    return target


def atomic_pointer(path, target):
    if target is None:
        path.unlink(missing_ok=True); sync_directory(path.parent); return
    temporary = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
    try:
        temporary.symlink_to(target, target_is_directory=True)
        temporary.replace(path); sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def install(source, receipt_path, root=ROOT, unit_root=UNIT_ROOT, config_root=CONFIG_ROOT, owner_uid=0, run=subprocess.run):
    root = trusted_directory(root, owner_uid)
    receipt = validate_bundle(source, receipt_path, root, owner_uid)
    source = Path(source).absolute()
    for name in ['node', 'uv']:
        runtime = root / 'runtime' / 'bin' / name
        trusted_directory(runtime.parent, owner_uid)
        safe_file(runtime, owner_uid, 256 * 1024**2)
        require(os.access(runtime, os.X_OK), 'Graph runtime executable is unavailable: ' + name)
    unit_root = trusted_directory(unit_root, owner_uid)
    config_root = trusted_directory(config_root, owner_uid, create=True)
    unit_path, config_path = unit_root / UNIT, config_root / 'enabled.json'
    for path in [unit_path, config_path]:
        require(not path.is_symlink(), 'Unsafe graph installation target')
    current, previous = root / 'current', root / 'previous'
    lock = os.open(root / '.install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == owner_uid
                and not info.st_mode & 0o022, 'Unsafe graph installation lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old_unit = safe_file(unit_path, owner_uid, 64 * 1024) if unit_path.exists() else None
        old_config = safe_file(config_path, owner_uid, 4096) if config_path.exists() else None
        old_current, old_previous = pointer(current, root, owner_uid), pointer(previous, root, owner_uid)
        unit_source = source / 'deployment' / 'knowledge' / UNIT
        unit = safe_file(unit_source, owner_uid, 64 * 1024)
        require(('ExecStart=' + str(root / 'runtime/bin/node') + ' ' + str(root / 'current/scripts/shared-brain-update.mjs')).encode()
                in unit.splitlines(), 'Graph service must use the installed isolated runtime')
        run(['systemd-analyze', 'verify', str(unit_source)], check=True, capture_output=True, text=True, timeout=60)
        changed = False
        try:
            atomic_bytes(unit_path, unit, 0o644)
            atomic_pointer(previous, old_current if old_current != source else old_previous)
            atomic_pointer(current, source)
            changed = True
            run(['systemctl', 'daemon-reload'], check=True, capture_output=True, text=True, timeout=60)
            atomic_bytes(config_path, b'{"schemaVersion":1,"enabled":true}\n')
        except Exception:
            atomic_pointer(current, old_current); atomic_pointer(previous, old_previous)
            if old_unit is None: unit_path.unlink(missing_ok=True)
            else: atomic_bytes(unit_path, old_unit, 0o644)
            if old_config is None: config_path.unlink(missing_ok=True)
            else: atomic_bytes(config_path, old_config)
            if changed: run(['systemctl', 'daemon-reload'], check=True, capture_output=True, text=True, timeout=60)
            raise
        return {'installed': True, 'sourceCommit': receipt['sourceCommit'], 'current': str(source),
                'previous': str(old_current if old_current != source else old_previous) if (old_current if old_current != source else old_previous) else None,
                'graphUpdateQueued': False, 'gameRestarted': False}
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run the graph installer as the deployment operator')
    source = Path(__file__).resolve().parents[2]
    print(json.dumps(install(source, args.receipt)), flush=True)


if __name__ == '__main__': main()
