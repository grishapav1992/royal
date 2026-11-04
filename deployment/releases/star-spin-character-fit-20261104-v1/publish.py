"""Publish only the verified Vespera full-body asset repair, preserving the complete running host."""
from pathlib import Path
from types import SimpleNamespace
import fcntl,hashlib,importlib.util,json,os,re,shutil,subprocess,sys,tarfile
NAME='star-spin-character-fit-20261104-v1';GAME='studio-wild-nudge'
ROOT=Path('/opt/royal-releases')/NAME;LIVE=Path('/opt/royal');MODULES=Path('/opt/royal-game-modules');STATE=Path('/opt/royal-game-modules-state');BACKUP=Path('/opt/royal-backups')/NAME
BASE_HELPER=Path('/opt/royal-releases/remove-hall-title-20261103-v1/snapshot-base.py')
SOURCES=["games/wild-nudge/README.md","games/wild-nudge/animation/rigs.json","games/wild-nudge/animation/vespera/blink-reference.png","games/wild-nudge/animation/vespera/eyelids.png","games/wild-nudge/animation/vespera/scene.rml","games/wild-nudge/assets/characters/prompts.json","games/wild-nudge/assets/characters/vespera.png","games/wild-nudge/assets/characters/framing-repair.json","games/wild-nudge/package.json"]
ADOPTED_SOURCES=["games/wild-nudge/GalacticReactorUI.ts","games/wild-nudge/StarSpinLayout.ts","games/wild-nudge/reactor.css","games/wild-nudge/tsconfig.json"]
MEDIA_SOURCES=["public/assets/wild-nudge/characters/aeliri-rive.json","public/assets/wild-nudge/characters/lyra-rive.json","public/assets/wild-nudge/characters/nyxara-rive.json","public/assets/wild-nudge/characters/vespera-rive.json","public/assets/wild-nudge/characters/vespera.webp"]
ADDED={'games/wild-nudge/assets/characters/framing-repair.json'}
IMAGE_HELPER=Path('/opt/royal-maintenance/bin/retention-runtime.py')
CONTRACT={'apiVersion':1,'rulesVersion':2,'progressVersion':1};MIN_FREE=5*1024**3
EXPECTED_MANIFEST='288d2c1d84a4c28573d29d64e23ad6f25eda088f9c603ae4334a573f853b537d'
EXPECTED_HOST_RUNTIME='ef882d0cbdee73d9377a151331b160fc4c2e4e3fb613144e341628444b9b2df6'
SNAPSHOT_SHA='a9f801e4dfa5da4520eb39803fae1726a59effb901ac7f9fa4b0f681d839afa4'
ALLOWED_HOST_SOURCES={'5538f71e3c1d61ebdd8e73a43a395dfcaec22a6e'}
ALLOWED_HALL_SOURCE={}
IGNORED={'at','availableBytes'}
sys.dont_write_bytecode=True
def require(value,message):
 if not value:raise RuntimeError(message)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):require(not path.is_symlink(),'Symlink rejected');return json.loads(path.read_text())
def save(name,value):(ROOT/name).write_text(json.dumps(value,indent=2)+'\n')
def command(args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE,timeout=180).strip()
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def image(name):
 identity=command(['docker','container','inspect','royal-game-1','--format','{{.Image}}'])
 metadata=load('reviewed_image_metadata',IMAGE_HELPER).image_metadata(identity)
 require(metadata and metadata['Id']==identity and name in metadata['RepoTags'],'Expected tag does not identify the running image')
 return identity
def snapshot():
 identity=command(['docker','container','inspect','royal-game-1','--format','{{.Image}}'])
 candidates=[]
 for folder in [BASE_HELPER.parent]:
  if not (folder/'published.json').is_file():continue
  published=read(folder/'published.json')
  if published.get('published') is True and published.get('runningImage')==identity and published.get('sourceCommit') in ALLOWED_HOST_SOURCES:candidates.append(folder)
 require(len(candidates)==1,'Need one verified compatible host publication')
 path=candidates[0]/'snapshot-base.py';require(sha(path)==SNAPSHOT_SHA,'Snapshot helper changed')
 helper=load('reviewed_snapshot',path);helper.ROOT=candidates[0];original=helper.run
 # Containerd metadata proves the exact target without Docker's slow layer-size traversal.
 def run(args):
  if args==['docker','image','inspect','royal-game:latest','--format','{{.Id}}']:return image('royal-game:latest')
  return original(args)
 helper.run=run
 return helper.snapshot()
