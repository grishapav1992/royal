"""Publish the reviewed host, then compatible clients, using existing guarded installers."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import fcntl, hashlib, json, re, signal, types, subprocess, importlib.util, os, shutil
from image_metadata import image, inspect
NAME = 'layout-priorities-20261101-v1'
ROOT = Path(__file__).resolve().parent
SCOPE = json.loads((ROOT / 'scope.json').read_text())
SOURCES = set(SCOPE['expectedSources'])
def require(value, reason):
    if not value: raise RuntimeError(reason)
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_text())
def save(name, value):
    target=ROOT/name; part=target.with_suffix(target.suffix+'.next'); part.write_text(json.dumps(value,indent=2)+'\n'); os.replace(part,target)
def validate_inputs(changes, projection, before, required=()):
    require(set(changes)==SOURCES, 'Unreviewed layout source scope')
    for name,digest in projection['inputs'].items():
        require(digest in ([changes[name]] if name in changes else [before['source'].get(name),before['sourceLF'].get(name)]), 'Unrelated input changed: '+name)
    require(all(projection['inputs'].get(n)==changes[n] for n in required), 'Required layout input missing')
def configure(root=ROOT):
    m = json.loads((root / 'install-manifest.json').read_text())
    for name, digest in m['support'].items():
        require(not (root / name).is_symlink() and sha(root / name) == digest, 'Support helper changed: ' + name)
    base = types.ModuleType('catalogue_overlay'); base.__file__ = str(root / 'overlay-base.py')
    exec(compile((root / 'overlay-base.py').read_text(), base.__file__, 'exec'), base.__dict__)
    base.NAME, base.ROOT, base.BACKUP = NAME, root, Path('/opt/royal-backups') / NAME
    base.BASE = dict(m['before']['source']); base.sources = lambda state: state['source']
    base.PROGRAM = (root / 'runtime-inventory.cjs').read_text()
    names = m['before']['container']['composeFiles'].split(',')
    require(names and all(Path(n).parent == base.LIVE and Path(n).name.startswith('compose') and Path(n).suffix == '.yaml' for n in names), 'Unreviewed Compose files')
    base.COMPOSE = [Path(n).name for n in names]
    original_run, original_settings = base.run, base.settings
    def run(args, **kwargs):
        if args[:3] == ['docker', 'image', 'inspect']:
            if args[-2:] == ['--format', '{{.Id}}']: return image(args[3])
            return json.dumps([inspect(ref) for ref in args[3:]])
        return original_run(args, **kwargs)
    def settings(state, recovery=False):
        original_settings(state, recovery=recovery)
        require(state['protectedPrograms'] == base.OLD['protectedPrograms'], 'Protected service programs changed')
        old, current = base.OLD['serviceProfiles'], state['serviceProfiles']
        require(set(current) == set(old) or recovery and set(current) == set(old) - {'royal-game-1'}, 'Service inventory changed')
        for name, row in current.items():
            require(row['profileSha256'] == old[name]['profileSha256'], 'Service configuration changed')
            if name != 'royal-game-1': require(row == old[name], 'Retained service changed')
    def stage_run(args, **kwargs):
        require(args == ['docker','build','--pull=false','-t','royal-game:' + NAME,'.'], 'Unreviewed image build command')
        require(kwargs.get('cwd') == root / 'runtime-context', 'Unreviewed staging context')
        spec = importlib.util.spec_from_file_location('header_engine_build', root / 'engine-build.py')
        engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
        files = {'dist-delta/' + name: 'dist/' + name for name in m['delta']}
        files.update({'server-delta/' + name: 'dist-server/' + name for name in m['serverDelta']})
        candidate = engine.build(root, m['before']['preparedImage'], 'royal-game', NAME, m['sourceCommit'], files)
        kwargs['stdout'].write(json.dumps({'candidate':candidate,'applicationExecuted':False}) + '\n')
        return types.SimpleNamespace(returncode=0)
    class StagingProcess:
        run = staticmethod(stage_run)
        def __getattr__(self, name): return getattr(subprocess, name)
    base.subprocess = StagingProcess()
    base.run, base.image, base.settings = run, image, settings
    base.payload = lambda: payload(base)
    return base

def payload(b):
    m=b.M
    require(ROOT==Path('/opt/royal-releases')/NAME and m['release']==NAME, 'Unexpected release root')
    require(m['changed']==SCOPE['expectedSources'] and not m['serverDelta'], 'Unreviewed source or backend delta')
    require(sha(ROOT/'deploy.py')==m['helperSha256'] and sha(ROOT/'snapshot.py')==m['snapshotSha256'], 'Installer changed')
    for n,h in m['payload'].items():
        require(not Path(n).is_absolute() and all(p not in ['', '.', '..'] and not p.startswith('.env') for p in n.split('/')), 'Unsafe payload path')
        require(not (ROOT/n).is_symlink() and sha(ROOT/n)==h, 'Payload changed: '+n)
    require(b.inventory(ROOT/'source')==m['changed'] and b.inventory(ROOT/'dist-delta')==m['delta'] and b.inventory(ROOT/'server-delta')=={}, 'Payload inventory differs')
    require('index.html' in m['delta'], 'Client index missing')
    for n,h in m['delta'].items():
        require(n=='index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)',n), 'Foreign host artifact')
        require(n=='index.html' or 'dist/'+n not in b.OLD['program'], 'Immutable asset URL collision')
    release=read(ROOT/'release-manifest.json'); receipt=read(ROOT/'release-github.json')
    require(sha(ROOT/'release-manifest.json')==m['releaseManifestSha256'] and sha(ROOT/'release-github.json')==m['receiptSha256'], 'Release evidence changed')
    require(release['sourceCommit']==receipt['sourceCommit']==m['sourceCommit'] and release['baseCommit']==m['baseCommit']==b.OLD['sourceCommit'], 'Unverified source')
    require(release['scope']=='application' and release['clean'] and release['build']['passed'], 'Committed build required')
    require(all(release['files'].get('dist/'+n)==h for n,h in m['delta'].items()), 'Host differs from verified build')
    require(release['hostProjection']==release['build']['hostProjection'] and release['hostProjection']['productionCommit']==m['baseCommit'], 'Host projection differs')
    validate_inputs(m['changed'],release['hostProjection'],b.OLD,{'src/main.ts','src/ui/GameChat.ts','src/ui/GameViewport.ts'})
    modules=release['build']['moduleProjection'];validate_inputs(m['changed'],modules,b.OLD)
    require(set(m['packages'])==set(SCOPE['activeGames']) and len(m['packages'])==18 and not m['addedGames'] and not m['restoredGames'], 'Catalogue scope changed')
    for game,row in m['packages'].items():
        require(row['contract']==b.OLD['moduleHost']['games'][game], 'Production contract changed: '+game)
        require(b.inventory(ROOT/'packages'/game)==row['files'] and sha(ROOT/'pointers'/(game+'.json'))==row['pointerSha256'], 'Package changed')
        prefix='module-dist/'+game+'/versions/'+row['version']+'/'
        require(all(release['files'].get(prefix+n)==h for n,h in row['files'].items()), 'Unverified package bytes')
        require(modules['modules'][game]['version']==row['version'], 'Module projection version differs')
    require(m['support']['publisher.py']==b.OLD['source']['scripts/game-module-release.py'], 'Production publisher changed')

def backup_modules(b):
    target=b.BACKUP/'modules'
    publisher=load_publisher()
    if target.exists():
        record=read(ROOT/'module-backup.json')
        require(set(record)==set(b.M['packages']), 'Incomplete module backup')
    else:
        target.mkdir()
        record={}
        for game in sorted(b.M['packages']):
            pointer=b.STATE.parent/'royal-game-modules'/game/'active.json'
            pointer=Path('/opt/royal-game-modules')/game/'active.json'
            expected=b.OLD['moduleFiles'][str(pointer)];require(sha(pointer)==expected, 'Module changed before backup')
            value=read(pointer);version=value['manifest'].split('/')[4];folder=pointer.parent/'versions'/version
            publisher.verify(folder,b.OLD['moduleHost']['games'][game],game)
            dest=target/game;dest.mkdir();shutil.copyfile(pointer,dest/'active.json');shutil.copytree(folder,dest/'package',copy_function=os.link)
            record[game]={'version':version,'pointerSha256':expected,'manifestSha256':sha(dest/'package/manifest.json')}
        save('module-backup.json',record)
    for game,row in record.items():
        dest=target/game;require(sha(dest/'active.json')==row['pointerSha256'] and sha(dest/'package/manifest.json')==row['manifestSha256'], 'Module rollback changed')
        publisher.verify(dest/'package',b.OLD['moduleHost']['games'][game],game)
    save('backup.json',{'backup':str(b.BACKUP),'sourceArchive':str(b.BACKUP/'source.tgz'),'sourceArchiveSha256':sha(b.BACKUP/'source.tgz'),'bytes':(b.BACKUP/'source.tgz').stat().st_size,'modules':record,'databaseTouched':False})

def load_publisher():
    spec=importlib.util.spec_from_file_location('layout_module_publisher',ROOT/'publisher.py'); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def expected_modules(m):
    result=dict(m['before']['moduleFiles'])
    for game,row in m['packages'].items():
        prefix='/opt/royal-game-modules/'+game+'/versions/'+row['version']+'/'
        result.update({prefix+n:h for n,h in row['files'].items()});result['/opt/royal-game-modules/'+game+'/active.json']=row['pointerSha256']
    return result

def module_state(b):
    current=b.snapshot();host=read(ROOT/'host-after.json')
    require({k:v for k,v in current.items() if k not in ['at','availableBytes','moduleFiles']}=={k:v for k,v in host.items() if k not in ['at','availableBytes','moduleFiles']}, 'Host changed during module publication')
    final=expected_modules(b.M);old=b.OLD['moduleFiles']
    require(set(old).issubset(current['moduleFiles']) and set(current['moduleFiles']).issubset(final), 'Unexpected module paths')
    for n,h in current['moduleFiles'].items():require(h in [old.get(n),final.get(n)], 'Unexpected module bytes: '+n)
    return current

def publish_modules(b):
    require((ROOT/'published.json').exists(), 'Publish compatible host first')
    if not (ROOT/'host-after.json').exists():shutil.copyfile(ROOT/'after.json',ROOT/'host-after.json');shutil.copyfile(ROOT/'published.json',ROOT/'host-published.json')
    module_state(b);publisher=load_publisher();results=[]
    for game,row in sorted(b.M['packages'].items()):
        pointer=Path('/opt/royal-game-modules')/game/'active.json'
        options=types.SimpleNamespace(operation='install',package=str(ROOT/'packages'/game),game=game,root='/opt/royal-game-modules',state=str(b.STATE),expected_sha=b.OLD['moduleFiles'][str(pointer)])
        if sha(pointer)==row['pointerSha256']:
            publisher.verify(pointer.parent/'versions'/row['version'],row['contract'],game);results.append({'gameId':game,'version':row['version'],'verified':True,'alreadyPublished':True})
        else:
            result=publisher.run(options);require(result['verified'] and sha(pointer)==row['pointerSha256'],'Published pointer differs');results.append(result)
        save('module-publication.json',results)
    after=module_state(b);require(after['moduleFiles']==expected_modules(b.M),'Final module inventory differs')
    result={**read(ROOT/'host-published.json'),'packages':results,'activeGames':SCOPE['activeGames'],'addedGames':[],'restoredGames':[],'backendUnchanged':True,'databaseTouched':False,'freeAfter':after['availableBytes']}
    save('after.json',after);save('published.json',result);return result

def rollback_all(b):
    if (ROOT/'host-after.json').exists():
        module_state(b);publisher=load_publisher()
        for game,row in read(ROOT/'module-backup.json').items():
            pointer=Path('/opt/royal-game-modules')/game/'active.json'
            if sha(pointer)==row['pointerSha256']:continue
            require(sha(pointer)==b.M['packages'][game]['pointerSha256'],'Later module prevents rollback')
            old=pointer.parent/'versions'/row['version']
            if not old.exists():shutil.copytree(b.BACKUP/'modules'/game/'package',old,copy_function=os.link)
            publisher.run(types.SimpleNamespace(operation='rollback',version=row['version'],game=game,root=str(pointer.parent.parent),state=str(b.STATE),expected_sha=sha(pointer)))
        b.OLD['moduleFiles']=b.snapshot()['moduleFiles']
    return b.rollback()

def release_all(b):
    built=b.build()
    backup_modules(b)
    host=b.publish()
    published=publish_modules(b)
    return {'build':built,'host':host,'published':published}

def main():
    require(len(sys.argv)==2 and sys.argv[1] in ['check','build','publish','modules','release','rollback'],'Unexpected operation')
    operation=sys.argv[1]
    b=configure();b.payload();locks=[]
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(),'Deployment lock symlink rejected');handle=open(name,'a');fcntl.flock(handle,fcntl.LOCK_EX|(0 if operation=='release' else fcntl.LOCK_NB));locks.append(handle)
    for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]:signal.signal(number,lambda n,f:(_ for _ in ()).throw(InterruptedError(str(n))))
    if operation=='check':b.baseline();result={'ready':True}
    elif operation=='build':result=b.build();backup_modules(b)
    elif operation=='publish':backup_modules(b);result=b.publish()
    elif operation=='modules':result=publish_modules(b)
    elif operation=='release':result=release_all(b)
    else:result=rollback_all(b)
    print(json.dumps(result),flush=True)
if __name__=='__main__':main()
