from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil

root = Path('/opt/royal-releases/skin-walk-seams-20261027-v1')
locks = []
for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
    handle = open(name, 'a')
    fcntl.flock(handle, fcntl.LOCK_EX)
    locks.append(handle)
manifest = json.loads((root / 'install-manifest.json').read_text())
published = json.loads((root / 'published.json').read_text())
assert published['published'] is True
assert published['sourceCommit'] == manifest['sourceCommit'] == 'bffc5eb54ef9957cfb9847ecd8bd721fc77e3e11'
assert json.loads((root / 'exit.json').read_text())['exitCode'] == 0
context = root / 'runtime-context'
assert context.is_dir() and not context.is_symlink()
expected = {'dist-delta/' + name: digest for name, digest in manifest['delta'].items()}
texts = {
    'Dockerfile': 'FROM royal-game:before-skin-walk-seams-20261027-v1-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="' + manifest['sourceCommit'] + '"\n',
    '.dockerignore': '**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n!server-delta\n!server-delta/index.js\n',
}
expected.update({name: hashlib.sha256(value.encode()).hexdigest() for name, value in texts.items()})
actual = {}
allocated = context.stat().st_blocks * 512
linked = 0
for path in context.rglob('*'):
    assert not path.is_symlink()
    stat = path.stat()
    if path.is_file():
        actual[str(path.relative_to(context))] = hashlib.sha256(path.read_bytes()).hexdigest()
        if stat.st_nlink > 1:
            linked += stat.st_size
            continue
    allocated += stat.st_blocks * 512
assert actual == expected
archive = root / 'transport.tgz'
assert archive.is_file() and not archive.is_symlink()
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'a0dd76bee7be8a3df85595b516455588d3c2fe88ecd4215695124696aa4443b1'
archive_bytes = archive.stat().st_size
cache = root / '__pycache__'
cache_files = list(cache.iterdir()) if cache.exists() else []
assert not cache.is_symlink()
assert all(p.is_file() and not p.is_symlink() and p.name.startswith('financial_gate.cpython-') and p.name.endswith('.pyc') for p in cache_files)
cache_bytes = sum(p.stat().st_size for p in cache_files)
assert cache_bytes <= 1024**2
before = shutil.disk_usage(root).free
shutil.rmtree(context)
archive.unlink()
if cache.exists(): shutil.rmtree(cache)
after = shutil.disk_usage(root).free
result = {
    'removedFolder': str(context),
    'removedFiles': len(actual),
    'removedArchive': str(archive),
    'removedArchiveBytes': archive_bytes,
    'removedCacheFolder': str(cache),
    'removedCacheBytes': cache_bytes,
    'exclusiveAllocatedBytes': allocated,
    'sharedPayloadBytesPreserved': linked,
    'freeBeforeBytes': before,
    'freeAfterBytes': after,
    'sourceCommit': manifest['sourceCommit'],
    'sourceBackupAndImagesPreserved': True,
    'runtimeAndVolumesTouched': False,
}
(root / 'cleanup.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
