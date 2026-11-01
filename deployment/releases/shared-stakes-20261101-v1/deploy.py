"""Install one verified shared-stakes release and preserve current financial data."""
from pathlib import Path
import fcntl, hashlib, importlib.util, io, json, os, re, shutil, subprocess, sys, tarfile, time
ROOT=Path(__file__).resolve().parent
NAME='shared-stakes-20261101-v2'
BUILD_TAG=NAME+'-verified'
LIVE=Path('/opt/royal'); MODULES=Path('/opt/royal-game-modules'); STATE=Path('/opt/royal-game-modules-state')
BACKUP=Path('/opt/royal-backups')/NAME
MIN_FREE=5*1024**3

def require(value,message):
    if not value: raise RuntimeError(message)
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def read(path):
    path=Path(path);require(path.is_file() and not path.is_symlink(),'Unsafe JSON file');return json.loads(path.read_text())
def save(name,value):
    target=ROOT/name;temporary=target.with_suffix(target.suffix+'.next');temporary.write_text(json.dumps(value,indent=2)+'\n');os.replace(temporary,target)
def run(args,timeout=600,**kwargs):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE,timeout=timeout,**kwargs).strip()
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def safe(name):require(not Path(name).is_absolute() and all(p not in ['', '.', '..','.git','node_modules','data','secrets'] and not p.startswith('.env') for p in name.split('/')),'Unsafe payload path')
def inventory(folder):
    out={}
    for p in Path(folder).rglob('*'):
        require(not p.is_symlink(),'Unexpected payload symlink')
        if p.is_file():out[p.relative_to(folder).as_posix()]=sha(p)
    return out

def atomic(source,target):
    target=Path(target);require(not target.is_symlink() and not any(p.is_symlink() for p in target.parents),'Unsafe replacement path')
    target.parent.mkdir(parents=True,exist_ok=True);part=target.with_name(target.name+'.'+NAME+'.partial');require(not part.exists(),'Replacement already pending')
    with open(source,'rb') as inp,part.open('xb') as out:shutil.copyfileobj(inp,out);os.fchmod(out.fileno(),0o644);out.flush();os.fsync(out.fileno())
    os.replace(part,target)
def inspect(container):return json.loads(run(['docker','inspect',container]))[0]
def image(reference):return load('stake_image_metadata',ROOT/'image_metadata.py').image(reference)
def tag(source,destination):
    if run(['ctr','--namespace','moby','images','ls','--quiet','name==docker.io/library/'+destination]):
        require(image(source)==image(destination),'Existing backup tag differs');return
    run(['ctr','--namespace','moby','images','tag','docker.io/library/'+source,'docker.io/library/'+destination]);require(image(source)==image(destination),'Image tag differs')
def snapshot():return json.loads(run([sys.executable,str(ROOT/'snapshot.py')],timeout=900))
def stable(s):return {k:v for k,v in s.items() if k not in ['at','availableBytes']}
def program(image_id,script):return load('stake_retention_runtime',ROOT/'retention-runtime.py').verify_program(image_id,script)
def capacity(extra=0):require(shutil.disk_usage(LIVE).free>MIN_FREE+extra,'Five GiB reserve would be crossed')

