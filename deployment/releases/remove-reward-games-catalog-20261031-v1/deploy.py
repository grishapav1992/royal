"""Remove two catalogue entries using the existing guarded client-only installer."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import fcntl, hashlib, json, re, signal, types
from image_metadata import image, inspect

NAME = 'remove-reward-games-catalog-20261031-v1'
ROOT = Path(__file__).resolve().parent
SOURCE = 'src/shared/arcadeCatalog.ts'
TOKEN = '...REWARD_SLOT_GAMES, '

def require(value, reason):
    if not value: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_source(before, after):
    before, after = before.replace(b'\r\n', b'\n'), after.replace(b'\r\n', b'\n')
    require(before.count(TOKEN.encode()) == 1, 'Unexpected production catalogue')
    require(after == before.replace(TOKEN.encode(), b'', 1), 'Only the two reward slots may leave the catalogue')

def configure(root=ROOT):
    m = json.loads((root / 'install-manifest.json').read_text())
    for name, digest in m['support'].items():
        require(not (root / name).is_symlink() and sha(root / name) == digest, 'Support helper changed: ' + name)
    base = types.ModuleType('catalogue_overlay'); base.__file__ = str(root / 'overlay-base.py')
    exec(compile((root / 'overlay-base.py').read_text(), base.__file__, 'exec'), base.__dict__)
    base.NAME, base.ROOT, base.BACKUP = NAME, root, Path('/opt/royal-backups') / NAME
    base.BASE = dict(m['before']['source']); base.sources = lambda state: state['source']
    base.PROGRAM = (root / 'runtime-inventory.cjs').read_text()
    names = m['before']['container']['composeFiles'].split(',')
    require(names and all(Path(n).parent == base.LIVE and Path(n).name.startswith('compose') and Path(n).suffix == '.yaml' for n in names), 'Unreviewed Compose files')
    base.COMPOSE = [Path(n).name for n in names]
    original_run, original_settings = base.run, base.settings
    def run(args, **kwargs):
        if args[:3] == ['docker', 'image', 'inspect']:
            if args[-2:] == ['--format', '{{.Id}}']: return image(args[3])
            return json.dumps([inspect(ref) for ref in args[3:]])
        return original_run(args, **kwargs)
    def settings(state, recovery=False):
        original_settings(state, recovery=recovery)
        require(state['protectedPrograms'] == base.OLD['protectedPrograms'], 'Protected service programs changed')
        old, current = base.OLD['serviceProfiles'], state['serviceProfiles']
        require(set(current) == set(old) or recovery and set(current) == set(old) - {'royal-game-1'}, 'Service inventory changed')
        for name, row in current.items():
            require(row['profileSha256'] == old[name]['profileSha256'], 'Service configuration changed')
            if name != 'royal-game-1': require(row == old[name], 'Retained service changed')
    base.run, base.image, base.settings = run, image, settings
    base.payload = lambda: payload(base)
    return base

def payload(b):
    m, old = b.M, b.OLD
    require(b.ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Unexpected release path')
    require(set(b.CHANGES) == {SOURCE} and not b.SERVER_DELTA, 'Unreviewed source or backend change')
    require(old['program'] == old['preparedProgram'] and old['container']['image'] == old['preparedImage'], 'Baseline runtime differs')
    require(sha(b.ROOT / 'deploy.py') == m['helperSha256'] and sha(b.ROOT / 'snapshot.py') == m['snapshotSha256'], 'Installer changed')
    require(set(m['support']) == {'overlay-base.py','snapshot-base.py','image_metadata.py','runtime-inventory.cjs','quiesce.cjs','financial_gate.py'}, 'Unexpected helper scope')
    for name, digest in m['support'].items(): require(sha(b.ROOT / name) == digest, 'Support changed')
    require(b.inventory(b.ROOT / 'source') == b.CHANGES and b.inventory(b.ROOT / 'dist-delta') == b.DELTA and b.inventory(b.ROOT / 'server-delta') == {}, 'Payload differs')
    require('index.html' in b.DELTA, 'Missing client index')
    for name, digest in b.DELTA.items():
        require(name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.(?:js|css)', name), 'Foreign client artifact')
        require(name == 'index.html' or 'dist/' + name not in old['program'] or old['program']['dist/' + name] == digest, 'Immutable URL collision')
    release = json.loads((b.ROOT / 'release-manifest.json').read_text()); receipt = json.loads((b.ROOT / 'release-github.json').read_text())
    require(sha(b.ROOT / 'release-manifest.json') == m['releaseManifestSha256'] and sha(b.ROOT / 'release-github.json') == m['receiptSha256'], 'Release evidence changed')
    require(release['sourceCommit'] == receipt['sourceCommit'] == m['sourceCommit'] and release['baseCommit'] == m['baseCommit'] == old['sourceCommit'], 'Unverified source')
    require(release['scope'] == 'application' and release['clean'] and release['build']['passed'], 'Release verification missing')
    require(all(release['files'].get('dist/' + n) == h for n, h in b.DELTA.items()), 'Client differs from verified build')
    projection = release['hostProjection']
    require(projection == release['build']['hostProjection'] and projection['productionCommit'] == m['baseCommit'], 'Host evidence differs')
    require(projection['inputs'][SOURCE] == b.CHANGES[SOURCE], 'Catalogue source is not bound to the build')
    for name, digest in projection['inputs'].items():
        require(digest in ([b.CHANGES[name]] if name in b.CHANGES else [old['source'].get(name), old['sourceLF'].get(name)]), 'Unrelated host input changed: ' + name)
    validate_source((b.ROOT / 'before-catalogue.ts').read_bytes(), (b.ROOT / 'source' / SOURCE).read_bytes())
    require(sha(b.ROOT / 'before-catalogue.ts') == old['sourceLF'][SOURCE], 'Original catalogue proof changed')

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['check','build','publish','release','rollback'], 'Unexpected operation')
    base = configure(); base.payload()
    locks = []
    for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(handle)
    def interrupted(number, frame): raise InterruptedError('Deployment interrupted: ' + str(number))
    for number in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(number,interrupted)
    if sys.argv[1] == 'check': base.baseline(); print(json.dumps({'ready': True}))
    elif sys.argv[1] == 'release':
        print(json.dumps(base.build()), flush=True); print(json.dumps(base.publish()), flush=True)
    else: print(json.dumps(getattr(base, sys.argv[1])()))

if __name__ == '__main__': main()
