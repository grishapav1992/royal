"""Repair only public directory modes of the verified installed Neopolis v4 package."""
from pathlib import Path
import fcntl,hashlib,json,re,subprocess,sys

ROOT=Path('/opt/royal-releases/neopolis-variable-stake-20261028-v1')
assert Path(__file__).resolve().parent==ROOT
assert len(sys.argv)==2 and re.fullmatch('[a-f0-9]{40}',sys.argv[1])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
locks=[]
for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
    p=Path(name);assert not p.is_symlink();handle=p.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
published=json.loads((ROOT/'published.json').read_text());exit=json.loads((ROOT/'exit.json').read_text())
assert published['published'] and exit['exitCode']==0
assert published['sourceCommit']=='9acf3686965fedc0c81efaaa6f740e30d4fef175'
row=json.loads(subprocess.check_output(['docker','inspect','royal-game-1']))[0]
assert row['Image']==published['images']['game'] and row['State']['Health']['Status']=='healthy'
version=Path('/opt/royal-game-modules/studio-neopolis/versions/0.5.0-d06ece4da7b2')
assert not any(p.is_symlink() for p in [version,*version.parents])
pointer=version.parent.parent/'active.json';before_pointer=sha(pointer)
assert before_pointer==published['module']['activeSha256']
metadata=json.loads((version/'manifest.json').read_text());active=json.loads(pointer.read_text())
assert sha(version/'manifest.json')==active['sha256']
assert metadata['gameId']=='studio-neopolis' and metadata['version']==version.name
files={'manifest.json',*metadata['files']};actual={str(p.relative_to(version)) for p in version.rglob('*') if p.is_file()}
assert actual==files
for name,digest in metadata['files'].items():assert sha(version/name)==digest,name
for p in version.rglob('*'):
    assert not p.is_symlink()
    if p.is_file():assert p.stat().st_mode&0o777==0o644
directories=[version,*[p for p in version.rglob('*') if p.is_dir()]];changed=[]
for p in directories:
    old=p.stat().st_mode&0o777;assert old in [0o700,0o755]
    if old!=0o755:p.chmod(0o755);changed.append({'path':str(p),'before':oct(old),'after':'0o755'})
assert sha(pointer)==before_pointer
for name,digest in metadata['files'].items():assert sha(version/name)==digest
record={'repairSourceCommit':sys.argv[1],'scriptSha256':sha(Path(__file__)),'applicationSourceCommit':published['sourceCommit'],'changedDirectories':changed,'verifiedFiles':len(files),'activePointerUnchanged':True,'resourceBytesUnchanged':True,'databaseTouched':False}
(ROOT/'module-modes-repair.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