def manifest():
    m=read(ROOT/'install-manifest.json');require(ROOT==Path('/opt/royal-releases')/NAME and m['release']==NAME,'Wrong release root')
    require(re.fullmatch('[a-f0-9]{40}',m['sourceCommit']) and m['baseCommit']==m['before']['sourceCommit'],'Wrong source baseline')
    require(sha(ROOT/'deploy.py')==m['helperSha256'] and sha(ROOT/'snapshot.py')==m['snapshotSha256'],'Installer changed')
    for n,h in m['payload'].items():safe(n);require((ROOT/n).is_file() and not (ROOT/n).is_symlink() and sha(ROOT/n)==h,'Payload changed: '+n)
    release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json')
    require(sha(ROOT/'release-manifest.json')==m['releaseManifestSha256'] and sha(ROOT/'release-github.json')==m['receiptSha256'],'Release receipt changed')
    require(release['sourceCommit']==receipt['sourceCommit']==m['sourceCommit'] and release['baseCommit']==m['baseCommit'],'Unverified source')
    require(re.fullmatch('[a-f0-9]{40}',receipt['remoteMain']) and release['build']['passed'] and release['clean'],'Missing committed build evidence')
    require(m['before']['program']==m['before']['preparedProgram'] and m['before']['container']['image']==m['before']['preparedImage'],'Inconsistent running baseline')
    require(len(m['packages'])==18 and set(m['packages'])==set(m['activeGames']) and not m['addedGames'] and not m['restoredGames'],'Catalogue expansion rejected')
    for n,h in m['delta'].items():require(release['files'].get('dist/'+n)==h,'Host bytes differ from the verified release')
    require(m['serverDelta']=={'index.js':release['files']['dist-server/index.js']},'Unreviewed backend bytes')
    require(inventory(ROOT/'source')==m['changed'] and inventory(ROOT/'dist-delta')==m['delta'] and inventory(ROOT/'server-delta')==m['serverDelta'],'Delta inventory differs')
    for game,p in m['packages'].items():
        require(inventory(ROOT/'packages'/game)==p['files'],'Package bytes changed')
        require(sha(ROOT/'pointers'/(game+'.json'))==p['pointerSha256'],'Package pointer changed')
    compat=read(ROOT/'production-round-compatibility.json');require(compat['passed'] and compat['legacyCases']==23 and compat['progress3QualifiedStakes']==[10,20,50,100,200,500,1000,2000,5000],'Accepted-round qualification missing')
    native=read(ROOT/'native-build.json');require(native['outputs']==m['nativeOutputs'] and native['outputs']['runtime.mjs']['sha256']==compat['newRuntimeSha256'],'Native qualification bytes differ')
    return m

def baseline(m):
    s=snapshot();require(stable(s)==stable(m['before']),'Production changed after review');require(s['container']['health']=='healthy','Unhealthy baseline');capacity(512*1024**2);return s

def service_facts(name):
    value=inspect(name);env=dict(v.split('=',1) for v in value['Config']['Env']);allowed=['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD_FILE','PGSSLMODE','DATABASE_URL_FILE','PGSSLROOTCERT']
    selected={k:env[k] for k in allowed if env.get(k)};credential=selected.get('PGPASSWORD_FILE') or selected.get('DATABASE_URL_FILE');require(credential,'Database file credentials are required')
    mounted=next((p for p in value['Mounts'] if p['Destination']==credential),None);require(mounted and mounted['Type']=='bind' and Path(mounted['Source']).is_file(),'Credential bind is unavailable')
    labels=value['Config']['Labels'];files=labels['com.docker.compose.project.config_files'].split(',');cwd=labels['com.docker.compose.project.working_dir']
    require(all(Path(n).is_absolute() and n.endswith('.yaml') and Path(n).is_file() for n in files),'Uncertain Compose source')
    return {'container':name,'environment':selected,'credential':{'source':mounted['Source'],'destination':credential},'composeFiles':files,'composeHashes':{n:sha(n) for n in files},'cwd':cwd,'user':value['Config']['User'],'groups':value['HostConfig'].get('GroupAdd') or [],'networks':sorted(value['NetworkSettings']['Networks'])}

