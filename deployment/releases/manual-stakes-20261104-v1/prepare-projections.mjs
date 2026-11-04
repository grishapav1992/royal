import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const folder='deployment/releases/manual-stakes-20261104-v1';
const snapshot=JSON.parse(fs.readFileSync(process.argv[2]));
const published=JSON.parse(fs.readFileSync(process.argv[3]));
const current=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const git=(...args)=>execFileSync('git',args,{maxBuffer:128*1024**2,stdio:['ignore','pipe','ignore']});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const origin=(name,commit,bytes)=>{const hash=digest(canonical(bytes));return {commit,path:name,baseSha256:hash,sha256:hash};};
const changed=git('diff','--name-only','b730f386','6f941f5e440f3ef7e86d0582e85a260fcf52ea80').toString().trim().split('\n');
const files={};
const candidates=git('ls-files','deployment').toString().trim().split('\n').filter(n=>/(?:projection|origins).*\.json$/.test(n));
function inspect(value){
  if(!value||typeof value!=='object')return;
  if(value.commit&&value.path&&value.sha256&&snapshot.source[value.path]&&(value.sha256===snapshot.source[value.path]||value.sha256===snapshot.sourceLF[value.path]))files[value.path]=value;
  else for(const v of Object.values(value))inspect(v);
}
for(const file of candidates){try{inspect(JSON.parse(fs.readFileSync(file)));}catch{}}
const baselineOrigins={...files};
const needed=Object.keys(snapshot.source).filter(n=>/^(src|server|games)\/.*\.(?:ts|js|mjs|json|css)$/.test(n)||['index.html','package.json','tsconfig.json'].includes(n));
for(const name of needed){
  const bytes=fs.existsSync(name)?fs.readFileSync(name):undefined;
  if(bytes&&(changed.includes(name)||digest(canonical(bytes))===snapshot.sourceLF[name])){files[name]=origin(name,current,bytes);continue;}
  if(files[name])continue;
  const commits=git('log','--all','--format=%H','--',name).toString().trim().split('\n');
  for(const commit of commits){try{const raw=git('show',commit+':'+name);if(digest(canonical(raw))===snapshot.sourceLF[name]){files[name]=origin(name,commit,raw);break;}}catch{}}
  assert(files[name],'Production source has no verified Git origin: '+name);
}
for(const name of changed)if(/^(src|server|games)\/.+\.(?:ts|json|css)$/.test(name))files[name]=origin(name,current,git('show',current+':'+name));
// Preserve the current host services. The unpublished Flag Tote import is not part of this release.
const runtime=files['src/modules/GameHostRuntime.ts'];
const old=JSON.parse(fs.readFileSync('deployment/releases/remove-hall-title-20261103-v1/host-projection.json')).files['src/modules/GameHostRuntime.ts'];
const raw=canonical(git('show',old.commit+':'+old.path));
const from='apiVersion: 1, expansionClient',to='apiVersion: 1, manualStakes: 1, expansionClient';
assert.equal(raw.toString().split(from).length,2);
files['src/modules/GameHostRuntime.ts']={...old,patches:[...(old.patches??[]),{from,to}],sha256:digest(Buffer.from(raw.toString().replace(from,to)))};
const registry=JSON.parse(fs.readFileSync('scripts/game-math/rtp-policy.json'));
const ids=new Set(Object.keys(registry.stakePolicies).filter(g=>g!=='tsu-e-fa'));
const games=fs.readdirSync('games').filter(slug=>{try{return ids.has(JSON.parse(fs.readFileSync('games/'+slug+'/package.json')).gameId);}catch{return false;}});
assert.equal(games.length,19);
const assets={};
for(const [name,hash]of Object.entries(snapshot.source))if(/^(?:public\/assets\/|games\/.*\/assets\/)/.test(name)&&fs.existsSync(name)){
  const bytes=fs.readFileSync(name),actual=digest(bytes);
  if(actual===hash||digest(canonical(bytes))===hash)assets[name]=hash;
}
for(const id of ids){
  const record=published[id];assert(record,'Missing published game manifest: '+id);
  assert.equal(record.pointerSha256,snapshot.moduleFiles['/opt/royal-game-modules/'+id+'/active.json']);
  for(const [name,hash]of Object.entries(record.manifest.files))if(name.startsWith('media/')){
    const source='public/assets/'+name.slice(6);assert(fs.existsSync(source),'Published media missing locally: '+source);
    const bytes=fs.readFileSync(source);assert(digest(bytes)===hash||digest(canonical(bytes))===hash,'Published media differs locally: '+source);assets[source]=hash;
  }
}
const base={format:1,productionCommit:snapshot.sourceCommit,files};
fs.writeFileSync(folder+'/host-projection.json',JSON.stringify({...base,entries:['index.html'],moduleGames:games,moduleAssets:assets,moduleContracts:snapshot.moduleHost.games},null,2)+'\n');
fs.writeFileSync(folder+'/backend-projection.json',JSON.stringify({...base,entries:['server/index.ts']},null,2)+'\n');
const beforeFiles={...files};
for(const name of changed){if(!snapshot.source[name]||!beforeFiles[name])continue;
  if(digest(canonical(git('show','b730f386:'+name)))===snapshot.sourceLF[name])beforeFiles[name]=origin(name,'b730f3867da97eaf698aa3779ed3857e36ebadf5',git('show','b730f386:'+name));
  else if(baselineOrigins[name])beforeFiles[name]=baselineOrigins[name];
  else for(const commit of git('log','--all','--format=%H','--',name).toString().trim().split('\n')){
    try{const raw=git('show',commit+':'+name);if(digest(canonical(raw))===snapshot.sourceLF[name]){beforeFiles[name]=origin(name,commit,raw);break;}}catch{}
  }
}
beforeFiles['src/modules/GameHostRuntime.ts']=old;
for(const [name,hash]of Object.entries(snapshot.sourceLF))if(beforeFiles[name])assert.equal(beforeFiles[name].sha256,hash,'Old production origin differs: '+name);
const nativeEntries=['scripts/finance-nile-play.ts','scripts/finance-nile-play-proof.ts','server/finance/nile-game-runtime.ts'];
for(const name of nativeEntries)if(!files[name]){
  const p=JSON.parse(fs.readFileSync('deployment/releases/star-spin-20261103-v1/native-projection.json')).files[name];
  assert(p&&(p.sha256===snapshot.source[name]||p.sha256===snapshot.sourceLF[name]));files[name]=p;beforeFiles[name]=p;
}
fs.writeFileSync(folder+'/native-before-projection.json',JSON.stringify({...base,entries:nativeEntries,files:beforeFiles},null,2)+'\n');
fs.writeFileSync(folder+'/native-projection.json',JSON.stringify({...base,entries:nativeEntries},null,2)+'\n');
const expectedSources=Object.fromEntries(Object.entries(files).filter(([n,row])=>snapshot.source[n]&&row.sha256!==snapshot.sourceLF[n]).map(([n,row])=>[n,row.sha256]));
for(const name of changed)if(/^(src|server|games)\/.+\.(?:ts|json|css)$/.test(name)&&!snapshot.source[name])expectedSources[name]=files[name].sha256;
fs.writeFileSync(folder+'/scope.json',JSON.stringify({format:1,baseCommit:snapshot.sourceCommit,expectedSources,moduleGames:games,addedGames:[],restoredGames:[]},null,2)+'\n');
console.log(JSON.stringify({base:snapshot.sourceCommit,origins:Object.keys(files).length,changedSources:Object.keys(expectedSources).length,games,assets:Object.keys(assets).length}));