def stable(value):return {k:v for k,v in value.items() if k not in IGNORED}
def validate_scope(release,before,operator):
 require(release['scope']=='modules' and release['modules']==['wild-nudge'] and release['build']['passed'],'Wrong release scope')
 require(release['sourceCommit']==operator['sourceCommit'] and release['baseCommit']==before['sourceCommit'],'Wrong source/base commit')
 require(len(release['packages'])==1 and release['packages'][0]['gameId']==GAME,'Foreign package')
 require(set(operator['source'])==set(SOURCES)|set(ADOPTED_SOURCES),'Foreign source patch')
 require(all(operator['source'][n]==before['source'].get(n) for n in ADOPTED_SOURCES),'Previously published UI source changed')
 require(set(operator['media'])==set(MEDIA_SOURCES),'Foreign media source')
 require(release['packages'][0]['version']=='1.5.1-a6511d3f697d','Not the visually verified package')
def validate_inputs(before,operator,proof,equivalence=None):
 require(proof['version']=='1.5.1-a6511d3f697d' and proof['sourceSha256']=='a6511d3f697d1e0ef55267bdcaf58e96dfe6213d60d99dcf69284fbd22a84ff7','Different UI implementation')
 require(proof['hostSingletonsExternalized'] and not proof['serverImplementationIncluded'],'Module boundary differs')
 for name,digest in proof['sourceFiles'].items():
  if name.startswith('node_modules/'):
   require(name=='node_modules/@rive-app/webgl2/rive.js' and digest=='abe9dda86ab90382f565ce3cc6fbd458be549dbfcd26df1218480db5bb48793f','Unreviewed dependency')
  elif name in SOURCES:require(operator['source'][name]==digest,'Source differs from module')
  elif digest not in [before['source'].get(name),before['sourceLF'].get(name)]:
   row=(equivalence or {}).get('rows',{}).get(name)
   require(row and row['inputSha256']==digest and row['productionLFSha256']==before['sourceLF'].get(name),'Unreviewed source equivalence: '+name)
   if row['kind']=='line-endings-only':
    canonical=(LIVE/name).read_bytes().replace(b'\r\n',b'\n')
    require(hashlib.sha256(canonical).hexdigest()==row['productionLFSha256'] and hashlib.sha256(canonical.replace(b'\n',b'\r\n')).hexdigest()==digest,'Source differs beyond line endings')
   else:
    require(name=='src/modules/GameHostContract.ts' and row['kind']=='type-only-runtime-equal' and row['passed'] is True and row['runtimeSha256']==EXPECTED_HOST_RUNTIME and digest=='ead24006bf5e273d25c80f1077f910c905002e7a185ce8767044c845e57fe9e3' and row['productionLFSha256']=='328b39ef96f8cd544e892234c68dd3662bf1cca29d74b890e95c409aa285416b','Unverified host runtime equivalence')

def validate_after(before,after,source,files,pointer,version):
 expected=dict(before);expected['source']={**before['source'],**source};expected['sourceLF']={**before['sourceLF'],**source}
 prefix=str(MODULES/GAME/'versions'/version)+'/'
 expected['moduleFiles']={**before['moduleFiles'],**{prefix+n:h for n,h in files.items()},str(MODULES/GAME/'active.json'):pointer}
 require(stable(after)==stable(expected),'Host, services, other sources or immutable modules changed')

