"""Read-only fingerprints for the current successor of the qualified slot release."""
from pathlib import Path
import hashlib
import json
import subprocess
import time

def run(args):
    return subprocess.check_output(args, text=True).strip()

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]

def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()

root = Path('/opt/royal')
paths = ['src/shared/neopolisMath.ts', 'src/shared/neopolisMathV1.ts', 'src/shared/neopolisMathV2.ts',
         'src/shared/neopolis.ts', 'server/games/neopolis.ts', 'src/shared/draconaMath.ts',
         'src/shared/draconaMathV1.ts', 'src/shared/dracona.ts', 'server/games/dracona.ts']
result = {'verifiedAt': time.time(), 'mathSourceHashes': {p: digest(root / p) for p in paths}, 'containers': {}}
for name in ['royal-game-1', 'royal-nile-play']:
    row = inspect(name)
    result['containers'][name] = {'image': row['Image'], 'container': row['Id'],
        'sourceCommit': row['Config']['Labels'].get('org.opencontainers.image.revision'),
        'health': row['State'].get('Health', {}).get('Status')}
result['modules'] = {}
for game in ['studio-neopolis', 'studio-dracona']:
    pointer = json.loads((Path('/opt/royal-game-modules') / game / 'active.json').read_text())
    result['modules'][game] = pointer
backup = Path('/opt/royal-backups/neopolis-dracona-20261023-v1')
result['originalBackupFiles'] = {name: {'exists': (backup / name).is_file(),
    'bytes': (backup / name).stat().st_size if (backup / name).is_file() else None}
    for name in ['source.tgz', 'financial-source.tgz', 'nile-play.dump']}
health = json.loads(run(['docker', 'exec', '-e', 'UV_THREADPOOL_SIZE=1', 'royal-nile-play',
    'node', '--v8-pool-size=1', 'play.js', 'health']))
result['nile'] = {'auditOk': health.get('ok'), 'ready': health.get('ready'),
    'sourceAgeSeconds': round(time.time() - health['sourceAt'] / 1000) if health.get('sourceAt') else None}
print(json.dumps(result))
