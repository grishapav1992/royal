#!/usr/bin/env python3
"""Install exact GitHub-verified maintenance files without restarting the game."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess

FILES = {'automatic-retention.py', 'cleanup-release-history.py', 'retention-runtime.py',
         'royal-dev-app-retention.service', 'royal-dev-app-retention.timer'}
ROOT = Path('/opt/royal-maintenance')


def require(ok, message):
    if not ok: raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args(); source = Path(__file__).resolve().parent
    require(os.geteuid() == 0 and source.is_relative_to(ROOT), 'Unexpected maintenance installation root')
    receipt = json.loads(args.receipt.read_text())
    require(re.fullmatch('[a-f0-9]{40}', receipt['sourceCommit']) and receipt.get('githubVerified') is True
            and set(receipt['files']) == FILES | {'install-retention.py'}, 'Incomplete GitHub installation receipt')
    for name, digest in receipt['files'].items():
        path = source / name
        require(path.is_file() and not path.is_symlink() and sha(path) == digest, 'Unreviewed maintenance file: ' + name)
    locks = []
    for path in ['/opt/royal-releases/themed-publish.lock', '/opt/royal/.client-presentation-deploy.lock', '/opt/royal-game-modules-state/module.lock']:
        file = Path(path); require(not file.is_symlink(), 'Unsafe lock')
        lock = file.open('a'); locks.append(lock); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    active = subprocess.check_output(['systemctl', 'show', 'royal-dev-app-retention.service', '--property=ActiveState', '--value'], text=True).strip()
    require(active in {'inactive', 'failed'}, 'Existing retention job is still active')
    subprocess.run(['systemd-analyze', 'verify', str(source/'royal-dev-app-retention.service'), str(source/'royal-dev-app-retention.timer')], check=True)
    original = source.parent / 'original'; require(not original.exists(), 'Maintenance installation already attempted')
    original.mkdir(mode=0o700)
    targets = {name: ROOT/'bin'/name for name in FILES if name.endswith('.py')}
    targets.update({name: Path('/etc/systemd/system')/name for name in FILES if not name.endswith('.py')})
    for name, path in targets.items():
        require(not path.is_symlink(), 'Unsafe installed maintenance path')
        if path.exists(): shutil.copyfile(path, original/name)
    old_policy = Path('/opt/royal-dev-app-retention/policy.json')
    if old_policy.exists(): shutil.copyfile(old_policy, original/'policy-before-install.json')
    subprocess.run(['systemctl', 'stop', 'royal-dev-app-retention.timer'], check=True)
    for name, path in targets.items():
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        partial = path.with_name(path.name+'.retention-next')
        require(not partial.exists(), 'Previous installation partial exists')
        shutil.copyfile(source/name, partial); partial.chmod(0o644); partial.replace(path)
        require(sha(path) == receipt['files'][name], 'Installed bytes differ')
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'royal-dev-app-retention.timer'], check=True)
    result = {**receipt, 'installed': True, 'original': str(original), 'gameRestarted': False}
    (ROOT/'installed.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'installed': True, 'sourceCommit': receipt['sourceCommit'], 'original': str(original)}))


if __name__ == '__main__': main()
