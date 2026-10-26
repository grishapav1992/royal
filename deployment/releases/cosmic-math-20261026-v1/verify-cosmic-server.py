"""Read-only verification of the installed Cosmic release."""
from pathlib import Path
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys

if not __debug__:
    raise RuntimeError('Optimized Python would disable verification assertions')

SOURCE = 'd3e4f9c0ef50a4d1ab63f0862696e288125fd740'
HELPER_SOURCE = '59e510266213709a94d4e3e22b4cfe440f535d08'
HELPERS = {'deploy.py': 'ca1cbd3270eb6f2619a304e868476fefebc4f8e4773a205bebfecc9225a1d58b', 'snapshot.py': 'c1231d7d7514b9d0de70d71858ae249e22b671a72b68cae8511e330c8475846f', 'runtime-inventory.cjs': '460dabbe443c173c43bc6acb96f543777b3fa5cabdd5ffec5f203ad188894f6c', 'quiesce.cjs': '9a688dc59bb36ba3588fcacd29891055eb6a7eaa0f611a0b89449c8b42d73d51', 'verify-runtime.cjs': '6574ae8bd1712f7f8be61834a0c5168b6a1884bb9995f1a6a0d91a9a4101442c', 'modules.py': '195f1857660b7f43a2d0070a93b52b7ebe5ef0fc06270a20c78a6dd3a2932eaf', 'financial_gate.py': 'f3974aba494a446e90299b4e4784046e95a67f22cd62a26e66c17dbb7523a506'}
BACKEND = 'df7bb598c7ba57f86c749f401b3754653b5aaab0802953f96133444c99974359'
GUARD = 'cc9e2528bae03e8965c154f82aa271b3c9976bb3d817130ba51dedf6e8eb67ee'
ROOT = Path('/opt/royal-releases/cosmic-math-20261026-v1')
OPERATIONAL = {'cpu-priority-release-v3.py': '833d4207807dc317059bc3031657d9db49df8edd563e7cb4205ecb4adfb6ead8', 'publication-priority.py': '374b8482f87ba0593224f3a55753b0a995d26e8d635ef53ca6ff009997d01f3a', 'run-publication.py': '0844b4c1d198c78f03d3ad423e079c6906351c7d4231e96ff8ddb824997cd176'}
LIVE = Path('/opt/royal')
expected_image = sys.argv[1]
expected_manifest = sys.argv[2]
expected_proof = sys.argv[3]
assert re.fullmatch(r'sha256:[a-f0-9]{64}', expected_image)
assert re.fullmatch(r'[a-f0-9]{64}', expected_manifest)
assert re.fullmatch(r'[a-f0-9]{64}', expected_proof)

def read_json(name):
    return json.loads((ROOT / name).read_bytes())

def sha(path):
    assert path.is_file() and not path.is_symlink()
    return hashlib.sha256(path.read_bytes()).hexdigest()

def publisher():
    assert sha(ROOT / 'install-manifest.json') == expected_manifest
    value = read_json('install-manifest.json')
    assert value['sourceCommit'] == SOURCE and value['helperSourceCommit'] == HELPER_SOURCE
    assert value['helpers'] == HELPERS
    assert value['helperProofSha256'] == expected_proof
    assert sha(ROOT / 'helpers-source.json') == expected_proof
    proof = read_json('helpers-source.json')
    assert proof['sourceCommit'] == HELPER_SOURCE and proof['applicationSourceCommit'] == SOURCE
    assert value['operationalHelpers'] == OPERATIONAL
    assert proof['files'] == {**HELPERS, **OPERATIONAL}
    for name, digest in {**HELPERS, **OPERATIONAL}.items():
        assert sha(ROOT / name) == digest, name
    assert read_json('published.json')['helperSourceCommit'] == HELPER_SOURCE

def container():
    value = subprocess.check_output(['docker', 'inspect', 'royal-game-1'], timeout=30)
    return json.loads(value)[0]

def runtime(row):
    assert row['Image'] == expected_image
    state = row['State']
    assert state['Running'] and not state['Paused'] and not state['Restarting'] and not state['Dead']
    assert state['Health']['Status'] == 'healthy'
    assert row['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == SOURCE

before = container()
publisher()
runtime(before)
for name in ['install-manifest.json', 'build-result.json', 'published.json']:
    value = read_json(name)
    assert value['sourceCommit'] == SOURCE, name
    if name == 'build-result.json':
        assert value['image'] == expected_image
    if name == 'published.json':
        assert value['published'] and value['runningImage'] == expected_image
guard_path = LIVE / 'src/shared/luelonSlotsLines.ts'
guard = sha(guard_path)
assert guard == GUARD
program = "const f=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(f.readFileSync('/app/dist-server/index.js')).digest('hex'))"
backend = subprocess.check_output(['docker', 'exec', before['Id'], 'node', '-e', program], timeout=30, text=True)
assert backend == BACKEND
manifest = read_json('install-manifest.json')
assert sha(Path('/opt/royal-game-modules/mortal-kombat/active.json')) == manifest['before']['moduleFiles']['/opt/royal-game-modules/mortal-kombat/active.json']
assert sha(Path('/opt/royal-game-modules-state/host.json')) == manifest['before']['moduleHostContract']
exit_report = read_json('release-exit.json')
assert exit_report['code'] == 0 and not exit_report['publisherStillRunning'] and not exit_report['priorityReleasePending']
weights = {}
for group, expected in [('docker.service', 100), ('containerd.service', 100), ('docker-' + before['Id'] + '.scope', 532)]:
    value = int((Path('/sys/fs/cgroup/system.slice')/group/'cpu.weight').read_text())
    assert value == expected
    weights[group] = value
for folder in ROOT.glob('priority-*'):
    if folder.is_dir() and (folder/'plan.json').is_file():
        assert (folder/'cancelled.json').is_file() and (folder/'finish').is_file()
        for row in json.loads((folder/'plan.json').read_text())['rows']:
            path = Path(row['path'])
            if path.exists():
                assert int(path.read_text()) == row['old']
free = shutil.disk_usage(LIVE).free
assert free >= 5 * 1024**3
after = container()
runtime(after)
assert (before['Id'], before['Image'], before['State']['StartedAt']) == (after['Id'], after['Image'], after['State']['StartedAt'])
assert sha(guard_path) == GUARD
publisher()
print(json.dumps({'format': 1, 'passed': True, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Read-only running container, installed guard source, compiled backend, source and disk reserve checks',
    'sourceCommit': SOURCE, 'image': expected_image, 'containerId': before['Id'], 'healthy': True,
    'helperSourceCommit': HELPER_SOURCE, 'helperProofSha256': expected_proof,
    'installManifestSha256': expected_manifest, 'helperFilesVerified': {**HELPERS, **OPERATIONAL},
    'guardSha256': guard, 'backendSha256': backend, 'freeBytes': free, 'minimumFreeBytes': 5 * 1024**3,
    'containerStableDuringCheck': True, 'mortalActivePointerPreserved': True, 'hostContractPreserved': True, 'publicationExitedZero': True, 'cpuWeightsRestored': weights, 'playerOperationsPerformed': False}))
