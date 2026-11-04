"""Publish the connected front and rear walking through the existing guarded installer."""
import sys
sys.dont_write_bytecode = True
import fcntl, hashlib, importlib.util, json, os, re, signal, time, uuid
from contextlib import ExitStack, contextmanager
from pathlib import Path

NAME = 'front-back-walk-20261104-v3'
ROOT = Path(__file__).resolve().parent
SOURCES = {'src/game/characters.ts', 'src/game/avatarArt.ts', 'src/game/frontalWalk.ts'}
SUPPORT = {'application-overlay.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'financial_gate.py', 'engine-build.py'}
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

def validate_scope(changes, server_delta, projection, before):
    require(set(changes) == SOURCES and not server_delta, 'Only the reviewed profile animation client may change')
    for name, digest in projection['inputs'].items():
        allowed = [changes[name]] if name in changes else [before['source'].get(name), before['sourceLF'].get(name)]
        require(digest in [value for value in allowed if value], 'Unrelated host input changed: ' + name)
    require(all(projection['inputs'].get(name) == changes[name] for name in SOURCES), 'Profile source not bound to build')

def payload(base):
    m, old = base.M, base.OLD
    require(ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(set(m['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in m['support'].items():
        require(not (ROOT / name).is_symlink() and sha(ROOT / name) == digest, 'Support helper changed')
    require(sha(ROOT / 'deploy.py') == m['helperSha256'] and sha(ROOT / 'snapshot.py') == m['snapshotSha256'], 'Installer changed')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline runtime differs')
    require(base.inventory(ROOT / 'source') == m['changed'] and base.inventory(ROOT / 'dist-delta') == m['delta']
            and base.inventory(ROOT / 'server-delta') == m['serverDelta'], 'Payload inventory differs')
    require('index.html' in m['delta'], 'Missing client index')
    for name, digest in m['delta'].items():
        base.safe_name(name)
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client artifact')
        require(name == 'index.html' or 'dist/' + name not in old['program'] or old['program']['dist/' + name] == digest, 'Immutable URL collision')
    for name in m['changed']: base.safe_name(name)
    release = json.loads((ROOT / 'release-manifest.json').read_text())
    receipt = json.loads((ROOT / 'release-github.json').read_text())
    require(sha(ROOT / 'release-manifest.json') == m['releaseManifestSha256'] == receipt['manifestSha256']
            and sha(ROOT / 'release-github.json') == m['receiptSha256'], 'Release evidence changed')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit']
            and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Release verification missing')
    require(all(release['files'].get('dist/' + name) == digest for name, digest in m['delta'].items()), 'Client differs from verified build')
    graph = release['hostProjection']
    require(graph == release['build']['hostProjection'] and graph['productionCommit'] == m['baseCommit'], 'Host evidence differs')
    validate_scope(m['changed'], m['serverDelta'], graph, old)

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

def configure():
    spec = importlib.util.spec_from_file_location('profile_walk_application', ROOT / 'application-overlay.py')
    application = importlib.util.module_from_spec(spec); spec.loader.exec_module(application)
    application.NAME, application.SOURCES, application.payload = NAME, SOURCES, payload
    base = application.configure(ROOT)
    base.healthy = lambda: wait_for_healthy(base)
    return base

def wait_for_ready(root, nonce, timeout=3600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready = root / 'reservation-ready.json'
        if ready.exists():
            require(not ready.is_symlink(), 'Ready marker symlink rejected')
            marker = json.loads(ready.read_text())
            require(marker['reservation'] == nonce, 'Stale reservation marker')
            require(marker['installManifestSha256'] == sha(root / 'install-manifest.json'), 'Ready marker is not bound to the payload')
            return
        time.sleep(2)
    raise TimeoutError('Reserved preparation exceeded its deadline')

def install_prepared(status, reuse_candidate=False):
    base = configure(); base.payload()
    try:
        with publication_locks():
            base.payload()
            require(not (ROOT / 'published.json').exists() and (ROOT / 'build-result.json').exists() == reuse_candidate,
                    'Release stage changed during preparation')
            status('publishing_existing_candidate' if reuse_candidate else 'installing', publicationLocksHeld=True)
            # build() and publish() retain their full baseline and financial guards.
            if not reuse_candidate: print(json.dumps(base.build()), flush=True)
            print(json.dumps(base.publish()), flush=True)
    except PublicationBusy:
        status('publication_busy', publicationLocksHeld=False)
        raise
    except BaseException as error:
        status('failed', publicationLocksHeld=False, error=str(error)[:300])
        raise
    status('published', publicationLocksHeld=False)


def reserve_release(reuse_candidate=False):
    require(ROOT == Path('/opt/royal-releases') / NAME and not ROOT.is_symlink(), 'Unexpected reservation root')
    require(not (ROOT / 'published.json').exists() and (ROOT / 'build-result.json').exists() == reuse_candidate, 'Unexpected release stage')
    require(reuse_candidate or not (ROOT / 'reservation-ready.json').exists(), 'Old ready marker exists')
    nonce, bootstrap, removed = uuid.uuid4().hex, sha(ROOT / 'deploy.py'), []
    def status(stage, **extra):
        state = {'reservation': nonce, 'pid': os.getpid(), 'stage': stage, 'at': time.time(), 'publicationLocksHeld':False, 'bootstrapSha256': bootstrap, 'removedSupersededClientFiles': removed, **extra}
        (ROOT / 'reservation-status.json').write_text(json.dumps(state))
        print(json.dumps(state), flush=True)
    if not (ROOT / 'install-manifest.json').exists():
        require(not reuse_candidate and not (ROOT / 'dist-delta').exists(), 'Unexpected bootstrap files')
        status('preparing_without_publication_locks')
        wait_for_ready(ROOT, nonce)
        require(sha(ROOT / 'deploy.py') == bootstrap, 'Reserved installer changed')
        install_prepared(status); return
    old = json.loads((ROOT / 'install-manifest.json').read_text())
    require(old['release'] == NAME, 'Foreign staged payload')
    if reuse_candidate:
        failure = json.loads((ROOT / 'publication-failed.json').read_text())
        recovered = json.loads((ROOT / 'recovered.json').read_text())
        require(failure == {'errorType': 'RuntimeError', 'reason': 'Game did not become healthy', 'daemonOutcomeUnknown': False, 'mutationStarted': True, 'databaseRestored': False}, 'Unexpected failed publication')
        require(recovered == {'restored': True, 'containerRestarted': True, 'databaseTouched': False, 'externalModulesPreserved': True}, 'Rollback was not verified')
        ready = ROOT / 'reservation-ready.json'
        marker = json.loads(ready.read_text())
        require(not ready.is_symlink() and marker['installManifestSha256'] == sha(ROOT / 'install-manifest.json'), 'Old marker is not bound to the previous payload')
        ready.unlink()
        status('preparing_without_publication_locks')
        wait_for_ready(ROOT, nonce)
        require(sha(ROOT / 'deploy.py') == bootstrap, 'Reserved installer changed')
        install_prepared(status, reuse_candidate=True); return
    require('index.html' in old['delta'] and not (ROOT / 'dist-delta').is_symlink(), 'Unexpected staged client directory')
    for name, digest in old['delta'].items():
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign staged client file')
        path = ROOT / 'dist-delta' / name
        require(not path.is_symlink() and not path.parent.is_symlink() and path.is_file() and sha(path) == digest, 'Staged client file changed')
        removed.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest})
    for item in removed: Path(item['path']).unlink()
    status('preparing_without_publication_locks', removedSupersededClientFiles=removed)
    wait_for_ready(ROOT, nonce)
    require(sha(ROOT / 'deploy.py') == bootstrap, 'Reserved installer changed')
    install_prepared(status)

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'release', 'rollback', 'reserve-release', 'reserve-publish'], 'Unexpected operation')
    if sys.argv[1] in ['reserve-release', 'reserve-publish']:
        def interrupted(number, frame): raise InterruptedError('Reserved deployment interrupted: ' + str(number))
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
        reserve_release(sys.argv[1] == 'reserve-publish'); return
    base = configure(); base.payload()
    def interrupted(number, frame): raise InterruptedError('Deployment interrupted: ' + str(number))
    for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
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


