#!/usr/bin/env python3
"""Initialize public Nile reader settings without keys or finance credentials."""
import argparse
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--start-height', type=int, required=True)
args = parser.parse_args()
if os.geteuid() != 0 or args.start_height < 2:
    raise SystemExit('root and an explicit finalized start height are required')
os.umask(0o077)
data = Path('/opt/royal-tron-reader-data')
config_directory = Path('/opt/royal-tron-reader-config')
for directory in (data, config_directory):
    if directory.is_symlink():
        raise SystemExit('reader paths must not be symlinks')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chown(data, 1000, 1000)
data.chmod(0o700)
os.chown(config_directory, 0, 1000)
config_directory.chmod(0o750)
config = {'network': 'nile', 'startHeight': args.start_height, 'origins': ['https://api.nileex.io', 'https://nile.trongrid.io']}
target = config_directory / 'nile.json'
if target.is_symlink():
    raise SystemExit('reader configuration must not be a symlink')
if target.exists():
    if json.loads(target.read_text()) != config:
        raise SystemExit('existing reader configuration must be preserved')
else:
    with target.open('x') as stream:
        json.dump(config, stream)
        stream.write('\n')
os.chown(target, 0, 1000)
target.chmod(0o440)
print(json.dumps({'ok': True, 'network': 'nile', 'mode': 'watch-only', 'start_height': args.start_height}))
