"""Preserve all retained clients and reclaim only verified duplicate media allocations."""
from pathlib import Path
import fcntl,importlib.util,json,shutil
from media_storage import deduplicate,sha

ROOT=Path(__file__).resolve().parent
MODULES=Path('/opt/royal-game-modules')
MIN_FREE=5*1024**3

def require(value,message):
    if not value:raise RuntimeError(message)

def pointers():
    return {str(p):sha(p) for p in MODULES.glob('*/active.json')}

def main():
    require(ROOT==Path('/opt/royal-releases/jackie-music-20261030-v1'),'Wrong operator directory')
    locks=[]
    for path in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
        handle=open(path,'a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
    host=Path('/opt/royal-game-modules-state/host.json');host_sha=sha(host);contracts=json.loads(host.read_text())['games']
    spec=importlib.util.spec_from_file_location('publisher',ROOT/'game-module-release.py');publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
    plan=json.loads((ROOT/'media-audit.json').read_text())['pairs'];before=pointers();free_before=shutil.disk_usage(MODULES).free;results=[]
    for row in plan:
        if shutil.disk_usage(MODULES).free>=MIN_FREE+128*1024**2:break
        base,target=Path(row['base']),Path(row['target'])
        for path in [base,target]:
            relative=path.relative_to(MODULES)
            require(len(relative.parts)==3 and relative.parts[1]=='versions' and publisher.VERSION.fullmatch(relative.parts[2]),'Unsafe version path')
            publisher.directory(path)
        require(base.parent==target.parent and base.parent.parent.name in contracts,'Different or unknown games')
        game=base.parent.parent.name;contract=contracts[game]
        publisher.verify(base,contract,game);publisher.verify(target,contract,game)
        result=deduplicate(base,target)
        publisher.verify(base,contract,game);publisher.verify(target,contract,game)
        results.append({'game':game,'base':str(base),'target':str(target),**result})
    require(before==pointers() and host_sha==sha(host),'Pointer or host contract changed')
    free_after=shutil.disk_usage(MODULES).free
    require(free_after>=MIN_FREE,'Five GiB reserve not restored')
    report={'verified':True,'freeBefore':free_before,'freeAfter':free_after,'pairs':results,
        'logicalDuplicateBytes':sum(r['logicalDuplicateBytes'] for r in results),'versionsRemoved':[],
        'archivesRemoved':[],'allPointersPreserved':True,'allVerifiedBytesPreserved':True,
        'physicalSpaceAttribution':'Concurrent writes are not attributed to this maintenance'}
    (ROOT/'storage-maintenance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='pairs'}))

if __name__=='__main__':main()
