"""Remove only verified transport duplicates after this successful publication."""
from pathlib import Path
import fcntl
import hashlib
import json
import shutil
import subprocess
import sys
import importlib.util

ROOT=Path('/opt/royal-releases/forest-heart-responsive-20261030-v1')
LIVE=Path('/opt/royal')
MODULES=Path('/opt/royal-game-modules')
STATE=Path('/opt/royal-game-modules-state')
NAME=ROOT.name

def require(ok,message):
    if not ok: raise RuntimeError(message)

def read(path): return json.loads(path.read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    require(sys.argv[1:] in [[],['--apply']], 'Unexpected cleanup arguments')
    require(Path(__file__).resolve()==ROOT/'cleanup.py' and ROOT.resolve()==ROOT,'Unexpected cleanup root')
    locks=[]
    for path in [Path('/opt/royal-releases/themed-publish.lock'),LIVE/'.client-presentation-deploy.lock',STATE/'module.lock']:
        require(not path.is_symlink(),'Lock symlink'); lock=path.open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(lock)
    op=read(ROOT/'operator.json');release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json')
    published=read(ROOT/'published.json');before=read(ROOT/'before.json');backup=read(ROOT/'backup.json')
    require(read(ROOT/'exit.json')['exitCode']==0 and published['published'],'Publication incomplete')
    require(published['sourceCommit']==op['sourceCommit']==release['sourceCommit']==receipt['sourceCommit'],'Unpreserved source')
    require(sha(ROOT/'release-manifest.json')==op['releaseManifestSha256'] and sha(ROOT/'release-github.json')==op['receiptSha256'],'Changed receipts')
    require(sha(ROOT/'guard.py')==op['guardSha256'],'Changed guard')
    for name,digest in op['source'].items(): require(sha(LIVE/name)==digest,'Later source change')
    require(sha(LIVE/'dist/index.html')==op['dist']['index.html'],'Later host release')
    require(sha(MODULES/'studio-forest-heart/active.json')==op['pointerSha256'],'Later module release')
    require(sha(Path(backup['archive']))==backup['sha256'],'Backup differs')
    tags=['royal-game:latest','royal-game:before-'+NAME,'royal-game:before-'+NAME+'-prepared']
    ids=subprocess.check_output(['docker','image','inspect',*tags,'--format','{{.Id}}'],text=True).splitlines()
    require(ids==[published['preparedImage'],before['services']['royal-game-1']['image'],before['preparedImage']],'Rollback image tags differ')
    spec=importlib.util.spec_from_file_location('cleanup_guard',ROOT/'guard.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
    meta=read(ROOT/'package/manifest.json')
    expected_package={**meta['files'],'manifest.json':sha(ROOT/'package/manifest.json')}
    installed=MODULES/'studio-forest-heart/versions'/meta['version']
    require(guard.inventory(installed)==expected_package,'Installed package differs')
    dockerfile='FROM royal-game:before-'+NAME+'-prepared\nCOPY --chown=node:node dist-delta/ /app/dist/\nLABEL org.opencontainers.image.revision="'+op['sourceCommit']+'"\n'
    ignore='**\n!Dockerfile\n!.dockerignore\n!dist-delta\n!dist-delta/**\n'
    digest=lambda value:hashlib.sha256(value.encode()).hexdigest()
    targets={
      'runtime-context':{**{'dist-delta/'+name:value for name,value in op['dist'].items()},'Dockerfile':digest(dockerfile),'.dockerignore':digest(ignore)},
      'assets':{name:value for name,value in op['dist'].items() if name!='index.html'},
      'package':expected_package,
    }
    plan=[]
    for name,expected in targets.items():
        path=ROOT/name
        require(path.resolve()==path and path.parent==ROOT and not path.is_symlink(),'Unsafe cleanup target')
        require(guard.inventory(path)==expected,'Changed cleanup target: '+name)
        plan.append({'path':str(path),'logicalBytes':sum((path/name).stat().st_size for name in expected),'files':len(expected)})
    archive=ROOT/'transport.tgz'
    require(not archive.is_symlink() and sha(archive)=='5e6ef0456ed46e39d9d06bfb3ebcfc3c036d72ae7048ff3dd390577926de81a3','Changed transport archive')
    plan.append({'path':str(archive),'logicalBytes':archive.stat().st_size,'files':1})
    result={'sourceCommit':op['sourceCommit'],'apply':bool(sys.argv[1:]),'targets':plan,'freeBefore':shutil.disk_usage(ROOT).free,'protectedBackup':backup,'kept':['source','dist-delta','before.json','after.json','operator.json','release-manifest.json','release-github.json','published.json','exit.json','rollback image tags','all installed immutable module versions'],'physicalDeltaAttribution':'Measurements include concurrent server activity; hardlinks are counted logically.'}
    if sys.argv[1:]:
        require(not (ROOT/'cleanup.json').exists(),'Cleanup already recorded')
        for name in targets: shutil.rmtree(ROOT/name)
        archive.unlink()
        result['freeAfter']=shutil.disk_usage(ROOT).free
        (ROOT/'cleanup.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)

if __name__=='__main__': main()
