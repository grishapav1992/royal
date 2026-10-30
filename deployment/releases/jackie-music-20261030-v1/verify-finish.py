"""Finish an already switched client after separately verifying mutable service health."""
from pathlib import Path
import fcntl,gzip,importlib.util,json,shutil,subprocess
from media_storage import sha

ROOT=Path(__file__).resolve().parent
GAME='original-jackie-chan'

def require(value,message):
    if not value:raise RuntimeError(message)

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def main():
    locks=[]
    for path in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        handle=open(path,'a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
    read=lambda name:json.loads(gzip.decompress((ROOT/name).read_bytes()))
    before,after=read('before.json.gz'),read('after.json.gz')
    release=json.loads((ROOT/'release-manifest.json').read_text());published=json.loads((ROOT/'published.json').read_text())
    for key in ['source','financeSource','program','financialProgram','configuration','hostContract','moduleHost','preparedImage','sourceRevision']:
        require(before[key]==after[key],'Publication changed '+key)
    identity=lambda rows:{name:{k:v for k,v in row.items() if k!='health'} for name,row in rows.items()}
    require(identity(before['containers'])==identity(after['containers']),'Publication changed service identities or profiles')
    changes={name:{'before':before['containers'][name].get('health'),'after':row.get('health')} for name,row in after['containers'].items() if before['containers'][name].get('health')!=row.get('health')}
    pointer=Path('/opt/royal-game-modules')/GAME/'active.json';version=pointer.parent/'versions'/published['version']
    require(sha(pointer)==published['activeSha256'],'Published pointer changed')
    own_prefix=str(version)+'/'
    require({k:v for k,v in after['modules'].items() if k!=str(pointer) and not k.startswith(own_prefix)}=={k:v for k,v in before['modules'].items() if k!=str(pointer)},'Publication changed another retained client')
    publisher=load('publisher',ROOT/'game-module-release.py');contract=json.loads(Path('/opt/royal-game-modules-state/host.json').read_text())['games'][GAME]
    publisher.verify(version,contract,GAME)
    metadata=json.loads((version/'manifest.json').read_text());folder='module-dist/'+GAME+'/versions/'+metadata['version']+'/'
    require(sha(version/'manifest.json')==release['files'][folder+'manifest.json'],'Published manifest differs from prepared artifact')
    snapshot=load('snapshot',Path('/opt/royal-releases/jackie-chan-20261029-v2/snapshot.py'))
    current=snapshot.container_rows(before['containers'])
    live={name:{'id':row['Id'],'image':row['Image'],'startedAt':row['State']['StartedAt']} for name,row in current.items() if name in before['containers']}
    require(live=={name:{k:row[k] for k in ['id','image','startedAt']} for name,row in before['containers'].items()},'Current protected service identities changed')
    health={name:current[name]['State'].get('Health',{}).get('Status') for name in before['containers']}
    program_files=['dist/index.html','dist-server/index.js','dist-server/payments.js','dist-server/crypto-reconcile.js']
    output=subprocess.check_output(['docker','exec','royal-game-1','sha256sum',*['/app/'+name for name in program_files]],text=True)
    for line in output.splitlines():
        digest,name=line.split();require(digest==after['program'][name.removeprefix('/app/')],'Current host executable changed')
    pointers={str(p):sha(p) for p in Path('/opt/royal-game-modules').glob('*/active.json')}
    require(pointers=={name:digest for name,digest in after['modules'].items() if name.endswith('/active.json')},'Another current pointer changed since publication')
    free=shutil.disk_usage(ROOT).free
    ready=free>=5*1024**3 and all(value in [None,'healthy'] for value in health.values())
    status={'ready':ready,'freeBytes':free,'health':health,'serviceHealthChangesDuringOriginalCheck':changes,'serviceIdentitiesPreserved':True,'programAndSourcePreserved':True}
    (ROOT/'current-check.json').write_text(json.dumps(status,indent=2)+'\n')
    if not ready:print(json.dumps(status));return
    result={'sourceCommit':release['sourceCommit'],'version':metadata['version'],'manifestSha256':sha(version/'manifest.json'),
        'activeSha256':sha(pointer),'preservedRuntimeFiles':len(before['program']),'preservedSourceFiles':len(before['source']),
        'preservedFinanceSourceFiles':len(before['financeSource']),'preservedServices':len(before['containers']),
        'preservedOtherPointers':len(pointers)-1,'freeBefore':before['freeBytes'],'freeAfter':free,'restartRequired':False,
        'databaseTouched':False,'verified':True,'healthRecheck':status}
    (ROOT/'verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':main()
