import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { fundLocalAtelierAccounts } from './local-atelier-credit';

if (process.env.NODE_ENV === 'production') throw new Error('Local atelier must not run in production');
const directory = resolve('.tmp/atelier-local'); mkdirSync(directory, { recursive: true });
const configurationFile = join(directory, 'secrets.json');
if (!existsSync(configurationFile)) writeFileSync(configurationFile, JSON.stringify({ password: randomBytes(32).toString('hex'), request: randomBytes(32).toString('hex'), event: randomBytes(32).toString('hex') }), { mode: 0o600 });
const secrets = JSON.parse(readFileSync(configurationFile, 'utf8')) as Record<string, string>;
for (const file of ['.env.local-atelier', '.env']) {
  if (existsSync(file) && !process.env.CODEX_SALE_API_KEY) {
    const value = parseEnv(readFileSync(file, 'utf8')).CODEX_SALE_API_KEY;
    if (value) process.env.CODEX_SALE_API_KEY = value;
  }
}
if (!process.env.CODEX_SALE_API_KEY) throw new Error('Set CODEX_SALE_API_KEY in .env.local-atelier for real image generation');
Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: '', DATABASE_URL_FILE: '', PGHOST: '127.0.0.1', PGPORT: '55587',
  PGDATABASE: 'royal_atelier_local', PGUSER: 'atelier_local', PGPASSWORD: secrets.password, PGPASSWORD_FILE: '', PGSSLMODE: 'disable',
  PORT: '2587', PUBLIC_ORIGIN: 'http://localhost:5187', PAYMENTS_SERVICE_URL: 'http://127.0.0.1:2588',
  PAYMENTS_REQUEST_SECRET: secrets.request, PAYMENTS_EVENT_SECRET: secrets.event, PAYMENTS_REQUEST_SECRET_FILE: '', PAYMENTS_EVENT_SECRET_FILE: '',
  NOWPAYMENTS_ENABLED: 'false', NOWPAYMENTS_WITHDRAWALS_ENABLED: 'false', NOWPAYMENTS_GAMES_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false',
  ROYAL_DEV_API_URL: 'http://127.0.0.1:2587', REDIS_URL: '', LOBBY_WORKER_ONLY: 'false', LOBBY_WORKER_ID: '', VITE_LOCAL_ATELIER: '1' });
const postgres = new EmbeddedPostgres({ databaseDir: join(directory, 'postgres'), port: 55587, user: 'atelier_local', password: secrets.password,
  persistent: true, authMethod: 'scram-sha-256', initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
if (!existsSync(join(directory, 'postgres/PG_VERSION'))) await postgres.initialise();
await postgres.start();
const client = new pg.Client({ host: '127.0.0.1', port: 55587, database: 'postgres', user: 'atelier_local', password: secrets.password });
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='royal_atelier_local'")).rowCount) await client.query('CREATE DATABASE royal_atelier_local');
await client.end();

const { PostgresDatabase } = await import('../server/database');
const { CryptoStore } = await import('../server/crypto/store');
const { cryptoConfig, CryptoError } = await import('../server/crypto/config');
const { PaymentOutbox } = await import('../server/payments/outbox');
const { createPaymentApp } = await import('../server/payments/app');
const { startPaymentWorkers } = await import('../server/payments/workers');
const paymentDb = new PostgresDatabase('royal_payments');
await paymentDb.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)');
const outbox = new PaymentOutbox(paymentDb, 'http://127.0.0.1:2587/internal/payments/events', secrets.event);
// Real transfers are unavailable on this isolated local ledger. Image calls remain real.
const provider = new Proxy({}, { get: () => async () => { throw new CryptoError(503, 'Локальный стенд: внешние переводы отключены.'); } }) as import('../server/crypto/nowpayments').CryptoProvider;
const store = new CryptoStore(paymentDb, { ...cryptoConfig({}), enabled: true }, provider, outbox.ready, undefined, undefined, change => outbox.record(change));
await store.ready;
const payments = createPaymentApp(store, secrets.request).listen(2588, '127.0.0.1');
const stopWorkers = startPaymentWorkers(store, outbox);
let gameDb: import('../server/database').PostgresDatabase | undefined;
let funding: Promise<number> | undefined;
let creditTimer: ReturnType<typeof setInterval> | undefined;
const children: ChildProcess[] = [];
for (const args of [['--import', 'tsx', 'server/index.ts'], ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort']]) {
  const child = spawn(process.execPath, args, { env: process.env, stdio: 'inherit', windowsHide: true }); children.push(child);
  child.once('exit', () => { void stop(); });
}
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(creditTimer); await funding?.catch(() => {});
  for (const child of children) child.kill();
  await stopWorkers(); await new Promise<void>(done => payments.close(() => done()));
  await gameDb?.close(); await paymentDb.close(); await postgres.stop(); process.exit();
}
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch('http://127.0.0.1:2587/healthz')).ok) break; } catch { /* Child is starting. */ }
  if (i === 59) { await stop(); throw new Error('Local game did not start'); }
  await new Promise(done => setTimeout(done, 500));
}
const login = await fetch('http://127.0.0.1:2587/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tailor@atelier.local', password: 'AtelierLocal2026' }) });
if (!login.ok) { await stop(); throw new Error('Local test account could not be created'); }
const { account } = await login.json() as { account: { id: string; skin: number | null } };
if (account.skin === null) await fetch('http://127.0.0.1:2587/api/auth/character', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie')!.split(';')[0] }, body: JSON.stringify({ skin: 0, name: 'Гость ателье' }) });
gameDb = new PostgresDatabase('royal_game', { existingSchema: true });
const fund = () => {
  if (!funding) funding = fundLocalAtelierAccounts(gameDb!).finally(() => { funding = undefined; });
  return funding;
};
await fund();
creditTimer = setInterval(() => { void fund().catch(() => console.error('Local test credit will be retried')); }, 2000);
console.log('Local atelier ready: http://localhost:5187');
console.log('Every local player receives a one-time $50 test balance. Image generation uses the real provider.');