def validate_compatible_host(before,current,operator,proof,equivalence):
 require(current['sourceCommit'] in ALLOWED_HOST_SOURCES and current['container']['health']=='healthy','Unreviewed or unhealthy host')
 differences={n:current['source'].get(n) for n in set(before['source'])|set(current['source']) if current['source'].get(n)!=before['source'].get(n)}
 require(not differences and stable(current)==stable(before),'Production changed after preparation')
 for key in ['configHashes','protectedPrograms','realMoneyFlags','moduleFiles','moduleHostContract','moduleHost']:
  require(current[key]==before[key],'Concurrent host changed protected '+key)
 backend={n:h for n,h in before['program'].items() if n.startswith('dist-server/')}
 require(backend and {n:h for n,h in current['program'].items() if n.startswith('dist-server/')}==backend,'Backend program bytes changed')
 for key in ['services','serviceProfiles']:
  original={n:v for n,v in before[key].items() if n.lstrip('/')!='royal-game-1'}
  actual={n:v for n,v in current[key].items() if n.lstrip('/')!='royal-game-1'}
  require(actual==original,'A different persistent service changed')
 require(current['moduleHost']['games'][GAME]==CONTRACT,'Incompatible current host')
 validate_inputs(current,operator,proof,equivalence)
def atomic(origin,target):
 require(not any(p.is_symlink() for p in [origin,target,*target.parents]),'Unsafe source path')
 partial=target.with_name(target.name+'.'+NAME+'.partial');require(not partial.exists(),'Partial source exists')
 with origin.open('rb') as inp,partial.open('xb') as out:
  shutil.copyfileobj(inp,out);os.fchmod(out.fileno(),0o644);out.flush();os.fsync(out.fileno())
 os.replace(partial,target)
