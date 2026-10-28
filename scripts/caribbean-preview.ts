/** Local host verification only. Own temporary PostgreSQL, real shared wallet store, no .env. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createServer,type Plugin } from 'vite';
import { temporaryDatabase } from './database-test';
import { PostgresDatabase,databaseConfig } from '../server/database';
import { DemoWalletStore,WalletError } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { CARIBBEAN_GAME } from '../src/shared/caribbeanTreasures';
import {CARIBBEAN_CLIENT_HEADER} from '../src/shared/caribbeanTransport';

const database = await temporaryDatabase();
const apiPort = Number(process.env.CARIBBEAN_API_PORT || 2634), webPort = Number(process.env.CARIBBEAN_WEB_PORT || 5234);
const api = 'http://127.0.0.1:' + apiPort;
const environment = {...process.env,...database.env,PORT:String(apiPort),AUTH_DB_PATH:'caribbean_stage3',PUBLIC_ORIGIN:''};
const backend = spawn(process.execPath,['--import','tsx','server/index.ts'],{
  cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true,
});
let log = '', stopping = false, db:PostgresDatabase|undefined, wallet:DemoWalletStore;
const force = new Set<string>();
const scenarioSeeds=new Map<string,number>(JSON.parse(await readFile(new URL('../docs/concepts/caribbean-treasures/scenarios.json',import.meta.url),'utf8')).cases.map((c:{name:string;seed:number})=>[c.name,c.seed]));
const scenarioDraws=new Map<string,(maximum:number)=>number>();
backend.stdout.on('data',bytes => { log = (log + bytes.toString()).slice(-5000); });
backend.stderr.on('data',bytes => { log = (log + bytes.toString()).slice(-5000); });
const plugin:Plugin = {name:'caribbean-local-common-wallet',configureServer(server) {
  server.middlewares.use(async(req,res,next) => {
    const path = new URL(req.url || '/',api).pathname;
    if (path === '/__test/caribbean/stop' && req.method === 'POST') {
      res.end('stopping'); void stop().then(() => process.exit(0)); return;
    }
    const fixture = path.startsWith('/__test/caribbean/');
    if (!fixture && !/^\/api\/(?:demo|game)-wallet(?:\/expansion|\/operations)?$/.test(path)) { next(); return; }
    try {
      const identity = await fetch(api + '/api/auth/me',{headers:{Cookie:req.headers.cookie || ''}}).then(response => response.json());
      if (!identity.account) throw new WalletError(401,'Войди в зал.');
      const account = identity.account.id;
      if (req.headers['x-royal-account-id'] && req.headers['x-royal-account-id'] !== account) throw new WalletError(403,'Аккаунт изменился.');
      if (!db) { db = new PostgresDatabase('caribbean_stage3',{existingSchema:true,config:databaseConfig(environment)}); wallet = new DemoWalletStore(db); }
      let body = '';
      if (req.method === 'POST') for await (const bytes of req) {
        body += bytes; if (body.length > 8192) throw Error('Oversized local request');
      }
      const operation = body ? JSON.parse(body) : null;
      let reply:unknown;
      if (path === '/__test/caribbean/topup' && req.method === 'POST') {
        const amount = operation?.amount ?? 1000;
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000) throw Error('Invalid fixture credit');
        reply = await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount});
      } else if (['/__test/caribbean/force-bonus','/__test/caribbean/force-cannon'].includes(path) && req.method === 'POST') {
        force.add(account); reply = {ready:true};
      } else if(path==='/__test/caribbean/force-scenario'&&req.method==='POST'){
        const seed=scenarioSeeds.get(operation?.name);if(seed===undefined)throw Error('Unknown saved presentation scenario');
        let state=seed>>>0;scenarioDraws.set(account,maximum=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%maximum;});reply={ready:true};
      } else if (fixture) { throw new WalletError(404,'Unknown fixture action'); }
      else if (req.method === 'GET') reply = path.endsWith('/expansion') ? await wallet.expansion.active(account,true,true,true,true,true,true,true,2,3,req.headers[CARIBBEAN_CLIENT_HEADER.toLowerCase()]==='1') : await wallet.snapshot(account);
      else if (req.method === 'POST' && path.endsWith('/expansion')) {
        if (operation?.gameId !== CARIBBEAN_GAME) throw new WalletError(400,'This local stand supports Caribbean Treasures stakes only');
        let store = wallet.expansion;
        if (force.has(account)) {
          force.delete(account); store = new DemoExpansionStore(db,id => wallet.snapshot(id),wallet.ready,async () => {},() => 0);
        }else if(scenarioDraws.has(account))store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},scenarioDraws.get(account)!);
        reply = await store.operate(account,operation,2,true,true,true,true,true,true,true,true,2,3,req.headers[CARIBBEAN_CLIENT_HEADER.toLowerCase()]==='1');
        if((reply as {session?:{state:string}}).session?.state==='settled')scenarioDraws.delete(account);
      } else throw new WalletError(405,'Unsupported local method');
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(reply));
    } catch (error) {
      res.statusCode = error instanceof WalletError ? error.status : 400;
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:error instanceof Error ? error.message : 'Local stand failed'}));
    }
  });
}};
const vite = await createServer({configFile:false,root:process.cwd(),plugins:[plugin],
  optimizeDeps:{entries:['index.html']},
  server:{host:'127.0.0.1',port:webPort,strictPort:true,
    watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**']},
    proxy:{'/api':api,'/game-modules':api,'/multiplayer':{target:api,ws:true,rewrite:path => path.replace(/^\/multiplayer/,'')}},
  },
});
async function stop() {
  if (stopping) return; stopping = true;
  await vite.close(); await db?.close(); backend.kill();
  if (backend.exitCode === null) await new Promise<void>(resolve => {
    const timer = setTimeout(resolve,3000); backend.once('exit',() => { clearTimeout(timer); resolve(); });
  });
  await database.cleanup();
}
process.once('SIGINT',() => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM',() => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (backend.exitCode !== null) throw Error('Local backend stopped: ' + log);
    ready = await fetch(api + '/healthz').then(response => response.ok).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve,200));
  }
  if (!ready) throw Error('Local backend did not start: ' + log);
  await vite.listen();
  await mkdir('artifacts/work/caribbean-character-motion',{recursive:true});
  await writeFile('artifacts/work/caribbean-character-motion/owner.json',JSON.stringify({
    owner:'caribbean-character-motion',purpose:'Captain reactions and field motion in the real Royal host and chat using qualified saved scenarios, disposable accounts and a temporary database',
    cleanupCondition:'Stop the local stand; retain only final desktop/mobile images and verification summary',
    webPort,apiPort,pid:process.pid,backendPid:backend.pid,temporaryDatabase:database.directory,
  },null,2) + '\n');
  console.log('Caribbean local host ready: http://127.0.0.1:' + webPort);
} catch (error) { await stop(); throw error; }
