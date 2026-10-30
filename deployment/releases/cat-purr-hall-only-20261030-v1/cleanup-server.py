from pathlib import Path
import fcntl,hashlib,json,shutil
root=Path('/opt/royal-releases/cat-purr-hall-only-20261030-v1')
assert root.resolve()==root and not root.is_symlink()
m=json.loads((root/'install-manifest.json').read_text())
assert json.loads((root/'exit.json').read_text())['exitCode']==0
published=json.loads((root/'published.json').read_text())
assert published['published'] and published['sourceCommit']==m['sourceCommit']
cleanup_lock=(root/'cleanup.lock').open('a')
fcntl.flock(cleanup_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
# Only completed-job transport and build context are removed. Shared production state is untouched.
context=root/'runtime-context'; transport=root/'transport.tgz'
assert context.is_dir() and not context.is_symlink() and transport.is_file() and not transport.is_symlink()
files={p.relative_to(context).as_posix():p for p in context.rglob('*') if p.is_file()}
assert not any(p.is_symlink() for p in context.rglob('*'))
assert set(files)=={'Dockerfile','.dockerignore',*('dist-delta/'+name for name in m['delta'])}
for name,digest in m['delta'].items():assert hashlib.sha256(files['dist-delta/'+name].read_bytes()).hexdigest()==digest
assert hashlib.sha256(transport.read_bytes()).hexdigest()=='f2334ba39ebbcd8e019c2114c3f5e5c670ee640c1658a4021180fc6e8a7bc44b'
removed=[{'path':str(context),'logicalBytes':sum(p.stat().st_size for p in files.values()),'hardlinks':True},{'path':str(transport),'logicalBytes':transport.stat().st_size}]
before=shutil.disk_usage(root).free
shutil.rmtree(context);transport.unlink()
report={'sourceCommit':m['sourceCommit'],'removed':removed,'freeBytesBefore':before,'freeBytesAfter':shutil.disk_usage(root).free,'backupPreserved':True,'imagesPreserved':True,'retainedRollbackPayload':['source','dist-delta','server-delta','install-manifest.json','build-result.json'],'cleanupCondition':'Retain guarded rollback inputs until a subsequent verified compatible host release supersedes this release','concurrentDiskActivity':True}
(root/'cleanup.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))

