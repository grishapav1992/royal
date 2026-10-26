import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import express from 'express';
import { SandboxNowPayments, type SandboxConfig } from '../server/payments/sandbox-provider';
import { ARCADE_HOUSE_GAMES } from '../src/shared/arcadeCatalog';
import type { PostgresDatabase } from '../server/database';

// Run only through database-test.ts, with a dedicated temporary PostgreSQL instance.
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'royal_test');
assert(!process.env.DATABASE_URL && !process.env.DATABASE_URL_FILE);
assert(process.env.ROYAL_SANDBOX_CREDENTIAL_FILE && process.env.ROYAL_SANDBOX_PROVIDER_REPORT);
const text = await readFile(process.env.ROYAL_SANDBOX_CREDENTIAL_FILE, 'utf8');
const key = (name: string) => text.match(new RegExp('^' + name + '=(.+)$', 'm'))?.[1]?.trim() ?? '';
const origin = new URL(process.env.ROYAL_SANDBOX_CALLBACK_ORIGIN ?? '');
assert(origin.protocol === 'https:' && origin.hostname.endsWith('.trycloudflare.com') && origin.origin === origin.href.slice(0, -1));
const config: SandboxConfig = { enabled: true, origin: origin.origin, currency: 'btc',
  apiKey: key('NOWPAYMENTS_SANDBOX_API_KEY'), ipnSecret: key('NOWPAYMENTS_SANDBOX_IPN_SECRET') };
assert(config.apiKey && config.ipnSecret.length >= 16);
Object.assign(process.env, { AUTH_DB_PATH: 'royal_sandbox_provider_check', NOWPAYMENTS_ENABLED: 'false',
  NOWPAYMENTS_SANDBOX_ENABLED: 'false', PAYMENTS_SERVICE_URL: '', PUBLIC_ORIGIN: origin.origin });
const { accounts } = await import('../server/accounts');
const { SandboxPaymentStore } = await import('../server/payments/sandbox');
const { installDemoWallet } = await import('../server/demoWalletRoutes');
const { installSandboxPayments } = await import('../server/payments/sandbox-routes');
const db = Reflect.get(accounts, 'db') as PostgresDatabase;
const store = new SandboxPaymentStore(db, config, new SandboxNowPayments(config), accounts.wallet.ready);
const requireSignedIpn = process.env.ROYAL_SANDBOX_REQUIRE_SIGNED_IPN === 'true';
let verifiedCallbackResponses = 0;
const app = express();
app.post('/api/nowpayments-sandbox/ipn', (_req, res, next) => {
  res.once('finish', () => { if (res.statusCode === 200) verifiedCallbackResponses++; }); next();
});
installDemoWallet(app); const stop = installSandboxPayments(app, store);
if (requireSignedIpn) stop();
const server = app.listen(2583, '127.0.0.1'); await once(server, 'listening');
const report: Record<string, unknown> = { mode: 'official-nowpayments-sandbox', startedAt: new Date().toISOString(),
  realMoney: false, isolatedDatabase: true, games: [] };
