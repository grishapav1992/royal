"""Restore the reviewed baseline after v1 stopped before its Compose command."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
FAILED = Path('/opt/royal-releases/royal-stake-100-20261122-v1')
MODULES = Path('/opt/royal-game-modules')
MANIFEST_SHA = '02b8f5fe5ec9748bae7b9cb11b690a39bdd8332f49d92e9a29f5ae67d9ae53cd'


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def sha(file):
    require(file.is_file() and not file.is_symlink(), 'Unsafe recovery input: ' + str(file))
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read(name):
    return json.loads((FAILED / name).read_bytes())


def load(name):
    spec = importlib.util.spec_from_file_location('verified_' + name, FAILED / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def recovery_inventory(base, manifest, current, built):
    old = manifest['before']
    require(current['container'] == old['container'] and current['program'] == old['program'],
            'Healthy original host identity or program differs')
    require(current['preparedImage'] in [old['preparedImage'], built['image']], 'Unexpected prepared image')
    require(set(old['source']).issubset(current['source'])
            and set(current['source']).issubset(set(old['source']) | set(base.CHANGES)), 'Unexpected source inventory')
    for name, digest in current['source'].items():
        require(digest in (old['source'].get(name), base.CHANGES.get(name)), 'Unexpected source bytes: ' + name)
    expected = dict(old['moduleFiles'])
    changed = {}
    added = {}
    for game, package in manifest['packages'].items():
        pointer = str(MODULES / game / 'active.json')
        version_root = MODULES / game / 'versions' / package['version']
        versions = {str(version_root / file): digest for file, digest in package['files'].items()}
        if any(path in current['moduleFiles'] and path not in expected for path in versions):
            require(all(current['moduleFiles'].get(path) == digest for path, digest in versions.items()),
                    'Partial or different installed module bytes: ' + game)
            added.update({path: digest for path, digest in versions.items() if path not in expected})
        if current['moduleFiles'].get(pointer) == package['pointerSha256'] and expected[pointer] != package['pointerSha256']:
            require(all(current['moduleFiles'].get(path) == digest for path, digest in versions.items()),
                    'New pointer has different module bytes: ' + game)
            expected[pointer] = package['pointerSha256']
            changed[game] = package
    require(current['moduleFiles'] == {**expected, **added}, 'Unreviewed module inventory change')
    base.settings({**current, 'moduleFiles': old['moduleFiles']})
    return changed, added


def main():
    require(ROOT == FAILED.with_name('royal-stake-100-20261122-v2') and not sys.argv[1:], 'Unexpected recovery operation')
    require(sha(FAILED / 'install-manifest.json') == MANIFEST_SHA, 'Failed release inventory differs')
    manifest = read('install-manifest.json')
    require(sha(FAILED / 'deploy.py') == manifest['helperSha256'], 'Failed release installer differs')
    require(sha(FAILED / 'production-guard.py') == manifest['support']['production-guard.py'], 'Production guard differs')
    require(sha(FAILED / 'image_metadata.py') == manifest['support']['image_metadata.py'], 'Image reader differs')
    sys.path.insert(0, str(FAILED))
    guard = load('production-guard.py')
    guard.ROOT, guard.NAME = FAILED, FAILED.name
    try:
        with guard.publication_locks():
            require(not (FAILED / 'published.json').exists(), 'Release reached a published state')
            failure, observed = read('publication-failed.json'), read('reconciliation.json')
            require(failure == {'errorType': 'GateError', 'reason': 'Financial gate confirmation became stale',
                    'daemonOutcomeUnknown': True, 'mutationStarted': True, 'databaseRestored': False}, 'Unexpected failure')
            require(observed['observationsMatch'] and observed['game']['image'] == manifest['before']['preparedImage']
                    and observed['game']['id'] == manifest['before']['container']['id'], 'Unresolved host identity')
            base = guard.configure(FAILED)
            original = load('deploy.py')
            original.validate(base, read('scope.json'), sha)
            publisher = load('publisher.py')
            built = read('build-result.json')
            base.backup_guard(built)
            stale, added = recovery_inventory(base, manifest, base.snapshot(), built)
            old = manifest['before']
            with tempfile.TemporaryDirectory(prefix='restore-v1-', dir=ROOT) as folder:
                backup = base.BACKUP / 'source.tgz'
                with tarfile.open(backup) as archive:
                    for entry in archive.getmembers():
                        target = Path(folder) / entry.name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(archive.extractfile(entry).read())
                        target.chmod(entry.mode & 0o777)
                gate = base.quiet_gate()
                try:
                    for game, package in reversed(list(stale.items())):
                        gate.confirm()
                        result = publisher.run(SimpleNamespace(operation='rollback', game=game, package=None,
                            version=package['previousVersion'], root=str(MODULES), state=str(base.STATE),
                            expected_sha=package['pointerSha256']))
                        require(result['activeSha256'] == package['previousPointerSha256'], 'Rollback pointer differs: ' + game)
                    for name in base.CHANGES:
                        gate.check()
                        original_path = Path(folder) / name
                        if name in old['source']:
                            base.atomic(original_path, base.LIVE / name)
                        else:
                            (base.LIVE / name).unlink(missing_ok=True)
                    gate.run(['docker', 'tag', old['preparedImage'], 'royal-game:latest'])
                    gate.release()
                finally:
                    gate.close()
            after = base.snapshot()
            base.settings({**after, 'moduleFiles': old['moduleFiles']})
            require(after['moduleFiles'] == {**old['moduleFiles'], **added} and after['source'] == old['source']
                    and after['container'] == old['container'] and after['program'] == old['program']
                    and after['preparedImage'] == old['preparedImage'], 'Recovered baseline differs')
            result = {'restored': True, 'containerRestarted': False, 'databaseTouched': False,
                      'restoredModules': sorted(stale), 'retainedImmutableModuleFiles': len(added),
                      'image': old['preparedImage'], 'sourceCommit': old['sourceCommit'], 'failedCommit': manifest['sourceCommit']}
            base.write('recovered.json', result)
            print(json.dumps(result), flush=True)
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
