"""Install the scoped player progression host and backend with the production guard."""
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
NAME = 'player-level-feedback-20261107-v1'
ROOT = Path(__file__).resolve().parent
SUPPORT = {
    'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
    'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py', 'engine-build.py',
}


def main():
    spec = importlib.util.spec_from_file_location('production_guard', ROOT / 'production-guard.py')
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    require = guard.require
    require(ROOT == Path('/opt/royal-releases') / NAME, 'Unexpected release directory')
    guard.ROOT, guard.NAME = ROOT, NAME
    guard.MEDIA = {}

    def payload(base):
        m, old = base.M, base.OLD
        sha = lambda name: guard.sha(ROOT / name)
        require(m['release'] == NAME and not m['addedGames'] and not m['restoredGames'], 'Unexpected catalogue scope')
        require(set(m['support']) == SUPPORT, 'Unexpected helper scope')
        for name, field in [('deploy.py', 'helperSha256'), ('snapshot.py', 'snapshotSha256'),
                            ('scope.json', 'scopeSha256'), ('installer-github.json', 'helperReceiptSha256'),
                            ('release-manifest.json', 'releaseManifestSha256'), ('release-github.json', 'receiptSha256')]:
            require(not (ROOT / name).is_symlink() and sha(name) == m[field], 'Release evidence changed: ' + name)
        scope = json.loads((ROOT / 'scope.json').read_bytes())
        helper = json.loads((ROOT / 'installer-github.json').read_bytes())
        release = json.loads((ROOT / 'release-manifest.json').read_bytes())
        receipt = json.loads((ROOT / 'release-github.json').read_bytes())
        require(helper['applicationSourceCommit'] == m['sourceCommit'] and helper['sourceCommit'] == m['helperSourceCommit'],
                'Installer source differs')
        require(helper['changedOnlyReleaseTooling'] and all(
            name.startswith('deployment/releases/' + NAME + '/') for name in helper['changedOnlyReleaseTooling']),
                'Installer changed application sources')
        require(release['scope'] == 'application' and release['clean'] and release['build']['passed']
                and release['githubVerified'] and receipt['manifestSha256'] == m['releaseManifestSha256'],
                'Unverified application build')
        require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit']
                and release['baseCommit'] == old['sourceCommit'] == m['baseCommit'], 'Wrong release origin')
        require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'],
                'Baseline image or program differs')
        inputs = scope['inputs']
        require(base.CHANGES == {n: h for n, h in scope['changed'].items() if n not in inputs['module']},
                'Unexpected application source scope')
        guard.SOURCES = set(base.CHANGES)
        for kind, key in [('host', 'hostProjection'), ('backend', 'backendProjection')]:
            projection = release[key]
            require(projection == release['build'][key] and projection['productionCommit'] == m['baseCommit'],
                    'Wrong projection origin')
            guard.validate_inputs(base.CHANGES, projection, old, inputs[kind],
                                  scope['preservedBackendInputs'] if kind == 'backend' else None)
        require('index.html' in base.DELTA and set(base.SERVER_DELTA) == {'index.js'}, 'Incomplete application overlay')
        require(base.SERVER_DELTA['index.js'] == release['backendProjection']['output']['sha256']
                == release['files']['dist-server/index.js'], 'Backend bytes differ')
        guard.validate_media(base.CHANGES, base.DELTA)
        for name, digest in base.DELTA.items():
            path = 'dist/' + name
            require(name == 'index.html' or path not in old['program'], 'Immutable URL collision: ' + name)
            require(release['files'].get(path) == digest, 'Client bytes differ: ' + name)
        for folder, expected in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
            require(base.inventory(ROOT / folder) == expected, 'Unexpected payload: ' + folder)
            for name in expected:
                base.safe_name(name)

    guard.payload = payload
    try:
        guard.main()
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
