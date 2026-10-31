"""Verify an already built candidate after the post-build disk guard stopped finalization."""
from pathlib import Path
import fcntl
import importlib.util
import json
import shutil
import signal

ROOT = Path(__file__).resolve().parent
SOURCE = '4028e369c4fb7d0588f6ddd3c155306505fdbfd9'
FAILURE = 'RuntimeError: Image build crossed the disk reserve'


def require(ok, reason):
    if not ok: raise RuntimeError(reason)


def complete(base, deploy):
    root = base.ROOT
    base.payload()
    require(base.M['sourceCommit'] == SOURCE, 'Unexpected candidate source')
    require(not any((root / name).exists() for name in ['build-result.json', 'published.json', 'publication-failed.json']),
            'Candidate has already advanced')
    process = deploy.read(root / 'build-process.json')
    require(process['sourceCommit'] == SOURCE and process['command'] == ['python3', str(root / 'deploy.py'), 'build']
            and isinstance(process['pid'], int) and process['pid'] > 1, 'Unexpected original build process')
    require(not (Path('/proc') / str(process['pid'])).exists(), 'Original build process still exists')
    error = (root / 'build-run.log').read_text()
    require(error.rstrip().endswith(FAILURE), 'Original build did not stop at the disk guard')
    log = (root / 'build.log').read_text()
    require(log.rstrip().endswith('Successfully tagged royal-game:' + base.NAME)
            and 'Successfully built ' in log, 'Docker build did not succeed')
    context = root / 'runtime-context'
    require((context / 'Dockerfile').read_text() == deploy.dockerfile(base), 'Build recipe changed')
    require(base.inventory(context / 'dist-delta') == base.DELTA
            and base.inventory(context / 'server-delta') == base.SERVER_DELTA, 'Build context changed')
    require(shutil.disk_usage(base.LIVE).free > deploy.MIN_FREE, 'Five GiB reserve is not available')
    base.baseline()
    base.verify_existing_backup()
    candidate = base.image('royal-game:' + base.NAME)
    parent, child = json.loads(base.run(['docker', 'image', 'inspect', base.OLD['preparedImage'], candidate]))
    require(child['Id'] == candidate
            and child['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == SOURCE,
            'Candidate revision differs')
    require(('Successfully built ' + candidate.removeprefix('sha256:')[:12]) in log, 'Built image identity differs')
    for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image settings changed: ' + key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'], 'Parent image layers changed')
    actual = json.loads(base.run(['docker', 'run', '--rm', '--network=none', '--read-only', '--cpus=.35', '--memory=256m',
        '--entrypoint', 'node', candidate, '--v8-pool-size=1', '-e', base.PROGRAM]))
    require(actual == base.expected_program(), 'Candidate changed a protected runtime byte')
    base.baseline()
    require(base.image('royal-game:' + base.NAME) == candidate, 'Candidate tag changed during verification')
    require(shutil.disk_usage(base.LIVE).free > deploy.MIN_FREE, 'Five GiB reserve consumed during verification')
    result = {'image': candidate, 'program': actual, 'sourceCommit': SOURCE,
        'sourceBackupSha256': deploy.sha(base.BACKUP / 'source.tgz'),
        'databaseBackup': deploy.database_backup_guard(base), 'backup': str(base.BACKUP)}
    base.write('build-completion.json', {'originalProcess': process,
        'originalFailure': FAILURE, 'buildLogSha256': deploy.sha(root / 'build.log'),
        'errorLogSha256': deploy.sha(root / 'build-run.log'), 'helperSha256': deploy.sha(Path(__file__)),
        'rebuildPerformed': False, 'diskGuardPreserved': True, 'allOriginalFinalizationChecksPassed': True})
    base.write('build-result.json', result)
    return {'built': True, 'image': candidate, 'rebuildPerformed': False, 'unrelatedRuntimePreserved': True}


def main():
    require(ROOT == Path('/opt/royal-releases/universal-spins-20261031-v1'), 'Unexpected completion root')
    spec = importlib.util.spec_from_file_location('reviewed_deploy', ROOT / 'deploy.py')
    deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)
    base = deploy.configure()
    handles = []
    for path in [Path('/opt/royal-releases/themed-publish.lock'), base.LIVE / '.client-presentation-deploy.lock', base.STATE / 'module.lock']:
        require(not path.is_symlink() and not any(p.is_symlink() for p in path.parents), 'Unsafe publication lock')
        handle = path.open('a'); fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB); handles.append(handle)
    def interrupted(number, _frame): raise InterruptedError('Verification interrupted: ' + str(number))
    for number in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]: signal.signal(number, interrupted)
    print(json.dumps(complete(base, deploy)), flush=True)


if __name__ == '__main__': main()
