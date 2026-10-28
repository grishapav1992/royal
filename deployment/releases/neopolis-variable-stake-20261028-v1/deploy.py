"""Publish compatible Neopolis v4 finance, host and module without restoring player data."""
from pathlib import Path, PurePosixPath
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from snapshot import snapshot, inspect, profile, PROGRAM
from financial_gate import FinancialGate

ROOT=Path(__file__).resolve().parent
LIVE=Path('/opt/royal'); FINANCE=Path('/opt/royal-finance'); STATE=Path('/opt/royal-game-modules-state')
NAME='neopolis-variable-stake-20261028-v1'; BACKUP=Path('/opt/royal-backups')/NAME
M=json.loads((ROOT/'install-manifest.json').read_text()); OLD=M['before']; SCOPE=json.loads((ROOT/'scope.json').read_text())
MIN_FREE=5*1024**3
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def run(args,**kwargs): return subprocess.check_output(args,text=True,**kwargs).strip()
def save(name,value): (ROOT/name).write_text(json.dumps(value,indent=2)+'\n')
def digests(rows): return {name:row['sha256'] for name,row in rows.items()}
def image(ref): return run(['docker','image','inspect',ref,'--format','{{.Id}}'])
def compose(name):
    files=OLD['containers']['royal-game-1' if name=='game' else 'royal-nile-play']['composeFiles']
    return ['docker','compose',*[value for file in files for value in ['-f',file]]]
def plain(name):
    p=PurePosixPath(name)
    assert str(p)==name and not p.is_absolute() and '..' not in p.parts and not any(part.startswith('.env') or part in ['secrets','data','.git','.ssh','node_modules'] for part in p.parts)
def atomic(source,target):
    assert not target.is_symlink() and not any(p.is_symlink() for p in target.parents)
    target.parent.mkdir(parents=True,exist_ok=True); temporary=target.with_name(target.name+'.neopolis-v4-partial');assert not temporary.exists()
    shutil.copyfile(source,temporary);os.replace(temporary,target)
def capacity(extra=0): assert shutil.disk_usage(LIVE).free>MIN_FREE+8*1024**2+extra

def validate_scope(manifest,scope):
    assert manifest['release']==NAME and scope['release']==NAME
    assert manifest['baseCommit']==scope['base'] and len(manifest['sourceCommit'])==40
    assert set(manifest['source']).issubset(scope['allowedSource']) and set(manifest['financeSource']).issubset(scope['allowedSource'])
    assert set(manifest['backend'])=={'index.js'}
    assert all(name=='host-contracts.json' or name.startswith('studio-neopolis/') for name in manifest['modules'])
    for name in [*manifest['source'],*manifest['financeSource'],*manifest['modules'],*manifest['dist']]:plain(name)

def check_contract(old,new):
    assert set(new['games'])==set(old['games'])
    for game,contract in old['games'].items():assert new['games'][game]==({'apiVersion':1,'rulesVersion':4,'progressVersion':4} if game=='studio-neopolis' else contract),game

def payload():
    assert ROOT==Path('/opt/royal-releases')/NAME
    validate_scope(M,SCOPE)
    for name,digest in M['payload'].items(): plain(name);assert sha(ROOT/name)==digest,name
    assert sha(ROOT/'deploy.py')==M['helperSha256']
    assert M['modulePackage']['gameId']=='studio-neopolis'
    old=json.loads((BACKUP/'host.json').read_text()) if (BACKUP/'host.json').exists() else json.loads((STATE/'host.json').read_text())
    new=json.loads((ROOT/'host.json').read_text());check_contract(old,new)
    capacity()

