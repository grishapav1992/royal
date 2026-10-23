import {temporaryDatabase} from './database-test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer as createVite} from 'vite';

// Isolated development stand: all accounts, tokens and PostgreSQL data are disposable.
const database=await temporaryDatabase();Object.assign(process.env,database.env,{AUTH_DB_PATH:'pvp_local_accounts'});
const {accounts}=await import('../server/accounts');
const {pvpFixture}=await import('../server-tests/finance/helpers/nile-pvp-fixture');
const {block}=await import('../server-tests/finance/helpers/nile-play-fixture');
const {createNilePlayServer}=await import('../server/finance/nile-play-service');
const a=await accounts.login('pvp-local-a@example.test','test-password!'),b=await accounts.login('pvp-local-b@example.test','test-password!');
await accounts.select(a.account.id,0,'Анна');await accounts.select(b.account.id,1,'Борис');
const c=await pvpFixture([a.account.id,b.account.id]);
await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
const socket=process.platform==='win32'?'\\\\.\\pipe\\royal-pvp-'+randomUUID():join(tmpdir(),'royal-pvp-'+randomUUID()+'.sock');
const financial=createNilePlayServer(c.ledger);await new Promise<void>(resolve=>financial.listen(socket,resolve));
const dev=process.env.PVP_DEV_CLIENT==='1',webPort=Number(process.env.PVP_WEB_PORT||5191),port=dev?Number(process.env.PVP_API_PORT||2569):webPort;
process.env.ROYAL_DEV_API_URL='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),stdio:['ignore','inherit','inherit'],env:{...process.env,NILE_PLAY_SOCKET_FILE:socket,PORT:String(port)}});
const vite=dev?await createVite({root:process.cwd(),server:{host:'127.0.0.1',port:webPort,strictPort:true}}):undefined;await vite?.listen();
for(let attempt=0;attempt<100;attempt++){if(await fetch('http://127.0.0.1:'+port+'/healthz').then(r=>r.ok).catch(()=>false))break;await new Promise(resolve=>setTimeout(resolve,100));}
// Keep only this disposable ledger's reconciliation fresh while walking across floors.
const refresh=setInterval(()=>{void(async()=>{await c.source.success();await c.ledger.sync(c.source,await c.reconciliation());})().catch(()=>{});},30_000);
console.log('PvP local stand: http://127.0.0.1:'+webPort+' (synthetic accounts only)');
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;clearInterval(refresh);if(server.exitCode===null)await new Promise<void>(resolve=>{server.once('exit',()=>resolve());server.kill();});await vite?.close();await new Promise<void>(resolve=>financial.close(()=>resolve()));await c.close();await accounts.close();await database.cleanup();process.exit(0);};
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(String(value).trim()==='stop')void stop();});
