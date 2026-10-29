"""Remove only the verified redundant transport for this completed client release."""
from pathlib import Path
import fcntl
import hashlib
import json
import shutil

root = Path('/opt/royal-releases/jackie-layout-20261030-v1').resolve(strict=True)
assert root == Path('/opt/royal-releases/jackie-layout-20261030-v1')
verification = json.loads((root / 'verification.json').read_text())
assert verification['verified'] and verification['sourceCommit'] == '2ce578d07f15d7a36daf42cbcf338427925a7091'
version = verification['version']
source = (root / version).resolve(strict=True)
installed = Path('/opt/royal-game-modules/original-jackie-chan/versions') / version
assert source.parent == root and not (root / version).is_symlink()
manifest = json.loads((source / 'manifest.json').read_text())
assert hashlib.sha256((source / 'manifest.json').read_bytes()).hexdigest() == verification['manifestSha256']
for name in ['manifest.json', *manifest['files']]:
    assert hashlib.sha256((source / name).read_bytes()).digest() == hashlib.sha256((installed / name).read_bytes()).digest()
locks = []
for name in ['/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
    handle = open(name, 'a')
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    locks.append(handle)
before = shutil.disk_usage(root).free
removed = []
for target in [source, root / '__pycache__']:
    if not target.exists():
        continue
    assert target.resolve().parent == root and not target.is_symlink()
    size = sum(p.stat().st_size for p in target.rglob('*') if p.is_file())
    shutil.rmtree(target)
    removed.append({'path': str(target), 'bytes': size})
after = shutil.disk_usage(root).free
assert after >= 5 * 1024**3
report = {'sourceCommit': verification['sourceCommit'], 'removed': removed, 'archivesRemoved': [],
          'freeBefore': before, 'freeAfter': after, 'backupAndInstalledVersionsPreserved': True,
          'physicalSpaceReclaimedAttribution': 'Not attributed during concurrent server activity'}
(root / 'transport-cleanup.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
