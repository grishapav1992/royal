/** Disposable full-host verification. Production has no fixture endpoints or forced outcomes. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer,type Plugin} from 'vite';
import {temporaryDatabase} from './database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';
import {DemoWalletStore,WalletError} from '../server/demoWallet';
import {WILD_NUDGE_GAME,WILD_NUDGE_CLIENT_HEADER} from '../src/shared/wildNudge';
const database=await temporaryDatabase(),webPort=Number(process.env.NUDGE_WEB_PORT||5237),apiPort=Number(process.env.NUDGE_API_PORT||2637),api='http://127.0.0.1:'+apiPort;
const environment={...process.env,...database.env,PORT:String(apiPort),AUTH_DB_PATH:'wild_nudge_preview',PUBLIC_ORIGIN:''};
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
let logs='',stopping=false,db:PostgresDatabase|undefined,wallet:DemoWalletStore;
const forced=new Map<string,number[]>();
backend.stdout.on('data',v=>logs=(logs+v).slice(-6000));backend.stderr.on('data',v=>logs=(logs+v).slice(-6000));
const scenarios:Record<string,number[]>={loss:[30,30,30,30,30],nudge:[1,2,62,63,30],bonus:[2,45,2,16,14,...Array(40).fill(30)],maximum:[2,45,2,16,14,...Array(40).fill(2)],win:[2,2,2,2,2]};
const plugin:Plugin={name:'wild-nudge-local-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const path=new URL(req.url||'/',api).pathname;
 if(path==='/__test/nudge/stop'&&req.method==='POST'){res.end('stopping');void stop().then(()=>process.exit(0));return;}
 const fixture=path.startsWith('/__test/nudge/');
 if(!fixture&&!(path==='/api/demo-wallet/expansion'&&req.method==='POST')){next();return;}
 try{
  const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie||''}}).then(r=>r.json());if(!identity.account)throw new WalletError(401,'Войди в зал.');const account=identity.account.id;
  if(!fixture&&!forced.has(account)){next();return;}
  if(req.headers.origin&&new URL(req.headers.origin).origin!==new URL('http://127.0.0.1:'+webPort).origin)throw new WalletError(403,'Unexpected local origin');
  if(req.headers['x-royal-account-id']&&req.headers['x-royal-account-id']!==account)throw new WalletError(401,'Account changed');
  let text='';if(req.method==='POST')for await(const part of req){text+=part;if(text.length>8192)throw new WalletError(413,'Too large');}const body=text?JSON.parse(text):{};
  if(!db){db=new PostgresDatabase('wild_nudge_preview',{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);await wallet.ready;}
  let reply:unknown;
  if(path==='/__test/nudge/topup'&&req.method==='POST'){const amount=body.amount??1000;if(!Number.isSafeInteger(amount)||amount<1||amount>10000)throw Error('Invalid fixture credit');reply=await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount});}
  else if(path==='/__test/nudge/scenario'&&req.method==='POST'){const tickets=scenarios[body.name];if(!tickets)throw Error('Unknown scenario');forced.set(account,tickets.slice());reply={ready:true};}
  else if(path==='/api/demo-wallet/expansion'&&req.method==='POST'){
   if(body.gameId!==WILD_NUDGE_GAME)throw new WalletError(400,'Fixture only supports Galactic Reactor');const tickets=forced.get(account)!;
   const local=new DemoWalletStore(db,max=>{const ticket=tickets.length?tickets.shift()!:30;if(ticket>=max)throw Error('Fixture entropy mismatch');return ticket;});await local.ready;
   reply=await local.expansion.operate(account,body,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2,req.headers[WILD_NUDGE_CLIENT_HEADER.toLowerCase()]==='1');
   if((reply as any).session?.state==='settled')forced.delete(account);
  }else throw new WalletError(404,'Unknown fixture');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));
 }catch(error){res.statusCode=error instanceof WalletError?error.status:400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}
});}};
const vite=await createServer({configFile:false,root:process.cwd(),plugins:[plugin],optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**']},proxy:{'/api':api,'/game-modules':api,'/multiplayer':{target:api,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});
async function stop(){if(stopping)return;stopping=true;await vite.close();await db?.close();backend.kill();if(backend.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);backend.once('exit',()=>{clearTimeout(timer);resolve();});});await database.cleanup();}
process.once('SIGINT',()=>{void stop().then(()=>process.exit(0));});process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0));});
try{let ready=false;for(let i=0;i<200;i++){if(backend.exitCode!==null)throw Error(logs);ready=await fetch(api+'/healthz').then(r=>r.ok).catch(()=>false);if(ready)break;await new Promise(r=>setTimeout(r,200));}if(!ready)throw Error(logs);await vite.listen();
 const output='artifacts/work/wild-nudge-v1-20261030';await mkdir(output,{recursive:true});await writeFile(output+'/runtime.json',JSON.stringify({owner:'wild-nudge-v1-20261030',webPort,apiPort,pid:process.pid,backendPid:backend.pid,temporaryDatabase:database.directory,cleanupCondition:'Stop this owned preview and remove its temporary database after verification'},null,2)+'\n');console.log('Galactic Reactor full host ready: http://127.0.0.1:'+webPort);
}catch(error){await stop();throw error;}
