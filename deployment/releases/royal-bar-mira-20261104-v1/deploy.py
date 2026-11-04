"""Publish Royal Bar and the room-owned Mira timeline through the existing guarded installer."""
import sys
sys.dont_write_bytecode = True
import fcntl, hashlib, importlib.util, json, re, signal
from pathlib import Path

NAME = 'royal-bar-mira-20261104-v1'
ROOT = Path(__file__).resolve().parent
SOURCES = {"server/LobbyRoom.ts", "server/bartender.ts", "src/game/Bar.ts", "src/game/RoomScene.ts", "src/game/barArt.ts", "src/game/materials.ts", "src/game/miraCharacterArt.ts", "src/i18n/en.ts", "src/main.ts", "src/shared/clubLayout.ts", "src/shared/miraRoutine.ts", "src/shared/world.ts", "src/ui/MiraChat.ts", "src/ui/MiraPortrait.ts", "src/ui/SocialUI.ts"}
HOST_REQUIRED = {"src/game/Bar.ts", "src/game/RoomScene.ts", "src/game/barArt.ts", "src/game/materials.ts", "src/game/miraCharacterArt.ts", "src/i18n/en.ts", "src/main.ts", "src/shared/clubLayout.ts", "src/shared/miraRoutine.ts", "src/shared/world.ts", "src/ui/MiraChat.ts", "src/ui/MiraPortrait.ts", "src/ui/SocialUI.ts"}
BACKEND_REQUIRED = {"server/LobbyRoom.ts", "server/bartender.ts", "src/shared/clubLayout.ts", "src/shared/miraRoutine.ts", "src/shared/world.ts"}
PRESERVED_BACKEND_INPUTS = {"src/i18n/en.ts":"8853e5a8bd533ca85608eb11975f1f0d98a03fd0d1b749f48cca00e9db86cd68"}
SUPPORT = {'application-overlay.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'financial_gate.py', 'engine-build.py'}

def require(value, reason):
    if not value: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_scope(changes, server_delta, host, backend, before):
    require(set(changes) == SOURCES and set(server_delta) == {'index.js'}, 'Only Royal Bar, Mira and the main backend may change')
    for graph, required, preserved in [(host, HOST_REQUIRED, {}), (backend, BACKEND_REQUIRED, PRESERVED_BACKEND_INPUTS)]:
        for name, digest in graph['inputs'].items():
            selected = preserved.get(name) or changes.get(name)
            allowed = [selected] if selected else [before['source'].get(name), before['sourceLF'].get(name)]
            require(digest in [value for value in allowed if value], 'Unrelated build input changed: ' + name)
        require(all(graph['inputs'].get(name) == changes[name] for name in required), 'Required Mira source not bound to build')


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
    backend = release['backendProjection']
    require(backend == release['build']['backendProjection'] and backend['productionCommit'] == m['baseCommit'], 'Backend evidence differs')
    require(backend['entries'] == ['server/index.ts'] and backend['output']['path'] == 'dist-server/index.js', 'Unexpected backend entry')
    require(backend['output']['sha256'] == m['serverDelta']['index.js'] == release['files']['dist-server/index.js'], 'Backend differs from verified build')
    validate_scope(m['changed'], m['serverDelta'], graph, backend, old)

def configure():
    spec = importlib.util.spec_from_file_location('guard_profile_application', ROOT / 'application-overlay.py')
    application = importlib.util.module_from_spec(spec); spec.loader.exec_module(application)
    application.NAME, application.SOURCES, application.payload = NAME, SOURCES, payload
    return application.configure(ROOT)

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check', 'build', 'publish', 'release', 'rollback'], 'Unexpected operation')
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