def build(m):
    require(not (ROOT/'build-result.json').exists(),'Build result already exists');before=baseline(m)
    native=service_facts('royal-nile-play');game=service_facts('royal-game-1');require(image('royal-nile-play:local')==before['services']['/royal-nile-play']['image'],'Another prepared Native image exists')
    save('service-facts.json',{'native':native,'game':game})
    tag('royal-game:latest','royal-game:before-'+NAME);tag('royal-game:latest','royal-game:before-'+NAME+'-prepared');tag('royal-nile-play:local','royal-nile-play:before-'+NAME)
    if BACKUP.exists():
        backup=read(ROOT/'backup.json')
        require(backup['backup']==str(BACKUP) and backup['databaseBackup']['path']==str(BACKUP/'financial.dump'),'Backup path changed')
        require(sha(BACKUP/'source.tgz')==backup['sourceBackupSha256'] and sha(BACKUP/'financial.dump')==backup['databaseBackup']['sha256'],'Existing backups changed')
        expected={n:h for n,h in before['source'].items() if n in m['changed']}
        with tarfile.open(BACKUP/'source.tgz') as archive:
            members=archive.getmembers();require(len(members)==len(expected) and all(v.isfile() for v in members),'Existing backup scope changed')
            require({v.name:hashlib.sha256(archive.extractfile(v).read()).hexdigest() for v in members}==expected,'Existing source backup differs')
        require(sha(BACKUP/'host.json')==before['moduleHostContract'],'Backup host contract differs')
        for game_id in m['packages']:
            require(sha(BACKUP/game_id/'active.json')==before['moduleFiles'][str(MODULES/game_id/'active.json')],'Backup module pointer differs')
            prior=read(BACKUP/game_id/'active.json');prefix=str(MODULES/game_id/'versions'/prior['manifest'].split('/')[4])+'/'
            require(inventory(BACKUP/game_id/'package')=={n[len(prefix):]:h for n,h in before['moduleFiles'].items() if n.startswith(prefix)},'Backup package differs')
    else:
        BACKUP.mkdir(mode=0o700)
        with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
            for n in m['changed']:
                if n in before['source']:require(sha(LIVE/n)==before['source'][n],'Source changed during backup');archive.add(LIVE/n,arcname=n,recursive=False)
        with tarfile.open(BACKUP/'source.tgz') as archive:require({r.name:hashlib.sha256(archive.extractfile(r).read()).hexdigest() for r in archive.getmembers()}=={n:h for n,h in before['source'].items() if n in m['changed']},'Source backup differs')
        run(['docker','cp','royal-game-1:/app/dist/index.html',str(BACKUP/'index.html')]);require(sha(BACKUP/'index.html')==before['program']['dist/index.html'],'Client backup differs')
        atomic(STATE/'host.json',BACKUP/'host.json')
        for game_id in m['packages']:
            active=read(MODULES/game_id/'active.json');old=active['manifest'].split('/')[4];require('/' not in old,'Unsafe prior module version');(BACKUP/game_id).mkdir()
            atomic(MODULES/game_id/'active.json',BACKUP/game_id/'active.json');shutil.copytree(MODULES/game_id/'versions'/old,BACKUP/game_id/'package',copy_function=os.link)
        command=['docker','exec','royal-finance-sim-finance-db-1','sh','-ec','export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_game --schema=royal_nile_play']
        with (BACKUP/'financial.dump').open('wb') as output:subprocess.run(command,stdout=output,stderr=subprocess.PIPE,check=True,timeout=600)
        (BACKUP/'financial.dump').chmod(0o600);require(0<(BACKUP/'financial.dump').stat().st_size<256*1024**2,'Financial backup budget exceeded')
        with (BACKUP/'financial.dump').open('rb') as inp:listing=run(['docker','exec','-i','royal-finance-sim-finance-db-1','pg_restore','--list'],stdin=inp)
        require('royal_game' in listing and 'royal_nile_play' in listing,'Financial backup is incomplete')
        backup={'sourceBackupSha256':sha(BACKUP/'source.tgz'),'databaseBackup':{'path':str(BACKUP/'financial.dump'),'sha256':sha(BACKUP/'financial.dump'),'bytes':(BACKUP/'financial.dump').stat().st_size},'backup':str(BACKUP)}
        save('backup.json',backup)
    builder=load('stake_engine_build',ROOT/'engine_build.py')
    for parent,repo,mapping in [
        (before['preparedImage'],'royal-game',{**{'dist-delta/'+n:'dist/'+n for n in m['delta']},**{'server-delta/'+n:'dist-server/'+n for n in m['serverDelta']}}),
        (before['services']['/royal-nile-play']['image'],'royal-nile-play',{'native/play.js':'play.js','native/proof.js':'proof.js'})]:
        capacity(64*1024**2)
        committed=builder.build(ROOT,parent,repo,BUILD_TAG,m['sourceCommit'],mapping)
        identity=image(repo+':'+BUILD_TAG);require(committed in [identity,builder.metadata(identity)['configDigest']],'Committed candidate identity differs')
    current=image('royal-game:'+BUILD_TAG);financial=image('royal-nile-play:'+BUILD_TAG);expected={**before['program'],**{'dist/'+n:h for n,h in m['delta'].items()},**{'dist-server/'+n:h for n,h in m['serverDelta'].items()}}
    actual=program(current,(ROOT/'runtime-inventory.cjs').read_text());require(actual==expected,'Candidate changed an unreviewed host byte')
    native_script="const f=require('fs'),c=require('crypto'),o={};for(const n of ['play.js','proof.js','dist-server/card-engine','dist-server/card-engine-v1'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    native_expected={**m['nativeProtectedBefore'],'play.js':m['nativeOutputs']['play.js']['sha256'],'proof.js':m['nativeOutputs']['proof.js']['sha256']};require(program(financial,native_script)==native_expected,'Native bytes differ from qualified output')
    for parent,child in [(before['preparedImage'],current),(before['services']['/royal-nile-play']['image'],financial)]:
        meta=load('stake_engine_metadata',ROOT/'engine_build.py');a=meta.metadata(parent);b=meta.metadata(child)
        for key in ['User','WorkingDir','Env','Entrypoint','Cmd','ExposedPorts','Healthcheck','Volumes']:require(a['Config'].get(key)==b['Config'].get(key),'Image settings changed: '+key)
        require(b['RootFS']['Layers'][:len(a['RootFS']['Layers'])]==a['RootFS']['Layers'],'Parent layers changed')
    baseline(m);result={**backup,'sourceCommit':m['sourceCommit'],'image':current,'nativeImage':financial,'program':actual,'nativeProgram':native_expected};save('build-result.json',result)
    for name in ['game-context','native-context']:
        context=ROOT/name
        if context.exists():
            entries=inventory(context)
            for n,h in entries.items():require(n=='Dockerfile' or m['payload'].get(n)==h,'Unrecognized old build context')
            shutil.rmtree(context)
    return {'built':True,'image':current,'nativeImage':financial}

