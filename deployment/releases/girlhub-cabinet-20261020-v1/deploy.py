"""Client-only GIRLHUB cabinet presentation release with source and runtime guards."""
from pathlib import Path
import fcntl,hashlib,json,shutil,subprocess,sys,tarfile

ROOT=Path(__file__).resolve().parent
LIVE=Path('/opt/royal')
NAME='girlhub-cabinet-20261020-v1'
BACKUP=Path('/opt/royal-backups')/NAME
M=json.loads((ROOT/'manifest.json').read_text())
OLD=M['before'];CHANGES=M['changes'];DELTA=M['delta']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def require(ok,message):
    if not ok:raise RuntimeError(message)
def run(args,**kw):return subprocess.check_output(args,text=True,**kw).strip()
def write(name,value):(ROOT/name).write_text(json.dumps(value,indent=2)+'\n')
def snap():return json.loads(run(['python3',str(ROOT/'snapshot.py')]))
def image(ref):return run(['docker','image','inspect',ref,'--format','{{.Id}}'])
def source_expected():return {**OLD['source'],**CHANGES}
def settings(s):
    require(s['configHashes']==OLD['configHashes'],'Production configuration changed')
    require(s['container']==OLD['container'],'Game container or runtime settings changed')
    require(s['services']==OLD['services'],'Other services changed')
def baseline():
    s=snap();settings(s)
    require(s['source']==OLD['source'],'Production source changed')
    require(s['program']==OLD['program'],'Production client or backend changed')
    require(s['preparedImage']==OLD['preparedImage'],'Prepared image changed')
    return s
def payload():
    require(ROOT==Path('/opt/royal-releases')/NAME,'Unexpected release path')
    for name,digest in CHANGES.items():require(sha(ROOT/'source'/name)==digest,'Source payload changed: '+name)
    for name,digest in DELTA.items():require(sha(ROOT/'dist-delta'/name)==digest,'Client payload changed: '+name)
def atomic(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    tmp=target.with_name(target.name+'.girlhub-next')
    require(not tmp.exists(),'Unexpected temporary source file')
    shutil.copy2(source,tmp);tmp.replace(target)
def runtime_index(path):
    run(['docker','cp',str(path),'royal-game-1:/app/dist/index.html.girlhub-next'])
    run(['docker','exec','--user','0','royal-game-1','node','-e',"require('fs').renameSync('/app/dist/index.html.girlhub-next','/app/dist/index.html')"])
def build():
    old=baseline();payload()
    require(old['availableBytes']>2*1024**3,'Insufficient free space')
    BACKUP.mkdir(exist_ok=False)
    with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
        for name,digest in OLD['source'].items():
            require(sha(LIVE/name)==digest,'Source changed during backup')
            archive.add(LIVE/name,arcname=name,recursive=False)
    with tarfile.open(BACKUP/'source.tgz') as archive:
        require({m.name:hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers()}==OLD['source'],'Source backup mismatch')
    run(['docker','cp','royal-game-1:/app/dist',str(BACKUP/'dist')])
    for name,digest in OLD['program'].items():
        if name.startswith('dist/'):require(sha(BACKUP/name)==digest,'Static backup mismatch: '+name)
    for suffix,ref in [('',OLD['container']['image']),('-prepared',OLD['preparedImage'])]:
        run(['docker','tag',ref,'royal-game:before-'+NAME+suffix])
    write('backup.json',{'directory':str(BACKUP),'sourceSHA256':sha(BACKUP/'source.tgz'),'previousImage':OLD['container']['image'],'previousPrepared':OLD['preparedImage']})
    context=ROOT/'context';context.mkdir(exist_ok=False)
    shutil.copytree(ROOT/'dist-delta',context/'dist-delta')
    (context/'Dockerfile').write_text('FROM '+OLD['preparedImage']+'\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="'+M['sourceCommit']+'"\n')
    baseline()
    with (ROOT/'build.log').open('w') as log:
        subprocess.run(['docker','build','--pull=false','-t','royal-game:'+NAME,'.'],cwd=context,stdout=log,stderr=subprocess.STDOUT,check=True)
    candidate=image('royal-game:'+NAME)
    code="const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isDirectory())walk(x);else o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    files=json.loads(run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',candidate,'-e',code]))
    expected={**OLD['program'],**{'dist/'+n:h for n,h in DELTA.items()}}
    require(files==expected,'Image differs from the reviewed client delta')
    parent,child=json.loads(run(['docker','image','inspect',OLD['preparedImage'],candidate]))
    for key in ['User','WorkingDir','Env','Entrypoint','Cmd','ExposedPorts','Healthcheck','Volumes']:
        require(parent['Config'].get(key)==child['Config'].get(key),'Image configuration changed')
    result={'image':candidate,'program':expected,'sourceCommit':M['sourceCommit'],'backup':str(BACKUP)}
    write('built.json',result);return {'built':True,'image':candidate,'clientDeltaFiles':len(DELTA)}
def rollback_unlocked():
    built=json.loads((ROOT/'built.json').read_text())
    require(image('royal-game:latest') in [OLD['preparedImage'],built['image']],'Later image blocks rollback')
    for name,digest in CHANGES.items():require(not (LIVE/name).exists() or sha(LIVE/name) in [digest,OLD['source'].get(name)],'Concurrent source blocks rollback')
    with tarfile.open(BACKUP/'source.tgz') as archive:
        for name in CHANGES:
            if name in OLD['source']:
                target=ROOT/'restore'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.extractfile(name).read());atomic(target,LIVE/name)
            else:(LIVE/name).unlink(missing_ok=True)
    runtime_index(BACKUP/'dist/index.html')
    atomic(BACKUP/'dist/index.html',LIVE/'dist/index.html')
    run(['docker','tag',OLD['preparedImage'],'royal-game:latest'])
    write('rolled-back.json',{'sourceRestored':True,'indexRestored':True,'extraAssetsPreserved':True,'databaseTouched':False})
