#!/usr/bin/env python3
"""Keep the healthy Royal release and its immediate rollback, without touching live data."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import time

LIVE = Path('/opt/royal')
RELEASES = Path('/opt/royal-releases')
BACKUPS = Path('/opt/royal-backups')
ROOTS = (RELEASES, BACKUPS)
RETENTION = Path('/opt/royal-dev-app-retention')
MODULES = Path('/opt/royal-game-modules')
MODULE_STATE = Path('/opt/royal-game-modules-state')
PERIODIC = {'/royal-nile-account-views-once', '/royal-nile-reconcile-once'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def run(args, timeout=180):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.next')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        os.fchmod(stream.fileno(), 0o600)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def docker_object(kind, identity):
    if kind == 'image':
        value = native_retention().image_metadata(identity)
        require(value is not None, 'Exact image is missing: ' + identity)
        return value
    return json.loads(run(['docker', kind, 'inspect', identity]))[0]


def allocated(path):
    return int(run(['du', '-sk', str(path)]).split()[0]) * 1024


def tree_identity(path):
    path = Path(path)
    rows = []
    def visit(item):
        s = item.lstat()
        rows.append([str(item.relative_to(path)), s.st_dev, s.st_ino, s.st_mode,
                     s.st_size, s.st_mtime_ns, s.st_ctime_ns])
        if stat.S_ISDIR(s.st_mode):
            require(not os.path.ismount(item), 'Mounted directory in deletion scope: ' + str(item))
            for child in sorted(item.iterdir()):
                visit(child)
    visit(path)
    return hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def deletion_candidates(keep, roots=ROOTS, protected=()):
    keep = {Path(path) for path in keep}
    protected = {Path(path) for path in protected}
    result = []
    def visit(path):
        if path in keep or path in protected or path.name.endswith('.lock'): return
        if any(child.is_relative_to(path) for child in protected):
            require(path.is_dir() and not path.is_symlink(), 'Protected backup parent changed')
            for child in sorted(path.iterdir()): visit(child)
            return
        require(time.time() - path.lstat().st_mtime > 600, 'Recent history entry may be in use: ' + str(path))
        result.append({'path': str(path), 'identity': tree_identity(path), 'allocatedBytes': allocated(path)})
    for root in roots:
        require(root.is_dir() and not root.is_symlink(), 'Unsafe history root')
        for path in sorted(root.iterdir()):
            require(path.parent == root, 'Deletion escaped history root')
            visit(path)
    return result


def remove_entry(row, keep, roots=ROOTS):
    path = Path(row['path'])
    require(any(path.is_relative_to(root) and path != root for root in roots)
            and not any(path == Path(p) or path.is_relative_to(p) for p in keep), 'Deletion escaped approved scope')
    require(tree_identity(path) == row['identity'], 'History entry changed after review: ' + str(path))
    if path.is_symlink() or not path.is_dir():
        path.unlink()
    else:
        shutil.rmtree(path)


def validate_selection(rows, keep, roots=ROOTS):
    require(len({row['path'] for row in rows}) == len(rows), 'Duplicate history entry')
    for row in rows:
        path = Path(row['path'])
        require(any(path.is_relative_to(root) and path != root for root in roots)
                and not any(path == Path(p) or path.is_relative_to(p) for p in keep), 'Deletion escaped approved scope')
        require(tree_identity(path) == row['identity'], 'History entry changed since review: ' + str(path))


def configuration():
    return {name: sha(LIVE / name) for name in
            ['.env', 'compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']}


def modules():
    return {str(path.relative_to(MODULES)): sha(path) for path in sorted(MODULES.rglob('*'))
            if path.is_file() and not path.is_symlink()}


def service_identity(container):
    return {'id': container['Id'], 'image': container['Image'], 'started': container['State']['StartedAt'],
            'mounts': sorted(container['Mounts'], key=lambda mount: mount['Destination']),
            **({'profileSha256': native_retention().runtime_fingerprint(container)} if 'Config' in container else {})}


def persistent_services():
    ids = run(['docker', 'ps', '-q']).split()
    data = json.loads(run(['docker', 'inspect', *ids]))
    return {c['Name']: service_identity(c) for c in data if c['Name'] not in PERIODIC
            and (c['HostConfig'].get('RestartPolicy', {}).get('Name', 'no') not in ['', 'no']
                 or ((c['Config'].get('Labels') or {}).get('com.docker.compose.project')
                     and (c['Config'].get('Labels') or {}).get('com.docker.compose.oneoff', '').lower() != 'true'))}


def validate_rollback_identity(current, image, before):
    require(image['Id'] != current['Image'] and image['Id'] == before['preparedImage']
            and before['preparedProgram'] == before['program'], 'Rollback image is missing or ambiguous')


def rollback_source_inventory(archive_path, before, changed):
    with tarfile.open(archive_path) as archive:
        members = archive.getmembers()
        require(all(m.isfile() and not Path(m.name).is_absolute() and '..' not in Path(m.name).parts for m in members), 'Unexpected special source archive member')
        recovered = {m.name: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in members}
    scoped = {name: digest for name, digest in before.items() if name in changed}
    require(len(recovered) == len(members) and recovered in [before, scoped], 'Rollback archive is incomplete')
    return recovered


def healthy():
    container = docker_object('container', 'royal-game-1')
    require(container['State']['Status'] == 'running'
            and container['State'].get('Health', {}).get('Status') == 'healthy', 'Game is not healthy')
    result = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e',
        "fetch('http://127.0.0.1:2567/healthz').then(async r=>{if(!r.ok)process.exit(1);const v=await r.json();if(v.ok!==true)process.exit(1);console.log(JSON.stringify({ok:true}));}).catch(()=>process.exit(1))"]))
    require(result == {'ok': True}, 'Health endpoint failed')
    return container


def native_retention():
    spec = importlib.util.spec_from_file_location('royal_retention', Path(__file__).with_name('retention-runtime.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def module_source_proof(name, digest):
    if not name.startswith('games/'): return None
    for path in RELEASES.glob('*/operator.json'):
        try:
            operator = read(path); published = read(path.parent/'published.json'); module = published.get('module', {})
            receipt = read(path.parent/'release-github.json')
            if not (published.get('published') is True and module.get('verified') is True
                    and operator.get('source', {}).get(name) == digest
                    and operator.get('sourceCommit') == published.get('sourceCommit') == receipt.get('sourceCommit')
                    and re.fullmatch('[a-f0-9]{40}', str(receipt.get('remoteMain','')))): continue
            game = module['gameId']; require(re.fullmatch('[a-z0-9-]+',game), 'Unsafe module identity')
            active = MODULES/game/'active.json'; pointer = read(active)
            package = read(LIVE/'games'/name.split('/')[1]/'package.json')
            if (sha(active) == operator.get('pointerSha256') and pointer['manifest'].split('/')[4] == module['version']
                    and package.get('gameId') == game):
                return [path, path.parent/'published.json', path.parent/'release-github.json']
        except (OSError, ValueError, KeyError, IndexError): continue
    return None


def recovery(release):
    root, backup = RELEASES / release, BACKUPS / release
    require(root.is_dir() and backup.is_dir() and not root.is_symlink() and not backup.is_symlink(), 'Recovery paths missing')
    manifest, built, published = [read(root / name) for name in
                                ['install-manifest.json', 'build-result.json', 'published.json']]
    before = manifest['before']
    current = healthy()
    require(manifest['release'] == release and published.get('published') is True, 'Release is not published')
    require(current['Image'] == built['image'] == published['runningImage'], 'A different release is running')
    require('royal-game:latest' in docker_object('image', current['Image'])['RepoTags'], 'Prepared image differs')
    require(docker_object('image', current['Image'])['Config']['Labels']['org.opencontainers.image.revision']
            == manifest['sourceCommit'], 'Running source revision differs')
    require(sha(root / 'deploy.py') == manifest['helperSha256']
            and sha(root / 'snapshot.py') == manifest['snapshotSha256'], 'Recovery helpers changed')
    require(sha(backup / 'source.tgz') == built['sourceBackupSha256'], 'Rollback source archive checksum differs')
    recovered = rollback_source_inventory(backup / 'source.tgz', before['source'], manifest['changed'])
    require(sha(backup / 'index.html') == before['program']['dist/index.html'], 'Rollback client index differs')
    expected = {**before['source'], **manifest['changed']}
    independent = set()
    for name, digest in expected.items():
        file = LIVE/name; require(file.is_file() and not file.is_symlink(), 'Live source missing: '+name)
        actual = sha(file)
        if actual != digest:
            proof = module_source_proof(name,actual)
            require(proof is not None, 'Live source differs without a verified current module publication: '+name)
            independent.update(proof)
    image = docker_object('image', before['preparedImage'])
    validate_rollback_identity(current, image, before)
    # Validate every rollback program byte in a transient container without network or mounts.
    node = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');walk('/app/module-dist');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    inventory = root / 'runtime-inventory.cjs'
    if inventory.exists():
        require(sha(inventory) == manifest.get('helpers', {}).get('runtime-inventory.cjs'), 'Runtime inventory helper differs')
        node = inventory.read_text()
    program = native_retention().verify_program(image['Id'], node)
    require(program == before['preparedProgram'] == before['program'], 'Rollback program bytes differ')
    current_program = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', node]))
    require(current_program == built['program'], 'Running program differs from its verified release')
    for name, digest in manifest.get('helpers', {}).items():
        require(sha(root / name) == digest, 'Recovery helper changed: ' + name)
    proof_paths = [root / name for name in ['install-manifest.json', 'build-result.json', 'published.json', 'deploy.py', 'snapshot.py']]
    proof_paths += [backup / 'source.tgz', backup / 'index.html']
    proof_paths += list(independent)
    proof_paths += [p for p in root.rglob('*') if p.is_file() and not p.is_symlink() and p.suffix != '.log' and '__pycache__' not in p.parts]
    proofs = [{'path': str(path), 'sha256': sha(path)} for path in sorted(set(proof_paths))]
    old_policy = read(RETENTION / 'policy.json')
    containers = native_retention().container_rows()
    periodic = {row['name']: {'image': row['image'], 'runtimeFingerprint': row['runtimeFingerprint']} for row in containers if row['name'] in PERIODIC}
    policy = {**old_policy, 'environment': 'production', 'schema': 1,
              'authorization': 'User requested automatic cleanup retaining the current application and one verified rollback on 2026-10-31.',
              'periodicContainerFingerprints': periodic,
              'adoptedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'managedDirectories': [str(root), str(backup)],
              'workingVersions': [
                  {'image': current['Image'], 'release': release, 'protectedDirectories': [str(root), str(backup)], 'requiredFiles': proofs},
                  {'image': image['Id'], 'release': 'rollback-before-' + release,
                   'protectedDirectories': [str(root), str(backup)], 'requiredFiles': proofs}]}
    # Current periodic jobs may rotate while cleanup runs. Every image deletion
    # still checks references from all containers immediately before removal.
    return {'release': release, 'sourceCommit': manifest['sourceCommit'], 'currentImage': current['Image'],
            'rollbackImage': image['Id'], 'keep': [str(root), str(backup)], 'proofs': proofs,
            'sourceFiles': len(recovered), 'rollbackProgramFiles': len(program),
            'independentModuleProofs': sorted(str(p) for p in independent),
            'programHashCommand': node,
            'configuration': configuration(), 'services': persistent_services(), 'modules': modules(),
            'moduleHostContract': sha(MODULE_STATE / 'host.json'), 'oldPolicySha256': sha(RETENTION / 'policy.json'),
            'policy': policy}


def image_candidates(protected):
    # Exact IDs from release evidence avoid the slow global image index and never
    # discover an unrelated image merely because it is old or untagged.
    ids = set()
    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {'image', 'runningImage', 'preparedImage', 'gameImage'} and isinstance(child, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', child): ids.add(child)
                elif isinstance(child, (dict, list)): collect(child)
        elif isinstance(value, list):
            for child in value: collect(child)
    for path in RELEASES.glob('*/*.json'):
        if path.name in {'install-manifest.json', 'build-result.json', 'published.json', 'before.json'}:
            try: collect(read(path))
            except (OSError, ValueError): continue
    protected |= referenced_images()
    result = []
    candidates = sorted(ids - protected)
    rows = []
    for identity in candidates:
        value = native_retention().image_row(identity)
        if value is not None: rows.append({'Id': value['id'], 'RepoTags': value['tags'], 'Created': value['created']})
    for row in rows:
        identity = row['Id']
        tags = row.get('RepoTags') or []
        if tags and all(tag.startswith('royal-game:') for tag in tags):
            result.append({'id': identity, 'tags': sorted(tags), 'created': row['Created']})
    return sorted(result, key=lambda row: row['created'], reverse=True)


def referenced_images():
    # The installed helper retries known periodic containers that exit during inspection.
    return {row['image'] for row in native_retention().container_rows()}


def verify(plan):
    healthy()
    require(persistent_services() == plan['services'], 'A persistent container changed')
    require(configuration() == plan['configuration'], 'Production configuration changed')
    require(modules() == plan['modules'] and sha(MODULE_STATE / 'host.json') == plan['moduleHostContract'], 'External modules changed')
    require(all(sha(row['path']) == row['sha256'] for row in plan['proofs']), 'Retained recovery file changed')
    require(docker_object('image', plan['rollbackImage'])['Id'] == plan['rollbackImage'], 'Rollback image disappeared')
    program = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', plan['programHashCommand']]))
    require(program == read(RELEASES / plan['release'] / 'build-result.json')['program'], 'Running program changed')


def apply(plan, state):
    verify(plan)
    require(sha(RETENTION / 'policy.json') == plan['oldPolicySha256'], 'Retention policy changed since review')
    validate_selection(plan['entries'], plan['keep'])
    if not plan.get('skipImageCleanup'):
        current_images = {row['id']: row for row in image_candidates({plan['currentImage'], plan['rollbackImage']})}
        require(all(current_images.get(row['id']) == row for row in plan['images']), 'Reviewed image changed since review')
    write(state / 'policy-before.json', read(RETENTION / 'policy.json'))
    # Rebind the existing timer before deleting the stale versions it used to protect.
    verify(plan)
    write(RETENTION / 'policy.json', plan['policy'])
    removed = []
    for row in plan['entries']:
        remove_entry(row, plan['keep'])
        removed.append(row['path'])
        write(state / 'progress.json', {'removedEntries': removed})
    removed_tags, retained_images = [], []
    for row in plan['images']:
        referenced = referenced_images()
        require(row['id'] not in referenced | {plan['currentImage'], plan['rollbackImage']}, 'Image acquired a container reference')
        try:
            actual = docker_object('image', row['id'])
        except subprocess.CalledProcessError:
            continue
        require(sorted(actual.get('RepoTags') or []) == row['tags'], 'Image tags changed after review')
        for tag in row['tags']:
            result = subprocess.run(['docker', 'image', 'rm', '--no-prune', tag], capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                removed_tags.append(tag)
            else:
                retained_images.append(row['id'])
        write(state / 'image-progress.json', {'removedTags': removed_tags, 'dockerRetainedImages': sorted(set(retained_images))})
    verify(plan)
    require(read(RETENTION / 'policy.json') == plan['policy'], 'Adopted policy changed')
    require(all(not Path(row['path']).exists() and not Path(row['path']).is_symlink()
                for row in plan['entries']), 'Reviewed history entries remain')
    after = shutil.disk_usage(LIVE)
    result = {'ok': True, 'atUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'release': plan['release'], 'sourceCommit': plan['sourceCommit'], 'currentImage': plan['currentImage'],
              'rollbackImage': plan['rollbackImage'], 'retainedHistory': plan['keep'],
              'removedEntries': len(removed), 'removedImageTags': len(removed_tags),
              'dockerRetainedImages': sorted(set(retained_images)), 'freeBefore': plan['freeBefore'],
              'freeAfter': after.free, 'freedBytes': after.free - plan['freeBefore'],
              'containersUnchanged': True, 'configurationUnchanged': True, 'externalModulesUnchanged': True,
              'databaseRestored': False, 'volumesDeleted': False, 'healthOk': True}
    result['unplannedHistoryPreserved'] = [str(path) for root in ROOTS for path in root.iterdir()
                                         if str(path) not in plan['keep'] and not path.name.endswith('.lock')]
    write(state / 'result.json', result)
    return result


def verified_program_archive(path, metadata):
    """Published source-archive digests attest the installer's complete source check."""
    if path.name not in {'source.tgz', 'source.tar.gz', 'source.tar'}: return False
    expected = set()
    for row in metadata:
        value = row.get('sourceBackupSha256')
        if isinstance(value, str): expected.add(value)
        backup = row.get('backup')
        if isinstance(backup, dict):
            for key in ['sha256', 'sourceSha256', 'sourceArchiveSha256']:
                value = backup.get(key)
                if isinstance(value,str): expected.add(value)
    return bool(expected) and sha(path) in expected


