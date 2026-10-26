from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil

root = Path('/opt/royal-releases/skin-npc-context-20261026-v1')
locks = []
for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
    handle = open(name, 'a')
    fcntl.flock(handle, fcntl.LOCK_EX)
    locks.append(handle)
manifest = json.loads((root / 'install-manifest.json').read_text())
published = json.loads((root / 'published.json').read_text())
assert published['published'] is True
assert published['sourceCommit'] == manifest['sourceCommit'] == 'ae17a8df9e894278dedc29f08c052fe68ee09c04'
assert json.loads((root / 'exit.json').read_text())['exitCode'] == 0
context = root / 'runtime-context'
assert context.is_dir() and not context.is_symlink()
expected = {'dist-delta/' + name: digest for name, digest in manifest['delta'].items()}
expected.update({'server-delta/' + name: digest for name, digest in manifest['serverDelta'].items()})
texts = {
    'Dockerfile': 'FROM royal-game:before-skin-npc-context-20261026-v1-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\nCOPY --chown=node:node server-delta/ /app/dist-server/\nLABEL org.opencontainers.image.revision="' + manifest['sourceCommit'] + '"\n',
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
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'b8b0641f432fc4e0df5729acface374dc5c19fddac592e6dc8382f3a1333d39d'
archive_bytes = archive.stat().st_size
archive_allocated = archive.stat().st_blocks * 512
before = shutil.disk_usage(root).free
shutil.rmtree(context)
archive.unlink()
after = shutil.disk_usage(root).free
result = {
    'removedFolder': str(context),
    'removedFiles': len(actual),
    'removedArchive': str(archive),
    'removedArchiveBytes': archive_bytes,
    'archiveAllocatedBytes': archive_allocated,
    'exclusiveAllocatedBytes': allocated,
    'sharedPayloadBytesPreserved': linked,
    'freeBeforeBytes': before,
    'freeAfterBytes': after,
    'sourceCommit': manifest['sourceCommit'],
    'sourceAndDatabaseBackupsAndImagesPreserved': True,
    'runtimeAndVolumesTouched': False,
}
(root / 'cleanup.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
