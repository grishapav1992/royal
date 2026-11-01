"""Install the authorized hand duel through the existing guarded host and module publishers."""
import sys
sys.dont_write_bytecode=True
import copy,fcntl,hashlib,importlib.util,json,re,signal,types
from pathlib import Path
NAME='tsu-e-fa-20261101-v1'
ROOT=Path(__file__).resolve().parent
def require(value,reason):
    if not value:raise RuntimeError(reason)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path):return json.loads(Path(path).read_text())
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def expected_modules(m):
    result=dict(m['before']['moduleFiles']);p=m['package'];prefix='/opt/royal-game-modules/tsu-e-fa/versions/'+p['version']+'/'
    result.update({prefix+n:h for n,h in p['files'].items()})
    result['/opt/royal-game-modules/tsu-e-fa/active.json']=p['pointerSha256']
    return result
def validate_graph(graph,m,scope,backend=False):
    require(graph['productionCommit']==m['baseCommit'],'Wrong projection baseline')
    for name,digest in graph['inputs'].items():
        selected=scope['preservedBackendInputs'].get(name) if backend else None
        selected=selected or scope['expectedSources'].get(name)
        allowed=[selected] if selected else [m['before']['source'].get(name),m['before']['sourceLF'].get(name)]
        require(digest in [v for v in allowed if v],'Unreviewed source input: '+name)
def payload(b):
    m=b.M;scope=read(ROOT/'scope.json')
    require(ROOT==Path('/opt/royal-releases')/NAME and m['release']==NAME,'Unexpected release path')
    require(m['changed']==scope['expectedSources'] and set(m['serverDelta'])=={'index.js'},'Unreviewed source scope')
    require(m['addedGames']==['tsu-e-fa'] and m['restoredGames']==[] and m['activeGames']==scope['activeGames'],'Unauthorized catalogue change')
    require(sha(ROOT/'deploy.py')==m['helperSha256'] and sha(ROOT/'snapshot.py')==m['snapshotSha256'],'Installer changed')
    for name,digest in m['payload'].items():
        b.safe_name(name);require(not (ROOT/name).is_symlink() and sha(ROOT/name)==digest,'Payload changed: '+name)
    require(b.inventory(ROOT/'source')==m['changed'] and b.inventory(ROOT/'dist-delta')==m['delta'] and b.inventory(ROOT/'server-delta')==m['serverDelta'],'Payload inventories differ')
    require('index.html' in m['delta'],'Missing client index')
    for name,digest in m['delta'].items():
        require(name=='index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)',name),'Foreign client artifact')
        require(name=='index.html' or 'dist/'+name not in m['before']['program'],'Immutable client URL collision')
    release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json')
    require(release['sourceCommit']==receipt['sourceCommit']==m['sourceCommit'] and release['baseCommit']==m['baseCommit']==m['before']['sourceCommit'],'Unverified source')
    require(release['scope']=='application' and release['clean'] and release['build']['passed'],'Committed verified release required')
    require(sha(ROOT/'release-manifest.json')==m['releaseManifestSha256'] and sha(ROOT/'release-github.json')==m['receiptSha256'],'Build evidence changed')
    require(all(release['files'].get('dist/'+n)==h for n,h in m['delta'].items()),'Unverified client bytes')
    require(release['backendProjection']==release['build']['backendProjection'] and release['hostProjection']==release['build']['hostProjection'],'Projection evidence differs')
    validate_graph(release['hostProjection'],m,scope);validate_graph(release['backendProjection'],m,scope,True)
    require(release['backendProjection']['output']['sha256']==m['serverDelta']['index.js']==release['files']['dist-server/index.js'],'Unverified backend bytes')
    module=release['build']['moduleProjection'];require(set(module['modules'])=={'tsu-e-fa'},'Unrequested module publication')
    validate_graph(module,m,scope)
    p=m['package'];require(p['contract']=={'apiVersion':1,'rulesVersion':4,'progressVersion':1},'Wrong duel contract')
    require('tsu-e-fa' not in m['before']['moduleHost']['games'],'Unexpected existing duel interface')
    host=copy.deepcopy(m['before']['moduleHost']);host['games']['tsu-e-fa']=p['contract']
    require(read(ROOT/'host.json')==host and sha(ROOT/'host.json')==m['hostContractSha256'],'Other host contracts changed')
    require(b.inventory(ROOT/'package')==p['files'] and sha(ROOT/'active.json')==p['pointerSha256'],'Package differs')
    prefix='module-dist/tsu-e-fa/versions/'+p['version']+'/'
    require(all(release['files'].get(prefix+n)==h for n,h in p['files'].items()),'Unverified module bytes')
    require(module['modules']['tsu-e-fa']['version']==p['version'],'Module build version differs')
    require(m['support']['publisher.py']==m['before']['source']['scripts/game-module-release.py'],'Publisher changed')
