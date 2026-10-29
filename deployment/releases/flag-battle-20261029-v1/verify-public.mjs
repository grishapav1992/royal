import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [manifestPath,reportPath]=process.argv.slice(2);
assert(manifestPath&&reportPath);
const m=JSON.parse(readFileSync(manifestPath));
const origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const urls=new Map();
for(const [file,hash] of Object.entries(m.dist))urls.set('/'+file,hash);
for(const [file,hash] of Object.entries(m.modules))urls.set('/game-modules/'+file,hash);
for(const [file,hash] of Object.entries(m.before.modules))if(file.endsWith('/active.json'))urls.set(file.replace('/opt/royal-game-modules/','/game-modules/'),hash);
const rows=[...urls.entries()],checks=[];let cursor=0;
await Promise.all(Array.from({length:4},async()=>{
 while(cursor<rows.length){
  const [path,expected]=rows[cursor++];
  const response=await fetch(origin+path+'?flagRelease='+m.sourceCommit,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,path);
  const hash=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  assert.equal(hash,expected,path);checks.push({path,sha256:hash});
 }
}));
for(const [path,status] of [['/healthz',200],['/api/game-wallet',401],['/api/game-wallet/expansion',401],['/api/demo-wallet',410]]){
 const response=await fetch(origin+path,{headers:{'X-Royal-Flag-Battle':'2'},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,status,path);checks.push({path,status});await response.body?.cancel();
}
writeFileSync(reportPath,JSON.stringify({at:new Date().toISOString(),sourceCommit:m.sourceCommit,origin,passed:checks.length,checks,productionAccountsCreated:false,productionWagers:false},null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,sourceCommit:m.sourceCommit}));
