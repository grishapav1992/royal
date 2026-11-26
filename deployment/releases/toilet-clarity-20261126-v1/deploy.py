"""Publish the club sprite and restroom rendering update on the verified production host."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
NAME = 'toilet-clarity-20261126-v1'
ROOT = Path(__file__).resolve().parent
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py',
           'engine-build.py', 'scope.json'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(name):
    path = ROOT / name
    require(not path.is_symlink(), 'Unexpected symlink: ' + name)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in
            [['release'], ['publish'], ['rollback']], 'Unexpected release path or operation')
    manifest = json.loads((ROOT / 'install-manifest.json').read_text())
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in manifest['support'].items():
        require(sha(name) == digest, 'Support file changed: ' + name)
    scope = json.loads((ROOT / 'scope.json').read_text())
    client, previews = set(scope['client']), set(scope['previews'])
    spec = importlib.util.spec_from_file_location('production_guard', ROOT / 'production-guard.py')
    production = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(production)
    production.ROOT, production.NAME = ROOT, NAME
    production.SOURCES = client | previews

    def validate(base):
        m, old = base.M, base.OLD
        require(m['release'] == NAME and m['addedGames'] == m['restoredGames'] == []
                and m['activeGames'] == scope['activeBefore'], 'Catalogue scope changed')
        require(base.CHANGES == scope['sourceUpdates'], 'Unexpected source changes')
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
        require(projection == release['build']['hostProjection'] and projection['productionCommit'] == m['baseCommit'],
                'Projection differs')
        production.validate_inputs(base.CHANGES, projection, old, client)
        media = m['media']
        require(set(media) == previews and len(set(media.values())) == len(previews), 'Unexpected preview scope')
        for source, asset in media.items():
            name = Path(source)
            require(re.fullmatch(r'assets/' + re.escape(name.stem) + r'-[a-zA-Z0-9_-]+' + re.escape(name.suffix), asset)
                    and base.DELTA.get(asset) == base.CHANGES[source], 'Preview bytes differ: ' + source)
        expected = {path[5:]: digest for path, digest in release['files'].items()
                    if path.startswith('dist/') and old['program'].get(path) != digest}
        require(base.DELTA == expected, 'Incomplete host delta')
        for name in base.DELTA:
            require(name == 'index.html' or (
                'dist/' + name not in old['program'] and (
                    name in media.values() or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name))),
                'Unreviewed client artifact or immutable URL collision: ' + name)

    production.payload = validate
    try:
        production.main()
    except production.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
