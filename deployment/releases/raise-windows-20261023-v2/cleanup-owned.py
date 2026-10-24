from pathlib import Path
import fcntl,hashlib,json,os,shutil,stat,subprocess,sys,tarfile

ROOT=Path('/opt/royal-releases/raise-windows-20261023-v2')
OLD=Path('/opt/royal-releases/raise-windows-20261023-v1')
BACKUP=Path('/opt/royal-backups/raise-windows-20261023-v2')
OLD_BACKUP=Path('/opt/royal-backups/raise-windows-20261023-v1')
LIVE=Path('/opt/royal')

def require(ok,message):
    if not ok:raise RuntimeError(message)
def read(path):return json.loads(path.read_text())
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()
def run(args):return subprocess.check_output(args,text=True).strip()
def free():
    s=os.statvfs(LIVE);return s.f_bavail*s.f_frsize
def tree(path):
    require(path.exists() and not path.is_symlink(),'Missing owned path')
    rows=[];files={};allocated=0
    def visit(p):
        nonlocal allocated
        s=p.lstat();require(stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode),'Special path in owned cleanup')
        require(not os.path.ismount(p),'Mounted path in owned cleanup')
        rows.append([str(p.relative_to(path)),s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns]);allocated+=s.st_blocks*512
        if p.is_dir():
            for c in sorted(p.iterdir()):visit(c)
        else:files[str(p.relative_to(path))]=sha(p)
    visit(path)
    return {'path':str(path),'stamp':hashlib.sha256(json.dumps(rows).encode()).hexdigest(),'allocatedBytes':allocated,'files':files}
def inventory(path):return tree(path)['files']
def archive(path):
    with tarfile.open(path) as t:
        rows=t.getmembers();require(all(x.isfile() for x in rows),'Special archive entry')
        result={x.name:hashlib.sha256(t.extractfile(x).read()).hexdigest() for x in rows}
        require(len(result)==len(rows),'Duplicate archive entry');return result

def context_expected(manifest):
    name=manifest['release']
    dockerfile='FROM royal-game:before-'+name+'-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\nCOPY --chown=node:node server-delta/index.js /app/dist-server/index.js\nLABEL org.opencontainers.image.revision="'+manifest['sourceCommit']+'"\n'
    ignore='**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n!server-delta\n!server-delta/index.js\n'
    h=lambda s:hashlib.sha256(s.encode()).hexdigest()
    return {'Dockerfile':h(dockerfile),'.dockerignore':h(ignore),**{'dist-delta/'+n:v for n,v in manifest['delta'].items()},**{'server-delta/'+n:v for n,v in manifest['serverDelta'].items()}}

def live_guard():
    m,b,p=[read(ROOT/n) for n in ['install-manifest.json','build-result.json','published.json']]
    require(m['release']==ROOT.name and p.get('published') is True,'Successor is not published')
    require(run(['docker','inspect','royal-game-1','--format','{{.Image}} {{.State.Health.Status}}'])==b['image']+' healthy','Current release or health changed')
    require(run(['docker','image','inspect','royal-game:latest','--format','{{.Id}}'])==b['image'],'Prepared release changed')
    require(sha(ROOT/'deploy.py')==m['helperSha256'] and sha(ROOT/'snapshot.py')==m['snapshotSha256'],'Recovery helper changed')
    require(sha(BACKUP/'source.tgz')==b['sourceBackupSha256'],'Successor source archive changed')
    require(sha(BACKUP/'index.html')==m['before']['program']['dist/index.html'],'Successor index backup changed')
    expected={**m['before']['source'],**m['changed']}
    require(all((LIVE/n).is_file() and sha(LIVE/n)==v for n,v in expected.items()),'Live source changed')
    return m,b

