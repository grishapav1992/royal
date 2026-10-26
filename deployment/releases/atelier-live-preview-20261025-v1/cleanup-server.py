from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil

root = Path('/opt/royal-releases/atelier-live-preview-20261025-v1')
locks = []
for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
    handle = open(name, 'a')
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    locks.append(handle)
manifest = json.loads((root / 'install-manifest.json').read_text())
published = json.loads((root / 'published.json').read_text())
assert published['published'] is True
assert published['sourceCommit'] == manifest['sourceCommit'] == '27264a8cac2744aad98145631e76a291af5cbedf'
assert json.loads((root / 'exit.json').read_text())['exitCode'] == 0
context = root / 'runtime-context'
assert context.is_dir() and not context.is_symlink()
expected = {'dist-delta/' + name: digest for name, digest in manifest['delta'].items()}
texts = {
    'Dockerfile': 'FROM royal-game:before-atelier-live-preview-20261025-v1-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="' + manifest['sourceCommit'] + '"\n',
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
before = shutil.disk_usage(root).free
shutil.rmtree(context)
after = shutil.disk_usage(root).free
result = {
    'removedFolder': str(context),
    'removedFiles': len(actual),
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
