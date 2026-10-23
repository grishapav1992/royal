"""Guarded game and Nile release. Never restores a database over newer transactions."""
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

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
HOST = STATE / 'host.json'
NAME = 'pvp-usdt-20261023-v2'
BACKUP = Path('/opt/royal-backups') / NAME
M = json.loads((ROOT / 'install-manifest.json').read_text())
OLD = M['before']
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')

def atomic(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.pvp-partial')
    assert not temporary.exists() and not target.is_symlink()
    shutil.copyfile(source, temporary)
    os.replace(temporary, target)

def inventory(root):
    return {str(p): sha(p) for p in root.rglob('*') if p.is_file() and not p.is_symlink()}

def source_inventory():
    result = {}
    for name in OLD['source']:
        assert (LIVE / name).is_file() and not (LIVE / name).is_symlink(), name
        result[name] = sha(LIVE / name)
    for directory in ['src', 'server', 'public', 'scripts', 'docs', 'games']:
        for p in (LIVE / directory).rglob('*'):
            if p.is_file() and not p.is_symlink() and not any(x.startswith(('.env','._')) or x in ['data','secrets','node_modules','__pycache__','.DS_Store'] for x in p.relative_to(LIVE).parts):
                result[p.relative_to(LIVE).as_posix()] = sha(p)
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]

def financial_profile(row):
    config = row['Config']
    host = dict(row['HostConfig'])
    for key in ['NanoCpus', 'Binds']:
        host.pop(key, None)
    return {'user': config['User'], 'cwd': config['WorkingDir'], 'cmd': config['Cmd'], 'entrypoint': config['Entrypoint'],
            'environmentHash': hashlib.sha256(json.dumps(sorted(v for v in config['Env'] if v!='FINANCE_ADMIN_ACCOUNT_IDS=')).encode()).hexdigest(),
            'hostHash': hashlib.sha256(json.dumps(host, sort_keys=True).encode()).hexdigest(),
            'mounts': sorted(row['Mounts'], key=lambda x:x['Destination'])}

def guard():
    assert OLD['program']==OLD['preparedProgram'], 'Prepared runtime differs from running runtime'
    assert source_inventory() == OLD['source'], 'Production source changed after review'
    assert inventory(MODULES) == OLD['moduleFiles'], 'External modules changed after review'
    assert sha(HOST) == OLD['moduleHostContract'], 'Host compatibility changed'
    for name, digest in OLD['configHashes'].items():
        assert sha(LIVE / name) == digest, 'Production configuration changed: ' + name
    for name, row in M['extra']['files'].items():
        assert sha(name) == row['sha256'], 'Financial configuration changed: ' + name
    for name, row in OLD['services'].items():
        current = inspect(name)
        assert current['Id'] == row['id'] and current['Image'] == row['image'], 'Service changed: ' + name
    assert inspect('royal-game-1')['State']['Health']['Status'] == 'healthy'
    return True

def validate_payload():
    for name, digest in M['payload'].items():
        p = ROOT / name
        assert not p.is_symlink() and p.is_file() and sha(p) == digest, 'Payload differs: ' + name

def backup():
    guard()
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, digest in OLD['source'].items():
            assert sha(LIVE / name) == digest
            archive.add(LIVE / name, arcname=name, recursive=False)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        assert {m.name: hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive if m.isfile()} == OLD['source']
    for name in M['extra']['files']:
        destination = BACKUP / 'configuration' / name.lstrip('/')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(name, destination)
    shutil.copyfile(HOST, BACKUP / 'host.json')
    for name in M['pointers']:
        destination = BACKUP / 'pointers' / Path(name).parent.name / 'active.json'
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(name, destination)
    for suffix, image in [('',OLD['container']['image']),('-prepared',OLD['preparedImage'])]:
        run(['docker','tag',image,'royal-game:before-'+NAME+suffix])
    run(['docker','tag',M['extra']['nileImage'],'royal-nile-play:before-'+NAME])
    command = ['docker','exec','royal-finance-sim-finance-db-1','sh','-ec',
               'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_nile_play']
    with (BACKUP / 'nile-play.dump').open('wb') as output:
        subprocess.run(command, stdout=output, check=True)
    run(['docker','cp','royal-game-1:/app/dist/index.html',str(BACKUP / 'index.html')])
    return {'sourceBackupSha256':sha(BACKUP / 'source.tgz'),'financialBackupSha256':sha(BACKUP / 'nile-play.dump')}

