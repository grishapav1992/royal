"""Publish the connected front and rear walking through the existing guarded installer."""
import sys
sys.dont_write_bytecode = True
import fcntl, hashlib, importlib.util, json, os, re, signal, time, uuid
from pathlib import Path

NAME = 'front-back-walk-20261104-v2'
ROOT = Path(__file__).resolve().parent
SOURCES = {'src/game/characters.ts', 'src/game/avatarArt.ts', 'src/game/frontalWalk.ts'}
SUPPORT = {'application-overlay.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'financial_gate.py', 'engine-build.py'}

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

def configure():
    spec = importlib.util.spec_from_file_location('profile_walk_application', ROOT / 'application-overlay.py')
    application = importlib.util.module_from_spec(spec); spec.loader.exec_module(application)
    application.NAME, application.SOURCES, application.payload = NAME, SOURCES, payload
    return application.configure(ROOT)

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

def reserve_release(locks):
    require(ROOT == Path('/opt/royal-releases') / NAME and not ROOT.is_symlink(), 'Unexpected reservation root')
    require(not (ROOT / 'published.json').exists() and not (ROOT / 'build-result.json').exists(), 'Release already started')
    require(not (ROOT / 'reservation-ready.json').exists(), 'Old ready marker exists')
    nonce, bootstrap, removed = uuid.uuid4().hex, sha(ROOT / 'deploy.py'), []
    def status(stage, **extra):
        state = {'reservation': nonce, 'pid': os.getpid(), 'stage': stage, 'at': time.time(), 'bootstrapSha256': bootstrap, 'removedSupersededClientFiles': removed, **extra}
        (ROOT / 'reservation-status.json').write_text(json.dumps(state))
        print(json.dumps(state), flush=True)
    status('waiting_for_publication_locks')
    for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(), 'Deployment lock symlink rejected')
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX); locks.append(handle)
    require(not (ROOT / 'published.json').exists() and not (ROOT / 'build-result.json').exists(), 'Release already started while waiting')
    old = json.loads((ROOT / 'install-manifest.json').read_text())
    require(old['release'] == NAME, 'Foreign staged payload')
    require('index.html' in old['delta'] and not (ROOT / 'dist-delta').is_symlink(), 'Unexpected staged client directory')
    for name, digest in old['delta'].items():
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign staged client file')
        path = ROOT / 'dist-delta' / name
        require(not path.is_symlink() and not path.parent.is_symlink() and path.is_file() and sha(path) == digest, 'Staged client file changed')
        removed.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest})
    for item in removed: Path(item['path']).unlink()
    status('reserved_for_preparation', removedSupersededClientFiles=removed)
    wait_for_ready(ROOT, nonce)
    require(sha(ROOT / 'deploy.py') == bootstrap, 'Reserved installer changed')
    base = configure(); base.payload()
    status('installing')
    print(json.dumps(base.build()), flush=True); print(json.dumps(base.publish()), flush=True)
    status('published')

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'release', 'rollback', 'reserve-release'], 'Unexpected operation')
    if sys.argv[1] == 'reserve-release':
        locks = []
        def interrupted(number, frame): raise InterruptedError('Reserved deployment interrupted: ' + str(number))
        for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
        reserve_release(locks); return
    base = configure(); base.payload()
    locks = []
    for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(), 'Deployment lock symlink rejected')
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(handle)
    def interrupted(number, frame): raise InterruptedError('Deployment interrupted: ' + str(number))
    for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
    if sys.argv[1] == 'check': base.baseline(); print(json.dumps({'ready': True}))
    elif sys.argv[1] == 'release':
        print(json.dumps(base.build()), flush=True); print(json.dumps(base.publish()), flush=True)
    else: print(json.dumps(getattr(base, sys.argv[1])()))

if __name__ == '__main__': main()


