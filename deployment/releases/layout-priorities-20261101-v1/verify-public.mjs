import fs from 'node:fs';
import crypto from 'node:crypto';
import {request} from '@playwright/test';
const folder='artifacts/work/layout-release-20261101',base=process.env.LAYOUT_PUBLIC_URL||'https://stealth-spark-gokmxooi.expresshost.cloud';
const payload=process.env.LAYOUT_PAYLOAD||folder+'/payload-retry',output=process.env.LAYOUT_HTTP_OUTPUT||folder+'/public-http.json',modulesOnly=process.argv.includes('--modules-only');
const manifest=JSON.parse(fs.readFileSync(payload+'/install-manifest.json'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const checks=[];
const http=await request.newContext({baseURL:base,timeout:45000});
async function get(url,hash){const r=await http.get(url);if(!r.ok())throw Error(url+' HTTP '+r.status());const bytes=Buffer.from(await r.body());if(digest(bytes)!==hash)throw Error(url+' bytes differ');checks.push({url,method:'GET',status:r.status(),sha256:hash});}
const jobs=[];
if(!modulesOnly)for(const [name,hash]of Object.entries(manifest.delta))jobs.push(()=>get('/'+name,hash));
for(const [game,row]of Object.entries(manifest.packages)){
 jobs.push(()=>get('/game-modules/'+game+'/active.json',row.pointerSha256));
 for(const [name,hash]of Object.entries(row.files))jobs.push(async()=>{
  const url='/game-modules/'+game+'/versions/'+row.version+'/'+name;
  if(/\.(?:js|css|json|svg)$/.test(name))return get(url,hash);
  const r=await http.head(url);if(!r.ok())throw Error(url+' HTTP '+r.status());
  const expected=fs.statSync(payload+'/packages/'+game+'/'+name).size;
  if(Number(r.headers()['content-length'])!==expected)throw Error(url+' length differs');
  checks.push({url,method:'HEAD',status:r.status(),bytes:expected});
 });
}
const health=await http.get('/healthz');if(!health.ok())throw Error('Health failed');
let next=0;await Promise.all(Array.from({length:3},async()=>{while(next<jobs.length)await jobs[next++]();}));
fs.writeFileSync(output,JSON.stringify({sourceCommit:manifest.sourceCommit,modulesOnly,at:new Date().toISOString(),healthy:true,checks},null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,get:checks.filter(x=>x.method==='GET').length,head:checks.filter(x=>x.method==='HEAD').length}));

await http.dispose();
