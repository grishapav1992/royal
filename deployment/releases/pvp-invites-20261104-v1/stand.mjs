import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {temporaryDatabase} from '../../../scripts/database-test.ts';

const root=process.cwd(),task=path.resolve('artifacts/work/pvp-invite-simplify/release');
const before=JSON.parse(fs.readFileSync(path.join(task,'before.json')));
const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json'));
const published=JSON.parse(fs.readFileSync(path.join(task,'published-package.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const file of ['dist/index.html','dist-server/index.js'])assert.equal(sha(fs.readFileSync(file)),release.files[file]);
assert.equal(release.baseCommit,before.sourceCommit);assert(release.build.passed);
const database=await temporaryDatabase(),apiPort=5195,webPort=5193,api='http://127.0.0.1:'+apiPort;
const environment={...process.env,...database.env,AUTH_DB_PATH:'pvp_release_stand',PORT:String(apiPort),PUBLIC_ORIGIN:'',NILE_PLAY_SOCKET_FILE:''};
Object.assign(process.env,database.env);
const log=fs.openSync(path.join(task,'stand.log'),'w');
const backend=spawn(process.execPath,['dist-server/index.js'],{cwd:root,env:environment,stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
let gateway,stopping=false;
const media=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
function respond(res,bytes,name){res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);}
async function stop(){
 if(stopping)return;stopping=true;gateway?.closeAllConnections();gateway?.close();
 if(backend.exitCode===null){backend.kill();await new Promise(resolve=>{backend.once('exit',resolve);setTimeout(resolve,5000);});}
 await database.cleanup();
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().then(()=>process.exit(0));});
process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')void stop().then(()=>process.exit(0));});
try{
 let healthy=false;
 for(let n=0;n<150;n++){
  assert.equal(backend.exitCode,null,'Compiled backend exited');
  healthy=await fetch(api+'/healthz').then(response=>response.ok).catch(()=>false);if(healthy)break;
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert(healthy,'Compiled backend did not become healthy');
 const {PostgresDatabase,databaseConfig}=await import('../../../server/database.ts');
 const {DemoWalletStore}=await import('../../../server/demoWallet.ts');
 const db=new PostgresDatabase('pvp_release_stand',{existingSchema:true,config:databaseConfig(environment)});
 try{
  const wallet=new DemoWalletStore(db);await wallet.ready;
  for(const [email,skin,name]of [['pvp-local-a@example.test',0,'Анна'],['pvp-local-b@example.test',1,'Борис']]){
   const login=await fetch(api+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'test-password!'})});assert(login.ok);
   const cookie=login.headers.get('set-cookie').split(';')[0],identity=await login.json();
   const select=await fetch(api+'/api/auth/character',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({skin,name})});assert(select.ok,await select.text());
   await wallet.operate(identity.account.id,{id:randomUUID(),kind:'deposit',amount:200});
  }
 }finally{await db.close();}
 gateway=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1'),name=decodeURIComponent(url.pathname).slice(1);
   assert(!name.split('/').some(part=>part==='..'||part==='.'),'Unsafe stand URL');
   if(req.method==='GET'&&url.pathname.startsWith('/game-modules/tsu-e-fa/')){
    assert(published.files[url.pathname],'Unreviewed module request');
    const bytes=fs.readFileSync(path.join(task,'published-modules',name.slice('game-modules/'.length)));assert.equal(sha(bytes),published.files[url.pathname]);respond(res,bytes,name);return;
   }
   if(req.method==='GET'&&before.program['dist/'+name]&&!fs.existsSync(path.join(root,'dist',name))){
    const expected=before.program['dist/'+name];let bytes=media.get(name);
    if(!bytes){
     const local=path.join(root,'public',name);
     if(fs.existsSync(local)&&sha(fs.readFileSync(local))===expected)bytes=fs.readFileSync(local);
     else{const response=await fetch('https://stealth-spark-gokmxooi.expresshost.cloud/'+name,{signal:AbortSignal.timeout(45000)});assert(response.ok);bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),expected,'Production media differs: '+name);}
     media.set(name,bytes);
    }
    respond(res,bytes,name);return;
   }
   const request=http.request(api+req.url,{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});request.on('error',()=>{res.statusCode=502;res.end();});req.pipe(request);
  }catch(error){console.error(error.message);res.statusCode=500;res.end('Stand input validation failed');}
 });
 gateway.on('upgrade',(req,socket,head)=>{
  const out=net.connect(apiPort,'127.0.0.1',()=>{
   out.write(req.method+' '+req.url.replace(/^\/multiplayer/,'')+' HTTP/'+req.httpVersion+'\r\n'+req.rawHeaders.reduce((text,value,index)=>text+value+(index%2?'\r\n':': '),'')+'\r\n');
   if(head.length)out.write(head);socket.pipe(out);out.pipe(socket);
  });out.on('error',()=>socket.destroy());socket.on('error',()=>out.destroy());
 });
 await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(webPort,'127.0.0.1',resolve);});
 fs.writeFileSync(path.join(task,'stand-identity.json'),JSON.stringify({pid:process.pid,backendPid:backend.pid,databaseDirectory:database.directory,sourceCommit:release.sourceCommit,backendSha256:release.files['dist-server/index.js'],clientIndexSha256:release.files['dist/index.html'],publishedModule:published.version,productionBalancesChanged:false},null,2)+'\n');
 console.log('Verified production projection and unchanged Tsu package ready on '+webPort);
}catch(error){await stop();throw error;}
