from pathlib import Path
import fcntl
import hashlib
import json
import shutil
import subprocess

root = Path('/opt/royal-releases/dracona-20261022-v1')
manifest = json.loads((root / 'install-manifest.json').read_text())
published = json.loads((root / 'published.json').read_text())
assert published['published'] and published['sourceCommit'] == manifest['sourceCommit']
assert subprocess.check_output(['docker', 'inspect', 'royal-game-1', '--format', '{{.Image}}'], text=True).strip() == published['image']

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

expected = {'dist-delta/' + name: value for name, value in manifest['delta'].items()}
expected.update({'module-dist/' + name: value for name, value in manifest['moduleBaseline'].items()})
expected.update({'index.js': manifest['serverSha256'], 'package.json': manifest['packageSha256']})
dockerfile = ('FROM ' + manifest['before']['preparedImage'] + '\n'
    'COPY --chown=node:node dist-delta/ /app/dist/\n'
    'COPY --chown=node:node module-dist/ /app/module-dist/\n'
    'COPY --chown=node:node index.js /app/dist-server/index.js\n'
    'COPY --chown=node:node package.json /app/package.json\n'
    'LABEL org.opencontainers.image.revision="' + manifest['sourceCommit'] + '"\n')
ignore = '**\n!Dockerfile\n!.dockerignore\n!index.js\n!package.json\n!dist-delta\n!dist-delta/**\n!module-dist\n!module-dist/**\n'
expected.update({'Dockerfile': hashlib.sha256(dockerfile.encode()).hexdigest(),
                 '.dockerignore': hashlib.sha256(ignore.encode()).hexdigest()})
with Path('/opt/royal/.client-presentation-deploy.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    context = root / 'runtime-context'
    assert not context.is_symlink() and context.is_dir()
    paths = list(context.rglob('*'))
    assert not any(path.is_symlink() for path in paths)
    actual = {str(path.relative_to(context)): sha(path) for path in paths if path.is_file()}
    assert actual == expected
    archive = root / 'payload.tgz'
    assert sha(archive) == 'b9e37c694de081818576c683d47f299987d8e95e133ef075e4b6769b32e90b0d'
    released = sum(path.stat().st_size for path in paths if path.is_file()) + archive.stat().st_size
    shutil.rmtree(context)
    archive.unlink()
    result = {'temporaryTransportAndBuildCopiesRemoved': True, 'releasedBytes': released,
              'backupsPreserved': True, 'sourceAndPrebuiltPayloadPreserved': True,
              'imagesAndDataPreserved': True, 'availableBytes': shutil.disk_usage(root).free}
    (root / 'cleanup.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
