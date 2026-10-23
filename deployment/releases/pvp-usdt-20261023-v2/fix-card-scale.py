"""Publish only the reviewed card-table display size, preserving the running backend."""
from pathlib import Path
import fcntl
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
PREVIOUS = Path('/opt/royal-releases/neopolis-dracona-20261023-v1')
spec = importlib.util.spec_from_file_location('snapshot', PREVIOUS / 'snapshot.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
m = json.loads((ROOT / 'card-scale-manifest.json').read_text())
before = json.loads((PREVIOUS / 'after.json').read_text())
run = lambda args: subprocess.check_output(args, text=True).strip()
with open('/opt/royal-releases/themed-publish.lock', 'a+') as app, open('/opt/royal-game-modules-state/module.lock', 'a+') as modules:
    fcntl.flock(app, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fcntl.flock(modules, fcntl.LOCK_EX | fcntl.LOCK_NB)
    now = s.snapshot()
    for key in ['source', 'program', 'preparedProgram', 'preparedImage', 'modules', 'hostContract', 'configuration']:
        assert now[key] == before[key], 'Production advanced: ' + key
    assert now['containers']['royal-game-1']['image'] == m['beforeImage']
    folder = ROOT / 'card-scale'
    folder.mkdir(exist_ok=False)
    with tarfile.open(ROOT / 'card-scale.tgz') as archive:
        for member in archive:
            assert member.isfile() and member.name in m['files'] and '..' not in Path(member.name).parts
            data = archive.extractfile(member).read()
            assert hashlib.sha256(data).hexdigest() == m['files'][member.name]
            destination = folder / member.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    backup = Path('/opt/royal-backups/pvp-card-scale-20261023')
    backup.mkdir(exist_ok=False, mode=0o700)
    shutil.copyfile('/opt/royal/src/game/activityArt.ts', backup / 'activityArt.ts')
    run(['docker', 'cp', 'royal-game-1:/app/dist/index.html', str(backup / 'index.html')])
    run(['docker', 'tag', m['beforeImage'], 'royal-game:before-pvp-card-scale-20261023'])
    (folder / 'Dockerfile').write_text('FROM royal-game:before-pvp-card-scale-20261023\nCOPY --chown=node:node dist/ /app/dist/\nLABEL org.opencontainers.image.revision="' + m['sourceCommit'] + '"\n')
    with (ROOT / 'card-scale-build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--pull=false', '-t', 'royal-game:pvp-card-scale-20261023', '.'], cwd=folder, check=True, stdout=log, stderr=subprocess.STDOUT)
    image = run(['docker', 'image', 'inspect', 'royal-game:pvp-card-scale-20261023', '--format', '{{.Id}}'])
    expected = {**before['program'], **{name: digest for name, digest in m['files'].items() if name.startswith('dist/')}}
    actual = json.loads(run(['docker', 'run', '--rm', '--network=none', '--read-only', '--entrypoint', 'node', image, '-e', s.PROGRAM]))
    assert actual == expected
    run(['docker', 'cp', str(folder / 'dist/assets/main-C4hJcgTI.js'), 'royal-game-1:/app/dist/assets/main-C4hJcgTI.js'])
    run(['docker', 'cp', str(folder / 'dist/index.html'), 'royal-game-1:/app/dist/index.card-scale-partial'])
    run(['docker', 'exec', '-u', '0', 'royal-game-1', 'mv', '/app/dist/index.card-scale-partial', '/app/dist/index.html'])
    shutil.copyfile(folder / 'source/activityArt.ts', '/opt/royal/src/game/activityArt.ts')
    for file in (folder / 'dist').rglob('*'):
        if file.is_file(): shutil.copyfile(file, Path('/opt/royal/dist') / file.relative_to(folder / 'dist'))
    run(['docker', 'tag', image, 'royal-game:latest'])
    after = s.snapshot()
    assert after['program'] == expected and after['preparedProgram'] == expected
    assert after['modules'] == before['modules'] and after['configuration'] == before['configuration']
    assert after['containers']['royal-game-1'] == before['containers']['royal-game-1']
    target = 'src/game/activityArt.ts'
    expected_source = dict(before['source'])
    data = (folder / 'source/activityArt.ts').read_bytes()
    expected_source[target] = {'sha256': hashlib.sha256(data).hexdigest(), 'lf': hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()}
    assert after['source'] == expected_source
    result = {'published': True, 'sourceCommit': m['sourceCommit'], 'preparedImage': image,
        'runningImage': m['beforeImage'], 'containerRestarted': False, 'backendAndModulesPreserved': True,
        'backup': str(backup), 'publicIndexSha256': m['files']['dist/index.html']}
    (ROOT / 'card-scale-verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)
