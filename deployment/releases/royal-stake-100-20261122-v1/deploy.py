"""Publish the qualified 100 USDT ceiling for the active Royal catalogue."""
import importlib.util
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True
NAME = 'royal-stake-100-20261122-v1'
ROOT = Path(__file__).resolve().parent
MODULE_ROOT = Path('/opt/royal-game-modules')
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py',
           'engine-build.py', 'publisher.py', 'scope.json'}


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def read(name):
    return json.loads((ROOT / name).read_bytes())


def validate(base, scope, sha):
    m, old = base.M, base.OLD
    require(m['release'] == NAME and m['addedGames'] == m['restoredGames'] == [], 'Unexpected release scope')
    require(m['activeGames'] == scope['activeGames'], 'Catalogue scope differs')
    require(m['changed'] == scope['sources'] and set(base.SERVER_DELTA) == {'index.js'}, 'Unexpected source or backend delta')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline differs')
    for name, key in [('deploy.py', 'helperSha256'), ('snapshot.py', 'snapshotSha256'),
                      ('release-manifest.json', 'releaseManifestSha256'), ('release-github.json', 'receiptSha256')]:
        require(sha(ROOT / name) == m[key], 'Reviewed input changed: ' + name)
    for folder, files in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
        require(base.inventory(ROOT / folder) == files, 'Payload inventory differs: ' + folder)
        for name in files:
            base.safe_name(name)
    release, receipt = read('release-manifest.json'), read('release-github.json')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit']
            and receipt['manifestSha256'] == m['releaseManifestSha256']
            and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Unverified build')
    require(release['hostProjection'] == release['build']['hostProjection'], 'Host evidence differs')
    backend = release['backendProjection']
    require(backend == release['build']['backendProjection']
            and backend['output']['sha256'] == base.SERVER_DELTA['index.js']
            == release['files']['dist-server/index.js'], 'Backend evidence differs')
    modules = release['build']['moduleProjection']
    used = set()
    for projection, exceptions in [(release['hostProjection'], {}), (backend, scope['preservedBackend']), (modules, scope['preservedModuleInputs'])]:
        require(projection['productionCommit'] == m['baseCommit'], 'Projection baseline differs')
        for name, digest in projection['inputs'].items():
            if name in scope['sources']:
                require(digest == scope['sources'][name], 'Edited source differs: ' + name)
                used.add(name)
            else:
                require(digest in (exceptions.get(name), old['source'].get(name), old['sourceLF'].get(name)),
                        'Unreviewed input: ' + name)
    require(used == set(scope['sources']), 'An edited source did not enter the build')
    expected = {path[5:]: digest for path, digest in release['files'].items()
                if path.startswith('dist/') and old['program'].get(path) != digest}
    require(base.DELTA == expected and 'index.html' in expected, 'Incomplete host delta')
    for name in expected:
        require(name == 'index.html' or ('dist/' + name not in old['program']
                and re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name)), 'Unreviewed host artifact: ' + name)
    require(set(m['packages']) == set(modules['modules']) == set(scope['games']), 'Module selection differs')
    require(set(scope['games']) == set(scope['activeGames']) and len(scope['activeGames']) == 19, 'Unexpected catalogue')
    for game, package in m['packages'].items():
        require(package['contract'] == old['moduleHost']['games'][game], 'Contract changed: ' + game)
        row = modules['modules'][game]
        require(row['version'] == package['version'] and row['files'] == {name: digest for name, digest in package['files'].items()
                if name != 'manifest.json'} and row['manifestSha256'] == package['files']['manifest.json'], 'Build package differs: ' + game)
        require(base.inventory(ROOT / 'packages' / game) == package['files'], 'Module inventory differs: ' + game)
        prefix = 'module-dist/' + game + '/versions/' + package['version'] + '/'
        require(all(release['files'].get(prefix + name) == digest for name, digest in package['files'].items()),
                'Module bytes are outside the release: ' + game)
        require(release['files'].get('module-dist/' + game + '/active.json') == package['pointerSha256'], 'Pointer differs: ' + game)
        live = str(MODULE_ROOT / game / 'active.json')
        require(old['moduleFiles'].get(live) == package['previousPointerSha256'], 'Previous pointer differs: ' + game)


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in [['prepare'], ['release']], 'Unexpected release operation')
    manifest, scope = read('install-manifest.json'), read('scope.json')
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    import hashlib
    def sha(path):
        require(not path.is_symlink(), 'Unexpected symlink: ' + str(path))
        return hashlib.sha256(path.read_bytes()).hexdigest()
    for file, digest in manifest['support'].items():
        require(sha(ROOT / file) == digest, 'Support changed: ' + file)
    production = load('game_labels_guard', 'production-guard.py')
    production.NAME, production.ROOT = NAME, ROOT
    base = production.configure(ROOT)
    base.payload = lambda: validate(base, scope, sha)
    publisher = load('game_labels_publisher', 'publisher.py')
    packages = manifest['packages']
    require(manifest['support']['publisher.py'] == base.OLD['source']['scripts/game-module-release.py'], 'Publisher changed')
    original_settings, original_compose, original_rollback = base.settings, base.compose, base.rollback
    expected_modules = dict(base.OLD['moduleFiles'])
    installed = []
    rolling_back = False

    def options(operation, game, package):
        return SimpleNamespace(operation=operation, game=game, package=str(ROOT / 'packages' / game),
                               version=package['previousVersion'], root=str(MODULE_ROOT), state=str(base.STATE),
                               expected_sha=package['previousPointerSha256'] if operation == 'install' else package['pointerSha256'])

    def settings(state, recovery=False):
        require(state['moduleFiles'] == expected_modules, 'Unexpected module inventory change')
        original_settings({**state, 'moduleFiles': base.OLD['moduleFiles']}, recovery=recovery)

    def compose(gate):
        if not rolling_back:
            for game, package in packages.items():
                gate.check()
                result = publisher.run(options('install', game, package))
                prefix = str(MODULE_ROOT / game / 'versions' / package['version']) + '/'
                expected_modules.update({prefix + name: digest for name, digest in package['files'].items()})
                expected_modules[str(MODULE_ROOT / game / 'active.json')] = package['pointerSha256']
                installed.append(game)
                require(result['activeSha256'] == package['pointerSha256'], 'Installed pointer differs: ' + game)
        return original_compose(gate)

    def rollback():
        nonlocal rolling_back
        rolling_back = True
        for game in reversed(installed):
            package = packages[game]
            result = publisher.run(options('rollback', game, package))
            require(result['activeSha256'] == package['previousPointerSha256'], 'Rollback pointer differs: ' + game)
            expected_modules[str(MODULE_ROOT / game / 'active.json')] = package['previousPointerSha256']
        return original_rollback()

    base.settings, base.compose, base.rollback = settings, compose, rollback
    if sys.argv[1] == 'prepare':
        base.payload()
        for game, package in packages.items():
            publisher.verify(ROOT / 'packages' / game, package['contract'], game)
            publisher.verify(MODULE_ROOT / game / 'versions' / package['previousVersion'], package['contract'], game)
        print(json.dumps(base.build()), flush=True)
        return
    try:
        with production.publication_locks():
            result = base.publish()
            result['updatedModules'] = installed
            result['addedGames'] = result['restoredGames'] = []
            base.write('published.json', result)
            print(json.dumps(result), flush=True)
    except production.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
