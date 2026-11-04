"""Install qualified manual stakes through the existing financial and image guards."""
import sys
sys.dont_write_bytecode = True
import copy, fcntl, hashlib, importlib.util, json, re, signal, subprocess, types
from pathlib import Path

NAME = 'manual-stakes-20261104-v1'
ROOT = Path(__file__).resolve().parent

def require(value, reason):
    if not value: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_text())
def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def expected_modules(m, installed, restored=False):
    result=dict(m['before']['moduleFiles'])
    for game in installed:
        package=m['packages'][game]
        prefix='/opt/royal-game-modules/'+game+'/versions/'+package['version']+'/'
        result.update({prefix+name:digest for name,digest in package['files'].items()})
        if not restored:result['/opt/royal-game-modules/'+game+'/active.json']=package['pointerSha256']
    return result

def validate_catalogue(m, scope):
    require(m['activeGames']==scope['activeGames'] and len(m['activeGames'])==20,'Production catalogue differs')
    require(len(set(m['activeGames']))==20,'Duplicate catalogue identities')
    require(not m['addedGames'] and not m['restoredGames'],'Catalogue expansion rejected')
    require(set(m['packages'])==set(m['activeGames'])-{'tsu-e-fa'},'Unreviewed module selection')

def validate_inputs(graph, m, scope):
    require(graph['productionCommit']==m['baseCommit'],'Projection baseline differs')
    for name,digest in graph['inputs'].items():
        expected=scope['expectedSources'].get(name)
        allowed=[expected] if expected else [m['before']['source'].get(name),m['before']['sourceLF'].get(name)]
        require(digest in allowed,'Unreviewed compiled input: '+name)

def payload(b):
    m=b.M;scope=read(ROOT/'scope.json')
    require(ROOT==Path('/opt/royal-releases')/NAME and m['release']==NAME,'Unexpected release path')
    validate_catalogue(m,scope)
    require(m['changed']=={**scope['expectedSources'],**scope['evidenceSources']},'Unreviewed source scope')
    require(set(m['serverDelta'])=={'index.js'},'Unexpected backend artifact')
    require(sha(ROOT/'deploy.py')==m['helperSha256'] and sha(ROOT/'snapshot.py')==m['snapshotSha256'],'Installer changed')
    for name,digest in m['payload'].items():
        b.safe_name(name);require(not (ROOT/name).is_symlink() and sha(ROOT/name)==digest,'Payload changed: '+name)
    require(b.inventory(ROOT/'source')==m['changed'] and b.inventory(ROOT/'dist-delta')==m['delta']
        and b.inventory(ROOT/'server-delta')==m['serverDelta'],'Payload inventory differs')
    require('index.html' in m['delta'],'Client index missing')
    for name,digest in m['delta'].items():
        require(name=='index.html' or re.fullmatch(r'assets/[\w-]+\.(?:js|css)',name),'Foreign client file')
        require(name=='index.html' or 'dist/'+name not in m['before']['program'],'Immutable client collision')
    release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json')
    require(sha(ROOT/'release-manifest.json')==m['releaseManifestSha256'] and sha(ROOT/'release-github.json')==m['receiptSha256'],'Release proof changed')
    require(release['sourceCommit']==receipt['sourceCommit']==m['sourceCommit'] and release['baseCommit']==m['baseCommit']==m['before']['sourceCommit'],'Source was not verified in GitHub')
    require(release['scope']=='application' and release['clean'] and release['build']['passed'],'Committed application proof missing')
    require(all(release['files'].get('dist/'+n)==h for n,h in m['delta'].items()),'Client differs from verified bytes')
    require(release['backendProjection']==release['build']['backendProjection'] and release['hostProjection']==release['build']['hostProjection'],'Projection evidence differs')
    validate_inputs(release['hostProjection'],m,scope);validate_inputs(release['backendProjection'],m,scope)
    require(release['backendProjection']['output']['sha256']==m['serverDelta']['index.js']==release['files']['dist-server/index.js'],'Backend differs from verified bytes')
    modules=release['build']['moduleProjection'];validate_inputs(modules,m,scope)
    require(set(modules['modules'])==set(m['packages']),'Module projection selection differs')
    for game,package in m['packages'].items():
        require(package['contract']==m['before']['moduleHost']['games'][game],'Module contract changed')
        require(b.inventory(ROOT/'packages'/game)==package['files'],'Module inventory differs: '+game)
        require(sha(ROOT/'pointers'/(game+'.json'))==package['pointerSha256'],'Pointer differs')
        require(modules['modules'][game]['version']==package['version'],'Module build identity differs')
        prefix='module-dist/'+game+'/versions/'+package['version']+'/'
        require(all(release['files'].get(prefix+n)==h for n,h in package['files'].items()),'Module bytes are not in the verified release')
    compatibility=read(ROOT/'production-round-compatibility.json')
    require(compatibility['passed'] and compatibility['legacyCases']==23 and compatibility['preservedWardrobeVersion']==3,'Historical round qualification missing')
    require(compatibility['acceptedCommonPolicy']['passed'] and compatibility['acceptedCommonPolicy']['allPresetsAndPaidChoices'],'Accepted stake-policy recovery missing')
    require(compatibility['manualStarSpin']['stakeUnits']=='15' and compatibility['manualStarSpin']['replayed'],'Manual Star Spin wallet proof missing')
    require(sha(ROOT/'production-round-compatibility.json')==m['compatibilitySha256'],'Compatibility evidence changed')
    require(m['support']['publisher.py']==m['before']['source']['scripts/game-module-release.py'],'Publisher differs from production')