def build():
    validate_payload()
    copies = backup()
    profile = financial_profile(inspect('royal-nile-play'))
    for kind in ['game','financial']:
        context = ROOT / (kind+'-context')
        context.mkdir(exist_ok=False)
        if kind == 'game':
            for directory in ['dist-delta','server-delta','module-delta']:
                shutil.copytree(ROOT / directory, context / directory)
            for name in ['package.json','package-lock.json']:
                shutil.copyfile(ROOT / 'source' / name, context / name)
            dockerfile = 'FROM '+OLD['preparedImage']+'\nUSER root\nCOPY --chown=node:node package.json package-lock.json /app/\nRUN npm ci --omit=dev && npm cache clean --force\nUSER node\nCOPY --chown=node:node dist-delta/ /app/dist/\nCOPY --chown=node:node server-delta/index.js /app/dist-server/index.js\nCOPY --chown=node:node module-delta/ /app/module-dist/\n'
        else:
            shutil.copyfile(ROOT / 'play.js', context / 'play.js')
            dockerfile = 'FROM '+OLD['preparedImage']+' AS engines\nFROM '+M['extra']['nileImage']+'\nCOPY --chown=node:node play.js /app/play.js\nCOPY --from=engines /app/dist-server/card-engine /app/dist-server/card-engine-v1 /app/dist-server/\n'
        (context / 'Dockerfile').write_text(dockerfile+'LABEL org.opencontainers.image.revision="'+M['sourceCommit']+'"\n')
        with (ROOT / (kind+'-build.log')).open('w') as log:
            subprocess.run(['docker','build','--pull=false','-t',('royal-game:' if kind=='game' else 'royal-nile-play:')+NAME,'.'], cwd=context, check=True, stdout=log, stderr=subprocess.STDOUT)
    game = run(['docker','image','inspect','royal-game:'+NAME,'--format','{{.Id}}'])
    financial = run(['docker','image','inspect','royal-nile-play:'+NAME,'--format','{{.Id}}'])
    run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',financial,'--check','/app/play.js'])
    result = {**copies,'game':game,'financial':financial,'financialProfile':profile,'sourceCommit':M['sourceCommit']}
    save('build-result.json',result)
    print(json.dumps({'built':True,'game':game,'financial':financial}),flush=True)

def configure_finance():
    for destination, row in M['extra']['files'].items():
        assert sha(destination) == row['sha256'], 'Later financial settings block publication'
        atomic(ROOT / 'finance-source' / row['source'],Path(destination))
        atomic(ROOT / 'finance-source' / row['source'],LIVE / row['source'])
    run(['systemctl','daemon-reload'])

