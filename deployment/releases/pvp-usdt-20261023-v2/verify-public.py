"""Verify public host bytes, active packages and unauthenticated API boundaries."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

package = Path(sys.argv[1])
output = Path(sys.argv[2])
base = 'https://stealth-spark-gokmxooi.expresshost.cloud'
manifest = json.loads((package / 'install-manifest.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()


def get(path, status=200):
    try:
        response = urllib.request.urlopen(urllib.request.Request(base + path, headers={'Cache-Control': 'no-cache'}), timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    assert response.code == status, (path, response.code)
    return response.read()


assert json.loads(get('/healthz'))['ok'] is True
html = get('/')
assert sha(html) == manifest['dist']['index.html']
entry = re.search(rb'<script[^>]+src="([^"]+)"', html).group(1).decode()
assert sha(get(entry)) == manifest['dist'][entry.lstrip('/')]
for path, status in [('/api/demo-wallet', 410), ('/api/game-wallet', 401), ('/api/nile-play/wallet', 401), ('/api/skin-studio', 401)]:
    get(path, status)


def module(game):
    local = package / 'external-modules' / game / 'active.json'
    if not local.is_file():
        local = package / 'module-delta' / game / 'active.json'
    pointer_bytes = get('/game-modules/' + game + '/active.json')
    assert pointer_bytes == local.read_bytes(), game
    pointer = json.loads(pointer_bytes)
    body = get(pointer['manifest'])
    assert sha(body) == pointer['sha256'], game
    data = json.loads(body)
    prefix = pointer['manifest'].rsplit('/', 1)[0] + '/'
    for name in [data['entry'], *data['styles']]:
        assert sha(get(prefix + name)) == data['files'][name], (game, name)
    return {'game': game, 'manifest': pointer['manifest'], 'sha256': pointer['sha256']}


games = sorted({Path(name).parent.name for name in manifest['pointers']} | {'durak', 'transfer-durak', 'crazy-eights'})
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    modules = list(pool.map(module, games))
result = {'ok': True, 'sourceCommit': manifest['sourceCommit'], 'hostBytesMatch': True, 'apiBoundariesMatch': True, 'modules': modules}
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'publicVerified': True, 'modules': len(modules)}))
