#!/usr/bin/env python3
"""Root operations for the isolated Nile play journal. No signing keys."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

DATA = Path('/opt/royal-nile-play-data')
CONFIG = Path('/opt/royal-nile-play-config')
STATE = Path('/opt/royal-finance-state')


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if result.returncode:
        raise ValueError('play_operator_failed')
    return result.stdout


def main():
    if os.geteuid() != 0:
        raise ValueError('root_required')
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('init', 'latest', 'invite', 'backup', 'status', 'reserve'))
    parser.add_argument('--user')
    parser.add_argument('--units')
    args = parser.parse_args()
    if args.command == 'init':
        for directory, uid, mode in ((DATA, 1000, 0o700), (CONFIG, 0, 0o750), (Path('/opt/royal-nile-play-sockets'), 1000, 0o700)):
            directory.mkdir(mode=mode, exist_ok=True)
            if directory.is_symlink():
                raise ValueError('unsafe_play_directory')
            os.chown(directory, uid, 1000)
            directory.chmod(mode)
        source = json.loads(Path('/opt/royal-nile-test-config/nile-test.json').read_bytes())
        bindings = json.loads(Path('/opt/royal-nile-account-bindings/bindings.json').read_bytes())
        if bindings.get('bindings'):
            raise ValueError('existing_bindings_require_migration')
        config = dict(version=1, source=source, houseUserId='nile_deposit_002', reserveUserId='nile_deposit_001', initialReserveUnits='0')
        file = CONFIG / 'play.json'
        encoded = json.dumps(config, separators=(',', ':')).encode()
        if file.exists() and file.read_bytes().strip() != encoded:
            raise ValueError('saved_play_config_mismatch')
        if not file.exists():
            with file.open('xb') as stream:
                stream.write(encoded + b'\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.chown(file, 0, 1000)
            file.chmod(0o640)
        print(json.dumps(dict(ok=True, configSha256=hashlib.sha256(encoded).hexdigest())))
    elif args.command == 'latest':
        directory = DATA / 'backups'
        metadata = json.loads((directory / 'latest.json').read_bytes())
        if not re.fullmatch(r'nile-play-\d{8}T\d{9}Z\.pg\.json', metadata.get('file', '')):
            raise ValueError('invalid_play_backup')
        file = directory / metadata['file']
        if file.is_symlink() or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != metadata['sha256']:
            raise ValueError('invalid_play_backup')
        print(json.dumps(dict(directory=str(directory), metadata=metadata)))
    elif args.command in ('invite', 'reserve'):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', args.user or ''):
            raise ValueError('invalid_play_user')
        # The token is printed only to the requesting operator for private delivery to its intended owner.
        command = ['docker', 'exec', 'royal-nile-play', 'node', 'play.js', args.command, args.user]
        if args.command == 'reserve':
            if not re.fullmatch(r'[1-9][0-9]{0,9}', args.units or ''):
                raise ValueError('invalid_reserve_units')
            command.append(args.units)
        print(run(command).decode().strip())
    else:
        print(run(['docker', 'exec', 'royal-nile-play', 'node', 'play.js', args.command]).decode().strip())


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps(dict(ok=False, code='play_operator_failed')))
        raise SystemExit(1)
