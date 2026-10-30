"""Guard a frontend and compatible Forest Heart publication; never change player data."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import uuid

NAME = 'forest-heart-responsive-20261030-v1'
ROOT = Path('/opt/royal-releases') / NAME
LIVE = Path('/opt/royal')
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
BACKUP = Path('/opt/royal-backups') / NAME
GAME = 'studio-forest-heart'
CONTRACT = {'apiVersion': 1, 'rulesVersion': 1, 'progressVersion': 1}
MIN_FREE = 5 * 1024**3
HOST_SOURCES = {'src/ui/GameViewport.ts', 'src/ui/RoyalCatalogArtwork.ts', 'src/ui/royal-platform.css'}
PROGRAM = r"""const fs=require('fs'),p=require('path'),c=require('crypto'),o={},buffer=Buffer.allocUnsafe(262144);function hash(file){const h=c.createHash('sha256'),fd=fs.openSync(file,'r');try{let n;while(n=fs.readSync(fd,buffer,0,buffer.length,null))h.update(buffer.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}function walk(d,links=false){if(!fs.existsSync(d))return;for(const n of fs.readdirSync(d).sort()){const x=p.join(d,n),s=fs.lstatSync(x),k=p.relative('/app',x);if(s.isSymbolicLink()){if(!links)throw Error('symlink');o[k]=c.createHash('sha256').update('symlink\0'+fs.readlinkSync(x)).digest('hex');}else if(s.isDirectory())walk(x,links);else if(s.isFile())o[k]=hash(x);else throw Error('special file');}}for(const n of ['dist','dist-server','module-dist'])walk('/app/'+n);walk('/app/node_modules',true);for(const n of ['package.json','package-lock.json'])o[n]=hash('/app/'+n);console.log(JSON.stringify(o));"""

def require(ok, message):
    if not ok: raise RuntimeError(message)

def sha(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def read(file):
    require(not Path(file).is_symlink(), 'JSON symlink rejected')
    return json.loads(Path(file).read_text())
def save(name, value): (ROOT/name).write_text(json.dumps(value, indent=2)+'\n')
def run(args, **kwargs): return subprocess.check_output(args, text=True, **kwargs).strip()
def image(ref): return run(['docker','image','inspect',ref,'--format','{{.Id}}'])
def safe(name):
    p = PurePosixPath(name)
    require(str(p)==name and not p.is_absolute() and '..' not in p.parts and not any(n.startswith('.env') or n in ['data','secrets','.git','.ssh','node_modules'] for n in p.parts), 'Unsafe payload path')
def inventory(folder):
    result = {}
    for p in sorted(folder.rglob('*')):
        require(not p.is_symlink(), 'Inventory symlink rejected')
        if p.is_file(): result[p.relative_to(folder).as_posix()] = sha(p)
    return result
def atomic(source, target):
    require(not target.is_symlink() and not any(p.is_symlink() for p in target.parents), 'Unsafe target')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name+'.'+NAME+'-'+uuid.uuid4().hex)
    with source.open('rb') as inp, temporary.open('xb') as out:
        shutil.copyfileobj(inp,out); os.fchmod(out.fileno(),0o644); out.flush(); os.fsync(out.fileno())
    os.replace(temporary,target)
    fd=os.open(target.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)

def source_inventory():
    files = [LIVE/n for n in ['package.json','package-lock.json','Dockerfile','.dockerignore','index.html','admin.html','tsconfig.json','tsconfig.finance.json','vite.config.ts','vite.admin.config.ts']]
    for n in ['src','server','public','games','scripts']:
        files += list((LIVE/n).rglob('*'))
    selected=[p for p in files if p.is_file() and not p.is_symlink() and not any(n.startswith(('._','.env')) or n in ['data','secrets','node_modules','__pycache__'] for n in p.relative_to(LIVE).parts)]
    raw,normalized={},{}
    for p in selected:
        name=p.relative_to(LIVE).as_posix();data=p.read_bytes();raw[name]=hashlib.sha256(data).hexdigest()
        normalized[name]=hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest() if p.suffix in ['.ts','.js','.mjs','.cjs','.css','.json','.html','.md','.txt','.yaml','.yml'] and b'\r\n' in data else raw[name]
    return raw,normalized

def inspect(name): return json.loads(run(['docker','inspect',name]))[0]
def runtime(ref, running=False):
    args = ['docker','exec',ref] if running else ['docker','run','--rm','--network=none','--read-only','--cpus=.35','--memory=256m','--entrypoint','node',ref]
    return json.loads(run(args+(['node'] if running else [])+['--v8-pool-size=1','-e',PROGRAM]))
def snapshot():
    rows = []
    ids=run(['docker','ps','--no-trunc','-q']).splitlines()
    require(ids,'No running services')
    try: inspected=json.loads(run(['docker','inspect',*ids],stderr=subprocess.PIPE))
    except subprocess.CalledProcessError as error:
        raise RuntimeError('Docker inventory changed or could not be read; retry a fresh snapshot before publication') from error
    for row in inspected:
        labels=row['Config'].get('Labels') or {}
        if row['HostConfig'].get('RestartPolicy',{}).get('Name','no') in ['','no'] and (labels.get('com.docker.compose.oneoff','').lower()=='true' or not labels.get('com.docker.compose.project')): continue
        rows.append(row)
    services={}
    for row in rows:
        config=row['Config']; host=row['HostConfig']
        services[row['Name'].lstrip('/')]={'id':row['Id'],'image':row['Image'],'startedAt':row['State']['StartedAt'],
            'profileSha256':hashlib.sha256(json.dumps({'config':{k:config.get(k) for k in ['User','WorkingDir','Env','Entrypoint','Cmd']},'host':{k:host.get(k) for k in ['CpuShares','NanoCpus','Memory','MemorySwap','MemoryReservation','PidsLimit','ReadonlyRootfs','RestartPolicy','PortBindings','CapAdd','CapDrop','SecurityOpt','Privileged','Ulimits','GroupAdd','Dns','ExtraHosts']},'mounts':sorted([{k:m.get(k) for k in ['Type','Source','Destination','RW','Propagation']} for m in row['Mounts']],key=lambda m:m['Destination']),'networks':sorted(row['NetworkSettings']['Networks'])},sort_keys=True).encode()).hexdigest()}
    game=next(row for row in rows if row['Name']=='/royal-game-1'); prepared=image('royal-game:latest')
    prior=read(ROOT/'before.json') if (ROOT/'before.json').exists() else {}
    built=read(ROOT/'build-result.json') if (ROOT/'build-result.json').exists() else {}
    prepared_program=prior.get('preparedProgram') if prepared==prior.get('preparedImage') else built.get('program') if prepared==built.get('image') else runtime(prepared)
    prepared_config=inspect(prepared)['Config']
    compose=game['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    configuration={str(p):sha(p) for p in [LIVE/'.env',LIVE/'.env.nowpayments-sandbox',*[Path(n) for n in compose]]}
    source,source_lf=source_inventory()
    return {'sourceCommit':prepared_config.get('Labels',{}).get('org.opencontainers.image.revision'), 'source':source,'sourceLF':source_lf,'services':services,'health':game['State'].get('Health',{}).get('Status'),
        'configuration':configuration,'preparedImage':prepared,'preparedProgram':prepared_program,'program':runtime('royal-game-1',True),
        'moduleFiles':inventory(MODULES),'hostContractSha256':sha(STATE/'host.json')}

def stable(now, before):
    require(now==before, 'Production changed since the reviewed snapshot')
    require(now['health']=='healthy' and now['program']==now['preparedProgram'], 'Unhealthy host or unmatched prepared image')
def source_scope(names):
    require(HOST_SOURCES.issubset(names), 'Missing required host update')
    for n in names:
        safe(n)
        require(n in HOST_SOURCES or n.startswith('games/forest-heart/'), 'Foreign source rejected: '+n)
def module_scope(before, after, metadata, pointer_sha):
    folder=GAME+'/versions/'+metadata['version']+'/'
    expected={**before,**{folder+n:h for n,h in metadata['files'].items()},folder+'manifest.json':metadata['_manifestSha256'],GAME+'/active.json':pointer_sha}
    require(after==expected, 'Another module or retained resource changed')
def capacity(extra=0): require(shutil.disk_usage(LIVE).free>MIN_FREE+extra, 'Five GiB disk reserve would be crossed')
def rollback_scope(current,before,source,program):
    require(current['services']==before['services'] and current['configuration']==before['configuration'],'Later services prevent rollback')
    require(current['hostContractSha256']==before['hostContractSha256'],'Later contract prevents rollback')
    require(set(current['source'])==set(before['source']),'Missing or added source prevents rollback')
    require(set(before['program']).issubset(current['program']) and set(current['program']).issubset(program),'Missing or added runtime prevents rollback')
    for n,h in current['source'].items(): require(h in [before['source'].get(n),source.get(n)],'Later source prevents rollback')
    for n,h in current['program'].items(): require(h in [before['program'].get(n),program.get(n)],'Later runtime prevents rollback')

def payload():
    operator=read(ROOT/'operator.json'); release=read(ROOT/'release-manifest.json'); receipt=read(ROOT/'release-github.json'); before=read(ROOT/'before.json')
    require(release['scope']=='application' and release['build']['passed'], 'Expected a complete prepared application')
    require(re.fullmatch(r'[a-f0-9]{40}',release['sourceCommit']), 'Invalid source commit')
    require(release['sourceCommit']==receipt['sourceCommit']==operator['sourceCommit'] and release['baseCommit']==before['sourceCommit'], 'Wrong reviewed source or baseline')
    require(sha(ROOT/'guard.py')==operator['guardSha256'] and sha(ROOT/'publisher.py')==operator['publisherSha256']==before['source']['scripts/game-module-release.py'], 'Installer changed')
    require(sha(ROOT/'release-manifest.json')==operator['releaseManifestSha256'] and sha(ROOT/'release-github.json')==operator['receiptSha256'], 'Release receipt changed')
    source_scope(operator['source'])
    require(inventory(ROOT/'source')==operator['source'] and inventory(ROOT/'dist-delta')==operator['dist'], 'Payload differs')
    require('index.html' in operator['dist'], 'Missing new index')
    for n,h in operator['dist'].items():
        safe(n)
        require(n=='index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)',n), 'Foreign client resource')
        require(release['files'].get('dist/'+n)==h, 'Client differs from prepared release')
        require(n=='index.html' or 'dist/'+n not in before['program'] or before['program']['dist/'+n]==h, 'Immutable client URL collision')
    meta=read(ROOT/'package/manifest.json'); meta['_manifestSha256']=sha(ROOT/'package/manifest.json')
    require(meta['gameId']==GAME and all(meta[k]==v for k,v in CONTRACT.items()), 'Wrong package contract')
    require(read(STATE/'host.json')['games'][GAME]==CONTRACT, 'Incompatible installed host')
    folder='module-dist/'+GAME+'/versions/'+meta['version']+'/'
    require(release['files'].get(folder+'manifest.json')==meta['_manifestSha256'], 'Package manifest differs')
    for n,h in meta['files'].items(): require(release['files'].get(folder+n)==h, 'Package differs from prepared release')
    spec=importlib.util.spec_from_file_location('forest_publisher',ROOT/'publisher.py'); publisher=importlib.util.module_from_spec(spec); spec.loader.exec_module(publisher)
    publisher.verify(ROOT/'package',CONTRACT,GAME)
    require(sha(MODULES/GAME/'active.json')==operator['beforePointerSha256'], 'Stale Forest Heart pointer')
    capacity(sum((ROOT/'dist-delta'/n).stat().st_size for n in operator['dist'])*3+sum((ROOT/'package'/n).stat().st_size for n in meta['files'])*2+12*1024**2)
    return operator,release,before,meta,publisher

def runtime_index(file):
    file.chmod(0o644)
    run(['docker','cp',str(file),'royal-game-1:/app/dist/index.html.forest-next'])
    run(['docker','exec','--user','0','royal-game-1','node','-e',"require('fs').renameSync('/app/dist/index.html.forest-next','/app/dist/index.html')"])
def healthy():
    result=json.loads(run(['docker','exec','royal-game-1','node','-e',"fetch('http://127.0.0.1:2567/healthz').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"]))
    require(result.get('ok') is True, 'Host health check failed')

def publish():
    op,release,before,meta,publisher=payload(); stable(snapshot(),before)
    require(not BACKUP.exists() and not (ROOT/'published.json').exists(), 'Release already attempted')
    BACKUP.mkdir(mode=0o700)
    pointer=MODULES/GAME/'active.json'; old_pointer=read(pointer); old_version=old_pointer['manifest'].split('/')[4]
    publisher.verify(MODULES/GAME/'versions'/old_version,CONTRACT,GAME)
    with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
        for n in op['source']:
            require(n in before['source'] and sha(LIVE/n)==before['source'][n], 'Source changed before backup')
            archive.add(LIVE/n,arcname=n,recursive=False)
        archive.add(pointer,arcname='active.json',recursive=False)
        archive.add(STATE/'host.json',arcname='host.json',recursive=False)
    (BACKUP/'source.tgz').chmod(0o600)
    with tarfile.open(BACKUP/'source.tgz') as archive:
        expected={n:before['source'][n] for n in op['source']}; expected.update({'active.json':sha(pointer),'host.json':before['hostContractSha256']})
        require({m.name:hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers() if m.isfile()}==expected,'Backup verification failed')
    run(['docker','cp','royal-game-1:/app/dist/index.html',str(BACKUP/'index.html')])
    require(sha(BACKUP/'index.html')==before['program']['dist/index.html'], 'Index backup differs')
    for suffix,ref in [('',before['services']['royal-game-1']['image']),('-prepared',before['preparedImage'])]: run(['docker','tag',ref,'royal-game:before-'+NAME+suffix])
    save('backup.json',{'archive':str(BACKUP/'source.tgz'),'bytes':(BACKUP/'source.tgz').stat().st_size,'sha256':sha(BACKUP/'source.tgz'),'oldVersion':old_version,'previousImagesTagged':True})
    context=ROOT/'runtime-context'; context.mkdir(); shutil.copytree(ROOT/'dist-delta',context/'dist-delta',copy_function=os.link)
    (context/'Dockerfile').write_text('FROM '+before['preparedImage']+'\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="'+release['sourceCommit']+'"\n')
    (context/'.dockerignore').write_text('**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n')
    with (ROOT/'build.log').open('w') as log: subprocess.run(['docker','build','--pull=false','--network=none','-t','royal-game:'+NAME,'.'],cwd=context,check=True,stdout=log,stderr=subprocess.STDOUT)
    candidate=image('royal-game:'+NAME); expected_program={**before['program'],**{'dist/'+n:h for n,h in op['dist'].items()}}
    require(runtime(candidate)==expected_program,'Candidate changed protected runtime bytes')
    parent,child=[inspect(n) for n in [before['preparedImage'],candidate]]
    require(child['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==release['sourceCommit'],'Candidate revision differs')
    for k in ['User','WorkingDir','Env','Entrypoint','Cmd','ExposedPorts','Healthcheck','Volumes']: require(parent['Config'].get(k)==child['Config'].get(k),'Image configuration changed')
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])]==parent['RootFS']['Layers'],'Parent layers changed')
    save('build-result.json',{'image':candidate,'program':expected_program,'sourceCommit':release['sourceCommit']})
    stable(snapshot(),before); capacity(12*1024**2)
    started=False
    try:
        started=True
        assets=ROOT/'assets'; assets.mkdir()
        for n in op['dist']:
            if n=='index.html': continue
            target=assets/n; target.parent.mkdir(parents=True,exist_ok=True); os.link(ROOT/'dist-delta'/n,target)
        for p in [assets,*assets.rglob('*')]: p.chmod(0o755 if p.is_dir() else 0o644)
        run(['docker','cp',str(assets)+'/.','royal-game-1:/app/dist/'])
        for n in op['source']: atomic(ROOT/'source'/n,LIVE/n)
        for n in op['dist']:
            if n!='index.html': atomic(ROOT/'dist-delta'/n,LIVE/'dist'/n)
        previous=os.umask(0o022)
        try: result=publisher.run(SimpleNamespace(operation='install',package=str(ROOT/'package'),game=GAME,root=str(MODULES),state=str(STATE),expected_sha=op['beforePointerSha256']))
        finally: os.umask(previous)
        runtime_index(ROOT/'dist-delta/index.html'); atomic(ROOT/'dist-delta/index.html',LIVE/'dist/index.html'); run(['docker','tag',candidate,'royal-game:latest'])
        healthy(); after=snapshot()
        require(after['health']=='healthy','Published host is not healthy')
        require(after['services']==before['services'] and after['configuration']==before['configuration'],'Services or private configuration changed')
        require(after['hostContractSha256']==before['hostContractSha256'],'Host contract changed')
        require(after['source']=={**before['source'],**op['source']},'Unrelated source changed')
        require(after['program']==after['preparedProgram']==expected_program and after['preparedImage']==candidate,'Published runtime differs')
        pointer_sha=sha(pointer); require(pointer_sha==release['files']['module-dist/'+GAME+'/active.json'],'Installed pointer differs')
        module_scope(before['moduleFiles'],after['moduleFiles'],meta,pointer_sha); capacity()
        save('after.json',after)
        record={'release':NAME,'published':True,'sourceCommit':release['sourceCommit'],'baseCommit':release['baseCommit'],'moduleVersion':meta['version'],'manifestSha256':meta['_manifestSha256'],'preparedImage':candidate,'runningImage':before['services']['royal-game-1']['image'],'hostRestarted':False,'databaseTouched':False,'otherModulesPreserved':True,'otherServicesPreserved':True,'freeBytesAfter':shutil.disk_usage(LIVE).free,'module':result}
        save('published.json',record); print(json.dumps(record),flush=True)
    except BaseException as error:
        import signal
        for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(number,signal.SIG_IGN)
        save('failure.json',{'type':type(error).__name__,'reason':str(error),'publicationStarted':started})
        rollback(op,before,meta,publisher,old_version,candidate,expected_program)
        raise

def rollback(op,before,meta,publisher,old_version,candidate,expected_program):
    current=snapshot()
    rollback_scope(current,before,op['source'],expected_program)
    require(current['preparedImage'] in [before['preparedImage'],candidate],'Later prepared image prevents rollback')
    pointer=MODULES/GAME/'active.json'; value=read(pointer)
    require(sha(pointer) in [op['beforePointerSha256'],op['pointerSha256']],'Later pointer prevents rollback')
    if current['moduleFiles']!=before['moduleFiles']: module_scope(before['moduleFiles'],current['moduleFiles'],meta,sha(pointer))
    if value['manifest'].split('/')[4]==meta['version']:
        publisher.run(SimpleNamespace(operation='rollback',version=old_version,game=GAME,root=str(MODULES),state=str(STATE),expected_sha=sha(pointer)))
    with tarfile.open(BACKUP/'source.tgz') as archive:
        for n in op['source']:
            target=ROOT/'restore'/n; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(archive.extractfile(n).read()); require(sha(target)==before['source'][n],'Rollback source differs'); atomic(target,LIVE/n)
    runtime_index(BACKUP/'index.html'); atomic(BACKUP/'index.html',LIVE/'dist/index.html'); run(['docker','tag',before['preparedImage'],'royal-game:latest']); healthy()
    recovered=snapshot()
    require(recovered['source']==before['source'] and recovered['program']['dist/index.html']==before['program']['dist/index.html'],'Recovered presentation differs')
    require(sha(pointer)==op['beforePointerSha256'],'Recovered pointer differs')
    save('recovered.json',{'restored':True,'databaseTouched':False,'hostRestarted':False,'newImmutableAssetsRetained':True})

def main():
    import fcntl
    import signal
    require(Path(__file__).resolve()==ROOT/'guard.py','Unexpected installer root')
    for p in [ROOT,LIVE,MODULES,STATE]: require(p.is_dir() and not any(n.is_symlink() for n in [p,*p.parents]),'Unsafe root')
    require(len(sys.argv)==2 and sys.argv[1] in ['snapshot','publish'],'Unexpected operation')
    locks=[]
    for p in [Path('/opt/royal-releases/themed-publish.lock'),LIVE/'.client-presentation-deploy.lock',STATE/'module.lock']:
        require(not p.is_symlink(),'Unsafe publication lock'); h=p.open('a'); fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB); locks.append(h)
    def interrupted(number, _frame): raise InterruptedError('Publication interrupted: '+str(number))
    for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(number,interrupted)
    if sys.argv[1]=='snapshot':
        require(not (ROOT/'before.json').exists(),'Snapshot already recorded'); before=snapshot(); stable(before,before); save('before.json',before)
        print(json.dumps({'snapshot':True,'sourceCommit':before['sourceCommit'],'preparedImage':before['preparedImage'],'files':len(before['program']),'freeBytes':shutil.disk_usage(LIVE).free}),flush=True)
    else: publish()

if __name__=='__main__': main()
