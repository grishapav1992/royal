/** Local-only stand with disposable PostgreSQL. Does not load .env or use real stakes. */
import {spawn} from 'node:child_process';
import {createServer as createPortGuard,type Server} from 'node:net';
import {createServer,type Plugin} from 'vite';
import {temporaryDatabase} from './database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';
import {DemoWalletStore,WalletError} from '../server/demoWallet';
import {DemoExpansionStore} from '../server/demoExpansion';

const apiPort=Number(process.env.TEMPLE_API_PORT||2626),webPort=Number(process.env.TEMPLE_WEB_PORT||5226),api='http://127.0.0.1:'+apiPort;
const closeGuard=(server:Server)=>new Promise<void>(resolve=>server.listening?server.close(()=>resolve()):resolve());
const reserve=(port:number)=>new Promise<Server>((resolve,reject)=>{const server=createPortGuard();server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});
// Hold the web port during database startup so a second review run cannot adopt our backend.
const webGuard=await reserve(webPort);
const apiGuard=await reserve(apiPort).catch(async error=>{await closeGuard(webGuard);throw error;});
const database=await temporaryDatabase().catch(async error=>{await closeGuard(apiGuard);await closeGuard(webGuard);throw error;});
await closeGuard(apiGuard);
const environment={...process.env,...database.env,PORT:String(apiPort),AUTH_DB_PATH:'temple_preview',PUBLIC_ORIGIN:''};
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
let log='',stopping=false,db:PostgresDatabase|undefined,wallet:DemoWalletStore;
const stores=new Map<string,DemoExpansionStore>();
backend.stdout.on('data',b=>{log=(log+b).slice(-5000);});backend.stderr.on('data',b=>{log=(log+b).slice(-5000);});
const fixture:Plugin={name:'temple-local-wallet',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const path=new URL(req.url??'/',api).pathname;
  if(!/^\/api\/(?:demo|game)-wallet(?:\/expansion|\/operations)?$/.test(path)){next();return;}
  try{
    const identity=await fetch(api+'/api/auth/me',{headers:{Cookie:req.headers.cookie??''}}).then(r=>r.json());
    if(!identity.account){res.statusCode=401;res.end();return;}
    if(!db){db=new PostgresDatabase('temple_preview',{existingSchema:true,config:databaseConfig(environment)});wallet=new DemoWalletStore(db);}
    const account=identity.account.id,capable=req.headers['x-royal-temple-rules']==='1';let reply:unknown;
    if(req.method==='GET')reply=path.endsWith('/expansion')?await wallet.expansion.active(account,true,true,true,true,true,true,true,2,3,capable):await wallet.snapshot(account);
    else if(req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Oversized test request');}
      const op=JSON.parse(body);
      if(path.endsWith('/operations'))reply=await wallet.operate(account,op);
      else{
        if(op.gameId!=='studio-flooded-temple')throw Error('This local stand supports Flooded Temple only');
        let store=wallet.expansion;
        // Reproducible rare outcomes only on the isolated test stand. Production uses crypto.randomInt.
        if(process.env.TEMPLE_TEST_RNG==='1'){
          const key=account+':'+(req.headers['x-temple-test-case']??'bonus');
          if(!stores.has(key)){
            const cases:Record<string,number[]>={paid:[0,0,600000,0],partial:[0,0,367200,0],big:[0,0,611999,0],blank:[0,0,0,0]};
            const values=cases[String(req.headers['x-temple-test-case'])]??[0,0,0,98,0,0];let cursor=0;
            stores.set(key,new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},max=>{const value=values[cursor++%values.length];if(value>=max)throw Error('Invalid test entropy');return value;}));
          }
          store=stores.get(key)!;
        }
        reply=await store.operate(account,op,2,true,true,true,true,true,true,true,true,2,3,capable);
      }
    }else{res.statusCode=405;res.end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));
  }catch(error){res.statusCode=error instanceof WalletError?error.status:400;res.end(JSON.stringify({error:error instanceof Error?error.message:'Local fixture failed'}));}
});}};
const vite=await createServer({configFile:false,root:process.cwd(),plugins:[fixture],optimizeDeps:{entries:['tests/fixtures/temple-preview.html']},server:{host:'127.0.0.1',port:webPort,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**']},proxy:{'/api':api,'/game-modules':api,'/multiplayer':{target:api,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});
async function stop(){if(stopping)return;stopping=true;await closeGuard(webGuard);await vite.close();await db?.close();backend.kill();if(backend.exitCode===null)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);backend.once('exit',()=>{clearTimeout(timer);resolve();});});await database.cleanup();}
process.once('SIGINT',()=>{void stop().then(()=>process.exit(0));});process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0));});
try{
  let ready=false;for(let attempt=0;attempt<100;attempt++){if(backend.exitCode!==null)throw Error('Preview backend stopped: '+log);ready=await fetch(api+'/healthz').then(r=>r.ok).catch(()=>false);if(ready)break;await new Promise(resolve=>setTimeout(resolve,200));}
  if(!ready)throw Error('Preview did not start: '+log);await closeGuard(webGuard);await vite.listen();
  console.log('Flooded Temple local preview: http://127.0.0.1:'+webPort+'/tests/fixtures/temple-preview.html');
  console.log('Disposable local demo coins and separate database. Stop with Ctrl+C.');
}catch(error){await stop();throw error;}
