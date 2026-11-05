"""Publish the Mira countertop and seated-rest corrections through the guarded installer."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
from contextlib import ExitStack, contextmanager
import fcntl, hashlib, json, re, signal, time, types, subprocess, importlib.util
from image_metadata import image, inspect

NAME = 'mira-counter-rest-20261105-v3'
ROOT = Path(__file__).resolve().parent
SOURCES = set(["src/game/MiraRig.ts","src/game/miraAnimation.ts","src/game/royalBarArt.ts","src/game/royalBarLayers.ts","src/shared/miraRoutine.ts"])
HOST_REQUIRED = SOURCES
BACKEND_REQUIRED = {'src/shared/miraRoutine.ts'}
PRESERVED_BACKEND_INPUTS = {"src/i18n/en.ts":"e6a39483750df92467b584e98319ce679f2a3489669e4b0d3f64a2d7ba0a762c"}

MEDIA = {}

LOCKS = ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']

class PublicationBusy(RuntimeError):
    pass


@contextmanager
def publication_locks():
    with ExitStack() as stack:
        for name in LOCKS:
            require(not Path(name).is_symlink(), 'Deployment lock symlink rejected')
            handle = stack.enter_context(open(name, 'a'))
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise PublicationBusy('Publication is busy; keep the prepared package and retry release or publish later') from error
        yield

def require(value, reason):
    if not value: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def wait_for_healthy(base, timeout=300, now=None, pause=None):
    now, pause = now or time.monotonic, pause or time.sleep
    deadline = now() + timeout
    while now() < deadline:
        state = json.loads(base.run(['docker', 'inspect', 'royal-game-1']))[0]['State']
        require(state.get('Running') is True, 'Game exited during startup')
        if state.get('Health', {}).get('Status') == 'healthy':
            result = json.loads(base.run(['docker', 'exec', 'royal-game-1', 'node', '-e',
                "fetch('http://127.0.0.1:2567/healthz').then(async r=>{if(!r.ok)process.exit(1);const d=await r.json();if(d.ok!==true)process.exit(1);console.log(JSON.stringify({ok:true}));}).catch(()=>process.exit(1))"]))
            require(result.get('ok') is True, 'Game health endpoint failed')
            return
        pause(1)
    raise RuntimeError('Game did not become healthy within the startup deadline')

def validate_inputs(changes, projection, before, required, preserved=None):
    require(set(changes) == SOURCES, 'Unreviewed Mira source scope')
    for name, digest in projection['inputs'].items():
        expected = [preserved[name]] if preserved and name in preserved else [changes[name]] if name in changes else [before['source'].get(name), before['sourceLF'].get(name)]
        require(digest in expected, 'Unrelated host input changed: ' + name)
    require(all(projection['inputs'].get(name) == changes[name] for name in required), 'Mira source is not bound to the build')

def validate_media(changes, delta):
    require(all(delta.get(name) == changes.get('public/' + name) == digest for name,digest in MEDIA.items()), 'Media differs from committed source')
    for name in delta:
        require(name == 'index.html' or name in MEDIA or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client artifact')

def configure(root=ROOT):
    def interrupted(number, frame): raise InterruptedError('Deployment interrupted: ' + str(number))
    for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(number,interrupted)
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
    base.healthy = lambda: wait_for_healthy(base)
    base.payload = lambda: payload(base)
    return base

def payload(b):
    m, old = b.M, b.OLD
    require(m.get('addedGames') == [] and m.get('restoredGames') == [], 'Catalogue expansion is outside this release')
    require(b.ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(set(b.CHANGES) == SOURCES and set(b.SERVER_DELTA) == {'index.js'}, 'Unreviewed source or backend change')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline runtime differs')
    require(sha(b.ROOT / 'deploy.py') == m['helperSha256'] and sha(b.ROOT / 'snapshot.py') == m['snapshotSha256'], 'Installer changed')
    require(set(m['support']) == {'overlay-base.py','snapshot-base.py','image_metadata.py','runtime-inventory.cjs','quiesce.cjs','financial_gate.py','engine-build.py'}, 'Unexpected helper scope')
    for name, digest in m['support'].items(): require(sha(b.ROOT / name) == digest, 'Support changed')
    require(b.inventory(b.ROOT / 'source') == b.CHANGES and b.inventory(b.ROOT / 'dist-delta') == b.DELTA and b.inventory(b.ROOT / 'server-delta') == b.SERVER_DELTA, 'Payload differs')
    require(len(b.DELTA) == 2 and 'index.html' in b.DELTA
            and any(re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.js', name) for name in b.DELTA),
            'Expected one changed client script and the client index')
    validate_media(b.CHANGES,b.DELTA)
    for name, digest in b.DELTA.items():
        require(name == 'index.html' or name in MEDIA or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client artifact')
        require(name == 'index.html' or 'dist/' + name not in old['program'] or old['program']['dist/' + name] == digest, 'Immutable URL collision')
    release = json.loads((b.ROOT / 'release-manifest.json').read_text()); receipt = json.loads((b.ROOT / 'release-github.json').read_text())
    require(sha(b.ROOT / 'release-manifest.json') == m['releaseManifestSha256'] and sha(b.ROOT / 'release-github.json') == m['receiptSha256'], 'Release evidence changed')
    helper = json.loads((b.ROOT / 'installer-github.json').read_text())
    require(sha(b.ROOT / 'installer-github.json') == m['helperReceiptSha256'], 'Installer GitHub evidence changed')
    require(helper['sourceCommit'] == m['helperSourceCommit'] and helper['applicationSourceCommit'] == m['sourceCommit'], 'Installer source differs')
    require(helper['changedOnlyReleaseTooling'] and all(name.startswith('deployment/releases/' + NAME + '/') for name in helper['changedOnlyReleaseTooling']), 'Installer changed application sources')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit'] and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Release verification missing')
    media = json.loads((b.ROOT / 'media-github.json').read_text())
    require(sha(b.ROOT / 'media-github.json') == m['mediaReceiptSha256'], 'Media receipt changed')
    require(media['sourceCommit'] == m['sourceCommit'] and media['assets'] == {'public/'+n:h for n,h in MEDIA.items()}, 'Media is not bound to the application source')
    require(all((MEDIA.get(n) if n in MEDIA else release['files'].get('dist/' + n)) == h for n, h in b.DELTA.items()), 'Client differs from verified build or source media')
    projection = release['hostProjection']
    require(projection == release['build']['hostProjection'] and projection['productionCommit'] == m['baseCommit'], 'Host evidence differs')
    validate_inputs(b.CHANGES, projection, old, HOST_REQUIRED)
    backend = release['backendProjection']
    require(backend == release['build']['backendProjection'] and backend['productionCommit'] == m['baseCommit'], 'Backend evidence differs')
    require(backend['entries'] == ['server/index.ts'] and backend['output']['path'] == 'dist-server/index.js', 'Unexpected backend entry')
    require(backend['output']['sha256'] == b.SERVER_DELTA['index.js'] == release['files']['dist-server/index.js'], 'Backend differs from verified build')
    validate_inputs(b.CHANGES, backend, old, BACKEND_REQUIRED, PRESERVED_BACKEND_INPUTS)

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check','build','publish','release','rollback'], 'Unexpected operation')
    base = configure(); base.payload()
    with publication_locks():
        base.payload()
        if sys.argv[1] == 'check': base.baseline(); print(json.dumps({'ready': True}))
        elif sys.argv[1] == 'release':
            print(json.dumps(base.build()), flush=True); print(json.dumps(base.publish()), flush=True)
        else: print(json.dumps(getattr(base, sys.argv[1])()))

if __name__ == '__main__':
    try: main()
    except PublicationBusy as error:
        print(json.dumps({'status':'publication_busy','publicationLocksHeld':False,'error':str(error)}), file=sys.stderr)
        sys.exit(75)
