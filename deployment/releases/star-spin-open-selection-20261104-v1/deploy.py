"""Publish free companion selection without changing financial or client host programs."""
import sys
sys.dont_write_bytecode = True
import copy, fcntl, hashlib, importlib.util, json, re, signal, types
from pathlib import Path

NAME = 'star-spin-open-selection-20261104-v1'
ROOT = Path(__file__).resolve().parent
GAME = 'studio-wild-nudge'


def require(value, reason):
    if not value: raise RuntimeError(reason)


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_text())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def validate_inputs(projection, before, changed, preserved=None):
    for name, digest in projection['inputs'].items():
        selected = (preserved or {}).get(name) or changed.get(name)
        allowed = [selected] if selected else [before['source'].get(name), before['sourceLF'].get(name)]
        require(digest in [v for v in allowed if v], 'Unrelated build input: ' + name)


def expected_modules(m):
    result = dict(m['before']['moduleFiles']); p = m['package']
    prefix = '/opt/royal-game-modules/' + GAME + '/versions/' + p['version'] + '/'
    result.update({prefix + n: h for n, h in p['files'].items()})
    result['/opt/royal-game-modules/' + GAME + '/active.json'] = p['pointerSha256']
    return result


def validate_after(app, after, modules):
    expected, compared = copy.deepcopy(app), copy.deepcopy(after)
    expected['moduleFiles'] = modules
    for key in ['at', 'availableBytes']:
        expected.pop(key, None); compared.pop(key, None)
    require(compared == expected, 'Unrelated production change during module activation')


def validate_module_config(baseline, selected):
    expected = copy.deepcopy(baseline)
    expected['compilerOptions']['resolveJsonModule'] = True
    require(selected == expected, 'Unreviewed module compiler configuration')


