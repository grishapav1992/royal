"""Publish reviewed request feedback while preserving the complete running host."""
from pathlib import Path
from types import SimpleNamespace
import fcntl,hashlib,importlib.util,json,os,re,shutil,subprocess,sys,tarfile
sys.dont_write_bytecode=True
NAME='uniform-spin-response-20261104-v1'
GAMES={"cosmic-escape":"studio-cosmic-escape","caramel-carnival":"studio-caramel-carnival","velvet-reign":"studio-velvet-reign","last-convoy":"studio-last-convoy","nitro-run":"studio-nitro-run","girlhub":"studio-afterglow","meme-overload":"studio-meme-overload","dracona":"studio-dracona","forest-heart":"studio-forest-heart","caribbean-treasures":"studio-caribbean-treasures","flooded-temple":"studio-flooded-temple","wild-nudge":"studio-wild-nudge","flag-battle":"flag-battle","royal-plinko":"royal-plinko","cr-vs-leo":"original-cr-vs-leo","jackie-chan":"original-jackie-chan","last-exit":"github-crash"}
ROOT=Path('/opt/royal-releases')/NAME;LIVE=Path('/opt/royal');MODULES=Path('/opt/royal-game-modules');STATE=Path('/opt/royal-game-modules-state');BACKUP=Path('/opt/royal-backups')/NAME
BASE_HELPER=Path('/opt/royal-releases/manual-stakes-20261104-v1/snapshot-base.py')
SOURCES=["games/caribbean-treasures/CaribbeanUI.ts","games/dracona/DraconaUI.ts","games/flag-battle/FlagBattleUI.ts","games/flooded-temple/CascadeUI.ts","games/flooded-temple/TempleUI.ts","games/flooded-temple/cascadeFeedbackStyles.ts","games/forest-heart/ForestHeartUI.ts","games/jackie-chan/JackieUI.ts","games/wild-nudge/GalacticReactorUI.ts","src/ui/AfterglowUI.ts","src/ui/CaramelCarnivalUI.ts","src/ui/CascadeSlotUI.ts","src/ui/ClusterSlotUI.ts","src/ui/CosmicEscapeUI.ts","src/ui/CrLeoUI.ts","src/ui/LastConvoyUI.ts","src/ui/LastExitUI.ts","src/ui/MemeOverloadUI.ts","src/ui/NitroRunUI.ts","src/ui/StudioSlotUI.ts","src/ui/VelvetReignUI.ts","src/ui/VolcanicPlinkoUI.ts","src/ui/operationFeedback.ts","src/ui/slotKit/SlotControls.ts"];MIN_FREE=5*1024**3
ADDED={'src/ui/operationFeedback.ts'}
IMAGE_HELPER=Path('/opt/royal-maintenance/bin/retention-runtime.py')
PUBLISHED_INPUTS={}
IGNORED={'at','availableBytes'}
def require(value,message):
 if not value:raise RuntimeError(message)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):require(not path.is_symlink(),'Symlink rejected');return json.loads(path.read_text())
def save(name,value):(ROOT/name).write_text(json.dumps(value,indent=2)+'\n')
def command(args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE,timeout=60).strip()
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def image(name):
 identity=command(['docker','container','inspect','royal-game-1','--format','{{.Image}}'])
 metadata=load('reviewed_image_metadata',IMAGE_HELPER).image_metadata(identity)
 require(metadata and metadata['Id']==identity and name in metadata['RepoTags'],'Expected tag does not identify the running image')
 return identity
def snapshot():
 helper=load('reviewed_snapshot',BASE_HELPER);helper.ROOT=BASE_HELPER.parent;original=helper.run
 def run(args):
  if args==['docker','image','inspect','royal-game:latest','--format','{{.Id}}']:return image('royal-game:latest')
  return original(args)
 helper.run=run;return helper.snapshot()
def stable(value):return {k:v for k,v in value.items() if k not in IGNORED}
def operator_inputs(release):return release['moduleProjection']['inputs']
def validate_program(game,row,before,after,before_manifest,after_manifest):
 kind='request-feedback'
 require(row['kind']==kind and row['passed'] is True,'Unverified client behavior')
 require(row['beforeManifest']==before_manifest and row['afterManifest']==after_manifest,'Program proof manifest differs')
 require(row['beforeEntry']==before['files'][before['entry']] and row['afterEntry']==after['files'][after['entry']],'Program proof entry differs')
