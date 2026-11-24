"""Publish the first Dragon Path package, scoped host, and virtual wallet backend."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True
NAME = 'dragon-path-20261124-v1'
ROOT = Path(__file__).resolve().parent
MODULES = Path('/opt/royal-game-modules')
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py',
           'engine-build.py', 'publisher.py', 'scope.json'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(file):
    require(file.is_file() and not file.is_symlink(), 'Unsafe release file: ' + str(file))
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read(name):
    return json.loads((ROOT / name).read_bytes())


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate(base, scope, publisher):
    manifest, old = base.M, base.OLD
    game = scope['game']
    require(manifest['release'] == NAME and manifest['addedGames'] == [game]
            and manifest['restoredGames'] == [] and manifest['activeGames'] == [game, *scope['activeBefore']],
            'Unexpected catalogue scope')
    require(base.CHANGES == scope['sources'] and set(base.SERVER_DELTA) == {'index.js'}, 'Unexpected source scope')
    require(old['preparedProgram'] == old['program'] and old['preparedImage'] == old['container']['image'], 'Baseline differs')
    for name, key in [('deploy.py', 'helperSha256'), ('snapshot.py', 'snapshotSha256'),
                      ('release-manifest.json', 'releaseManifestSha256'), ('release-github.json', 'receiptSha256'),
                      ('installer-github.json', 'installerReceiptSha256')]:
        require(sha(ROOT / name) == manifest[key], 'Reviewed file differs: ' + name)
    installer, release, receipt = [read(name) for name in ['installer-github.json', 'release-manifest.json', 'release-github.json']]
    require(re.fullmatch('[a-f0-9]{40}', installer['sourceCommit']) and re.fullmatch('[a-f0-9]{40}', installer['remoteMain'])
            and installer['applicationSourceCommit'] == manifest['sourceCommit']
            and installer['files'] == {'deploy.py': sha(ROOT / 'deploy.py'), 'quiesce.cjs': sha(ROOT / 'quiesce.cjs')},
            'Installer source receipt differs')
    require(release['sourceCommit'] == receipt['sourceCommit'] == manifest['sourceCommit']
            and release['baseCommit'] == manifest['baseCommit'] == old['sourceCommit']
            and receipt['manifestSha256'] == manifest['releaseManifestSha256'], 'Release GitHub receipt differs')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Release not verified')
    for folder, files in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
        require(base.inventory(ROOT / folder) == files, 'Payload inventory differs: ' + folder)
        for name in files:
            base.safe_name(name)
    for key, changed, build_only in [('hostProjection', scope['host'], {}),
                                     ('backendProjection', scope['backend'], scope['backendBuildInputs'])]:
        projection = release[key]
        require(projection == release['build'][key] and projection['productionCommit'] == manifest['baseCommit'],
                'Projection evidence differs: ' + key)
        inputs = projection['inputs']
        require(all(inputs.get(file) == digest for file, digest in changed.items()), 'Reviewed input missing: ' + key)
        for file, digest in inputs.items():
            require(digest in (changed.get(file), build_only.get(file), old['source'].get(file), old['sourceLF'].get(file)),
                    'Foreign input: ' + file)
    require(release['backendProjection']['output'] == {'path': 'dist-server/index.js', 'sha256': base.SERVER_DELTA['index.js']}
            and release['files']['dist-server/index.js'] == base.SERVER_DELTA['index.js'], 'Backend bytes differ')
    expected = {path[5:]: digest for path, digest in release['files'].items()
                if path.startswith('dist/') and old['program'].get(path) != digest}
    require(base.DELTA == {**expected, **scope['media']} and 'index.html' in expected, 'Unexpected client delta')
    for name in base.DELTA:
        require(name == 'index.html' or ('dist/' + name not in old['program'] and
                (name in scope['media'] or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name))), 'Foreign asset: ' + name)
    require(game not in old['moduleHost']['games'] and not any(path.startswith(str(MODULES / game) + '/')
            for path in old['moduleFiles']), 'Existing package prevents first publication')
    require(sha(ROOT / 'host-contracts.json') == manifest['hostContractsSha256']
            and read('host-contracts.json') == {**old['moduleHost'], 'games': {**old['moduleHost']['games'], game: scope['contract']}},
            'Host contract delta differs')
    package = manifest['package']
    require(release['packages'] == [{'gameId': game, 'version': package['version'],
            'pointer': 'module-dist/' + game + '/active.json'}], 'Unexpected built package')
    metadata, _ = publisher.verify(ROOT / 'package', scope['contract'], game)
    require(metadata['version'] == package['version'] and base.inventory(ROOT / 'package') == package['files'], 'Game package differs')
    prefix = 'module-dist/' + game + '/versions/' + package['version'] + '/'
    require(all(release['files'].get(prefix + file) == digest for file, digest in package['files'].items())
            and release['files'].get('module-dist/' + game + '/active.json') == package['pointerSha256'], 'Unverified package bytes')


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in [['release'], ['rollback']], 'Unexpected release operation')
    manifest, scope = read('install-manifest.json'), read('scope.json')
    require(set(manifest['support']) == SUPPORT, 'Support scope differs')
    for name, digest in manifest['support'].items():
        require(sha(ROOT / name) == digest, 'Support file differs: ' + name)
    guard = load('dragon_path_production_guard', 'production-guard.py')
    guard.ROOT, guard.NAME = ROOT, NAME
    base = guard.configure(ROOT)
    publisher = load('dragon_path_module_publisher', 'publisher.py')
    require(manifest['support']['publisher.py'] == base.OLD['source']['scripts/game-module-release.py'], 'Publisher differs from production')
    base.payload = lambda: validate(base, scope, publisher)
    game = scope['game']
    pointer = MODULES / game / 'active.json'
    backup = base.BACKUP / 'host-contracts.json'
    package = manifest['package']
    version = MODULES / game / 'versions' / package['version']
    versions = {str(version / file): digest for file, digest in package['files'].items()}
    prior_modules = base.OLD['moduleFiles']
    current_modules = {**prior_modules, **versions, str(pointer): package['pointerSha256']}
    prior_contract = base.OLD['moduleHostContract']
    current_contract = manifest['hostContractsSha256']
    original_build, original_backup = base.build, base.backup_guard
    original_compose, original_settings, original_rollback = base.compose, base.settings, base.rollback
    module_installed = False
    rolling_back = False

    def verify_backup(built):
        original_backup(built)
        require(sha(backup) == prior_contract == built['moduleContractBackupSha256'], 'Rollback module contract differs')

    def build():
        result = original_build()
        require(sha(base.HOST) == prior_contract, 'Host contract changed before backup')
        base.atomic(base.HOST, backup)
        built = read('build-result.json')
        base.write('build-result.json', {**built, 'moduleContractBackupSha256': sha(backup)})
        return result

    def settings(state, recovery=False):
        modules = current_modules if module_installed else prior_modules
        contract = current_contract if module_installed else prior_contract
        require(state['moduleFiles'] == modules and state['moduleHostContract'] == contract, 'Unexpected module state')
        original_settings({**state, 'moduleFiles': prior_modules, 'moduleHostContract': prior_contract}, recovery=recovery)

    def compose(gate):
        nonlocal module_installed
        if not rolling_back:
            gate.check()
            require(sha(base.HOST) == prior_contract and not pointer.exists(), 'First publication baseline changed')
            base.atomic(ROOT / 'host-contracts.json', base.HOST)
            result = publisher.run(SimpleNamespace(operation='install', game=game, package=ROOT / 'package',
                                                   root=MODULES, state=base.STATE, expected_sha='none'))
            module_installed = True
            require(result['activeSha256'] == package['pointerSha256'], 'Installed pointer differs')
            base.write('module-result.json', result)
        return original_compose(gate)

    def rollback():
        nonlocal module_installed, rolling_back
        state = base.snapshot(recovery=True)
        module_installed = state['moduleFiles'] == current_modules and state['moduleHostContract'] == current_contract
        settings(state, recovery=True)
        rolling_back = True
        original_gate = base.quiet_gate
        gate = original_gate()
        try:
            base.quiet_gate = lambda: gate
            result = original_rollback()
            if module_installed:
                require(sha(pointer) == package['pointerSha256'] and sha(base.HOST) == current_contract, 'Module changed before rollback')
                pointer.unlink()
                base.atomic(backup, base.HOST)
                state = base.snapshot()
                require(state['moduleFiles'] == {**prior_modules, **versions}
                        and state['moduleHostContract'] == prior_contract, 'Rollback module state differs')
            return result
        finally:
            base.quiet_gate = original_gate
            gate.close()

    base.build, base.backup_guard = build, verify_backup
    base.compose, base.settings, base.rollback = compose, settings, rollback
    base.payload()
    try:
        with guard.publication_locks():
            if sys.argv[1] == 'release':
                print(json.dumps(base.build()), flush=True)
                print(json.dumps(base.publish()), flush=True)
            else:
                print(json.dumps(base.rollback()), flush=True)
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