def configure():
    m=read(ROOT/'install-manifest.json')
    for name,digest in m['support'].items():require(sha(ROOT/name)==digest,'Guarded helper changed: '+name)
    guard=load('tsu_application_overlay',ROOT/'application-overlay.py')
    guard.NAME,guard.ROOT=NAME,ROOT;guard.payload=payload
    b=guard.configure(ROOT);b.tsu_staged=False
    original_settings=b.settings
    def settings(state,recovery=False):
        expected=expected_modules(m) if b.tsu_staged else m['before']['moduleFiles']
        require(state['moduleFiles']==expected,'Unrelated module bytes changed')
        require(state['moduleHostContract']==(m['hostContractSha256'] if b.tsu_staged else m['before']['moduleHostContract']),'Unexpected host contract')
        normalized={**state,'moduleFiles':m['before']['moduleFiles'],'moduleHostContract':m['before']['moduleHostContract']}
        original_settings(normalized,recovery=recovery)
    b.settings=settings
    original_compose=b.compose
    def compose(gate=None):
        if not b.tsu_staged:
            require(gate is not None,'Financial gate required for module activation')
            gate.check();require(sha(b.HOST)==m['before']['moduleHostContract'],'Later host prevents activation')
            require(not (Path('/opt/royal-game-modules/tsu-e-fa')/'active.json').exists(),'Duel already published')
            b.atomic(b.HOST,b.BACKUP/'host.json');b.atomic(ROOT/'host.json',b.HOST)
            publisher=load('tsu_publisher',ROOT/'publisher.py')
            result=publisher.run(types.SimpleNamespace(operation='install',package=str(ROOT/'package'),game='tsu-e-fa',root='/opt/royal-game-modules',state=str(b.STATE),expected_sha='none'))
            require(result['verified'] and sha('/opt/royal-game-modules/tsu-e-fa/active.json')==m['package']['pointerSha256'],'Published module differs')
            b.write('module-publication.json',result);b.tsu_staged=True;gate.check()
        return original_compose(gate)
    b.compose=compose
    original_rollback=b.rollback
    def rollback():
        # The inherited financial drain refuses replacement while any PvP hold remains.
        result=original_rollback()
        if b.tsu_staged:
            pointer=Path('/opt/royal-game-modules/tsu-e-fa/active.json')
            require(sha(pointer)==m['package']['pointerSha256'] and sha(b.HOST)==m['hostContractSha256'],'Later publication prevents recovery')
            pointer.unlink();b.atomic(b.BACKUP/'host.json',b.HOST);b.tsu_staged=False
        return result
    b.rollback=rollback
    return b
def main():
    require(sys.argv[1:] in [['check'],['release']],'Unexpected operation')
    b=configure();b.payload();locks=[]
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(),'Lock symlink rejected')
        handle=open(name,'a');fcntl.flock(handle,fcntl.LOCK_EX);locks.append(handle)
    for number in [signal.SIGHUP,signal.SIGTERM,signal.SIGINT]:signal.signal(number,lambda n,f:(_ for _ in ()).throw(InterruptedError(str(n))))
    if sys.argv[1]=='check':b.baseline();result={'ready':True}
    else:
        built=b.build();print(json.dumps(built),flush=True)
        result=b.publish();result.update(addedGames=['tsu-e-fa'],restoredGames=[],activeGames=b.M['activeGames'],package=b.M['package']['version'])
        b.write('published.json',result)
        b.write('backup.json',{'backup':str(b.BACKUP),'sourceArchive':str(b.BACKUP/'source.tgz'),'sourceArchiveSha256':sha(b.BACKUP/'source.tgz'),'bytes':(b.BACKUP/'source.tgz').stat().st_size,'previousImage':b.OLD['preparedImage'],'hostContractSha256':sha(b.BACKUP/'host.json'),'databaseRestored':False})
    print(json.dumps(result),flush=True)
if __name__=='__main__':main()
