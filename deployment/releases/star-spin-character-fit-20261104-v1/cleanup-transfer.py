"""Remove only this verified module release's unused transport after maintenance."""
import fcntl, hashlib, json, os, shutil, subprocess, time
from pathlib import Path

ROOT = Path('/opt/royal-releases/star-spin-character-fit-20261104-v1')
ARCHIVE = ROOT / 'payload.tgz'
SOURCE = 'a26bad2378dbccdb61c9539d34a4b240037059af'
POINTER = 'd10d279193c0955179df0326378d420414ede509750f0de1be9854c2f5768d80'
IMAGE = 'sha256:08d83a2095974b1baaad62e376149e38f74c31f9319da9c6dbefbc1f49859713'

def read(path):
    assert not path.is_symlink()
    return json.loads(path.read_text())

def main():
    assert ROOT.resolve() == ROOT and not ROOT.is_symlink()
    locks = []
    for path in [Path('/opt/royal-releases/themed-publish.lock'), Path('/opt/royal/.client-presentation-deploy.lock'), Path('/opt/royal-game-modules-state/module.lock')]:
        assert not path.is_symlink()
        handle = path.open('a')
        fcntl.flock(handle, fcntl.LOCK_EX)
        locks.append(handle)
    published, receipt = read(ROOT / 'published.json'), read(ROOT / 'release-github.json')
    assert published['published'] and published['sourceCommit'] == receipt['sourceCommit'] == SOURCE
    maintenance = read(Path('/opt/royal-maintenance/last-result.json'))
    assert maintenance['status'] == 'completed' and maintenance['startedAt'] >= 1793789538
    active = Path('/opt/royal-game-modules/studio-wild-nudge/active.json')
    assert hashlib.sha256(active.read_bytes()).hexdigest() == POINTER
    policy = read(Path('/opt/royal-dev-app-retention/policy.json'))
    assert all(row.get('path') != str(ARCHIVE) for version in policy['workingVersions'] for row in version.get('requiredFiles', []))
    health = subprocess.check_output(['docker', 'inspect', 'royal-game-1', '--format', '{{.Image}} {{.State.Health.Status}}'], text=True).strip()
    assert health == IMAGE + ' healthy'
    assert ARCHIVE.resolve() == ARCHIVE and ARCHIVE.is_file() and not ARCHIVE.is_symlink()
    assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == 'eaa936ee85ddd367f095e31eb94818875d280bed5ea295ba3eede5dc494fb654'
    before, size = shutil.disk_usage('/opt').free, ARCHIVE.stat().st_size
    assert before >= 5 * 1024**3 and size == 13900552
    ARCHIVE.unlink()
    descriptor = os.open(ROOT, os.O_RDONLY)
    os.fsync(descriptor)
    os.close(descriptor)
    after = shutil.disk_usage('/opt').free
    result = {'status': 'completed', 'checkedAtEpoch': time.time(), 'removedArchive': str(ARCHIVE), 'removedBytes': size,
              'freeBefore': before, 'freeAfter': after, 'measuredFreeDelta': after - before, 'sourceCommit': SOURCE,
              'preservedReportCommit': '7f6f8ccfa11a8809104fc9444ac22f89b4c95c82', 'requiredRecoveryProofsPreserved': True,
              'activePointerPreserved': True, 'hostRestarted': False}
    (ROOT / 'cleanup-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))

if __name__ == '__main__':
    main()
