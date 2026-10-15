import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { PostgresDatabase, databaseConfig } from '../server/database';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { PaymentCredits, installPaymentCredits } from '../server/payments/credits';
import { PaymentClient, paymentClientConfig } from '../server/payments/client';
import { PaymentOutbox } from '../server/payments/outbox';
import { createPaymentApp } from '../server/payments/app';
import { startPaymentWorkers } from '../server/payments/workers';
import { serviceSignature, type PaymentEvent } from '../server/payments/protocol';

const requestSecret = 'a'.repeat(64), eventSecret = 'b'.repeat(64);
class Provider implements CryptoProvider {
  creates = 0; payouts = 0; paymentData: any; payoutData: any;
  currencies = async () => [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }];
  estimate = async (_from: string, _to: string, value: string) => value;
  minimum = async () => '0.001'; fee = async () => '1'; validateAddress = async () => {};
  balance = async () => ({ usdttrc20: { amount: '1000' } });
  createPayment = async (id: string, currency: string, value: string) => {
    this.creates++; this.paymentData = { payment_id: String(100 + this.creates), order_id: id, pay_currency: currency,
      price_currency: 'usdttrc20', price_amount: value, pay_amount: value, pay_address: 'T' + 'A'.repeat(33),
      payment_status: 'waiting', outcome_currency: 'usdttrc20', outcome_amount: value };
    return this.paymentData;
  };
  payment = async () => this.paymentData;
  convert = async () => { throw new Error('No conversion in this fixture'); };
  conversion = async () => { throw new Error('No conversion in this fixture'); };
  createPayout = async (id: string, currency: string, address: string, memo: string, amount: string) => {
    this.payouts++; this.payoutData = { id: String(300 + this.payouts), batch_withdrawal_id: '401', unique_external_id: id,
      currency, address, extra_id: memo, amount, status: 'finished', hash: 'test-payout' };
    return { id: '401', withdrawals: [this.payoutData] };
  };
  payout = async () => this.payoutData; verify = async () => {};
}
async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  return { server, url: 'http://127.0.0.1:' + (server.address() as { port: number }).port };
}
const stop = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
async function fixture(delivery?: typeof fetch) {
  const gameDb = new PostgresDatabase(':memory:'), paymentDb = new PostgresDatabase(':memory:');
  const userId = randomUUID(), otherId = randomUUID();
  await gameDb.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await gameDb.prepare('INSERT INTO accounts VALUES (?),(?)').run(userId, otherId);
  await paymentDb.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  const credits = new PaymentCredits(gameDb); await credits.ready;
  const game = express(); installPaymentCredits(game, credits, eventSecret); const gameServer = await listen(game);
  const outbox = new PaymentOutbox(paymentDb, gameServer.url + '/internal/payments/events', eventSecret, undefined, delivery);
  const provider = new Provider(), config = { ...cryptoConfig({}), enabled: true, withdrawals: true, games: false, ipnSecret: 'fake-provider-ipn-secret' };
  const store = new CryptoStore(paymentDb, config, provider, outbox.ready, undefined, undefined, event => outbox.record(event));
  await store.ready;
  const paymentServer = await listen(createPaymentApp(store, requestSecret));
  const client = new PaymentClient({ url: paymentServer.url, requestSecret, eventSecret }, credits);
  return { gameDb, paymentDb, userId, otherId, credits, outbox, provider, store, client, gameServer, paymentServer,
    close: async () => { await stop(paymentServer.server); await stop(gameServer.server); await gameDb.close(); await paymentDb.close(); } };
}
async function fund(f: Awaited<ReturnType<typeof fixture>>) {
  const operation = await f.client.deposit(f.userId, { id: randomUUID(), amountUnits: '50000000', currency: 'usdttrc20' });
  f.provider.paymentData.payment_status = 'finished'; await f.store.applyPayment(await f.provider.payment()); await f.outbox.flush();
  return operation;
}
test('game configuration never reads NOWPayments credentials and fails closed without the separate service', async () => {
  assert.deepEqual(paymentClientConfig({ NOWPAYMENTS_API_KEY_FILE: '/missing-private-provider-key' }), { url: '', requestSecret: '', eventSecret: '' });
  const client = new PaymentClient(paymentClientConfig({}), {} as PaymentCredits);
  assert.deepEqual(await client.snapshot(randomUUID()), { state: 'disabled' });
  await assert.rejects(() => client.deposit(randomUUID(), {})); await assert.rejects(() => client.play(randomUUID(), {}));
  assert.throws(() => paymentClientConfig({ PAYMENTS_SERVICE_URL: 'https://external.example/', PAYMENTS_REQUEST_SECRET: requestSecret, PAYMENTS_EVENT_SECRET: eventSecret }));
});
test('separate gateway requires signed server calls and only settled money updates the game USDT balance', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.paymentServer.url + '/internal/users/' + f.userId + '/snapshot')).status, 401);
    assert.equal((await fetch(f.gameServer.url + '/internal/payments/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: f.userId, deposit_amount: '999999' }) })).status, 401);
    const request = { id: randomUUID(), amountUnits: '50000000', currency: 'usdttrc20' };
    await Promise.all([f.client.deposit(f.userId, request), f.client.deposit(f.userId, request)]); assert.equal(f.provider.creates, 1);
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '0');
    f.provider.paymentData.payment_status = 'finished';
    const event = { payment_id: f.provider.paymentData.payment_id, outcome_amount: '999999' };
    const signature = createHmac('sha512', f.store.config.ipnSecret).update(JSON.stringify({ outcome_amount: event.outcome_amount, payment_id: event.payment_id })).digest('hex');
    const send = () => fetch(f.paymentServer.url + '/api/crypto-wallet/ipn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': signature }, body: JSON.stringify(event) });
    assert.equal((await send()).status, 200); assert.equal((await send()).status, 200);
    await f.outbox.flush();
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '50000000');
    assert.equal((await f.client.snapshot(f.userId) as any).balanceUnits, '50000000');
    assert.equal((await f.credits.snapshot(f.otherId)).balanceUnits, '0');
    assert.equal((await f.gameDb.prepare('SELECT count(*)::int AS n FROM payment_credit_events').get())!.n, 1);
    assert.equal((await f.paymentDb.prepare('SELECT count(*)::int AS n FROM crypto_ledger').get())!.n, 1);
    await assert.rejects(() => f.client.refresh(f.otherId, request.id));
    assert.equal((await f.store.audit()).ok, true);
  } finally { await f.close(); }
});
test('lost event acknowledgment retries the persisted event without a second credit', async () => {
  let lose = true;
  const f = await fixture(async (...args) => { const response = await fetch(...args); if (lose) { lose = false; throw new Error('Acknowledgment lost'); } return response; });
  try {
    await fund(f); assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '50000000');
    assert.equal((await f.paymentDb.prepare('SELECT count(*)::int AS n FROM payment_outbox WHERE delivered_at IS NULL').get())!.n, 1);
    await f.paymentDb.exec('UPDATE payment_outbox SET next_attempt_at=0'); await f.outbox.flush();
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '50000000');
    assert.equal((await f.gameDb.prepare('SELECT count(*)::int AS n FROM payment_credit_events').get())!.n, 1);
    assert.equal((await f.paymentDb.prepare('SELECT count(*)::int AS n FROM payment_outbox WHERE delivered_at IS NULL').get())!.n, 0);
  } finally { await f.close(); }
});
test('ledger changes and queued notifications commit together; an event failure cannot commit money', async () => {
  const f = await fixture();
  try {
    await f.client.deposit(f.userId, { id: randomUUID(), amountUnits: '50000000', currency: 'usdttrc20' });
    f.provider.paymentData.payment_status = 'finished';
    const record = f.outbox.record.bind(f.outbox); f.outbox.record = async () => { throw new Error('Outbox unavailable'); };
    await assert.rejects(() => f.store.applyPayment(f.provider.paymentData));
    assert.equal((await f.store.snapshot(f.userId) as any).balanceUnits, '0');
    assert.equal((await f.paymentDb.prepare('SELECT count(*)::int AS n FROM crypto_ledger').get())!.n, 0);
    f.outbox.record = record; await f.store.applyPayment(f.provider.paymentData); await f.outbox.flush();
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '50000000');
  } finally { await f.close(); }
});
test('a blocked notification preserves per-player order without blocking other players', async () => {
  const f = await fixture();
  try {
    const missing = randomUUID();
    await f.client.deposit(missing, { id: randomUUID(), amountUnits: '1000000', currency: 'usdttrc20' });
    f.provider.paymentData.payment_status = 'finished'; await f.store.applyPayment(f.provider.paymentData); await f.outbox.flush();
    await fund(f);
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '50000000');
    assert.equal((await f.paymentDb.prepare('SELECT count(*)::int AS n FROM payment_outbox WHERE delivered_at IS NULL').get())!.n, 1);
  } finally { await f.close(); }
});
test('withdrawal reserve and successful payout update the game balance once; the service runs no games', async () => {
  const f = await fixture();
  try {
    await fund(f);
    const quote = await f.client.quote(f.userId, { id: randomUUID(), amountUnits: '10000000', currency: 'usdttrc20', address: 'T' + 'B'.repeat(33), memo: '' });
    const request = { id: randomUUID(), quoteId: quote.id };
    await f.client.withdraw(f.userId, request); await f.client.withdraw(f.userId, request);
    await f.outbox.flush();
    assert.equal(f.provider.payouts, 1);
    assert.deepEqual(await f.credits.snapshot(f.userId), { balanceUnits: '40000000', reservedUnits: '0' });
    assert.deepEqual(await f.client.snapshot(f.userId), await f.store.snapshot(f.userId));
    await assert.rejects(() => f.client.play(f.userId, {})); assert.equal((await f.store.audit()).ok, true);
  } finally { await f.close(); }
});
test('forged, changed and expired credit notifications cannot modify game balances', async () => {
  const f = await fixture();
  try {
    const event: PaymentEvent = { event_id: 'c'.repeat(64), user_id: f.userId, payment_id: randomUUID(), kind: 'deposit', currency: 'USDT', scale: 6,
      deposit_amount: '1', available_delta_units: '1000000', reserved_delta_units: '0', created_at: Date.now() };
    const path = '/internal/payments/events';
    const send = (value: PaymentEvent, timestamp: string, signedBody = JSON.stringify(value)) => fetch(f.gameServer.url + path, { method: 'POST', body: JSON.stringify(value), headers: {
      'Content-Type': 'application/json', 'x-royal-payments-timestamp': timestamp, 'x-royal-payments-signature': serviceSignature(eventSecret, 'event', timestamp, 'POST', path, signedBody),
    } });
    assert.equal((await send(event, String(Date.now() - 120000))).status, 401);
    assert.equal((await send({ ...event, available_delta_units: '2000000' }, String(Date.now()), JSON.stringify(event))).status, 401);
    assert.equal((await send(event, String(Date.now()))).status, 200);
    assert.equal((await send(event, String(Date.now()))).status, 200);
    assert.equal((await send({ ...event, deposit_amount: '2', available_delta_units: '2000000' }, String(Date.now()))).status, 409);
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '1000000');
    await assert.rejects(() => f.client.snapshot(f.userId));
  } finally { await f.close(); }
});
test('payment database role cannot read or alter game accounts and game role cannot access payment keys or ledger tables', async () => {
  const admin = new PostgresDatabase(':memory:'), suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const payRole = 'pay_' + suffix, gameRole = 'game_' + suffix, paySchema = 'pay_' + suffix, gameSchema = 'game_' + suffix;
  const password = randomUUID(); let payDb: PostgresDatabase | undefined, gameDb: PostgresDatabase | undefined;
  try {
    await admin.exec(`CREATE ROLE ${payRole} LOGIN NOINHERIT PASSWORD '${password}'; CREATE ROLE ${gameRole} LOGIN NOINHERIT PASSWORD '${password}';
      CREATE SCHEMA ${paySchema} AUTHORIZATION ${payRole}; CREATE SCHEMA ${gameSchema} AUTHORIZATION ${gameRole};
      CREATE TABLE ${paySchema}.ledger(id TEXT); ALTER TABLE ${paySchema}.ledger OWNER TO ${payRole};
      CREATE TABLE ${gameSchema}.accounts(id TEXT); ALTER TABLE ${gameSchema}.accounts OWNER TO ${gameRole}`);
    const config = databaseConfig();
    payDb = new PostgresDatabase(paySchema, { existingSchema: true, config: { ...config, user: payRole, password } });
    gameDb = new PostgresDatabase(gameSchema, { existingSchema: true, config: { ...config, user: gameRole, password } });
    await payDb.ready; await gameDb.ready;
    await assert.rejects(() => payDb!.exec(`SELECT * FROM ${gameSchema}.accounts`));
    await assert.rejects(() => gameDb!.exec(`INSERT INTO ${paySchema}.ledger VALUES ('forged')`));
    await payDb.exec("INSERT INTO ledger VALUES ('owned')");
  } finally {
    await payDb?.close(); await gameDb?.close();
    await admin.exec(`DROP SCHEMA IF EXISTS ${paySchema} CASCADE; DROP SCHEMA IF EXISTS ${gameSchema} CASCADE; DROP ROLE IF EXISTS ${payRole}; DROP ROLE IF EXISTS ${gameRole}`);
    await admin.close();
  }
});