def validate_scope(release,before,operator):
 require(release['scope']=='modules' and release['modules']==list(GAMES) and release['build']['passed'],'Wrong release scope')
 require(release['sourceCommit']==operator['sourceCommit'] and release['baseCommit']==before['sourceCommit'],'Wrong source/base commit')
 require([p['gameId'] for p in release['packages']]==list(GAMES.values()),'Foreign package')
 require(set(operator['source'])==set(SOURCES),'Foreign source patch')
 require(release['moduleProjection']['productionCommit']==before['sourceCommit'],'Wrong projection baseline')
 require(set(operator_inputs(release))>=set(SOURCES),'Changed source absent from verified build')
 for name,digest in operator_inputs(release).items():
  if name in SOURCES:valid=operator['source'][name]==digest
  elif name in PUBLISHED_INPUTS:
   row=PUBLISHED_INPUTS[name];valid=digest==row['sha256'] and before['sourceLF'].get(name)==row['serverSourceSha256']
  else:valid=before['sourceLF'].get(name)==digest
  require(valid,'Unreviewed production input: '+name)
 for game in GAMES.values():require(before['moduleFiles'].get(str(MODULES/game/'active.json'))==operator['beforePointers'][game],'Active package changed since layout verification')
def validate_after(before,after,source,packages):
 expected=dict(before);expected['source']={**before['source'],**source};expected['sourceLF']={**before['sourceLF'],**source};expected['moduleFiles']=dict(before['moduleFiles'])
 for game,row in packages.items():
  prefix=str(MODULES/game/'versions'/row['version'])+'/'
  expected['moduleFiles'].update({prefix+n:h for n,h in row['files'].items()});expected['moduleFiles'][str(MODULES/game/'active.json')]=row['pointerSha256']
 require(stable(after)==stable(expected),'Host, services, other sources or immutable modules changed')
def atomic(origin,target,mode=0o644):
 require(not any(p.is_symlink() for p in [origin,target,*target.parents]),'Unsafe source path')
 partial=target.with_name(target.name+'.'+NAME+'.partial');require(not partial.exists(),'Partial source exists')
 with origin.open('rb') as inp,partial.open('xb') as out:
  shutil.copyfileobj(inp,out);os.fchmod(out.fileno(),mode);out.flush();os.fsync(out.fileno())
 os.replace(partial,target)
