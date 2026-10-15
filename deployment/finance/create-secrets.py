#!/usr/bin/env python3
"""Create secret files for the dedicated finance simulation without printing values."""
import argparse
import os
from pathlib import Path
import re
import secrets

parser = argparse.ArgumentParser()
parser.add_argument('--directory', default='/opt/royal-finance-secrets')
args = parser.parse_args()
folder = Path(args.directory)
if folder.is_symlink():
    raise SystemExit('Secret directory must not be a symlink')
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
folder.chmod(0o700)
for name, group in [('admin-password', 999), ('app-password', 1000), ('sandbox-token', 1000), ('observer-password', 1000)]:
    path = folder / name
    if path.is_symlink():
        raise SystemExit('Secret files must not be symlinks')
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(secrets.token_hex(32) + '\n')
    if not re.fullmatch('[a-f0-9]{64}', path.read_text().strip()):
        raise SystemExit('Existing secret has an unexpected format')
    os.chown(path, 0, group)
    path.chmod(0o440)
print('Finance secret files ready; existing values preserved')
