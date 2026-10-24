import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { SandboxPaymentStore } from '../server/payments/sandbox';
import { sandboxConfig, SandboxNowPayments, SANDBOX_API, type SandboxConfig, type SandboxProvider } from '../server/payments/sandbox-provider';
import { cryptoConfig } from '../server/crypto/config';
import { demoBalanceUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
import { ARCADE_HOUSE_GAMES } from '../src/shared/arcadeCatalog';
import type { SandboxCase } from '../src/shared/nowpaymentsSandbox';
import { mkdtemp, mkdir, readFile, stat, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeSandboxConfig } from '../deployment/write-nowpayments-sandbox-config.mjs';

const config: SandboxConfig = { enabled: true, apiKey: 'sandbox-test-key-12345678', ipnSecret: 'sandbox-test-ipn-12345678', origin: 'https://royal.example.test', currency: 'btc' };
class Provider implements SandboxProvider {
  creates = 0; reads = 0; loseCreateReply = false;
  rows = new Map<string, Record<string, unknown>>();
  async create(id: string, amount: number, scenario: SandboxCase) {
    const payment = { payment_id: String(++this.creates), order_id: id, price_amount: amount, price_currency: 'usd',
      pay_currency: 'btc', pay_amount: '0.01', actually_paid: '0', payment_status: 'waiting', scenario };
    this.rows.set(payment.payment_id, payment);
    if (this.loseCreateReply) throw new Error('Lost create reply');
    return structuredClone(payment);
  }
  async payment(id: string) { this.reads++; return structuredClone(this.rows.get(id)!); }
  settle(id: string, status = 'finished', paid: string | number = '0.01') { Object.assign(this.rows.get(id)!, { payment_status: status, actually_paid: paid }); }
}
const operation = (scenario: SandboxCase = 'success', amount = 1000) => ({ id: randomUUID(), amount, scenario });
const signature = (value: Record<string, unknown>) => createHmac('sha512', config.ipnSecret).update(JSON.stringify(value, Object.keys(value).sort())).digest('hex');
async function fixture() {
  const db = new PostgresDatabase(':memory:'), user = randomUUID(), other = randomUUID();
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  for (const id of [user, other]) await db.prepare('INSERT INTO accounts(id) VALUES (?)').run(id);
  const wallet = new DemoWalletStore(db), provider = new Provider(), store = new SandboxPaymentStore(db, config, provider, wallet.ready);
  await store.ready;
  return { db, user, other, wallet, provider, store };
}

test('Sandbox uses separate credentials and a fixed test origin; the real-wallet guard remains intact', async () => {
  assert.equal(sandboxConfig({}).enabled, false);
  assert.throws(() => sandboxConfig({ NOWPAYMENTS_SANDBOX_ENABLED: 'true', PUBLIC_ORIGIN: config.origin, NOWPAYMENTS_API_KEY: config.apiKey }), /separate/);
  assert.throws(() => sandboxConfig({ NOWPAYMENTS_SANDBOX_ENABLED: 'true', PUBLIC_ORIGIN: config.origin, NOWPAYMENTS_API_KEY: config.apiKey,
    NOWPAYMENTS_SANDBOX_API_KEY: config.apiKey, NOWPAYMENTS_SANDBOX_IPN_SECRET: config.ipnSecret }), /separate/);
  assert.throws(() => cryptoConfig({ NOWPAYMENTS_ENABLED: 'true', NOWPAYMENTS_SANDBOX: 'true', PUBLIC_ORIGIN: config.origin,
    NOWPAYMENTS_API_KEY: config.apiKey, NOWPAYMENTS_IPN_SECRET: config.ipnSecret }), /real wallet/);
  const calls: { url: string; body?: any }[] = [];
  const client = new SandboxNowPayments(config, (async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : undefined });
    assert.equal(new Headers(options?.headers).get('x-api-key'), config.apiKey);
    assert.equal(options?.redirect, 'error'); return new Response(JSON.stringify({ payment_id: '123', order_id: 'fixture' }));
  }) as typeof fetch);
  for (const scenario of ['success', 'partially_paid', 'failed'] as const) await client.create(randomUUID(), 1000, scenario);
  await client.payment('123');
  assert(calls.every(call => call.url.startsWith(SANDBOX_API)));
  assert.deepEqual(calls.slice(0, 3).map(call => call.body.case), ['success', 'partially_paid', 'failed']);
  assert(calls.slice(0, 3).every(call => call.body.ipn_callback_url === config.origin + '/api/nowpayments-sandbox/ipn' && call.body.price_currency === 'usd'));
  assert.throws(() => client.payment('../../auth'));
});

