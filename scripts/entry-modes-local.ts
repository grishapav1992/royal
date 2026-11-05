/** Disposable local stand. No production credentials, providers or databases. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { temporaryDatabase } from './database-test';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';

if (process.env.NODE_ENV === 'production') throw Error('Local preview cannot run in production');
const webPort = Number(process.env.ENTRY_WEB_PORT || 5198), apiPort = Number(process.env.ENTRY_API_PORT || 2698);
const api = `http://127.0.0.1:${apiPort}`;
const database = await temporaryDatabase();
Object.assign(process.env, database.env, {
  AUTH_DB_PATH: 'entry_local', PORT: String(apiPort), PUBLIC_ORIGIN: '', NILE_PLAY_SOCKET_FILE: '',
  NOWPAYMENTS_ENABLED: 'false', NOWPAYMENTS_GAMES_ENABLED: 'false', NOWPAYMENTS_WITHDRAWALS_ENABLED: 'false',
  CASINOAPIPRO_ENABLED: 'false', REDIS_URL: '', LOBBY_WORKER_ONLY: 'false', LOBBY_WORKER_ID: '',
  PAYMENTS_SERVICE_URL: '', PAYMENTS_REQUEST_SECRET: '', PAYMENTS_EVENT_SECRET: '',
});
let walletDb: PostgresDatabase | undefined, wallet: DemoWalletStore;
const credited = new Set<string>();
async function credit(accountId: string) {
  if (credited.has(accountId)) return;
  if (!walletDb) { walletDb = new PostgresDatabase('entry_local', { existingSchema: true }); wallet = new DemoWalletStore(walletDb); }
  credited.add(accountId);
  try { await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 50 }); }
  catch (error) { credited.delete(accountId); throw error; }
}
const backend = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let log = '', stopping = false;
backend.stdout!.on('data', data => { log = (log + data.toString()).slice(-6000); });
backend.stderr!.on('data', data => { log = (log + data.toString()).slice(-6000); });
const vite = await createServer({
  configFile: false, root: process.cwd(), optimizeDeps: { entries: ['index.html'] },
  plugins: [{ name: 'entry-local-credit', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url !== '/__local/entry-credit' || request.method !== 'POST') { next(); return; }
      try {
        const identity = await fetch(api + '/api/auth/me', { headers: { Cookie: request.headers.cookie || '' } }).then(result => result.json());
        if (!identity.account) { response.statusCode = 401; response.end(); return; }
        await credit(identity.account.id);
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ credited: true }));
      } catch { response.statusCode = 500; response.end('Local test credit failed'); }
    });
  } }],
  server: { host: '127.0.0.1', port: webPort, strictPort: true,
    watch: { ignored: ['**/module-dist/**', '**/module-build/**', '**/artifacts/**'] },
    proxy: { '/api': api, '/game-modules': api, '/multiplayer': { target: api, ws: true, rewrite: path => path.replace(/^\/multiplayer/, '') } },
  },
});
async function stop() {
  if (stopping) return; stopping = true;
  await vite.close(); backend.kill();
  if (backend.exitCode === null) await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 3000); backend.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await walletDb?.close(); await database.cleanup();
}
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (backend.exitCode !== null) throw Error('Local backend stopped: ' + log);
    ready = await fetch(api + '/healthz').then(result => result.ok).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error('Local backend did not start: ' + log);
  const login = await fetch(api + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'guest@royal.local', password: 'RoyalLocal2026' }) });
  if (!login.ok) throw Error('Local preview account could not be created');
  const { account } = await login.json();
  const character = await fetch(api + '/api/auth/character', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie')!.split(';')[0] }, body: JSON.stringify({ skin: 0, name: 'Гость Royal' }) });
  if (!character.ok) throw Error('Local preview character could not be created');
  await credit(account.id);
  await vite.listen();
  console.log(`Local Royal ready: http://127.0.0.1:${webPort}`);
  console.log('Preview login: guest@royal.local / RoyalLocal2026. Test balance: 50 USDT.');
} catch (error) { await stop(); throw error; }
