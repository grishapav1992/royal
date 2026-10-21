from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import json
import time
import sys

ROOT = Path(sys.argv[1]).resolve()
ORIGIN = 'https://stealth-spark-gokmxooi.expresshost.cloud'
M = json.loads((ROOT / 'shipping/install-manifest.json').read_text())

def get(path):
    request = Request(ORIGIN + path, headers={'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=45) as response:
        assert response.status == 200, path
        return response.read()

def digest(data):
    return hashlib.sha256(data).hexdigest()

health = json.loads(get('/healthz'))
assert health['ok'] is True
checks = {'/' + name: sha for name, sha in M['delta'].items()}
pointer_name = 'studio-dracona/active.json'
pointer_data = get('/game-modules/' + pointer_name)
assert digest(pointer_data) == M['moduleBaseline'][pointer_name]
pointer = json.loads(pointer_data)
manifest_data = get(pointer['manifest'])
assert digest(manifest_data) == pointer['sha256']
manifest = json.loads(manifest_data)
assert manifest['gameId'] == 'studio-dracona'
assert manifest['apiVersion'] == 1 and manifest['rulesVersion'] == 2 and manifest['progressVersion'] == 1
prefix = pointer['manifest'].rsplit('/', 1)[0] + '/'
for name, sha in manifest['files'].items():
    checks[prefix + name] = sha
old_active = {name.removeprefix('/opt/royal-game-modules/'): sha
              for name, sha in M['before']['moduleFiles'].items() if name.endswith('/active.json')}
for name, sha in old_active.items():
    checks['/game-modules/' + name] = sha
old_entry = next(name for name in M['before']['program'] if name.startswith('dist/assets/index-') and name.endswith('.js'))
checks['/' + old_entry.removeprefix('dist/')] = M['before']['program'][old_entry]

def verify(row):
    path, expected = row
    data = get(path)
    actual = digest(data)
    assert actual == expected, f'Public bytes differ: {path}'
    return {'path': path, 'sha256': actual, 'bytes': len(data)}

with ThreadPoolExecutor(max_workers=6) as pool:
    rows = list(pool.map(verify, sorted(checks.items())))
result = {'origin': ORIGIN, 'at': int(time.time()), 'ok': True, 'health': {'ok': health['ok']},
          'sourceCommit': M['sourceCommit'], 'module': manifest['version'],
          'manifestSha256': pointer['sha256'], 'moduleAssets': len(manifest['files']),
          'publicChecks': len(rows) + 3, 'externalPointersPreserved': len(old_active), 'files': rows}
(ROOT / 'proof/public-http.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}))
