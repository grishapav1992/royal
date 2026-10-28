import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { PostgresDatabase } from '../server/database';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig, type CryptoConfig } from '../server/crypto/config';
import { amount, units, decimal } from '../server/crypto/amounts';
import { validIpn, totp, NowPayments, type CryptoProvider } from '../server/crypto/nowpayments';
import { installCryptoWallet } from '../server/cryptoWalletRoutes';
import { validCryptoWallet, usdtUnits } from '../src/shared/cryptoWallet';

class Provider implements CryptoProvider {
  paymentCreates = 0; conversionCreates = 0; payoutCreates = 0; verifies = 0;
  losePayment = false; loseConversion = false; losePayout = false; failVerify = false;
  paymentState = 'waiting'; payoutState = 'WAITING'; conversionState = 'FINISHED';
  treasury = '1000'; payoutData: any; paymentData: any; conversionData: any;
  async currencies() { return [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }, { code: 'sol', name: 'Solana', network: 'sol', memo: false }, { code: 'xrp', name: 'XRP', network: 'xrp', memo: true }]; }
  async estimate(_from: string, to: string, value: string) { return to === 'sol' ? amount(units(value) / 200n) : value; }
  async minimum() { return '0.001'; }
  async fee(currency: string) { return currency === 'sol' ? '0.001' : '1'; }
  async validateAddress(_currency: string, address: string) { if (address === 'bad-address') throw new Error('Invalid address'); }
  async balance() { return { usdttrc20: { amount: this.treasury } }; }
  async createPayment(id: string, currency: string, value: string) {
    this.paymentCreates++;
    this.paymentData = { payment_id: '101', order_id: id, pay_currency: currency, price_currency: 'usdttrc20', price_amount: value,
      pay_amount: value, pay_address: 'T' + 'A'.repeat(33), payment_status: this.paymentState, outcome_currency: 'usdttrc20', outcome_amount: value };
    if (this.losePayment) throw new Error('Lost payment response');
    return this.paymentData;
  }
  async payment() { return { ...this.paymentData, payment_status: this.paymentState }; }
  async convert(currency: string, value: string) {
    this.conversionCreates++;
    this.conversionData = { id: '201', from_currency: 'USDTTRC20', to_currency: currency, from_amount: value, to_amount: '0.4975', status: 'WAITING', created_at: new Date().toISOString() };
    if (this.loseConversion) throw new Error('Lost conversion response');
    return this.conversionData;
  }
  async conversion() { return { ...this.conversionData, status: this.conversionState }; }
  async createPayout(id: string, currency: string, address: string, memo: string, value: string) {
    this.payoutCreates++;
    this.payoutData = { id: '301', batch_withdrawal_id: '401', unique_external_id: id, currency, address, extra_id: memo, amount: value, status: 'WAITING', hash: 'abcd' };
    if (this.losePayout) throw new Error('Lost payout response');
    return { id: '401', withdrawals: [this.payoutData] };
  }
  async payout() { return { ...this.payoutData, status: this.payoutState }; }
  async verify() { this.verifies++; if (this.failVerify) throw new Error('Lost verification'); }
}
async function fixture(overrides: Partial<CryptoConfig> = {}) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('alice'),('bob')");
  const config = { ...cryptoConfig({}), enabled: true, withdrawals: true, games: true, ipnSecret: 'testing-ipn-secret-123456', ...overrides };
  const provider = new Provider(), store = new CryptoStore(db, config, provider, undefined, undefined, () => 0);
  await store.ready;
  return { db, store, provider };
}
async function fund(store: CryptoStore, provider: Provider, value = '100000000') {
  const op = await store.deposit('alice', { id: randomUUID(), amountUnits: value, currency: 'usdttrc20' });
  provider.paymentState = 'finished'; await store.applyPayment(await provider.payment()); return op;
}
const quote = (currency = 'usdttrc20') => ({ id: randomUUID(), amountUnits: '100000000', currency, address: 'T' + 'B'.repeat(33), memo: '' });

