"""Publish only the compatible Jackie visual package and its three source changes."""
import hashlib, importlib.util, json, os, re, shutil, subprocess, sys, tarfile
from pathlib import Path
from types import SimpleNamespace
from contextlib import contextmanager

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
NAME = 'jackie-motion-20261104-v4'
GAME = 'original-jackie-chan'
LIVE = Path('/opt/royal')
MODULES = Path('/opt/royal-game-modules')
MAINTENANCE = Path('/opt/royal-maintenance/bin/cleanup-release-history.py')
ALLOWED = {'games/jackie-chan/JackieScene.ts', 'games/jackie-chan/JackieUI.ts', 'games/jackie-chan/layout.css'}
MIN_FREE = 5 * 1024**3

def require(ok, reason):
    if not ok: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_text())

def save(name, value):
    target = ROOT/name
    temporary = target.with_suffix(target.suffix+'.next')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    os.replace(temporary, target)

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def validate(m, release, receipt, scope):
    require(m['release'] == scope['release'] == NAME and scope['gameId'] == GAME, 'Unexpected release identity')
    require(set(scope['sourceBefore']) == set(scope['sourceAfter']) == set(m['source']) == ALLOWED, 'Source scope expanded')
    require(m['source'] == scope['sourceAfter'], 'Source bytes differ from reviewed scope')
    require(not scope['addedGames'] and not scope['restoredGames'], 'Catalogue expansion rejected')
    require(release['scope'] == 'modules' and release['modules'] == ['jackie-chan'] and release['build']['passed'], 'Unexpected build scope')
    require(m['sourceCommit'] == release['sourceCommit'] == receipt['sourceCommit'], 'Source receipt differs')
    require(re.fullmatch('[a-f0-9]{40}', m['sourceCommit']), 'Invalid source commit')
    require(re.fullmatch('[a-f0-9]{40}', str(receipt.get('remoteMain', ''))), 'GitHub preservation is missing')
    require(release['moduleProjection']['productionCommit'] == release['baseCommit'] == scope['preparedBase'], 'Prepared baseline differs')
    inputs = release['moduleProjection']['inputs']
    require(all(inputs.get(n) == h for n, h in m['source'].items()), 'Published sources differ from the built inputs')
    require(release['packages'] == [{'gameId': GAME, 'version': m['version'], 'pointer': 'module-dist/'+GAME+'/active.json'}], 'Another package was included')
    prefix = 'module-dist/'+GAME+'/versions/'+m['version']+'/'
    require(m['packageFiles'] == {n[len(prefix):]: h for n, h in release['files'].items() if n.startswith(prefix)}, 'Package inventory differs')
    require(release['files']['module-dist/'+GAME+'/active.json'] == m['pointerSha256'], 'Pointer differs')
    require(m['pointerSha256'] != scope['previousPointerSha256'], 'A new package is required')

def atomic(source, target):
    require(not target.is_symlink() and not any(p.is_symlink() for p in target.parents), 'Unsafe source target')
    temporary = target.with_name(target.name+'.'+NAME+'.partial')
    with open(source, 'rb') as inp, temporary.open('xb') as out:
        shutil.copyfileobj(inp, out); os.fchmod(out.fileno(), 0o644); out.flush(); os.fsync(out.fileno())
    os.replace(temporary, target)

class PublicationBusy(RuntimeError): pass

LOCKS = ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']

@contextmanager
def publication_locks():
    import fcntl
    handles = []
    try:
        for name in LOCKS:
            require(not Path(name).is_symlink(), 'Unsafe publication lock')
            handle = open(name, 'a'); handles.append(handle)
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error: raise PublicationBusy('Publication lock busy: '+name) from error
        yield
    finally:
        for handle in reversed(handles):
            try: fcntl.flock(handle, fcntl.LOCK_UN)
            finally: handle.close()

def guarded_publication(action):
    try:
        with publication_locks(): return action()
    except PublicationBusy as error:
        print(json.dumps({'status':'publication_busy','reason':str(error),'publicationLocksHeld':False,'preparedPackagePreserved':True,'retry':'Explicit retry after an agreed window'}), flush=True)
        return 75

def validate_installer_receipt(receipt, application_commit, helper_sha):
    require(receipt.get('applicationSourceCommit') == application_commit, 'Installer targets another application artifact')
    require(re.fullmatch('[a-f0-9]{40}', str(receipt.get('installerSourceCommit',''))), 'Invalid installer commit')
    require(receipt.get('githubMainContainsInstaller') is True and receipt.get('sha256') == helper_sha, 'Installer GitHub receipt differs')

def verify_rollback_tag(cleanup, image, tag):
    metadata = cleanup.docker_object('image', image)
    require(metadata['Id'] == image and tag in metadata.get('RepoTags', []), 'Rollback image tag differs')