def check():
    m,b=live_guard();require(archive(BACKUP/'source.tgz')==m['before']['source'],'Successor source backup incomplete')
    old=read(OLD/'install-manifest.json');proof=read(ROOT/'old-attempt-preservation.json')
    require(old['release']==OLD.name and proof['obsoleteAttempt']==OLD.name and proof['requiredSuccessor']==ROOT.name,'Old attempt ownership changed')
    allowed={'deploy.py','snapshot.py','install-manifest.json','transport.tgz','build.log','paused.json','runtime-context','source','dist-delta','server-delta'}
    require({p.name for p in OLD.iterdir()}==allowed,'Unexpected old attempt file')
    require({p.name for p in OLD_BACKUP.iterdir()}=={'source.tgz','index.html'},'Unexpected old backup file')
    require(read(OLD/'paused.json').get('pausedBeforePublication') is True,'Old attempt is not paused')
    require(sha(OLD/'deploy.py')==old['helperSha256'] and sha(OLD/'snapshot.py')==old['snapshotSha256'],'Old helper changed')
    for folder,key in [('source','changed'),('dist-delta','delta'),('server-delta','serverDelta')]:require(inventory(OLD/folder)==old[key],'Old payload changed')
    require(inventory(OLD/'runtime-context')==context_expected(old),'Old build context changed')
    require(archive(OLD_BACKUP/'source.tgz')==old['before']['source'],'Old archive differs')
    require(sha(OLD_BACKUP/'index.html')==old['before']['program']['dist/index.html'],'Old backup index differs')
    for n,v in old['before']['source'].items():
        if m['before']['source'].get(n)==v:continue
        row=proof['historicalChangedSourcesPreservedInGit'].get(n,{})
        require(row.get('oldSourceSha256')==v and row.get('preservedInCommit')=='b462e9dadaa140b5be000a83a96dfdd910acd245','Historical source preservation missing: '+n)
    require(inventory(ROOT/'runtime-context')==context_expected(m),'Current build context changed')
    require(sha(ROOT/'transport.tgz')=='9c0d804ca9e13ff51b7f66195af45ea6376198606382c0d9f988b55412411521','Current transport changed')
    require(read(ROOT/'review-direct-snapshot.json')==m['before'],'Temporary review differs')
    paths=[OLD,OLD_BACKUP,ROOT/'runtime-context',ROOT/'transport.tgz',ROOT/'review-direct-snapshot.json']
    plan={'verified':True,'sourceCommit':m['sourceCommit'],'image':b['image'],'freeBefore':free(),'entries':[tree(p) for p in paths],'successorBackup':str(BACKUP),'successorBackupBytes':sum(p.stat().st_size for p in BACKUP.iterdir() if p.is_file()),'allDockerImagesPreserved':True,'financialBackupsAndPlayerDataUntouched':True}
    (ROOT/'owned-cleanup-plan.json').write_text(json.dumps(plan,indent=2)+'\n');print(json.dumps({k:v for k,v in plan.items() if k!='entries'}))

def apply():
    m,b=live_guard();plan=read(ROOT/'owned-cleanup-plan.json');require(plan['sourceCommit']==m['sourceCommit'] and plan['image']==b['image'],'Plan is for a different release')
    expected={str(p) for p in [OLD,OLD_BACKUP,ROOT/'runtime-context',ROOT/'transport.tgz',ROOT/'review-direct-snapshot.json']}
    require({r['path'] for r in plan['entries']}==expected,'Deletion scope differs')
    for row in plan['entries']:
        now=tree(Path(row['path']));require(now==row,'Owned path changed since review')
    before=free();removed=sum(r['allocatedBytes'] for r in plan['entries'])
    for row in plan['entries']:
        p=Path(row['path']);shutil.rmtree(p) if p.is_dir() else p.unlink()
    result={k:v for k,v in plan.items() if k not in ['entries','freeBefore']};result.update(removedOwnedAllocatedBytes=removed,freeBefore=before,freeAfter=free(),sharedHistoryRetired=False)
    (ROOT/'owned-cleanup-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':
    require(len(sys.argv)==2 and sys.argv[1] in ['check','apply'],'Expected check or apply')
    paths=[LIVE/'.client-presentation-deploy.lock',Path('/opt/royal-game-modules-state/module.lock')]
    require(all(not p.is_symlink() for p in paths),'Lock symlink rejected')
    with paths[0].open('a') as a,paths[1].open('a') as b:
        fcntl.flock(a,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(b,fcntl.LOCK_EX|fcntl.LOCK_NB)
        globals()[sys.argv[1]]()
