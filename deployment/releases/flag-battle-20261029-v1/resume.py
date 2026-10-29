"""Resume only a verified finance-phase stop, retaining accepted rounds and original artifacts."""
from pathlib import Path
import argparse
import fcntl
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time


def prior_failure(root):
    failure=json.loads((root/'failure.json').read_text())
    stopped=json.loads((root/'exit.json').read_text())
    manifest=json.loads((root/'install-manifest.json').read_text())
    assert stopped['exitCode']==1 and failure['phase']=='finance'
    assert stopped['sourceCommit']==manifest['sourceCommit']
    assert not any((root/name).exists() for name in ['finance-published.json','module-published.json','published.json'])
    return manifest


def ready_samples(health,*,sleep=time.sleep,clock=time.monotonic,timeout=600):
    end=clock()+timeout;samples=[]
    while clock()<end:
        try:
            row=health()
            assert row.get('ok') and row.get('ready') and row.get('testOnly')
            samples.append(row)
            if len(samples)==3:return samples
        except (subprocess.CalledProcessError,AssertionError):samples=[]
        sleep(10)
    raise RuntimeError('Three consecutive financial readiness checks did not pass')


def main(tool_commit):
    assert re.fullmatch('[a-f0-9]{40}',tool_commit)
    import deploy as d
    root=Path(__file__).resolve().parent
    assert root==d.ROOT==Path('/opt/royal-releases/flag-battle-20261029-v1')
    with (root/'resume-job.json').open('x') as output:json.dump({'toolCommit':tool_commit,'startedAt':time.time()},output)
    phase='guards';code=1;locks=[]
    try:
        prior_failure(root)
        for name in ['/opt/royal-releases/themed-publish.lock','/opt/royal/.client-presentation-deploy.lock','/opt/royal-game-modules-state/module.lock']:
            path=Path(name);assert not path.is_symlink();handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
        d.payload();built=json.loads((root/'build-result.json').read_text())
        assert built['sourceCommit']==d.M['sourceCommit']
        assert d.image('royal-game:'+d.NAME)==built['game']
        assert d.image('royal-nile-play:local')==built['finance']
        d.stable(d.snapshot(),finance=True)
        d.backup()
        samples=ready_samples(d.finance_health)
        d.save('finance-published.json',{'image':built['finance'],'samples':samples,'sourceCommit':d.M['sourceCommit'],'resumeToolCommit':tool_commit})
        phase='host'
        gate=d.FinancialGate([*d.compose('game'),'run','--rm','--no-deps','-T','--entrypoint','node','game','-e',(root/'quiesce.cjs').read_text()],cwd=d.LIVE,log_path=root/'financial-gate-resume.log',min_free_bytes=d.MIN_FREE,disk_paths=(d.LIVE,root,d.BACKUP))
        try:
            gate.acquire();gate.confirm()
            for file in d.M['source']:gate.check();d.atomic(root/'source'/file,d.LIVE/file)
            gate.run(['docker','tag',built['game'],'royal-game:latest'])
            gate.run([*d.compose('game'),'up','-d','--no-deps','--no-build','--force-recreate','game'],cwd=d.LIVE)
            gate.release()
        finally:gate.close()
        d.wait_health('royal-game-1');d.stable(d.snapshot(),finance=True,host=True)
        phase='module'
        assert d.inspect('royal-game-1')['Image']==built['game']
        assert d.sha(d.STATE/'host.json')==d.OLD['hostContract']
        d.atomic(root/'host.json',d.STATE/'host.json')
        spec=importlib.util.spec_from_file_location('flag_module_publisher',root/'game-module-release.py')
        publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
        args=argparse.Namespace(operation='install',package=str(root/'flag-package'),version=None,game='flag-battle',expected_sha=d.M['modulePackage']['beforeSha256'],root='/opt/royal-game-modules',state=str(d.STATE),app_lock=str(d.LIVE/'.client-presentation-deploy.lock'))
        previous_umask=os.umask(0o022)
        try:published=publisher.run(args)
        finally:os.umask(previous_umask)
        assert published['published'];d.save('module-published.json',published)
        after=d.snapshot();d.stable(after,finance=True,host=True,module=True)
        for directory in ['dist','backend','module-dist']:
            target=d.LIVE/('dist-server' if directory=='backend' else directory)
            shutil.copytree(root/directory,target,dirs_exist_ok=True)
        samples=ready_samples(d.finance_health)
        result={'published':True,'sourceCommit':d.M['sourceCommit'],'baseCommit':d.M['baseCommit'],'images':{'game':built['game'],'finance':built['finance']},'module':published,'configurationPreserved':True,'playerDatabaseRestored':False,'oldModulesRetained':True,'otherServicesRetained':True,'financialHealth':samples[-1],'backups':built['backups'],'resumeToolCommit':tool_commit,'originalReadinessFailurePreserved':True}
        d.save('published.json',result);d.save('after.json',after)
        code=0;print(json.dumps(result),flush=True)
    except BaseException as error:
        d.save('resume-failure.json',{'phase':phase,'reason':str(error),'databaseMustNotBeRestored':True})
        raise
    finally:
        d.save('resume-exit.json',{'sourceCommit':d.M['sourceCommit'],'toolCommit':tool_commit,'exitCode':code,'endedAt':time.time()})
        for handle in reversed(locks):handle.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--tool-commit',required=True)
    main(parser.parse_args().tool_commit)
