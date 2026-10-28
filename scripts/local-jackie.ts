import {createServer} from 'vite';
import {createServer as netServer} from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {temporaryDatabase} from './database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';

// Loopback-only preview, temporary PostgreSQL, simulated coins, no production .env.
const database=await temporaryDatabase(),port=Number(process.env.JACKIE_PREVIEW_PORT||5236);
const socket=netServer();await new Promise<void>(yes=>socket.listen(0,'127.0.0.1',yes));const apiPort=(socket.address() as {port:number}).port;await new Promise<void>(yes=>socket.close(()=>yes()));
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,...database.env,AUTH_DB_PATH:'jackie_preview',PORT:String(apiPort)},stdio:['ignore','pipe','pipe']});
let logs='';backend.stdout.on('data',b=>logs=(logs+b.toString()).slice(-4000));backend.stderr.on('data',b=>logs=(logs+b.toString()).slice(-4000));
const target=`http://127.0.0.1:${apiPort}`,origin=`http://127.0.0.1:${port}`;
let connection:PostgresDatabase|undefined,vite:Awaited<ReturnType<typeof createServer>>|undefined,stopped=false;
async function stop(exit=true){if(stopped)return;stopped=true;await vite?.close();await connection?.close();if(backend.exitCode===null){backend.kill();await new Promise<void>(yes=>backend.once('exit',()=>yes()));}await database.cleanup();if(exit)process.exit(0);}
for(const event of ['SIGINT','SIGTERM'] as const)process.on(event,()=>void stop());
try{
for(let i=0;;i++){try{if((await fetch(target+'/healthz')).ok)break;}catch{}if(i===100)throw Error('Local backend failed: '+logs);await new Promise(yes=>setTimeout(yes,100));}
connection=new PostgresDatabase('jackie_preview',{existingSchema:true,config:databaseConfig({...process.env,...database.env})});
const previewConnection=connection;
vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-jackie-preview',optimizeDeps:{entries:['tests/fixtures/jackie-play.html']},server:{host:'127.0.0.1',port,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**']},proxy:{'/api':target,'/game-modules':target,'/multiplayer':{target,ws:true,rewrite:p=>p.replace(/^\/multiplayer/,'')}}},plugins:[{name:'local-jackie-account',configureServer(server){
  server.middlewares.use('/__jackie/setup',async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'||req.headers.origin!==origin){res.statusCode=403;res.end('{}');return;}
    try{
      const cookie=req.headers.cookie??'';let account=(await(await fetch(target+'/api/auth/me',{headers:{Cookie:cookie}})).json()).account;
      if(!account){const login=await fetch(target+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`jackie-preview-${randomUUID()}@example.test`,password:randomBytes(24).toString('hex')})});if(!login.ok)throw Error('Local login unavailable');account=(await login.json()).account;res.setHeader('Set-Cookie',login.headers.get('set-cookie')!);await previewConnection.prepare('INSERT INTO demo_wallets(account_id,balance,fraction_units) VALUES(?,10000,0) ON CONFLICT DO NOTHING').run(account.id);}
      res.end(JSON.stringify({account:{id:account.id}}));
    }catch{res.statusCode=503;res.end(JSON.stringify({error:'Локальный просмотр пока не готов. Обнови страницу.'}));}
  });
}}]});
await vite.listen();await mkdir('artifacts/work/jackie-chan',{recursive:true});await writeFile('artifacts/work/jackie-chan/preview.json',JSON.stringify({owner:'jackie-chan',purpose:'Active local visual review with a temporary wallet',url:origin+'/tests/fixtures/jackie-play.html',pid:process.pid,cleanup:'Stop this process to close and delete its temporary PostgreSQL; archive the extra checkout after the user finishes reviewing.'},null,2));
console.log(origin+'/tests/fixtures/jackie-play.html');
}catch(error){await stop(false);throw error;}