def validate_frontend_advance(prepared, current, evidence, allowed):
    require(evidence['release'] == allowed['release'] and evidence['sourceChanges'] == allowed['sourceChanges'], 'Unreviewed frontend release')
    require(current['sourceCommit'] == current['sourceRevision'] == evidence['sourceCommit'], 'Frontend source differs')
    require(current['container']['image'] == current['preparedImage'] == evidence['image'] and current['container']['health'] == 'healthy', 'Frontend image differs')
    delta = evidence['clientDelta']
    require('index.html' in delta and all(n == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', n) for n in delta), 'Foreign frontend artifact')
    for key in ['runtimeHash','mounts','host','composeFiles']:
        require(current['container'][key] == prepared['container'][key], 'Frontend runtime settings changed')
    require(current['serviceProfiles']['royal-game-1']['profileSha256'] == prepared['serviceProfiles']['royal-game-1']['profileSha256'], 'Frontend service settings changed')
    expected = copy.deepcopy(prepared)
    for key in ['source','sourceLF']: expected[key].update(evidence['sourceChanges'])
    for key in ['program','preparedProgram']: expected[key].update({'dist/' + n: h for n,h in delta.items()})
    for key in ['sourceCommit','sourceRevision','container','preparedImage']: expected[key] = current[key]
    expected['services']['/royal-game-1'] = current['services']['/royal-game-1']
    expected['serviceProfiles']['royal-game-1'] = current['serviceProfiles']['royal-game-1']
    compared = copy.deepcopy(current)
    for key in ['at','availableBytes']: expected.pop(key,None); compared.pop(key,None)
    require(compared == expected, 'Unrelated change during frontend baseline advance')


def payload(b):
    m, old, scope = b.M, b.OLD, read(ROOT / 'scope.json')
    prepared = m.get('preparedBefore', old)
    if old['sourceCommit'] != prepared['sourceCommit']:
        validate_frontend_advance(prepared, old, m['frontendAdvance'], scope['allowedFrontendAdvance'])
    require(ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(b.CHANGES == scope['expectedSources'] and not b.DELTA and set(b.SERVER_DELTA) == {'index.js'}, 'Unreviewed program or source scope')
    require(m['addedGames'] == [] and m['restoredGames'] == [], 'Catalogue expansion rejected')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline runtime differs')
    require(old['program']['dist-server/index.js'] == scope['baselineBackendSha256'], 'Backend baseline differs')
    require(sha(ROOT / 'deploy.py') == m['helperSha256'] and sha(ROOT / 'snapshot.py') == m['snapshotSha256'], 'Installer changed')
    require(sha(ROOT / 'scope.json') == m['scopeSha256'] and sha(ROOT / 'installer-github.json') == m['helperReceiptSha256'], 'Installer evidence changed')
    helper = read(ROOT / 'installer-github.json')
    require(re.fullmatch(r'[a-f0-9]{40}', m['helperSourceCommit']) and helper['sourceCommit'] == m['helperSourceCommit'] and helper['applicationSourceCommit'] == m['sourceCommit'], 'Installer source is unverified')
    require(all(n.startswith('deployment/releases/' + NAME + '/') for n in helper['changedOnlyReleaseTooling']), 'Installer changed application sources')
    expected_support = {'application-overlay.py','overlay-base.py','snapshot-base.py','image_metadata.py','runtime-inventory.cjs','quiesce.cjs','financial_gate.py','engine-build.py','publisher.py'}
    require(set(m['support']) == expected_support, 'Unexpected helper scope')
    for name, digest in m['support'].items():
        require(not (ROOT / name).is_symlink() and sha(ROOT / name) == digest, 'Support helper changed')
    require(b.inventory(ROOT / 'source') == b.CHANGES and b.inventory(ROOT / 'dist-delta') == {} and b.inventory(ROOT / 'server-delta') == b.SERVER_DELTA, 'Payload differs')
    release, receipt = read(ROOT / 'release-manifest.json'), read(ROOT / 'release-github.json')
    require(sha(ROOT / 'release-manifest.json') == m['releaseManifestSha256'] and sha(ROOT / 'release-github.json') == m['receiptSha256'], 'Release evidence changed')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit'] and release['baseCommit'] == prepared['sourceCommit'] and m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(receipt['manifestSha256'] == m['releaseManifestSha256'], 'Receipt is not bound to artifact')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Verified application required')
    for key in ['hostProjection', 'backendProjection']:
        require(release[key] == release['build'][key] and release[key]['productionCommit'] == prepared['sourceCommit'], 'Projection evidence differs')
    validate_inputs(release['hostProjection'], prepared, {})
    validate_inputs(release['backendProjection'], old, b.CHANGES, scope['preservedBackendInputs'])
    backend = release['backendProjection']
    require(backend['entries'] == ['server/index.ts'] and backend['inputs']['server/starSpinCollection.ts'] == b.CHANGES['server/starSpinCollection.ts'], 'Wrong backend input')
    require(backend['output']['path'] == 'dist-server/index.js' and backend['output']['sha256'] == b.SERVER_DELTA['index.js'] == release['files']['dist-server/index.js'], 'Unverified backend bytes')
    module = release['build']['moduleProjection']
    require(set(module['modules']) == {GAME} and module['productionCommit'] == prepared['sourceCommit'], 'Unrequested module projection')
    config = m['moduleBuildConfiguration']
    require(config['baselineSha256'] == old['sourceLF']['tsconfig.json'] and sha(ROOT / 'baseline-tsconfig.json') == config['baselineSha256'], 'Baseline compiler source differs')
    require(config['selectedSha256'] == scope['moduleBuildInputs']['tsconfig.json'] and sha(ROOT / 'module-tsconfig.json') == config['selectedSha256'], 'Module compiler source differs')
    validate_module_config(read(ROOT / 'baseline-tsconfig.json'), read(ROOT / 'module-tsconfig.json'))
    validate_inputs(module, old, b.CHANGES, scope['moduleBuildInputs'])
    for name, digest in release['files'].items():
        if name.startswith('dist/'):
            require(prepared['program'].get(name) == digest, 'Prepared client host differs: ' + name)
    p = m['package']; target = scope['module']
    require(p['version'] == target['version'] and p['contract'] == target['contract'] == old['moduleHost']['games'][GAME], 'Incompatible module')
    require(p['manifestSha256'] == target['manifestSha256'] and p['pointerSha256'] == target['pointerSha256'], 'Unreviewed package')
    require(b.inventory(ROOT / 'package') == p['files'] and sha(ROOT / 'active.json') == p['pointerSha256'] and sha(ROOT / 'package/manifest.json') == p['manifestSha256'], 'Package bytes differ')
    prefix = 'module-dist/' + GAME + '/versions/' + p['version'] + '/'
    require(all(release['files'].get(prefix + n) == h for n, h in p['files'].items()), 'Package differs from verified artifact')
    require(m['support']['publisher.py'] in [old['source']['scripts/game-module-release.py'], old['sourceLF']['scripts/game-module-release.py']], 'Publisher changed')


def configure():
    m = read(ROOT / 'install-manifest.json')
    for name, digest in m['support'].items():
        require(not (ROOT / name).is_symlink() and sha(ROOT / name) == digest, 'Guarded helper changed')
    guard = load('selection_application_overlay', ROOT / 'application-overlay.py')
    guard.NAME, guard.ROOT, guard.payload = NAME, ROOT, payload
    b = guard.configure(ROOT)
    original_settings = b.settings
    b.recovering_module = False
    def settings(state, recovery=False):
        if b.recovering_module:
            retained = expected_modules(m)
            pointer = '/opt/royal-game-modules/' + GAME + '/active.json'
            retained[pointer] = m['before']['moduleFiles'][pointer]
            require(state['moduleFiles'] == retained, 'Foreign module change prevents recovery')
            state = {**state, 'moduleFiles': m['before']['moduleFiles']}
        original_settings(state, recovery=recovery)
    b.settings = settings
    return b


def rollback(b):
    current = b.snapshot()
    validate_after(read(ROOT / 'application-after.json'), current, expected_modules(b.M))
    publisher = load('selection_rollback_publisher', ROOT / 'publisher.py')
    result = publisher.run(types.SimpleNamespace(operation='rollback', version=b.M['previousVersion'], game=GAME, root='/opt/royal-game-modules', state=str(b.STATE), expected_sha=b.M['package']['pointerSha256']))
    pointer = '/opt/royal-game-modules/' + GAME + '/active.json'
    require(result['verified'] and sha(pointer) == b.OLD['moduleFiles'][pointer], 'Prior pointer differs')
    b.recovering_module = True
    return b.rollback()


def finish_module(b):
    # The backend is already healthy. A failed module install keeps this compatible
    # backend and permits a retry only against the exact verified application.
    app = read(ROOT / 'application-after.json')
    current = b.snapshot()
    expected = copy.deepcopy(app)
    installed = expected_modules(b.M)
    require(current['moduleFiles'] in [app['moduleFiles'], installed], 'Foreign module change prevents activation')
    expected['moduleFiles'] = current['moduleFiles']
    for key in ['at', 'availableBytes']:
        expected.pop(key, None); current.pop(key, None)
    require(current == expected and current['container']['health'] == 'healthy', 'Application changed before module activation')
    pointer = Path('/opt/royal-game-modules') / GAME / 'active.json'
    if sha(pointer) != b.M['package']['pointerSha256']:
        publisher = load('selection_publisher', ROOT / 'publisher.py')
        result = publisher.run(types.SimpleNamespace(operation='install', package=str(ROOT / 'package'), game=GAME, root='/opt/royal-game-modules', state=str(b.STATE), expected_sha=b.OLD['moduleFiles'][str(pointer)]))
        require(result['verified'] and result['published'] and sha(pointer) == b.M['package']['pointerSha256'], 'Module activation differs')
        b.write('module-publication.json', result)
    after = b.snapshot()
    validate_after(app, after, installed)
    b.write('after.json', after)
    result = read(ROOT / 'published.json')
    result.update(package=b.M['package']['version'], modulePublished=True, addedGames=[], restoredGames=[], otherModulesPreserved=True)
    b.write('published.json', result)
    return result


def main():
    require(sys.argv[1:] in [['release'], ['finish-module'], ['rollback']], 'Unexpected operation')
    b = configure(); b.payload(); locks = []
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        require(not Path(name).is_symlink(), 'Deployment lock symlink rejected')
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(handle)
    def interrupted(number, frame): raise InterruptedError('Deployment interrupted: ' + str(number))
    for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
    if sys.argv[1] == 'rollback':
        print(json.dumps(rollback(b)), flush=True)
        return
    if sys.argv[1] == 'release':
        print(json.dumps(b.build()), flush=True)
        print(json.dumps(b.publish()), flush=True)
        b.write('application-after.json', read(ROOT / 'after.json'))
    print(json.dumps(finish_module(b)), flush=True)


if __name__ == '__main__': main()
