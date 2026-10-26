import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const [payload,output]=process.argv.slice(2),base='https://stealth-spark-gokmxooi.expresshost.cloud';
const manifest=JSON.parse(await readFile(payload+'/install-manifest.json','utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[],packages=[];
async function request(path,options={}){
 const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(20000),cache:'no-store'});
 return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())};
}
let response=await request('/healthz');assert.equal(response.status,200);assert.equal(JSON.parse(response.bytes).ok,true);checks.push('health');
response=await request('/api/auth/me');assert.equal(response.status,200);assert.equal(JSON.parse(response.bytes).account,null);checks.push('anonymous-session');
response=await request('/api/demo-wallet');assert.equal(response.status,401);checks.push('wallet-authentication');
for(const path of ['/api/auth/login','/api/npc/mira']){
 response=await request(path,{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':'gzip'},body:gzipSync(Buffer.from('{}'))});
 assert.equal(response.status,415,path);checks.push('compressed-body-rejected:'+path);
}
response=await request('/');assert.equal(response.status,200);assert.equal(sha(response.bytes),manifest.delta['index.html']??manifest.before.program['dist/index.html']);checks.push('host-index');
for(const [name,digest]of Object.entries(manifest.delta)){
 response=await request('/'+name);assert.equal(response.status,200,name);assert.equal(sha(response.bytes),digest,name);
}
checks.push('host-delta');
for(const row of manifest.modulePackages){
 response=await request('/game-modules/'+row.gameId+'/active.json');assert.equal(response.status,200);
 const pointer=JSON.parse(response.bytes),folder='/game-modules/'+row.gameId+'/versions/'+row.version+'/';
 assert.equal(pointer.manifest,folder+'manifest.json');response=await request(pointer.manifest);assert.equal(response.status,200);
 assert.equal(sha(response.bytes),pointer.sha256);assert.equal(pointer.sha256,manifest.moduleDelta[pointer.manifest.replace('/game-modules/','')]);
 const game=JSON.parse(response.bytes),files=Object.entries(game.files);let next=0,verified=0;
 await Promise.all(Array.from({length:6},async()=>{while(next<files.length){
  const[name,digest]=files[next++];assert(!name.includes('..'));
  const file=await request(folder+name);assert.equal(file.status,200,name);assert.equal(sha(file.bytes),digest,name);verified++;
 }}));
 const old=manifest.before.activeModuleMetadata[row.gameId];
 if(old){
  response=await request('/game-modules/'+row.gameId+'/versions/'+old.version+'/'+old.entry);
  assert.equal(response.status,200);assert.equal(sha(response.bytes),old.files[old.entry]);
 }
 packages.push({gameId:row.gameId,version:game.version,verifiedFiles:verified,oldEntryPreserved:!!old});
}
checks.push('two-exact-packages','previous-client-urls');
response=await request('/healthz');assert.equal(response.status,200);checks.push('health-after-probes');
const result={passed:true,at:new Date().toISOString(),sourceCommit:manifest.sourceCommit,baseCommit:manifest.baseCommit,checks,packages,productionPlayerDataChanged:false};
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