def safe_history_candidates(keep, extra_protected=()):
    """Preserve financial material, fresh work, and source without GitHub evidence."""
    allow = Path('/opt/royal-maintenance/preserved-commits.json')
    commits = set(read(allow)['commits']) if allow.exists() else set()
    retained, protected = set(keep), {Path(p) for p in extra_protected}
    reasons = {}
    for root in ROOTS:
        for path in root.iterdir():
            if str(path) in retained or path.name.endswith('.lock'): continue
            release = RELEASES / path.name
            metadata = []
            for name in ['install-manifest.json', 'build-result.json', 'published.json', 'operator.json', 'release-github.json']:
                file = release / name
                if file.is_file() and not file.is_symlink():
                    try: metadata.append(read(file))
                    except (OSError, ValueError): pass
            source = next((m.get('sourceCommit') for m in metadata if m.get('sourceCommit')), None)
            receipt = next((m for m in metadata if m.get('format') == 1 and m.get('sourceCommit') == source and re.fullmatch('[a-f0-9]{40}', str(m.get('remoteMain', '')))), None)
            pending = (release / 'build-result.json').exists() and not any((release / n).exists() for n in ['published.json', 'recovered.json'])
            if (time.time() - path.lstat().st_mtime < 3600 or pending
                    or not source or source not in commits and receipt is None):
                retained.add(str(path)); reasons[str(path)] = 'fresh, pending, or source not verified in GitHub'; continue
            if path.is_symlink(): continue
            if not path.is_dir():
                retained.add(str(path)); reasons[str(path)] = 'unclassified history entry'; continue
            for item in path.rglob('*'):
                if item.is_symlink(): continue
                lower = item.name.lower()
                sensitive = (lower.endswith(('.dump', '.sql', '.db', '.sqlite', '.sqlite3', '.key', '.pem', '.age'))
                             or lower.startswith('.env') or any(n in lower for n in ['financial', 'database-backup', 'private-config', 'credential', 'secret']))
                if sensitive: protected.add(item)
                elif item.is_file() and lower.endswith(('.tgz', '.tar.gz', '.tar', '.zip')):
                    if not verified_program_archive(item,metadata): protected.add(item)
    rows = deletion_candidates(retained, protected=protected)
    return rows, sorted(retained), sorted(str(p) for p in protected), reasons