def main():
 require(Path(__file__).resolve()==ROOT/'publish.py','Wrong publication root')
 for path in [ROOT,LIVE,MODULES,STATE]:require(path.is_dir() and not any(p.is_symlink() for p in [path,*path.parents]),'Unsafe root')
 locks=[]
 for path in [Path('/opt/royal-releases/themed-publish.lock'),LIVE/'.client-presentation-deploy.lock',STATE/'module.lock']:
  require(not path.is_symlink(),'Unsafe lock');handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX);locks.append(handle)
 if sys.argv[1:]==['snapshot']:
  require(not (ROOT/'before.json').exists(),'Baseline already saved');before=snapshot();save('before.json',before)
  print(json.dumps({'sourceCommit':before['sourceCommit'],'sourceFiles':len(before['source']),'runtimeFiles':len(before['program']),'services':len(before['services']),'freeBytes':before['availableBytes']}));return
 require(not sys.argv[1:] and not (ROOT/'published.json').exists() and not BACKUP.exists(),'Publication already attempted or unexpected command')
 before=read(ROOT/'before.json');release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json');op=read(ROOT/'operator.json');validate_scope(release,before,op)
 for path,key in [(ROOT/'publish.py','wrapperSha256'),(ROOT/'publisher.py','publisherSha256'),(ROOT/'release-manifest.json','releaseManifestSha256'),(ROOT/'release-github.json','receiptSha256')]:
  require(sha(path)==op[key],'Publication input changed')
 require(sha(BASE_HELPER)==op['snapshotSha256'] and sha(IMAGE_HELPER)==op['imageHelperSha256'] and sha(ROOT/'publisher.py')==before['source']['scripts/game-module-release.py'],'Unreviewed helper')
 require(receipt['sourceCommit']==release['sourceCommit'],'Unverified source receipt')
 require(sha(ROOT/'module-proof.json')==op['moduleProofSha256'] and sha(ROOT/'input-equivalence.json')==op['inputEquivalenceSha256'],'Module proof changed');proof=read(ROOT/'module-proof.json');equivalence=read(ROOT/'input-equivalence.json')
 require(equivalence['productionCommit']==before['sourceCommit'] and equivalence['package']==proof['version'],'Wrong source equivalence baseline');validate_inputs(before,op,proof,equivalence)
 for name,digest in op['source'].items():require(sha(ROOT/'source'/name)==digest,'Source payload changed')
 current=snapshot();validate_compatible_host(before,current,op,proof,equivalence);save('deployment-before.json',current)
 require(read(STATE/'host.json')['games'][GAME]==CONTRACT,'Incompatible host')
 command(['docker','tag',current['container']['image'],'royal-game:before-'+NAME])
 require(image('royal-game:before-'+NAME)==current['container']['image'],'Missing exact rollback image tag')
 publisher=load('reviewed_publisher',ROOT/'publisher.py');metadata=read(ROOT/'package/manifest.json');version=release['packages'][0]['version']
 require(metadata['version']==version and metadata['gameId']==GAME and metadata['sourceSha256']==proof['sourceSha256'] and sha(ROOT/'package/manifest.json')==EXPECTED_MANIFEST,'Wrong package identity')
 for name,digest in metadata['files'].items():
  if name.startswith('media/'):
   source='public/assets/'+name.removeprefix('media/');require(digest==op['media'].get(source,before['source'].get(source)),'Media source differs from the reviewed live/patch bytes: '+source)
 files={'manifest.json':sha(ROOT/'package/manifest.json'),**metadata['files']};folder='module-dist/'+GAME+'/versions/'+version+'/'
 require(release['files']=={**{folder+n:h for n,h in files.items()},'module-dist/'+GAME+'/active.json':op['pointerSha256']},'Prepared package differs')
 options=SimpleNamespace(operation='check',package=str(ROOT/'package'),game=GAME,root=str(MODULES),state=str(STATE),expected_sha=before['moduleFiles'][str(MODULES/GAME/'active.json')])
 checked=publisher.run(options);require(shutil.disk_usage(LIVE).free>MIN_FREE+checked['bytes']*3+12*1024**2,'Five GiB reserve would be crossed')
 old_pointer=read(MODULES/GAME/'active.json');old_version=old_pointer['manifest'].split('/')[4];old=MODULES/GAME/'versions'/old_version;publisher.verify(old,CONTRACT,GAME)
 BACKUP.mkdir(mode=0o700)
 with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
  for name in SOURCES:
   if name not in ADDED:archive.add(LIVE/name,arcname=name,recursive=False)
  archive.add(MODULES/GAME/'active.json',arcname='active.json',recursive=False);archive.add(STATE/'host.json',arcname='host.json',recursive=False)
 (BACKUP/'source.tgz').chmod(0o600)
 expected={n:before['source'][n] for n in SOURCES if n not in ADDED};expected.update({'active.json':options.expected_sha,'host.json':before['moduleHostContract']})
 with tarfile.open(BACKUP/'source.tgz') as archive:require({m.name:hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers() if m.isfile()}==expected,'Backup verification failed')
 shutil.copytree(old,BACKUP/'package',copy_function=os.link);publisher.verify(BACKUP/'package',CONTRACT,GAME)
 backup={'sourceArchive':str(BACKUP/'source.tgz'),'bytes':(BACKUP/'source.tgz').stat().st_size,'sha256':sha(BACKUP/'source.tgz'),'oldVersion':old_version,'oldPackageHardlinked':True,'imageTag':'royal-game:before-'+NAME,'image':current['container']['image']};save('backup.json',backup)
 for name in SOURCES:
  if name in ADDED:require(name not in before['source'] and not (LIVE/name).exists(),'New source already exists')
  else:require(sha(LIVE/name)==before['source'][name],'Source changed before replacement')
  atomic(ROOT/'source'/name,LIVE/name)
 options.operation='install';mask=os.umask(0o022)
 try:result=publisher.run(options)
 finally:os.umask(mask)
 after=snapshot();save('after.json',after);validate_after(current,after,op['source'],files,op['pointerSha256'],version)
 require(shutil.disk_usage(LIVE).free>MIN_FREE,'Five GiB reserve crossed')
 record={'published':True,'release':NAME,'sourceCommit':release['sourceCommit'],'baseCommit':current['sourceCommit'],'buildBaseCommit':release['baseCommit'],'module':result,'backup':backup,'freeBefore':current['availableBytes'],'freeAfter':after['availableBytes'],'hostRestarted':False,'databaseTouched':False,'otherModulesPreserved':True,'sourceFilesPreserved':len(current['source'])-len(SOURCES)+len(ADDED),'runtimeFilesPreserved':len(current['program']),'servicesPreserved':len(current['services'])};save('published.json',record);print(json.dumps(record))
if __name__=='__main__':main()
