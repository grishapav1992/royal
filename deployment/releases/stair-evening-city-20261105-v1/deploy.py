"""Publish the evening street and traffic through the guarded application installer."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
NAME = 'stair-evening-city-20261105-v1'
ROOT = Path(__file__).resolve().parent
SOURCES = {
    'src/game/StreetAmbience.ts', 'src/game/StreetRenderer.ts',
    'src/game/streetArt.ts', 'src/game/streetCityArt.ts',
}
SUPPORT = {
    'client-guard.py', 'production-guard.py', 'overlay-base.py', 'snapshot-base.py',
    'image_metadata.py', 'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs',
    'financial_gate.py', 'engine-build.py',
}


def load_guard(name, manifest):
    path = ROOT / name
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != manifest['support'][name]:
        raise RuntimeError('Guarded installer helper changed: ' + name)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if ROOT != Path('/opt/royal-releases') / NAME or sys.argv[1:] not in [['release'], ['publish'], ['rollback']]:
        raise RuntimeError('Unexpected street release path or operation')
    manifest = json.loads((ROOT / 'install-manifest.json').read_text())
    client = load_guard('client-guard.py', manifest)
    production = load_guard('production-guard.py', manifest)
    client.NAME, client.SOURCES, client.SUPPORT = NAME, SOURCES, SUPPORT
    production.NAME, production.SOURCES = NAME, SOURCES

    def validate(base):
        client.payload(base)
        client.require(manifest['addedGames'] == [] and manifest['restoredGames'] == [], 'Catalogue changed')
        receipt_path = ROOT / 'installer-github.json'
        receipt = json.loads(receipt_path.read_text())
        client.require(client.sha(receipt_path) == manifest['helperReceiptSha256'], 'Installer receipt changed')
        client.require(receipt['sourceCommit'] == manifest['helperSourceCommit']
                       and receipt['applicationSourceCommit'] == manifest['sourceCommit'], 'Installer source differs')
        client.require(receipt['changedOnlyReleaseTooling'] and all(
            path.startswith('deployment/releases/' + NAME + '/')
            for path in receipt['changedOnlyReleaseTooling']), 'Installer revision changed application sources')

    production.payload = validate
    try:
        production.main()
    except production.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'publicationLocksHeld': False, 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
