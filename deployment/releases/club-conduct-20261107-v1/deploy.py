"""Publish the scoped club conduct host and backend over the reviewed production image."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
NAME = 'club-conduct-20261107-v1'
FOLDER = 'deployment/releases/' + NAME
ROOT = Path(__file__).resolve().parent
BASE_COMMIT = '2a077d6174cc13b4f6cc10d13d66cb2ff5bbbef5'
BASE_IMAGE = 'sha256:9ddb3517cdaa91cc111a630d3eab7634a8525ae8444d80dfdceed612851361a1'
ENGLISH = 'src/i18n/en.ts'
SHARED = {ENGLISH, 'src/shared/chat.ts', 'src/shared/chatConduct.ts', 'src/shared/security.ts', 'src/shared/world.ts'}
HOST = SHARED | {
    'src/main.ts', 'src/network/LobbyClient.ts', 'src/ui/ClubFineUI.ts', 'src/ui/DemoWalletUI.ts',
    'src/ui/SecurityUI.ts', 'src/ui/SkinStudioUI.ts', 'src/ui/SocialUI.ts', 'src/ui/chat-delivery.css', 'src/ui/club-fine.css',
}
BACKEND = SHARED | {
    'server/LobbyRoom.ts', 'server/accounts.ts', 'server/activities.ts', 'server/chatLanguageWindow.ts',
    'server/chatQueue.ts', 'server/chatReceipts.ts', 'server/chatSpam.ts', 'server/chessGame.ts',
    'server/clubFineRoutes.ts', 'server/clubSanctions.ts', 'server/guardNavigation.ts', 'server/guards.ts',
    'server/index.ts', 'server/moderation.ts', 'server/pvp/room.ts', 'server/roomChat.ts',
}
# The current image has distinct backend translation inputs. The installed source stays aligned with the host.
PRESERVED_BACKEND = {
    ENGLISH: 'e6a39483750df92467b584e98319ce679f2a3489669e4b0d3f64a2d7ba0a762c',
    'src/i18n/progressionEn.ts': '66c68ac05b3b362c4ef1dae60afaeb1c484d6ada0887adefd9954a4de12c1ba4',
}
ENGLISH_CHANGES = {
    'host': '0a86cc3190daa717d88dd8e82bfbe142c36a2887a4b6858d52d7f451e73a2e5d',
    'backend': '8f3990b31f85037221688e4d906d41225ad5649a62f5c98834ce55bbec6e65c7',
}
SUPPORT = {'production-guard.py', 'overlay-base.py', 'snapshot-base.py', 'image_metadata.py',
           'runtime-inventory.cjs', 'quiesce.cjs', 'quiesce-base.cjs', 'financial_gate.py', 'engine-build.py'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def read(name):
    path = ROOT / name
    require(path.is_file() and not path.is_symlink(), 'Missing or unsafe payload file: ' + name)
    return path.read_bytes()


def sha(bytes_):
    return hashlib.sha256(bytes_).hexdigest()


def projection_changes(release, old, kind, entries, required):
    key = kind + 'Projection'
    report = release[key]
    config_name = kind + '-projection.json'
    config_bytes = read(config_name)
    config = json.loads(config_bytes)
    require(report == release['build'][key] and report['config'] == FOLDER + '/' + config_name
            and report['sha256'] == sha(config_bytes), 'Projection evidence differs: ' + kind)
    require(report['productionCommit'] == config['productionCommit'] == BASE_COMMIT
            and config['format'] == 1 and config['entries'] == entries, 'Unexpected projection basis: ' + kind)
    require(report['inputs'].keys() == report['origins'].keys(), 'Projection origins are incomplete: ' + kind)
    changes = {}
    for name, digest in report['inputs'].items():
        row = config['files'].get(name)
        require(row == report['origins'][name] and row['sha256'] == digest, 'Unverified projected input: ' + name)
        previous = [old['source'].get(name), old['sourceLF'].get(name)]
        if kind == 'backend' and name in PRESERVED_BACKEND:
            previous = [PRESERVED_BACKEND[name]]
        if digest not in previous:
            changes[name] = digest
    require(set(changes) == required, 'Unexpected changed ' + kind + ' inputs: ' + str(sorted(set(changes) ^ required)))
    require(changes[ENGLISH] == ENGLISH_CHANGES[kind], 'The reviewed English translation differs: ' + kind)
    return changes


def validate(base):
    manifest, old = base.M, base.OLD
    require(manifest['release'] == NAME and manifest['addedGames'] == manifest['restoredGames'] == [], 'Catalogue scope changed')
    require(old['container']['health'] == 'healthy' and old['container']['image'] == old['preparedImage'] == BASE_IMAGE
            and old['program'] == old['preparedProgram'], 'Reviewed production basis differs')
    require(sha(read('deploy.py')) == manifest['helperSha256'] and sha(read('snapshot.py')) == manifest['snapshotSha256'], 'Installer changed')
    release_bytes, receipt_bytes = read('release-manifest.json'), read('release-github.json')
    release, receipt = json.loads(release_bytes), json.loads(receipt_bytes)
    require(sha(release_bytes) == manifest['releaseManifestSha256'] == receipt['manifestSha256']
            and sha(receipt_bytes) == manifest['receiptSha256'], 'Release evidence changed')
    require(re.fullmatch(r'[a-f0-9]{40}', manifest['sourceCommit']) and re.fullmatch(r'[a-f0-9]{40}', receipt['remoteMain'])
            and release['sourceCommit'] == receipt['sourceCommit'] == manifest['sourceCommit']
            and release['baseCommit'] == manifest['baseCommit'] == old['sourceCommit'] == BASE_COMMIT, 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Unverified build')

    host = projection_changes(release, old, 'host', ['index.html'], HOST)
    backend = projection_changes(release, old, 'backend', ['server/index.ts'], BACKEND)
    require(all(host[name] == backend[name] for name in (host.keys() & backend.keys()) - {ENGLISH}), 'Shared projected source differs')
    require(manifest['projectionChanges'] == {'host': host, 'backend': backend}
            and base.CHANGES == {**backend, **host}, 'Source payload differs from the projected overlays')
    require(set(base.SERVER_DELTA) == {'index.js'}, 'Unexpected backend delta')
    backend_report = release['backendProjection']
    require(backend_report['entries'] == ['server/index.ts'] and backend_report['output']['path'] == 'dist-server/index.js'
            and backend_report['output']['sha256'] == base.SERVER_DELTA['index.js'] == release['files']['dist-server/index.js'], 'Backend bytes differ')
    client_delta = {name.removeprefix('dist/'): digest for name, digest in release['files'].items()
                    if name.startswith('dist/') and old['program'].get(name) != digest}
    require(client_delta == base.DELTA and 'index.html' in client_delta, 'Client delta differs from the reviewed build')
    for name in client_delta:
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client artifact: ' + name)
        require(name == 'index.html' or 'dist/' + name not in old['program'], 'Immutable URL collision: ' + name)
    for folder, expected in [('source', base.CHANGES), ('dist-delta', base.DELTA), ('server-delta', base.SERVER_DELTA)]:
        for name, digest in expected.items():
            base.safe_name(name)
            require(re.fullmatch(r'[a-f0-9]{64}', digest), 'Invalid payload digest: ' + name)
        require(base.inventory(ROOT / folder) == expected, 'Payload changed: ' + folder)


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in
            [['release'], ['publish'], ['rollback']], 'Unexpected club conduct release path or operation')
    manifest = json.loads(read('install-manifest.json'))
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in manifest['support'].items():
        require(sha(read(name)) == digest, 'Support helper changed: ' + name)
    spec = importlib.util.spec_from_file_location('production_guard', ROOT / 'production-guard.py')
    production = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(production)
    production.ROOT, production.NAME, production.payload = ROOT, NAME, validate
    try:
        production.main()
    except production.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'publicationLocksHeld': False, 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
