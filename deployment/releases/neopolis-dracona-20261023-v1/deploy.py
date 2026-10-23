"""Publish under both shared locks without replacing configuration or user data."""
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
from snapshot import snapshot, inspect, profile

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
FINANCE = Path('/opt/royal-finance')
MODULES = Path('/opt/royal-game-modules')
HOST = Path('/opt/royal-game-modules-state/host.json')
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
NAME = M['release']
BACKUP = Path('/opt/royal-backups') / NAME
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

def save(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2) + '\n')

def atomic(source, target):
    assert not target.is_symlink()
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + '.neopolis-partial')
    assert not partial.exists()
    shutil.copyfile(source, partial)
    os.replace(partial, target)

def digest_map(rows):
    return {k:v['sha256'] for k,v in rows.items()}

def guard():
    for name, digest in M['payload'].items(): assert sha(ROOT / name) == digest, name
    now = snapshot()
    for key in ['source','financeSource','configuration','modules','hostContract','preparedImage','program','preparedProgram']:
        assert now[key] == OLD[key], 'Production changed: ' + key
    for name, row in OLD['containers'].items():
        assert now['containers'][name]['id'] == row['id'] and now['containers'][name]['image'] == row['image'], name
    assert now['containers']['royal-game-1']['health'] == 'healthy'
    assert now['containers']['royal-nile-play']['health'] == 'healthy'
    health = json.loads(run(['docker','exec','royal-nile-play','node','play.js','health']))
    assert health.get('ready') and health.get('ok'), 'Financial source is not ready'

def backup():
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    for root, rows, name in [(LIVE, OLD['source'], 'source.tgz'), (FINANCE, OLD['financeSource'], 'financial-source.tgz')]:
        with tarfile.open(BACKUP / name, 'w:gz') as archive:
            for path, row in rows.items():
                assert sha(root / path) == row['sha256']
                archive.add(root / path, arcname=path, recursive=False)
        with tarfile.open(BACKUP / name) as archive:
            assert {m.name:hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive if m.isfile()} == digest_map(rows)
    for name in OLD['configuration']:
        target = BACKUP / 'configuration' / name.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(name,target)
    shutil.copyfile(HOST, BACKUP / 'host.json')
    for name in M['pointers']:
        if Path(name).exists():
            target = BACKUP / 'pointers' / Path(name).parent.name / 'active.json'
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(name,target)
    for suffix,image in [('',OLD['containers']['royal-game-1']['image']),('-prepared',OLD['preparedImage'])]:
        run(['docker','tag',image,'royal-game:before-'+NAME+suffix])
    run(['docker','tag',OLD['containers']['royal-nile-play']['image'],'royal-nile-play:before-'+NAME])
    with (BACKUP / 'nile-play.dump').open('wb') as output:
        subprocess.run(['docker','exec','royal-finance-sim-finance-db-1','sh','-ec',
          'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_nile_play'],stdout=output,check=True)
    return {'sourceBackupSha256':sha(BACKUP/'source.tgz'),'financialBackupSha256':sha(BACKUP/'nile-play.dump')}

def build():
    for kind in ['game','financial']:
        context = ROOT / (kind + '-context')
        context.mkdir(exist_ok=False)
        if kind == 'game':
            for name in ['dist','module-dist']: shutil.copytree(ROOT/name,context/name)
            shutil.copyfile(ROOT/'index.js',context/'index.js')
            dockerfile = 'FROM royal-game:before-'+NAME+'-prepared\nCOPY --chown=node:node dist/ /app/dist/\nCOPY --chown=node:node module-dist/ /app/module-dist/\nCOPY --chown=node:node index.js /app/dist-server/index.js\n'
        else:
            shutil.copyfile(ROOT/'play.js',context/'play.js')
            dockerfile = 'FROM royal-nile-play:before-'+NAME+'\nCOPY --chown=node:node play.js /app/play.js\n'
        (context/'Dockerfile').write_text(dockerfile+'LABEL org.opencontainers.image.revision="'+M['sourceCommit']+'"\n')
        tag = ('royal-game:' if kind=='game' else 'royal-nile-play:')+NAME
        with (ROOT/(kind+'-build.log')).open('w') as log:
            subprocess.run(['docker','build','--pull=false','-t',tag,'.'],cwd=context,stdout=log,stderr=subprocess.STDOUT,check=True)
    images = {'game':run(['docker','image','inspect','royal-game:'+NAME,'--format','{{.Id}}']),
              'financial':run(['docker','image','inspect','royal-nile-play:'+NAME,'--format','{{.Id}}'])}
    # Import graph and runtime dependencies are checked in the actual isolated financial image.
    run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',images['financial'],'-e',
         "import('/app/play.js').then(()=>process.exit(1)).catch(e=>{if(e.message!=='test_scope_required')process.exit(1)})"])
    save('build-result.json',images)
    return images

def wait_health(name, deadline):
    end = time.monotonic()+deadline
    while time.monotonic()<end:
        if inspect(name)['State'].get('Health',{}).get('Status')=='healthy': return
        time.sleep(3)
    raise RuntimeError(name+' did not become healthy')

