#!/usr/bin/env python3
"""Verify isolation and operational failures without changing deposit or finance data."""
import copy
import datetime as dt
import fcntl
import importlib.util
import json
from pathlib import Path
import re

root = Path('/opt/royal-finance')
spec = importlib.util.spec_from_file_location('finance_operations', root / 'deployment/finance/operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

def fingerprint():
    return ops.hashlib.sha256(ops.query(ops.db_container(), "SET timezone='UTC'; " + ops.copy_sql(ops.tables_for_version(3)))).hexdigest()

def credits():
    return ops.query(ops.db_container(), 'SELECT to_jsonb(t)::text FROM royal_nile_deposits.credits t ORDER BY tx_id,log_index;').decode().splitlines()

before_hash = fingerprint()
before_credits = credits()
compose = ['docker', 'compose', '-f', str(root / 'deployment/finance/compose.nile-reconcile.yaml')]
ops.run(compose + ['create', '--no-build', 'nile-reconcile'], 'create_reconcile_check')
container = ops.run(compose + ['ps', '--all', '--quiet', 'nile-reconcile'], 'reconcile_check_id').decode().strip()
assert re.fullmatch(r'(?:[a-f0-9]{12}|[a-f0-9]{64})', container)
try:
    info = json.loads(ops.run(['docker', 'inspect', container], 'reconcile_check_inspect'))[0]
    mounts = {item['Destination']: item for item in info['Mounts']}
    assert set(mounts) == {'/ledger', '/config', '/run/secrets/royal_database_password'}
    assert set(info['HostConfig']['Tmpfs']) == {'/tmp'}
    assert mounts['/ledger']['Source'] == '/opt/royal-nile-test-data' and not mounts['/ledger']['RW']
    assert mounts['/config']['Source'] == '/opt/royal-nile-test-config' and not mounts['/config']['RW']
    assert info['Config']['User'] == 'node' and info['HostConfig']['ReadonlyRootfs']
    assert info['HostConfig']['CapDrop'] == ['ALL'] and not info['HostConfig']['PortBindings']
    assert set(info['NetworkSettings']['Networks']) == {'royal-nile-reconcile_rpc', ops.DATABASE_NETWORK}
    assert not any('PASSWORD=' in value or 'KEY=' in value or 'TOKEN=' in value for value in info['Config']['Env'])
finally:
    ops.run(['docker', 'rm', container], 'remove_reconcile_check')
probe = """const fs=require('node:fs'),crypto=require('node:crypto');
const file='/ledger/write-probe-'+crypto.randomUUID();
try{fs.writeFileSync(file,'probe',{flag:'wx'});throw new Error('write_was_permitted');}
catch(error){if(!['EROFS','EACCES'].includes(error.code))throw error;}
if(fs.existsSync(file))throw new Error('probe_file_exists');
console.log(JSON.stringify({readOnlyLedger:true}));"""
assert json.loads(ops.run(compose + ['run', '--rm', '--no-deps', '--name', 'royal-nile-reconcile-write-probe',
                                    'nile-reconcile', 'node', '-e', probe], 'readonly_write_probe'))['readOnlyLedger']

target = ops.STATE / 'nile_reconciliation.json'
with (ops.STATE / 'nile-reconcile.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    original = ops.read_json(target)
    assert original['ok'] and original['network'] == 'nile' and original['spendable'] is False
    detected = []
    try:
        profiles = [('nile_reconciliation_failed', {'ok': False, 'code': 'nile_test_deficit'}),
                    ('nile_reconciliation_stale', {'last_success_at': (dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=1)).isoformat()}),
                    ('nile_reconciliation_balances_changed', {'liabilitiesUnits': str(int(original['liabilitiesUnits'])+1)})]
        for expected, changes in profiles:
            changed = copy.deepcopy(original)
            changed.update(changes)
            ops.atomic_json(target, changed)
            check = ops.monitor()
            assert not check['ok'] and expected in check['issues']
            detected.append(expected)
    finally:
        ops.atomic_json(target, original)
        final = ops.monitor()
    assert final['ok']
assert set(before_credits).issubset(set(credits()))
assert fingerprint() == before_hash
result = {'ok': True, 'checked_at': ops.utc(), 'network': 'nile', 'asset': 'USDT_NILE_TEST', 'testOnly': True,
          'spendable': False, 'isolationChecked': True, 'readOnlyLedger': True, 'keysOnServer': False,
          'writeAttemptRejected': True,
          'detectedFailures': detected, 'financeDataUnchanged': True, 'financeDataSha256': before_hash,
          'reconciliation': original}
ops.atomic_json(ops.STATE / 'nile-reconciliation-check.json', result)
print(json.dumps(result))
