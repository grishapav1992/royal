#!/usr/bin/env python3
"""Prove a positive Nile receipt, replay safety and restoration without signing."""
import argparse
import fcntl
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path('/opt/royal-finance')
spec = importlib.util.spec_from_file_location('finance_operations', ROOT / 'deployment/finance/operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
parser = argparse.ArgumentParser()
parser.add_argument('--user', default='nile_deposit_001')
parser.add_argument('--tx-id')
args = parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', args.user) or (args.tx_id and not re.fullmatch(r'[a-f0-9]{64}', args.tx_id)):
    parser.error('a configured test user and an optional lowercase transaction ID are required')

def command(values, timeout=90):
    return ops.run(values, 'nile_deposit_check_failed', timeout=timeout)

def receipt():
    compose = ['docker', 'compose', '-f', str(ROOT / 'deployment/finance/compose.nile-reconcile.yaml')]
    values = compose + ['run', '--rm', '--no-deps', '--name', 'royal-nile-deposit-receipt',
                        'nile-reconcile', 'node', 'proof.js', args.user]
    if args.tx_id:
        values.append(args.tx_id)
    try:
        result = subprocess.run(values, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=100)
    except subprocess.TimeoutExpired:
        subprocess.run(['docker', 'rm', '--force', 'royal-nile-deposit-receipt'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        raise ops.OpsError('nile_deposit_receipt_timeout')
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise ops.OpsError('nile_deposit_receipt_unavailable')
    if value.get('network') != 'nile' or value.get('asset') != 'USDT_NILE_TEST' \
            or value.get('testOnly') is not True or value.get('spendable') is not False:
        raise ops.OpsError('unsafe_nile_deposit_receipt')
    if result.returncode == 2 and value.get('ok') is False and value.get('code') == 'nile_deposit_pending':
        return value
    if result.returncode or value.get('ok') is not True or value.get('depositObserved') is not True \
            or value.get('receiptConfirmedByTwoRpcs') is not True:
        raise ops.OpsError('nile_deposit_receipt_failed')
    return value

def rows():
    result = {}
    for table in ('credits', 'entries'):
        raw = ops.query(ops.db_container(), 'SELECT jsonb_build_array(tx_id,log_index,to_jsonb(t)) FROM royal_nile_deposits.' + table + ' t ORDER BY tx_id,log_index;')
        result[table] = [(row[0], row[1], json.dumps(row[2], sort_keys=True)) for row in (json.loads(line) for line in raw.decode().splitlines())]
    return result

def preserve(before, event):
    after = rows()
    for table in before:
        if not set(before[table]).issubset(set(after[table])):
            raise ops.OpsError('nile_deposit_history_changed')
    selected = [row for row in after['credits'] if row[0] == event['txId'] and row[1] == event['logIndex']]
    entries = [row for row in after['entries'] if row[0] == event['txId'] and row[1] == event['logIndex']]
    if len(selected) != 1 or len(entries) != 2:
        raise ops.OpsError('nile_deposit_not_unique')

def fingerprint():
    return ops.hashlib.sha256(ops.query(ops.db_container(), "SET timezone='UTC'; " + ops.copy_sql(ops.tables_for_version(3)))).hexdigest()

def verify():
    initial = receipt()
    if not initial['ok']:
        ops.record('nile-deposit-proof', False, **{key: value for key, value in initial.items() if key != 'ok'},
                   restartChecked=False, backupChecked=False)
        return False
    event = initial['event']
    before_hash = fingerprint()
    before_rows = rows()
    compose = ['docker', 'compose', '-f', str(ROOT / 'deployment/finance/compose.nile-creditor.yaml')]
    try:
        command(['docker', 'stop', '-t', '15', 'royal-nile-creditor'])
        for _ in range(2):
            result = json.loads(command(compose + ['run', '--rm', '--no-deps', '--name', 'royal-nile-creditor-replay-proof',
                                                  'nile-creditor', 'node', 'creditor.js', 'once']))
            if result.get('ok') is not True:
                raise ops.OpsError('nile_deposit_replay_failed')
            preserve(before_rows, event)
    finally:
        command(['docker', 'start', 'royal-nile-creditor'])
    deadline = time.monotonic()+60
    while True:
        info = json.loads(command(['docker', 'inspect', 'royal-nile-creditor']))[0]
        if info['State'].get('Health', {}).get('Status') == 'healthy':
            break
        if time.monotonic() > deadline:
            raise ops.OpsError('nile_deposit_restart_unhealthy')
        time.sleep(1)
    preserve(before_rows, event)
    target = ops.backup()
    snapshot = ops.read_json(target.with_suffix('.dump.json'))
    restored = ops.restore_check(target)
    if 'royal_nile_deposits.credits' not in snapshot['all_tables'] or restored['data_sha256'] != snapshot['data_sha256']:
        raise ops.OpsError('nile_deposit_positive_restore_failed')
    command(['python3', str(ROOT / 'deployment/finance/operations.py'), 'nile-reconcile'], timeout=110)
    reconciliation = ops.read_json(ops.STATE / 'nile_reconciliation.json')
    if reconciliation.get('depositObserved') is not True or int(reconciliation.get('liabilitiesUnits', '0')) <= 0:
        raise ops.OpsError('nile_deposit_positive_reconciliation_failed')
    if fingerprint() != before_hash or not ops.monitor()['ok']:
        raise ops.OpsError('nile_deposit_preservation_or_monitor_failed')
    preserve(before_rows, event)
    ops.record('nile-deposit-proof', True, network='nile', asset='USDT_NILE_TEST', testOnly=True, spendable=False,
        depositObserved=True, receipt=initial, replayPasses=2, uniqueCredit=True, restartChecked=True,
        backupChecked=True, snapshot={'file': snapshot['file'], 'sha256': snapshot['sha256'], 'checks': restored},
        reconciliation=reconciliation, financeDataUnchanged=True, financeDataSha256=before_hash)
    return True

ops.STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
with (ops.STATE / 'nile-deposit-proof.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        if not verify():
            raise SystemExit(2)
    except Exception as error:
        code = str(error) if isinstance(error, ops.OpsError) else 'nile_deposit_proof_failed'
        ops.record('nile-deposit-proof', False, network='nile', asset='USDT_NILE_TEST', testOnly=True,
                   spendable=False, error=code)
        raise SystemExit(1)
