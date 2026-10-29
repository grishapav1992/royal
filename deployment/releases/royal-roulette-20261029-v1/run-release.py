"""Run one reviewed release independently of the SSH client lifetime."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,os,subprocess,sys,re
root=Path('/opt/royal-releases/royal-roulette-20261029-v1')
source=sys.argv[1]
assert re.fullmatch(r'[a-f0-9]{40}',source)
os.umask(0o077)
manifest=json.loads((root/'install-manifest.json').read_text())
assert manifest['sourceCommit']==source
for file,digest in manifest['payload'].items():
    assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest
assert not any((root/name).exists() for name in ['job.json','exit.json','published.json'])
(root/'job.json').write_text(json.dumps({'sourceCommit':source,'pid':os.getpid(),'startedAt':datetime.now(timezone.utc).isoformat()}))
with (root/'release.log').open('w') as log:
    result=subprocess.run(['python3',str(root/'deploy.py'),'release'],env={**os.environ,'DOCKER_BUILDKIT':'0'},stdout=log,stderr=subprocess.STDOUT)
(root/'exit.json').write_text(json.dumps({'sourceCommit':source,'exitCode':result.returncode,'endedAt':datetime.now(timezone.utc).isoformat()}))
