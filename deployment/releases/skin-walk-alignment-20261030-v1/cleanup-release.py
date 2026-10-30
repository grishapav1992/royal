"""Remove only checksum-verified temporary files from this completed release."""
from pathlib import Path
import fcntl
import hashlib
import json
import shutil

root = Path('/opt/royal-releases/skin-walk-alignment-20261030-v1')
assert root.resolve() == root and not root.is_symlink()
lock = (root / 'cleanup.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
m = json.loads((root / 'install-manifest.json').read_text())
verified = json.loads((root / 'verification.json').read_text())
assert verified['published'] and verified['sourceCommit'] == m['sourceCommit'] == 'afced898da518429a934aab3d9bb242929674360'
assert verified['preparedImage'] == json.loads((root / 'build-result.json').read_text())['image']
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
dockerfile = 'FROM royal-game:before-skin-walk-alignment-20261030-v1\nCOPY --chown=node:node dist/ /app/dist/\nLABEL org.opencontainers.image.revision="' + m['sourceCommit'] + '"\n'
directories = {
    'context': {**{'dist/' + name: digest for name, digest in m['delta'].items()}, 'Dockerfile': hashlib.sha256(dockerfile.encode()).hexdigest()},
    'obsolete-dist-pre-cat': {
        'assets/main-skin-walk-fb79bca4d7b3.js': 'fb79bca4d7b335538ab3abd52c1c76b53a917515535553b5885728c0d341f36b',
        'index.html': 'e5ae982cb2d7276ece73ba41ccf086471584ec618ae674122f814983035d4be0',
    },
}
archives = {
    'client-transport.tgz': 'a4071239608aab5e37699f67e0508d5773ecfa6984a0c9bee14e037d818f75f2',
    'client-transport-v2.tgz': '733af1922f44ca9898e75086b2ebce2372c8d2941d89513e780cb71fb5c4ee05',
}
removed = []
for name, expected in directories.items():
    directory = root / name
    assert directory.resolve() == directory and directory.is_dir() and not directory.is_symlink()
    assert not any(p.is_symlink() for p in directory.rglob('*'))
    files = {p.relative_to(directory).as_posix(): p for p in directory.rglob('*') if p.is_file()}
    assert {name: sha(p) for name, p in files.items()} == expected
    removed.append({'path': str(directory), 'logicalBytes': sum(p.stat().st_size for p in files.values())})
for name, expected in archives.items():
    p = root / name
    assert p.resolve() == p and p.is_file() and not p.is_symlink() and sha(p) == expected
    removed.append({'path': str(p), 'logicalBytes': p.stat().st_size})
before = shutil.disk_usage(root).free
for name in directories:
    shutil.rmtree(root / name)
for name in archives:
    (root / name).unlink()
report = {'removed': removed, 'freeBytesBefore': before, 'freeBytesAfter': shutil.disk_usage(root).free,
          'preserved': ['active client payload and source', 'verification manifests', 'rollback images and source backup', 'all live application data and configuration'],
          'note': 'Observed free-space changes overlap other active tasks; do not attribute the entire change to this cleanup.'}
(root / 'cleanup-release.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
