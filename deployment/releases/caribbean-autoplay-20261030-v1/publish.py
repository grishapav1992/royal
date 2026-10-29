"""Publish a compatible Caribbean client with reused immutable media and unchanged host services."""
from pathlib import Path
from types import SimpleNamespace
import fcntl,hashlib,importlib.util,json,os,shutil,subprocess,sys,tarfile

NAME='caribbean-autoplay-20261030-v1';GAME='studio-caribbean-treasures'
ROOT=Path('/opt/royal-releases')/NAME;LIVE=Path('/opt/royal');MODULES=Path('/opt/royal-game-modules');STATE=Path('/opt/royal-game-modules-state');BACKUP=Path('/opt/royal-backups')/NAME
SOURCES=['games/caribbean-treasures/'+name for name in ['CaribbeanUI.ts','CaribbeanCaptain.ts','caribbean.css','package.json','character-motion.md']]
CONTRACT={'apiVersion':1,'rulesVersion':1,'progressVersion':1};MIN_FREE=5*1024**3
def require(value,message):
 if not value:raise RuntimeError(message)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):require(not path.is_symlink(),'Symlink rejected');return json.loads(path.read_text())
def command(args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE).strip()
def inspect(name):return json.loads(command(['docker','inspect',name]))[0]
def source_rows(names):
 result={}
 for name in names:
  path=LIVE/name;require(not path.is_symlink() and path.is_file(),'Source missing: '+name);data=path.read_bytes()
  result[name]={'sha256':hashlib.sha256(data).hexdigest(),'lf':hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()}
 return result
def snapshot(protected=()):
 host=inspect('royal-game-1');services={}
 for name in command(['docker','ps','--format','{{.Names}}']).splitlines():
  try:row=inspect(name)
  except subprocess.CalledProcessError as error:
   if name in protected or 'no such object' not in error.stderr.lower():raise
   continue
  if row['HostConfig']['RestartPolicy']['Name'] not in ['always','unless-stopped','on-failure']:continue
  config=row['Config'];services[name]={'id':row['Id'],'image':row['Image'],'startedAt':row['State']['StartedAt'],
   'envHash':hashlib.sha256(json.dumps(sorted(config.get('Env',[]))).encode()).hexdigest(),
   'mounts':sorted([{k:m.get(k) for k in ['Source','Destination','RW']} for m in row['Mounts']],key=lambda m:m['Destination'])}
 sums=command(['docker','exec','royal-game-1','sha256sum','/app/dist/index.html','/app/dist-server/index.js','/app/dist-server/payments.js','/app/dist-server/crypto-reconcile.js'])
 return {'sourceCommit':host['Config']['Labels'].get('org.opencontainers.image.revision'),'image':host['Image'],'containerId':host['Id'],'health':host['State']['Health']['Status'],
  'preparedImage':command(['docker','image','inspect','royal-game:latest','--format','{{.Id}}']),
  'program':{name.removeprefix('/app/'):digest for digest,name in map(str.split,sums.splitlines())},
  'source':source_rows(SOURCES),'services':services,'hostContractSha256':sha(STATE/'host.json'),
  'modulePointers':{str(p.relative_to(MODULES)):sha(p) for p in sorted(MODULES.glob('*/active.json'))},
  'publisherSha256':sha(LIVE/'scripts/game-module-release.py'),
  'configuration':{str(p):sha(p) for p in [LIVE/'.env',*[Path(n) for n in host['Config']['Labels']['com.docker.compose.project.config_files'].split(',')]]}}
def validate_scope(release,before,operator):
 require(release['scope']=='modules' and release['modules']==['caribbean-treasures'] and release['build']['passed'],'Wrong release scope')
 require(release['sourceCommit']==operator['sourceCommit'] and release['baseCommit']==before['sourceCommit'],'Wrong source/base commit')
 require(len(release['packages'])==1 and release['packages'][0]['gameId']==GAME,'Foreign package')
 require(set(operator['source'])==set(SOURCES),'Foreign source patch')
def materialize(old,metadata,delta,target):
 require(not target.exists(),'Package stage already exists');target.mkdir(mode=0o755)
 for name,digest in {'manifest.json':sha(delta/'manifest.json'),**metadata['files']}.items():
  path=Path(name);require(not path.is_absolute() and '..' not in path.parts,'Unsafe resource')
  fresh=delta/path;retained=old/path;origin=fresh if fresh.is_file() else retained
  require(not origin.is_symlink() and origin.is_file() and sha(origin)==digest,'Resource differs: '+name)
  destination=target/path;destination.parent.mkdir(parents=True,exist_ok=True)
  os.link(origin,destination)
