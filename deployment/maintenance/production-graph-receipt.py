#!/usr/bin/env python3
"""Describe the exact already-verified production state for the shared code graph."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import time

STATE = Path('/var/lib/royal-project-brain')
ENABLED = Path('/etc/royal-project-brain/enabled.json')
SHA = re.compile(r'[a-f0-9]{64}')
COMMIT = re.compile(r'[a-f0-9]{40}')
CORE = {'install-manifest.json', 'build-result.json', 'published.json', 'release-github.json', 'release-manifest.json', 'operator.json'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def safe_inventory_path(name):
    """Validate an opaque path in an already-verified sealed program inventory."""
    require(isinstance(name, str) and name and not re.search(r'[\\\x00\r\n]', name), 'Invalid graph source path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(part not in {'', '.', '..'} for part in name.split('/')), 'Unsafe graph source path')
    return name


def safe_source(name):
    safe_inventory_path(name)
    path = PurePosixPath(name)
    require(not any(re.match(r'^(?:\.env(?:\..*)?|\.git|\.ssh|secrets?|credentials?|data)$', part, re.I) for part in path.parts), 'Sensitive graph source path')
    require(path.suffix.lower() not in {'.db', '.sqlite', '.sqlite3', '.pem', '.key', '.dump'}, 'Private graph source path')
    return name


def read_json(path):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_size <= 64 * 1024**2, 'Unsafe graph evidence file')
    return json.loads(path.read_text())


def sha_file(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'Graph evidence must be a regular file')
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def enabled(path=None):
    path = Path(path or ENABLED)
    if not path.exists():
        return False
    info = path.lstat()
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'Untrusted shared graph enable configuration')
    value = read_json(path)
    require(value == {'schemaVersion': 1, 'enabled': True}, 'Invalid shared graph enable configuration')
    return True


def origin(row, final_hash):
    if not isinstance(row, dict):
        return None
    require(COMMIT.fullmatch(str(row.get('commit', ''))) and SHA.fullmatch(str(row.get('baseSha256', ''))), 'Malformed graph source origin')
    require(row.get('sha256') == final_hash, 'Graph source origin final hash differs')
    safe_source(row.get('path'))
    patches = row.get('patches', [])
    require(isinstance(patches, list) and len(patches) <= 512, 'Invalid graph source patches')
    require(all(isinstance(p, dict) and set(p) == {'from', 'to'} and isinstance(p['from'], str) and p['from']
                and isinstance(p['to'], str) for p in patches), 'Invalid graph source patch')
    return {'commit': row['commit'], 'path': row['path'], 'baseSha256': row['baseSha256'], 'patches': patches}


def projection_component(identity, kind, report, evidence, selected=None, **fields):
    inputs = report.get('inputs', {})
    origins = report.get('origins', {})
    require(isinstance(inputs, dict) and isinstance(origins, dict), 'Malformed component projection')
    sources = []
    for name, final_hash in sorted((selected if selected is not None else inputs).items()):
        if name.startswith('node_modules/'):
            continue
        safe_source(name)
        require(SHA.fullmatch(str(final_hash)), 'Invalid component input hash')
        require(inputs.get(name) == final_hash, 'Component source absent from verified projection')
        sources.append({'path': name, 'sha256': final_hash, 'origin': origin(origins.get(name), final_hash)})
    complete = bool(sources) and all(row['origin'] is not None for row in sources)
    return {'id': identity, 'kind': kind, **fields, 'coverage': 'complete' if complete else 'partial',
            'sourceSet': 'verified-projection-inputs', 'sources': sources, 'evidence': evidence}


def live_component(identity, kind, inventory, predicate, **fields):
    sources = [{'path': name, 'sha256': value, 'origin': None} for name, value in sorted(inventory.items()) if predicate(name)]
    return {'id': identity, 'kind': kind, **fields, 'coverage': 'partial',
            'sourceSet': 'verified-live-candidates', 'sources': sources, 'evidence': [],
            'limitation': 'Exact transitive compiled input origins were not preserved in an available bound projection receipt.'}


def identity_payload(receipt):
    return {key: value for key, value in receipt.items() if key not in {'collectedAt', 'runtimeFingerprint'}}


def collect_verified(plan, cleanup):
    """Call only after cleanup.apply succeeded, while the existing publication locks remain held."""
    release = plan['release']
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,127}', release), 'Invalid production release identity')
    root = cleanup.RELEASES / release
    install = read_json(root / 'install-manifest.json')
    built = read_json(root / 'build-result.json')
    published = read_json(root / 'published.json')
    require(install['sourceCommit'] == plan['sourceCommit'] and COMMIT.fullmatch(plan['sourceCommit']), 'Verified production commit changed')
    require(plan['currentImage'] == built['image'] == published.get('runningImage', published.get('image'))
            and published.get('published') is True, 'Verified running release changed')
    require(isinstance(built.get('program'), dict) and built['program'], 'Verified runtime inventory missing')
    command = plan['programHashCommand']
    require(isinstance(command, str) and command and len(command.encode()) <= 1024**2, 'Verified runtime reader missing')
    runtime = {safe_inventory_path(name): value for name, value in sorted(built['program'].items())}
    require(all(SHA.fullmatch(str(value)) for value in runtime.values()), 'Invalid runtime hash')
    proof_hashes = {row['path']: row['sha256'] for row in plan['proofs']}
    for name in ['install-manifest.json', 'build-result.json', 'published.json', 'release-github.json']:
        file = root / name
        require(proof_hashes.get(str(file)) == sha_file(file), 'Production evidence differs from verified maintenance plan')
    expected = {**install['before']['source'], **install['changed']}
    source_inventory = {}
    proof_paths = {root / name for name in CORE if str(root / name) in proof_hashes}
    proof_paths.update(Path(name) for name in plan.get('independentModuleProofs', []) if Path(name).name in CORE)
    for name, expected_hash in sorted(expected.items()):
        safe_source(name)
        require(SHA.fullmatch(str(expected_hash)), 'Invalid verified source hash')
        actual = sha_file(cleanup.LIVE / name)
        if actual != expected_hash:
            independent = cleanup.module_source_proof(name, actual)
            require(independent, 'Live source has no current module publication proof: ' + name)
            proof_paths.update(Path(path) for path in independent if Path(path).name in CORE)
        source_inventory[name] = actual
    github = read_json(root / 'release-github.json')
    require(github.get('sourceCommit') == plan['sourceCommit'] and COMMIT.fullmatch(str(github.get('remoteMain', ''))), 'Invalid production GitHub receipt')
    require(SHA.fullmatch(str(plan['moduleHostContract']))
            and sha_file(cleanup.MODULE_STATE / 'host.json') == plan['moduleHostContract'], 'Verified module host contract changed')
    evidence = []
    for path in sorted(proof_paths):
        value = sha_file(path)
        require(proof_hashes.get(str(path)) == value, 'Graph publication evidence was not verified by maintenance')
        evidence.append({'path': str(path), 'sha256': value})
    manifests = []
    for folder in sorted({path.parent for path in proof_paths}):
        file = folder / 'release-manifest.json'
        if file not in proof_paths:
            continue
        metadata = read_json(file)
        authority = read_json(folder / ('install-manifest.json' if folder == root else 'operator.json'))
        if not authority.get('releaseManifestSha256'):
            continue
        require(authority['releaseManifestSha256'] == sha_file(file), 'Unbound component release manifest')
        receipt_file = folder / 'release-github.json'
        receipt = read_json(receipt_file)
        require(authority.get('receiptSha256') == sha_file(receipt_file)
                and metadata.get('sourceCommit') == authority.get('sourceCommit') == receipt.get('sourceCommit'), 'Unbound component GitHub receipt')
        manifests.append((folder, metadata, {'path': str(file), 'sha256': sha_file(file)}))
    host_release = next((metadata for folder, metadata, _ in manifests if folder == root), None)
    host_evidence = next(([row] for folder, _, row in manifests if folder == root), [])
    components = []
    for kind, field, predicate in [
        ('host', 'hostProjection', lambda name: name.startswith('src/') or name in {'index.html', 'package.json', 'tsconfig.json'}),
        ('backend', 'backendProjection', lambda name: name.startswith(('server/', 'src/shared/')) or name in {'package.json', 'tsconfig.json'}),
    ]:
        report = (host_release or {}).get(field)
        components.append(projection_component(kind, kind, report, host_evidence) if report
                          else live_component(kind, kind, source_inventory, predicate))
    modules = []
    module_inventory = {}
    package_paths = [name for name in source_inventory if re.fullmatch(r'games/[^/]+/package\.json', name)]
    packages = {read_json(cleanup.LIVE / name).get('gameId'): str(PurePosixPath(name).parent) for name in package_paths}
    for pointer_name in sorted(name for name in plan['modules'] if re.fullmatch(r'[a-z0-9-]+/active\.json', name)):
        game = pointer_name.split('/')[0]
        pointer_file = cleanup.MODULES / pointer_name
        pointer = read_json(pointer_file)
        require(sha_file(pointer_file) == plan['modules'][pointer_name], 'Active module pointer changed')
        match = re.fullmatch(r'/game-modules/([a-z0-9-]+)/versions/([A-Za-z0-9._-]+)/manifest\.json', str(pointer.get('manifest', '')))
        require(match and match.group(1) == game, 'Malformed active module manifest path')
        version = match.group(2)
        require(version not in {'.', '..'}, 'Unsafe active module version')
        manifest_name = game + '/versions/' + version + '/manifest.json'
        manifest_file = cleanup.MODULES / manifest_name
        metadata = read_json(manifest_file)
        require(sha_file(manifest_file) == pointer.get('sha256') == plan['modules'].get(manifest_name)
                and metadata.get('gameId') == game and metadata.get('version') == version, 'Active module manifest changed')
        selected_inventory = {name: value for name, value in plan['modules'].items()
                              if name == pointer_name or name.startswith(game + '/versions/' + version + '/')}
        require(all(sha_file(cleanup.MODULES / safe_source(name)) == value for name, value in selected_inventory.items()),
                'Active module package changed')
        module_inventory.update(selected_inventory)
        module = {'gameId': game, 'version': version, 'pointerSha256': plan['modules'][pointer_name],
                  'manifestSha256': pointer['sha256'], 'availability': 'published-package-only'}
        modules.append(module)
        projected = None
        for _, publication, proof in manifests:
            report = publication.get('moduleProjection') or publication.get('build', {}).get('moduleProjection')
            row = (report or {}).get('modules', {}).get(game)
            if (row and row.get('version') == version and row.get('manifestSha256') == pointer['sha256']
                    and publication.get('files', {}).get('module-dist/' + manifest_name) == pointer['sha256']):
                projected = projection_component('module:' + game + ':' + version, 'module', report, [proof],
                                                 selected=row['sourceFiles'], gameId=game, version=version)
                break
        directory = packages.get(game)
        components.append(projected or live_component('module:' + game + ':' + version, 'module', source_inventory,
            lambda name, directory=directory: bool(directory) and name.startswith(directory + '/'), gameId=game, version=version))
    receipt = {'schemaVersion': 1, 'verified': True, 'release': release, 'sourceCommit': plan['sourceCommit'],
               'image': plan['currentImage'], 'runtimeInventory': runtime, 'sourceInventory': source_inventory,
               'runtimeReader': {'command': command, 'sha256': hashlib.sha256(command.encode()).hexdigest()},
               'moduleInventory': module_inventory, 'moduleHostContractSha256': plan['moduleHostContract'],
               'modules': modules, 'components': components, 'evidence': evidence,
               'coverage': {'components': len(components), 'partialComponents': sum(row['coverage'] != 'complete' for row in components),
                            'provenSources': sum(source['origin'] is not None for row in components for source in row['sources']),
                            'liveOnlySources': sum(source['origin'] is None for row in components for source in row['sources'])}}
    receipt['runtimeFingerprint'] = digest(identity_payload(receipt))
    receipt['collectedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return receipt


def verify_mutable_receipt(receipt, cleanup):
    for row in receipt['evidence']:
        require(sha_file(row['path']) == row['sha256'], 'Production publication evidence changed')
    for name, value in receipt['sourceInventory'].items():
        require(SHA.fullmatch(str(value)) and sha_file(cleanup.LIVE / safe_source(name)) == value,
                'Production source differs from graph target: ' + name)
    inventory = receipt['moduleInventory']
    for name, value in inventory.items():
        require(SHA.fullmatch(str(value)) and sha_file(cleanup.MODULES / safe_source(name)) == value,
                'Production module differs from graph target: ' + name)
    pointers = {str(path.relative_to(cleanup.MODULES)) for path in cleanup.MODULES.glob('*/active.json')}
    require(pointers == {name for name in inventory if re.fullmatch(r'[a-z0-9-]+/active\.json', name)},
            'Production active module set changed')
    for row in receipt['modules']:
        game, version = row['gameId'], row['version']
        require(re.fullmatch(r'[a-z0-9-]+', game) and re.fullmatch(r'[A-Za-z0-9._-]+', version)
                and version not in {'.', '..'}, 'Unsafe graph module identity')
        prefix = game + '/versions/' + version + '/'
        folder = cleanup.MODULES / prefix
        require(folder.is_dir() and not folder.is_symlink(), 'Production module package missing')
        files = list(folder.rglob('*'))
        require(not any(path.is_symlink() for path in files), 'Production module package contains a link')
        require({str(path.relative_to(cleanup.MODULES)) for path in files if path.is_file()}
                == {name for name in inventory if name.startswith(prefix)}, 'Production module package inventory changed')
    require(sha_file(cleanup.MODULE_STATE / 'host.json') == receipt['moduleHostContractSha256'],
            'Production module host contract changed')


def verify_live_receipt(receipt, cleanup):
    """Recheck mutable production state without cleanup or rollback image verification."""
    require(receipt.get('schemaVersion') == 1 and receipt.get('verified') is True
            and SHA.fullmatch(str(receipt.get('runtimeFingerprint', ''))), 'Invalid graph receipt identity')
    require(digest(identity_payload(receipt)) == receipt['runtimeFingerprint'], 'Graph receipt fingerprint differs')
    reader = receipt['runtimeReader']
    command = reader['command']
    require(isinstance(command, str) and command and len(command.encode()) <= 1024**2
            and hashlib.sha256(command.encode()).hexdigest() == reader['sha256'], 'Graph runtime reader differs')
    current = cleanup.healthy()
    require(current['Image'] == receipt['image']
            and current['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == receipt['sourceCommit'],
            'Production image differs from graph target')
    require(cleanup.select_current_release(current['Image'], receipt['sourceCommit']) == receipt['release'],
            'Production release differs from graph target')
    verify_mutable_receipt(receipt, cleanup)
    runtime = json.loads(cleanup.run(['docker', 'exec', 'royal-game-1', 'node', '-e', command]))
    require(runtime == receipt['runtimeInventory'], 'Running production program differs from graph target')
    verify_mutable_receipt(receipt, cleanup)
    final = cleanup.docker_object('container', 'royal-game-1')
    require(final['Image'] == current['Image'] and final.get('Id') == current.get('Id')
            and final.get('State', {}).get('StartedAt') == current.get('State', {}).get('StartedAt')
            and final.get('State', {}).get('Status') == 'running'
            and final.get('State', {}).get('Health', {}).get('Status') == 'healthy', 'Production changed during graph verification')
    return {'runtimeFingerprint': receipt['runtimeFingerprint']}


def atomic_json(path, value, immutable=False):
    path = Path(path)
    require(not path.is_symlink(), 'Graph receipt destination is linked')
    if path.exists():
        existing = read_json(path)
        if immutable:
            require(identity_payload(existing) == identity_payload(value)
                    and existing.get('runtimeFingerprint') == value['runtimeFingerprint'], 'Immutable graph receipt collision')
            return existing
    fd, temporary = tempfile.mkstemp(prefix='.receipt-', suffix='.json', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(canonical(value) + b'\n'); output.flush(); os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return value


def emit_verified(plan, cleanup, output_root=None):
    receipt = collect_verified(plan, cleanup)
    root = Path(output_root or STATE)
    require(not root.is_symlink() and root.resolve() == root.absolute(), 'Unsafe graph state directory')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    receipts = root / 'receipts'
    require(not receipts.is_symlink(), 'Unsafe graph receipts directory')
    receipts.mkdir(mode=0o700, exist_ok=True)
    path = receipts / (receipt['runtimeFingerprint'] + '.json')
    value = atomic_json(path, receipt, immutable=True)
    atomic_json(receipts / 'latest.json', value)
    return {'status': 'pending', 'runtimeFingerprint': receipt['runtimeFingerprint'], 'receipt': str(path)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', required=True, type=Path, help='Recheck an existing trusted production receipt')
    args = parser.parse_args()
    try:
        info = args.check.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'Untrusted graph receipt permissions')
        spec = importlib.util.spec_from_file_location('graph_check_cleanup', Path(__file__).with_name('cleanup-release-history.py'))
        cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cleanup)
        print(json.dumps(verify_live_receipt(read_json(args.check), cleanup)), flush=True)
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__': main()
