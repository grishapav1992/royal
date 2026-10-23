"""Give full journal checks CPU priority without restarting services or changing data."""
from pathlib import Path
import fcntl
import json
import subprocess

ROOT = Path(__file__).resolve().parent
run = lambda args: subprocess.check_output(args, text=True).strip()
inspect = lambda name: json.loads(run(['docker', 'inspect', name]))[0]
with open('/opt/royal-releases/finance-db-resources.lock', 'a+') as resource_lock:
    fcntl.flock(resource_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    result = []
    for name, shares, previous in [('royal-nile-play', 65536, 8192), ('royal-finance-sim-finance-db-1', 32768, 4096)]:
        before = inspect(name)
        assert before['HostConfig']['CpuShares'] in [0, previous]
        assert before['HostConfig']['NanoCpus'] == 2000000000
        run(['docker', 'update', '--cpu-shares', str(shares), name])
        after = inspect(name)
        assert before['Id'] == after['Id'] and before['State']['StartedAt'] == after['State']['StartedAt']
        assert before['Config'] == after['Config']
        assert sorted(before['Mounts'], key=lambda v: v['Destination']) == sorted(after['Mounts'], key=lambda v: v['Destination'])
        old_host, new_host = dict(before['HostConfig']), dict(after['HostConfig'])
        old_host.pop('CpuShares'); new_host.pop('CpuShares')
        assert old_host == new_host
        result.append({'service': name, 'cpuShares': shares, 'sameContainer': True, 'restarted': False})
    (ROOT / 'audit-priority-verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)
