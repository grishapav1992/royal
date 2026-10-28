/** Local verification uses disposable accounts and PostgreSQL, with the real host wallet routes. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer,type Plugin} from 'vite';
import {temporaryDatabase} from './database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';
import {DemoWalletStore,WalletError} from '../server/demoWallet';

const database=await temporaryDatabase();
const apiPort=2784,webPort=5384,api=`http://127.0.0.1:${apiPort}`;
const environment={...process.env,...database.env,PORT:String(apiPort),AUTH_DB_PATH:'roulette_host_test',PUBLIC_ORIGIN:''};
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});
let log='',stopping=false,db:PostgresDatabase|undefined,wallet:DemoWalletStore;
backend.stdout.on('data',bytes=>{log=(log+bytes).slice(-5000);});backend.stderr.on('data',bytes=>{log=(log+bytes).slice(-5000);});
const plugin:Plugin={name:'roulette-local-fixture-funds',configureServer(vite){
 vite.middlewares.use(async(req,res,next)=>{
  if(req.url!=='/__test/roulette/fund'||req.method!=='POST'){next();return;}
  try{
   const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie||''}}).then(r=>r.json());
   if(!identity.account)throw new WalletError(401,'Enter the local hall first');
   if(!db){db=new PostgresDatabase('roulette_host_test',{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
   const result=await wallet.operate(identity.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.statusCode=error instanceof WalletError?error.status:500;res.end(JSON.stringify({error:error instanceof Error?error.message:'Fixture failed'}));}
 });
}};
const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'artifacts/work/roulette-visual/vite-cache',plugins:[plugin],optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**']},proxy:{'/api':api,'/game-modules':api,'/multiplayer':{target:api,ws:true,rewrite:p=>p.replace(/^\/multiplayer/,'')}}}});
async function stop(){
 if(stopping)return;stopping=true;await vite.close();await db?.close();backend.kill();
 if(backend.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);backend.once('exit',()=>{clearTimeout(timer);resolve();});});
 await database.cleanup();
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().then(()=>process.exit(0));});
try{
 let ready=false;
 for(let i=0;i<150;i++){
  if(backend.exitCode!==null)throw Error('Local backend exited: '+log);
  try{if((await fetch(api+'/healthz')).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 if(!ready)throw Error('Local backend did not start: '+log);
 await vite.listen();console.log(`Roulette local host ready: http://127.0.0.1:${webPort}`);
}catch(error){await stop();throw error;}