def gate_command(facts,schema,rollback=False):
    credential=facts['credential'];require(re.fullmatch('[a-zA-Z0-9_:.-]*',facts['user']),'Unsafe image user')
    args=['docker','run','--rm','--name',NAME+'-gate-'+schema,'--network','royal-finance-sim_finance_private','--read-only','--no-healthcheck','--cpus=.25','--memory=128m','--pids-limit=32','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp','-i']
    if facts['user']:args+=['--user',facts['user']]
    for group in facts['groups']:require(re.fullmatch('[a-zA-Z0-9_-]+',str(group)),'Unsafe supplementary group');args+=['--group-add',str(group)]
    args+=['--mount','type=bind,src='+str(ROOT)+',dst=/gate,readonly','--mount','type=bind,src='+credential['source']+',dst='+credential['destination']+',readonly']
    for k,v in {**facts['environment'],'NODE_PATH':'/app/node_modules','ROYAL_STAKE_GATE_SCHEMA':schema,'ROYAL_STAKE_GATE_ROLLBACK':'1' if rollback else '0'}.items():args+=['--env',k+'='+v]
    args+=['royal-game:before-'+NAME if schema=='royal_game' else 'royal-nile-play:before-'+NAME,'node','--v8-pool-size=1','/gate/quiesce.cjs'];return args

def health():
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        a=inspect('royal-game-1');b=inspect('royal-nile-play')
        if all(x['State'].get('Health',{}).get('Status')=='healthy' for x in [a,b]):
            value=json.loads(run(['docker','exec','royal-nile-play','node','play.js','health']));require(value.get('ok') and value.get('ready') and value.get('testOnly'),'Native audit is not ready')
            value=json.loads(run(['docker','exec','royal-game-1','node','-e',"fetch('http://127.0.0.1:2567/healthz').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"]));require(value.get('ok'),'Application health failed');return
        time.sleep(3)
    raise RuntimeError('Application health did not recover; inspect forward recovery before rollback')

