from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess

root = Path('/opt/royal-releases/skin-npc-context-20261026-v1')
source = 'ae17a8df9e894278dedc29f08c052fe68ee09c04'
os.umask(0o077)
manifest = json.loads((root / 'install-manifest.json').read_text())
assert manifest['sourceCommit'] == source
assert hashlib.sha256((root / 'deploy.py').read_bytes()).hexdigest() == manifest['helperSha256']
assert not (root / 'build-result.json').exists() and not (root / 'published.json').exists()
(root / 'job.json').write_text(json.dumps({'sourceCommit': source, 'pid': os.getpid(), 'startedAt': datetime.now(timezone.utc).isoformat()}))
with (root / 'release.log').open('w') as log:
    result = subprocess.run(['python3', str(root / 'deploy.py'), 'release'], env={**os.environ, 'DOCKER_BUILDKIT': '0'}, stdout=log, stderr=subprocess.STDOUT)
(root / 'exit.json').write_text(json.dumps({'sourceCommit': source, 'exitCode': result.returncode, 'endedAt': datetime.now(timezone.utc).isoformat()}))
