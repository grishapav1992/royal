#!/usr/bin/env python3
"""Install a public test address manifest. Private keys never belong on this VPS."""
import json
import os
from pathlib import Path
import sys

if os.geteuid() != 0 or len(sys.argv) != 2:
    raise SystemExit('root and a public test manifest file are required')
os.umask(0o077)
raw = Path(sys.argv[1]).read_bytes()
if len(raw) > 65536:
    raise SystemExit('public manifest is too large')
config = json.loads(raw)
if set(config) != {'version', 'network', 'genesis', 'token', 'asset', 'scale', 'startHeight', 'readerStartHeight', 'origins', 'addresses'}:
    raise SystemExit('public fields only')
if config['network'] != 'nile' or config['asset'] != 'USDT_NILE_TEST' or config['scale'] != 6:
    raise SystemExit('test Nile token only')
for account in config['addresses']:
    if set(account) != {'userId', 'address', 'publicKey'}:
        raise SystemExit('public address fields only')
reader = json.loads(Path('/opt/royal-tron-reader-config/nile.json').read_text())
if config['readerStartHeight'] != reader['startHeight'] or config['origins'] != reader['origins']:
    raise SystemExit('existing reader configuration must be preserved')
data = Path('/opt/royal-nile-test-data')
directory = Path('/opt/royal-nile-test-config')
for path in (data, directory):
    if path.is_symlink():
        raise SystemExit('test paths must not be symlinks')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chown(data, 1000, 1000)
data.chmod(0o700)
os.chown(directory, 0, 1000)
directory.chmod(0o750)
target = directory / 'nile-test.json'
if target.is_symlink():
    raise SystemExit('test manifest must not be a symlink')
if target.exists():
    if json.loads(target.read_text()) != config:
        raise SystemExit('existing test manifest is sealed')
else:
    with target.open('x') as stream:
        json.dump(config, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
os.chown(target, 0, 1000)
target.chmod(0o440)
print(json.dumps({'ok': True, 'network': 'nile', 'testOnly': True, 'addresses': len(config['addresses']), 'keysOnServer': False}))
