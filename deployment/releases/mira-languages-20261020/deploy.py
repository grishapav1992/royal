import json,hashlib,subprocess,os,time,tarfile,shutil,fcntl,sys
from pathlib import Path
ROOT=Path('/opt/royal-releases/mira-languages-20261020'); LIVE=Path('/opt/royal'); BACK=Path('/opt/royal-backups/mira-languages-20261020')
M=json.loads((ROOT/'manifest.json').read_text()); B=M['before']; changed=M['files']
def require(ok,why):
 if not ok:raise RuntimeError(why)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(args,**kwargs):return subprocess.check_output(args,text=True,**kwargs).strip()
def inspect():return json.loads(run(['docker','inspect','royal-game-1']))[0]
def program(image=None):
 code="const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){for(const n of f.readdirSync(d)){const x=p.join(d,n),s=f.lstatSync(x);if(s.isDirectory())walk(x);else o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
 args=['docker','run','--rm','--network=none','--read-only','--entrypoint','node',image,'-e',code] if image else ['docker','exec','royal-game-1','node','-e',code]
 return json.loads(run(args))
def atomic(p,data,mode=None):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);temp=p.with_name(p.name+'.mira-next');require(not temp.exists(),'Unexpected temporary file')
 temp.write_bytes(data);os.chmod(temp,mode if mode is not None else 0o644);temp.replace(p)
def envdict(raw):return dict(x.split('=',1) for x in raw['Config'].get('Env',[]) if '=' in x)
def ready():
 for _ in range(60):
  s=inspect()['State']
  if s.get('Health',{}).get('Status')=='healthy':return
  time.sleep(1)
 raise RuntimeError('Game is not healthy')
def compose(files):run(['docker','compose',*[arg for p in files for arg in ['-f',p]],'up','-d','--no-deps','--no-build','game'],cwd=LIVE)
def guard():
 for p,h in B['source'].items():require((LIVE/p).is_file() and sha(LIVE/p)==h,'Production source changed: '+p)
 for p,h in B['configHashes'].items():require(sha(LIVE/p)==h,'Production configuration changed: '+p)
 raw=inspect();require(raw['Image']==B['container']['image'] and raw['State']['StartedAt']==B['container']['startedAt'],'Running game changed')
 require(program()==B['program'],'Current runtime changed')
 require(run(['docker','image','inspect','royal-game:latest','--format','{{.Id}}'])==B['preparedImage'],'Prepared image changed')
 for p,h in changed.items():require(sha(ROOT/'source'/p)==h,'Payload changed: '+p)
 require(sha(ROOT/'index.js')==M['backendSha256'],'Backend changed')
 return raw
with (LIVE/'.client-presentation-deploy.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 raw=guard();require(not BACK.exists(),'Backup already exists');BACK.mkdir(mode=0o700)
 previous={p:(LIVE/p).read_bytes() if (LIVE/p).exists() else None for p in changed}
 with tarfile.open(BACK/'source.tar.gz','w:gz') as tar:
  for p,v in previous.items():
   if v is not None:tar.add(LIVE/p,arcname=p,recursive=False)
 (BACK/'before.json').write_text(json.dumps(B,indent=2)+'\n')
 run(['docker','tag',B['preparedImage'],'royal-game:before-mira-languages-20261020'])
 context=ROOT/'image';context.mkdir(exist_ok=True);shutil.copyfile(ROOT/'index.js',context/'index.js')
 (context/'Dockerfile').write_text('FROM '+B['preparedImage']+'\nCOPY --chown=node:node index.js /app/dist-server/index.js\nLABEL org.opencontainers.image.revision="'+M['gitCommit']+'"\n')
 with (ROOT/'build.log').open('w') as log:subprocess.run(['docker','build','--network=none','--pull=false','-t','royal-game:mira-languages-20261020',str(context)],check=True,stdout=log,stderr=subprocess.STDOUT)
 candidate=run(['docker','image','inspect','royal-game:mira-languages-20261020','--format','{{.Id}}'])
 expected={**B['program'],'dist-server/index.js':M['backendSha256']};require(program(candidate)==expected,'Candidate changes other runtime files')
 oldfiles=B['container']['composeFiles'].split(',')
 guard()
 try:
  for p in changed:atomic(LIVE/p,(ROOT/'source'/p).read_bytes())
  run(['docker','tag',candidate,'royal-game:latest']);compose(oldfiles);ready()
  current=inspect();oldenv=envdict(raw);newenv=envdict(current)
  require(newenv==oldenv,'Environment changed')
  require(sorted(current['Mounts'],key=lambda x:x['Destination'])==sorted(raw['Mounts'],key=lambda x:x['Destination']),'Mounts changed')
  critical=list(B['container']['host'])+['LogConfig','ReadonlyPaths','MaskedPaths','Devices','DeviceRequests']
  hostdiff=[k for k in critical if current['HostConfig'].get(k)!=raw['HostConfig'].get(k)]
  require(not hostdiff,'Container host settings changed: '+','.join(hostdiff))
  runtime_only_host_differences=[k for k in raw['HostConfig'] if current['HostConfig'].get(k)!=raw['HostConfig'].get(k)]
  require(current['Image']==candidate and program()==expected,'Published runtime differs')
  for p,h in B['source'].items():require(sha(LIVE/p)==changed.get(p,h),'Unrelated source changed: '+p)
  for p,h in B['configHashes'].items():
   require(sha(LIVE/p)==h,'Configuration changed: '+p)
  for name,state in B['services'].items():
   if name=='/royal-game-1':continue
   now=json.loads(run(['docker','inspect',name]))[0];require(now['Id']==state['id'] and now['Image']==state['image'] and now['State']['StartedAt']==state['startedAt'],'Another service restarted: '+name)
  result={'ok':True,'gitCommit':M['gitCommit'],'image':candidate,'backendSha256':M['backendSha256'],'languages':['ru','en'],'unchangedClientAndOtherPrograms':True,'existingEnvironmentAndMountsPreserved':True,'otherServicesPreserved':len(B['services'])-1,'health':'healthy','runtimeOnlyHostDifferences':runtime_only_host_differences,'backup':str(BACK)}
  (ROOT/'published.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 except BaseException:
  for p,data in previous.items():
   if data is None:(LIVE/p).unlink(missing_ok=True)
   else:atomic(LIVE/p,data)
  run(['docker','tag',B['preparedImage'],'royal-game:latest']);compose(oldfiles);ready()
  (ROOT/'rolled-back.json').write_text(json.dumps({'rolledBack':True,'databaseRestored':False})+'\n')
  raise
