import json,hashlib,subprocess,os,time
from pathlib import Path
P=Path('/opt/royal');roots=['src','server','public','scripts','docs','games'];inputs=['Dockerfile','.dockerignore','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.finance.json','vite.config.ts','deployment/SERVER.md']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(a):return subprocess.check_output(a,text=True).strip()
def runtime_fingerprint(config):
 rows=config.get('Env',[]);variables=dict(x.split('=',1) for x in rows if '=' in x)
 assert len(variables)==len(rows), 'Duplicate or malformed environment entries'
 runtime={k:config.get(k) for k in ['User','WorkingDir','Entrypoint','Cmd']}
 runtime['Env']=variables
 return hashlib.sha256(json.dumps(runtime,sort_keys=True).encode()).hexdigest()
def inventory():
 out={}
 for name in inputs:
  p=P/name
  if p.is_file() and not p.is_symlink():out[name]=sha(p)
 for root in roots:
  for p in sorted((P/root).rglob('*')):
   if p.is_file() and not p.is_symlink() and not any(x.startswith(('._','.env')) or x in {'node_modules','__pycache__','data','secrets','.DS_Store'} for x in p.relative_to(P).parts):out[str(p.relative_to(P))]=sha(p)
 return out
raw=json.loads(run(['docker','inspect','royal-game-1']))[0];config=raw['Config'];labels=config.get('Labels',{})
listed=run(['docker','ps','--format','{{.ID}}\t{{.Names}}']).splitlines()
ids=[line.split('\t')[0] for line in listed if '/'+line.split('\t')[1] not in {'/royal-nile-account-views-once','/royal-nile-reconcile-once'}]
containers=json.loads(run(['docker','inspect',*ids]));services={x['Name']:{'id':x['Id'],'image':x['Image'],'startedAt':x['State']['StartedAt']} for x in containers}

env=dict(x.split('=',1) for x in config.get('Env',[]) if '=' in x)
node="const f=require('fs'),p=require('path'),c=require('crypto'),o={};function walk(d){for(const n of f.readdirSync(d).sort()){const x=p.join(d,n),s=f.lstatSync(x);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory())walk(x);else if(s.isFile())o[p.relative('/app',x)]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex');}}walk('/app/dist');walk('/app/dist-server');for(const n of ['package.json','package-lock.json'])o[n]=c.createHash('sha256').update(f.readFileSync('/app/'+n)).digest('hex');console.log(JSON.stringify(o))"
program=json.loads(run(['docker','exec','royal-game-1','node','-e',node]));prepared=run(['docker','image','inspect','royal-game:latest','--format','{{.Id}}']);preparedProgram=json.loads(run(['docker','run','--rm','--network=none','--read-only','--entrypoint','node',prepared,'-e',node]))
assert preparedProgram==program,'prepared image does not preserve current hot client'
backupDir=Path('/opt/royal-finance-backups');backups=[]
for p in sorted(backupDir.glob('finance-*.dump.json'))[-2:]:
 j=json.loads(p.read_text());dump=backupDir/j['file'];restore=dump.with_suffix('.restore-check.json');backups.append({'metadataPath':str(p),'metadataSha256':sha(p),'file':j.get('file'),'bytes':j.get('bytes'),'sha256':j.get('sha256'),'created_at':j.get('created_at'),'scope':j.get('scope'),'metadataKeys':list(j),'restoreCandidates':[str(x) for x in backupDir.glob(j['file']+'*') if x!=dump]})
settings={name:sha(P/name) for name in ['.env','compose.yaml','compose.override.yaml','compose.payments.yaml','compose.mira.yaml']}
host={k:raw['HostConfig'].get(k) for k in ['CpuShares','Memory','MemoryReservation','MemorySwap','NanoCpus','CpuPeriod','CpuQuota','CpusetCpus','RestartPolicy','PortBindings','ReadonlyRootfs','NetworkMode','CapAdd','CapDrop','SecurityOpt','Privileged','Ulimits','Dns','ExtraHosts','GroupAdd','PidsLimit']}
stat=os.statvfs(P)
print(json.dumps({'at':time.time(),'source':inventory(),'configHashes':settings,'container':{'id':raw['Id'],'image':raw['Image'],'startedAt':raw['State']['StartedAt'],'health':raw['State'].get('Health',{}).get('Status'),'runtimeHash':runtime_fingerprint(config),'mounts':sorted(raw['Mounts'],key=lambda m:m['Destination']),'host':host,'composeFiles':labels.get('com.docker.compose.project.config_files')},'preparedImage':prepared,'program':program,'services':services,'realMoneyFlags':{k:env.get(k,'false') for k in ['NOWPAYMENTS_ENABLED','NOWPAYMENTS_GAMES_ENABLED','NOWPAYMENTS_WITHDRAWALS_ENABLED']},'backups':backups,'availableBytes':stat.f_bavail*stat.f_frsize,'totalBytes':stat.f_blocks*stat.f_frsize},indent=2))
