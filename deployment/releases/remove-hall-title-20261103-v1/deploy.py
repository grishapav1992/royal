"""Remove two wall labels using the existing guarded application installer."""
import sys
sys.dont_write_bytecode = True
import fcntl, hashlib, importlib.util, json, re, signal
from pathlib import Path

NAME = 'remove-hall-title-20261103-v1'
ROOT = Path(__file__).resolve().parent
SOURCE = 'src/game/interiorArt.ts'

def require(value, reason):
    if not value: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def validate_inputs(changes, projection, before):
    require(set(changes) == {SOURCE}, 'Unreviewed source scope')
    require(projection['inputs'].get(SOURCE) == changes[SOURCE], 'Wall source is not bound to build')
    for name, digest in projection['inputs'].items():
        allowed = [changes[name]] if name in changes else [before['source'].get(name), before['sourceLF'].get(name)]
        require(digest in allowed, 'Unrelated host input changed: ' + name)

def payload(b):
    m, old = b.M, b.OLD
    require(b.ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(set(b.CHANGES) == {SOURCE} and b.SERVER_DELTA == {}, 'Unreviewed source or backend change')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline runtime differs')
    require(sha(ROOT / 'deploy.py') == m['helperSha256'] and sha(ROOT / 'snapshot.py') == m['snapshotSha256'], 'Installer changed')
    require(set(m['support']) == {'application-overlay.py','overlay-base.py','snapshot-base.py','image_metadata.py','runtime-inventory.cjs','quiesce.cjs','financial_gate.py','engine-build.py'}, 'Unexpected helper scope')
    for name, digest in m['support'].items():
        require(not (ROOT / name).is_symlink() and sha(ROOT / name) == digest, 'Support helper changed')
    require(b.inventory(ROOT / 'source') == b.CHANGES and b.inventory(ROOT / 'dist-delta') == b.DELTA and b.inventory(ROOT / 'server-delta') == {}, 'Payload differs')
    require('index.html' in b.DELTA, 'Missing client index')
    for name, digest in b.DELTA.items():
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client artifact')
        require(name == 'index.html' or 'dist/' + name not in old['program'] or old['program']['dist/' + name] == digest, 'Immutable URL collision')
    release = json.loads((ROOT / 'release-manifest.json').read_text())
    receipt = json.loads((ROOT / 'release-github.json').read_text())
    require(sha(ROOT / 'release-manifest.json') == m['releaseManifestSha256'] and sha(ROOT / 'release-github.json') == m['receiptSha256'], 'Release evidence changed')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit'] and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Release verification missing')
    require(all(release['files'].get('dist/' + n) == h for n, h in b.DELTA.items()), 'Client differs from verified build')
    projection = release['hostProjection']
    require(projection == release['build']['hostProjection'] and projection['productionCommit'] == m['baseCommit'], 'Host evidence differs')
    validate_inputs(b.CHANGES, projection, old)
    source = (ROOT / 'source' / SOURCE).read_text()
    require("translateText('КАЗИНО И БАР')" not in source and "translateText('НОВЫЕ ИГРЫ · GITHUB · ДЕМОКАТАЛОГИ')" not in source, 'Wall labels remain')

def configure():
    m = json.loads((ROOT / 'install-manifest.json').read_text())
    for name, digest in m['support'].items():
        require(not (ROOT / name).is_symlink() and sha(ROOT / name) == digest, 'Support helper changed')
    spec = importlib.util.spec_from_file_location('wall_application_overlay', ROOT / 'application-overlay.py')
    guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
    guard.NAME, guard.ROOT, guard.payload = NAME, ROOT, payload
    return guard.configure(ROOT)

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check','build','publish','release','rollback'], 'Unexpected operation')
    base = configure(); base.payload()
    locks = []
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(), 'Deployment lock symlink rejected')
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(handle)
    def interrupted(number, frame): raise InterruptedError('Deployment interrupted: ' + str(number))
    for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(number,interrupted)
    if sys.argv[1] == 'check': base.baseline(); print(json.dumps({'ready': True}), flush=True)
    elif sys.argv[1] == 'release':
        print(json.dumps(base.build()), flush=True); print(json.dumps(base.publish()), flush=True)
    else: print(json.dumps(getattr(base, sys.argv[1])()), flush=True)

if __name__ == '__main__': main()
