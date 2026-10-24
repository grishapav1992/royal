"""Extend only the reviewed combat contract and publish verified immutable modules."""
from pathlib import Path
from types import SimpleNamespace
import hashlib,importlib.util,json,shutil

ROOT=Path(__file__).resolve().parent
LIVE=Path('/opt/royal');STATE=Path('/opt/royal-game-modules-state');MODULES=Path('/opt/royal-game-modules')
NAME='mortal-kombat-virtual-20261024-v1';BACKUP=Path('/opt/royal-backups')/NAME
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

def contracts(old,new):
    assert {k:v for k,v in old.items() if k!='games'}=={k:v for k,v in new.items() if k!='games'}
    assert new['games']=={**old['games'],'mortal-kombat':{'apiVersion':1,'rulesVersion':2,'progressVersion':1}},'Unexpected host contract change'

def publish():
    m=json.loads((ROOT/'install-manifest.json').read_text())
    assert ROOT==Path('/opt/royal-releases')/NAME
    assert sha(ROOT/'modules.py')==m['modulesHelperSha256'] and sha(ROOT/'host.json')==m['hostContractSha256']
    assert sha(STATE/'host.json')==m['before']['moduleHostContract']
    assert all(sha(LIVE/n)==v for n,v in m['changed'].items())
    assert all(sha(ROOT/'modules'/n)==v for n,v in m['moduleDelta'].items())
    assert shutil.disk_usage(MODULES).free>5*1024**3+3*sum((ROOT/'modules'/n).stat().st_size for n in m['moduleDelta'])
    old=json.loads((STATE/'host.json').read_text());new=json.loads((ROOT/'host.json').read_text());contracts(old,new)
    spec=importlib.util.spec_from_file_location('module_installer',LIVE/'scripts/game-module-release.py');installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
    previous={};args=[];completed=[]
    for row in m['modulePackages']:
        game=row['gameId'];pointer=MODULES/game/'active.json'
        assert installer.active_sha(pointer)==row['beforeSha256'],'Module changed: '+game
        previous[game]=json.loads(pointer.read_text()) if pointer.exists() else None
        args.append(SimpleNamespace(operation='check',game=game,package=str(ROOT/'modules'/game/'versions'/row['version']),root=str(MODULES),state=str(STATE),expected_sha=row['beforeSha256']))
    (BACKUP/'module-host.json').write_text(json.dumps(old,indent=2)+'\n');(BACKUP/'module-pointers.json').write_text(json.dumps(previous,indent=2)+'\n')
    installer.atomic_json(STATE/'host.json',new)
    try:
        for value in args:installer.run(value)
        for value in args:
            value.operation='install';completed.append(installer.run(value))
        pointers={str(MODULES/row['gameId']/'active.json'):row['activeSha256'] for row in completed}
        for n,v in m['before']['moduleFiles'].items():assert sha(Path(n))==pointers.get(n,v),'Unrelated module changed: '+n
        for n,v in m['moduleDelta'].items():assert sha(MODULES/n)==v,n
        assert sha(STATE/'host.json')==m['hostContractSha256']
        result={'published':True,'sourceCommit':m['sourceCommit'],'packages':completed,'hostContractSha256':m['hostContractSha256'],'oldModuleBytesPreserved':True}
        (ROOT/'modules-published.json').write_text(json.dumps(result,indent=2)+'\n');return result
    except BaseException:
        for row in reversed(completed):
            game=row['gameId'];pointer=MODULES/game/'active.json';assert installer.active_sha(pointer)==row['activeSha256'],'Later pointer prevents recovery'
            if previous[game] is None:pointer.unlink()
            else:installer.atomic_json(pointer,previous[game])
        assert sha(STATE/'host.json')==m['hostContractSha256'],'Later host prevents recovery'
        installer.atomic_json(STATE/'host.json',old)
        raise
