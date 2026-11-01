"""Preserve the retired financial interface on its original verified program."""
from pathlib import Path
import fcntl,importlib.util,json,sys
ROOT=Path(__file__).resolve().parent
def load(name,file):
    s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
d=load('native_restore_installer',ROOT/'deploy.py')
f=load('native_restore_leases',ROOT/'forward-recovery.py')

def main():
    locks=[]
    for p in [Path('/opt/royal-releases/themed-publish.lock'),d.LIVE/'.client-presentation-deploy.lock',d.STATE/'module.lock']:
        d.require(not p.is_symlink(),'Unsafe publication lock');h=p.open('a');fcntl.flock(h,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(h)
    m=d.manifest();built=d.read(ROOT/'build-result.json')
    d.require(d.inspect('royal-game-1')['Image']==built['image'],'Application image changed')
    old=m['before']['services']['/royal-nile-play']['image'];current=d.inspect('royal-nile-play')
    d.require(current['Image']==built['nativeImage'],'Financial service changed')
    d.require(d.image('royal-nile-play:before-'+d.NAME)==old,'Original financial program changed')
    facts=d.read(ROOT/'service-facts.json')['native']
    for n,h in facts['composeHashes'].items():d.require(d.sha(n)==h,'Financial settings changed')
    gate=f.SupervisedGate(d.gate_command(facts,'royal_nile_play',True),ROOT,ROOT/'native-restoration-gate.log',min_free_bytes=d.MIN_FREE,disk_paths=[d.LIVE],lease_timeout=600)
    critical=False
    try:
        gate.acquire();gate.confirm()
        with f.LeaseMonitor(gate):
            # The existing rollback gate refuses adoption of any new shared-stake financial round.
            gate.run(['ctr','--namespace','moby','images','tag','--force','docker.io/library/royal-nile-play:before-'+d.NAME,'docker.io/library/royal-nile-play:local'])
            args=['docker','compose',*[v for n in facts['composeFiles'] for v in ['-f',n]],'up','-d','--no-deps','--no-build','--force-recreate','nile-play']
            critical=True;gate.run(args,cwd=facts['cwd'],timeout=180);critical=False;gate.release()
    except BaseException as error:
        d.save('native-restoration-required.json',{'reason':str(error),'daemonOutcomeRequiresInspection':critical or bool(getattr(error,'daemon_outcome_unknown',False)),'automaticSecondComposeRefused':True,'databaseRestored':False});raise
    finally:gate.close()
    d.health();after=d.snapshot()
    d.require(after['container']['image']==built['image'] and after['program']==built['program'],'Application changed')
    d.require(after['source']=={**m['before']['source'],**m['changed']},'Application source changed')
    d.require(after['moduleFiles']==f.expected_modules(m) and after['moduleHostContract']==m['hostContractSha256'],'Active modules changed')
    d.require(after['services']['/royal-nile-play']['image']==old and after['protectedPrograms']['royal-nile-play']==m['nativeProtectedBefore'],'Financial program restoration differs')
    d.require(after['configHashes']==m['before']['configHashes'],'Production settings changed')
    for name,row in m['before']['serviceProfiles'].items():
        d.require(after['serviceProfiles'][name]['profileSha256']==row['profileSha256'],'Service settings changed')
        if name not in ['royal-game-1','royal-nile-play']:d.require(after['serviceProfiles'][name]==row,'Protected service changed')
    d.capacity();d.save('unused-native-candidate.json',{'image':built['nativeImage'],'program':built['nativeProgram'],'reason':'Retired financial APIs remain on their original program; active paid games use the host wallet.'})
    built['nativeImage']=old;built['nativeProgram']=m['nativeProtectedBefore'];built['nativeRestoredToOriginal']=True;d.save('build-result.json',built)
    result={'published':True,'sourceCommit':m['sourceCommit'],'runningImage':built['image'],'nativeImage':old,'nativeProgramUnchanged':True,'nativeNewStakePolicyNotAdopted':True,'gameCount':18,'addedGames':[],'restoredGames':[],'healthOk':True,'financialAuditOk':True,'databaseRestored':False,'operatorSha256':d.sha(__file__),'freeAfter':after['availableBytes']}
    d.save('published.json',result);d.save('after.json',after);d.save('native-restoration.json',result);print(json.dumps(result),flush=True)
if __name__=='__main__':
    d.require(sys.argv[1:]==['restore'],'Explicit restoration operation required');main()
