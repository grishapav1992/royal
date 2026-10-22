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


def deletion_candidates(keep, roots=ROOTS):
    keep = {Path(path) for path in keep}
    result = []
    for root in roots:
        require(root.is_dir() and not root.is_symlink(), 'Unsafe history root')
        for path in sorted(root.iterdir()):
            if path in keep or path.name.endswith('.lock'):
                continue
            require(path.parent == root, 'Deletion escaped history root')
            require(time.time() - path.lstat().st_mtime > 600, 'Recent history entry may be in use: ' + str(path))
            result.append({'path': str(path), 'identity': tree_identity(path), 'allocatedBytes': allocated(path)})
    return result


def remove_entry(row, keep, roots=ROOTS):
    path = Path(row['path'])
    require(path.parent in roots and path not in {Path(p) for p in keep}, 'Deletion escaped approved scope')
    require(tree_identity(path) == row['identity'], 'History entry changed after review: ' + str(path))
    if path.is_symlink() or not path.is_dir():
        path.unlink()
    else:
        shutil.rmtree(path)


def configuration():
    return {name: sha(LIVE / name) for name in
            ['.env', 'compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']}


def modules():
    return {str(path.relative_to(MODULES)): sha(path) for path in sorted(MODULES.rglob('*'))
            if path.is_file() and not path.is_symlink()}


def service_identity(container):
    return {'id': container['Id'], 'image': container['Image'], 'started': container['State']['StartedAt'],
            'mounts': sorted(container['Mounts'], key=lambda mount: mount['Destination'])}


def persistent_services():
    ids = run(['docker', 'ps', '-q']).split()
    data = json.loads(run(['docker', 'inspect', *ids]))
    return {c['Name']: service_identity(c) for c in data if c['Name'] not in PERIODIC}


def healthy():
    container = docker_object('container', 'royal-game-1')
    require(container['State']['Status'] == 'running'
            and container['State'].get('Health', {}).get('Status') == 'healthy', 'Game is not healthy')
    result = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e',
        "fetch('http://127.0.0.1:2567/healthz').then(async r=>{if(!r.ok)process.exit(1);const v=await r.json();if(v.ok!==true)process.exit(1);console.log(JSON.stringify({ok:true}));}).catch(()=>process.exit(1))"]))
    require(result == {'ok': True}, 'Health endpoint failed')
    return container


def native_retention():
    spec = importlib.util.spec_from_file_location('royal_retention', RETENTION / 'app-retention.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def recovery(release):
    root, backup = RELEASES / release, BACKUPS / release
    require(root.is_dir() and backup.is_dir() and not root.is_symlink() and not backup.is_symlink(), 'Recovery paths missing')
    manifest, built, published = [read(root / name) for name in
                                ['install-manifest.json', 'build-result.json', 'published.json']]
    before = manifest['before']
    current = healthy()
    require(manifest['release'] == release and published.get('published') is True, 'Release is not published')
    require(current['Image'] == built['image'] == published['runningImage'], 'A different release is running')
    require(docker_object('image', 'royal-game:latest')['Id'] == current['Image'], 'Prepared image differs')
    require(docker_object('image', current['Image'])['Config']['Labels']['org.opencontainers.image.revision']
            == manifest['sourceCommit'], 'Running source revision differs')
    require(sha(root / 'deploy.py') == manifest['helperSha256']
            and sha(root / 'snapshot.py') == manifest['snapshotSha256'], 'Recovery helpers changed')
    require(sha(backup / 'source.tgz') == built['sourceBackupSha256'], 'Rollback source archive checksum differs')
    with tarfile.open(backup / 'source.tgz') as archive:
        members = archive.getmembers()
        require(all(m.isfile() for m in members), 'Unexpected special source archive member')
        recovered = {m.name: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in members}
        require(len(recovered) == len(members) and recovered == before['source'], 'Rollback archive is incomplete')
    require(sha(backup / 'index.html') == before['program']['dist/index.html'], 'Rollback client index differs')
    expected = {**before['source'], **manifest['changed']}
    require(all((LIVE / name).is_file() and sha(LIVE / name) == digest for name, digest in expected.items()),
            'Live source differs from the published release')
    image = docker_object('image', before['preparedImage'])
    require(image['Id'] != current['Image'] and image['Id'] == before['container']['image'], 'Rollback image is missing or ambiguous')
    # Validate every rollback program byte in a transient container without network or mounts.
    node = "const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){if(!f.existsSync(d))return;for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');walk('/app/module-dist');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    program = json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint',
                              'node', image['Id'], '-e', node]))
    require(program == before['preparedProgram'] == before['program'], 'Rollback program bytes differ')
    current_program = json.loads(run(['docker', 'exec', 'royal-game-1', 'node', '-e', node]))
    require(current_program == built['program'], 'Running program differs from its verified release')
    proofs = [{'path': str(path), 'sha256': sha(path)} for path in
              [root / 'install-manifest.json', root / 'build-result.json', root / 'published.json',
               root / 'deploy.py', root / 'snapshot.py', backup / 'source.tgz', backup / 'index.html']]
    old_policy = read(RETENTION / 'policy.json')
    policy = {**old_policy, 'authorization': 'User requested the current working application and one immediate rollback on 2026-10-22.',
              'adoptedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'managedDirectories': [str(root), str(backup)],
              'workingVersions': [
                  {'image': current['Image'], 'release': release, 'protectedDirectories': [str(root), str(backup)], 'requiredFiles': proofs},
                  {'image': image['Id'], 'release': 'rollback-before-' + release,
                   'protectedDirectories': [str(root), str(backup)], 'requiredFiles': proofs}]}
    native_retention().runtime_guard(policy)
    return {'release': release, 'sourceCommit': manifest['sourceCommit'], 'currentImage': current['Image'],
            'rollbackImage': image['Id'], 'keep': [str(root), str(backup)], 'proofs': proofs,
            'sourceFiles': len(recovered), 'rollbackProgramFiles': len(program),
            'programHashCommand': node,
            'configuration': configuration(), 'services': persistent_services(), 'modules': modules(),
            'moduleHostContract': sha(MODULE_STATE / 'host.json'), 'oldPolicySha256': sha(RETENTION / 'policy.json'),
            'policy': policy}


