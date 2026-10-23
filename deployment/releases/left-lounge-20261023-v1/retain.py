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

NAME = 'left-lounge-20261023-v1'
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
for path in [m.LIVE / '.client-presentation-deploy.lock', m.MODULE_STATE / 'module.lock']:
    assert not path.is_symlink()
    lock = path.open('a');fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB);locks.append(lock)
plan_path = state / 'plan.json'
if args.operation == 'apply':
    assert args.plan_sha256 and m.sha(plan_path) == args.plan_sha256
    value = m.read(plan_path)
    print(json.dumps(m.apply(value, state)))
else:
    assert not plan_path.exists()
    value = m.recovery(NAME)
    pending_images, pending_paths = m.native_retention().pending_builds()
    pending_images, pending_paths = set(pending_images), set(pending_paths)
    for folder in m.RELEASES.iterdir():
        result = folder / 'build-result.json'
        if not folder.is_dir() or folder.is_symlink() or not result.is_file():continue
        completed = any((folder / name).is_file() and m.read(folder / name).get('published') is True
                        for name in ['published.json', 'verification.json'])
        if completed:continue
        manifest = folder / 'install-manifest.json'
        pending_images.update(pending_image_ids(m.read(result), m.read(manifest) if manifest.is_file() else {}))
        pending_paths.add(str(folder))
    keep = set(value['keep']);exceptions = {}
    def preserve(name, reason, condition):
        for p in [m.RELEASES / name, m.BACKUPS / name]:
            if p.exists() and str(p) not in keep:
                keep.add(str(p));exceptions[str(p)] = {'reason': reason, 'cleanupCondition': condition}
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
        assert not archive.exists() and not manifest.exists(), 'Historical consolidation already exists; review it before another plan'
        temporary = backup / 'historical-sources.next.tgz'
        assert shutil.disk_usage(backup).free > 5 * 1024**3 + 2 * sum(map(len,unique.values())), 'Historical preservation would cross the disk reserve'
        with tarfile.open(temporary, 'w:gz') as tar:
            for digest,data in sorted(unique.items()):
                entry = tarfile.TarInfo(digest);entry.size=len(data);entry.mode=0o600;tar.addfile(entry,io.BytesIO(data))
        with tarfile.open(temporary) as tar:
            recovered = {entry.name:tar.extractfile(entry).read() for entry in tar}
        assert recovered==unique, 'Historical source verification failed'
        sample = state / 'restore-sample.bin';digest=next(iter(unique));sample.write_bytes(recovered[digest]);assert m.sha(sample)==digest;sample.unlink()
        os.replace(temporary,archive)
        m.write(manifest,{'origins':origins,'checksums':sorted(unique),'archiveSha256':m.sha(archive),'sampleRestoreVerified':True})
        for p in [archive,manifest]:value['proofs'].append({'path':str(p),'sha256':m.sha(p)})
        value['preservedHistoricalSourceFiles']=len(unique)
    value['keep'] = sorted(keep)
    value.update(entries=m.deletion_candidates(value['keep']), images=m.image_candidates({value['currentImage'], value['rollbackImage']} | pending_images), freeBefore=shutil.disk_usage(m.LIVE).free, activeWorkExceptions=exceptions, historicalSourceAudit=audits)
    m.write(plan_path, value)
    print(json.dumps({'release':NAME,'planSha256':m.sha(plan_path),'oldEntries':len(value['entries']),'oldImages':len(value['images']),'allocatedBytes':sum(r['allocatedBytes'] for r in value['entries']),'activeWorkExceptions':exceptions,'historicalSourceAudit':audits}))
