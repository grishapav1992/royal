"""Publish only the compatible combat client under the already held three deployment locks."""
from pathlib import Path
from types import SimpleNamespace
import hashlib
import importlib.util
import json
import shutil

ROOT=Path(__file__).resolve().parent
LIVE=Path('/opt/royal');STATE=Path('/opt/royal-game-modules-state');MODULES=Path('/opt/royal-game-modules')
NAME='mk-security-20261026-v1';BACKUP=Path('/opt/royal-backups')/NAME
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()


def publish():
    manifest=json.loads((ROOT/'install-manifest.json').read_text())
    assert ROOT==Path('/opt/royal-releases')/NAME
    assert sha(ROOT/'modules.py')==manifest['helpers']['modules.py']
    assert sha(LIVE/'scripts/game-module-release.py')==manifest['moduleInstallerSha256']
    assert sha(STATE/'host.json')==manifest['before']['moduleHostContract']
    assert all(sha(LIVE/name)==digest for name,digest in manifest['changed'].items())
    assert all(sha(ROOT/'modules'/name)==digest for name,digest in manifest['moduleDelta'].items())
    assert shutil.disk_usage(MODULES).free>5*1024**3+3*sum((ROOT/'modules'/name).stat().st_size for name in manifest['moduleDelta'])
    from deploy import snapshot, settings
    before=snapshot();settings(before)
    built=json.loads((ROOT/'build-result.json').read_text())
    assert before['container']['image']==built['image'] and before['program']==built['program']
    spec=importlib.util.spec_from_file_location('independent_module_installer',LIVE/'scripts/game-module-release.py')
    installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
    row,=manifest['modulePackages'];assert row['gameId']=='mortal-kombat'
    pointer=MODULES/'mortal-kombat/active.json';assert installer.active_sha(pointer)==row['beforeSha256']
    previous=json.loads(pointer.read_text());(BACKUP/'module-pointer.json').write_text(json.dumps(previous,indent=2)+'\n')
    args=SimpleNamespace(operation='check',game='mortal-kombat',package=str(ROOT/'modules/mortal-kombat/versions'/row['version']),
        root=str(MODULES),state=str(STATE),expected_sha=row['beforeSha256'])
    installer.run(args);completed=None
    try:
        args.operation='install';completed=installer.run(args)
        for name,digest in manifest['before']['moduleFiles'].items():
            assert sha(Path(name))==(completed['activeSha256'] if name==str(pointer) else digest),'Unrelated module changed: '+name
        for name,digest in manifest['moduleDelta'].items():assert sha(MODULES/name)==digest,name
        assert sha(STATE/'host.json')==manifest['before']['moduleHostContract']
        result={'published':True,'sourceCommit':manifest['sourceCommit'],'packages':[completed],'hostContractUnchanged':True,'oldModuleBytesPreserved':True}
        (ROOT/'modules-published.json').write_text(json.dumps(result,indent=2)+'\n');return result
    except BaseException:
        if completed:
            assert installer.active_sha(pointer)==completed['activeSha256'],'Later pointer prevents recovery'
            installer.atomic_json(pointer,previous)
        raise
