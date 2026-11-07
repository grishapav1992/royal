"""Publish Mira's counter rest cycle and its versioned atlas through the production guard."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
NAME = 'mira-counter-cycle-20261107-v1'
ROOT = Path(__file__).resolve().parent
CLIENT = {'src/game/Bar.ts', 'src/game/miraAnimation.ts', 'src/game/MiraRig.ts', 'src/shared/miraRoutine.ts'}
BACKEND = {'src/shared/miraRoutine.ts'}
# These backend translations already differ from the installed host translations.
PRESERVED_BACKEND = {"src/i18n/en.ts":"e6a39483750df92467b584e98319ce679f2a3489669e4b0d3f64a2d7ba0a762c","src/i18n/progressionEn.ts":"66c68ac05b3b362c4ef1dae60afaeb1c484d6ada0887adefd9954a4de12c1ba4"}
ATLAS = 'assets/royal-bar/v3/mira-seat-cycle.png'
ATLAS_SHA = '413967d35fcce83e46fac56cee52f236332d24bca64b66a291db6a2696427c4a'
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py', 'engine-build.py'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(name):
    path = ROOT / name
    require(not path.is_symlink(), 'Unexpected symlink: ' + name)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in
            [['release'], ['publish'], ['rollback']], 'Unexpected Mira release path or operation')
    manifest = json.loads((ROOT / 'install-manifest.json').read_text())
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in manifest['support'].items():
        require(sha(name) == digest, 'Support helper changed: ' + name)
    spec = importlib.util.spec_from_file_location('production_guard', ROOT / 'production-guard.py')
    production = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(production)
    production.ROOT, production.NAME = ROOT, NAME
    production.SOURCES = CLIENT | {'public/' + ATLAS}
    production.MEDIA = {ATLAS: ATLAS_SHA}

    def validate(base):
        m, old = base.M, base.OLD
        require(m['release'] == NAME and m['addedGames'] == m['restoredGames'] == [], 'Catalogue scope changed')
        require(set(base.SERVER_DELTA) == {'index.js'} and 'index.html' in base.DELTA, 'Unexpected application delta')
        require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline differs')
        require(sha('deploy.py') == m['helperSha256'] and sha('snapshot.py') == m['snapshotSha256'], 'Installer changed')
        for folder, expected in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
            require(base.inventory(ROOT / folder) == expected, 'Payload changed: ' + folder)
            for name in expected:
                base.safe_name(name)
        release = json.loads((ROOT / 'release-manifest.json').read_text())
        receipt = json.loads((ROOT / 'release-github.json').read_text())
        require(sha('release-manifest.json') == m['releaseManifestSha256'] == receipt['manifestSha256']
                and sha('release-github.json') == m['receiptSha256'], 'Release evidence changed')
        require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit']
                and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
        require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Unverified build')
        projection = release['hostProjection']
        require(projection == release['build']['hostProjection'] and projection['productionCommit'] == m['baseCommit'], 'Projection differs')
        production.validate_inputs(base.CHANGES, projection, old, CLIENT)
        backend = release['backendProjection']
        require(backend == release['build']['backendProjection'] and backend['productionCommit'] == m['baseCommit'], 'Backend projection differs')
        require(backend['entries'] == ['server/index.ts'] and backend['output']['path'] == 'dist-server/index.js', 'Unexpected backend entry')
        require(backend['output']['sha256'] == base.SERVER_DELTA['index.js'] == release['files']['dist-server/index.js'], 'Backend bytes differ')
        production.validate_inputs(base.CHANGES, backend, old, BACKEND, PRESERVED_BACKEND)
        production.validate_media(base.CHANGES, base.DELTA)
        for name, digest in base.DELTA.items():
            path = 'dist/' + name
            require(name == 'index.html' or path not in old['program'], 'Immutable URL collision: ' + name)
            require((ATLAS_SHA if name == ATLAS else release['files'].get(path)) == digest, 'Client differs: ' + name)

    production.payload = validate
    try:
        production.main()
    except production.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