def publish():
    phase='guard'
    try:
        guard()
        phase='backup'; copies=backup(); save('backup.json',copies)
        phase='build'; images=build()
        # A second guard after the build ensures outside publishers respected the locks.
        guard()
        phase='finance'
        for name in M['financeSource']: atomic(ROOT/'finance-source'/name,FINANCE/name)
        run(['docker','tag',images['financial'],'royal-nile-play:local'])
        nile_compose=OLD['containers']['royal-nile-play']['composeFiles']
        audit=json.loads(run(['docker','compose',*[v for n in nile_compose for v in ['-f',n]],'run','-T','--rm','--no-deps','--entrypoint','node','nile-play','play.js','audit'],cwd=FINANCE))
        assert audit.get('ok') and audit.get('testOnly'), 'Candidate journal audit failed'
        save('candidate-audit.json',{'ok':True,'testOnly':True,'image':images['financial']})
        run(['docker','compose',*[v for n in nile_compose for v in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate','nile-play'],cwd=FINANCE)
        wait_health('royal-nile-play',180)
        assert profile(inspect('royal-nile-play'))==OLD['containers']['royal-nile-play']['profile'], 'Financial isolation changed'
        health=json.loads(run(['docker','exec','royal-nile-play','node','play.js','health']))
        assert health.get('ok') and health.get('ready'), 'Financial audit/readiness failed'
        save('finance-verification.json',{'ok':True,'ready':True,'image':images['financial']})
        phase='host'
        for name in M['source']: atomic(ROOT/'source'/name,LIVE/name)
        old_contract=json.loads(HOST.read_text()); new_contract=json.loads((ROOT/'host.json').read_text())
        for game,contract in old_contract['games'].items():
            expected={'apiVersion':1,'rulesVersion':3,'progressVersion':3} if game=='studio-neopolis' else {'apiVersion':1,'rulesVersion':3,'progressVersion':2} if game=='studio-dracona' else contract
            assert new_contract['games'].get(game)==expected, game
        for source in (ROOT/'external').rglob('*'):
            if source.is_file() and source.name!='active.json':
                target=MODULES/source.relative_to(ROOT/'external')
                if target.exists(): assert sha(target)==sha(source),'Immutable module collision'
                else: atomic(source,target)
        atomic(ROOT/'host.json',HOST)
        for name in M['pointers']: atomic(ROOT/'external'/Path(name).parent.name/'active.json',Path(name))
        run(['docker','tag',images['game'],'royal-game:latest'])
        compose=OLD['containers']['royal-game-1']['composeFiles']
        run(['docker','compose',*[v for n in compose for v in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate','game'],cwd=LIVE)
        wait_health('royal-game-1',120)
        phase='verification'; after=snapshot()
        assert after['containers']['royal-game-1']['image']==images['game']
        assert after['containers']['royal-nile-play']['image']==images['financial']
        for name in ['royal-game-1','royal-nile-play']:
            assert after['containers'][name]['profile']==OLD['containers'][name]['profile'],name
        assert after['configuration']==OLD['configuration']
        assert digest_map(after['source'])=={**digest_map(OLD['source']),**M['source']}
        assert digest_map(after['financeSource'])=={**digest_map(OLD['financeSource']),**M['financeSource']}
        for name,digest in OLD['modules'].items(): assert after['modules'].get(name)==M['pointers'].get(name,digest),name
        expected={**OLD['program'],**{'dist/'+k:v for k,v in M['dist'].items()},**{'module-dist/'+k:v for k,v in M['modules'].items()},'dist-server/index.js':M['backend']}
        assert after['program']==expected and after['preparedProgram']==expected, 'Program bytes differ'
        for name,row in OLD['containers'].items():
            if name not in ['royal-game-1','royal-nile-play']:
                assert after['containers'][name]['id']==row['id'] and after['containers'][name]['image']==row['image'],name
        for path in (ROOT/'dist').rglob('*'):
            if path.is_file(): atomic(path,LIVE/'dist'/path.relative_to(ROOT/'dist'))
        save('after.json',after)
        result={'published':True,'sourceCommit':M['sourceCommit'],**images,**copies,'gameDataPreserved':True,
                'configurationPreserved':True,'previousModuleVersionsPreserved':True,'financialAuditOk':True}
        save('verification.json',result); print(json.dumps(result),flush=True)
    except BaseException as error:
        save('failure.json',{'phase':phase,'type':type(error).__name__,'reason':str(error)})
        raise

if __name__=='__main__':
    assert sys.argv[1:] in [['check'],['publish']]
    with open('/opt/royal-releases/themed-publish.lock','a+') as app_lock,open('/opt/royal-game-modules-state/module.lock','a+') as module_lock:
        fcntl.flock(app_lock,fcntl.LOCK_EX|fcntl.LOCK_NB); fcntl.flock(module_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1]=='check': guard(); print('production baseline verified')
        else: publish()
