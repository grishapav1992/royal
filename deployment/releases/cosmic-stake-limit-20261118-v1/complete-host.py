"""Finish the verified Cosmic release after Docker serialized empty DNS as null."""
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path('/opt/royal-releases/cosmic-stake-limit-20261118-v1')
INSTALLER = ROOT / 'deploy.py'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verify_settings(base, reader, state):
    # Both representations use Docker's default DNS. Compare every other field exactly.
    previous = base.OLD['container']['host']
    observed = state['container']['host']
    require(previous['Dns'] == [] and observed['Dns'] is None
            and observed == {**previous, 'Dns': None}, 'Unexpected host configuration drift')
    row = json.loads(subprocess.check_output(['docker', 'inspect', 'royal-game-1'], text=True))[0]
    require(row['Id'] == state['container']['id'] and row['Image'] == state['container']['image']
            and row['State']['StartedAt'] == state['container']['startedAt']
            and row['HostConfig']['Dns'] is None, 'Running container changed during verification')
    profile = state['serviceProfiles']['royal-game-1']
    require(reader.profile_sha(row) == profile['profileSha256'], 'Running service profile changed')
    row['HostConfig']['Dns'] = []
    normalized = copy.deepcopy(state)
    normalized['container']['host']['Dns'] = []
    normalized['serviceProfiles']['royal-game-1']['profileSha256'] = reader.profile_sha(row)
    base.settings(normalized)
    return {'field': 'Dns', 'before': [], 'after': None, 'effectiveConfiguration': 'Docker default'}


def complete(base, deploy, receipt):
    base.payload()
    require(not (ROOT / 'published.json').exists() and not (ROOT / 'module-published.json').exists()
            and not (ROOT / 'recovered.json').exists(), 'A later operation has already finalized this release')
    failure = deploy.read('publication-failed.json')
    require(failure == {'errorType': 'RuntimeError', 'reason': 'Runtime settings changed: host',
                        'daemonOutcomeUnknown': False, 'mutationStarted': True, 'databaseRestored': False},
            'Unexpected publication failure')
    require(not (ROOT / 'recovery-required.json').exists(), 'Daemon outcome requires separate recovery')
    built = deploy.read('build-result.json')
    base.publication_backup(built)
    base.publication_capacity()
    base.healthy()
    reader = deploy.load('snapshot_reader', 'snapshot-base.py')
    state = base.snapshot()
    dns = verify_settings(base, reader, state)
    require(state['container']['health'] == 'healthy' and state['sourceCommit'] == base.M['sourceCommit']
            and state['container']['image'] == state['preparedImage'] == built['image']
            and state['program'] == state['preparedProgram'] == built['program'] == base.expected_program(),
            'Candidate program differs from its verified build')
    require(base.sources(state) == {**base.BASE, **base.CHANGES}, 'Candidate source differs from its verified build')
    publisher = deploy.load('module_publisher', 'publisher.py')
    args = deploy.module_options(base, publisher)

    shutil.copytree(ROOT / 'dist-delta', base.LIVE / 'dist', dirs_exist_ok=True)
    base.write('after.json', state)
    result = {
        'published': True, 'preparedImage': built['image'], 'runningImage': state['container']['image'],
        'sourceCommit': base.M['sourceCommit'], 'containerRestarted': True, 'changedSources': len(base.CHANGES),
        'clientDeltaFiles': len(base.DELTA), 'backendDeltaFiles': len(base.SERVER_DELTA),
        'gameDataPreserved': True, 'oldAssetsPreserved': True,
        'configurationsAndMountsPreserved': True, 'otherBackendProgramsAndModulesPreserved': True,
        'otherPersistentServicesPreserved': len(state['services']) - 1,
        'completion': {'helperSourceCommit': receipt['sourceCommit'], 'verifiedRuntimeDifference': dns,
                       'candidateReused': True, 'additionalRestart': False},
    }
    base.write('published.json', result)
    print(json.dumps(result), flush=True)
    print(json.dumps(deploy.switch_module(base, publisher, args)), flush=True)


def main():
    own_file = Path(__file__).resolve()
    require(own_file == ROOT / 'complete-host.py' and sys.argv[1:] == [], 'Unexpected completion location or arguments')
    sys.path.insert(0, str(ROOT))
    import deploy

    manifest = deploy.read('install-manifest.json')
    require(not INSTALLER.is_symlink() and hashlib.sha256(INSTALLER.read_bytes()).hexdigest() == manifest['helperSha256'],
            'Original installer changed')
    receipt = deploy.read('completion-github.json')
    require(receipt['applicationSourceCommit'] == manifest['sourceCommit']
            and re.fullmatch('[a-f0-9]{40}', receipt['sourceCommit'])
            and re.fullmatch('[a-f0-9]{40}', receipt['remoteMain'])
            and receipt['includedInMain'] is True
            and hashlib.sha256(own_file.read_bytes()).hexdigest() == receipt['helperSha256'],
            'Unverified completion source')
    require(set(manifest['support']) == deploy.SUPPORT, 'Unexpected support scope')
    for name, digest in manifest['support'].items():
        path = ROOT / name
        require(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == digest,
                'Support helper changed: ' + name)
    guard = deploy.load('production_guard', 'production-guard.py')
    scope = deploy.read('scope.json')
    guard.NAME, guard.ROOT = deploy.NAME, deploy.ROOT
    guard.SOURCES = set(scope['host'] + scope['backend'] + scope['module'])
    guard.MEDIA = {}
    guard.payload = lambda base: deploy.validate(base, guard, scope)

    try:
        with guard.publication_locks():
            complete(guard.configure(ROOT), deploy, receipt)
    except guard.PublicationBusy as error:
        print(json.dumps({'status': 'publication_busy', 'error': str(error)}), file=sys.stderr)
        sys.exit(75)


if __name__ == '__main__':
    main()
