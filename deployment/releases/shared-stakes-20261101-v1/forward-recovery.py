"""Complete the verified staged switch while continuously supervising both leases."""
from pathlib import Path
import fcntl,hashlib,importlib.util,json,os,subprocess,sys,threading
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('stake_installer',ROOT/'deploy.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
from dual_gate import DualGate
LOCK=threading.RLock()

def synchronized(method):
    def call(self,*args,**kwargs):
        with LOCK:return method(self,*args,**kwargs)
    return call
class SupervisedGate(DualGate):
    acquire=synchronized(DualGate.acquire)
    confirm=synchronized(DualGate.confirm)
    check=synchronized(DualGate.check)
    run=synchronized(DualGate.run)
    release=synchronized(DualGate.release)
    close=synchronized(DualGate.close)
class LeaseMonitor:
    def __init__(self,*gates):self.gates=gates;self.stop=threading.Event();self.error=None
    def __enter__(self):
        def loop():
            while not self.stop.wait(.5):
                try:
                    for gate in self.gates:
                        if gate._quiet and not gate._released and not gate._closed:gate.check()
                except BaseException as error:
                    self.error=error
                    for gate in self.gates:gate._failure=error
                    return
        self.thread=threading.Thread(target=loop,daemon=True);self.thread.start();return self
    def __exit__(self,*_):self.stop.set();self.thread.join()

def expected_modules(m,old_pointers=False):
    result=dict(m['before']['moduleFiles'])
    for game,row in m['packages'].items():
        result.update({str(d.MODULES/game/'versions'/row['version']/n):h for n,h in row['files'].items()})
        if not old_pointers:result[str(d.MODULES/game/'active.json')]=row['pointerSha256']
    return result
def validate(m,built,s,rollback=False):
    d.require(built['sourceCommit']==m['sourceCommit'],'Build source differs')
    d.require(s['source']=={**m['before']['source'],**m['changed']},'Staged source changed')
    d.require(s['moduleFiles']==expected_modules(m) and s['moduleHostContract']==m['hostContractSha256'],'Staged modules changed')
    d.require(s['configHashes']==m['before']['configHashes'],'Production settings changed')
    d.require(s['program']==(built['program'] if rollback else m['before']['program']),'Unexpected running program')
    d.require(s['preparedImage']==(built['image'] if rollback else m['before']['preparedImage']),'Unexpected prepared application')
    d.require(s['container']['image']==(built['image'] if rollback else m['before']['container']['image']),'Unexpected running application')
    d.require(s['services']['/royal-nile-play']['image']==(built['nativeImage'] if rollback else m['before']['services']['/royal-nile-play']['image']),'Unexpected Native image')
    for name,row in m['before']['serviceProfiles'].items():
        d.require(s['serviceProfiles'][name]['profileSha256']==row['profileSha256'],'Service settings changed')
        if name not in ['royal-game-1','royal-nile-play']:d.require(s['serviceProfiles'][name]==row,'Protected service changed')

def execute(rollback=False):
    m=d.manifest();built=d.read(ROOT/'build-result.json');s=d.snapshot();validate(m,built,s,rollback)
    for file,key in [('source.tgz','sourceBackupSha256'),('financial.dump',None)]:
        d.require(d.sha(d.BACKUP/file)==(built[key] if key else built['databaseBackup']['sha256']),'Backup changed')
    d.require(d.image('royal-game:'+d.BUILD_TAG)==built['image'] and d.image('royal-nile-play:'+d.BUILD_TAG)==built['nativeImage'],'Qualified image changed')
    facts=d.read(ROOT/'service-facts.json')
    for f in facts.values():
        for n,h in f['composeHashes'].items():d.require(d.sha(n)==h,'Compose configuration changed')
    host=SupervisedGate(d.gate_command(facts['game'],'royal_game',rollback),ROOT,ROOT/'forward-host-gate.log',min_free_bytes=d.MIN_FREE,disk_paths=[d.LIVE],lease_timeout=600)
    native=SupervisedGate(d.gate_command(facts['native'],'royal_nile_play',rollback),ROOT,ROOT/'forward-native-gate.log',min_free_bytes=d.MIN_FREE,disk_paths=[d.LIVE],lease_timeout=600)
    host.peer=native;native.peer=host;critical=False
    try:
        host.acquire();native.acquire();host.confirm();native.confirm()
        with LeaseMonitor(host,native):
            if rollback:
                import tarfile
                with tarfile.open(d.BACKUP/'source.tgz') as archive:
                    for member in archive.getmembers():
                        d.safe(member.name);d.require(member.isfile(),'Unsafe backup member');temp=ROOT/'restore-source.partial';d.require(not temp.exists(),'Pending source restoration')
                        try:temp.write_bytes(archive.extractfile(member).read());d.atomic(temp,d.LIVE/member.name)
                        finally:temp.unlink(missing_ok=True)
                for n in m['changed']:
                    if n not in m['before']['source']:d.require(d.sha(d.LIVE/n)==m['changed'][n],'Later source detected');(d.LIVE/n).unlink()
                d.atomic(d.BACKUP/'host.json',d.STATE/'host.json')
                for game in m['packages']:d.atomic(d.BACKUP/game/'active.json',d.MODULES/game/'active.json')
                tags=['royal-nile-play:before-'+d.NAME,'royal-game:before-'+d.NAME]
            else:tags=['royal-nile-play:'+d.BUILD_TAG,'royal-game:'+d.BUILD_TAG]
            host.run(['ctr','--namespace','moby','images','tag','--force','docker.io/library/'+tags[0],'docker.io/library/royal-nile-play:local'])
            host.run(['ctr','--namespace','moby','images','tag','--force','docker.io/library/'+tags[1],'docker.io/library/royal-game:latest'])
            for kind,service in [('native','nile-play'),('game','game')]:
                f=facts[kind];args=['docker','compose',*[v for n in f['composeFiles'] for v in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate',service]
                host.confirm();native.confirm();critical=True;host.run(args,cwd=f['cwd'],timeout=180);critical=False
            native.release();host.release()
    except BaseException as error:
        d.save('forward-recovery-required.json',{'sourceCommit':m['sourceCommit'],'reason':str(error),'daemonOutcomeRequiresInspection':critical or bool(getattr(error,'daemon_outcome_unknown',False)),'automaticSecondComposeRefused':True,'databaseRestored':False});raise
    finally:native.close();host.close()
    d.health();after=d.snapshot()
    d.require(after['source']==(m['before']['source'] if rollback else {**m['before']['source'],**m['changed']}),'Running source differs')
    d.require(after['program']==(m['before']['program'] if rollback else built['program']),'Running program differs')
    d.require(after['moduleFiles']==expected_modules(m,rollback),'Module inventory differs')
    d.require(after['moduleHostContract']==(m['before']['moduleHostContract'] if rollback else m['hostContractSha256']),'Host contract differs')
    d.require(after['protectedPrograms']['royal-nile-play']==(m['nativeProtectedBefore'] if rollback else built['nativeProgram']),'Native program differs')
    for name,row in m['before']['serviceProfiles'].items():
        d.require(after['serviceProfiles'][name]['profileSha256']==row['profileSha256'],'Service settings changed after switch')
        if name not in ['royal-game-1','royal-nile-play']:d.require(after['serviceProfiles'][name]==row,'Protected service changed after switch')
    d.capacity()
    result={'published':not rollback,'restored':rollback,'sourceCommit':m['sourceCommit'],'runningImage':after['container']['image'],'nativeImage':after['services']['/royal-nile-play']['image'],'gameCount':18,'addedGames':[],'restoredGames':[],'healthOk':True,'financialAuditOk':True,'databaseRestored':False,'recoveredForward':not rollback,'operatorSha256':d.sha(__file__),'freeAfter':after['availableBytes']}
    d.save('recovered.json' if rollback else 'published.json',result);d.save('after.json',after);print(json.dumps(result),flush=True)
if __name__=='__main__':
    d.require(sys.argv[1:] in [['publish'],['rollback']],'Expected explicit recovery operation')
    locks=[]
    for p in [Path('/opt/royal-releases/themed-publish.lock'),d.LIVE/'.client-presentation-deploy.lock',d.STATE/'module.lock']:
        d.require(not p.is_symlink(),'Unsafe deployment lock');f=p.open('a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
    execute(sys.argv[1]=='rollback')