def publish_locked(m, scope):
    cleanup = load('jackie_existing_maintenance', MAINTENANCE)
    current = cleanup.healthy()
    host_release = cleanup.select_current_release(current['Image'], current['Config']['Labels']['org.opencontainers.image.revision'])
    before = cleanup.recovery(host_release)
    save('before.json', before)
    pointer = MODULES/GAME/'active.json'
    require(sha(pointer) == scope['previousPointerSha256'], 'Jackie was updated by another publication')
    for name, digest in scope['sourceBefore'].items(): require(sha(LIVE/name) == digest, 'Production source changed: '+name)
    publisher = load('jackie_reviewed_publisher', ROOT/'publisher.py')
    contract = read('/opt/royal-game-modules-state/host.json')['games'][GAME]
    old = MODULES/GAME/'versions'/scope['previousVersion']
    old_manifest, _ = publisher.verify(old, contract, GAME)
    incoming = ROOT/'package'
    for name, digest in m['packageFiles'].items():
        require(name == 'manifest.json' or publisher.RESOURCE.fullmatch(name), 'Unsafe incoming resource')
        target = incoming/name
        if not target.exists():
            require(name.startswith('media/') and old_manifest['files'].get(name) == digest, 'New media was not uploaded: '+name)
            target.parent.mkdir(parents=True, exist_ok=True); os.link(publisher.plain(old, name), target)
        require(not target.is_symlink() and sha(target) == digest, 'Incoming package changed: '+name)
    require(shutil.disk_usage(LIVE).free > MIN_FREE + 3*sum(p.stat().st_size for p in incoming.rglob('*') if p.is_file()), 'Need five GiB reserve')
    backup = Path('/opt/royal-backups')/NAME; backup.mkdir(mode=0o700)
    archive = backup/'source.tgz'
    with tarfile.open(archive, 'w:gz') as out:
        for name in sorted(ALLOWED):
            out.add(LIVE/name, arcname=name); destination=backup/'source'/name
            destination.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(LIVE/name, destination)
        out.add(pointer, arcname='active.json')
        out.add(old/'manifest.json', arcname='prior-manifest.json')
        out.add('/opt/royal-game-modules-state/host.json', arcname='host.json')
    tag = 'royal-game:before-'+NAME
    subprocess.run(['docker', 'tag', current['Image'], tag], check=True, timeout=60)
    verify_rollback_tag(cleanup, current['Image'], tag)
    backup_info = {'sourceArchive': str(archive), 'sha256': sha(archive), 'bytes': archive.stat().st_size, 'image': current['Image'], 'tag': tag, 'retainedPriorPackage': str(old)}
    save('backup.json', backup_info); save('attempt.json', {'sourceCommit': m['sourceCommit'], 'hostRelease': host_release})
    try:
        for name in sorted(ALLOWED):
            require(sha(ROOT/'source'/name) == m['source'][name], 'Incoming source differs')
            atomic(ROOT/'source'/name, LIVE/name)
        result = publisher.run(SimpleNamespace(operation='install', package=str(incoming), version=None, game=GAME,
            expected_sha=scope['previousPointerSha256'], root=str(MODULES), state='/opt/royal-game-modules-state'))
        require(result['activeSha256'] == m['pointerSha256'], 'Installed pointer differs')
    except BaseException:
        if sha(pointer) == scope['previousPointerSha256']:
            for name in sorted(ALLOWED): atomic(backup/'source'/name, LIVE/name)
        raise
    operator = {'sourceCommit': m['sourceCommit'], 'source': m['source'], 'pointerSha256': m['pointerSha256']}
    save('operator.json', operator)
    save('published.json', {'published': True, 'sourceCommit': m['sourceCommit'], 'module': result, 'backup': backup_info})
    after = cleanup.recovery(host_release); save('after.json', after)
    for name in ['currentImage', 'configuration', 'services', 'moduleHostContract']:
        require(before[name] == after[name], 'Unrelated production change: '+name)
    prefix = GAME+'/versions/'+m['version']+'/'
    retained = {n:h for n,h in after['modules'].items() if n != GAME+'/active.json' and not n.startswith(prefix)}
    require(retained == {n:h for n,h in before['modules'].items() if n != GAME+'/active.json'}, 'Another package changed')
    require(shutil.disk_usage(LIVE).free > MIN_FREE, 'Five GiB reserve was crossed')
    save('verification.json', {'verified': True, 'sourceCommit': m['sourceCommit'], 'hostRelease': host_release, 'runningImage': current['Image'], 'module': result, 'backup': backup_info, 'preservedServices': len(before['services']), 'addedGames': [], 'restoredGames': [], 'restartRequired': False, 'databaseTouched': False})
    print(json.dumps(result), flush=True)
    return 0

def main():
    require(sys.argv[1:] == ['release'] and ROOT == Path('/opt/royal-releases')/NAME, 'Unexpected operation or directory')
    m, release, receipt, scope = [read(ROOT/n) for n in ['install-manifest.json', 'release-manifest.json', 'release-github.json', 'scope.json']]
    validate(m, release, receipt, scope)
    require(sha(ROOT/'release-manifest.json') == receipt['manifestSha256'], 'Verified release manifest changed')
    for name, digest in m['support'].items():
        require('/' not in name and not (ROOT/name).is_symlink() and sha(ROOT/name) == digest, 'Support bytes changed: '+name)
    require(sha(MAINTENANCE) == m['maintenanceSha256'], 'Installed maintenance verifier changed')
    require(not (ROOT/'attempt.json').exists(), 'Inspect the previous attempt before repeating publication')
    validate_installer_receipt(read(ROOT/'installer-source.json'), m['sourceCommit'], sha(__file__))
    return guarded_publication(lambda: publish_locked(m, scope))

if __name__ == '__main__': raise SystemExit(main())
