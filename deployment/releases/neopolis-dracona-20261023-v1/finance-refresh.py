"""Publish the source refresh scheduler while preserving host, ledger and configuration."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from snapshot import snapshot, inspect, profile
M=json.loads((ROOT/'manifest.json').read_text())
LIVE=Path('/opt/royal'); FINANCE=Path('/opt/royal-finance')
BACKUP=Path('/opt/royal-backups/neopolis-source-refresh-20261023-v1')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
canonical=lambda p:hashlib.sha256(Path(p).read_bytes().replace(b'\r\n',b'\n')).hexdigest()
run=lambda args,**kw:subprocess.check_output(args,text=True,**kw).strip()
def save(name,data): (ROOT/name).write_text(json.dumps(data,indent=2)+'\n')
def atomic(source,target):
    assert not target.is_symlink()
    target.parent.mkdir(parents=True,exist_ok=True)
    partial=target.with_name(target.name+'.refresh-partial');assert not partial.exists()
    shutil.copyfile(source,partial);os.replace(partial,target)
def configs(state):
    return {**state['configuration'],**{str(p):sha(p) for p in [LIVE/'compose.finance.yaml',FINANCE/'compose.finance.yaml']}}
def digests(rows):return {name:row['sha256'] for name,row in rows.items()}
def health():
    return json.loads(run(['docker','exec','-e','UV_THREADPOOL_SIZE=1','royal-nile-play','node','--v8-pool-size=1','play.js','health']))

with open('/opt/royal-releases/themed-publish.lock','a+') as app,open('/opt/royal-game-modules-state/module.lock','a+') as modules:
    fcntl.flock(app,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(modules,fcntl.LOCK_EX|fcntl.LOCK_NB)
    phase='guard'
    try:
        for name,digest in M['payload'].items():assert sha(ROOT/name)==digest,name
        before=snapshot();settings=configs(before)
        assert before['containers']['royal-nile-play']['image']==M['baseFinancialImage']
        assert before['containers']['royal-game-1']['image']==M['gameImage']
        assert before['containers']['royal-game-1']['health']=='healthy'
        for name,digest in M['inputs'].items():
            if name in M['source']:continue
            assert canonical(LIVE/name)==digest,'Financial dependency differs: '+name
            assert canonical(FINANCE/name)==digest,'Financial dependency differs: '+name
        # Ignore explicit one-shot diagnostics when checking persistent services.
        stable={name:row for name,row in before['containers'].items() if inspect(name)['HostConfig']['RestartPolicy']['Name'] in ['always','unless-stopped']}
        database_profile=profile(inspect('royal-finance-sim-finance-db-1'))
        phase='backup';BACKUP.mkdir(mode=0o700,exist_ok=False)
        save('before.json',before)
        with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
            for label,folder in [('game',LIVE),('finance',FINANCE)]:
                for name in M['source']:
                    if (folder/name).is_file():archive.add(folder/name,arcname=label+'/'+name,recursive=False)
        run(['docker','tag',M['baseFinancialImage'],'royal-nile-play:before-neopolis-source-refresh-20261023-v1'])
        with (BACKUP/'nile-play.dump').open('wb') as output:
            subprocess.run(['docker','exec','royal-finance-sim-finance-db-1','sh','-ec',
                'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_nile_play'],stdout=output,check=True)
        phase='build';context=ROOT/'context';context.mkdir(exist_ok=False)
        shutil.copyfile(ROOT/'play.js',context/'play.js')
        (context/'Dockerfile').write_text('FROM royal-nile-play:before-neopolis-source-refresh-20261023-v1\nCOPY --chown=node:node play.js /app/play.js\nLABEL org.opencontainers.image.revision="'+M['sourceCommit']+'"\n')
        tag='royal-nile-play:neopolis-source-refresh-20261023-v1'
        with (ROOT/'build.log').open('w') as log:
            subprocess.run(['docker','build','--pull=false','-t',tag,'.'],cwd=context,stdout=log,stderr=subprocess.STDOUT,check=True)
        image=run(['docker','image','inspect',tag,'--format','{{.Id}}'])
        now=snapshot()
        for key in ['source','financeSource','modules','hostContract','program','preparedProgram','preparedImage']:
            assert now[key]==before[key],key
        assert configs(now)==settings
        assert inspect('royal-nile-play')['Id']==before['containers']['royal-nile-play']['id']
        phase='audit';compose=before['containers']['royal-nile-play']['composeFiles']
        command=['docker','compose',*[v for n in compose for v in ['-f',n]]]
        run(['docker','tag',image,'royal-nile-play:local'])
        audit=json.loads(run([*command,'run','-T','--rm','--no-deps','--entrypoint','node','nile-play','play.js','audit'],cwd=FINANCE))
        assert audit['ok'] and audit['testOnly']
        phase='install'
        for name in M['source']:
            atomic(ROOT/'source'/name,LIVE/name);atomic(ROOT/'source'/name,FINANCE/name)
        run([*command,'up','-d','--no-deps','--no-build','--force-recreate','nile-play'],cwd=FINANCE)
        assert profile(inspect('royal-nile-play'))==before['containers']['royal-nile-play']['profile']
        phase='readiness';end=time.monotonic()+300
        while time.monotonic()<end:
            if inspect('royal-nile-play')['State'].get('Health',{}).get('Status')=='healthy':break
            time.sleep(3)
        else:raise RuntimeError('Financial service did not become healthy')
        samples=[]
        for i in range(5):
            result=health();assert result['ok'] and result['ready']
            samples.append({'at':time.time(),'auditOk':True,'ready':True,'sourceAgeSeconds':round(time.time()-result['sourceAt']/1000),'houseReserveFunded':int(result['houseUnits'])>0})
            print(json.dumps({'sample':i+1,**samples[-1]}),flush=True)
            if i<4:time.sleep(30)
        phase='verification';after=snapshot()
        assert after['containers']['royal-nile-play']['image']==image
        for key in ['program','preparedProgram','preparedImage','modules','hostContract']:assert after[key]==before[key],key
        assert configs(after)==settings
        assert profile(inspect('royal-finance-sim-finance-db-1'))==database_profile
        assert digests(after['source'])=={**digests(before['source']),**M['source']}
        assert digests(after['financeSource'])=={**digests(before['financeSource']),**M['source']}
        for name,row in stable.items():
            if name!='royal-nile-play':assert inspect(name)['Id']==row['id'],name
        record={'published':True,'sourceCommit':M['sourceCommit'],'applicationSourceCommit':M['applicationSourceCommit'],
            'financialImage':image,'gameImage':M['gameImage'],'samples':samples,'fullAuditPreserved':True,
            'freshnessThresholdsPreserved':True,'hostAndModulesPreserved':True,'configurationPreserved':True,
            'databaseRestored':False,'sourceBackupSha256':sha(BACKUP/'source.tgz'),'journalBackupSha256':sha(BACKUP/'nile-play.dump')}
        save('verification.json',record);print(json.dumps(record),flush=True)
    except BaseException as error:
        save('failure.json',{'phase':phase,'type':type(error).__name__,'reason':str(error)})
        raise
