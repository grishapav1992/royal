"""Remove only this completed release's transient inputs after remote preservation."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import sys

ROOT=Path('/opt/royal-releases/flooded-temple-20261030-v1')
SOURCE='b1eeea9ffe6154c6941ae568a8712bc6ebfb10d0'
def read(name): return json.loads((ROOT/name).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
assert len(sys.argv)==2 and re.fullmatch(r'[a-f0-9]{40}',sys.argv[1])
assert ROOT.resolve()==ROOT and ROOT.is_dir() and not ROOT.is_symlink()
locks=[]
for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
 p=Path(name);assert not p.is_symlink();handle=p.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
assert read('published.json')['sourceCommit']==SOURCE and read('published.json')['published']
assert read('exit.json')['exitCode']==0
proof=read('public-verification.json');assert proof['passed'] and proof['sourceCommit']==SOURCE
pointer=json.loads(Path('/opt/royal-game-modules/studio-flooded-temple/active.json').read_text())
assert pointer['sha256']==read('install-manifest.json')['modulePackage']['manifestSha256']
folders=[ROOT/name for name in ['source','finance-source','dist','backend','module-dist','temple-package','game-context','finance-context','__pycache__'] if (ROOT/name).exists()]
files=[ROOT/name for name in ['transport.tgz','live-index.js','live-play.js','before.json','after.json','release.log','runner.log','game-build.log','finance-build.log','financial-gate.log'] if (ROOT/name).exists()]
directories=[]
for folder in folders:
 assert folder.parent==ROOT and folder!=ROOT and folder.resolve()==folder and not folder.is_symlink()
 for path in folder.rglob('*'):
  assert not path.is_symlink() and path.resolve().is_relative_to(ROOT)
  if path.is_file(): files.append(path)
  elif path.is_dir(): directories.append(path)
  else: raise RuntimeError('Special file in cleanup scope')
 directories.append(folder)
rows=[]
for path in files:
 assert path.resolve().is_relative_to(ROOT) and stat.S_ISREG(path.lstat().st_mode)
 s=path.stat();rows.append({'path':path.relative_to(ROOT).as_posix(),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'sha256':sha(path)})
inventory={'owner':'Flooded Temple production 0.9.6','preservedRemoteCommit':sys.argv[1],'sourceCommit':SOURCE,'files':rows,'directories':[str(p.relative_to(ROOT)) for p in directories]}
(ROOT/'cleanup-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
for row in rows:
 path=ROOT/row['path'];s=path.stat();assert s.st_size==row['bytes'] and s.st_mtime_ns==row['mtimeNs'] and sha(path)==row['sha256']
before=shutil.disk_usage(ROOT).free
for row in rows: (ROOT/row['path']).unlink()
for path in sorted(directories,key=lambda p:len(p.parts),reverse=True): path.rmdir()
result={'preservedRemoteCommit':sys.argv[1],'sourceCommit':SOURCE,'removedFiles':len(rows),'removedLogicalBytes':sum(row['bytes'] for row in rows),'removedDirectories':len(directories),'removedRoots':[p.name for p in folders],'removedArchives':[{'path':row['path'],'bytes':row['bytes']} for row in rows if row['path'].endswith('.tgz')],'freeBefore':before,'freeAfter':shutil.disk_usage(ROOT).free,'physicalSpaceAttribution':False,'retained':['Production source and financial backups, previous images, current immutable module, installed canonical source, normal release manifests and compact verification'],'priorRejectedTargetsRetried':False}
(ROOT/'cleanup-result.json').write_text(json.dumps(result,indent=2)+'\n');assert result['freeAfter']>=5*1024**3
print(json.dumps(result))