def finance():
    validate_payload();guard()
    built=json.loads((ROOT/'build-result.json').read_text())
    configure_finance()
    run(['systemctl','stop','royal-nile-reconcile.service'])
    # A timed-out old wrapper may leave its own one-shot child behind.
    subprocess.run(['docker','rm','--force','royal-nile-reconcile-once'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    run(['systemctl','start','--no-block','royal-nile-reconcile.service'])
    run(['docker','tag',built['financial'],'royal-nile-play:local'])
    run(['docker','compose','-f','deployment/finance/compose.nile-play.yaml','up','-d','--no-deps','--force-recreate','--no-build','nile-play'],cwd='/opt/royal-finance')
    assert financial_profile(inspect('royal-nile-play')) == built['financialProfile'], 'Financial isolation changed'
    deadline=time.monotonic()+420
    while time.monotonic()<deadline:
        current=inspect('royal-nile-play')
        if current['State'].get('Health',{}).get('Status')=='healthy':
            result=json.loads(run(['docker','exec','royal-nile-play','node','play.js','health']))
            if result.get('ready'):
                save('finance-verification.json',result)
                print(json.dumps({'financialReady':True,'auditOk':result['ok'],'totalUnits':result['totalUnits'],'houseUnits':result['houseUnits']}),flush=True)
                return
        time.sleep(10)
    raise RuntimeError('Nile reconciliation did not become ready; game release remains unpublished')

def game():
    validate_payload()
    built=json.loads((ROOT/'build-result.json').read_text())
    assert source_inventory()==OLD['source'], 'Later source changes block game publication'
    assert inventory(MODULES)==OLD['moduleFiles'] and sha(HOST)==OLD['moduleHostContract']
    assert json.loads(run(['docker','exec','royal-nile-play','node','play.js','health']))['ready']
    for name,digest in OLD['configHashes'].items(): assert sha(LIVE/name)==digest
    for name in M['changed']: atomic(ROOT/'source'/name,LIVE/name)
    for source in (ROOT/'external-modules').rglob('*'):
        if source.is_file() and source.name!='active.json':
            target=MODULES/source.relative_to(ROOT/'external-modules')
            if target.exists(): assert sha(target)==sha(source),'Immutable module collision'
            else: atomic(source,target)
    old_contract=json.loads(HOST.read_text());new_contract=json.loads((ROOT/'host.json').read_text())
    for game_id, contract in old_contract['games'].items():
        expected = {'apiVersion':1,'rulesVersion':3,'progressVersion':2} if game_id=='studio-dracona' else contract
        assert new_contract['games'].get(game_id)==expected, 'Unexpected host contract change: '+game_id
    atomic(ROOT/'host.json',HOST)
    for name in M['pointers']: atomic(ROOT/'external-modules'/Path(name).parent.name/'active.json',Path(name))
    run(['docker','tag',built['game'],'royal-game:latest'])
    run(['docker','compose',*[v for n in ['compose.yaml','compose.override.yaml','compose.payments.yaml','compose.mira.yaml'] for v in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate','game'],cwd=LIVE)
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        if inspect('royal-game-1')['State'].get('Health',{}).get('Status')=='healthy':break
        time.sleep(3)
    else: raise RuntimeError('Game health check failed')
    after=json.loads(run(['python3',str(ROOT/'snapshot.py')]))
    assert after['container']['image']==built['game']
    for key in ['mounts','host','runtimeHash','composeFiles']: assert after['container'][key]==OLD['container'][key],key
    assert after['configHashes']==OLD['configHashes']
    assert after['source']=={**OLD['source'],**M['changed']}
    assert all(after['moduleFiles'].get(k)==(M['pointers'].get(k) or v) for k,v in OLD['moduleFiles'].items()),'Old module bytes changed'
    expected={**OLD['program'],**{'dist/'+k:v for k,v in M['dist'].items()},**{'module-dist/'+k:v for k,v in M['modules'].items()},'dist-server/index.js':M['backend'],**M['packages']}
    assert after['program']==expected and after['preparedProgram']==expected,'Runtime differs'
    for name,row in OLD['services'].items():
        if name not in ['/royal-game-1','/royal-nile-play']: assert after['services'][name]==row,'Other service changed: '+name
    for source in (ROOT/'dist-delta').rglob('*'):
        if source.is_file():atomic(source,LIVE/'dist'/source.relative_to(ROOT/'dist-delta'))
    save('after.json',after)
    save('verification.json',{'published':True,'sourceCommit':M['sourceCommit'],'gameImage':built['game'],'financialImage':built['financial'],
         'sourceBackupSha256':built['sourceBackupSha256'],'financialBackupSha256':built['financialBackupSha256'],
         'gameDataPreserved':True,'oldModuleVersionsPreserved':True,'externalPointers':len(M['pointers']),'configurationsPreserved':True})
    print((ROOT/'verification.json').read_text(),flush=True)

def rollback():
    built=json.loads((ROOT/'build-result.json').read_text())
    assert inspect('royal-game-1')['Image'] in [OLD['container']['image'],built['game']]
    current=source_inventory()
    assert set(current).issubset(set(OLD['source'])|set(M['changed'])), 'Later source files block rollback'
    for name,digest in current.items():
        assert digest in [OLD['source'].get(name),M['changed'].get(name)],'Later source change blocks rollback: '+name
    with tarfile.open(BACKUP/'source.tgz') as archive:
        for name in M['changed']:
            # The upgraded financial service remains compatible with the previous host.
            # Keep its source and ledger after any new transactions; never restore the dump.
            if name.startswith(('server/finance/','server/pvp/')):continue
            target=LIVE/name
            if name in OLD['source']:
                temporary=ROOT/'rollback-source'/name
                temporary.parent.mkdir(parents=True,exist_ok=True)
                temporary.write_bytes(archive.extractfile(name).read());atomic(temporary,target)
            elif target.is_file():target.unlink()
    for name,digest in M['pointers'].items():
        assert sha(name) in [digest,OLD['moduleFiles'][name]],'Later module pointer blocks rollback'
        atomic(BACKUP/'pointers'/Path(name).parent.name/'active.json',Path(name))
    atomic(BACKUP/'host.json',HOST)
    run(['docker','tag',OLD['preparedImage'],'royal-game:latest'])
    run(['docker','compose',*[v for n in ['compose.yaml','compose.override.yaml','compose.payments.yaml','compose.mira.yaml'] for v in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate','game'],cwd=LIVE)
    save('rollback.json',{'gameImage':OLD['preparedImage'],'financialServiceRetained':True,'databaseRestored':False})

if __name__=='__main__':
    assert len(sys.argv)==2 and sys.argv[1] in ['check','build','finance','game','rollback']
    with open('/opt/royal-releases/themed-publish.lock','a+') as app_lock,open(STATE/'module.lock','a+') as module_lock:
        fcntl.flock(app_lock,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(module_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1]=='check':validate_payload();guard();print('reviewed production baseline matches')
        else:
            try:globals()[sys.argv[1]]()
            except BaseException as error:
                save('failure.json',{'phase':sys.argv[1],'type':type(error).__name__,'reason':str(error)})
                if sys.argv[1]=='game':rollback()
                raise
