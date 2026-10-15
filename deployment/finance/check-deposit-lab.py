#!/usr/bin/env python3
"""Exercise simulated deposits with an isolated observer login and disposable workers."""
from concurrent.futures import ThreadPoolExecutor
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess

from operations import OpsError, STATE, atomic_json, compose, record, run

LAB = Path(os.environ.get('FINANCE_DEPOSIT_LAB_DIR', '/opt/royal-finance-deposit-lab'))
os.umask(0o077)
STATE.mkdir(mode=0o700, parents=True, exist_ok=True)


def sources(manifests):
    if LAB.is_symlink():
        raise OpsError('lab_directory_must_not_be_symlink')
    LAB.mkdir(parents=True, exist_ok=True)
    os.chown(LAB, 0, 1000)
    LAB.chmod(0o750)
    for name, manifest in zip(('source-a.json', 'source-b.json'), manifests):
        target = LAB / name
        if target.is_symlink():
            raise OpsError('lab_source_must_not_be_symlink')
        atomic_json(target, manifest)
        os.chown(target, 0, 1000)
        target.chmod(0o440)


def scan(expected_code=None, fault=False):
    command = compose('--profile', 'deposit-lab', 'run', '--rm', '--no-deps')
    if fault:
        command += ['-e', 'FINANCE_DEPOSIT_TEST_FAULT=after-commit']
    command += ['finance-deposit-scan']
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    try:
        output = json.loads(result.stdout.decode().strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise OpsError('observer_result_unavailable')
    if expected_code:
        if result.returncode != 1 or output.get('code') != expected_code:
            raise OpsError('expected_observer_failure_not_detected')
    elif result.returncode or not output.get('ok'):
        raise OpsError('observer_scan_failed')
    print(json.dumps({'observer': output}), flush=True)
    return output


def phase(container, stage, fixture):
    output = run(['docker', 'exec', '-i', container, 'node', 'dist-finance-tools/finance-deposit-smoke.js', stage],
                 'deposit_' + stage, input=json.dumps(fixture).encode(), timeout=60)
    checks = json.loads(output)
    print(json.dumps(checks), flush=True)
    return checks


try:
    with (STATE / 'deposit-lab.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        configuration = json.loads(run(compose('--profile', 'deposit-lab', 'config', '--format', 'json'), 'worker_configuration'))
        worker = configuration['services']['finance-deposit-scan']
        if any(name.startswith('FINANCE_SANDBOX_TOKEN') for name in worker.get('environment', {})) or \
            {secret['source'] for secret in worker.get('secrets', [])} != {'finance_observer_password'}:
            raise OpsError('observer_must_only_receive_its_database_secret')
        raw = run(compose('ps', '--format', 'json'), 'api_inventory').decode().strip()
        items = json.loads(raw) if raw.startswith('[') else [json.loads(line) for line in raw.splitlines()]
        api = next(item['ID'] for item in items if item.get('Service') == 'finance-api' and item.get('Health') == 'healthy')
        if not re.fullmatch(r'[a-f0-9]{12,64}', api):
            raise OpsError('invalid_api_container')
        info = json.loads(run(['docker', 'inspect', api], 'inspect_simulation'))[0]
        env = dict(value.split('=', 1) for value in info['Config']['Env'] if '=' in value)
        if env.get('FINANCE_MODE') != 'simulation' or info['Config']['Labels'].get('com.docker.compose.project') != 'royal-finance-sim':
            raise OpsError('deposit_check_requires_finance_simulation')
        prepared = json.loads(run(['docker', 'exec', api, 'node', 'dist-finance-tools/finance-deposit-smoke.js', 'prepare'], 'deposit_prepare'))
        fixture = prepared['fixture']
        atomic_json(STATE / 'deposit-lab-fixture.json', fixture)
        sources(prepared['pending'])
        pending = scan()
        if pending.get('credited') != 0:
            raise OpsError('unfinalized_deposit_credited')
        phase(api, 'pending', fixture)
        sources(prepared['disagreement'])
        scan('source_disagreement')
        phase(api, 'rejected', fixture)
        sources(prepared['first'])
        first = scan()
        if first.get('credited') != 1 or first.get('ignored') != 4:
            raise OpsError('deposit_policy_check_failed')
        phase(api, 'first', fixture)
        sources(prepared['second'])
        scan('simulated_crash_after_commit', fault=True)
        phase(api, 'crashed', fixture)
        if scan().get('credited') != 0:
            raise OpsError('duplicate_credit_after_restart')
        phase(api, 'recovered', fixture)
        sources(prepared['third'])
        with ThreadPoolExecutor(max_workers=2) as executor:
            replies = list(executor.map(lambda _: scan(), range(2)))
        if sum(reply['credited'] for reply in replies) != 1:
            raise OpsError('concurrent_observers_duplicate_credit')
        final = phase(api, 'concurrent', fixture)
        record('deposit-lab', True, environment='simulation', checks=final, concurrent_workers=2,
               unfinalized_rejected=True, source_disagreement_detected=True, unsupported_token_rejected=True,
               failed_execution_rejected=True, internal_transfer_rejected=True, duplicate_logs_deduplicated=True,
               commit_reply_loss_recovered=True, observer_has_no_api_token=True)
except Exception as error:
    record('deposit-lab', False, error=str(error) if isinstance(error, OpsError) else type(error).__name__)
    raise SystemExit(1)
