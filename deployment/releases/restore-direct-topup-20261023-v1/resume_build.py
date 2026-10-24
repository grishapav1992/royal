"""Resume only a stopped pre-publication image build with the existing verified backup."""
from pathlib import Path
import fcntl
import json
import os
import subprocess
import deploy as p


def resume():
    p.require(p.sha(p.ROOT / 'resume_build.py') == p.M['resumeHelperSha256'], 'Resume helper changed')
    p.require(not (p.ROOT / 'published.json').exists() and not (p.ROOT / 'build-result.json').exists(), 'Build is no longer resumable')
    p.payload()
    old = p.baseline()
    p.require(old['availableBytes'] > 5 * 1024**3 + 100 * 1024**2, 'Insufficient disk reserve')
    p.verify_tar(p.BACKUP / 'source.tgz')
    p.require(p.sha(p.BACKUP / 'index.html') == p.OLD['program']['dist/index.html'], 'Rollback index changed')
    p.require(p.image('royal-game:before-' + p.NAME + '-prepared') == p.OLD['preparedImage'], 'Pinned parent changed')
    p.require(p.image('royal-game:before-' + p.NAME) == p.OLD['container']['image'], 'Pinned running image changed')
    context = p.ROOT / 'runtime-context'
    expected = ('FROM royal-game:before-' + p.NAME + '-prepared\n'
                'COPY --chown=node:node dist-delta/ /app/dist/\n'
                'COPY --chown=node:node server-delta/index.js /app/dist-server/index.js\n'
                'LABEL org.opencontainers.image.revision="' + p.M['sourceCommit'] + '"\n')
    p.require((context / 'Dockerfile').read_text() == expected, 'Reviewed image instructions changed')
    p.require(p.inventory(context / 'dist-delta') == p.DELTA and p.inventory(context / 'server-delta') == p.SERVER_DELTA, 'Context differs from reviewed payload')
    with (p.ROOT / 'legacy-build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'royal-game:' + p.NAME, '.'], cwd=context,
                       env={**os.environ, 'DOCKER_BUILDKIT': '0'}, check=True, stdout=log, stderr=subprocess.STDOUT)
    candidate = p.image('royal-game:' + p.NAME)
    program = json.loads(p.run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', candidate, '--v8-pool-size=1', '-e', p.PROGRAM]))
    p.require(program == p.expected_program(), 'Candidate bytes differ')
    parent, child = json.loads(p.run(['docker', 'image', 'inspect', p.OLD['preparedImage'], candidate]))
    p.require(child['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == p.M['sourceCommit'], 'Candidate source label differs')
    for key in ['User', 'WorkingDir', 'Env', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        p.require(parent['Config'].get(key) == child['Config'].get(key), 'Image configuration changed: ' + key)
    p.require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'], 'Parent layers changed')
    p.write('build-result.json', {'image': candidate, 'program': program, 'sourceCommit': p.M['sourceCommit'],
                                'sourceBackupSha256': p.sha(p.BACKUP / 'source.tgz'), 'backup': str(p.BACKUP)})
    print(json.dumps({'built': True, 'image': candidate, 'backupReused': True}), flush=True)
    print(json.dumps(p.publish()), flush=True)


if __name__ == '__main__':
    paths = [Path('/opt/royal-releases/themed-publish.lock'), p.LIVE / '.client-presentation-deploy.lock', p.STATE / 'module.lock']
    locks = []
    for path in paths:
        p.require(not path.is_symlink(), 'Lock symlink rejected')
        lock = path.open('a'); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(lock)
    resume()