def publish(m,rollback=False):
    built=read(ROOT/'build-result.json');require(sha(BACKUP/'source.tgz')==built['sourceBackupSha256'] and sha(BACKUP/'financial.dump')==built['databaseBackup']['sha256'],'Rollback backups changed')
    if not rollback:
        require(not (ROOT/'published.json').exists(),'Already published');baseline(m)
        require(image('royal-nile-play:local')==m['before']['services']['/royal-nile-play']['image'],'Another prepared Native image appeared')
        require(image('royal-game:'+BUILD_TAG)==built['image'] and image('royal-nile-play:'+BUILD_TAG)==built['nativeImage'],'Candidate image tag changed')
    facts=read(ROOT/'service-facts.json');require('royal-finance-sim_finance_private' in facts['game']['networks'] and 'royal-finance-sim_finance_private' in facts['native']['networks'],'Financial network is unavailable')
    for f in facts.values():
        for n,h in f['composeHashes'].items():require(sha(n)==h,'Compose configuration changed')
    require(sha(STATE/'host.json')==(m['hostContractSha256'] if rollback else m['before']['moduleHostContract']),'Host contract changed')
    from dual_gate import DualGate
    host=DualGate(gate_command(facts['game'],'royal_game',rollback),ROOT,ROOT/'host-gate.log',min_free_bytes=MIN_FREE,disk_paths=[LIVE],lease_timeout=600)
    native=DualGate(gate_command(facts['native'],'royal_nile_play',rollback),ROOT,ROOT/'native-gate.log',min_free_bytes=MIN_FREE,disk_paths=[LIVE],lease_timeout=600)
    host.peer=native;native.peer=host;critical=False
    try:
        host.acquire();native.acquire();host.confirm();native.confirm()
        if rollback:
            require(inspect('royal-game-1')['Image']==built['image'] and inspect('royal-nile-play')['Image']==built['nativeImage'],'A later image blocks rollback')
            for n,h in m['changed'].items():require(sha(LIVE/n)==h,'A later source blocks rollback')
            for game,row in m['packages'].items():require(sha(MODULES/game/'active.json')==row['pointerSha256'],'A later module blocks rollback')
            with tarfile.open(BACKUP/'source.tgz') as archive:
                for member in archive.getmembers():
                    safe(member.name);require(member.isfile(),'Unsafe rollback source');target=LIVE/member.name
                    require(not target.is_symlink() and not any(p.is_symlink() for p in target.parents),'Unsafe rollback target')
                    part=target.with_name(target.name+'.rollback.partial');require(not part.exists(),'Rollback replacement pending')
                    with part.open('xb') as output:shutil.copyfileobj(archive.extractfile(member),output);os.fchmod(output.fileno(),0o644);output.flush();os.fsync(output.fileno())
                    os.replace(part,target)
            for n in m['changed']:
                if n not in m['before']['source']:require(sha(LIVE/n)==m['changed'][n],'A later source blocks removal');(LIVE/n).unlink()
            atomic(BACKUP/'host.json',STATE/'host.json')
            for game in m['packages']:
                pointer=read(BACKUP/game/'active.json');version=pointer['manifest'].split('/')[4];destination=MODULES/game/'versions'/version
                if not destination.exists():shutil.copytree(BACKUP/game/'package',destination,copy_function=os.link)
                atomic(BACKUP/game/'active.json',MODULES/game/'active.json')
            native_tag='royal-nile-play:before-'+NAME;game_tag='royal-game:before-'+NAME
        else:
            for n,h in m['changed'].items():
                if n in m['before']['source']:require(sha(LIVE/n)==m['before']['source'][n],'Later source detected')
                else:require(not (LIVE/n).exists(),'A new source appeared')
                atomic(ROOT/'source'/n,LIVE/n)
            atomic(ROOT/'host.json',STATE/'host.json');publisher=load('stake_module_publisher',ROOT/'publisher.py')
            from types import SimpleNamespace
            results=[]
            for game,row in m['packages'].items():
                options=SimpleNamespace(operation='install',package=str(ROOT/'packages'/game),game=game,root=str(MODULES),state=str(STATE),expected_sha=m['before']['moduleFiles'][str(MODULES/game/'active.json')])
                result=publisher.run(options);require(result['verified'] and sha(MODULES/game/'active.json')==row['pointerSha256'],'Published package differs');results.append(result)
            save('module-publication.json',results);native_tag='royal-nile-play:'+BUILD_TAG;game_tag='royal-game:'+BUILD_TAG
        host.run(['ctr','--namespace','moby','images','tag','--force','docker.io/library/'+native_tag,'docker.io/library/royal-nile-play:local']);host.run(['ctr','--namespace','moby','images','tag','--force','docker.io/library/'+game_tag,'docker.io/library/royal-game:latest'])
        for kind,service in [('native','nile-play'),('game','game')]:
            f=facts[kind];args=['docker','compose',*[item for n in f['composeFiles'] for item in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate',service]
            host.confirm();native.confirm();critical=True;host.run(args,cwd=f['cwd'],timeout=180);critical=False
        native.release();host.release()
    except BaseException as error:
        save('recovery-required.json',{'sourceCommit':m['sourceCommit'],'reason':str(error),'daemonOutcomeRequiresInspection':critical or bool(getattr(error,'daemon_outcome_unknown',False)),'automaticSecondComposeRefused':True,'databaseRestored':False});raise
    finally:native.close();host.close()
    health();after=snapshot();expected_source={**m['before']['source'],**m['changed']}
    if rollback:require(after['source']==m['before']['source'] and after['program']==m['before']['program'],'Rollback byte verification failed');save('recovered.json',{'restored':True,'databaseRestored':False});return {'restored':True}
    require(after['source']==expected_source and after['program']==built['program'],'Running source or program differs')
    expected_modules=dict(m['before']['moduleFiles'])
    for game,row in m['packages'].items():
        expected_modules.update({str(MODULES/game/'versions'/row['version']/n):h for n,h in row['files'].items()});expected_modules[str(MODULES/game/'active.json')]=row['pointerSha256']
    require(after['moduleFiles']==expected_modules and after['moduleHostContract']==m['hostContractSha256'],'Other modules or host contract changed')
    for service,row in m['before']['serviceProfiles'].items():
        current=after['serviceProfiles'][service];require(current['profileSha256']==row['profileSha256'],'Service configuration changed')
        if service not in ['royal-game-1','royal-nile-play']:require(current==row,'Protected service changed')
    require(after['protectedPrograms']['royal-nile-play']==built['nativeProgram'],'Running Native program differs');capacity()
    result={'published':True,'sourceCommit':m['sourceCommit'],'runningImage':built['image'],'nativeImage':built['nativeImage'],'gameCount':18,'addedGames':[],'restoredGames':[],'healthOk':True,'financialAuditOk':True,'databaseRestored':False,'freeAfter':after['availableBytes']};save('published.json',result);save('after.json',after);return result

def main():
    require(sys.argv[1:] in [['check'],['build'],['publish'],['rollback']],'Unexpected operation')
    handles=[]
    for p in [Path('/opt/royal-releases/themed-publish.lock'),LIVE/'.client-presentation-deploy.lock',STATE/'module.lock']:
        require(not p.is_symlink(),'Unsafe deployment lock');f=p.open('a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
    m=manifest();operation=sys.argv[1]
    if operation=='check':baseline(m);print(json.dumps({'checked':True,'sourceCommit':m['sourceCommit']}),flush=True)
    elif operation=='build':print(json.dumps(build(m)),flush=True)
    else:print(json.dumps(publish(m,operation=='rollback')),flush=True)
if __name__=='__main__':main()
