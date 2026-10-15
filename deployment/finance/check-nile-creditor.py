#!/usr/bin/env python3
"""Check process recovery and a restored test ledger without touching game or finance funds."""
import importlib.util
import json
from pathlib import Path
import subprocess
import time

ROOT = Path('/opt/royal-finance')
STATE = Path('/opt/royal-finance-state')
CONTAINER = 'royal-nile-creditor'
spec = importlib.util.spec_from_file_location('finance_operations', ROOT / 'deployment/finance/operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

def command(*args):
    return ops.run(list(args), 'nile_creditor_check', timeout=60)

def status():
    return json.loads(command('docker', 'exec', CONTAINER, 'node', 'creditor.js', 'status'))

def rows():
    return ops.query(ops.db_container(), 'SELECT to_jsonb(t)::text FROM royal_nile_deposits.credits t ORDER BY tx_id,log_index;').decode().splitlines()

def fingerprint():
    return ops.hashlib.sha256(ops.query(ops.db_container(), "SET timezone='UTC'; " + ops.copy_sql(ops.tables_for_version(3)))).hexdigest()

before_hash = fingerprint()
before = status()
old_rows = rows()
info = json.loads(command('docker', 'inspect', CONTAINER))[0]
mounts = {item['Destination']: item for item in info['Mounts']}
assert ops.closed_database_network(info)
assert not info['HostConfig']['PortBindings']
assert set(mounts) == {'/data', '/config', '/reader', '/run/secrets/royal_database_password'}
assert mounts['/data']['RW'] and not mounts['/config']['RW'] and not mounts['/reader']['RW']
assert before['hasSigningKeys'] is False and before['asset'] == 'USDT_NILE_TEST'
required = {'network': 'nile', 'asset': 'USDT_NILE_TEST', 'container': CONTAINER}
ops.atomic_json(STATE / 'nile-creditor-required.json', required)
try:
    command('docker', 'stop', '-t', '15', CONTAINER)
    stopped = ops.monitor()
    assert not stopped['ok'] and 'nile_creditor_not_ready' in stopped['issues']
finally:
    command('docker', 'start', CONTAINER)
deadline = time.monotonic() + 60
while not status()['ok']:
    if time.monotonic() > deadline:
        raise RuntimeError('test creditor did not resume')
    time.sleep(1)
after = status()
assert after['cursorHeight'] >= before['cursorHeight']
assert set(old_rows).issubset(set(rows()))
audit = json.loads(command('docker', 'exec', CONTAINER, 'node', 'creditor.js', 'audit'))
target = ops.backup()
snapshot = ops.read_json(target.with_suffix('.dump.json'))
verified = ops.restore_check(target)
assert 'royal_nile_deposits.credits' in snapshot['all_tables']
assert verified['data_sha256'] == snapshot['data_sha256']
assert fingerprint() == before_hash
deadline = time.monotonic() + 60
while True:
    health = json.loads(command('docker', 'inspect', '--format', '{{json .State}}', CONTAINER))
    if health.get('Health', {}).get('Status') == 'healthy':
        break
    if time.monotonic() > deadline:
        raise RuntimeError('test creditor health did not recover')
    time.sleep(1)
assert ops.monitor()['ok']
result = {'ok': True, 'network': 'nile', 'asset': 'USDT_NILE_TEST', 'testOnly': True, 'networkMode': 'private-postgres',
    'keysOnServer': False, 'readerReadOnly': True, 'restartPreservedCredits': True, 'financeDataUnchanged': True,
    'financeDataSha256': before_hash, 'audit': audit, 'snapshot': {'file': snapshot['file'], 'sha256': snapshot['sha256'], 'checks': verified}}
ops.atomic_json(STATE / 'nile-creditor.json', result)
print(json.dumps(result))
