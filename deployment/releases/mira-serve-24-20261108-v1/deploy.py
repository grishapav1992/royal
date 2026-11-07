"""Publish Mira's drink service and its versioned atlas through the production guard."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
NAME = 'mira-serve-24-20261108-v1'
ROOT = Path(__file__).resolve().parent
CLIENT = {'src/game/Bar.ts', 'src/game/miraAnimation.ts', 'src/game/MiraRig.ts'}
ATLAS = 'assets/royal-bar/v3/mira-serve-24.png'
ATLAS_SHA = '80151d10d266d42137f592849949f8137fa1a6af97e6636c7c2371bb004edb2d'
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
        require(not base.SERVER_DELTA and 'index.html' in base.DELTA, 'Unexpected backend or missing index')
        require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline differs')
        require(sha('deploy.py') == m['helperSha256'] and sha('snapshot.py') == m['snapshotSha256'], 'Installer changed')
        for folder, expected in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', {})]:
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
