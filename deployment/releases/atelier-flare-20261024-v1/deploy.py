"""Change only the atelier model in production Compose, keeping the installed image."""
from pathlib import Path
from contextlib import ExitStack
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

NAME = 'atelier-flare-20261024-v1'
MODEL = 'gpt-image-2.5-flare'
KEY = 'CODEX_SALE_SKIN_MODEL'
LIVE = Path('/opt/royal')
ROOT = Path(__file__).resolve().parent
BACKUP = Path('/opt/royal-backups') / NAME
COMPOSE = ['compose.yaml', 'compose.override.yaml', 'compose.payments.yaml', 'compose.mira.yaml']
LINE = '      CODEX_SALE_SKIN_MODEL: ${CODEX_SALE_SKIN_MODEL:-gpt-image-2.5-flare}\n'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(args):
    result = subprocess.run(args, cwd=LIVE, text=True, capture_output=True, timeout=180)
    require(result.returncode == 0, 'Command failed: ' + ' '.join(args[:3]))
    return result.stdout.strip()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def candidate(text):
    lines = text.splitlines(keepends=True)
    matching = [i for i, line in enumerate(lines) if re.match(r'^      CODEX_SALE_SKIN_MODEL:', line)]
    require(len(matching) <= 1, 'Duplicate model setting')
    if matching:
        lines[matching[0]] = LINE
    else:
        anchors = [i for i, line in enumerate(lines) if re.match(r'^      CODEX_SALE_NPC_MODEL:', line)]
        require(len(anchors) == 1, 'Missing unique game environment anchor')
        lines.insert(anchors[0] + 1, LINE)
    return ''.join(lines)


def compose_args(alternate=None):
    args = ['docker', 'compose', '--project-directory', str(LIVE), '--project-name', 'royal']
    for name in COMPOSE:
        args += ['-f', str(alternate if alternate is not None and name == 'compose.yaml' else LIVE / name)]
    return args


def resolved(alternate=None):
    return json.loads(run(compose_args(alternate) + ['config', '--format', 'json']))


def validate_delta(before, after):
    require(after['services']['game']['environment'].get(KEY) == MODEL, 'Resolved model is not Flare')
    old = json.loads(json.dumps(before))
    new = json.loads(json.dumps(after))
    old['services']['game']['environment'].pop(KEY, None)
    new['services']['game']['environment'].pop(KEY, None)
    require(old == new, 'Compose would change something besides the model')


def environment(config):
    rows = config.get('Env', [])
    result = dict(row.split('=', 1) for row in rows if '=' in row)
    require(len(result) == len(rows), 'Duplicate environment entries')
    return result


def source_inventory():
    files = [LIVE / name for name in ['package.json', 'package-lock.json', 'Dockerfile', 'index.html']]
    for name in ['src', 'server', 'public', 'scripts', 'docs', 'games']:
        files += sorted((LIVE / name).rglob('*'))
    return {str(path.relative_to(LIVE)): digest(path.read_bytes()) for path in files
            if path.is_file() and not path.is_symlink() and not any(
                part.startswith(('.env', '._')) or part in {'node_modules', '__pycache__', 'secrets', 'data'}
                for part in path.relative_to(LIVE).parts)}


