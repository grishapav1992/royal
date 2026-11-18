"""Publish the projected host and backend before switching Cosmic Escape."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
NAME = 'cosmic-stake-limit-20261118-v1'
GAME = 'studio-cosmic-escape'
MODULES = Path('/opt/royal-game-modules')
STATE = Path('/opt/royal-game-modules-state')
POINTER = MODULES / GAME / 'active.json'
SUPPORT = {
    'production-guard.py', 'overlay-base.py', 'snapshot-base.py',
    'image_metadata.py', 'runtime-inventory.cjs', 'quiesce.cjs',
    'quiesce-base.cjs', 'financial_gate.py', 'engine-build.py', 'publisher.py',
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read(name):
    path = ROOT / name
    require(not path.is_symlink(), 'Unexpected symbolic link: ' + name)
    return json.loads(path.read_text())


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate(base, guard, scope):
    m, old = base.M, base.OLD
    require(m['release'] == NAME and m['addedGames'] == m['restoredGames'] == [], 'Invalid release scope')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline runtime differs')
    require(set(base.CHANGES) == guard.SOURCES and set(base.SERVER_DELTA) == {'index.js'} and 'index.html' in base.DELTA, 'Invalid payload scope')
    for name, digest in {'deploy.py': m['helperSha256'], 'snapshot.py': m['snapshotSha256'],
                         'scope.json': m['scopeSha256'], 'module-proof.json': m['moduleProofSha256'],
                         'release-manifest.json': m['releaseManifestSha256'],
                         'release-github.json': m['receiptSha256']}.items():
        require(guard.sha(ROOT / name) == digest, 'Release evidence changed: ' + name)
    for folder, files in [('source', base.CHANGES), ('dist-delta', base.DELTA),
                          ('server-delta', base.SERVER_DELTA), ('package', m['module']['files'])]:
        require(base.inventory(ROOT / folder) == files, 'Payload changed: ' + folder)
        for name in files:
            base.safe_name(name)

    release, receipt = read('release-manifest.json'), read('release-github.json')
    require(receipt['manifestSha256'] == m['releaseManifestSha256']
            and receipt['sourceCommit'] == release['sourceCommit'] == m['sourceCommit']
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Unverified build')
    for projection, required, preserved in [
        ('hostProjection', scope['host'], {}),
        ('backendProjection', scope['backend'], scope['preservedBackendInputs']),
    ]:
        proof = release[projection]
        require(proof == release['build'][projection] and proof['productionCommit'] == m['baseCommit'], 'Projection differs')
        guard.validate_inputs(base.CHANGES, proof, old, required, preserved)
    require(release['backendProjection']['output']['sha256'] == base.SERVER_DELTA['index.js']
            == release['files']['dist-server/index.js'], 'Backend differs from verified build')
    guard.validate_media(base.CHANGES, base.DELTA)
    for name, digest in base.DELTA.items():
        file = 'dist/' + name
        require(name == 'index.html' or file not in old['program'], 'Immutable asset collision')
        require(release['files'].get(file) == digest, 'Client differs from verified build')

    module = m['module']
    proof = read('module-proof.json')
    package = read('package/manifest.json')
    require(proof['gameId'] == package['gameId'] == GAME and proof['version'] == package['version'] == module['version']
            and proof['hostSingletonsExternalized'] and not proof['serverImplementationIncluded']
            and proof['sourceSha256'] == package['sourceSha256'], 'Module proof differs')
    for name in set(scope['module']) | (set(scope['host']) & set(scope['backend'])) | {'src/modules/GameHostContract.ts'}:
        require(proof['sourceFiles'].get(name) == base.CHANGES[name], 'Module source is unbound: ' + name)
    folder = f"module-dist/{GAME}/versions/{module['version']}/"
    require(module['files'] == {'manifest.json': guard.sha(ROOT / 'package/manifest.json'), **package['files']}
            and all(release['files'].get(folder + name) == digest for name, digest in module['files'].items())
            and release['files'][f'module-dist/{GAME}/active.json'] == module['pointerSha256'], 'Unverified module bytes')
    require(guard.sha(ROOT / 'publisher.py') == old['source']['scripts/game-module-release.py'], 'Unknown module publisher')


def module_options(base, publisher):
    old = base.OLD
    expected = old['moduleFiles'][str(POINTER)]
    require(publisher.active_sha(POINTER) == expected, 'Cosmic Escape changed since review')
    args = SimpleNamespace(operation='check', package=str(ROOT / 'package'), game=GAME,
                           root=str(MODULES), state=str(STATE), expected_sha=expected)
    checked = publisher.run(args)
    require(shutil.disk_usage(MODULES).free >= 5 * 1024**3 + checked['bytes'] * 3, 'Insufficient module release capacity')
    return args


def switch_module(base, publisher):
    host = read('after.json')
    current = base.snapshot()
    comparable = lambda state: {k: v for k, v in state.items() if k not in {'at', 'availableBytes'}}
    require(comparable(current) == comparable(host) and current['container']['health'] == 'healthy'
            and current['sourceCommit'] == base.M['sourceCommit'], 'Published host changed')
    args = module_options(base, publisher)
    module = base.M['module']
    previous = json.loads(POINTER.read_text())
    old_manifest = MODULES / previous['manifest'].removeprefix('/game-modules/')
    require(previous['gameId'] == GAME and previous['sha256'] == publisher.sha(old_manifest), 'Previous module manifest differs')
    publisher.verify(old_manifest.parent, current['moduleHost']['games'][GAME], GAME)
    for source, name in [(POINTER, 'cosmic-active.json'), (old_manifest, 'cosmic-manifest.json')]:
        target = base.BACKUP / name
        if target.exists():
            require(publisher.sha(target) == publisher.sha(source), 'Previous module backup differs')
        else:
            with target.open('xb') as output:
                output.write(source.read_bytes())
                output.flush()
                os.fsync(output.fileno())

    args.operation = 'install'
    mask = os.umask(0o022)
    try:
        result = publisher.run(args)
    finally:
        os.umask(mask)
    expected = dict(host)
    prefix = str(MODULES / GAME / 'versions' / module['version']) + '/'
    expected['moduleFiles'] = {**host['moduleFiles'], str(POINTER): module['pointerSha256'],
                               **{prefix + name: digest for name, digest in module['files'].items()}}
    after = base.snapshot()
    require(comparable(after) == comparable(expected)
            and result['activeSha256'] == module['pointerSha256'], 'Unexpected changes after module publication')
    base.write('module-published.json', {**result, 'sourceCommit': base.M['sourceCommit'],
                                        'previousManifest': previous, 'freeAfter': after['availableBytes']})
    return result


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] in [['release'], ['publish'], ['module']],
            'Unexpected release location or operation')
    manifest = read('install-manifest.json')
    require(set(manifest['support']) == SUPPORT, 'Unexpected helper scope')
    for name, digest in manifest['support'].items():
        path = ROOT / name
        require(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == digest,
                'Support helper changed: ' + name)
    guard = load('production_guard', 'production-guard.py')
    scope = read('scope.json')
    guard.NAME, guard.ROOT = NAME, ROOT
    guard.SOURCES = set(scope['host'] + scope['backend'] + scope['module'])
    guard.MEDIA = {}
    guard.payload = lambda base: validate(base, guard, scope)
    base = guard.configure(ROOT)
    base.payload()
    publisher = load('module_publisher', 'publisher.py')
    try:
        with guard.publication_locks():
            base.payload()
            if sys.argv[1] != 'module':
                module_options(base, publisher)
                if sys.argv[1] == 'release':
                    print(json.dumps(base.build()), flush=True)
                print(json.dumps(base.publish()), flush=True)
            print(json.dumps(switch_module(base, publisher)), flush=True)
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
