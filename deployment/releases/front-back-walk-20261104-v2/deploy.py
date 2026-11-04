"""Publish the connected front and rear walking through the existing guarded installer."""
import sys
sys.dont_write_bytecode = True
import copy, fcntl, hashlib, importlib.util, json, re, signal
from pathlib import Path

NAME = 'front-back-walk-20261104-v1'
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

def validate_runtime_advance(prepared, current, evidence, allowed):
    require(evidence['release'] == allowed['release'] == 'star-spin-open-selection-20261104-v1', 'Unreviewed concurrent release')
    for key in ['sourceCommit', 'sourceChanges', 'serverDelta', 'moduleFiles']:
        require(evidence[key] == allowed[key], 'Concurrent release evidence differs: ' + key)
    require(current['sourceCommit'] == current['sourceRevision'] == evidence['sourceCommit'], 'Concurrent source differs')
    require(current['container']['image'] == current['preparedImage'] == evidence['image'] and current['container']['health'] == 'healthy', 'Concurrent image differs')
    require(set(evidence['serverDelta']) == {'index.js'}, 'Concurrent backend scope differs')
    for key in ['runtimeHash', 'mounts', 'host', 'composeFiles']:
        require(current['container'][key] == prepared['container'][key], 'Runtime settings changed')
    require(current['serviceProfiles']['royal-game-1']['profileSha256'] == prepared['serviceProfiles']['royal-game-1']['profileSha256'], 'Service settings changed')
    expected = copy.deepcopy(prepared)
    for key in ['source', 'sourceLF']: expected[key].update(evidence['sourceChanges'])
    for key in ['program', 'preparedProgram']: expected[key].update({'dist-server/' + name: digest for name, digest in evidence['serverDelta'].items()})
    expected['moduleFiles'].update(evidence['moduleFiles'])
    for key in ['sourceCommit', 'sourceRevision', 'container', 'preparedImage']: expected[key] = current[key]
    expected['services']['/royal-game-1'] = current['services']['/royal-game-1']
    expected['serviceProfiles']['royal-game-1'] = current['serviceProfiles']['royal-game-1']
    compared = copy.deepcopy(current)
    for key in ['at', 'availableBytes']: expected.pop(key, None); compared.pop(key, None)
    require(compared == expected, 'Unrelated change during concurrent baseline advance')

def payload(base):
    m, old = base.M, base.OLD
    prepared = m.get('preparedBefore', old)
    require(ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(sha(ROOT / 'scope.json') == m['scopeSha256'] and sha(ROOT / 'installer-github.json') == m['helperReceiptSha256'], 'Installer evidence changed')
    scope = json.loads((ROOT / 'scope.json').read_text())
    helper = json.loads((ROOT / 'installer-github.json').read_text())
    require(re.fullmatch(r'[a-f0-9]{40}', m['helperSourceCommit']) and helper['sourceCommit'] == m['helperSourceCommit'] and helper['applicationSourceCommit'] == m['sourceCommit'], 'Installer source is unverified')
    require(helper['changedOnlyReleaseTooling'] and all(name.startswith('deployment/releases/' + NAME + '/') for name in helper['changedOnlyReleaseTooling']), 'Installer changed application sources')
    if old['sourceCommit'] != prepared['sourceCommit']:
        validate_runtime_advance(prepared, old, m['runtimeAdvance'], scope['allowedRuntimeAdvance'])
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
            and release['baseCommit'] == prepared['sourceCommit'] and m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Release verification missing')
    require(all(release['files'].get('dist/' + name) == digest for name, digest in m['delta'].items()), 'Client differs from verified build')
    graph = release['hostProjection']
    require(graph == release['build']['hostProjection'] and graph['productionCommit'] == prepared['sourceCommit'], 'Host evidence differs')
    validate_scope(m['changed'], m['serverDelta'], graph, old)

def configure():
    spec = importlib.util.spec_from_file_location('profile_walk_application', ROOT / 'application-overlay.py')
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


