"""Finish verification of the already running, reviewed level release."""
from pathlib import Path
import fcntl
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import time
import types

NAME = 'location-levels-20261030-v1'
ROOT = Path('/opt/royal-releases') / NAME
PREVIOUS = ROOT.parent / 'flooded-temple-20261030-v1'
PREVIOUS_SHA = '9daefd8e7a2f1b36fba0020826388792570f4da00734631a5aae169e1d6bfb99'
SOURCE = '38ce8d04adbc70cf2a7e80cf017663463dd68b2a'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def read(path):
    require(path.is_file() and not path.is_symlink(), 'Expected a regular verification file')
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def semantic_profile(row):
    config = row['Config']
    environment = config.get('Env', [])
    require(len(environment) == len({value.split('=', 1)[0] for value in environment}), 'Duplicate environment variable')
    return {'user': config.get('User'), 'cwd': config.get('WorkingDir'), 'cmd': config.get('Cmd'),
        'entrypoint': config.get('Entrypoint'),
        'envHash': hashlib.sha256(json.dumps(sorted(environment)).encode()).hexdigest(),
        'host': {key: row['HostConfig'].get(key) for key in ['CpuShares', 'NanoCpus', 'Memory', 'MemorySwap',
            'MemoryReservation', 'PidsLimit', 'ReadonlyRootfs', 'RestartPolicy', 'PortBindings', 'CapAdd', 'CapDrop',
            'SecurityOpt', 'Privileged', 'Ulimits', 'GroupAdd', 'Dns', 'ExtraHosts']},
        'mounts': sorted([{key: mount.get(key) for key in ['Type', 'Source', 'Destination', 'RW', 'Propagation']}
                          for mount in row['Mounts']], key=lambda mount: mount['Destination']),
        'networks': sorted(row['NetworkSettings']['Networks'])}


def approved_profile(manifest):
    require(sha(PREVIOUS / 'install-manifest.json') == PREVIOUS_SHA
            == manifest['before']['verifiedAgainst']['installManifestSha256'], 'Prior release evidence changed')
    previous, published = read(PREVIOUS / 'install-manifest.json'), read(PREVIOUS / 'published.json')
    require(previous['sourceCommit'] == published['sourceCommit'] == manifest['baseCommit']
            and published['published'] is True and published['configurationPreserved'] is True
            and published['images']['game'] == manifest['before']['container']['image'], 'Prior configuration is not the reviewed baseline')
    return previous['before']['containers']['royal-game-1']['profile']


def verify_profiles(state, before, expected, inspect_game):
    require(state['protectedPrograms'] == before['protectedPrograms'], 'Protected service program bytes changed')
    old, current = before['serviceProfiles'], state['serviceProfiles']
    require(set(current) == set(old) or state['container'] is None and set(current) == set(old) - {'royal-game-1'},
            'Persistent service profile inventory changed')
    for name, row in current.items():
        if name != 'royal-game-1':
            require(row == old[name], 'Another persistent service configuration changed')
            continue
        actual = inspect_game()
        require(all(actual[key] == state['container'][target] for key, target in [('Id', 'id'), ('Image', 'image')])
                and actual['State']['StartedAt'] == state['container']['startedAt'], 'Game changed during verification')
        require(semantic_profile(actual) == expected, 'Effective game configuration changed')


def restore_networks(actual, expected, allowed_images, execute):
    require(actual['Image'] in allowed_images, 'Unreviewed replacement image')
    networks = set(actual['NetworkSettings']['Networks'])
    require(networks.issubset(expected['networks']), 'Unexpected replacement network')
    for name in sorted(set(expected['networks']) - networks):
        execute(['docker', 'network', 'connect', name, 'royal-game-1'])


def configure(root):
    spec = importlib.util.spec_from_file_location('reviewed_level_installer', root / 'deploy.py')
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    base = installer.configure(root)
    # Reuse the pinned original checks, replacing only the order-sensitive game profile check.
    original = types.ModuleType('reviewed_original_overlay')
    original.__file__ = str(root / 'overlay-base.py')
    exec(compile((root / 'overlay-base.py').read_text(), original.__file__, 'exec'), original.__dict__)
    expected = approved_profile(base.M)

    def inspect_game():
        rows = json.loads(base.run(['docker', 'inspect', 'royal-game-1']))
        require(len(rows) == 1 and rows[0]['Name'] == '/royal-game-1', 'Unexpected game identity')
        return rows[0]

    def settings(state, recovery=False):
        original.settings(state, recovery=recovery)
        verify_profiles(state, base.OLD, expected, inspect_game)

    base.settings = settings
    original_compose = base.compose

    def compose(gate=None):
        result = original_compose(gate)
        actual = inspect_game()
        built = read(root / 'build-result.json')
        restore_networks(actual, expected, [base.OLD['container']['image'], built['image']], gate.run if gate else base.run)
        return result

    base.compose = compose
    return base, expected, inspect_game