def stable(now,*,finance=False,host=False,module=False):
    assert now['configuration']==OLD['configuration'],'Configuration changed'
    assert digests(now['source'])=={**digests(OLD['source']),**(M['source'] if host else {})},'Application source changed'
    assert digests(now['financeSource'])=={**digests(OLD['financeSource']),**(M['financeSource'] if finance else {})},'Finance source changed'
    assert set(now['containers'])==set(OLD['containers']),'Persistent services changed'
    built=json.loads((ROOT/'build-result.json').read_text()) if (ROOT/'build-result.json').exists() else {}
    for name,old in OLD['containers'].items():
        current=now['containers'][name]
        changed=(name=='royal-nile-play' and finance) or (name=='royal-game-1' and host)
        if not changed:assert (current['id'],current['image'],current['startedAt'])==(old['id'],old['image'],old['startedAt']),name
        else:
            assert current['image']==built['finance' if name=='royal-nile-play' else 'game'],name
        if 'profile' in old: assert current['profile']==old['profile'],name
    expected_finance={**OLD['financialProgram'],**({'play.js':M['financial']} if finance else {})}
    assert now['financialProgram']==expected_finance,'Financial programs changed'
    if now['program'] is not None:
        expected=built['program'] if host else OLD['program']
        assert now['program']==expected and now['preparedProgram']==expected,'Application runtime changed'
    assert now['preparedImage']==(built['game'] if host else OLD['preparedImage'])
    if not module:
        assert now['modules']==OLD['modules'] and now['hostContract']==OLD['hostContract'],'External module state changed'
    else:
        metadata=json.loads((ROOT/'neopolis-package/manifest.json').read_text());base='/opt/royal-game-modules/studio-neopolis/versions/'+metadata['version']+'/'
        expected={**OLD['modules'],**{base+file:sha(ROOT/'neopolis-package'/file) for file in ['manifest.json',*metadata['files']]}}
        expected['/opt/royal-game-modules/studio-neopolis/active.json']=sha('/opt/royal-game-modules/studio-neopolis/active.json')
        assert now['modules']==expected and now['hostContract']==M['hostContract'],'Other modules changed'
        pointer=json.loads(Path('/opt/royal-game-modules/studio-neopolis/active.json').read_text())
        assert pointer['sha256']==M['modulePackage']['manifestSha256']
    capacity()

def verify_archive(file,expected):
    with tarfile.open(file) as archive:
        members=archive.getmembers();assert all(member.isfile() for member in members)
        actual={member.name:hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in members}
        assert len(actual)==len(members) and actual==expected

def backup():
    if BACKUP.exists():
        copies=json.loads((ROOT/'backup.json').read_text())
        for file,row in copies.items():assert sha(BACKUP/file)==row['sha256'] and (BACKUP/file).stat().st_size==row['bytes']
        verify_archive(BACKUP/'source.tgz',digests(OLD['source']));verify_archive(BACKUP/'financial-source.tgz',digests(OLD['financeSource']))
        assert image('royal-game:before-'+NAME)==OLD['containers']['royal-game-1']['image']
        assert image('royal-game:before-'+NAME+'-prepared')==OLD['preparedImage']
        assert image('royal-nile-play:before-'+NAME)==OLD['containers']['royal-nile-play']['image']
        return copies
    BACKUP.mkdir(mode=0o700,exist_ok=False)
    for folder,rows,name in [(LIVE,OLD['source'],'source.tgz'),(FINANCE,OLD['financeSource'],'financial-source.tgz')]:
        with tarfile.open(BACKUP/name,'w:gz') as archive:
            for file,row in rows.items():
                assert not (folder/file).is_symlink() and sha(folder/file)==row['sha256'];capacity((folder/file).stat().st_size)
                archive.add(folder/file,arcname=file,recursive=False)
        verify_archive(BACKUP/name,digests(rows))
    shutil.copyfile(STATE/'host.json',BACKUP/'host.json')
    shutil.copyfile('/opt/royal-game-modules/studio-neopolis/active.json',BACKUP/'neopolis-active.json')
    for file in OLD['configuration']:
        target=BACKUP/'configuration'/file.lstrip('/');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
    for suffix,ref in [('',OLD['containers']['royal-game-1']['image']),('-prepared',OLD['preparedImage'])]: run(['docker','tag',ref,'royal-game:before-'+NAME+suffix])
    run(['docker','tag',OLD['containers']['royal-nile-play']['image'],'royal-nile-play:before-'+NAME])
    with (BACKUP/'nile-play.dump').open('xb') as output:
        process=subprocess.Popen(['docker','exec','royal-finance-sim-finance-db-1','sh','-ec','export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_nile_play'],stdout=subprocess.PIPE)
        try:
            while chunk:=process.stdout.read(1024**2): capacity(len(chunk));output.write(chunk)
            assert process.wait()==0
        finally:
            if process.poll() is None:process.terminate();process.wait(timeout=10)
    with (BACKUP/'nile-play.dump').open('rb') as saved:
        listing=run(['docker','exec','-i','royal-finance-sim-finance-db-1','pg_restore','--list'],stdin=saved)
    entries=len([line for line in listing.splitlines() if line and not line.startswith(';')]);assert entries>0
    record={file:{'bytes':(BACKUP/file).stat().st_size,'sha256':sha(BACKUP/file)} for file in ['source.tgz','financial-source.tgz','nile-play.dump']}
    record['nile-play.dump']['archiveEntries']=entries
    save('backup.json',record);capacity();return record

