"""Publish the reviewed skin client without interrupting rooms or financial operations."""
from pathlib import Path
import contextlib
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
LIVE = Path('/opt/royal')
NAME = 'skin-walk-alignment-20261030-v1'
BACKUP = Path('/opt/royal-backups') / NAME
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
run = lambda args: subprocess.check_output(args, text=True).strip()


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def stable(state):
    result = {key: value for key, value in state.items() if key not in ['at', 'freeBytes']}
    result['containers'] = {name: {k: v for k, v in row.items() if k != 'health'} for name, row in state['containers'].items()}
    return result


def atomic(source, destination):
    require(not destination.is_symlink(), 'Destination symlink')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name('.skin-walk-next-' + destination.name)
    require(not temporary.exists(), 'Unfinished source switch')
    with temporary.open('xb') as output:
        output.write(source.read_bytes())
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, destination)


def switch_index(source):
    run(['docker', 'cp', str(source), 'royal-game-1:/app/dist/.skin-walk-index-next'])
    run(['docker', 'exec', '-u', '0', 'royal-game-1', 'mv', '/app/dist/.skin-walk-index-next', '/app/dist/index.html'])


def publish():
    m = json.loads((ROOT / 'install-manifest.json').read_text())
    old = m['before']
    require(ROOT == Path('/opt/royal-releases') / NAME and m['release'] == NAME, 'Wrong release directory')
    require(m['githubVerified'] and len(m['sourceCommit']) == 40, 'Missing saved source')
    require(set(m['changed']) == {'src/game/generatedSkinArt.ts', 'src/game/skinPoseAlignment.ts', 'src/shared/skinAssetUrl.ts', 'src/shared/skinStudio.ts'}, 'Unexpected source scope')
    for name in ['publish.py', 'snapshot.py', 'runtime-inventory.cjs']:
        require(sha(ROOT / name) == m['helpers'][name], 'Helper changed: ' + name)
    for folder, expected in [('source', m['changed']), ('dist', m['delta'])]:
        actual = {p.relative_to(ROOT / folder).as_posix(): sha(p) for p in (ROOT / folder).rglob('*') if p.is_file() and not p.is_symlink()}
        require(actual == expected, 'Payload differs: ' + folder)
    require('index.html' in m['delta'] and all(n == 'index.html' or (n.startswith('assets/main-') and n.endswith('.js')) for n in m['delta']), 'Unexpected client scope')
    require(all('dist/' + n not in old['program'] for n in m['delta'] if n != 'index.html'), 'Immutable asset URL would change')
    spec = importlib.util.spec_from_file_location('skin_snapshot', ROOT / 'snapshot.py')
    snapshot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(snapshot)
    current = snapshot.snapshot()
    require(current['containers']['royal-game-1']['health'] == 'healthy', 'Unhealthy current game')
    before = stable(current)
    require(before == stable(old), 'Production advanced after review')
    require(old['containers']['royal-game-1']['health'] == 'healthy', 'Unhealthy game baseline')
    require(old['containers']['royal-game-1']['image'] == old['preparedImage'] and old['program'] == old['preparedProgram'], 'Unexpected existing runtime overlay')
    proof = m['clientPatch']
    require(proof['original']['sha256'] == old['program']['dist' + proof['original']['url']]
            and proof['original']['indexSha256'] == old['program']['dist/index.html'], 'Client patch baseline differs')
    require(len(proof['changes']) == 3 and proof['rendererBytes'] < 16384, 'Unexpected renderer transformation')
    require(set(proof['inputs']) == {'src/game/generatedSkinArt.ts', 'src/game/skinPoseAlignment.ts', 'src/shared/skinAssetUrl.ts'}, 'Unrelated renderer imports')
    require(all(digest == m['changed'][name] for name, digest in proof['inputs'].items()), 'Renderer source differs from payload')
    require(shutil.disk_usage(LIVE).free >= 5 * 1024 ** 3, 'Less than 5 GiB free')
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    originals = {name: (LIVE / name).exists() for name in m['changed']}
    with tarfile.open(BACKUP / 'source.tgz', 'w:gz') as archive:
        for name, exists in originals.items():
            if exists:
                archive.add(LIVE / name, arcname=name)
    with tarfile.open(BACKUP / 'source.tgz') as archive:
        require({row.name: hashlib.sha256(archive.extractfile(row).read()).hexdigest() for row in archive} ==
                {name: old['source'][name]['sha256'] for name, exists in originals.items() if exists}, 'Source backup differs')
    run(['docker', 'cp', 'royal-game-1:/app/dist/index.html', str(BACKUP / 'index.html')])
    require(sha(BACKUP / 'index.html') == old['program']['dist/index.html'], 'Index backup differs')
    run(['docker', 'tag', old['preparedImage'], 'royal-game:before-' + NAME])
    run(['docker', 'tag', old['preparedImage'], 'royal-game:before-' + NAME + '-prepared'])
    context = ROOT / 'context'
    context.mkdir(exist_ok=False)
    shutil.copytree(ROOT / 'dist', context / 'dist')
    (context / 'Dockerfile').write_text('FROM royal-game:before-' + NAME + '\nCOPY --chown=node:node dist/ /app/dist/\nLABEL org.opencontainers.image.revision="' + m['sourceCommit'] + '"\n')
    with (ROOT / 'build.log').open('w') as output:
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'royal-game:' + NAME, '.'], cwd=context, check=True, stdout=output, stderr=subprocess.STDOUT)
    image = run(['docker', 'image', 'inspect', 'royal-game:' + NAME, '--format', '{{.Id}}'])
    program = {**old['program'], **{'dist/' + name: digest for name, digest in m['delta'].items()}}
    actual = json.loads(run(['docker', 'run', '--rm', '--read-only', '--network=none', '--entrypoint', 'node', image, '-e', snapshot.PROGRAM]))
    require(actual == program, 'Prepared image changes unrelated files')
    parent, child = json.loads(run(['docker', 'image', 'inspect', old['preparedImage'], image]))
    for key in ['User', 'Env', 'WorkingDir', 'Entrypoint', 'Cmd', 'ExposedPorts', 'Healthcheck', 'Volumes']:
        require(parent['Config'].get(key) == child['Config'].get(key), 'Image configuration changed: ' + key)
    require(child['RootFS']['Layers'][:len(parent['RootFS']['Layers'])] == parent['RootFS']['Layers'], 'Image baseline layers changed')
    (ROOT / 'build-result.json').write_text(json.dumps({'image': image, 'program': program, 'sourceCommit': m['sourceCommit']}, indent=2))
    require(stable(snapshot.snapshot()) == before, 'Production changed during build')
    changed = False
    try:
        for name in m['delta']:
            if name == 'index.html':
                continue
            run(['docker', 'cp', str(ROOT / 'dist' / name), 'royal-game-1:/app/dist/' + name])
            atomic(ROOT / 'dist' / name, LIVE / 'dist' / name)
        changed = True
        for name in m['changed']:
            atomic(ROOT / 'source' / name, LIVE / name)
        switch_index(ROOT / 'dist/index.html')
        atomic(ROOT / 'dist/index.html', LIVE / 'dist/index.html')
        run(['docker', 'tag', image, 'royal-game:latest'])
        after = snapshot.snapshot()
        require(after['program'] == program and after['preparedProgram'] == program, 'Published client differs')
        require(after['preparedImage'] == image, 'Prepared image differs')
        expected_source = dict(old['source'])
        for name, digest in m['changed'].items():
            data = (ROOT / 'source' / name).read_bytes()
            expected_source[name] = {'sha256': digest, 'lf': hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()}
        require(after['source'] == expected_source, 'Unrelated source changed')
        for key in before:
            if key not in ['source', 'program', 'preparedProgram', 'preparedImage']:
                require(stable(after)[key] == before[key], 'Protected state changed: ' + key)
        require(after['containers']['royal-game-1']['health'] == 'healthy', 'Published game unhealthy')
        result = {'published': True, 'sourceCommit': m['sourceCommit'], 'runningImage': old['preparedImage'], 'preparedImage': image,
                  'containerRestarted': False, 'backendAndDependenciesPreserved': True, 'modulesAndConfigurationPreserved': True,
                  'playerDataTouched': False, 'backup': str(BACKUP), 'sourceBackupSha256': sha(BACKUP / 'source.tgz'),
                  'sourceBackupBytes': (BACKUP / 'source.tgz').stat().st_size, 'delta': m['delta']}
        (ROOT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result), flush=True)
    except BaseException:
        if changed:
            switch_index(BACKUP / 'index.html')
            atomic(BACKUP / 'index.html', LIVE / 'dist/index.html')
            with tarfile.open(BACKUP / 'source.tgz') as archive:
                for name, exists in originals.items():
                    if exists:
                        destination = ROOT / 'restore' / name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_bytes(archive.extractfile(name).read())
                        atomic(destination, LIVE / name)
                    else:
                        (LIVE / name).unlink(missing_ok=True)
            run(['docker', 'tag', old['preparedImage'], 'royal-game:latest'])
        raise


if __name__ == '__main__':
    import fcntl
    with contextlib.ExitStack() as stack:
        for name in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
            handle = stack.enter_context(Path(name).open('a'))
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publish()
