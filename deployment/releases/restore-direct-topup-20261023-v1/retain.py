"""Use existing retention guards, preserving finance backups and unfinished releases."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import importlib.util
import json
import io
import os
import shutil
import tarfile
import time
from retention_pending import pending_image_ids

NAME = 'restore-direct-topup-20261023-v1'
parser = argparse.ArgumentParser()
parser.add_argument('operation', choices=['plan', 'apply'])
parser.add_argument('--maintenance', required=True)
parser.add_argument('--state', required=True)
parser.add_argument('--git-objects', required=True)
parser.add_argument('--plan-sha256')
args = parser.parse_args()
state = Path(args.state)
assert state.parent == Path('/opt/royal-maintenance') and not state.is_symlink()
state.mkdir(mode=0o700, parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('existing_retention', args.maintenance)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
locks = []
for path in [m.RELEASES / 'themed-publish.lock', m.LIVE / '.client-presentation-deploy.lock', m.MODULE_STATE / 'module.lock']:
    assert not path.is_symlink()
    lock = path.open('a');fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB);locks.append(lock)
plan_path = state / 'plan.json'
if args.operation == 'apply':
    assert args.plan_sha256 and m.sha(plan_path) == args.plan_sha256
    value = m.read(plan_path)
    print(json.dumps(m.apply(value, state)))
else:
    assert not plan_path.exists()
    review = m.read(Path(__file__).with_name('periodic-review.json'))
    ordinary_read = m.read
    def reviewed_policy_read(path):
        value = ordinary_read(path)
        if Path(path) == m.RETENTION / 'policy.json':
            for name, row in review['changes'].items():
                assert name in m.native_retention().PERIODIC_NAMES
                prior = value['periodicContainerFingerprints'].get(name)
                assert prior in [row['before'], row['after']], 'Unreviewed periodic configuration'
                value['periodicContainerFingerprints'][name] = row['after']
        return value
    m.read = reviewed_policy_read
    try:
        value = m.recovery(NAME)
    finally:
        m.read = ordinary_read
    pointer_backup = m.BACKUPS / NAME / 'module-pointers.json'
    module_record = m.RELEASES / NAME / 'modules-published.json'
    before_modules = m.read(m.RELEASES / NAME / 'install-manifest.json')['before']['moduleFiles']
    for game, pointer in m.read(pointer_backup).items():
        path = '/opt/royal-game-modules/' + game + '/active.json'
        if pointer is not None:
            digest = hashlib.sha256((json.dumps(pointer, indent=2) + '\n').encode()).hexdigest()
            assert digest == before_modules[path], 'Rollback pointer cannot be restored exactly'
    for name,digest in before_modules.items():
        if not name.endswith('/active.json'):
            assert m.sha(name) == digest, 'Rollback immutable package changed'
    value['proofs'].extend({'path':str(path),'sha256':m.sha(path)} for path in [pointer_backup,module_record])
    for version in value['policy']['workingVersions']:
        version['requiredFiles'] = value['proofs']
    pending_images, pending_paths = m.native_retention().pending_builds()
    pending_images, pending_paths = set(pending_images), set(pending_paths)
    for folder in m.RELEASES.iterdir():
        result = folder / 'build-result.json'
        manifest = folder / 'install-manifest.json'
        if not folder.is_dir() or folder.is_symlink() or not (result.is_file() or manifest.is_file()):
            continue
        completed = any((folder / name).is_file() and m.read(folder / name).get('published') is True
                        for name in ['published.json', 'verification.json'])
        if completed:
            continue
        pending_images.update(pending_image_ids(m.read(result) if result.is_file() else {}, m.read(manifest) if manifest.is_file() else {}))
        pending_paths.add(str(folder))
    keep = set(value['keep']);exceptions = {}
    def preserve(name, reason, condition):
        for p in [m.RELEASES / name, m.BACKUPS / name]:
            if p.exists() and str(p) not in keep:
                keep.add(str(p));exceptions[str(p)] = {'reason': reason, 'cleanupCondition': condition}
    for name in ['raise-windows-20261023-v1', 'raise-windows-20261023-v2', 'mortal-kombat-20261023-v1']:
        preserve(name, 'Another chat has an unfinished publication', 'Its owner publishes or retires the prepared release after reconciling direct top-ups')
    for name in ['restore-usdt-20261023-v1', 'pvp-usdt-20261023-v1', 'pvp-usdt-20261023-v2']:
        preserve(name, 'Financial source or journal backup has a separate retention policy', 'The financial backup owner explicitly retires this recovery set')
    for p in pending_paths:
        preserve(Path(p).name, 'Unpublished build owned by another task', 'Its owner publishes or retires the prepared build')
    for root in [m.RELEASES, m.BACKUPS]:
        for p in root.iterdir():
            if p.is_dir() and not p.is_symlink() and time.time() - p.stat().st_mtime < 600:
                preserve(p.name, 'Recent work may still be active', 'The owner finishes verification and the directory is stable for ten minutes')
    for p in m.BACKUPS.iterdir():
        if p.is_dir() and any(f.suffix in ['.dump', '.sql', '.sqlite', '.db'] for f in p.rglob('*') if f.is_file()):
            preserve(p.name, 'Contains financial or database backups governed by separate retention', 'Financial backup owner moves the governed backup and confirms application history can be retired')
    reachable = {line.strip().lstrip('?') for line in Path(args.git_objects).read_text().splitlines()}
    before = m.read(m.RELEASES / NAME / 'install-manifest.json')['before']
    current = m.read(m.RELEASES / NAME / 'install-manifest.json')['changed']
    retained = set(before['source'].values()) | set(current.values())
    audits = {}; unique = {}; origins = []
    for p in sorted(m.BACKUPS.iterdir()):
        if not p.is_dir() or str(p) in keep:continue
        archives = list(p.glob('source*.tgz')) + list(p.glob('source*.tar.gz'))
        unknown = [];count = 0
        for archive in archives:
            with tarfile.open(archive) as tar:
                for entry in tar:
                    if not entry.isfile():continue
                    data = tar.extractfile(entry).read();raw = data;count += 1
                    if hashlib.sha256(data).hexdigest() in retained:continue
                    try:data.decode('utf8');data = data.replace(b'\r\n', b'\n')
                    except UnicodeDecodeError:pass
                    blob = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
                    if blob not in reachable:
                        digest = hashlib.sha256(raw).hexdigest()
                        unknown.append(entry.name);unique[digest] = raw
                        origins.append({'archive':str(archive),'path':entry.name,'sha256':digest,'bytes':len(raw)})
        audits[str(p)] = {'sourceFilesChecked':count, 'unverifiedPaths':unknown}
        if not archives:
            preserve(p.name, 'No source inventory available for this history entry', 'Its owner verifies all unique material before retirement')
    if unique:
        backup = m.BACKUPS / NAME;archive = backup / 'historical-sources.tgz';manifest = backup / 'historical-sources.json'
        if archive.exists() or manifest.exists():
            assert archive.is_file() and manifest.is_file(), 'Incomplete historical preservation requires review'
            prior = m.read(manifest)
            assert m.sha(archive) == prior['archiveSha256'], 'Historical archive changed'
            with tarfile.open(archive) as tar:
                recovered = {entry.name:tar.extractfile(entry).read() for entry in tar if entry.isfile()}
            assert set(recovered) == set(prior['checksums'])
            assert all(hashlib.sha256(data).hexdigest() == digest for digest,data in recovered.items())
            assert all(recovered.get(digest) == data for digest,data in unique.items()), 'New unique history requires a successor archive'
        else:
            temporary = backup / 'historical-sources.next.tgz'
            assert shutil.disk_usage(backup).free > 5 * 1024**3 + 2 * sum(map(len,unique.values())), 'Historical preservation would cross the disk reserve'
            with tarfile.open(temporary, 'w:gz') as tar:
                for digest,data in sorted(unique.items()):
                    entry = tarfile.TarInfo(digest);entry.size=len(data);entry.mode=0o600;tar.addfile(entry,io.BytesIO(data))
            with tarfile.open(temporary) as tar:
                recovered = {entry.name:tar.extractfile(entry).read() for entry in tar}
            assert recovered==unique, 'Historical source verification failed'
            os.replace(temporary,archive)
            m.write(manifest,{'origins':origins,'checksums':sorted(unique),'archiveSha256':m.sha(archive),'sampleRestoreVerified':True})
        sample = state / 'restore-sample.bin';digest=next(iter(recovered));sample.write_bytes(recovered[digest]);assert m.sha(sample)==digest;sample.unlink()
        for p in [archive,manifest]:value['proofs'].append({'path':str(p),'sha256':m.sha(p)})
        value['preservedHistoricalSourceFiles']=len(recovered)
    value['keep'] = sorted(keep)
    value.update(entries=m.deletion_candidates(value['keep']), images=[], freeBefore=shutil.disk_usage(m.LIVE).free, activeWorkExceptions=exceptions, historicalSourceAudit=audits)
    value['skipImageCleanup'] = True
    value['imageCleanupDeferred'] = {'reason':'Docker image inventory timed out after 180 seconds; every image is retained', 'cleanupCondition':'Rerun reviewed image cleanup after Docker image inventory completes successfully'}
    m.write(plan_path, value)
    print(json.dumps({'release':NAME,'planSha256':m.sha(plan_path),'oldEntries':len(value['entries']),'oldImages':len(value['images']),'allocatedBytes':sum(r['allocatedBytes'] for r in value['entries']),'activeWorkExceptions':exceptions,'historicalSourceAudit':audits}))
