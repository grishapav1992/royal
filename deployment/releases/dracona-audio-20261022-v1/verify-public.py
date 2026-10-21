from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import json
import sys

ROOT = Path(sys.argv[1]).resolve()
ORIGIN = 'https://stealth-spark-gokmxooi.expresshost.cloud'
M = json.loads((ROOT / 'shipping/install-manifest.json').read_text())

def sha(data):
    return hashlib.sha256(data).hexdigest()

def get(path):
    with urlopen(Request(ORIGIN + path, headers={'Cache-Control': 'no-cache'}), timeout=45) as response:
        assert response.status == 200
        return response.read(), response.headers.get('Content-Type')

assert json.loads(get('/healthz')[0])['ok'] is True
published = json.loads((ROOT / 'proof/published.json').read_text())
pointer_bytes = get('/game-modules/studio-dracona/active.json')[0]
assert sha(pointer_bytes) == published['module']['activeSha256']
pointer = json.loads(pointer_bytes)
manifest_bytes = get(pointer['manifest'])[0]
assert sha(manifest_bytes) == pointer['sha256']
metadata = json.loads(manifest_bytes)
assert metadata['version'] == M['moduleVersion'] and metadata['gameId'] == 'studio-dracona'
prefix = pointer['manifest'].rsplit('/', 1)[0] + '/'
checks = {prefix + name: digest for name, digest in metadata['files'].items()}
checks['/index.html'] = M['before']['program']['dist/index.html']
for name, digest in M['before']['moduleFiles'].items():
    if name.endswith('/active.json'):
        checks['/game-modules/' + name.removeprefix('/opt/royal-game-modules/')] = digest
prior_manifest = next(name for name in M['before']['program'] if name.startswith('module-dist/studio-dracona/versions/') and name.endswith('/manifest.json'))
checks['/game-modules/' + prior_manifest.removeprefix('module-dist/')] = M['before']['program'][prior_manifest]

def verify(row):
    path, digest = row
    body, content_type = get(path)
    assert sha(body) == digest, path
    return {'path': path, 'sha256': digest, 'bytes': len(body), 'contentType': content_type}

with ThreadPoolExecutor(max_workers=6) as pool:
    rows = list(pool.map(verify, sorted(checks.items())))
result = {'ok': True, 'sourceCommit': M['sourceCommit'], 'module': metadata['version'],
    'manifestSha256': pointer['sha256'], 'publicHttpChecks': len(rows) + 3,
    'audioFiles': sum(row['path'].endswith('.mp3') for row in rows),
    'hostHtmlUnchanged': True, 'previousModuleRetained': True, 'files': rows}
(ROOT / 'proof/public-http.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}))
