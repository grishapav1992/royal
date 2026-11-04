"""Reserve the publication baseline, then hand off to the verified guarded installer."""
import fcntl, hashlib, importlib.util, json, os, subprocess, sys, time
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
LOCKS = ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']

def require(value, reason):
    if not value: raise RuntimeError(reason)

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def save(name, value):
    target = ROOT / name
    temporary = target.with_suffix(target.suffix + '.pending')
    with temporary.open('w') as output: json.dump(value, output)
    os.chmod(temporary, 0o600); temporary.replace(target)

def graphs(before):
    host = backend = None
    for folder in Path('/opt/royal-releases').iterdir():
        if folder.is_symlink() or not folder.is_dir(): continue
        path = folder / 'release-manifest.json'
        if not path.is_file() or path.is_symlink(): continue
        value = json.loads(path.read_text())
        candidate = value.get('hostProjection')
        if candidate and value.get('files', {}).get('dist/index.html') == before['program']['dist/index.html']:
            if all(digest in [before['source'].get(name), before['sourceLF'].get(name)] for name, digest in candidate['inputs'].items()): host = value
        candidate = value.get('backendProjection')
        if candidate and candidate['output']['sha256'] == before['program']['dist-server/index.js']:
            if all(name == 'src/i18n/en.ts' or digest in [before['source'].get(name), before['sourceLF'].get(name)] for name, digest in candidate['inputs'].items()): backend = value
    require(host and backend, 'Current source origins are unavailable; no fallback is allowed')
    return host, backend

def validate_ready(manifest, before, intent, helper_hash):
    require(manifest['before'] == before, 'Reserved production baseline changed')
    require(intent['sourceCommit'] == manifest['sourceCommit'], 'Unreviewed application revision')
    require(intent['installerSha256'] == manifest['helperSha256'] == helper_hash, 'Installer changed')

def main():
    require(ROOT == Path('/opt/royal-releases/player-recovery-20261104-v2'), 'Unexpected reservation path')
    identity = sha(Path(__file__))
    save('reservation-status.json', {'stage':'waiting_for_publication_locks','pid':os.getpid(),'at':time.time()})
    locks = []
    for name in LOCKS:
        require(not Path(name).is_symlink(), 'Publication lock symlink rejected')
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX); locks.append(handle)
    image = subprocess.check_output(['docker','inspect','--format','{{.Image}}','royal-game-1'],text=True).strip()
    active = []
    for folder in Path('/opt/royal-releases').iterdir():
        if folder.is_symlink() or not folder.is_dir(): continue
        file = folder / 'build-result.json'
        if file.is_file() and not file.is_symlink() and (folder / 'published.json').is_file():
            if json.loads(file.read_text()).get('image') == image: active.append(folder)
    require(len(active) == 1, 'Running publication is ambiguous')
    before = json.loads(subprocess.check_output(['python3',str(active[0] / 'snapshot.py')],text=True))
    require(before['container']['health'] == 'healthy' and before['container']['image'] == image == before['preparedImage'], 'Reserved host is not healthy and consistent')
    require(before['program'] == before['preparedProgram'], 'Reserved program differs from its image')
    host, backend = graphs(before)
    save('reserved-before.json',before); save('reserved-host.json',host); save('reserved-backend.json',backend)
    save('reservation-status.json',{'stage':'reserved_for_preparation','pid':os.getpid(),'at':time.time(),'sourceCommit':before['sourceCommit'],'image':image,'beforeSha256':sha(ROOT/'reserved-before.json')})
    deadline = time.monotonic() + 7200
    while not (ROOT / 'ready.json').is_file():
        require(time.monotonic() < deadline, 'Preparation reservation expired')
        require(sha(Path(__file__)) == identity, 'Reservation helper changed')
        time.sleep(2)
    intent = json.loads((ROOT/'ready.json').read_text())
    require(not (ROOT/'deploy.py').is_symlink(), 'Installer symlink rejected')
    manifest = json.loads((ROOT/'install-manifest.json').read_text())
    validate_ready(manifest,before,intent,sha(ROOT/'deploy.py'))
    require(sha(Path(__file__)) == identity, 'Reservation helper changed before publication')
    spec = importlib.util.spec_from_file_location('player_recovery_installer',ROOT/'deploy.py')
    deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)
    base = deploy.configure(); base.payload()
    save('reservation-status.json',{'stage':'installing','pid':os.getpid(),'at':time.time(),'sourceCommit':manifest['sourceCommit']})
    print(json.dumps(base.build()),flush=True); print(json.dumps(base.publish()),flush=True)
    save('reservation-status.json',{'stage':'published','pid':os.getpid(),'at':time.time(),'sourceCommit':manifest['sourceCommit']})

if __name__ == '__main__':
    try: main()
    except BaseException as error:
        save('reservation-status.json',{'stage':'failed','pid':os.getpid(),'at':time.time(),'error':str(error)[:300]})
        raise
