"""Publish the reviewed CR vs. Leo overlay, preserving configurations, data and other services."""
from pathlib import Path,PurePosixPath
import datetime,fcntl,hashlib,json,os,shutil,signal,subprocess,sys,tarfile,time

ROOT=Path(__file__).resolve().parent; LIVE=Path('/opt/royal'); NAME='cr-leo-20261021-v1'
BACKUP=Path('/opt/royal-backups')/NAME
COMPOSE=['compose.yaml','compose.override.yaml','compose.payments.yaml','compose.mira.yaml']
M=json.loads((ROOT/'install-manifest.json').read_text())
BASE={r['path']:r['sha256'] for r in M['baseline']}; CHANGES=M['changed']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def require(ok,message):
    if not ok:raise RuntimeError(message)
def run(args,**kwargs):return subprocess.check_output(args,text=True,**kwargs).strip()
def write(name,data):(ROOT/name).write_text(json.dumps(data,indent=2)+'\n')
def snapshot():return json.loads(run(['python3',str(ROOT/'snapshot.py')]))
def image(ref):return run(['docker','image','inspect',ref,'--format','{{.Id}}'])
def compose():return run(['docker','compose',*[v for n in COMPOSE for v in ['-f',n]],'up','-d','--no-deps','--force-recreate','game'],cwd=LIVE)
def sources(s):return {k:v for k,v in s['source'].items() if not k.endswith(('.orig','.bak'))}
def source_guard(s,published=False):require(sources(s)==({**BASE,**CHANGES} if published else BASE),'Source changed since review')
def settings_guard(s):
    old=M['before'];require(s['configHashes']==old['configHashes'],'Production configurations changed')
    for key in ['mounts','host','runtimeHash','composeFiles']:
        current,previous=s['container'][key],old['container'][key]
        if key=='mounts':current,previous=[sorted(rows,key=lambda row:row['Destination']) for rows in [current,previous]]
        require(current==previous,'Runtime settings changed: '+key)
    require({k:v for k,v in s['services'].items() if k!='/royal-game-1'}=={k:v for k,v in old['services'].items() if k!='/royal-game-1'},'Another service changed')
def baseline_guard():
    s=snapshot();source_guard(s);settings_guard(s)
    for key in ['id','image','startedAt','health']:require(s['container'][key]==M['before']['container'][key],'Game changed: '+key)
    require(s['preparedImage']==M['before']['preparedImage'] and s['program']==M['before']['program'],'Runtime or prepared image changed')
    require(s['availableBytes']>2*1024**3,'Insufficient free disk')
    return s
def backup_guard():
    b=M['databaseBackup'];metadata=Path(b['metadataPath']);proof=Path(b['restoreProofPath']);dump=Path(b['dumpPath'])
    require(sha(metadata)==b['metadataSha256'] and sha(proof)==b['restoreProofSha256'],'Backup evidence changed')
    m=json.loads(metadata.read_text());p=json.loads(proof.read_text())
    require(p.get('ok') is True and m.get('data_sha256')==p.get('data_sha256') and m.get('sha256')==sha(dump),'Backup restoration failed')
    age=datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(m['created_at'])
    require(age.total_seconds()<3600,'Backup is stale')
def payload_guard():
    require(ROOT==Path('/opt/royal-releases')/NAME and M['release']==NAME,'Unexpected release directory')
    require(sha(ROOT/'deploy.py')==M['helperSha256'],'Deployment helper changed')
    require(sha(ROOT/'snapshot.py')==M['snapshotSha256'],'Snapshot helper changed')
    for name in [*BASE,*CHANGES,*M['delta']]:
        p=PurePosixPath(name);require(not p.is_absolute() and '..' not in p.parts and not any(x.startswith('.env') for x in p.parts),'Unsafe release path')
    for name,digest in CHANGES.items():require(sha(ROOT/'source'/name)==digest,'Source payload differs: '+name)
    for name,digest in M['delta'].items():require(sha(ROOT/'prebuilt/dist'/name)==digest,'Client payload differs: '+name)
    require(sha(ROOT/'prebuilt/index.js')==M['serverSha256'],'Backend payload differs')
