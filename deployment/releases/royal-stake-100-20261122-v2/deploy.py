"""Publish the already verified Royal stake build with supervised module switches."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys

sys.dont_write_bytecode = True
NAME = 'royal-stake-100-20261122-v2'
ROOT = Path(__file__).resolve().parent
FAILED = ROOT.with_name('royal-stake-100-20261122-v1')
MODULES = Path('/opt/royal-game-modules')
PROOF_HELPER = Path('/opt/royal-maintenance/bin/retention-runtime.py')

PUBLISH_MODULE = '''
import importlib.util, json, sys
from types import SimpleNamespace
sys.dont_write_bytecode = True
helper, game, package, root, state, expected = sys.argv[1:]
spec = importlib.util.spec_from_file_location('module_publisher', helper)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
args = SimpleNamespace(operation='install', game=game, package=package, version=None,
                       root=root, state=state, expected_sha=expected)
print(json.dumps(publisher.run(args)))
'''


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def sha(file):
    require(file.is_file() and not file.is_symlink(), 'Unsafe release input: ' + str(file))
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read(file, root=ROOT):
    return json.loads((root / file).read_bytes())


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def previous(base, manifest):
    require(sha(FAILED / 'install-manifest.json') == manifest['previousInstallSha256'], 'Predecessor manifest differs')
    require(sha(FAILED / 'recovered.json') == manifest['recoverySha256'], 'Baseline recovery evidence differs')
    old_install = read('install-manifest.json', FAILED)
    recovery = read('recovered.json', FAILED)
    for key in ['sourceCommit', 'baseCommit', 'changed', 'delta', 'serverDelta', 'packages',
                'releaseManifestSha256', 'receiptSha256', 'activeGames', 'addedGames', 'restoredGames']:
        require(old_install[key] == manifest[key], 'Reviewed application payload differs: ' + key)
    require(recovery['restored'] and recovery['image'] == base.OLD['preparedImage']
            and recovery['sourceCommit'] == base.OLD['sourceCommit'], 'Predecessor baseline was not restored')
    for key in ['container', 'program', 'preparedProgram', 'preparedImage', 'source', 'serviceProfiles', 'configHashes']:
        require(base.OLD[key] == old_install['before'][key], 'Recovered baseline differs: ' + key)
    original = old_install['before']['moduleFiles']
    actual = base.OLD['moduleFiles']
    earned = {}
    for game in recovery['restoredModules']:
        pkg = manifest['packages'][game]
        prefix = str(MODULES / game / 'versions' / pkg['version']) + '/'
        earned.update({prefix + file: digest for file, digest in pkg['files'].items() if prefix + file not in original})
    require(len(earned) == recovery['retainedImmutableModuleFiles'] and actual == {**original, **earned},
            'Unexpected additions outside the restored pointer set')
    return read('build-result.json', FAILED)


def prepare(base, guard, old_build):
    base.payload()
    base.baseline()
    require(not (ROOT / 'build-result.json').exists() and not base.BACKUP.exists(), 'Preparation already staged')
    candidate = old_build['image']
    require(old_build['sourceCommit'] == base.M['sourceCommit'] and old_build['program'] == base.expected_program()
            and base.image('royal-game:' + FAILED.name) == candidate, 'Prepared application changed')
    require(PROOF_HELPER.is_file() and not PROOF_HELPER.is_symlink(), 'Immutable image proof reader unavailable')
    proof_reader = load('royal_retention_runtime', PROOF_HELPER)
    image_proof = proof_reader.verify_image_program(candidate, base.PROGRAM, old_build['program'])
    base.publication_capacity()
    base.BACKUP.mkdir(mode=0o700)
    prior_backup = base.BACKUP.with_name(FAILED.name)
    for name in ['source.tgz', 'index.html']:
        expected = old_build['sourceBackupSha256'] if name == 'source.tgz' else base.OLD['program']['dist/index.html']
        require(sha(prior_backup / name) == expected, 'Rollback backup differs: ' + name)
        (base.BACKUP / name).hardlink_to(prior_backup / name)
    base.verify_tar(base.BACKUP / 'source.tgz')
    for suffix in ['', '-prepared']:
        base.run(['docker', 'tag', base.OLD['preparedImage'], 'royal-game:before-' + NAME + suffix])
    base.run(['docker', 'tag', candidate, 'royal-game:' + NAME])
    backup = guard.financial_backup(base)
    result = {**old_build, 'backup': str(base.BACKUP), 'financialBackup': backup, 'reusedImageProof': image_proof}
    base.write('build-result.json', result)
    base.backup_guard(result)
    print(json.dumps({'built': True, 'reusedImage': candidate, 'sourceCommit': result['sourceCommit']}), flush=True)


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in [['prepare'], ['release']], 'Unexpected release operation')
    manifest, receipt = read('install-manifest.json'), read('installer-github.json')
    require(sha(ROOT / 'installer-github.json') == manifest['installerReceiptSha256']
            and re.fullmatch('[a-f0-9]{40}', receipt['sourceCommit'])
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and receipt['applicationSourceCommit'] == manifest['sourceCommit']
            and receipt['files'] == {'deploy.py': sha(ROOT / 'deploy.py'), 'recover-v1.py': sha(ROOT / 'recover-v1.py')},
            'Installer source receipt differs')
    for file, digest in manifest['support'].items():
        require(sha(ROOT / file) == digest, 'Support helper differs: ' + file)
    validator = load('royal_stake_evidence', ROOT / 'validator.py')
    require(set(manifest['support']) == validator.SUPPORT | {'validator.py', 'recover-v1.py'}, 'Unexpected support scope')
    validator.ROOT, validator.NAME = ROOT, NAME
    guard = load('verified_production_guard', ROOT / 'production-guard.py')
    guard.ROOT, guard.NAME = ROOT, NAME
    base = guard.configure(ROOT)
    scope = read('scope.json')
    base.payload = lambda: validator.validate(base, scope, sha)
    old_build = previous(base, manifest)
    publisher = load('verified_module_publisher', ROOT / 'publisher.py')
    require(manifest['support']['publisher.py'] == base.OLD['source']['scripts/game-module-release.py'], 'Publisher differs')
    packages = manifest['packages']
    baseline_settings, compose_host, rollback_host = base.settings, base.compose, base.rollback
    expected = dict(base.OLD['moduleFiles'])
    installed = []
    rolling_back = False

    def settings(state, recovery=False):
        require(state['moduleFiles'] == expected, 'Unexpected module inventory change')
        baseline_settings({**state, 'moduleFiles': base.OLD['moduleFiles']}, recovery=recovery)

    def compose(gate):
        if not rolling_back:
            for game, pkg in packages.items():
                response = json.loads(gate.run([sys.executable, '-c', PUBLISH_MODULE, str(ROOT / 'publisher.py'),
                    game, str(ROOT / 'packages' / game), str(MODULES), str(base.STATE), pkg['previousPointerSha256']]))
                prefix = str(MODULES / game / 'versions' / pkg['version']) + '/'
                expected.update({prefix + file: digest for file, digest in pkg['files'].items()})
                expected[str(MODULES / game / 'active.json')] = pkg['pointerSha256']
                installed.append(game)
                require(response['activeSha256'] == pkg['pointerSha256'], 'Installed pointer differs: ' + game)
        return compose_host(gate)

    def rollback():
        from types import SimpleNamespace
        nonlocal rolling_back
        rolling_back = True
        for game in reversed(installed):
            pkg = packages[game]
            response = publisher.run(SimpleNamespace(operation='rollback', game=game, package=None,
                version=pkg['previousVersion'], root=str(MODULES), state=str(base.STATE), expected_sha=pkg['pointerSha256']))
            require(response['activeSha256'] == pkg['previousPointerSha256'], 'Rollback pointer differs: ' + game)
            expected[str(MODULES / game / 'active.json')] = pkg['previousPointerSha256']
        return rollback_host()

    base.settings, base.compose, base.rollback = settings, compose, rollback
    if sys.argv[1] == 'prepare':
        for game, pkg in packages.items():
            publisher.verify(ROOT / 'packages' / game, pkg['contract'], game)
            publisher.verify(MODULES / game / 'versions' / pkg['previousVersion'], pkg['contract'], game)
        prepare(base, guard, old_build)
        return
    try:
        with guard.publication_locks():
            result = base.publish()
            result.update(updatedModules=installed, addedGames=[], restoredGames=[])
            base.write('published.json', result)
            print(json.dumps(result), flush=True)
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