def build():
    payload();before=snapshot();stable(before);assert before['sourceRevision']==M['baseCommit'];assert before['program']==before['preparedProgram']
    assert before['containers']['royal-game-1']['health']=='healthy';copies=backup()
    for kind in ['game','finance']:
        context=ROOT/(kind+'-context');context.mkdir(exist_ok=False)
        if kind=='game':
            for name in ['dist','module-dist','backend']:shutil.copytree(ROOT/name,context/name,copy_function=os.link)
            text='FROM royal-game:before-'+NAME+'-prepared\nCOPY --chown=node:node dist/ /app/dist/\nCOPY --chown=node:node module-dist/ /app/module-dist/\nCOPY --chown=node:node backend/ /app/dist-server/\n'
        else:
            shutil.copyfile(ROOT/'play.js',context/'play.js');text='FROM royal-nile-play:before-'+NAME+'\nCOPY --chown=node:node play.js /app/play.js\n'
        text+='LABEL org.opencontainers.image.revision="'+M['sourceCommit']+'"\n';(context/'Dockerfile').write_text(text)
        tag=('royal-game:' if kind=='game' else 'royal-nile-play:')+NAME
        with (ROOT/(kind+'-build.log')).open('w') as log: subprocess.run(['docker','build','--pull=false','-t',tag,'.'],cwd=context,stdout=log,stderr=subprocess.STDOUT,check=True)
        capacity()
    game=image('royal-game:'+NAME);finance=image('royal-nile-play:'+NAME)
    expected={**OLD['program'],**{'dist/'+k:v for k,v in M['dist'].items()},**{'module-dist/'+k:v for k,v in M['modules'].items()},**{'dist-server/'+k:v for k,v in M['backend'].items()}}
    actual=json.loads(run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',game,'--v8-pool-size=1','-e',PROGRAM]));assert actual==expected,'Candidate host runtime differs'
    for base,candidate in [(OLD['preparedImage'],game),(OLD['containers']['royal-nile-play']['image'],finance)]:
        parent,child=json.loads(run(['docker','image','inspect',base,candidate]));assert child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])]==parent['RootFS']['Layers']
        for field in ['User','WorkingDir','Env','Entrypoint','Cmd','ExposedPorts','Healthcheck','Volumes']:assert child['Config'].get(field)==parent['Config'].get(field),field
        assert child['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==M['sourceCommit']
    run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',finance,'--v8-pool-size=1','-e',"import('/app/play.js').then(()=>process.exit(1)).catch(e=>{if(e.message!=='test_scope_required')process.exit(1)})"])
    result={'game':game,'finance':finance,'program':expected,'sourceCommit':M['sourceCommit'],'backups':copies};save('build-result.json',result)
    stable(snapshot());return result

def wait_health(name,seconds=240):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if inspect(name)['State'].get('Health',{}).get('Status')=='healthy':return
        time.sleep(3)
    raise RuntimeError('Service did not become healthy: '+name)
def finance_health():
    r=json.loads(run(['docker','exec','-e','UV_THREADPOOL_SIZE=1','royal-nile-play','node','--v8-pool-size=1','play.js','health']))
    assert r.get('ok') and r.get('ready') and r.get('testOnly');return {'ok':True,'ready':True,'testOnly':True,'at':time.time()}

def install_public_module(publisher,args):
    previous=os.umask(0o022)
    try:return publisher.run(args)
    finally:os.umask(previous)

def publish():
    payload();built=json.loads((ROOT/'build-result.json').read_text());stable(snapshot())
    phase='finance'
    try:
        run(['docker','tag',built['finance'],'royal-nile-play:local'])
        audit=json.loads(run([*compose('nile-play'),'run','-T','--rm','--no-deps','--entrypoint','node','nile-play','play.js','audit'],cwd=FINANCE));assert audit.get('ok') and audit.get('testOnly')
        for file in M['financeSource']:atomic(ROOT/'finance-source'/file,FINANCE/file)
        run([*compose('nile-play'),'up','-d','--no-deps','--no-build','--force-recreate','nile-play'],cwd=FINANCE)
        wait_health('royal-nile-play');samples=[]
        for i in range(3):samples.append(finance_health());time.sleep(10 if i<2 else 0)
        save('finance-published.json',{'image':built['finance'],'samples':samples,'sourceCommit':M['sourceCommit']});stable(snapshot(include_program=False),finance=True)
        phase='host';gate=FinancialGate([*compose('game'),'run','--rm','--no-deps','-T','--entrypoint','node','game','-e',(ROOT/'quiesce.cjs').read_text()],cwd=LIVE,log_path=ROOT/'financial-gate.log',min_free_bytes=MIN_FREE,disk_paths=(LIVE,ROOT,BACKUP))
        try:
            gate.acquire();gate.confirm()
            for file in M['source']:gate.check();atomic(ROOT/'source'/file,LIVE/file)
            gate.run(['docker','tag',built['game'],'royal-game:latest']);gate.run([*compose('game'),'up','-d','--no-deps','--no-build','--force-recreate','game'],cwd=LIVE);gate.release()
        finally:gate.close()
        wait_health('royal-game-1');stable(snapshot(),finance=True,host=True)
        phase='module';assert inspect('royal-game-1')['Image']==built['game'];assert sha(STATE/'host.json')==OLD['hostContract']
        atomic(ROOT/'host.json',STATE/'host.json')
        spec=importlib.util.spec_from_file_location('reviewed_module_publisher',ROOT/'game-module-release.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        args=argparse.Namespace(operation='install',package=str(ROOT/'neopolis-package'),version=None,game='studio-neopolis',expected_sha=M['modulePackage']['beforeSha256'],root='/opt/royal-game-modules',state=str(STATE),app_lock=str(LIVE/'.client-presentation-deploy.lock'))
        published=install_public_module(module,args);assert published['published'];save('module-published.json',published)
        after=snapshot();stable(after,finance=True,host=True,module=True)
        for directory in ['dist','backend','module-dist']:
            target=LIVE/('dist-server' if directory=='backend' else directory);shutil.copytree(ROOT/directory,target,dirs_exist_ok=True)
        result={'published':True,'sourceCommit':M['sourceCommit'],'baseCommit':M['baseCommit'],'images':{'game':built['game'],'finance':built['finance']},'module':published,'configurationPreserved':True,'playerDatabaseRestored':False,'oldModulesRetained':True,'otherServicesRetained':True,'financialHealth':samples[-1],'backups':built['backups']};save('published.json',result);save('after.json',after);return result
    except BaseException as error:
        save('failure.json',{'phase':phase,'reason':str(error),'financeMustRetainV4IfAnyV4RoundWasAccepted':True,'databaseMustNotBeRestored':True});raise

if __name__=='__main__':
    assert len(sys.argv)==2 and sys.argv[1] in ['check','build','publish','release'];payload()
    locks=[]
    for file in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        p=Path(file);assert not p.is_symlink();handle=p.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
    if sys.argv[1]=='check':stable(snapshot());print(json.dumps({'ready':True}))
    elif sys.argv[1]=='release':print(json.dumps(build()),flush=True);print(json.dumps(publish()),flush=True)
    else:print(json.dumps(globals()[sys.argv[1]]()),flush=True)
