import fs from 'node:fs';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const payload=process.argv[2],out=process.argv[3],m=JSON.parse(fs.readFileSync(payload+'/install-manifest.json'));
const origin='https://stealth-spark-gokmxooi.expresshost.cloud',hash=b=>createHash('sha256').update(b).digest('hex'),report={sourceCommit:m.sourceCommit,origin,files:[],checks:[],productionAccountsCreated:false,productionBetsPlaced:false};
async function get(path){const response=await fetch(origin+path,{headers:{'Cache-Control':'no-cache'}});return{response,bytes:Buffer.from(await response.arrayBuffer())};}
const expected=Object.fromEntries(Object.entries(m.delta).map(([n,h])=>['/'+n,h]));
for(const[game,p]of Object.entries(m.packages)){expected['/game-modules/'+game+'/active.json']=p.pointerSha256;for(const[n,h]of Object.entries(p.files))expected['/game-modules/'+game+'/versions/'+p.version+'/'+n]=h;}
const queue=Object.entries(expected);let next=0;await Promise.all(Array.from({length:8},async()=>{while(next<queue.length){const[path,digest]=queue[next++],{response,bytes}=await get(path+'?verify='+m.sourceCommit);assert.equal(response.status,200,path);assert.equal(hash(bytes),digest,path);report.files.push({path,sha256:digest,bytes:bytes.length});}}));
for(const[path,status]of [['/healthz',200],['/api/game-wallet',410],['/api/nile-play',410],['/api/demo-wallet',401],['/api/demo-wallet/expansion',401]]){const{response}=await get(path);assert.equal(response.status,status,path);report.checks.push({path,status});}
const home=await get('/');assert.equal(home.response.status,200);assert.equal(hash(home.bytes),m.delta['index.html']);report.defaultEntryVerified=true;
report.passed=true;report.fileCount=report.files.length;report.bytes=report.files.reduce((sum,r)=>sum+r.bytes,0);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,files:report.fileCount,bytes:report.bytes,checks:report.checks}));