def compatible_recovery_required(candidate_attempted, public_open):
    return bool(candidate_attempted or public_open)

def financial_backup(b):
    target=b.BACKUP/'financial.dump'
    proof_path=ROOT/'financial-backup.json'
    if target.exists():
        proof=read(proof_path);require(sha(target)==proof['sha256'] and target.stat().st_size==proof['bytes'],'Financial backup changed');return proof
    require(not target.is_symlink() and not proof_path.exists(),'Incomplete prior financial backup')
    command=['docker','exec','royal-finance-sim-finance-db-1','sh','-ec',
        'export PGPASSWORD="$(cat /run/secrets/finance_admin_password)"; exec pg_dump -h 127.0.0.1 -U finance_schema_owner -d royal_finance_sim --format=custom --schema=royal_game --schema=royal_nile_play']
    with target.open('xb') as output:subprocess.run(command,stdout=output,stderr=subprocess.PIPE,check=True,timeout=600)
    target.chmod(0o600);require(0<target.stat().st_size<256*1024**2,'Financial backup budget exceeded')
    with target.open('rb') as source:listing=b.run(['docker','exec','-i','royal-finance-sim-finance-db-1','pg_restore','--list'],stdin=source)
    require('royal_game' in listing and 'royal_nile_play' in listing,'Financial backup is incomplete')
    proof={'path':str(target),'sha256':sha(target),'bytes':target.stat().st_size,'databaseRestored':False}
    b.write('financial-backup.json',proof);return proof

