"""Verify public release bytes with anonymous HTTPS GET requests only."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--manifest', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--prior-index', required=True, type=Path)
parser.add_argument('--base-url', default='https://stealth-spark-gokmxooi.expresshost.cloud')
args = parser.parse_args()
BASE_URL = args.base_url.rstrip('/')
MANIFEST = json.loads(args.manifest.read_text())


def get(path):
    response = subprocess.run([
        'curl', '-q', '--fail', '--location', '--silent', '--show-error',
        '--max-time', '45', '--request', 'GET', '--proto', '=https',
        '--proto-redir', '=https', '--header', 'Accept-Encoding: identity',
        '--write-out', '\nROYAL_HTTP_STATUS:%{http_code}\nROYAL_EFFECTIVE_URL:%{url_effective}\n',
        BASE_URL + '/' + path,
    ], capture_output=True, check=True)
    body, marker, metadata = response.stdout.rpartition(b'\nROYAL_HTTP_STATUS:')
    if not marker:
        raise RuntimeError('Missing public response status')
    status, effective = metadata.decode().strip().split('\nROYAL_EFFECTIVE_URL:', 1)
    if status != '200' or urlsplit(effective).netloc != urlsplit(BASE_URL).netloc:
        raise RuntimeError('Unexpected public response: ' + path)
    return body, int(status), effective


def verify(item):
    path, expected, group = item
    try:
        body, status, effective = get(path)
        actual = hashlib.sha256(body).hexdigest()
        return dict(path=path, group=group, expectedSha256=expected, sha256=actual,
                    bytes=len(body), httpStatus=status, url=effective, verified=actual == expected)
    except Exception as error:
        return dict(path=path, group=group, expectedSha256=expected, verified=False,
                    error=str(error))


items = [(path, digest, 'releaseDelta') for path, digest in MANIFEST['delta'].items()]
prior_html = args.prior_index.read_bytes()
if hashlib.sha256(prior_html).hexdigest() != MANIFEST['before']['program']['dist/index.html']:
    raise RuntimeError('The previous entry HTML does not match production')
prior_assets = sorted(set(re.findall(r'/assets/index-[^\"\'<>]+\.(?:js|css)', prior_html.decode())))
if len(prior_assets) != 2:
    raise RuntimeError('Expected the exact previous JavaScript and stylesheet pair')
items.extend((path.lstrip('/'), MANIFEST['before']['program']['dist' + path], 'retainedIndex')
             for path in prior_assets)
artwork = 'assets/arcane-plinko/artwork.json'
items.append((artwork, MANIFEST['before']['program']['dist/' + artwork], 'retainedMetadata'))
body, status, health_url = get('healthz')
health = json.loads(body)
files = []


def report():
    counts = {group: sum(row['verified'] for row in files if row['group'] == group)
              for group in ['releaseDelta', 'retainedIndex', 'retainedMetadata']}
    result = dict(release=MANIFEST['release'], sourceCommit=MANIFEST['sourceCommit'],
                  checkedAt=datetime.now(timezone.utc).isoformat(), baseUrl=BASE_URL,
                  method='GET', authenticated=False, accountsCreated=False, stakesPlaced=False,
                  retainedIndexScope='The exact JavaScript and stylesheet referenced by the previous production index.html',
                  health=dict(ok=health.get('ok') is True, httpStatus=status, url=health_url,
                              sha256=hashlib.sha256(body).hexdigest()),
                  verified=health.get('ok') is True and len(files) == len(items) and all(row['verified'] for row in files),
                  expectedFiles=len(items), completedFiles=len(files), verifiedFiles=sum(row['verified'] for row in files),
                  counts=counts, files=sorted(files, key=lambda row: (row['group'], row['path'])))
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    return result


with ThreadPoolExecutor(max_workers=3) as pool:
    pending = [pool.submit(verify, item) for item in items]
    for completed in as_completed(pending):
        files.append(completed.result())
        result = report()
print(json.dumps({key: result[key] for key in ['verified', 'expectedFiles', 'verifiedFiles', 'counts', 'health']}))
if not result['verified']:
    raise SystemExit(1)
