#!/usr/bin/env python3
"""Check the deployed read-only Nile worker, restart recovery and isolated snapshot."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path('/opt/royal-finance')
spec = importlib.util.spec_from_file_location('finance_tron_ops', ROOT / 'deployment/finance/operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
compose = ['docker', 'compose', '-f', str(ROOT / 'deployment/finance/compose.tron-reader.yaml')]

def run(args, timeout=120):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise AssertionError('reader_check_command_failed')
    return result.stdout

def status():
    return json.loads(run(['docker', 'exec', 'royal-tron-reader', 'node', 'reader.js', 'status']))

def wait_healthy():
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        state = json.loads(run(['docker', 'inspect', '--format', '{{json .State}}', 'royal-tron-reader']))
        if state.get('Health', {}).get('Status') == 'healthy':
            return status()
        time.sleep(5)
    raise AssertionError('reader_did_not_become_healthy')

def saved_rows():
    return {table: ops.query(ops.db_container(), 'SELECT to_jsonb(t)::text FROM royal_tron_reader.' + table + ' t ORDER BY 1;').decode().splitlines() for table in ('blocks', 'transfers')}

def finance_hash():
    return hashlib.sha256(ops.query(ops.db_container(), ops.copy_sql(ops.tables_for_version(3)), 'reader_finance_preservation')).hexdigest()

os.umask(0o077)
before = wait_healthy()
baseline = finance_hash()
rows = saved_rows()
assert before['mode'] == 'watch-only' and before['network'] == 'nile' and not before['moneyCredited']
assert before['cursorHeight'] >= before['startHeight']
ops.atomic_json(ops.STATE / 'tron-reader-required.json', {'network': 'nile', 'mode': 'watch-only', 'container': 'royal-tron-reader'})
stopped = False
try:
    run(compose + ['stop', 'tron-reader'])
    stopped = True
    failed = ops.monitor()
    assert not failed['ok'] and 'tron_reader_not_ready' in failed['issues']
    probe = run(compose + ['run', '--rm', '--no-deps', 'tron-reader', 'node', 'reader.js', 'once'])
    lines = [json.loads(line) for line in probe.decode().splitlines() if line.startswith('{')]
    assert lines[-1]['ok'] and lines[-1]['mode'] == 'watch-only' and not lines[-1]['busy']
finally:
    if stopped:
        run(compose + ['up', '-d', '--no-build', 'tron-reader'])
after = wait_healthy()
new_rows = saved_rows()
for table, old in rows.items():
    assert set(old).issubset(set(new_rows[table])), 'previous_rows_changed'
assert after['cursorHeight'] >= before['cursorHeight'] and after['transfers'] >= before['transfers']
assert baseline == finance_hash(), 'financial_data_changed'
audit = json.loads(run(['docker', 'exec', 'royal-tron-reader', 'node', 'reader.js', 'audit']))
assert audit['ok']

snapshot = ops.backup()
metadata = ops.read_json(snapshot.with_suffix('.dump.json'))
restored = ops.restore_check(snapshot)
assert 'royal_tron_reader.blocks' in metadata['all_tables']
assert restored['data_sha256'] == metadata['data_sha256']

info = json.loads(run(['docker', 'inspect', '--format', '{{json .NetworkSettings}}', 'royal-tron-reader']))
assert not any(info.get('Ports', {}).values())
assert set(info['Networks']) == {'royal-tron-reader_tron_rpc', ops.DATABASE_NETWORK}
assert ops.monitor()['ok']
result = {'ok': True, 'checked_at': ops.utc(), 'network': 'nile', 'mode': 'watch-only',
    'before': before, 'after': after, 'audit': audit, 'snapshot': metadata['file'], 'snapshot_sha256': metadata['sha256'],
    'isolated_restore': restored, 'monitor_detected_stopped_reader': True, 'previous_rows_preserved': True,
    'financial_data_unchanged': True, 'financial_data_sha256': baseline, 'public_ports': False}
ops.atomic_json(ops.STATE / 'tron-reader.json', result)
print(json.dumps(result), flush=True)
