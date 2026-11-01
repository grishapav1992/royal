/** Real Royal host, disposable database, common wallet and local-only clock controls. */
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { temporaryDatabase } from './database-test';
const database = await temporaryDatabase(), api = 'http://127.0.0.1:2637';
const backend = spawn(process.execPath, ['--import','tsx','scripts/flag-tote-preview-backend.ts'], { cwd: process.cwd(), env: { ...process.env, ...database.env, PORT: '2637', AUTH_DB_PATH: 'flag_tote_preview', PUBLIC_ORIGIN: '' }, stdio: ['ignore','pipe','pipe'] });
let output = '', stopping = false;
backend.stdout.on('data', b => { output = (output + b).slice(-5000); }); backend.stderr.on('data', b => { output = (output + b).slice(-5000); });
const vite = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 5237, strictPort: true,
  watch: { ignored: ['**/node_modules/**','**/module-dist/**','**/module-build/**','**/artifacts/**','**/dist/**','**/dist-server/**'] },
  proxy: { '/__test/flag-tote': 'http://127.0.0.1:2638', '/api': api, '/game-modules': api, '/multiplayer': { target: api, ws: true, rewrite: path => path.replace(/^\/multiplayer/,'') } } } });
async function stop() { if (stopping) return; stopping = true; await vite.close(); backend.kill(); if (backend.exitCode === null) await new Promise<void>(r => { const timer = setTimeout(r, 3000); backend.once('exit', () => { clearTimeout(timer); r(); }); }); await database.cleanup(); }
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); }); process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let i = 0; i < 150; i++) { if (backend.exitCode !== null) throw Error('Local backend stopped: ' + output); ready = await fetch(api + '/healthz').then(r => r.ok).catch(() => false); if (ready) break; await new Promise(r => setTimeout(r, 200)); }
  if (!ready) throw Error('Local backend did not start: ' + output); await vite.listen(); console.log('Flag tote host ready: http://127.0.0.1:5237');
} catch (e) { await stop(); throw e; }
