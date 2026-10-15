#!/usr/bin/env python3
"""Read-only TCP aggregates for the pinned isolated TLS stand on 31.56.189.118."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import time
import uuid

HELPER_SHA256 = 'e27d3a70dfa0405fb99477bfa246aa9287d9b2039f7f5085cccd5dcb7570416c'
MAX_BYTES = 1024 * 1024
MAX_NUMBER = 2 ** 53 - 1
SS_COMMAND = ['/usr/bin/ss', '-H', '-t', '-n', '-i', 'state', 'established', '(', 'sport', '=', ':26443', ')']
COUNTERS = {'bytes_retrans': 'bytesRetransActiveFlowsTotal', 'bytes_acked': 'bytesAckedActiveFlowsTotal',
            'bytes_sent': 'bytesSentActiveFlowsTotal', 'notsent': 'notSentBytesTotal'}
DEFINITION = ('Only established server-side TCP flows with source port 26443 are sampled. Queues, RTT and RTO describe '
              'the server TLS TCP leg, not end-to-end input RTT. Byte and total retransmission counters are cumulative '
              'within the currently active flows; closed flows disappear, so snapshot differences are not total loss '
              'or retransmissions. Coverage counts distinguish missing kernel fields from observed zeros. Diagnostic '
              'ownership checks include two short node processes inside the measured stand cgroup.')


class Refused(RuntimeError):
    pass


def private_bytes(path, maximum, modes={0o600}):
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise Refused('canonical-private-file-required')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 \
                or stat.S_IMODE(info.st_mode) not in modes or info.st_size > maximum:
            raise Refused('private-root-owned-file-required')
        value = source.read(maximum + 1)
        if len(value) > maximum:
            raise Refused('private-file-size-changed')
        return value


def load_stand(plan_path):
    plan = json.loads(private_bytes(plan_path, 65536))
    run = plan.get('runId')
    try:
        if str(uuid.UUID(run)) != run:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise Refused('canonical-run-id-required')
    root = Path('/opt/royal-load-' + run)
    if plan_path != root / 'plan.json' or plan.get('ownedRoot') != str(root) or plan.get('targetHost') != '31.56.189.118':
        raise Refused('exact-owned-dedicated-plan-required')
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise Refused('private-root-directory-required')
    helper_path = root / 'load-dedicated-stand.py'
    source = private_bytes(helper_path, MAX_BYTES, {0o500, 0o600, 0o700})
    if plan.get('helperSha256') != HELPER_SHA256 or hashlib.sha256(source).hexdigest() != HELPER_SHA256:
        raise Refused('frozen-helper-digest-mismatch')
    with Path('/etc/machine-id').open('rb') as machine_file:
        machine = machine_file.read(257)
    if len(machine) > 256 or hashlib.sha256(machine).hexdigest() != plan.get('machineIdSha256'):
        raise Refused('dedicated-machine-identity-mismatch')
    spec = importlib.util.spec_from_file_location('frozen_dedicated_stand', helper_path)
    helper = importlib.util.module_from_spec(spec)
    exec(compile(source, str(helper_path), 'exec'), helper.__dict__)
    verified = helper.load_plan(plan_path)
    if verified.get('tlsGateway') != {'port': 26443, 'serverName': 'royal-load.test'}:
        raise Refused('fixed-tls-gateway-required')
    return helper.Stand(verified, plan_path)


def read_ss():
    child = subprocess.Popen(SS_COMMAND, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             env={'PATH': '/usr/bin:/bin', 'HOME': '/root', 'LC_ALL': 'C'})
    deadline = time.monotonic() + 3
    chunks, size = [], 0
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Refused('tcp-status-timeout')
                if not selector.select(remaining):
                    raise Refused('tcp-status-timeout')
                chunk = os.read(child.stdout.fileno(), min(65536, MAX_BYTES - size + 1))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_BYTES:
                    raise Refused('tcp-status-byte-budget')
            try:
                code = child.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise Refused('tcp-status-timeout') from None
            if code != 0:
                raise Refused('tcp-status-command-failed')
        return b''.join(chunks)
    finally:
        if child.poll() is None:
            child.kill()
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        child.stdout.close()


def number(value, integer=True):
    pattern = r'[0-9]+' if integer else r'[0-9]+(?:\.[0-9]+)?'
    if len(value) > 32 or not re.fullmatch(pattern, value):
        raise Refused('invalid-tcp-number')
    result = int(value) if integer else float(value)
    if not math.isfinite(result) or not 0 <= result <= MAX_NUMBER:
        raise Refused('tcp-number-budget')
    return result


def parse_ss(data):
    if not isinstance(data, bytes) or len(data) > MAX_BYTES:
        raise Refused('tcp-status-byte-budget')
    try:
        lines = data.decode('ascii').splitlines()
    except UnicodeDecodeError:
        raise Refused('invalid-tcp-status-encoding') from None
    records = []
    for line in lines:
        if not line.strip():
            continue
        fields = line.split()
        if fields[0] == 'ESTAB':
            fields = fields[1:]
        is_header = len(fields) == 4 and fields[0].isdigit() and fields[1].isdigit()
        if is_header:
            if fields[2].rpartition(':')[2] != '26443':
                raise Refused('invalid-tcp-established-record')
            records.append({'recv': number(fields[0]), 'send': number(fields[1]), 'info': []})
        elif line[:1].isspace():
            if not records or len(line) > 16384:
                raise Refused('invalid-tcp-info-record')
            records[-1]['info'].append(line.strip())
            continue
        else:
            raise Refused('invalid-tcp-established-record')
    result = {'connectedFlows': len(records), 'tcpInfoFlows': 0, 'recvQueueBytesTotal': 0, 'recvQueueBytesMax': 0,
              'sendQueueBytesTotal': 0, 'sendQueueBytesMax': 0, 'retransCurrentTotal': 0,
              'retransTotalActiveFlowsTotal': 0, 'bytesRetransActiveFlowsTotal': 0, 'bytesAckedActiveFlowsTotal': 0,
              'bytesSentActiveFlowsTotal': 0, 'notSentBytesTotal': 0, 'notSentBytesMax': 0,
              'rttMsMean': 0, 'rttMsMax': 0, 'rtoMsMax': 0,
              'coverage': {key: 0 for key in ['retrans', *COUNTERS, 'rtt', 'rto']}}
    rtt_sum = 0
    for record in records:
        for queue in ['recv', 'send']:
            result[queue + 'QueueBytesTotal'] += record[queue]
            result[queue + 'QueueBytesMax'] = max(result[queue + 'QueueBytesMax'], record[queue])
        info = ' '.join(record['info'])
        result['tcpInfoFlows'] += bool(info)
        selected = {}
        for token in info.split():
            key, delimiter, value = token.partition(':')
            if not delimiter or key not in result['coverage']:
                continue
            if key in selected:
                raise Refused('duplicate-tcp-counter')
            selected[key] = value
        for key, value in selected.items():
            result['coverage'][key] += 1
            if key == 'retrans':
                parts = value.split('/')
                if len(parts) != 2:
                    raise Refused('invalid-tcp-retrans-pair')
                result['retransCurrentTotal'] += number(parts[0])
                result['retransTotalActiveFlowsTotal'] += number(parts[1])
            elif key == 'rtt':
                parts = value.split('/')
                if len(parts) != 2:
                    raise Refused('invalid-tcp-rtt-pair')
                observed = number(parts[0], False)
                number(parts[1], False)
                rtt_sum += observed
                result['rttMsMax'] = max(result['rttMsMax'], observed)
            elif key == 'rto':
                result['rtoMsMax'] = max(result['rtoMsMax'], number(value, False))
            else:
                observed = number(value)
                result[COUNTERS[key]] += observed
                if key == 'notsent':
                    result['notSentBytesMax'] = max(result['notSentBytesMax'], observed)
        if any(value > MAX_NUMBER for value in result.values() if type(value) in (int, float)):
            raise Refused('tcp-aggregate-number-budget')
    if result['coverage']['rtt']:
        result['rttMsMean'] = round(rtt_sum / result['coverage']['rtt'], 6)
    return result


def provenance(stand):
    value = stand.tls_status(probe=False)
    if not value.get('ready') or value.get('closed') or value.get('assetsRemoved') \
            or value.get('runId') != stand.plan['runId'] or value.get('port') != 26443 \
            or value.get('serverName') != 'royal-load.test':
        raise Refused('active-owned-tls-gateway-required')
    fields = ['runId', 'standRunId', 'containerId', 'certificateSha256', 'configSha256', 'caddyPid', 'caddyStartTicks']
    return {key: value[key] for key in fields}


def collect(stand, sampler=read_ss):
    before = provenance(stand)
    tcp = parse_ss(sampler())
    sampled_at = int(time.time() * 1000)
    after = provenance(stand)
    if before != after:
        raise Refused('tls-provenance-changed-during-sample')
    return {'protocol': 1, 'role': 'isolated-test-tls-tcp-diagnostic', 'runId': before['runId'],
            'standRunId': before['standRunId'], 'containerId': before['containerId'], 'sampledAtMs': sampled_at,
            'tcp': tcp, 'definition': DEFINITION}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = collect(load_stand(args.plan))
    except Exception:
        # Native output and exception text may contain endpoint or private data.
        print(json.dumps({'ok': False, 'error': 'tls-tcp-diagnostic-unavailable'}, separators=(',', ':')))
        return 1
    print(json.dumps(result, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
