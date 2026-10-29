/** Disposable local Royal host for Flag Battle verification. Never loads project .env. */
import { spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer, type Plugin } from 'vite';
import { temporaryDatabase } from './database-test';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { FLAG_GAME, FLAG_HEADER, flagCapability } from '../src/shared/flagBattle';

async function currentDatabase(){
  if(!process.env.FLAG_PREVIEW_DATABASE_DIRECTORY)return temporaryDatabase();
  const directory=resolve(process.env.FLAG_PREVIEW_DATABASE_DIRECTORY),port=Number(process.env.PGPORT),password=process.env.PGPASSWORD;
  if(dirname(directory)!==resolve(tmpdir())||!basename(directory).startsWith('royal-pg-')||!Number.isInteger(port)||port<1024||port>65535||!password)throw Error('Invalid owned preview database');
  await access(resolve(directory,'PG_VERSION'));
  const postgres=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  await postgres.start();
  return {directory,env:{NODE_ENV:'test',DATABASE_URL:'',DATABASE_URL_FILE:'',PGHOST:'127.0.0.1',PGPORT:String(port),PGDATABASE:'royal_test',PGUSER:'postgres',PGPASSWORD:password,PGPASSWORD_FILE:'',PGSSLMODE:'disable',CODEX_SALE_API_KEY:''},
    cleanup:async()=>{const child=Reflect.get(postgres,'process');if(child&&(child.exitCode!==null||child.signalCode!==null))Reflect.set(postgres,'process',undefined);await postgres.stop();await rm(directory,{recursive:true,force:true});}};
}
const database=await currentDatabase(),apiPort=Number(process.env.FLAG_PREVIEW_API_PORT||2635),webPort=Number(process.env.FLAG_PREVIEW_WEB_PORT||5235),api='http://127.0.0.1:'+apiPort;
const environment={...process.env,...database.env,PORT:String(apiPort),AUTH_DB_PATH:'flag_battle_preview',PUBLIC_ORIGIN:''};
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});
let log='',stopping=false,db:PostgresDatabase|undefined,wallet:DemoWalletStore;
backend.stdout.on('data',bytes=>{log=(log+bytes).slice(-5000);});backend.stderr.on('data',bytes=>{log=(log+bytes).slice(-5000);});
const plugin:Plugin={name:'flag-battle-common-wallet',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
    const path=new URL(req.url||'/',api).pathname;
    if(path==='/__test/flag-battle/stop'){res.end('stopping');void stop().then(()=>process.exit(0));return;}
    if(!['/api/demo-wallet','/api/game-wallet','/api/demo-wallet/expansion','/api/game-wallet/expansion','/__test/flag-battle/topup'].includes(path)){next();return;}
    try{
      const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie||''}}).then(r=>r.json());
      if(!identity.account)throw new WalletError(401,'Sign in');
      const account=identity.account.id;
      if(req.headers['x-royal-account-id']&&req.headers['x-royal-account-id']!==account)throw new WalletError(403,'Account changed');
      if(!db){db=new PostgresDatabase('flag_battle_preview',{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
      let body='';if(req.method==='POST')for await(const bytes of req){body+=bytes;if(body.length>8192)throw Error('Oversized local request');}
      const op=body?JSON.parse(body):null;let reply:unknown;
      if(path==='/__test/flag-battle/topup'&&req.method==='POST')reply=await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount:1000});
      else if(req.method==='GET')reply=path.endsWith('/expansion')?await wallet.expansion.active(account,true,true,true,true,true,true,true,2,4,flagCapability(req.headers[FLAG_HEADER.toLowerCase()] as string | undefined)):await wallet.snapshot(account);
      else if(req.method==='POST'&&path.endsWith('/expansion')){
        if(op?.gameId!==FLAG_GAME)throw new WalletError(400,'This local stand supports Flag Battle only');
        reply=await wallet.expansion.operate(account,op,2,true,true,true,true,true,true,true,true,2,4,flagCapability(req.headers[FLAG_HEADER.toLowerCase()] as string | undefined));
      }else throw new WalletError(405,'Unsupported local method');
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(reply));
    }catch(error){res.statusCode=error instanceof WalletError?error.status:500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error instanceof Error?error.message:'Local stand error'}));}
  });
}};
const vite=await createServer({configFile:false,root:process.cwd(),plugins:[plugin],optimizeDeps:{entries:['index.html']},
  server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**']},
    proxy:{'/api':api,'/game-modules':api,'/multiplayer':{target:api,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});
async function stop(){
  if(stopping)return;stopping=true;await vite.close();await db?.close();backend.kill();
  if(backend.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);backend.once('exit',()=>{clearTimeout(timer);resolve();});});
  await database.cleanup();
}
process.once('SIGINT',()=>{void stop().then(()=>process.exit(0));});process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0));});
try{
  let ready=false;
  for(let attempt=0;attempt<150;attempt++){
    if(backend.exitCode!==null)throw Error('Local backend stopped: '+log);
    ready=await fetch(api+'/healthz').then(r=>r.ok).catch(()=>false);if(ready)break;await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw Error('Local backend did not start: '+log);
  await vite.listen();console.log('Flag Battle local host ready: http://127.0.0.1:'+webPort);
}catch(error){await stop();throw error;}