test('slow delivery for another player does not block wallet reads, payment requests or IPN acknowledgments', async () => {
  let blocked = false;
  const gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const f = await fixture(async (url, init) => {
    if (blocked) { started.resolve(); await gate.promise; }
    return fetch(url, init);
  });
  let flushing: Promise<void> | undefined;
  const promptly = async <T>(request: Promise<T>): Promise<T> => {
    const timeout = AbortSignal.timeout(2000);
    return Promise.race([request, new Promise<never>((_resolve, reject) => {
      timeout.addEventListener('abort', () => reject(new Error('A request waited for unrelated delivery')), { once: true });
    })]);
  };
  try {
    await fund(f);
    await f.client.deposit(f.otherId, { id: randomUUID(), amountUnits: '1000000', currency: 'usdttrc20' });
    f.provider.paymentData.payment_status = 'finished'; await f.store.applyPayment(f.provider.paymentData);
    blocked = true; flushing = f.outbox.flush(); await started.promise;
    assert.equal((await promptly(f.client.snapshot(f.userId)) as any).balanceUnits, '50000000');
    assert.equal((await promptly(f.client.currencies())).length, 1);
    await promptly(f.client.displayRate('USD'));
    const quote = await promptly(f.client.quote(f.userId, { id: randomUUID(), amountUnits: '10000000', currency: 'usdttrc20', address: 'T' + 'B'.repeat(33), memo: '' }));
    await promptly(f.client.withdraw(f.userId, { id: randomUUID(), quoteId: quote.id }));
    await assert.rejects(() => promptly(f.client.snapshot(f.userId)), (error: any) => error.status === 503);
    const deposit = await promptly(f.client.deposit(f.userId, { id: randomUUID(), amountUnits: '1000000', currency: 'usdttrc20' }));
    await promptly(f.client.refresh(f.userId, deposit.id));
    f.provider.paymentData.payment_status = 'finished';
    const event = { payment_id: f.provider.paymentData.payment_id }, body = JSON.stringify(event);
    const signature = createHmac('sha512', f.store.config.ipnSecret).update(body).digest('hex');
    await promptly(f.client.receiveIpn(event, signature));
    const response = await promptly(fetch(f.paymentServer.url + '/api/crypto-wallet/ipn', { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': signature } }));
    assert.equal(response.status, 200);
    assert.equal((await f.credits.snapshot(f.otherId)).balanceUnits, '0');
    assert.equal((await f.credits.snapshot(f.userId)).balanceUnits, '50000000');
    blocked = false; gate.resolve(); await flushing;
    assert.equal((await f.client.snapshot(f.userId) as any).balanceUnits, '41000000');
    assert.equal((await f.client.snapshot(f.otherId) as any).balanceUnits, '1000000');
    assert.equal((await f.gameDb.prepare('SELECT count(*)::int AS n FROM payment_credit_events').get())!.n, 5);
    assert.equal((await f.store.audit()).ok, true);
  } finally { blocked = false; gate.resolve(); await flushing; await f.close(); }
});

test('background delivery continues while provider reconciliation is stalled', async () => {
  const started = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
  const secondDelivery = Promise.withResolvers<void>(); let deliveries = 0;
  const stopWorkers = startPaymentWorkers({ config: { enabled: true } as ReturnType<typeof cryptoConfig>,
    reconcile: async () => { started.resolve(); await gate.promise; } }, { flush: async () => {
      if (++deliveries >= 2) secondDelivery.resolve();
    } });
  try {
    await started.promise;
    await Promise.race([secondDelivery.promise, new Promise<never>((_resolve, reject) => {
      AbortSignal.timeout(2500).addEventListener('abort', () => reject(new Error('Delivery waited for reconciliation')), { once: true });
    })]);
    assert.ok(deliveries >= 2);
  } finally { gate.resolve(); await stopWorkers(); }
});

test('notification processing resumes after a background delivery failure', async () => {
  const retried = Promise.withResolvers<void>(); let attempts = 0;
  const stopWorkers = startPaymentWorkers({ config: { enabled: false } as ReturnType<typeof cryptoConfig>,
    reconcile: async () => { assert.fail('Disabled provider must not reconcile'); } }, { flush: async () => {
      if (++attempts === 1) throw new Error('Temporary database outage');
      retried.resolve();
    } });
  try {
    await Promise.race([retried.promise, new Promise<never>((_resolve, reject) => {
      AbortSignal.timeout(3500).addEventListener('abort', () => reject(new Error('Failed delivery did not retry')), { once: true });
    })]);
    assert.equal(attempts, 2);
  } finally { await stopWorkers(); }
});