def snapshot():
    container = json.loads(run(['docker', 'inspect', 'royal-game-1']))[0]
    config = container['Config']
    env = environment(config)
    env.pop(KEY, None)
    runtime = {key: config.get(key) for key in ['User', 'WorkingDir', 'Entrypoint', 'Cmd', 'Healthcheck', 'StopSignal']}
    runtime['Env'] = env
    ids = run(['docker', 'ps', '-q']).splitlines()
    services = {}
    for item in json.loads(run(['docker', 'inspect', *ids])):
        if item['Name'] == '/royal-game-1' or item['HostConfig'].get('RestartPolicy', {}).get('Name', 'no') in ['', 'no']:
            continue
        services[item['Name']] = {key: item[key] for key in ['Id', 'Image']}
    host = {key: container['HostConfig'].get(key) for key in ['CpuShares', 'Memory', 'MemoryReservation', 'NanoCpus',
        'RestartPolicy', 'PortBindings', 'ReadonlyRootfs', 'NetworkMode', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Privileged', 'PidsLimit']}
    mounts = [{key: item.get(key) for key in ['Type', 'Name', 'Source', 'Destination', 'RW', 'Propagation']} for item in container['Mounts']]
    return {'image': container['Image'], 'runtimeExceptModel': canonical(runtime), 'host': host,
        'mounts': sorted(mounts, key=lambda item: item['Destination']), 'services': services,
        'settingsExceptCompose': {name: digest((LIVE / name).read_bytes()) for name in ['.env', *COMPOSE[1:]]},
        'source': source_inventory(), 'preparedImage': run(['docker', 'image', 'inspect', 'royal-game:latest', '--format', '{{.Id}}'])}


def safe_image(config, state):
    reference = config['services']['game'].get('image', config.get('name', 'royal') + '-game')
    require(run(['docker', 'image', 'inspect', reference, '--format', '{{.Id}}']) == state['image'], 'Compose image differs from running image')
    for line in run(['docker', 'diff', 'royal-game-1']).splitlines():
        path = line.split(' ', 1)[-1]
        require(not path.startswith(('/app/dist', '/app/module-dist', '/app/package')), 'Running application has unpublished container changes')


def atomic(data, target, mode):
    require(not target.is_symlink(), 'Target symlink rejected')
    temporary = target.with_name('.atelier-flare-next')
    require(not temporary.exists(), 'Temporary publication file already exists')
    try:
        with temporary.open('xb') as output:
            output.write(data)
            os.fchmod(output.fileno(), mode)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def healthy():
    for _ in range(60):
        state = json.loads(run(['docker', 'inspect', 'royal-game-1']))[0]
        if state['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(1)
    raise RuntimeError('Game did not become healthy')


def locks():
    stack = ExitStack()
    for path in [Path('/opt/royal-releases/themed-publish.lock'), LIVE / '.client-presentation-deploy.lock', Path('/opt/royal-game-modules-state/module.lock')]:
        require(not path.is_symlink(), 'Lock symlink rejected')
        handle = stack.enter_context(path.open('a'))
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return stack


def main():
    require(ROOT == Path('/opt/royal-releases') / NAME, 'Unexpected release location')
    require(len(sys.argv) == 3 and sys.argv[1] in ['plan', 'publish'] and re.fullmatch('[a-f0-9]{40}', sys.argv[2]), 'Expected operation and committed configuration revision')
    action, commit = sys.argv[1:]
    with locks():
        before = snapshot()
        old = (LIVE / 'compose.yaml').read_bytes()
        new = candidate(old.decode()).encode()
        candidate_path = ROOT / 'compose.next.yaml'
        candidate_path.write_bytes(new)
        config_before = resolved()
        validate_delta(config_before, resolved(candidate_path))
        safe_image(config_before, before)
        plan = {'configurationCommit': commit, 'before': before, 'beforeComposeSha256': digest(old),
            'afterComposeSha256': digest(new), 'helperSha256': digest(Path(__file__).read_bytes())}
        if action == 'plan':
            save(ROOT / 'plan.json', plan)
            print(json.dumps({'ready': True, 'model': MODEL, 'image': before['image'], 'sourceFiles': len(before['source']), 'freeBytes': shutil.disk_usage(LIVE).free}))
            return
        reviewed = json.loads((ROOT / 'plan.json').read_text())
        require(reviewed == plan, 'Production changed since the reviewed plan')
        # No image or source tree is copied. This tiny configuration release uses the existing immutable image.
        require(shutil.disk_usage(LIVE).free > 5 * 1024**3 + 1024**2, 'Free disk reserve below 5 GiB')
        BACKUP.mkdir(mode=0o700, exist_ok=False)
        backup_path = BACKUP / 'compose.yaml'
        backup_path.write_bytes(old)
        backup_path.chmod(0o600)
        require(digest(backup_path.read_bytes()) == digest(old), 'Configuration backup verification failed')
        save(BACKUP / 'before.json', plan)
        run(['docker', 'tag', before['image'], 'royal-game:before-' + NAME])
        mode = (LIVE / 'compose.yaml').stat().st_mode & 0o777
        try:
            atomic(new, LIVE / 'compose.yaml', mode)
            run(compose_args() + ['up', '-d', '--no-deps', '--force-recreate', '--no-build', 'game'])
            healthy()
            after = snapshot()
            require(after == before, 'Application, configuration, services or mounts changed unexpectedly')
            value = run(['docker', 'exec', 'royal-game-1', 'node', '-e', 'console.log(process.env.CODEX_SALE_SKIN_MODEL || "")'])
            require(value == MODEL, 'Running model differs from Flare')
            result = {'published': True, 'release': NAME, 'configurationCommit': commit, 'image': before['image'],
                'model': MODEL, 'applicationSourceUnchanged': True, 'otherServicesUnchanged': True,
                'settingsAndMountsPreserved': True, 'backup': str(BACKUP), 'backupBytes': sum(path.stat().st_size for path in BACKUP.iterdir()),
                'freeBytesAfter': shutil.disk_usage(LIVE).free, 'completedAt': time.time()}
            save(ROOT / 'published.json', result)
            print(json.dumps(result))
        except Exception:
            require(digest((LIVE / 'compose.yaml').read_bytes()) == digest(new), 'Later Compose change prevents rollback')
            atomic(backup_path.read_bytes(), LIVE / 'compose.yaml', mode)
            run(compose_args() + ['up', '-d', '--no-deps', '--force-recreate', '--no-build', 'game'])
            healthy()
            require(snapshot() == before, 'Rollback verification failed')
            save(ROOT / 'rollback.json', {'recovered': True, 'configurationCommit': commit})
            raise


if __name__ == '__main__':
    main()
