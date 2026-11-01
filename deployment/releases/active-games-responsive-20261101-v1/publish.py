"""Publish only reviewed active-game layouts and preserve the complete running host."""
from pathlib import Path
from types import SimpleNamespace
import fcntl,hashlib,importlib.util,json,os,re,shutil,subprocess,sys,tarfile
NAME='active-games-responsive-20261101-v1'
GAMES={'cosmic-escape': 'studio-cosmic-escape', 'caramel-carnival': 'studio-caramel-carnival', 'velvet-reign': 'studio-velvet-reign', 'last-convoy': 'studio-last-convoy', 'nitro-run': 'studio-nitro-run', 'girlhub': 'studio-afterglow', 'meme-overload': 'studio-meme-overload', 'last-exit': 'github-crash', 'royal-plinko': 'royal-plinko', 'cr-vs-leo': 'original-cr-vs-leo', 'flag-battle': 'flag-battle', 'dracona': 'studio-dracona'}
ROOT=Path('/opt/royal-releases')/NAME;LIVE=Path('/opt/royal');MODULES=Path('/opt/royal-game-modules');STATE=Path('/opt/royal-game-modules-state');BACKUP=Path('/opt/royal-backups')/NAME
BASE_HELPER=Path('/opt/royal-releases/remove-reward-games-catalog-20261031-v1/snapshot-base.py')
SOURCES=['games/cosmic-escape/entry.ts', 'games/caramel-carnival/entry.ts', 'games/velvet-reign/entry.ts', 'games/last-convoy/entry.ts', 'games/nitro-run/entry.ts', 'games/girlhub/entry.ts', 'games/meme-overload/entry.ts', 'games/last-exit/entry.ts', 'games/royal-plinko/entry.ts', 'games/cr-vs-leo/entry.ts', 'games/flag-battle/entry.ts', 'games/dracona/styles.ts', 'src/ui/active-game-viewport.css', 'games/dracona/compactStyles.ts'];MIN_FREE=5*1024**3
ADDED={'src/ui/active-game-viewport.css', 'games/dracona/compactStyles.ts'}
IMAGE_HELPER=Path('/opt/royal-maintenance/bin/retention-runtime.py')
PUBLISHED_INPUTS={'src/ui/LastExitAudio.ts': {'sha256': 'e6bb95297bc23bdcda10638dd01d1d4e653a2004ee62628a9ef1b9a6b3e41770', 'serverSourceSha256': '96249fef4a83523ce6cd8ec912e480ab3c56f4eda217611daec0b17539b2c867', 'publishedSourceCommit': '2cf391c368ee75b15959e8359e422ffc19bcab3d', 'gameId': 'github-crash'}, 'src/ui/LastExitScene.ts': {'sha256': '8b419db3c45716aab0aedb948182fe0e1f16d2bb216a929bbc996df1ab778a01', 'serverSourceSha256': '3c776c29151eb7c68f2cd40263a0b2d6e43558214990e3b5da2e3a79b012574f', 'publishedSourceCommit': '2cf391c368ee75b15959e8359e422ffc19bcab3d', 'gameId': 'github-crash'}, 'src/ui/LastExitUI.ts': {'sha256': 'c646689fb8b33ac580b3680498cb6271f7a7eb594141c98ceed65a9425355f17', 'serverSourceSha256': 'a970ad10abbc2a246ea8a513288d3dcf0a253fe25237ba755cde251fac227feb', 'publishedSourceCommit': '2cf391c368ee75b15959e8359e422ffc19bcab3d', 'gameId': 'github-crash'}, 'src/ui/last-exit.css': {'sha256': 'bfe9a219ee0ef46f2731333fbbaaba42bf270eb182cad9c85500e523d05ed956', 'serverSourceSha256': 'db2116678fcfba3f6b27b6057b32949cfef1424ce119990513e1bde50f784ac9', 'publishedSourceCommit': '2cf391c368ee75b15959e8359e422ffc19bcab3d', 'gameId': 'github-crash'}, 'src/ui/lastExitModel.ts': {'sha256': '6008a2217d160c7fb0342bbc2bd57282ecadd9c92e4ea3199def3267b1f56107', 'serverSourceSha256': '7531a2f03313c982d22bccd1fd389c0c87d6538870ce677efc0b1a6c2004200a', 'publishedSourceCommit': '2cf391c368ee75b15959e8359e422ffc19bcab3d', 'gameId': 'github-crash'}, 'src/ui/LastExitAssets.ts': {'sha256': '2326f09838eea56fdd6742eef110a2bd835f6676c236208ae0aa6819317da4c3', 'serverSourceSha256': None, 'publishedSourceCommit': '2cf391c368ee75b15959e8359e422ffc19bcab3d', 'gameId': 'github-crash'}, 'src/shared/neopolisMath.ts': {'sha256': 'e32db65f28cb4cac308d07154fb56f7816fc630c82a7548e1733ad34e0a91820', 'serverSourceSha256': '21d0aa882d9a5c163238f515fb6aaa7e56f9bfadbe045087e8f9150aa40e4fb5', 'publishedSourceCommit': 'd3e4f9c0ef50a4d1ab63f0862696e288125fd740', 'gameId': 'studio-cosmic-escape'}}
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
  require(not path.is_symlink(),'Unsafe lock');handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
 if sys.argv[1:]==['snapshot']:
  require(not (ROOT/'before.json').exists(),'Baseline already saved');before=snapshot();save('before.json',before)
  print(json.dumps({'sourceCommit':before['sourceCommit'],'sourceFiles':len(before['source']),'runtimeFiles':len(before['program']),'services':len(before['services']),'freeBytes':before['availableBytes']}));return
 require(not sys.argv[1:] and not (ROOT/'published.json').exists() and not BACKUP.exists(),'Publication already attempted')
 before=read(ROOT/'before.json');release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json');op=read(ROOT/'operator.json');validate_scope(release,before,op)
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