def image_candidates(protected):
    ids = set(run(['docker', 'image', 'ls', '--filter', 'reference=royal-game:*', '-aq', '--no-trunc']).split())
    containers = run(['docker', 'ps', '-aq']).split()
    if containers:
        protected |= {c['Image'] for c in json.loads(run(['docker', 'inspect', *containers]))}
    result = []
    candidates = sorted(ids - protected)
    rows = json.loads(run(['docker', 'image', 'inspect', *candidates])) if candidates else []
    for row in rows:
        identity = row['Id']
        tags = row.get('RepoTags') or []
        if tags and all(tag.startswith('royal-game:') for tag in tags):
            result.append({'id': identity, 'tags': sorted(tags), 'created': row['Created']})
    return sorted(result, key=lambda row: row['created'], reverse=True)


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
    require(deletion_candidates(plan['keep']) == plan['entries'], 'History deletion set changed since review')
    if not plan.get('skipImageCleanup'):
        require(image_candidates({plan['currentImage'], plan['rollbackImage']}) == plan['images'], 'Image deletion set changed since review')
    write(state / 'policy-before.json', read(RETENTION / 'policy.json'))
    # Rebind the existing timer before deleting the stale versions it used to protect.
    native_retention().runtime_guard(plan['policy'])
    write(RETENTION / 'policy.json', plan['policy'])
    removed = []
    for row in plan['entries']:
        remove_entry(row, plan['keep'])
        removed.append(row['path'])
        write(state / 'progress.json', {'removedEntries': removed})
    removed_tags, retained_images = [], []
    for row in plan['images']:
        live_ids = run(['docker', 'ps', '-aq']).split()
        referenced = {c['Image'] for c in json.loads(run(['docker', 'inspect', *live_ids]))}
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
    native_retention().runtime_guard(read(RETENTION / 'policy.json'))
    require(not deletion_candidates(plan['keep']), 'Obsolete history entries remain')
    after = shutil.disk_usage(LIVE)
    result = {'ok': True, 'atUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'release': plan['release'], 'sourceCommit': plan['sourceCommit'], 'currentImage': plan['currentImage'],
              'rollbackImage': plan['rollbackImage'], 'retainedHistory': plan['keep'],
              'removedEntries': len(removed), 'removedImageTags': len(removed_tags),
              'dockerRetainedImages': sorted(set(retained_images)), 'freeBefore': plan['freeBefore'],
              'freeAfter': after.free, 'freedBytes': after.free - plan['freeBefore'],
              'containersUnchanged': True, 'configurationUnchanged': True, 'externalModulesUnchanged': True,
              'databaseRestored': False, 'volumesDeleted': False, 'healthOk': True}
    write(state / 'result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['plan', 'apply'])
    parser.add_argument('--release', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--plan-sha256')
    parser.add_argument('--skip-image-cleanup', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Run as the deployment operator')
    require(re.fullmatch('[a-z0-9][a-zA-Z0-9_.-]{0,79}', args.release), 'Invalid release identity')
    state = Path(args.state)
    require(state.parent == Path('/opt/royal-maintenance') and not state.is_symlink(), 'Invalid audit directory')
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    locks = []
    for path in [LIVE / '.client-presentation-deploy.lock', MODULE_STATE / 'module.lock']:
        require(not path.is_symlink(), 'Deployment lock symlink')
        lock = path.open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(lock)
    plan_path = state / 'plan.json'
    if args.operation == 'plan':
        require(not plan_path.exists(), 'Review plan already exists')
        value = recovery(args.release)
        value.update({'entries': deletion_candidates(value['keep']),
                      'images': [] if args.skip_image_cleanup else image_candidates({value['currentImage'], value['rollbackImage']}),
                      'skipImageCleanup': args.skip_image_cleanup,
                      'freeBefore': shutil.disk_usage(LIVE).free})
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
