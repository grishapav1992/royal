"""Publish the Caribbean voyage backend. The client, modules, settings and player data stay in place."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
NAME = 'caribbean-voyage-20261125-v1'
ROOT = Path(__file__).resolve().parent
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py',
           'engine-build.py', 'scope.json'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(name):
    path = ROOT / name
    require(path.is_file() and not path.is_symlink(), 'Unsafe release file: ' + name)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(base, scope):
    m, old = base.M, base.OLD
    require(m['release'] == NAME and m['addedGames'] == m['restoredGames'] == []
            and m['activeGames'] == scope['activeBefore'], 'Catalogue scope changed')
    require(base.CHANGES == scope['backend'] and set(base.SERVER_DELTA) == {'index.js'} and base.DELTA == {},
            'Unexpected release scope')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline differs')
    for name, key in [('deploy.py', 'helperSha256'), ('snapshot.py', 'snapshotSha256'),
                      ('release-manifest.json', 'releaseManifestSha256'), ('release-github.json', 'receiptSha256')]:
        require(sha(name) == m[key], 'Reviewed file differs: ' + name)
    for folder, files in [('source', base.CHANGES), ('dist-delta', {}), ('server-delta', base.SERVER_DELTA)]:
        require(base.inventory(ROOT / folder) == files, 'Payload differs: ' + folder)
        for name in files:
            base.safe_name(name)
    release = json.loads((ROOT / 'release-manifest.json').read_text())
    receipt = json.loads((ROOT / 'release-github.json').read_text())
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit']
            and receipt['manifestSha256'] == m['releaseManifestSha256']
            and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Unverified build')
    for key, changed, build_only in [('hostProjection', {}, {}),
                                     ('backendProjection', scope['backend'], scope['backendBuildInputs'])]:
        projection = release[key]
        require(projection == release['build'][key] and projection['productionCommit'] == m['baseCommit'],
                'Projection evidence differs: ' + key)
        inputs = projection['inputs']
        require(all(inputs.get(file) == digest for file, digest in changed.items()), 'Reviewed input missing: ' + key)
        for file, digest in inputs.items():
            require(digest in (changed.get(file), build_only.get(file), old['source'].get(file), old['sourceLF'].get(file)),
                    'Foreign input: ' + file)
    require(release['backendProjection']['entries'] == ['server/index.ts']
            and release['backendProjection']['output'] == {'path': 'dist-server/index.js', 'sha256': base.SERVER_DELTA['index.js']}
            and release['files']['dist-server/index.js'] == base.SERVER_DELTA['index.js'], 'Backend bytes differ')
    require(all(old['program'].get(path) == digest for path, digest in release['files'].items() if path.startswith('dist/')),
            'The verified client differs from the running client')


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in
            [['check'], ['release'], ['publish'], ['rollback']], 'Unexpected release path or operation')
    manifest = json.loads((ROOT / 'install-manifest.json').read_text())
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in manifest['support'].items():
        require(sha(name) == digest, 'Support file changed: ' + name)
    scope = json.loads((ROOT / 'scope.json').read_text())
    spec = importlib.util.spec_from_file_location('caribbean_voyage_production_guard', ROOT / 'production-guard.py')
    production = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(production)
    production.ROOT, production.NAME = ROOT, NAME
    production.payload = lambda base: validate(base, scope)
    try:
        production.main()
    except production.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
