"""Finish an already verified deployment after the long SSH channel closes."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

ROOT = Path('/opt/royal-releases/restore-direct-topup-20261023-v1')
M = json.loads((ROOT / 'install-manifest.json').read_text())
assert Path(__file__).resolve() == ROOT / 'finish.py'
assert hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == M['finishHelperSha256']
pid = 4077221
deadline = time.monotonic() + 1800
while Path('/proc/' + str(pid)).exists():
    command = Path('/proc/' + str(pid) + '/cmdline').read_bytes()
    if b'/restore-direct-topup-20261023-v1/resume_build.py' not in command:
        break
    assert time.monotonic() < deadline, 'Image build did not finish within the deployment window'
    time.sleep(5)
print('Previous build process finished', flush=True)
result = json.loads((ROOT / 'build-result.json').read_text())
assert result['sourceCommit'] == M['sourceCommit']
if not (ROOT / 'published.json').exists():
    subprocess.run(['python3', str(ROOT / 'deploy.py'), 'publish'], check=True)
assert json.loads((ROOT / 'published.json').read_text()).get('published') is True
if not (ROOT / 'modules-published.json').exists():
    subprocess.run(['python3', str(ROOT / 'modules.py'), 'publish'], check=True)
assert json.loads((ROOT / 'modules-published.json').read_text()).get('published') is True
print(json.dumps({'complete': True, 'sourceCommit': M['sourceCommit']}), flush=True)
