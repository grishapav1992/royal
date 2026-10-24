"""Read-only verification of the current host and all six published PvP packages."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
BASE = 'https://stealth-spark-gokmxooi.expresshost.cloud'
GAMES = ['hockey', 'pool', 'chess', 'durak', 'transfer-durak', 'crazy-eights']
sha = lambda value: hashlib.sha256(value).hexdigest()


def get(path, status=200):
    request = urllib.request.Request(BASE + path, headers={'Cache-Control': 'no-cache'})
    try:
        response = urllib.request.urlopen(request, timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    assert response.code == status, (path, response.code, status)
    return response.read()


def verify(game):
    pointer_bytes = get('/game-modules/' + game + '/active.json')
    pointer = json.loads(pointer_bytes)
    manifest_bytes = get(pointer['manifest'])
    assert sha(manifest_bytes) == pointer['sha256'], (game, 'manifest')
    manifest = json.loads(manifest_bytes)
    prefix = pointer['manifest'].rsplit('/', 1)[0] + '/'
    for name, digest in manifest['files'].items():
        assert sha(get(prefix + name)) == digest, (game, name)
    return {'game': game, 'version': manifest['version'],
            'pointerSha256': sha(pointer_bytes), 'manifestSha256': sha(manifest_bytes),
            'filesVerified': len(manifest['files'])}


if __name__ == '__main__':
    host = json.loads((ROOT / 'deployment/releases/raise-windows-20261023-v2/verification.json').read_text(encoding='utf-8'))
    expected = {item['path']: item['sha256'] for item in host['publicSHA256Files']}
    assert json.loads(get('/healthz'))['ok']
    html = get('/')
    assert sha(html) == expected['index.html'], 'Host changed since the reviewed release'
    entry = re.search(rb'<script[^>]+src="([^"]+)"', html).group(1).decode()
    assert sha(get(entry)) == expected[entry.lstrip('/')], 'Host entry changed'
    boundaries = []
    for path in ['/api/demo-wallet', '/api/game-wallet', '/api/nile-play/wallet', '/api/skin-studio']:
        get(path, 401)
        boundaries.append({'path': path, 'anonymousStatus': 401})
    with ThreadPoolExecutor(max_workers=3) as executor:
        modules = list(executor.map(verify, GAMES))
    result = {'ok': True, 'checkedAt': datetime.now(timezone.utc).isoformat(),
              'sourceCommit': host['sourceCommit'], 'origin': BASE,
              'hostBytesMatch': True, 'authenticationBoundaries': boundaries,
              'modules': modules, 'productionWagersPlaced': False,
              'walletMode': 'Free virtual slot balance and separate Nile PvP wallet, retained from the later direct-topup release'}
    output = ROOT / 'artifacts/pvp-release/current-public-verification.json'
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
