/** Disposable local full-host review. Never imported by the production application. */
import { spawn } from 'node:child_process';
import { mkdir, appendFile } from 'node:fs/promises';
import { createServer, type Plugin } from 'vite';
import { temporaryDatabase } from './database-test';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';

const database = await temporaryDatabase();
await mkdir('artifacts/work/forest-heart-client',{recursive:true});
await appendFile('artifacts/work/forest-heart-client/preview-databases.jsonl',JSON.stringify({owner:'forest-heart-client',directory:database.directory,pid:process.pid,cleanup:'On the explicit test shutdown or Ctrl+C'})+'\n');
const apiPort = Number(process.env.FOREST_API_PORT || 2696), webPort = Number(process.env.FOREST_WEB_PORT || 5296);
const api = 'http://127.0.0.1:' + apiPort;
const environment = { ...process.env, ...database.env, PORT: String(apiPort), AUTH_DB_PATH: 'forest_heart_review', PUBLIC_ORIGIN: '' };
const backend = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = '', stopping = false, db: PostgresDatabase | undefined, wallet: DemoWalletStore;
const stores = new Map<string, { store: DemoExpansionStore; program: number[]; draws: number }>();
const fixture: Plugin = { name: 'forest-heart-isolated-entropy', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = new URL(req.url ?? '/', api).pathname;
    if(path==='/__test/forest-heart/shutdown'){
      if(process.env.FOREST_TEST_AUTOMATED!=='1'||req.method!=='POST'||req.headers['x-royal-forest-test']!=='shutdown'){res.statusCode=404;res.end();return;}
      void stop(()=>res.end('stopped')).then(()=>process.exit(0)).catch(error=>{res.statusCode=500;res.end('shutdown failed');console.error(error);process.exit(1);});return;
    }
    if (!['/__test/forest-heart/operate','/__test/forest-heart/fund'].includes(path)) { next(); return; }
    try {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      const identity = await fetch(api + '/api/auth/me', { headers: { Cookie: req.headers.cookie ?? '' } }).then(r => r.json());
      const account = identity.account?.id;
      if (!account || req.headers['x-royal-account-id'] !== account) { res.statusCode = 401; res.end(); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw Error('Fixture body too large'); }
      const op = JSON.parse(body);
      if (!db) { db = new PostgresDatabase('forest_heart_review', { existingSchema: true, config: databaseConfig(environment) }); wallet = new DemoWalletStore(db); }
      if (path.endsWith('/fund')) {
        if (op.kind !== 'deposit' || op.amount !== 10000) throw Error('Only the synthetic starting funds are supported');
        const result = await wallet.operate(account, op); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result)); return;
      }
      if (op.gameId !== 'studio-forest-heart') throw Error('Only Forest Heart is supported');
      let fixture = stores.get(account);
      if (!fixture) {
        const state = { program: [] as number[], draws: 0 };
        const store = new DemoExpansionStore(db, id => wallet.snapshot(id), wallet.ready, async () => {}, max => {
          state.draws++; const value = state.program.shift(); if (value === undefined || value >= max) throw Error('Fixture entropy exhausted'); return value;
        });
        // Keep the same mutable sequence across retries and free continuations.
        fixture = Object.assign(state, { store }); stores.set(account, fixture);
      }
      const previous = await db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(account, op.id);
      if (op.action === 'start' && !previous) {
        const scenario = req.headers['x-forest-scenario'];
        const program = scenario === 'choice-bonus' ? [0, 0, 0, 0, ...Array(4).fill([132, 0]).flat()] :
          scenario === 'maximum' ? [132, 9999, 1, 0, ...Array(4).fill([132, 9999]).flat()] :
          scenario === 'loss' ? [4095, 0, 1, 1] : scenario === 'partial' ? [0, 0, 1, 1] : [132, 0, 1, 1];
        fixture.program.splice(0, fixture.program.length, ...program);
      }
      const reply = await fixture.store.operate(account, op, 2, true, true, true, true, true, true, true, true, 2, 3, req.headers['x-royal-forest-heart-rules'] === '1');
      res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Forest-Test-Draws', String(fixture.draws)); res.end(JSON.stringify(reply));
    } catch (error) { res.statusCode = error instanceof WalletError ? error.status : 400; res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Fixture failed' })); }
  });
} };
backend.stdout.on('data', bytes => { log = (log + bytes.toString()).slice(-6000); });
backend.stderr.on('data', bytes => { log = (log + bytes.toString()).slice(-6000); });
const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [fixture],
  server: { host: '127.0.0.1', port: webPort, strictPort: true,
    watch: { ignored: ['**/module-dist/**', '**/module-build/**', '**/artifacts/**', '**/dist/**', '**/dist-server/**'] },
    proxy: { '/api': api, '/game-modules': api, '/multiplayer': { target: api, ws: true, rewrite: path => path.replace(/^\/multiplayer/, '') } },
  },
});
async function stop(databaseRemoved?:()=>void) {
  if (stopping) return; stopping = true;
  await db?.close(); backend.kill();
  if (backend.exitCode === null) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 3000); backend.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await database.cleanup();
  databaseRemoved?.();await vite.close();
}
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend.exitCode !== null) throw Error('Forest review backend stopped: ' + log);
    ready = await fetch(api + '/healthz').then(response => response.ok).catch(() => false); if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error('Forest review backend did not start: ' + log);
  await vite.listen(); console.log('Forest Heart full Royal host: http://127.0.0.1:' + webPort + '/');
  console.log('Isolated temporary PostgreSQL. No .env loaded. Close to delete test data.');
} catch (error) { await stop(); throw error; }