def main():
 require(Path(__file__).resolve()==ROOT/'publish.py','Wrong publication root')
 for path in [ROOT,LIVE,MODULES,STATE]:require(path.is_dir() and not any(p.is_symlink() for p in [path,*path.parents]),'Unsafe root')
 locks=[]
 for path in [Path('/opt/royal-releases/themed-publish.lock'),LIVE/'.client-presentation-deploy.lock',STATE/'module.lock']:
  require(not path.is_symlink(),'Unsafe lock');handle=path.open('a');fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(handle)
 if len(sys.argv)==2 and sys.argv[1]=='snapshot':
  require(not (ROOT/'before.json').exists(),'Baseline already saved');before=snapshot(['royal-game-1','royal-payments-1','royal-nile-play']);before['pointer']=read(MODULES/GAME/'active.json');before['pointerSha256']=sha(MODULES/GAME/'active.json')
  (ROOT/'before.json').write_text(json.dumps(before,indent=2)+'\n');print(json.dumps(before));return
 require(not (ROOT/'published.json').exists() and not BACKUP.exists(),'Publication already attempted')
 before=read(ROOT/'before.json');release=read(ROOT/'release-manifest.json');receipt=read(ROOT/'release-github.json');operator=read(ROOT/'operator.json');validate_scope(release,before,operator)
 require(sha(Path(__file__))==operator['wrapperSha256'],'Publication helper differs')
 require(sha(ROOT/'release-manifest.json')==operator['releaseManifestSha256'] and sha(ROOT/'release-github.json')==operator['receiptSha256'],'Prepared metadata differs')
 require(receipt['sourceCommit']==release['sourceCommit'],'Unverified source receipt')
 require(sha(ROOT/'publisher.py')==before['publisherSha256']==operator['publisherSha256'],'Publisher differs')
 for name,digest in operator['source'].items():require(sha(ROOT/'source'/name)==digest,'Source bytes differ')
 current=snapshot(before['services']);require(current=={k:before[k] for k in current},'Production changed since review');require(current['health']=='healthy','Unhealthy host')
 require(read(STATE/'host.json')['games'][GAME]==CONTRACT,'Incompatible host')
 require(sha(MODULES/GAME/'active.json')==before['pointerSha256'],'Pointer changed')
 metadata=read(ROOT/'delta/manifest.json');version=release['packages'][0]['version'];require(metadata['version']==version and metadata['gameId']==GAME,'Wrong package identity')
 folder='module-dist/'+GAME+'/versions/'+version+'/'
 expected={folder+name:digest for name,digest in metadata['files'].items()};expected[folder+'manifest.json']=sha(ROOT/'delta/manifest.json');expected['module-dist/'+GAME+'/active.json']=operator['pointerSha256']
 require(release['files']==expected,'Prepared inventory differs')
 old_version=before['pointer']['manifest'].split('/')[4];old=MODULES/GAME/'versions'/old_version
 spec=importlib.util.spec_from_file_location('reviewed_publisher',ROOT/'publisher.py');publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
 publisher.verify(old,CONTRACT,GAME)
 total=sum((ROOT/'delta'/n).stat().st_size if (ROOT/'delta'/n).is_file() else (old/n).stat().st_size for n in metadata['files'])
 require(shutil.disk_usage(LIVE).free>MIN_FREE+total+12*1024**2,'Five GiB reserve would be crossed')
 previous=os.umask(0o022)
 try:materialize(old,metadata,ROOT/'delta',ROOT/'package');publisher.verify(ROOT/'package',CONTRACT,GAME)
 finally:os.umask(previous)
 BACKUP.mkdir(mode=0o700)
 with tarfile.open(BACKUP/'source.tgz','w:gz') as archive:
  for name in SOURCES:archive.add(LIVE/name,arcname='application/'+name,recursive=False)
  archive.add(MODULES/GAME/'active.json',arcname='active.json',recursive=False);archive.add(STATE/'host.json',arcname='host.json',recursive=False)
 (BACKUP/'source.tgz').chmod(0o600)
 # Immutable old media stays recoverable without another physical copy.
 shutil.copytree(old,BACKUP/'package',copy_function=os.link);publisher.verify(BACKUP/'package',CONTRACT,GAME)
 for image,suffix in [(current['image'],''),(current['preparedImage'],'-prepared')]:command(['docker','tag',image,'royal-game:before-'+NAME+suffix])
 backup={'sourceArchive':str(BACKUP/'source.tgz'),'bytes':(BACKUP/'source.tgz').stat().st_size,'sha256':sha(BACKUP/'source.tgz'),'oldVersion':old_version,'oldPackageHardlinked':True,'oldManifestSha256':sha(BACKUP/'package/manifest.json')}
 (ROOT/'backup.json').write_text(json.dumps(backup,indent=2)+'\n')
 for name,digest in operator['source'].items():
  target=LIVE/name;require(sha(target)==before['source'][name]['sha256'],'Source changed')
  partial=target.with_name(target.name+'.caribbean-autoplay-partial');require(not partial.exists(),'Partial source exists');shutil.copyfile(ROOT/'source'/name,partial);partial.replace(target)
 previous=os.umask(0o022)
 try:result=publisher.run(SimpleNamespace(operation='install',package=str(ROOT/'package'),game=GAME,root=str(MODULES),state=str(STATE),expected_sha=before['pointerSha256']))
 finally:os.umask(previous)
 after=snapshot(before['services'])
 require({k:v for k,v in after.items() if k not in ['source','modulePointers']}=={k:v for k,v in current.items() if k not in ['source','modulePointers']},'Host or services changed')
 require({k:v for k,v in after['modulePointers'].items() if k!=GAME+'/active.json'}=={k:v for k,v in current['modulePointers'].items() if k!=GAME+'/active.json'},'Other module changed')
 require(all(after['source'][n]['sha256']==digest for n,digest in operator['source'].items()),'Source synchronization failed')
 require(sha(MODULES/GAME/'active.json')==operator['pointerSha256'],'Installed pointer differs');require(shutil.disk_usage(LIVE).free>MIN_FREE,'Server reserve crossed')
 record={'published':True,'release':NAME,'sourceCommit':release['sourceCommit'],'baseCommit':release['baseCommit'],'module':result,'backup':backup,'after':after,'freeBytesAfter':shutil.disk_usage(LIVE).free,'hostRestarted':False,'databaseTouched':False,'otherModulesPreserved':True}
 (ROOT/'published.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
if __name__=='__main__':main()
