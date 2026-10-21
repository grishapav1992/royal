"""Install or roll back independent game clients without changing the application or database."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import uuid

GAME = 'studio-afterglow'
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}')
DIGEST = re.compile(r'[a-f0-9]{64}')
GAME_ID = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
RESOURCE = re.compile(r'(?:entry-[a-f0-9]{16}\.js|style-[a-f0-9]{16}\.css|media/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|avif|gif|svg|mp4|mp3|ogg|wav|m4a|json|woff2?|ttf|otf))')

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def directory(path):
    path = Path(os.path.abspath(path))
    require(not any(part.is_symlink() for part in [path, *path.parents]), 'Directory symlinks rejected')
    require(path.is_dir(), 'Required module directory is missing')
    return path

def plain(root, name):
    relative = PurePosixPath(name)
    require(str(relative) == name and not relative.is_absolute() and not any(part in ['..', '.'] for part in relative.parts), 'Unsafe module resource path')
    path = root
    for part in relative.parts:
        path = path / part
        require(not path.is_symlink(), 'Module symlinks rejected')
    require(path.is_file(), 'Module resource is missing')
    return path

def manifest(root):
    root = directory(root)
    metadata = plain(root, 'manifest.json')
    require(metadata.stat().st_size <= 65536, 'Module manifest too large')
    m = json.loads(metadata.read_text())
    require(isinstance(m, dict), 'Invalid module manifest')
    return m

def compatible_contract(contract):
    return (isinstance(contract, dict) and set(contract) == {'apiVersion', 'rulesVersion', 'progressVersion'}
            and type(contract['apiVersion']) is int and contract['apiVersion'] == 1
            and all(type(contract[key]) is int and contract[key] > 0 for key in ['rulesVersion', 'progressVersion']))

def verify(root, contract, game=GAME):
    root = directory(root)
    m = manifest(root)
    require(isinstance(game, str) and GAME_ID.fullmatch(game), 'Invalid requested game')
    require(compatible_contract(contract), 'Host has no compatible game interface')
    require(type(m.get('format')) is int and m['format'] == 1 and m.get('gameId') == game and isinstance(m.get('version'), str) and VERSION.fullmatch(m['version']), 'Invalid game module identity')
    require(all(type(m.get(k)) is int and m[k] == contract[k] for k in ['apiVersion', 'rulesVersion', 'progressVersion']), 'Module is incompatible with the installed host')
    require(isinstance(m.get('sourceSha256'), str) and DIGEST.fullmatch(m['sourceSha256']), 'Missing module source fingerprint')
    files = m.get('files')
    require(isinstance(files, dict) and 2 <= len(files) <= 256, 'Invalid module file inventory')
    require(isinstance(m.get('entry'), str) and re.fullmatch(r'entry-[a-f0-9]{16}\.js', m['entry']) and m['entry'] in files, 'Invalid module entry')
    require(isinstance(m.get('styles'), list) and len(m['styles']) == 1 and all(isinstance(x, str) and re.fullmatch(r'style-[a-f0-9]{16}\.css', x) and x in files for x in m['styles']), 'Invalid module styles')
    total = 0
    for name, expected in files.items():
        require(isinstance(name, str) and RESOURCE.fullmatch(name) and isinstance(expected, str) and DIGEST.fullmatch(expected), 'Forbidden module resource')
        path = plain(root, name)
        total += path.stat().st_size
        require(total <= 64 * 1024 * 1024, 'Module package exceeds size limit')
        require(sha(path) == expected, 'Module resource hash mismatch: ' + name)
        if name.endswith(('.js', '.css')):
            require(expected[:16] in name, 'Content-addressed filename does not match its bytes')
    actual = set()
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'Module symlinks rejected')
        if path.is_file():
            actual.add(str(path.relative_to(root)))
    require(actual == {'manifest.json', *files}, 'Unexpected files in game module')
    return m, total

def active_sha(path):
    require(not path.is_symlink(), 'Active pointer symlink rejected')
    return sha(path) if path.is_file() else 'none'

def atomic_json(path, value):
    temporary = path.with_name('.pending-' + uuid.uuid4().hex + '.json')
    with temporary.open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o644)
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def run(args):
    root = directory(args.root)
    state = directory(args.state)
    contract_file = plain(state, 'host.json')
    contract_hash = sha(contract_file)
    contracts = json.loads(contract_file.read_text())
    if args.operation == 'rollback':
        game_id = args.game or GAME
        source = None
    else:
        require(args.package is not None, 'Module package directory required')
        source = directory(args.package)
        package_identity = manifest(source).get('gameId')
        game_id = args.game or package_identity
        require(game_id == package_identity, 'Package belongs to a different game')
    require(isinstance(game_id, str) and GAME_ID.fullmatch(game_id), 'Invalid requested game')
    require(isinstance(contracts, dict) and isinstance(contracts.get('games'), dict), 'Invalid installed host contracts')
    contract = contracts['games'].get(game_id)
    require(compatible_contract(contract), 'Host has no compatible game interface: ' + game_id)
    game = root / game_id
    if game.exists():
        directory(game)
    versions = game / 'versions'
    if versions.exists():
        directory(versions)
    pointer = game / 'active.json'
    before = active_sha(pointer)
    if args.operation in ['install', 'rollback']:
        require(args.expected_sha is not None and before == args.expected_sha, 'Active module changed since review')
    if args.operation == 'rollback':
        require(isinstance(args.version, str) and VERSION.fullmatch(args.version), 'Invalid rollback version')
        source = versions / args.version
    metadata, total = verify(source, contract, game_id)
    manifest_hash = sha(source / 'manifest.json')
    result = {'verified': True, 'gameId': game_id, 'version': metadata['version'], 'bytes': total,
              'files': len(metadata['files']), 'beforeSha256': before,
              'hostProgramTouched': False, 'databaseTouched': False, 'restartRequired': False}
    if args.operation == 'check':
        return result
    require(sha(contract_file) == contract_hash, 'Installed host contract changed')
    disk = shutil.disk_usage(root)
    require(disk.free >= max(200 * 1024 * 1024, total * 3), 'Insufficient game module capacity')
    if not game.exists():
        game.mkdir(mode=0o755)
    if not versions.exists():
        versions.mkdir(mode=0o755)
    destination = versions / metadata['version']
    if destination.exists():
        verify(destination, contract, game_id)
        require(sha(destination / 'manifest.json') == manifest_hash, 'Immutable module version collision')
    else:
        require(args.operation == 'install', 'Rollback module missing')
        temporary = versions / ('.pending-' + uuid.uuid4().hex)
        temporary.mkdir(mode=0o755)
        for name in ['manifest.json', *metadata['files']]:
            target = temporary / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with plain(source, name).open('rb') as input_file, target.open('xb') as output:
                shutil.copyfileobj(input_file, output)
                os.fchmod(output.fileno(), 0o644)
                output.flush()
                os.fsync(output.fileno())
        verify(temporary, contract, game_id)
        require(sha(temporary / 'manifest.json') == manifest_hash, 'Package manifest changed during installation')
        for folder in sorted([temporary, *[p for p in temporary.rglob('*') if p.is_dir()]], key=lambda p: len(p.parts), reverse=True):
            descriptor = os.open(folder, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        temporary.rename(destination)
        descriptor = os.open(versions, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    require(active_sha(pointer) == before and sha(contract_file) == contract_hash, 'Module or host changed during installation')
    value = {'format': 1, 'gameId': game_id, 'manifest': f'/game-modules/{game_id}/versions/{metadata["version"]}/manifest.json', 'sha256': sha(destination / 'manifest.json')}
    history = state / 'history'
    history.mkdir(mode=0o700, exist_ok=True)
    directory(history)
    record = history / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex + '.json')
    prior = json.loads(pointer.read_text()) if pointer.is_file() else None
    atomic_json(record, {'operation': args.operation, 'before': prior, 'after': value, 'beforeSha256': before})
    atomic_json(pointer, value)
    result.update({'published': True, 'operation': args.operation, 'activeSha256': sha(pointer), 'history': str(record)})
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['check', 'install', 'rollback'])
    parser.add_argument('--package')
    parser.add_argument('--version')
    parser.add_argument('--game', help='Game ID; inferred from the package, defaults to GIRLHUB for rollback')
    parser.add_argument('--expected-sha')
    parser.add_argument('--root', default='/opt/royal-game-modules')
    parser.add_argument('--state', default='/opt/royal-game-modules-state')
    parser.add_argument('--app-lock', default='/opt/royal/.client-presentation-deploy.lock')
    args = parser.parse_args()
    state = directory(args.state)
    lock = Path(os.path.abspath(args.app_lock))
    require(not lock.is_symlink() and not any(p.is_symlink() for p in lock.parents), 'Deployment lock symlink rejected')
    module_lock_path = state / 'module.lock'
    require(not module_lock_path.is_symlink(), 'Module lock symlink rejected')
    with lock.open('a') as shared_lock, module_lock_path.open('a') as module_lock:
        fcntl.flock(shared_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(module_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run(args)))

if __name__ == '__main__':
    main()
