import { spawn } from 'node:child_process';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Plugin } from 'vite';
import { temporaryDatabase } from './database-test';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';

/** Disposable host verification. Funding is confined to this local test stand. */
const database = await temporaryDatabase();
const built = process.env.PROGRESSION_VERIFY_BUILT === '1';
const apiPort = 2792, webPort = 5392, api = `http://127.0.0.1:${apiPort}`;
const environment = { ...process.env, ...database.env, PORT: String(apiPort), AUTH_DB_PATH: 'progression_host_test', PUBLIC_ORIGIN: '' };
const backend = spawn(process.execPath, built ? ['dist-server/index.js'] : ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', stopping = false, db: PostgresDatabase | undefined, wallet: DemoWalletStore;
backend.stdout.on('data', bytes => { log = (log + bytes).slice(-5000); });
backend.stderr.on('data', bytes => { log = (log + bytes).slice(-5000); });
const plugin: Plugin = { name: 'progression-local-fixture', configureServer(vite) {
  if (built) vite.middlewares.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { next(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.statusCode = 400; res.end(); return; }
    for (const base of [resolve('dist'), resolve('public')]) {
      const file = resolve(base, pathname === '/' ? 'index.html' : '.' + pathname);
      if (!file.startsWith(base + '/') || !existsSync(file) || !statSync(file).isFile()) continue;
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
      res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
      return;
    }
    next();
  });
  vite.middlewares.use(async (req, res, next) => {
    if (req.url !== '/__test/progression/fund' || req.method !== 'POST') { next(); return; }
    try {
      const identity = await fetch(api + '/api/auth/me', { headers: { Cookie: req.headers.cookie || '' } }).then(reply => reply.json());
      if (!identity.account) throw new WalletError(401, 'Sign in to the local test stand first');
      if (!db) { db = new PostgresDatabase('progression_host_test', { existingSchema: true, config: databaseConfig(environment) }); wallet = new DemoWalletStore(db); }
      const result = await wallet.operate(identity.account.id, { id: randomUUID(), kind: 'deposit', amount: 2000 });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof WalletError ? error.status : 500;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Fixture unavailable' }));
    }
  });
} };
const vite = await createServer({ configFile: false, root: built ? resolve('dist') : process.cwd(), publicDir: built ? false : undefined,
  cacheDir: resolve('artifacts/work/location-levels-mvp/vite-cache'), plugins: [plugin],
  optimizeDeps: built ? { noDiscovery: true, include: [] } : { entries: ['index.html'] }, server: { host: '127.0.0.1', port: webPort, strictPort: true,
    watch: { ignored: ['**/module-dist/**', '**/module-build/**', '**/artifacts/**', '**/dist/**', '**/dist-server/**'] },
    proxy: { '/api': api, '/game-modules': api, '/multiplayer': { target: api, ws: true, rewrite: path => path.replace(/^\/multiplayer/, '') },
      ...(built ? { '^/(?:matchmake(?:/|$)|[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+(?:\\?|$))': { target: api, ws: true } } : {}) } } });
async function stop() {
  if (stopping) return; stopping = true;
  await vite.close(); await db?.close(); backend.kill();
  if (backend.exitCode === null) await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 3000); backend.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await database.cleanup();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (backend.exitCode !== null) throw Error('Local backend exited: ' + log);
    try { if ((await fetch(api + '/healthz')).ok) { ready = true; break; } } catch { /* Readiness is retried within this bounded startup. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error('Local backend did not start: ' + log);
  await vite.listen(); console.log(`Progression local host ready: http://127.0.0.1:${webPort}`);
} catch (error) { await stop(); throw error; }
