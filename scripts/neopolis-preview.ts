/** Local review stand. Always starts its own temporary PostgreSQL, never reads .env. */
import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createServer } from 'vite';
import { temporaryDatabase } from './database-test';
import { neopolisTestRng } from './neopolis-test-rng';

const database = await temporaryDatabase();
const apiPort = Number(process.env.NEOPOLIS_API_PORT || 2616);
const webPort = Number(process.env.NEOPOLIS_WEB_PORT || 5216);
const api = 'http://127.0.0.1:' + apiPort;
const backend = spawn(process.execPath, ['--import', 'tsx', ...(process.env.NEOPOLIS_WATCH === '1' ? ['--watch'] : []), 'server/index.ts'], {
  cwd: process.cwd(), env: { ...process.env, ...database.env, PORT: String(apiPort), AUTH_DB_PATH: 'neopolis_preview', PUBLIC_ORIGIN: '' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let log = '', stopping = false;
backend.stdout.on('data', bytes => { log = (log + bytes.toString()).slice(-6000); });
backend.stderr.on('data', bytes => { log = (log + bytes.toString()).slice(-6000); });
const vite = await createServer({ configFile: false, root: process.cwd(),
  // Disposable preview coins only. The deployed host continues to use its Nile journal.
  plugins: [neopolisTestRng(api,{...process.env,...database.env},process.env.NEOPOLIS_TEST_RNG === '1'), {
    name: 'review-committed-client-bytes', configureServer(server) {
      if (process.env.NEOPOLIS_REVIEW_DIST !== '1') return;
      const directory = resolve('dist');
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
        const file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(directory + '/')) { next(); return; }
        try { if (!statSync(file).isFile()) { next(); return; } } catch { next(); return; }
        const mime: Record<string,string> = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
        response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-store'); createReadStream(file).pipe(response);
      });
    },
  }],
  optimizeDeps: { entries: ['tests/fixtures/neopolis-preview.html'] },
  server: { host: '127.0.0.1', port: webPort, strictPort: true,
    watch: { ignored: ['**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**'] },
    proxy: { '/api': api, '/game-modules': api, '/multiplayer': { target:api, ws:true, rewrite:path => path.replace(/^\/multiplayer/, '') },
      ...(process.env.NEOPOLIS_REVIEW_DIST === '1' ? { '/matchmake': api,
        '^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(?:[?]|$)': { target: api, ws: true } } : {}),
    },
  },
});
async function stop() {
  if (stopping) return; stopping = true;
  await vite.close(); backend.kill();
  if (backend.exitCode === null) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 3000); backend.once('exit', () => { clearTimeout(timer); resolve(); }); });
  await database.cleanup();
}
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (backend.exitCode !== null) throw Error('Preview backend stopped: ' + log);
    ready = await fetch(api + '/healthz').then(response => response.ok).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error('Preview backend did not start: ' + log);
  await vite.listen();
  console.log('Neopolis local preview: http://127.0.0.1:' + webPort + '/tests/fixtures/neopolis-preview.html');
  console.log('English preview: http://127.0.0.1:' + webPort + '/tests/fixtures/neopolis-preview.html?lang=en');
  console.log('Isolated temporary database. Only local demo coins. Stop with Ctrl+C.');
} catch (error) { await stop(); throw error; }