def publish():
    baseline();payload();built=json.loads((ROOT/'built.json').read_text())
    require(image('royal-game:'+NAME)==built['image'],'Candidate image changed')
    assets=ROOT/'assets-delta';assets.mkdir(exist_ok=False)
    for name in DELTA:
        if name=='index.html':continue
        target=assets/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'dist-delta'/name,target)
    try:
        for name in CHANGES:atomic(ROOT/'source'/name,LIVE/name)
        run(['docker','cp',str(assets)+'/.','royal-game-1:/app/dist/'])
        for name in DELTA:
            if name!='index.html':atomic(ROOT/'dist-delta'/name,LIVE/'dist'/name)
        runtime_index(ROOT/'dist-delta/index.html')
        atomic(ROOT/'dist-delta/index.html',LIVE/'dist/index.html')
        run(['docker','tag',built['image'],'royal-game:latest'])
        after=snap();settings(after)
        require(after['source']==source_expected(),'Published source differs')
        require(after['program']==built['program'],'Published files differ')
        require(after['preparedImage']==built['image'],'Prepared image differs')
        write('after.json',after)
        result={'published':True,'preparedImage':built['image'],'runningImage':after['container']['image'],'containerRestarted':False,'sourceCommit':M['sourceCommit'],'changedSources':list(CHANGES),'clientDeltaFiles':len(DELTA),'configurationsPreserved':True,'gameDataPreserved':True,'backendPreserved':True,'otherServicesPreserved':True,'oldAssetsPreserved':True}
        write('published.json',result);return result
    except BaseException:
        rollback_unlocked();raise

if __name__=='__main__':
    require(len(sys.argv)==2 and sys.argv[1] in ['build','publish','rollback'],'Unknown operation')
    with (LIVE/'.client-presentation-deploy.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1]=='rollback':rollback_unlocked();print(json.dumps({'rolledBack':True}))
        else:print(json.dumps(globals()[sys.argv[1]]()))
