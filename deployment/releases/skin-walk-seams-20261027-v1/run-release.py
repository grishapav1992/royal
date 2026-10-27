from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,os,subprocess
root=Path('/opt/royal-releases/skin-walk-seams-20261027-v1')
source='bffc5eb54ef9957cfb9847ecd8bd721fc77e3e11'
os.umask(0o077)
manifest=json.loads((root/'install-manifest.json').read_text())
assert manifest['sourceCommit']==source
assert hashlib.sha256((root/'deploy.py').read_bytes()).hexdigest()==manifest['helperSha256']
assert not any((root/n).exists() for n in ['job.json','exit.json','build-result.json','published.json'])
(root/'job.json').write_text(json.dumps({'sourceCommit':source,'pid':os.getpid(),'startedAt':datetime.now(timezone.utc).isoformat()}))
with (root/'release.log').open('w') as log:
    result=subprocess.run(['python3',str(root/'deploy.py'),'release'],env={**os.environ,'DOCKER_BUILDKIT':'0'},stdout=log,stderr=subprocess.STDOUT)
(root/'exit.json').write_text(json.dumps({'sourceCommit':source,'exitCode':result.returncode,'endedAt':datetime.now(timezone.utc).isoformat()}))