test('success, partial payment and failure credit only verified virtual amounts, once across concurrent retries', async () => {
  const f = await fixture();
  try {
    await f.db.exec('CREATE TABLE crypto_wallets(account_id TEXT PRIMARY KEY,balance_units BIGINT NOT NULL)');
    await f.db.prepare('INSERT INTO crypto_wallets VALUES (?,777)').run(f.user);
    const success = operation(); const created = await f.store.create(f.user, success);
    assert.equal(await demoBalanceUnits(f.db, f.user), 0, 'Create response does not credit');
    await f.store.create(f.user, success); assert.equal(f.provider.creates, 1);
    await assert.rejects(f.store.create(f.user, { ...success, amount: 2000 }));
    await assert.rejects(f.store.refresh(f.other, success.id));
    await f.store.refresh(f.user, success.id); assert.equal(await demoBalanceUnits(f.db, f.user), 0);
    const callback = { payment_id: created.paymentId!, order_id: success.id, payment_status: 'finished', actually_paid: '999999' };
    await assert.rejects(f.store.receiveIpn(callback, '0'.repeat(128)));
    await f.store.receiveIpn(callback, signature(callback)); assert.equal(await demoBalanceUnits(f.db, f.user), 0, 'A signed callback cannot invent settlement');
    f.provider.settle(created.paymentId!);
    await Promise.all(Array.from({ length: 8 }, () => f.store.receiveIpn(callback, signature(callback))));
    assert.equal(await demoBalanceUnits(f.db, f.user), 100000);
    assert.equal(Number((await f.db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE source='nowpayments-sandbox'").get())!.n), 1);
    const partial = operation('partially_paid'), partialCreated = await f.store.create(f.user, partial);
    f.provider.settle(partialCreated.paymentId!, 'partially_paid', '0.004'); await f.store.refresh(f.user, partial.id);
    assert.equal(await demoBalanceUnits(f.db, f.user), 140000);
    f.provider.settle(partialCreated.paymentId!, 'finished'); await f.store.refresh(f.user, partial.id);
    assert.equal(await demoBalanceUnits(f.db, f.user), 200000);
    f.provider.settle(partialCreated.paymentId!, 'waiting', '0'); await f.store.refresh(f.user, partial.id);
    assert.equal(await demoBalanceUnits(f.db, f.user), 200000, 'Older states cannot reverse an accepted credit');
    const failed = operation('failed'), failedCreated = await f.store.create(f.user, failed);
    f.provider.settle(failedCreated.paymentId!, 'failed'); await f.store.refresh(f.user, failed.id);
    assert.equal(await demoBalanceUnits(f.db, f.user), 200000);
    const altered = f.provider.rows.get(created.paymentId!)!; altered.price_amount = 9999;
    await assert.rejects(f.store.refresh(f.user, success.id));
    assert.equal((await f.db.prepare('SELECT balance_units FROM crypto_wallets WHERE account_id=?').get(f.user))!.balance_units, 777);
  } finally { await f.db.close(); }
});

test('lost create response recovers from verified IPN without creating a replacement payment', async () => {
  const f = await fixture();
  try {
    const op = operation(); f.provider.loseCreateReply = true;
    await assert.rejects(f.store.create(f.user, op));
    assert.equal((await f.store.create(f.user, op)).status, 'review'); assert.equal(f.provider.creates, 1);
    f.provider.settle('1'); const callback = { payment_id: '1', order_id: op.id };
    await f.store.receiveIpn(callback, signature(callback));
    assert.equal(await demoBalanceUnits(f.db, f.user), 100000);
    assert.equal((await f.store.create(f.user, op)).status, 'finished'); assert.equal(f.provider.creates, 1);
  } finally { await f.db.close(); }
});

test('capacity defers credit without loss; scientific decimal amounts and reloaded stores settle once', async () => {
  const f = await fixture();
  try {
    await saveDemoUnits(f.db, f.user, MAX_DEMO_UNITS - 1);
    const op = operation(), created = await f.store.create(f.user, op), row = f.provider.rows.get(created.paymentId!)!;
    Object.assign(row, { pay_amount: 1e-7, actually_paid: 1e-7, payment_status: 'finished' });
    assert.equal((await f.store.refresh(f.user, op.id)).status, 'credit_pending');
    assert.equal(await demoBalanceUnits(f.db, f.user), MAX_DEMO_UNITS - 1);
    await saveDemoUnits(f.db, f.user, 0);
    const reload = new SandboxPaymentStore(f.db, config, f.provider, f.wallet.ready);
    await reload.refresh(f.user, op.id); await reload.refresh(f.user, op.id);
    assert.equal(await demoBalanceUnits(f.db, f.user), 100000);
  } finally { await f.db.close(); }
});

test('credential writer creates a private local file, keeps Sandbox disabled, and preserves an existing config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'royal-sandbox-config-'));
  try {
    const file = await writeSandboxConfig(root, config.apiKey + '\n' + config.ipnSecret + '\n');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const before = await readFile(file, 'utf8'); assert(before.includes('NOWPAYMENTS_SANDBOX_ENABLED=false'));
    assert(!before.includes('\nNOWPAYMENTS_API_KEY='));
    await assert.rejects(writeSandboxConfig(root, 'different-sandbox-key\ndifferent-sandbox-ipn\n'));
    assert.equal(await readFile(file, 'utf8'), before);
    await assert.rejects(writeSandboxConfig(root, 'key\nsecret\nextra\n'));
    const cliRoot = join(root, 'cli'); await mkdir(cliRoot);
    const output = execFileSync(process.execPath, [resolve('deployment/write-nowpayments-sandbox-config.mjs'), cliRoot], {
      input: config.apiKey + '\n' + config.ipnSecret + '\n', encoding: 'utf8',
    });
    assert(!output.includes(config.apiKey) && !output.includes(config.ipnSecret));
    assert.equal((await stat(join(cliRoot, '.env.nowpayments-sandbox'))).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true }); }
});

test('authenticated Sandbox deposit funds an accepted wager and idempotent replay in every one of the twelve Royal games', { timeout: 60000 }, async () => {
  const { accounts } = await import('../server/accounts');
  const { installDemoWallet } = await import('../server/demoWalletRoutes');
  const { installSandboxPayments } = await import('../server/payments/sandbox-routes');
  const provider = new Provider(), db = Reflect.get(accounts, 'db') as PostgresDatabase;
  const store = new SandboxPaymentStore(db, config, provider, accounts.wallet.ready);
  const app = express(); installDemoWallet(app); const stop = installSandboxPayments(app, store);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const settings: Record<string, unknown> = {
    'studio-cosmic-escape': { luelon: { mode: 'normal' } }, 'studio-velvet-reign': { luelon: { mode: 'normal' } },
    'studio-caramel-carnival': { caramel: { mode: 'normal' } }, 'studio-last-convoy': { convoy: { mode: 'normal' } },
    'studio-nitro-run': { nitro: { mode: 'normal' } }, 'studio-meme-overload': { nitro: { mode: 'normal' } },
    'studio-afterglow': { afterglow: { mode: 'normal' } }, 'studio-dracona': { dracona: { mode: 'normal' } },
    'studio-neopolis': { neopolis: { hero: 'granite' } }, 'github-crash': {}, 'original-cr-vs-leo': { penalty: { hero: 'leo', risk: 'safe' } },
  };
  try {
    assert.equal((await fetch(base + '/api/nowpayments-sandbox')).status, 401);
    for (const game of ARCADE_HOUSE_GAMES) {
      const login = await accounts.login('sandbox-' + randomUUID() + '@example.test', 'Sandbox-fixture-42!'), id = login.account.id;
      const headers = { Cookie: 'royal_session=' + login.token, 'X-Royal-Account-Id': id, 'Content-Type': 'application/json', 'X-Royal-Card-Rules': '2',
        'X-Royal-Caramel-Rules': '1', 'X-Royal-Velvet-Rules': '1', 'X-Royal-Convoy-Rules': '1', 'X-Royal-Nitro-Rules': '1',
        'X-Royal-Afterglow-Rules': '1', 'X-Royal-Afterglow-Progress': '3', 'X-Royal-Meme-Rules': '1', 'X-Royal-Cr-Leo': '1', 'X-Royal-Dracona-Rules': '2', 'X-Royal-Neopolis-Rules': '3' };
      const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
      const op = operation(), deposit = await post('/api/nowpayments-sandbox/deposits', op); assert.equal(deposit.status, 200);
      const created = await deposit.json(); provider.settle(created.paymentId);
      assert.equal((await post('/api/nowpayments-sandbox/deposits/' + op.id + '/refresh', {})).status, 200);
      assert.equal((await accounts.wallet.snapshot(id)).balance, 1000);
      const plinko = game === 'royal-plinko', path = '/api/demo-wallet/' + (plinko ? 'operations' : 'expansion');
      const wager = plinko ? { id: randomUUID(), kind: 'play', amount: 10, gameId: game, rulesVersion: 1, input: { rows: 12, risk: 'easy' } }
        : { id: randomUUID(), action: 'start', gameId: game, stakeUnits: '1000', settings: settings[game] };
      const response = await post(path, wager), result = await response.json(); assert.equal(response.status, 200, game + ': ' + JSON.stringify(result));
      const replay = await post(path, wager); assert.equal(replay.status, 200);
      const saved = await replay.json(); assert.equal(saved.wallet.balance, result.wallet.balance, game);
      assert.equal(saved.wallet.entries.filter((entry: any) => entry.kind === 'bet' && entry.operationId === wager.id).length, 1, game);
      const before = await accounts.wallet.snapshot(id); await store.refresh(id, op.id);
      assert.deepEqual(await accounts.wallet.snapshot(id), before, 'Refreshing the deposit after a wager must not refill the spent balance');
      assert.equal((await fetch(base + '/api/nowpayments-sandbox', { headers: { ...headers, 'X-Royal-Account-Id': randomUUID() } })).status, 401);
    }
  } finally { stop(); await new Promise<void>(resolve => server.close(() => resolve())); await accounts.close(); }
});
