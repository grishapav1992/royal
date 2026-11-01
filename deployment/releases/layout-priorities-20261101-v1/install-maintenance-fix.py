"""Install one committed maintenance fix under the normal publication locks."""
from pathlib import Path
import fcntl, hashlib, json, os, re, subprocess, time

ROOT=Path('/opt/royal-releases/layout-priorities-20261101-v1')
TARGET=Path('/opt/royal-maintenance/bin/cleanup-release-history.py')
BACKUP=Path('/opt/royal-backups/layout-priorities-20261101-v1/maintenance-cleanup-before.py')

def sha(value):return hashlib.sha256(value).hexdigest()

def main():
    assert Path(__file__).resolve().parent==ROOT and os.geteuid()==0
    m=json.loads((ROOT/'maintenance-update.json').read_text())
    assert re.fullmatch('[a-f0-9]{40}',m['sourceCommit']) and m['githubVerified'] is True
    assert m['path']=='deployment/maintenance/cleanup-release-history.py' and m['testsPassed']==38
    locks=[]
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        path=Path(name);assert not path.is_symlink()
        handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX);locks.append(handle)
    assert subprocess.check_output(['systemctl','show','royal-dev-app-retention.service','--value','-p','MainPID'],text=True).strip()=='0'
    assert TARGET.resolve()==TARGET and not TARGET.is_symlink()
    old=TARGET.read_bytes();new=(ROOT/'cleanup-release-history.updated.py').read_bytes()
    assert sha(old)==m['oldSha256'] and sha(new)==m['newSha256']
    assert not BACKUP.exists();BACKUP.write_bytes(old);BACKUP.chmod(0o600)
    partial=TARGET.with_name(TARGET.name+'.layout-next');assert not partial.exists()
    with partial.open('xb') as output:
        output.write(new);output.flush();os.fsync(output.fileno())
    partial.chmod(TARGET.stat().st_mode&0o777);os.replace(partial,TARGET)
    result={**m,'installed':True,'at':time.time(),'backup':str(BACKUP),'installedSha256':sha(TARGET.read_bytes()),'gameImageChanged':False}
    (ROOT/'maintenance-applied.json').write_text(json.dumps(result,indent=2)+'\n')
    for handle in reversed(locks):handle.close()
    subprocess.run(['systemctl','reset-failed','royal-dev-app-retention.service'],check=True)
    subprocess.run(['systemctl','start','--no-block','royal-dev-app-retention.service'],check=True)
    print(json.dumps(result),flush=True)

if __name__=='__main__':main()
