"""Increase journal cache capacity in place, independently of the host publisher."""
from pathlib import Path
import fcntl
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
run = lambda args: subprocess.check_output(args, text=True).strip()
inspect = lambda: json.loads(run(['docker', 'inspect', 'royal-finance-sim-finance-db-1']))[0]
# This operation changes only PostgreSQL resource ceilings and its separate Compose file.
# Host publishers verify game/Nile profiles and identities; no service is recreated here.
with open('/opt/royal-releases/finance-db-resources.lock', 'a+') as resource_lock:
    fcntl.flock(resource_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    database = inspect()
    paths = [Path('/opt/royal-finance/compose.finance.yaml')]
    application_copy = Path('/opt/royal/compose.finance.yaml')
    if application_copy.exists(): paths.append(application_copy)
    for path in paths:
        assert sha(path) == '5576ad8154f62815185f3bece5c1ec3de0135f5c02c53be4d01f6c232769e6ae'
    target = ROOT / 'database-cache-compose.yaml'
    expected = paths[0].read_text().replace('    mem_limit: 512m\n    cpus: 0.75\n', '    mem_limit: 1280m\n    cpus: 2\n', 1)
    assert expected == target.read_text()
    available = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    assert available >= 1024**3, 'Insufficient memory headroom'
    assert database['HostConfig']['Memory'] == 512 * 1024**2 and database['HostConfig']['NanoCpus'] == 750000000
    for i, path in enumerate(paths): shutil.copyfile(path, ROOT / ('database-cache-before-' + str(i) + '.yaml'))
    run(['docker', 'update', '--memory', '1280m', '--memory-swap', '2560m', '--cpus', '2', 'royal-finance-sim-finance-db-1'])
    updated = inspect()
    assert database['Id'] == updated['Id'] and database['State']['StartedAt'] == updated['State']['StartedAt']
    assert database['Config'] == updated['Config'] and database['Mounts'] == updated['Mounts']
    old_host, new_host = dict(database['HostConfig']), dict(updated['HostConfig'])
    for key in ['Memory', 'MemorySwap', 'NanoCpus']: old_host.pop(key); new_host.pop(key)
    assert old_host == new_host
    for path in paths:
        temporary = path.with_name(path.name + '.cache-partial')
        assert not temporary.exists() and not path.is_symlink()
        shutil.copyfile(target, temporary)
        temporary.replace(path)
    result = {'sameContainer': True, 'restarted': False, 'mountsPreserved': True,
        'memoryBytes': updated['HostConfig']['Memory'], 'nanoCpus': updated['HostConfig']['NanoCpus'],
        'sourceSha256': sha(target), 'availableBytesBefore': available}
    (ROOT / 'database-cache-verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)
