"""Retire explicitly reviewed, unused private build-cache IDs; never images or data."""
from pathlib import Path
import fcntl,json,shutil,subprocess,time

IDS=['nwsbj1r05n95cxlwcepa70e59','xa2umjt5jo4larojsp5592sxa','27rc2zkzbt5pnlsbbqww7hhhx','bftreokk3nb272gml1gyvmc2q','q5t9c6rk4tw22vtpjsfawtpiv','qil3vm0807ns3ovn3b0ryjx0i']
run=lambda args:subprocess.check_output(args,text=True).strip()
locks=[]
for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
 h=open(name,'a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(h)
rows={r['ID']:r for r in map(json.loads,run(['docker','buildx','du','--format','json']).splitlines())}
for identity in IDS:
 r=rows[identity];assert r['Reclaimable'] and not r['Shared'] and r['Type'] in ['regular','source.local']
 assert 'hours ago' in r['LastUsedAt'] and int(r['LastUsedAt'].split()[0])>=12
prepared=run(['docker','image','inspect','royal-game:latest','--format','{{.Id}}'])
game=json.loads(run(['docker','inspect','royal-game-1']))[0]
free=shutil.disk_usage('/opt').free
result=subprocess.run(['docker','buildx','prune','--filter','id~=^('+'|'.join(IDS)+')$','--filter','shared=false','--filter','inuse=false','--filter','until=12h','--force','--verbose'],capture_output=True,text=True,check=True)
assert run(['docker','image','inspect','royal-game:latest','--format','{{.Id}}'])==prepared,'Prepared image changed'
after=json.loads(run(['docker','inspect','royal-game-1']))[0]
assert after['Id']==game['Id'] and after['State']['StartedAt']==game['State']['StartedAt'] and after['Image']==game['Image']
report={'at':time.time(),'selectedCacheIds':IDS,'freeBefore':free,'freeAfter':shutil.disk_usage('/opt').free,'imagesDeletionRequested':False,'preparedImagePreserved':True,'gameUnchanged':True,'volumesTouched':False,'output':result.stdout[-1500:]}
Path(__file__).with_name('cache-cleanup.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
