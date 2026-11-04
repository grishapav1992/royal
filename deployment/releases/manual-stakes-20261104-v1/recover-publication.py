"""Explicit forward completion before any candidate startup was requested."""
import sys
sys.dont_write_bytecode = True
import fcntl, hashlib, importlib.util, json, os, re, signal, time, types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = '64275feff275c9049a82e7b095dd89c4b71677da'
LOCKS = ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']

def require(ok, reason):
    if not ok: raise RuntimeError(reason)

def read(path): return json.loads(Path(path).read_text())
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def load_deploy():
    spec = importlib.util.spec_from_file_location('manual_forward_deploy', ROOT / 'deploy.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def installed_prefix(manifest, record):
    installed = record.get('installed')
    require(record.get('verified') is True and isinstance(installed, list), 'Unverified module journal')
    require(installed and installed == list(manifest['packages'])[:len(installed)], 'Module journal is not the reviewed prefix')
    return installed

def validate_partial(deploy, manifest, built, state, installed):
    before = manifest['before']
    require(manifest['sourceCommit'] == APP == built['sourceCommit'], 'Application source changed')
    require(state['container'] == before['container'] and state['container']['health'] == 'healthy', 'Old application lifecycle changed; do not issue another compose')
    require(state['program'] == before['program'], 'Running application bytes changed')
    require(state['preparedImage'] == built['image'] and state['preparedProgram'] == built['program'], 'Prepared candidate changed')
    require(state['source'] == {**before['source'], **manifest['changed']}, 'Partially installed sources changed')
    require(state['moduleFiles'] == deploy.expected_modules(manifest, installed), 'Partial module inventory changed')

def tool_receipt():
    require(ROOT == Path('/opt/royal-releases/manual-stakes-20261104-v1'), 'Unexpected recovery directory')
    receipt = read(ROOT / 'forward-tool-receipt.json')
    require(receipt['applicationSourceCommit'] == APP and receipt['githubMainContainsSource'] is True, 'Recovery tool is not preserved in GitHub')
    require(re.fullmatch('[a-f0-9]{40}', receipt['toolSourceCommit']) is not None, 'Invalid recovery tool source')
    require(not Path(__file__).is_symlink() and receipt['sha256'] == sha(__file__), 'Recovery tool bytes changed')
    return receipt

def install_modules(parent):
    require(os.getppid() == parent, 'Module installation must be supervised by its parent')
    command = (Path('/proc') / str(parent) / 'cmdline').read_bytes()
    require(str(ROOT / 'recover-publication.py').encode() in command and b'resume' in command, 'Unexpected supervising process')
    held = set()
    for file in (Path('/proc') / str(parent) / 'fd').iterdir():
        try: held.add(os.readlink(file))
        except FileNotFoundError: pass
    require(set(LOCKS).issubset(held), 'Supervising publisher lacks publication locks')
    attempt = read(ROOT / 'forward-attempt.json')
    require(attempt['pid'] == parent and attempt['sourceCommit'] == APP, 'Supervising attempt changed')
    deploy = load_deploy(); b = deploy.configure(); b.payload()
    installed = installed_prefix(b.M, read(ROOT / 'module-publication.json'))
    publisher = deploy.load('manual_forward_modules', ROOT / 'publisher.py')
    for game in list(b.M['packages'])[len(installed):]:
        package = b.M['packages'][game]
        result = publisher.run(types.SimpleNamespace(operation='install', package=str(ROOT / 'packages' / game), game=game,
            root='/opt/royal-game-modules', state=str(b.STATE), expected_sha=package['previousPointerSha256']))
        require(result['verified'] and result['activeSha256'] == package['pointerSha256'], 'Installed pointer differs')
        installed.append(game)
        b.write('module-publication.json', {'installed': installed, 'verified': True})
    return {'installed': installed, 'verified': True}

def forward_compose(b, gate):
    require(gate is not None, 'Fresh financial lease is required')
    # Copying and fsync can exceed ten seconds. The existing supervisor must
    # pump fresh financial challenges throughout this child, including I/O waits.
    result = json.loads(gate.run([sys.executable, str(ROOT / 'recover-publication.py'), 'modules', str(os.getpid())]))
    require(result == {'installed': list(b.M['packages']), 'verified': True}, 'Supervised module installation incomplete')
    b.manual_installed = result['installed']
    gate.confirm()
    b.write('candidate-start-requested.json', {'sourceCommit': APP, 'pid': os.getpid(), 'at': time.time()})
    b.manual_candidate_attempted = True
    command = ['docker', 'compose', *[value for name in b.COMPOSE for value in ['-f', name]],
        'up', '-d', '--no-deps', '--force-recreate', '--no-build', 'game']
    return gate.run(command, cwd=b.LIVE)

def resume(receipt):
    require(not (ROOT / 'published.json').exists(), 'Application is already published')
    require(not (ROOT / 'candidate-start-requested.json').exists(), 'Candidate startup was requested; reconcile its daemon outcome instead of repeating compose')
    require(not (ROOT / 'forward-attempt.json').exists(), 'Forward completion is single-use; inspect the previous attempt')
    deploy = load_deploy(); b = deploy.configure(); b.payload()
    failure = read(ROOT / 'publication-failed.json')
    require(failure == {'errorType': 'GateError', 'reason': 'Financial gate confirmation became stale',
        'daemonOutcomeUnknown': True, 'mutationStarted': True, 'databaseRestored': False}, 'Failure differs from the reviewed pre-start interruption')
    require('in compose\n    gate.check()\n' in (ROOT / 'installer.log').read_text(), 'No proof of failure before candidate startup')
    b.manual_installed = installed_prefix(b.M, read(ROOT / 'module-publication.json'))
    require(len(b.manual_installed) < len(b.M['packages']), 'Original interruption was not within module installation')
    built = read(ROOT / 'build-result.json')
    require(built['program'] == b.expected_program(), 'Original candidate inventory changed')
    b.write('forward-attempt.json', {'pid': os.getpid(), 'sourceCommit': APP, 'toolSourceCommit': receipt['toolSourceCommit'], 'at': time.time()})
    def baseline():
        state = b.snapshot(); b.settings(state)
        validate_partial(deploy, b.M, built, state, b.manual_installed)
        b.write('recovery-before.json', state)
        return state
    b.baseline = baseline
    b.compose = lambda gate=None: forward_compose(b, gate)
    result = b.publish()
    b.write('forward-completed.json', {'completed': True, 'toolSourceCommit': receipt['toolSourceCommit'],
        'sourceCommit': APP, 'image': result['runningImage'], 'databaseRestored': False})
    return result

def main():
    require(len(sys.argv) >= 2, 'Operation required')
    receipt = tool_receipt()
    if sys.argv[1:] and sys.argv[1] == 'modules':
        require(len(sys.argv) == 3 and sys.argv[2].isdigit(), 'Unexpected module arguments')
        print(json.dumps(install_modules(int(sys.argv[2]))), flush=True); return
    require(sys.argv[1:] == ['resume'], 'Unexpected recovery operation')
    handles = []
    for name in LOCKS:
        require(not Path(name).is_symlink(), 'Publication lock symlink rejected')
        handle = open(name, 'a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); handles.append(handle)
    def interrupted(number, frame): raise InterruptedError('Forward completion interrupted: ' + str(number))
    for number in [signal.SIGHUP, signal.SIGINT, signal.SIGTERM]: signal.signal(number, interrupted)
    print(json.dumps(resume(receipt)), flush=True)

if __name__ == '__main__': main()