const save = () => writeFile(process.env.ROYAL_SANDBOX_PROVIDER_REPORT!, JSON.stringify(report, null, 2) + '\n');
const controller = new AbortController();
process.stdin.setEncoding('utf8'); process.stdin.on('data', input => { if (String(input).trim() === 'stop') controller.abort(); });
process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
const wait = async () => {
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, 30000); controller.signal.addEventListener('abort', done, { once: true });
    if (controller.signal.aborted) done();
  });
};
try {
  const login = await accounts.login('provider-check-' + randomUUID() + '@example.test', 'Sandbox-check-42!');
  const accountId = login.account.id;
  const headers = { Cookie: 'royal_session=' + login.token, 'X-Royal-Account-Id': accountId, 'Content-Type': 'application/json',
    'X-Royal-Card-Rules': '2', 'X-Royal-Caramel-Rules': '1', 'X-Royal-Velvet-Rules': '1', 'X-Royal-Convoy-Rules': '1',
    'X-Royal-Nitro-Rules': '1', 'X-Royal-Afterglow-Rules': '1', 'X-Royal-Afterglow-Progress': '3',
    'X-Royal-Meme-Rules': '1', 'X-Royal-Cr-Leo': '1', 'X-Royal-Dracona-Rules': '2', 'X-Royal-Neopolis-Rules': '3' };
  const post = (path: string, body: unknown) => fetch('http://127.0.0.1:2583' + path,
    { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const operation = { id: randomUUID(), amount: 1000, scenario: 'success' };
  report.stage = 'create';
  report.operationId = operation.id;
  const created = await post('/api/nowpayments-sandbox/deposits', operation);
  const deposit = await created.json();
  assert.equal(created.status, 200, 'Official Sandbox did not accept the deposit');
  report.paymentId = deposit.paymentId; report.createdAt = new Date().toISOString();
  assert.equal((await accounts.wallet.snapshot(accountId)).balance, 0);
  await save(); console.log(JSON.stringify({ paymentCreated: true, paymentId: deposit.paymentId, balance: 0 }));
  report.stage = 'settlement';
  const deadline = Date.now() + 18 * 60 * 1000;
  while (!controller.signal.aborted && Date.now() < deadline) {
    // Allow the signed IPN and normal recovery sweep to confirm the provider status.
    if ((await accounts.wallet.snapshot(accountId)).balance === 1000 && (!requireSignedIpn || verifiedCallbackResponses > 0)) break;
    await wait();
  }
  assert(!controller.signal.aborted, 'Stopped by operator');
  assert.equal((await accounts.wallet.snapshot(accountId)).balance, 1000, 'Sandbox did not finish within the verification window');
  if (requireSignedIpn) assert(verifiedCallbackResponses > 0, 'A genuine signed IPN did not reach the wallet');
  report.verifiedCallbackResponses = verifiedCallbackResponses;
  report.creditTrigger = requireSignedIpn ? 'genuine-signed-ipn-with-authenticated-provider-get' : 'authenticated-provider-status-recovery';
  report.creditedAt = new Date().toISOString(); report.creditedBalance = 1000;
  report.stage = 'wagers';
  const settings: Record<string, unknown> = {
    'studio-cosmic-escape': { luelon: { mode: 'normal' } }, 'studio-velvet-reign': { luelon: { mode: 'normal' } },
    'studio-caramel-carnival': { caramel: { mode: 'normal' } }, 'studio-last-convoy': { convoy: { mode: 'normal' } },
    'studio-nitro-run': { nitro: { mode: 'normal' } }, 'studio-meme-overload': { nitro: { mode: 'normal' } },
    'studio-afterglow': { afterglow: { mode: 'normal' } }, 'studio-dracona': { dracona: { mode: 'normal' } },
    'studio-neopolis': { neopolis: { hero: 'granite' } }, 'github-crash': {},
    'original-cr-vs-leo': { penalty: { hero: 'leo', risk: 'safe' } },
  };
  for (const gameId of ARCADE_HOUSE_GAMES) {
    const plinko = gameId === 'royal-plinko';
    const path = '/api/demo-wallet/' + (plinko ? 'operations' : 'expansion');
    const wager = plinko ? { id: randomUUID(), kind: 'play', amount: 10, gameId, rulesVersion: 1, input: { rows: 12, risk: 'easy' } }
      : { id: randomUUID(), action: 'start', gameId, stakeUnits: '1000', settings: settings[gameId] };
    const response = await post(path, wager), result = await response.json();
    assert.equal(response.status, 200, gameId + ' rejected the test wager');
    const replay = await post(path, wager), saved = await replay.json();
    assert.equal(replay.status, 200);
    assert.equal(saved.wallet.entries.filter((entry: any) => entry.kind === 'bet' && entry.operationId === wager.id).length, 1);
    assert.equal(saved.wallet.balance, result.wallet.balance);
    (report.games as unknown[]).push({ gameId, wager: 10, accepted: true, replayChargedAgain: false });
    await save();
  }
  const before = await accounts.wallet.snapshot(accountId);
  report.stage = 'refresh'; report.balanceBeforeRefresh = before.balance; await save();
  let confirmedRefreshes = 0, unavailableRefreshes = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await store.refresh(accountId, operation.id); confirmedRefreshes++; }
    catch { unavailableRefreshes++; }
  }
  report.confirmedRefreshes = confirmedRefreshes; report.unavailableRefreshes = unavailableRefreshes;
  assert(confirmedRefreshes > 0, 'Official Sandbox status refresh remained unavailable');
  assert.deepEqual(await accounts.wallet.snapshot(accountId), before);
  report.finalBalance = before.balance; report.repeatedRefreshChangedBalance = false;
  report.creditEntries = Number((await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='nowpayments-sandbox'").get())!.n);
  assert.equal(report.creditEntries, 1);
  report.completedAt = new Date().toISOString(); report.stage = 'complete'; report.passed = true; await save();
  console.log(JSON.stringify({ passed: true, games: (report.games as unknown[]).length, duplicateCredits: 0 }));
} catch (error) {
  report.passed = false;
  report.failure = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Verification could not complete';
  await save(); console.error(JSON.stringify({ passed: false, failure: report.failure })); process.exitCode = 1;
} finally {
  stop(); await new Promise<void>(resolve => server.close(() => resolve())); await accounts.close();
  process.stdin.pause();
}
