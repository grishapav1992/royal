/** Real local host, disposable accounts/database and unchanged production game routes. */
import { spawn } from 'node:child_process';
import { createServer as createSocket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import { createServer } from 'vite';
import { temporaryDatabase } from './database-test';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import {layoutSlots,layoutBonusSeed,layoutDraw} from './game-layout-scenarios';
import {layoutIframes,layoutIframeSeed} from './game-layout-iframe-scenarios';
import {layoutSeries,layoutSeriesSeed} from './game-layout-series-scenarios';

const apiPort=Number(process.env.LAYOUT_API_PORT||2968),webPort=Number(process.env.LAYOUT_WEB_PORT||5468);
await Promise.all([apiPort,webPort].map(port=>new Promise<void>((resolve,reject)=>{
 const socket=createSocket();socket.once('error',reject);socket.listen(port,'127.0.0.1',()=>socket.close(error=>error?reject(error):resolve()));
})));
const artifacts=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-stage2';
await mkdir(artifacts,{recursive:true});
await writeFile(artifacts+'/owner.json',JSON.stringify({owner:process.env.LAYOUT_TASK_ID||'game-layout-stage2',purpose:'Audit and verify approved active games in the real host, both phone orientations and desktop',cleanupCondition:'Stop the stand and temporary database; retain compact results and final screenshots only'},null,2));
const database=await temporaryDatabase(),api='http://127.0.0.1:'+apiPort,schema='layout_stage2';
const environment={...process.env,...database.env,PORT:String(apiPort),AUTH_DB_PATH:schema,PUBLIC_ORIGIN:''};
const backend=spawn(process.execPath,process.env.LAYOUT_BUILT_BACKEND==='1'?['dist-server/index.js']:['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
let log='',stopping=false,db:PostgresDatabase|undefined,wallet:DemoWalletStore;
const scenarios=new Map<string,DemoExpansionStore>();
backend.stdout.on('data',bytes=>{log=(log+bytes).slice(-4000);});backend.stderr.on('data',bytes=>{log=(log+bytes).slice(-4000);});
const vite=await createServer({configFile:false,root:process.cwd(),optimizeDeps:{entries:['index.html']},
 plugins:[{name:'layout-local-fixtures',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const path=new URL(req.url||'/',api).pathname;
  if(process.env.LAYOUT_BUILT==='1'&&(req.method==='GET'||req.method==='HEAD')){
   const base=resolve('dist'),file=resolve(base,path==='/'?'index.html':decodeURIComponent(path).slice(1));
   if(file.startsWith(base+sep))try{
    const bytes=await readFile(file),mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:bytes);return;
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  if(process.env.LAYOUT_SCENARIOS==='1'&&req.method==='POST'&&(path==='/__test/layout/bonus'||path==='/api/demo-wallet/expansion')){
   try{
    const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie||''}}).then(reply=>reply.json());
    if(!identity.account)throw Error('Sign in to the local fixture');
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw Error('Oversized fixture request');}
    const body=JSON.parse(raw),account=identity.account.id,key=account+':'+body.gameId;
    if(path==='/__test/layout/bonus'){
     if(!layoutSlots.includes(body.gameId)&&!layoutIframes.includes(body.gameId)&&!layoutSeries.includes(body.gameId))throw Error('Unsupported fixture game');
     if(!db){db=new PostgresDatabase(schema,{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
     const seed=layoutSeries.includes(body.gameId)?layoutSeriesSeed():layoutIframes.includes(body.gameId)?layoutIframeSeed(body.gameId,body.scenario==='legacy'):layoutBonusSeed(body.gameId);scenarios.set(key,new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},layoutDraw(seed)));
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify({seed,gameId:body.gameId,naturalBonus:true}));return;
    }
    const store=scenarios.get(key);
    if(store){
     if(req.headers[WALLET_ACCOUNT_HEADER.toLowerCase()]!==account)throw Error('Fixture account mismatch');
     const result=await store.operate(account,body,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2,false);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    // Preserve the real backend and its validation for all ordinary unseeded rounds.
    const reply=await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:req.headers.cookie||'',...Object.fromEntries(Object.entries(req.headers).filter(([name,value])=>name.startsWith('x-royal-')&&typeof value==='string'))},body:raw});
    res.statusCode=reply.status;res.setHeader('Content-Type','application/json');res.end(await reply.text());return;
   }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error instanceof Error?error.message:'Fixture failed'}));return;}
  }
  if(path==='/__test/layout/stop'&&req.method==='POST'){res.end('stopping');void stop().then(()=>process.exit(0));return;}
  if(path!=='/__test/layout/topup'){next();return;}
  try{
   if(req.method!=='POST')throw Error('POST required');
   const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie||''}}).then(reply=>reply.json());
   if(!identity.account)throw Error('A disposable signed-in account is required');
   if(!db){db=new PostgresDatabase(schema,{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
   const result=await wallet.operate(identity.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error instanceof Error?error.message:'Local fixture failed'}));}
 });}}],server:{host:'127.0.0.1',port:webPort,strictPort:true,
  watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**']},
  proxy:{'/api':api,'/game-modules':api,'/multiplayer':{target:api,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}},
});
async function stop(){
 if(stopping)return;stopping=true;await vite.close();await db?.close();backend.kill();
 if(backend.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);backend.once('exit',()=>{clearTimeout(timer);resolve();});});
 await database.cleanup();
}
process.once('SIGINT',()=>{void stop().then(()=>process.exit(0));});process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0));});
try{
 let ready=false;
 for(let attempt=0;attempt<150;attempt++){
  if(backend.exitCode!==null)throw Error('Owned backend stopped: '+log);
  ready=await fetch(api+'/healthz').then(reply=>reply.ok).catch(()=>false);if(ready)break;
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 if(!ready)throw Error('Backend readiness failed: '+log);
 await vite.listen();
 await writeFile(artifacts+'/runtime.json',JSON.stringify({apiPort,webPort,pid:process.pid,backendPid:backend.pid,temporaryDatabase:database.directory},null,2));
 console.log('Game layout host ready: http://127.0.0.1:'+webPort);
}catch(error){await stop();throw error;}
