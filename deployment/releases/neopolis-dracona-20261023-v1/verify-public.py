"""Read-only public verification of the exact host and both complete packages."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request

root=Path(sys.argv[1]); output=Path(sys.argv[2])
base='https://stealth-spark-gokmxooi.expresshost.cloud'
m=json.loads((root/'install-manifest.json').read_text())
sha=lambda data:hashlib.sha256(data).hexdigest()

def get(path,status=200):
    try:
        r=urllib.request.urlopen(urllib.request.Request(base+path,headers={'Cache-Control':'no-cache'}),timeout=40)
    except urllib.error.HTTPError as error: r=error
    assert r.code==status,(path,r.code)
    return r.read()

assert json.loads(get('/healthz'))['ok'] is True
html=get('/')
expected={**m['before']['program'],**{'dist/'+k:v for k,v in m['dist'].items()}}
assert sha(html)==expected['dist/index.html']
entry=re.search(rb'<script[^>]+src="([^"]+)"',html).group(1).decode()
assert sha(get(entry))==expected['dist/'+entry.lstrip('/')]
for path,status in [('/api/demo-wallet',410),('/api/game-wallet',401),('/api/nile-play/wallet',401),('/api/skin-studio',401)]: get(path,status)
results=[]
for game,versions in [('studio-neopolis',(3,3)),('studio-dracona',(3,2))]:
    pointer_bytes=get('/game-modules/'+game+'/active.json')
    assert pointer_bytes==(root/'external'/game/'active.json').read_bytes()
    pointer=json.loads(pointer_bytes); manifest=get(pointer['manifest'])
    assert sha(manifest)==pointer['sha256']
    data=json.loads(manifest)
    assert (data['rulesVersion'],data['progressVersion'])==versions
    prefix=pointer['manifest'].rsplit('/',1)[0]+'/'
    def verify(row):
        name,digest=row
        assert sha(get(prefix+name))==digest,(game,name)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: list(pool.map(verify,data['files'].items()))
    results.append({'game':game,'version':data['version'],'rulesVersion':data['rulesVersion'],
                    'progressVersion':data['progressVersion'],'filesVerified':len(data['files']),'manifest':pointer['manifest']})
result={'ok':True,'sourceCommit':m['sourceCommit'],'hostBytesMatch':True,'authenticationBoundaries':True,'modules':results}
output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
