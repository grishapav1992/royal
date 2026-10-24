"""Package exact committed outputs against the current production fingerprint."""
from pathlib import Path
import hashlib,json,shutil,subprocess,sys

stage,before_path,out=map(Path,sys.argv[1:4])
release=json.loads((stage/'module-build/release-manifest.json').read_text())
before=json.loads(before_path.read_text());assert before['program']==before['preparedProgram']
assert before['container']['health']=='healthy' and release['githubVerified'] and release['build']['passed']
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=stage,text=True).strip()==release['sourceCommit']
assert not subprocess.check_output(['git','status','--porcelain'],cwd=stage,text=True).strip()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
lf=lambda p:hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
for name,digest in release['files'].items():assert sha(stage/name)==digest,name
out.mkdir(exist_ok=False,parents=True)
def copy(source,name):
 p=out/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,p);return sha(p)
changed={}
for root in ['src','server','public','scripts','docs','games']:
 for p in (stage/root).rglob('*'):
  if not p.is_file():continue
  name=p.relative_to(stage).as_posix()
  assert not p.is_symlink() and not any(n in ['node_modules','.git','data','secrets'] or n.startswith('.env') for n in p.relative_to(stage).parts)
  if lf(p)!=before['sourceLF'].get(name):changed[name]=copy(p,'source/'+name)
for name in ['package.json','package-lock.json','Dockerfile','.dockerignore','index.html','tsconfig.json','tsconfig.finance.json','vite.config.ts']:
 assert lf(stage/name)==before['sourceLF'][name], 'Unreviewed root build/dependency change: '+name

delta={}
for name,digest in release['files'].items():
 if not name.startswith('dist/') or digest==before['program'].get(name):continue
 n=name.removeprefix('dist/')
 if n in ['index.html','admin.html'] or n.startswith('assets/') and Path(n).suffix in ['.js','.css'] or n.startswith('assets/mortal-kombat/'):
  assert n in ['index.html','admin.html'] or name not in before['program'], 'Immutable asset collision: '+name
  delta[n]=copy(stage/name,'dist-delta/'+n)
 else:
  source=stage/'public'/n
  assert source.is_file() and lf(source)==before['sourceLF'].get('public/'+n), 'Unreviewed public asset: '+n
copy(stage/'dist-server/index.js','server-delta/index.js')
new_host=json.loads((stage/'module-dist/host-contracts.json').read_text());old_host=before['moduleHost']
assert {k:v for k,v in new_host.items() if k!='games'}=={k:v for k,v in old_host.items() if k!='games'}
assert new_host['games']=={**old_host['games'],'mortal-kombat':{'apiVersion':1,'rulesVersion':2,'progressVersion':1}},'Unexpected host contract transition'
packages=[];modules={}
for row in release['packages']:
 game,version=row['gameId'],row['version']
 if game not in {'mortal-kombat','hockey','pool','chess','durak','transfer-durak','crazy-eights'}:continue
 folder=stage/'module-dist'/game/'versions'/version
 # The snapshot contains the exact installed manifest and pointer, without player data.
 prior=before.get('activeModuleMetadata',{}).get(game)
 meta=json.loads((folder/'manifest.json').read_text())
 if prior and meta['files']==prior['files']:continue
 assert all(meta[k]==new_host['games'][game][k] for k in ['apiVersion','rulesVersion','progressVersion'])
 packages.append({'gameId':game,'version':version,'beforeSha256':before['moduleFiles'].get('/opt/royal-game-modules/'+game+'/active.json','none')})
 for p in folder.rglob('*'):
  if p.is_file():
   n=p.relative_to(stage/'module-dist').as_posix();modules[n]=copy(p,'modules/'+n)
copy(stage/'module-dist/host-contracts.json','host.json')
helpers=stage/'deployment/releases/mortal-kombat-virtual-20261024-v1'
for n in ['deploy.py','snapshot.py','modules.py']:copy(helpers/n,n)
copy(stage/'module-build/release-manifest.json','release-manifest.json')
m={'release':'mortal-kombat-virtual-20261024-v1','sourceCommit':release['sourceCommit'],'baseCommit':release['baseCommit'],'before':before,'changed':changed,'delta':delta,'serverDelta':{'index.js':sha(out/'server-delta/index.js')},'helperSha256':sha(out/'deploy.py'),'snapshotSha256':sha(out/'snapshot.py'),'modulesHelperSha256':sha(out/'modules.py'),'hostContractSha256':sha(out/'host.json'),'moduleDelta':modules,'modulePackages':packages}
(out/'install-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print(json.dumps({'sourceChanges':len(changed),'clientFiles':len(delta),'modulePackages':len(packages),'moduleBytes':sum((out/'modules'/n).stat().st_size for n in modules),'payloadBytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file())}))
