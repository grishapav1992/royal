"""Finish the verified running candidate after Docker serialized empty DNS as null.

No container, database, source or module switch is performed here. Original
publication evidence stays immutable. Only empty DNS representations are equal:
https://docs.docker.com/engine/network/#dns-services
https://github.com/moby/moby/blob/v29.1.3/daemon/container_operations.go
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
NAME = 'velvet-dressing-room-20261117-v1'
ROOT = Path(__file__).resolve().parent
SOURCE = 'deployment/releases/' + NAME + '/complete-publication.py'


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def sha(path):
    require(path.is_file() and not path.is_symlink(), 'Missing regular evidence: ' + str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_state(before, current, built, changed, canonical_profile):
    require(current['container']['health'] == 'healthy', 'Candidate is not healthy')
    require(current['container']['image'] == current['preparedImage'] == built['image'], 'Candidate image differs')
    require(current['source'] == {**before['source'], **changed}, 'Candidate source differs')
    require(current['program'] == current['preparedProgram'] == built['program'], 'Candidate program differs')
    for key in ['configHashes', 'moduleFiles', 'moduleHostContract', 'moduleHost', 'protectedPrograms']:
        require(current[key] == before[key], 'Protected state differs: ' + key)
    require(current['realMoneyFlags'] == before['realMoneyFlags'], 'Money flags differ')
    for key in ['mounts', 'runtimeHash', 'composeFiles']:
        require(current['container'][key] == before['container'][key], 'Runtime differs: ' + key)
    prior, actual = before['container']['host'], current['container']['host']
    require(set(prior) == set(actual), 'Host fields differ')
    for key in prior:
        require(actual[key] == prior[key] or key == 'Dns' and actual[key] is None and prior[key] == [],
                'Host setting differs: ' + key)
    require(set(current['serviceProfiles']) == set(before['serviceProfiles']), 'Service inventory differs')
    require({n:r for n,r in current['services'].items() if n != '/royal-game-1'} ==
            {n:r for n,r in before['services'].items() if n != '/royal-game-1'}, 'Other services differ')
    for name, row in before['serviceProfiles'].items():
        if name != 'royal-game-1':
            require(current['serviceProfiles'][name] == row, 'Retained service differs: ' + name)
    require(canonical_profile == before['serviceProfiles']['royal-game-1']['profileSha256'],
            'Canonical runtime profile differs')


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME and sys.argv[1:] == ['complete'], 'Unexpected completion operation')
    manifest, receipt = read(ROOT/'completion-manifest.json'), read(ROOT/'completion-github.json')
    require(sha(ROOT/'complete-publication.py') == manifest['helperSha256'] == receipt['files'][SOURCE], 'Completion helper differs')
    require(sha(ROOT/'completion-github.json') == manifest['receiptSha256'], 'Completion receipt differs')
    require(receipt['sourceCommit'] == manifest['helperSourceCommit'] and re.fullmatch('[a-f0-9]{40}',receipt['remoteMain']), 'Completion source is not saved in GitHub')
    require(sha(ROOT/'install-manifest.json') == manifest['installManifestSha256'], 'Original installation manifest changed')
    original = read(ROOT/'install-manifest.json')
    require(original['sourceCommit'] == receipt['applicationSourceCommit'] == manifest['applicationSourceCommit'], 'Application source differs')
    for file, digest in original['support'].items():
        require(sha(ROOT/file) == digest, 'Original support helper differs: ' + file)
    for file, key in [('deploy.py','helperSha256'), ('snapshot.py','snapshotSha256')]:
        require(sha(ROOT/file) == original[key], 'Original installer changed')
    require(sha(ROOT/'release-manifest.json') == original['releaseManifestSha256'] and
            sha(ROOT/'release-github.json') == original['receiptSha256'], 'Original release evidence differs')
    guard = load('velvet_completion_guard', ROOT/'production-guard.py')
    snapshot = load('velvet_completion_snapshot', ROOT/'snapshot.py')
    with guard.publication_locks():
        require(not (ROOT/'published.json').exists(), 'Publication was already completed')
        built = read(ROOT/'build-result.json')
        require(built['image'] == manifest['candidateImage'], 'Built candidate differs')
        current = json.loads(subprocess.check_output(['python3',str(ROOT/'snapshot.py')],text=True))
        require(current['container']['id'] == manifest['candidateContainer'], 'Another container replaced the reviewed candidate')
        row = json.loads(subprocess.check_output(['docker','inspect','royal-game-1'],text=True))[0]
        require(row['Id'] == current['container']['id'] and row['Image'] == built['image'], 'Container changed during inspection')
        require(snapshot.base.profile_sha(row) == current['serviceProfiles']['royal-game-1']['profileSha256'], 'Raw runtime fingerprint differs')
        canonical = copy.deepcopy(row)
        if canonical['HostConfig'].get('Dns') is None and original['before']['container']['host']['Dns'] == []:
            canonical['HostConfig']['Dns'] = []
        fingerprint = snapshot.base.profile_sha(canonical)
        validate_state(original['before'], current, built, original['changed'], fingerprint)
        require(sha(Path(built['backup'])/'source.tgz') == built['sourceBackupSha256'], 'Source backup differs')
        financial = built['financialBackup']
        require(sha(Path(financial['path'])) == financial['sha256'], 'Financial backup differs')
        for name, digest in original['delta'].items():
            require(sha(ROOT/'dist-delta'/name) == digest, 'Client mirror payload differs')
        shutil.copytree(ROOT/'dist-delta', Path('/opt/royal/dist'), dirs_exist_ok=True)
        proof = {'completed':True,'helperSourceCommit':manifest['helperSourceCommit'],
                 'applicationSourceCommit':original['sourceCommit'],'rawDns':current['container']['host']['Dns'],
                 'previousDns':original['before']['container']['host']['Dns'],
                 'rawProfileSha256':current['serviceProfiles']['royal-game-1']['profileSha256'],
                 'canonicalProfileSha256':fingerprint,'containerRestartedByCompletion':False,
                 'databaseRestored':False,'originalEvidenceChanged':False}
        (ROOT/'completion-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
        (ROOT/'after.json').write_text(json.dumps(current,indent=2)+'\n')
        result = {'published':True,'preparedImage':built['image'],'runningImage':built['image'],
                  'containerRestarted':True,'sourceCommit':original['sourceCommit'],
                  'changedSources':len(original['changed']),'clientDeltaFiles':len(original['delta']),
                  'configurationsAndMountsPreserved':True,'gameDataPreserved':True,'backendDeltaFiles':0,
                  'otherBackendProgramsAndModulesPreserved':True,'oldAssetsPreserved':True,
                  'otherPersistentServicesPreserved':len(current['services'])-1,'completion':proof}
        (ROOT/'published.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