def main():
 require(Path(__file__).resolve()==ROOT/'publish.py','Wrong publication root')
 for path in [ROOT,LIVE,MODULES,STATE]:require(path.is_dir() and not any(p.is_symlink() for p in [path,*path.parents]),'Unsafe root')
 locks=[]
 for path in [Path('/opt/royal-releases/themed-publish.lock'),LIVE/'.client-presentation-deploy.lock',STATE/'module.lock']:
  require(not path.is_symlink(),'Unsafe lock');handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
 if sys.argv[1:]==['snapshot']:
  require(not (ROOT/'before.json').exists(),'Baseline already saved');before=snapshot();save('before.json',before)
  print(json.dumps({'sourceCommit':before['sourceCommit'],'sourceFiles':len(before['source']),'runtimeFiles':len(before['program']),'services':len(before['services']),'freeBytes':before['availableBytes']}));return
 require(not sys.argv[1:] and not (ROOT/'published.json').exists() and not BACKUP.exists(),'Publication already attempted')
 before=read(ROOT/'before.json');release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json');op=read(ROOT/'operator.json');validate_scope(release,before,op)
 proof=read(ROOT/'program-proof.json');require(sha(ROOT/'program-proof.json')==op['programProofSha256'] and proof['sourceCommit']==release['sourceCommit'] and set(proof['games'])==set(GAMES.values()),'Program comparison receipt differs')
 for path,key in [(ROOT/'publish.py','wrapperSha256'),(ROOT/'publisher.py','publisherSha256'),(ROOT/'release-manifest.json','releaseManifestSha256'),(ROOT/'release-github.json','receiptSha256')]:require(sha(path)==op[key],'Publication input changed')
 require(sha(BASE_HELPER)==op['snapshotSha256'] and sha(IMAGE_HELPER)==op['imageHelperSha256'] and sha(ROOT/'publisher.py')==before['source']['scripts/game-module-release.py'],'Unreviewed helper')
 require(receipt['sourceCommit']==release['sourceCommit'],'Unverified source receipt')
 for name,digest in op['source'].items():require(sha(ROOT/'source'/name)==digest,'Source payload changed')
 current=snapshot();require(stable(current)==stable(before),'Production changed since review');require(current['container']['health']=='healthy','Unhealthy host')
 publisher=load('reviewed_publisher',ROOT/'publisher.py');contracts=read(STATE/'host.json')['games'];prepared={};expected_files={};total=0
 for slug,game in GAMES.items():
  row=op['packages'][game];folder=ROOT/'packages'/game;metadata=read(folder/'manifest.json')
  require(metadata['version']==row['version'] and metadata['gameId']==game,'Wrong package identity')
  files={'manifest.json':sha(folder/'manifest.json'),**metadata['files']};require(files==row['files'],'Changed package inventory')
  prefix='module-dist/'+game+'/versions/'+row['version']+'/'
  expected_files.update({prefix+n:h for n,h in files.items()});expected_files['module-dist/'+game+'/active.json']=row['pointerSha256']
  options=SimpleNamespace(operation='check',package=str(folder),game=game,root=str(MODULES),state=str(STATE),expected_sha=before['moduleFiles'][str(MODULES/game/'active.json')])
  checked=publisher.run(options);total+=checked['bytes'];old_pointer=read(MODULES/game/'active.json');old_version=old_pointer['manifest'].split('/')[4];old=MODULES/game/'versions'/old_version
  publisher.verify(old,contracts[game],game);prepared[game]=(options,old_version,old)
  validate_program(game,proof['games'][game],read(old/'manifest.json'),metadata,sha(old/'manifest.json'),sha(folder/'manifest.json'))
 require(release['files']==expected_files,'Prepared packages differ');require(shutil.disk_usage(LIVE).free>MIN_FREE+total*3+12*1024**2,'Five GiB reserve would be crossed')
 command(['docker','tag',current['container']['image'],'royal-game:before-'+NAME]);require(image('royal-game:before-'+NAME)==current['container']['image'],'Wrong rollback tag')
 BACKUP.mkdir(mode=0o700)
 with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
  for name in SOURCES:
   if name not in ADDED:archive.add(LIVE/name,arcname=name,recursive=False)
  for game in GAMES.values():archive.add(MODULES/game/'active.json',arcname=game+'/active.json',recursive=False)
  archive.add(STATE/'host.json',arcname='host.json',recursive=False)
 (BACKUP/'source.tgz').chmod(0o600)
 expected={n:before['source'][n] for n in SOURCES if n not in ADDED};expected.update({game+'/active.json':before['moduleFiles'][str(MODULES/game/'active.json')] for game in GAMES.values()});expected['host.json']=before['moduleHostContract']
 with tarfile.open(BACKUP/'source.tgz') as archive:require({m.name:hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers() if m.isfile()}==expected,'Backup verification failed')
 for game,(_,version,old) in prepared.items():shutil.copytree(old,BACKUP/game,copy_function=os.link);publisher.verify(BACKUP/game,contracts[game],game)
 backup={'sourceArchive':str(BACKUP/'source.tgz'),'bytes':(BACKUP/'source.tgz').stat().st_size,'sha256':sha(BACKUP/'source.tgz'),'oldVersions':{g:v for g,(_,v,_) in prepared.items()},'oldPackagesHardlinked':True,'imageTag':'royal-game:before-'+NAME,'image':current['container']['image']};save('backup.json',backup)
 for name in SOURCES:
  if name in ADDED:require(name not in before['source'] and not (LIVE/name).exists(),'New source already exists')
  else:require(sha(LIVE/name)==before['source'][name],'Source changed before replacement')
  atomic(ROOT/'source'/name,LIVE/name)
 results=[];mask=os.umask(0o022)
 try:
  for game,(options,_,_) in prepared.items():options.operation='install';results.append(publisher.run(options))
 finally:os.umask(mask)
 after=snapshot();save('after.json',after);validate_after(before,after,op['source'],op['packages']);require(shutil.disk_usage(LIVE).free>MIN_FREE,'Five GiB reserve crossed')
 record={'published':True,'release':NAME,'sourceCommit':release['sourceCommit'],'baseCommit':release['baseCommit'],'modules':results,'backup':backup,'freeBefore':current['availableBytes'],'freeAfter':after['availableBytes'],'hostRestarted':False,'databaseTouched':False,'otherModulesPreserved':True,'sourceFilesPreserved':len(before['source'])-len(SOURCES)+len(ADDED),'runtimeFilesPreserved':len(before['program']),'servicesPreserved':len(before['services'])};save('published.json',record);print(json.dumps(record))
if __name__=='__main__':main()