test('configuration keeps absent accounts disabled and rejects incomplete real-money activation', () => {
  assert.equal(cryptoConfig({}).enabled, false);
  assert.throws(() => cryptoConfig({ NOWPAYMENTS_ENABLED: 'true', PUBLIC_ORIGIN: 'https://example.com' }));
  assert.throws(() => cryptoConfig({ NOWPAYMENTS_ENABLED: 'yes' }));
  assert.throws(() => cryptoConfig({ NOWPAYMENTS_ENABLED: 'true', NOWPAYMENTS_SANDBOX: 'true', NOWPAYMENTS_API_KEY: 'key', NOWPAYMENTS_IPN_SECRET: 'a'.repeat(20), PUBLIC_ORIGIN: 'https://example.com' }), /sandbox/);
});
test('decimal amounts avoid float ledger arithmetic and round network reserves up', () => {
  assert.equal(usdtUnits('0.000001'), '1'); assert.equal(units(0.1), 100000n);
  assert.equal(units('0.1234567'), 123456n); assert.equal(units('0.1234567', 6, true), 123457n);
  assert.equal(decimal(1e-8), '0.00000001'); assert.equal(amount(1234567n), '1.234567');
  for (const bad of ['1e6', '-1', '0', '1.0000001']) assert.throws(() => usdtUnits(bad));
});
test('IPN uses deep sorted HMAC and constant-time comparison; TOTP matches RFC 6238', () => {
  const body = { z: [{ b: 2, a: 1 }], a: 4 }, secret = 'a-long-testing-secret';
  const signature = createHmac('sha512', secret).update('{"a":4,"z":[{"a":1,"b":2}]}').digest('hex');
  assert.equal(validIpn(body, signature, secret), true); assert.equal(validIpn({ ...body, a: 5 }, signature, secret), false);
  assert.equal(validIpn(body, 'bad', secret), false);
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
});
test('deposit replays and simultaneous requests create one provider payment; only settled USDT is credited', async () => {
  const { db, store, provider } = await fixture();
  try {
    const request = { id: randomUUID(), currency: 'usdttrc20', amountUnits: '100000000' };
    await Promise.all([store.deposit('alice', request), store.deposit('alice', request)]);
    assert.equal(provider.paymentCreates, 1); assert.equal((await store.snapshot('alice') as any).balanceUnits, '0');
    await assert.rejects(() => store.deposit('bob', request));
    await assert.rejects(() => store.deposit('alice', { ...request, amountUnits: '1' }));
    provider.paymentState = 'finished'; provider.paymentData.outcome_amount = '98.123456';
    await Promise.all([store.applyPayment(await provider.payment()), store.applyPayment(await provider.payment())]);
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '98123456');
    assert.equal(validCryptoWallet(await store.snapshot('alice')), true); assert.deepEqual(await store.audit(), { ok: true, mismatches: 0 });
  } finally { await db.close(); }
});
test('forged settlement asset, amount, payment id or order never fund a wallet', async () => {
  const { db, store, provider } = await fixture();
  try {
    await store.deposit('alice', { id: randomUUID(), currency: 'usdttrc20', amountUnits: '100000000' });
    const payment = { ...provider.paymentData, payment_status: 'finished' };
    for (const change of [{ outcome_currency: 'usd' }, { price_amount: '1000000' }, { payment_id: '102' }, { order_id: randomUUID() }, { outcome_amount: -1 }]) await assert.rejects(() => store.applyPayment({ ...payment, ...change }));
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '0');
  } finally { await db.close(); }
});
test('deposit memo comes from the provider while withdrawal still requires the destination memo', async () => {
  const { db, store, provider } = await fixture();
  try {
    await store.deposit('alice', { id: randomUUID(), currency: 'xrp', amountUnits: '100000000' });
    provider.paymentData.payin_extra_id = '1234567'; await store.applyPayment(await provider.payment());
    assert.equal((await store.snapshot('alice') as any).operations[0].memo, '1234567');
    assert.equal(provider.paymentCreates, 1);
    await assert.rejects(() => store.quote('alice', quote('xrp')));
  } finally { await db.close(); }
});
test('late and duplicate updates cannot rewind settled deposits; a larger settled total adds only the difference', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); await store.applyPayment({ ...provider.paymentData, payment_status: 'waiting' });
    assert.equal((await store.snapshot('alice') as any).operations[0].state, 'finished');
    await store.applyPayment({ ...provider.paymentData, payment_status: 'finished', outcome_amount: '101' });
    await assert.rejects(() => store.applyPayment({ ...provider.paymentData, payment_status: 'finished', outcome_amount: '100' }));
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '101000000');
  } finally { await db.close(); }
});
test('lost create-payment response stays durable and a validated IPN recovers it without a new payment', async () => {
  const { db, store, provider } = await fixture();
  try {
    provider.losePayment = true; const request = { id: randomUUID(), currency: 'usdttrc20', amountUnits: '100000000' };
    assert.equal((await store.deposit('alice', request)).state, 'review');
    await store.deposit('alice', request); assert.equal(provider.paymentCreates, 1);
    provider.paymentState = 'finished'; await store.handleIpn({ payment_id: '101' });
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '100000000');
  } finally { await db.close(); }
});
test('withdrawal reserves funds once, retries one payout and completes only on finished status', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); const q = await store.quote('alice', quote()); const request = { id: randomUUID(), quoteId: q.id };
    await Promise.all([store.withdraw('alice', request), store.withdraw('alice', request)]);
    assert.equal(provider.payoutCreates, 1);
    let wallet = await store.snapshot('alice') as any; assert.equal(wallet.balanceUnits, '0'); assert.equal(wallet.reservedUnits, '100000000');
    await assert.rejects(() => store.withdraw('alice', { id: randomUUID(), quoteId: q.id }));
    provider.payoutState = 'FAILED'; await store.advance(request.id); wallet = await store.snapshot('alice') as any;
    assert.equal(wallet.reservedUnits, '100000000'); await store.advance(request.id); assert.equal(provider.payoutCreates, 1);
    provider.payoutState = 'FINISHED'; await store.advance(request.id); await store.applyPayout(await provider.payout());
    wallet = await store.snapshot('alice') as any; assert.equal(wallet.reservedUnits, '0'); assert.deepEqual(await store.audit(), { ok: true, mismatches: 0 });
  } finally { await db.close(); }
});
test('conversion is executed once and the payout uses actual converted funds after network reserve', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); const q = await store.quote('alice', quote('sol')); const request = { id: randomUUID(), quoteId: q.id };
    await store.withdraw('alice', request); await store.advance(request.id);
    assert.equal(provider.conversionCreates, 1); assert.equal(provider.payoutCreates, 1); assert.equal(provider.payoutData.amount, '0.4955');
    provider.payoutState = 'FINISHED'; await store.advance(request.id); assert.equal((await store.snapshot('alice') as any).reservedUnits, '0');
  } finally { await db.close(); }
});
test('rejected direct USDT payout refunds once; failed status never refunds', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); const q = await store.quote('alice', quote()); const request = { id: randomUUID(), quoteId: q.id };
    await store.withdraw('alice', request); provider.payoutState = 'REJECTED'; await store.advance(request.id); await store.applyPayout(await provider.payout());
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '100000000'); assert.equal((await store.snapshot('alice') as any).reservedUnits, '0');
  } finally { await db.close(); }
});
test('rejection after conversion keeps funds on review instead of creating an unfunded USDT refund', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); const q = await store.quote('alice', quote('sol')); const request = { id: randomUUID(), quoteId: q.id };
    await store.withdraw('alice', request); provider.payoutState = 'REJECTED'; await store.advance(request.id);
    const wallet = await store.snapshot('alice') as any; assert.equal(wallet.reservedUnits, '100000000'); assert.equal(wallet.operations[0].state, 'review');
  } finally { await db.close(); }
});
test('lost conversion response is never resent; operator attaches a checked provider conversion', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); provider.loseConversion = true; const q = await store.quote('alice', quote('sol')); const request = { id: randomUUID(), quoteId: q.id };
    await store.withdraw('alice', request); await store.advance(request.id); assert.equal(provider.conversionCreates, 1);
    assert.equal((await store.operation('alice', request.id)).state, 'review');
    await store.recoverConversion(request.id, '201'); await store.advance(request.id);
    assert.equal(provider.conversionCreates, 1); assert.equal(provider.payoutCreates, 1);
  } finally { await db.close(); }
});
test('lost payout response is adopted from authoritative status without creating a duplicate', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); provider.losePayout = true; const q = await store.quote('alice', quote()); const request = { id: randomUUID(), quoteId: q.id };
    await store.withdraw('alice', request); assert.equal((await store.operation('alice', request.id)).state, 'review');
    provider.payoutState = 'CREATING'; await store.handleIpn({ id: '301' }); await store.advance(request.id);
    assert.equal(provider.payoutCreates, 1); assert.equal(provider.verifies, 1);
  } finally { await db.close(); }
});
test('verification failure retries the known batch, never another payout', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); provider.failVerify = true; const q = await store.quote('alice', quote()); const request = { id: randomUUID(), quoteId: q.id };
    await assert.rejects(() => store.withdraw('alice', request)); provider.failVerify = false; await store.withdraw('alice', request);
    assert.equal(provider.payoutCreates, 1); assert.equal(provider.verifies, 2);
  } finally { await db.close(); }
});
test('wrong payout recipient or currency cannot release a reserve', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider); const q = await store.quote('alice', quote()); const request = { id: randomUUID(), quoteId: q.id };
    await store.withdraw('alice', request);
    for (const change of [{ address: 'foreign-address' }, { currency: 'sol' }, { extra_id: 'other' }, { unique_external_id: randomUUID() }, { amount: '1000' }]) await assert.rejects(() => store.applyPayout({ ...provider.payoutData, status: 'FINISHED', ...change }));
    assert.equal((await store.snapshot('alice') as any).reservedUnits, '100000000');
  } finally { await db.close(); }
});
test('unsupported assets, missing memo, expired quote and simultaneous withdrawals are rejected safely', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider);
    await assert.rejects(() => store.quote('alice', quote('unknown'))); await assert.rejects(() => store.quote('alice', quote('xrp')));
    const q = await store.quote('alice', quote()); await db.prepare('UPDATE crypto_quotes SET expires_at=1 WHERE id=?').run(q.id);
    await assert.rejects(() => store.withdraw('alice', { id: randomUUID(), quoteId: q.id }));
    const [a,b] = await Promise.all([store.quote('alice', quote()), store.quote('alice', quote())]);
    const result = await Promise.allSettled([store.withdraw('alice', { id: randomUUID(), quoteId: a.id }), store.withdraw('alice', { id: randomUUID(), quoteId: b.id })]);
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(provider.payoutCreates, 1); assert.equal((await store.audit()).ok, true);
  } finally { await db.close(); }
});
test('cash games settle atomically, reject uncovered winnings and preserve a completed round on retry', async () => {
  const { db, store, provider } = await fixture();
  try {
    await fund(store, provider, '10000000');
    const request = { id: randomUUID(), gameId: 'royal-coins', input: {}, stakeUnits: '1000000' };
    provider.treasury = '10'; await assert.rejects(() => store.play('alice', request));
    provider.treasury = '1000'; const result = await store.play('alice', request); const retry = await store.play('alice', request);
    assert.equal(result.round.payoutUnits, '12000000'); assert.equal((result.wallet as any).balanceUnits, '21000000');
    assert.equal(retry.replayed, true); assert.deepEqual(result.round, retry.round);
    await assert.rejects(() => store.play('bob', request)); assert.equal((await store.audit()).ok, true);
  } finally { await db.close(); }
});
test('HTTP endpoints require session ownership; signed IPN needs no player session and cannot credit forged bodies', async () => {
  const { db, store, provider } = await fixture(); let server: Server | undefined;
  try {
    const app = express(), stop = installCryptoWallet(app, store, async token => token === 'test-token' ? { account: { id: 'alice' } } : null);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as any).port;
    const headers = { Cookie: 'royal_session=test-token', 'X-Royal-Account-Id': 'alice', 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/api/crypto-wallet')).status, 401);
    assert.equal((await fetch(base + '/api/crypto-wallet', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/crypto-wallet', { headers: { ...headers, 'X-Royal-Account-Id': 'bob' } })).status, 401);
    assert.equal((await fetch(base + '/api/crypto-wallet', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    for (const method of ['GET', 'POST']) {
      const options = { method, ...(method === 'POST' ? { body: '{}' } : {}) };
      assert.equal((await fetch(base + '/api/crypto-wallet/stars', { ...options, headers: { 'Content-Type': 'application/json' } })).status, 401);
      assert.equal((await fetch(base + '/api/crypto-wallet/stars', { ...options, headers: { ...headers, 'X-Royal-Account-Id': 'bob' } })).status, 401);
      assert.equal((await fetch(base + '/api/crypto-wallet/stars', { ...options, headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    }
    const displayResponse = await fetch(base + '/api/crypto-wallet/display-rate', { method: 'POST', headers, body: JSON.stringify({ currency: 'RUB' }) });
    assert.equal(displayResponse.status, 200); assert.equal((await displayResponse.json() as any).currency, 'RUB');
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '0');
    assert.equal((await fetch(base + '/api/crypto-wallet/display-rate', { method: 'POST', headers, body: JSON.stringify({ currency: 'RUB', amount: '100' }) })).status, 400);
    assert.equal((await fetch(base + '/api/crypto-wallet/display-rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: 'RUB' }) })).status, 401);
    await fund(store, provider); const event = { payment_id: '101', outcome_amount: '999999999' };
    assert.equal((await fetch(base + '/api/crypto-wallet/ipn', { method: 'POST', headers, body: JSON.stringify(event) })).status, 401);
    const sig = createHmac('sha512', store.config.ipnSecret).update(JSON.stringify({ outcome_amount: event.outcome_amount, payment_id: event.payment_id })).digest('hex');
    assert.equal((await fetch(base + '/api/crypto-wallet/ipn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': sig }, body: JSON.stringify(event) })).status, 200);
    assert.equal((await store.snapshot('alice') as any).balanceUnits, '100000000'); stop();
  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await db.close(); }
});
test('provider never retries money-changing requests and hides credentials in errors', async () => {
  let calls = 0; const config = { ...cryptoConfig({}), apiKey: 'secret-test-key' };
  const provider = new NowPayments(config, async () => { calls++; return new Response('secret-test-key leaked by provider', { status: 500 }); });
  await assert.rejects(() => provider.createPayment(randomUUID(), 'btc', '100'), error => error instanceof Error && !error.message.includes(config.apiKey));
  assert.equal(calls, 1);
});
