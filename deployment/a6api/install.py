#!/usr/bin/env python3
"""Install an independently verified SSH helper, never a game release."""
import base64
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

ROOT = Path('/opt/royal-a6api')
KEY = Path('/etc/royal-a6api/key')
LOCKS = ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock',
         '/opt/royal-game-modules-state/module.lock']


def require(value, message):
    if not value:
        raise RuntimeError(message)


def write(path, data, mode):
    temporary = path.with_name(path.name + '.next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def game_identity():
    game = json.loads(subprocess.check_output(['docker', 'inspect', 'royal-game-1']))[0]
    require(game['State'].get('Health', {}).get('Status') == 'healthy', 'Game is not healthy')
    return {'id': game['Id'], 'image': game['Image'], 'startedAt': game['State']['StartedAt']}


def install_credential(path, supplied_key):
    if supplied_key is not None:
        require(isinstance(supplied_key, str) and 0 < len(supplied_key) < 4096
                and all(33 <= ord(c) <= 126 for c in supplied_key), 'Invalid credential')
    if path.exists() or path.is_symlink():
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, 'Unsafe credential permissions')
            if supplied_key is not None:
                require(hmac.compare_digest(stream.read(4096).strip(), supplied_key),
                        'Existing server key differs; rotation requires explicit action')
    else:
        require(supplied_key is not None, 'Initial installation requires a credential')
        write(path, (supplied_key + '\n').encode(), 0o600)


def main():
    require(os.geteuid() == 0, 'Run as deployment operator')
    payload = json.loads(sys.stdin.buffer.read(1024 * 1024))
    commit = payload['commit']
    require(re.fullmatch('[a-f0-9]{40}', commit), 'Invalid commit')
    source = base64.b64decode(payload['source'], validate=True)
    require(hashlib.sha256(source).hexdigest() == payload['sha256'], 'Source hash mismatch')
    compile(source, 'request.py', 'exec')
    key = payload.get('key')
    locks = []
    for name in LOCKS:
        require(not Path(name).is_symlink(), 'Unsafe publication lock')
        lock = open(name, 'a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        locks.append(lock)
    free_before = shutil.disk_usage('/opt').free
    require(free_before >= 5 * 1024**3, 'Insufficient free space')
    before = game_identity()
    require(not ROOT.is_symlink() and not KEY.parent.is_symlink(), 'Unsafe install directory')
    ROOT.mkdir(mode=0o755, exist_ok=True)
    KEY.parent.mkdir(mode=0o700, exist_ok=True)
    KEY.parent.chmod(0o700)
    install_credential(KEY, key)
    for name in ('request.py', 'manifest.json'):
        path = ROOT / name
        require(not path.is_symlink(), 'Unsafe installed file')
        if path.exists():
            write(ROOT / ('previous-' + name), path.read_bytes(), 0o644)
    manifest = {'format': 1, 'sourceCommit': commit, 'requestSha256': payload['sha256'],
                'installedAt': time.time(), 'transport': 'ssh-stdio', 'publicListener': False}
    previous = (ROOT / 'request.py').read_bytes() if (ROOT / 'request.py').exists() else None
    previous_manifest = (ROOT / 'manifest.json').read_bytes() if (ROOT / 'manifest.json').exists() else None
    try:
        write(ROOT / 'request.py', source, 0o644)
        probe = b'{"method":"GET","path":"/v1/models","length":0}\n'
        result = subprocess.run(['python3', str(ROOT / 'request.py')], input=probe,
                                capture_output=True, timeout=45, check=True)
        meta, body = result.stdout.split(b'\n', 1)
        require(json.loads(meta)['status'] == 200, 'A6API model probe failed')
        models = json.loads(body).get('data')
        require(isinstance(models, list) and len(models) > 0, 'A6API catalogue is empty')
        require(game_identity() == before, 'Game identity changed during helper installation')
        write(ROOT / 'manifest.json', (json.dumps(manifest, indent=2) + '\n').encode(), 0o644)
    except Exception:
        if previous is None:
            (ROOT / 'request.py').unlink(missing_ok=True)
        else:
            write(ROOT / 'request.py', previous, 0o644)
        if previous_manifest is not None:
            write(ROOT / 'manifest.json', previous_manifest, 0o644)
        raise
    print(json.dumps({'status': 'installed', **manifest, 'models': len(models),
                      'gameUnchanged': True, 'gameImage': before['image'],
                      'freeBefore': free_before, 'freeAfter': shutil.disk_usage('/opt').free}))


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        print('Publication lock busy; no installation performed', file=sys.stderr)
        sys.exit(75)
    except Exception:
        print('A6API installation failed; no credentials or upstream diagnostics logged', file=sys.stderr)
        sys.exit(1)
