"""Publish only the reviewed Royal sign-in changes."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
NAME = 'password-login-20261119-v1'
ROOT = Path(__file__).resolve().parent
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py',
           'engine-build.py', 'scope.json'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(name):
    path = ROOT / name
    require(path.is_file() and not path.is_symlink(), 'Unexpected evidence path: ' + name)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((ROOT / name).read_text())


def validate(base, guard, scope):
    manifest, before = base.M, base.OLD
    require(manifest['release'] == NAME and manifest['addedGames'] == manifest['restoredGames'] == [],
            'Unexpected release or catalogue change')
    require(before['program'] == before['preparedProgram']
            and before['container']['image'] == before['preparedImage']
            and before['program']['dist-server/index.js'] == scope['oldBackendDigest'], 'Baseline differs')
    require(set(base.CHANGES) == guard.SOURCES and set(base.SERVER_DELTA) == {'index.js'}
            and 'index.html' in base.DELTA, 'Unexpected payload scope')
    for path, expected in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
        require(base.inventory(ROOT / path) == expected, 'Payload inventory changed: ' + path)
        for name in expected:
            base.safe_name(name)
    for name, key in [('deploy.py', 'helperSha256'), ('snapshot.py', 'snapshotSha256'),
                      ('release-manifest.json', 'releaseManifestSha256'), ('release-github.json', 'receiptSha256')]:
        require(sha(name) == manifest[key], 'Release evidence changed: ' + name)
    release, receipt = read('release-manifest.json'), read('release-github.json')
    require(release['sourceCommit'] == receipt['sourceCommit'] == manifest['sourceCommit']
            and release['baseCommit'] == manifest['baseCommit'] == before['sourceCommit']
            and receipt['manifestSha256'] == manifest['releaseManifestSha256']
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and release['scope'] == 'application' and release['clean'] and release['build']['passed'],
            'Release is missing verified GitHub source and build evidence')
    for name, scope_key, preserved in [('hostProjection', 'host', {}),
                                       ('backendProjection', 'backend', scope['retainedBackendInputs'])]:
        projection = release[name]
        require(projection == release['build'][name] and projection['productionCommit'] == manifest['baseCommit'],
                'Projection differs: ' + name)
        guard.validate_inputs(base.CHANGES, projection, before, scope[scope_key], preserved)
    for game, file in scope['qualifications'].items():
        proof = read('source/' + file)
        require(proof['gameId'] == game and proof['serverReplayChecks'] > 0
                and proof['sourceHashes']['server/accounts.ts'] == release['backendProjection']['inputs']['server/accounts.ts'],
                'Qualification is not bound to account sources: ' + game)
    backend_path = 'dist-server/index.js'
    require(release['backendProjection']['output']['path'] == backend_path
            and release['backendProjection']['output']['sha256'] == release['files'][backend_path]
            == base.SERVER_DELTA['index.js'], 'Backend differs from verified build')
    expected = {path[5:]: digest for path, digest in release['files'].items()
                if path.startswith('dist/') and before['program'].get(path) != digest}
    require(base.DELTA == expected, 'Client delta differs from verified build')
    for name in expected:
        require(name == 'index.html' or ('dist/' + name not in before['program']
                                       and re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(js|css)', name)),
                'Unexpected asset or immutable URL collision: ' + name)


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME
            and sys.argv[1:] in [['release'], ['publish'], ['rollback']], 'Unexpected path or operation')
    manifest = read('install-manifest.json')
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in manifest['support'].items():
        require(sha(name) == digest, 'Support file changed: ' + name)
    scope = read('scope.json')
    spec = importlib.util.spec_from_file_location('production_guard', ROOT / 'production-guard.py')
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    guard.ROOT, guard.NAME, guard.SOURCES = ROOT, NAME, set(scope['host'] + scope['backend'] + list(scope['qualifications'].values()))
    guard.payload = lambda base: validate(base, guard, scope)
    try:
        guard.main()
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