def configure():
    m=read(ROOT/'install-manifest.json')
    for name,digest in m['support'].items():require(not (ROOT/name).is_symlink() and sha(ROOT/name)==digest,'Support changed: '+name)
    guard=load('manual_application_overlay',ROOT/'application-overlay.py')
    guard.NAME,guard.ROOT,guard.payload=NAME,ROOT,payload
    b=guard.configure(ROOT);b.manual_installed=[];b.manual_restored=False;b.manual_rolling_back=False;b.manual_public_open=False;b.manual_candidate_attempted=False
    original_gate=b.quiet_gate
    def quiet_gate(minimum=None):
        gate=original_gate(minimum);release=gate.release
        def released():
            result=release()
            if not b.manual_rolling_back and b.manual_installed:b.manual_public_open=True
            return result
        gate.release=released;return gate
    b.quiet_gate=quiet_gate
    original_settings=b.settings
    def settings(state,recovery=False):
        require(state['moduleFiles']==expected_modules(m,b.manual_installed,b.manual_restored),'Unrelated module bytes changed')
        original_settings({**state,'moduleFiles':m['before']['moduleFiles']},recovery=recovery)
    b.settings=settings
    original_build=b.build
    def build():
        result=original_build();financial_backup(b)
        for game,package in m['packages'].items():
            source=Path('/opt/royal-game-modules')/game;backup=b.BACKUP/game;backup.mkdir()
            b.atomic(source/'active.json',backup/'active.json')
            require(sha(backup/'active.json')==package['previousPointerSha256'],'Previous pointer changed')
            b.shutil.copytree(source/'versions'/package['previousVersion'],backup/'package',copy_function=b.os.link)
            require(b.inventory(backup/'package')==package['previousFiles'],'Previous module backup differs')
        return result
    b.build=build
    original_compose=b.compose
    def compose(gate=None):
        if not b.manual_rolling_back:
            require(gate is not None,'Fresh financial lease required')
            publisher=load('manual_module_publisher',ROOT/'publisher.py')
            for game,package in m['packages'].items():
                gate.check()
                result=publisher.run(types.SimpleNamespace(operation='install',package=str(ROOT/'packages'/game),game=game,
                    root='/opt/royal-game-modules',state=str(b.STATE),expected_sha=package['previousPointerSha256']))
                require(result['verified'] and result['activeSha256']==package['pointerSha256'],'Published pointer differs')
                b.manual_installed.append(game);b.write('module-publication.json',{'installed':b.manual_installed,'verified':True})
        if not b.manual_rolling_back:b.manual_candidate_attempted=True
        return original_compose(gate)
    b.compose=compose
    original_publish=b.publish
    def publish():
        financial_backup(b);result=original_publish();result['updatedModules']=list(m['packages']);result['addedGames']=[];result['restoredGames']=[]
        b.write('published.json',result);return result
    b.publish=publish
    original_rollback=b.rollback
    def rollback():
        # New accepted amounts need the compatible wallet even during recovery.
        require(not compatible_recovery_required(b.manual_candidate_attempted,b.manual_public_open),'Candidate startup was attempted; preserve the compatible wallet and perform reviewed recovery')
        b.manual_rolling_back=True
        try:
            result=original_rollback()
            publisher=load('manual_module_recovery',ROOT/'publisher.py')
            for game in reversed(b.manual_installed):
                package=m['packages'][game]
                restored=publisher.run(types.SimpleNamespace(operation='rollback',version=package['previousVersion'],package=None,game=game,
                    root='/opt/royal-game-modules',state=str(b.STATE),expected_sha=package['pointerSha256']))
                require(restored['activeSha256']==package['previousPointerSha256'],'Recovered pointer differs')
            b.manual_restored=True
            return result
        finally:b.manual_rolling_back=False
    b.rollback=rollback
    return b

def main():
    require(len(sys.argv)==2 and sys.argv[1] in ['check','build','publish','release'],'Unexpected operation')
    base=configure();base.payload();locks=[]
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(),'Publication lock symlink rejected')
        handle=open(name,'a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
    def interrupted(number,frame):raise InterruptedError('Deployment interrupted: '+str(number))
    for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]:signal.signal(number,interrupted)
    if sys.argv[1]=='check':base.baseline();print(json.dumps({'ready':True}),flush=True)
    elif sys.argv[1]=='release':print(json.dumps(base.build()),flush=True);print(json.dumps(base.publish()),flush=True)
    else:print(json.dumps(getattr(base,sys.argv[1])()),flush=True)

if __name__=='__main__':main()