def verified_state(base, inspect_game):
    base.payload()
    built = read(base.ROOT / 'build-result.json')
    require(built['sourceCommit'] == base.M['sourceCommit'] == SOURCE, 'Unexpected application source')
    base.backup_guard(built)
    base.publication_capacity()
    first = inspect_game()
    require(first['Image'] == built['image'] and first['State'].get('Health', {}).get('Status') == 'healthy', 'Reviewed application is not healthy')
    state = base.snapshot()
    base.settings(state)
    require(state['source'] == {**base.BASE, **base.CHANGES}, 'Published source differs')
    require(state['program'] == built['program'] == state['preparedProgram'] == base.expected_program()
            and state['preparedImage'] == state['container']['image'] == built['image'], 'Published runtime differs')
    time.sleep(3)
    last = inspect_game()
    require(all(first[key] == last[key] for key in ['Id', 'Image'])
            and first['State']['StartedAt'] == last['State']['StartedAt']
            and last['State'].get('Health', {}).get('Status') == state['container']['health'] == 'healthy',
            'Game lifecycle changed during verification')
    return state


def finalize(base, state, receipt):
    failure = read(base.ROOT / 'publication-failed.json')
    require(failure == {'errorType': 'RuntimeError', 'reason': 'Service configuration changed: royal-game-1',
                       'daemonOutcomeUnknown': False, 'mutationStarted': True, 'databaseRestored': False}, 'Unexpected publication failure')
    require(not (base.ROOT / 'recovery-required.json').exists() and not (base.ROOT / 'published.json').exists(), 'Publication requires separate reconciliation')
    for name, digest in base.DELTA.items():
        destination = base.LIVE / 'dist' / name
        require(not destination.exists() or name == 'index.html' or sha(destination) == digest, 'Client asset collision')
        base.atomic(base.ROOT / 'dist-delta' / name, destination)
    base.write('after.json', state)
    result = {'published': True, 'sourceCommit': SOURCE, 'preparedImage': state['preparedImage'],
        'runningImage': state['container']['image'], 'containerRestarted': True, 'changedSources': len(base.CHANGES),
        'clientDeltaFiles': len(base.DELTA), 'backendDeltaFiles': len(base.SERVER_DELTA),
        'configurationsAndMountsPreserved': True, 'gameDataPreserved': True,
        'otherBackendProgramsAndModulesPreserved': True, 'oldAssetsPreserved': True,
        'otherPersistentServicesPreserved': len(state['services']) - 1,
        'completionToolCommit': receipt['helperSourceCommit'], 'completionRecreatedContainer': False,
        'semanticGameProfileVerified': True, 'at': time.time()}
    base.write('completion.json', {'source': receipt, 'result': result})
    base.write('published.json', result)
    return result


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['verify', 'finalize', 'rollback'], 'Use verify, finalize or explicit rollback')
    require(Path(__file__).resolve().parent == ROOT, 'Unexpected completion path')
    receipt = read(ROOT / 'completion-tool.json')
    require(receipt.get('format') == 1 and receipt.get('applicationSourceCommit') == SOURCE
            and receipt.get('githubVerified') is True and re.fullmatch(r'[a-f0-9]{40}', receipt.get('helperSourceCommit', ''))
            and receipt.get('helperSha256') == sha(Path(__file__)), 'Completion source evidence differs')
    handles = []
    for path in [ROOT.parent / 'themed-publish.lock', Path('/opt/royal/.client-presentation-deploy.lock'), Path('/opt/royal-game-modules-state/module.lock')]:
        require(not path.is_symlink(), 'Publication lock symlink rejected')
        handle = path.open('a')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        handles.append(handle)
    base, expected, inspect_game = configure(ROOT)
    if sys.argv[1] == 'rollback':
        base.payload()
        result = base.rollback()
    else:
        state = verified_state(base, inspect_game)
        result = finalize(base, state, receipt) if sys.argv[1] == 'finalize' else {'verified': True, 'sourceCommit': SOURCE, 'runtimeFiles': len(state['program'])}
    print(json.dumps(result))


if __name__ == '__main__':
    main()