def build():
    old=baseline_guard();backup_guard();payload_guard()
    BACKUP.mkdir(exist_ok=False)
    with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
        for name,digest in BASE.items():
            require(sha(LIVE/name)==digest,'Source changed during backup');archive.add(LIVE/name,arcname=name,recursive=False)
    with tarfile.open(BACKUP/'source.tgz') as archive:
        require({x.name:hashlib.sha256(archive.extractfile(x).read()).hexdigest() for x in archive.getmembers()}==BASE,'Source backup differs')
    (BACKUP/'before.json').write_text(json.dumps({'runningImage':old['container']['image'],'preparedImage':old['preparedImage'],'state':old['container']},indent=2)+'\n')
    run(['docker','tag',old['container']['image'],'royal-game:before-'+NAME])
    run(['docker','tag',old['preparedImage'],'royal-game:before-'+NAME+'-prepared'])
    run(['docker','cp','royal-game-1:/app/dist',str(BACKUP/'dist')])
    context=ROOT/'runtime-context';context.mkdir(exist_ok=False)
    shutil.copytree(ROOT/'prebuilt/dist',context/'dist-delta');shutil.copy2(ROOT/'prebuilt/index.js',context/'index.js')
    (context/'Dockerfile').write_text('FROM '+old['preparedImage']+'\nCOPY --chown=node:node dist-delta/ /app/dist/\nCOPY --chown=node:node index.js /app/dist-server/index.js\n')
    (context/'.dockerignore').write_text('**\n!Dockerfile\n!.dockerignore\n!index.js\n!dist-delta\n!dist-delta/**\n')
    baseline_guard()
    with (ROOT/'build.log').open('w') as log:subprocess.run(['docker','build','--pull=false','-t','royal-game:'+NAME,'.'],cwd=context,check=True,stdout=log,stderr=subprocess.STDOUT)
    candidate=image('royal-game:'+NAME)
    node="const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isDirectory())walk(x);else o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
    files=json.loads(run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',candidate,'-e',node]))
    expected={**old['program'],**{'dist/'+k:v for k,v in M['delta'].items()},'dist-server/index.js':M['serverSha256']}
    require(files==expected,'Candidate runtime differs from reviewed delta')
    parent,child=json.loads(run(['docker','image','inspect',old['preparedImage'],candidate]))
    for key in ['User','WorkingDir','Env','Entrypoint','Cmd','ExposedPorts','Healthcheck','Volumes']:
        require(parent['Config'].get(key)==child['Config'].get(key),'Image configuration changed: '+key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])]==parent['RootFS']['Layers'],'Baseline layers changed')
    result={'image':candidate,'program':expected,'sourceBackup':str(BACKUP/'source.tgz'),'sourceBackupSha256':sha(BACKUP/'source.tgz')}
    write('build-result.json',result);return {'built':True,'image':candidate,'oldAssetsPreserved':True}
def atomic(source,target):
    target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.cr-leo-next')
    require(not tmp.exists(),'Unexpected temporary file');shutil.copy2(source,tmp);tmp.replace(target)
def healthy():
    for _ in range(60):
        s=json.loads(run(['docker','inspect','royal-game-1']))[0]['State']
        if s.get('Health',{}).get('Status')=='healthy':return
        time.sleep(1)
    raise RuntimeError('Game did not become healthy')
def rollback():
    require(image('royal-game:latest') in [M['before']['preparedImage'],json.loads((ROOT/'build-result.json').read_text())['image']],'A later release prevents rollback')
    rounds=int(run(['docker','exec','royal-finance-sim-finance-db-1','psql','-U','finance_schema_owner','-d','royal_finance_sim','-tA','-c',"SELECT COUNT(*) FROM royal_game.demo_casino_sessions WHERE game_id='original-cr-vs-leo'" ]))
    require(rounds==0,'Football rounds exist: preserve the new backend and use a forward repair; do not restore the old backend or database')
    with tarfile.open(BACKUP/'source.tgz') as archive:
        for name in CHANGES:
            require(not (LIVE/name).exists() or sha(LIVE/name) in [CHANGES[name],BASE.get(name)],'Concurrent source prevents rollback')
            if name in BASE:
                target=ROOT/'restore'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.extractfile(name).read());atomic(target,LIVE/name)
            else:(LIVE/name).unlink(missing_ok=True)
    run(['docker','tag',M['before']['preparedImage'],'royal-game:latest']);compose();healthy()
    shutil.copytree(BACKUP/'dist',LIVE/'dist',dirs_exist_ok=True)
    s=snapshot();settings_guard(s);source_guard(s);require(s['program']==M['before']['program'],'Rollback runtime differs')
    write('recovered.json',{'restored':True,'databaseRestored':False})
def publish():
    baseline_guard();backup_guard();payload_guard();built=json.loads((ROOT/'build-result.json').read_text())
    require(image('royal-game:'+NAME)==built['image'],'Candidate image changed')
    try:
        for name in CHANGES:atomic(ROOT/'source'/name,LIVE/name)
        run(['docker','tag',built['image'],'royal-game:latest']);compose();healthy()
        s=snapshot();settings_guard(s);source_guard(s,True)
        require(s['container']['image']==built['image'] and s['program']==built['program'],'Published runtime differs')
        shutil.copytree(ROOT/'prebuilt/dist',LIVE/'dist',dirs_exist_ok=True)
        result={'published':True,'image':built['image'],'databaseRestored':False,'configurationsAndMountsPreserved':True,'otherPersistentServicesPreserved':len(s['services'])-1,'oldAssetsPreserved':True}
        write('published.json',result);write('after.json',s);return result
    except BaseException as error:
        for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]:signal.signal(number,signal.SIG_IGN)
        write('publication-failed.json',{'errorType':type(error).__name__,'reason':str(error),'databaseRestored':False})
        rollback();raise

if __name__=='__main__':
    require(len(sys.argv)==2 and sys.argv[1] in ['check','build','publish','rollback'],'Unexpected operation')
    payload_guard()
    with (LIVE/'.client-presentation-deploy.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        def interrupted(number,_frame):raise InterruptedError('Deployment interrupted: '+str(number))
        for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]:signal.signal(number,interrupted)
        if sys.argv[1]=='check':baseline_guard();backup_guard();print(json.dumps({'ready':True,'sourceFiles':len(CHANGES)}))
        else:print(json.dumps(globals()[sys.argv[1]]()))
