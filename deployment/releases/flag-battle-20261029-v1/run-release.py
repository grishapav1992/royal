from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,os,subprocess,sys,re
root=Path('/opt/royal-releases/flag-battle-20261029-v1')
source=sys.argv[1]
assert re.fullmatch(r'[a-f0-9]{40}',source)
os.umask(0o077)
manifest=json.loads((root/'install-manifest.json').read_text())
assert manifest['sourceCommit']==source
assert hashlib.sha256(Path(__file__).read_bytes()).hexdigest()==manifest['payload']['run-release.py']
assert hashlib.sha256((root/'deploy.py').read_bytes()).hexdigest()==manifest['helperSha256']
assert not any((root/n).exists() for n in ['job.json','exit.json','published.json'])
(root/'job.json').write_text(json.dumps({'sourceCommit':source,'pid':os.getpid(),'startedAt':datetime.now(timezone.utc).isoformat()}))
with (root/'release.log').open('w') as log:
    result=subprocess.run(['python3',str(root/'deploy.py'),'release'],env={**os.environ,'DOCKER_BUILDKIT':'0'},stdout=log,stderr=subprocess.STDOUT)
(root/'exit.json').write_text(json.dumps({'sourceCommit':source,'exitCode':result.returncode,'endedAt':datetime.now(timezone.utc).isoformat()}))