def prepare_plan(release, skip_images=False):
    value = recovery(release)
    rows, retained, financial, reasons = safe_history_candidates(value['keep'], value.get('independentModuleProofs',()))
    value.update({'entries': rows, 'keep': sorted(set(value['keep']) | set(retained) | set(financial)),
                  'preservedFinancialFiles': [p for p in financial if p not in value.get('independentModuleProofs',())], 'retainedHistoryReasons': reasons,
                  'images': [] if skip_images else image_candidates({value['currentImage'], value['rollbackImage']}),
                  'skipImageCleanup': skip_images, 'freeBefore': shutil.disk_usage(LIVE).free})
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['plan', 'apply'])
    parser.add_argument('--release', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--plan-sha256')
    parser.add_argument('--skip-image-cleanup', action='store_true')
    parser.add_argument('--wait-seconds', type=int, default=0)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run as the deployment operator')
    require(re.fullmatch('[a-z0-9][a-zA-Z0-9_.-]{0,79}', args.release), 'Invalid release identity')
    state = Path(args.state)
    require(state.parent == Path('/opt/royal-maintenance') and not state.is_symlink(), 'Invalid audit directory')
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    deadline = time.monotonic() + max(0, args.wait_seconds)
    while True:
        locks = []
        try:
            for path in [RELEASES / 'themed-publish.lock', LIVE / '.client-presentation-deploy.lock', MODULE_STATE / 'module.lock']:
                require(not path.is_symlink(), 'Deployment lock symlink')
                lock = path.open('a'); locks.append(lock)
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            for lock in reversed(locks): lock.close()
            if time.monotonic() >= deadline: raise
            time.sleep(min(5, max(0, deadline-time.monotonic())))
    plan_path = state / 'plan.json'
    if args.operation == 'plan':
        require(not plan_path.exists(), 'Review plan already exists')
        value = prepare_plan(args.release, args.skip_image_cleanup)
        write(plan_path, value)
        print(json.dumps({'readOnly': True, 'release': args.release, 'keep': value['keep'],
                          'oldHistoryEntries': len(value['entries']), 'oldImages': len(value['images']),
                          'allocatedHistoryBytes': sum(row['allocatedBytes'] for row in value['entries']),
                          'sourceFilesVerified': value['sourceFiles'], 'rollbackProgramFilesVerified': value['rollbackProgramFiles'],
                          'planSha256': sha(plan_path)}))
    else:
        require(args.plan_sha256 and sha(plan_path) == args.plan_sha256, 'Reviewed plan checksum required')
        value = read(plan_path)
        require(value['release'] == args.release, 'Plan release differs')
        print(json.dumps(apply(value, state)))


if __name__ == '__main__':
    main()
