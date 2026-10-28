import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { PostgresDatabase } from '../server/database';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { PaymentOutbox } from '../server/payments/outbox';
import { PaymentCredits, installPaymentCredits } from '../server/payments/credits';
import { PaymentClient } from '../server/payments/client';
import { createPaymentApp } from '../server/payments/app';
import { telegramStarsConfig, validTelegramSecret, TelegramBot } from '../server/payments/telegram-provider';
import { TelegramStarsStore } from '../server/payments/telegram-stars';

const requestSecret = 'a'.repeat(64), eventSecret = 'b'.repeat(64);
const configured = () => telegramStarsConfig({ TELEGRAM_STARS_ENABLED: 'true', TELEGRAM_BOT_USERNAME: 'RoyalFixtureBot',
  TELEGRAM_BOT_TOKEN: '12345:' + 'x'.repeat(30), TELEGRAM_WEBHOOK_SECRET: 's'.repeat(64),
  TELEGRAM_STARS_TERMS_URL: 'https://royal.example/terms', TELEGRAM_STARS_SUPPORT_URL: 'https://royal.example/support' });
async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
    close: () => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); } };
}
async function fixture() {
  const db = new PostgresDatabase(':memory:'), gameDb = new PostgresDatabase(':memory:');
  const account = randomUUID(), other = randomUUID();
  for (const database of [db, gameDb]) {
    await database.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
    await database.prepare('INSERT INTO accounts VALUES (?),(?)').run(account, other);
  }
  const credits = new PaymentCredits(gameDb), game = express(); installPaymentCredits(game, credits, eventSecret);
  const gameServer = await listen(game), outbox = new PaymentOutbox(db, gameServer.url + '/internal/payments/events', eventSecret);
  let reserve = '1000', payouts = 0, payoutData: any;
  const provider = { balance: async () => ({ usdttrc20: { amount: reserve } }),
    currencies: async () => [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }],
    validateAddress: async () => {}, fee: async () => '0.01',
    createPayout: async (id: string, currency: string, address: string, memo: string, amount: string) => {
      payouts++; payoutData = { id: '301', batch_withdrawal_id: '401', unique_external_id: id, currency, address, extra_id: memo,
        amount, status: 'finished', hash: 'fixture-payout' };
      return { id: '401', withdrawals: [payoutData] };
    }, payout: async () => payoutData, verify: async () => {} } as unknown as CryptoProvider;
  const wallet = new CryptoStore(db, { ...cryptoConfig({}), enabled: true, withdrawals: true }, provider,
    outbox.ready, undefined, undefined, event => outbox.record(event));
  const config = configured(), calls: { method: string; body: Record<string, any> }[] = [];
  let now = Date.now();
  const stars = new TelegramStarsStore(wallet, config, { call: async (method, body) => { calls.push({ method, body }); return true; } }, () => now);
  await stars.ready;
  const paymentServer = await listen(createPaymentApp(wallet, requestSecret, stars));
  const client = new PaymentClient({ url: paymentServer.url, requestSecret, eventSecret }, credits);
  let updateId = 0;
  const update = (body: unknown, secret = config.webhookSecret) => fetch(paymentServer.url + '/api/telegram-stars/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({ update_id: ++updateId, ...body as object }),
  });
  const message = (from: number, body: object) => ({ message: { from: { id: from }, chat: { id: from, type: 'private' }, ...body } });
  const create = async (stars = 100) => client.stars(account, { id: randomUUID(), stars, termsAccepted: true });
  const start = (id: string, from = 42) => update(message(from, { text: '/start pay_' + id }));
  const query = (order: any, extra: object = {}) => ({ id: 'checkout-' + order.id, from: { id: 42 }, invoice_payload: order.id,
    currency: 'XTR', total_amount: order.stars, ...extra });
  const checkout = (order: any, extra: object = {}) => update({ pre_checkout_query: query(order, extra) });
  const receipt = (order: any, extra: object = {}) => ({ currency: 'XTR', total_amount: order.stars,
    invoice_payload: order.id, telegram_payment_charge_id: 'charge-' + order.id, ...extra });
  const pay = (order: any, extra: object = {}) => update(message(42, { successful_payment: receipt(order, extra) }));
  const refund = (order: any) => update(message(42, { refunded_payment: receipt(order) }));
  return { account, other, db, gameDb, credits, wallet, stars, config, outbox, client, calls, update, message, create, start, query, checkout, pay, refund,
    reserve: (value: string) => { reserve = value; }, later: () => { now += 3600000; }, payouts: () => payouts,
    close: async () => { await paymentServer.close(); await gameServer.close(); await db.close(); await gameDb.close(); } };
}
test('Stars configuration fails closed and Telegram API failures never expose the token', async () => {
  assert.equal(telegramStarsConfig({}).enabled, false); assert.equal(telegramStarsConfig({}).unitsPerStar, '10000');
  assert.throws(() => telegramStarsConfig({ TELEGRAM_STARS_ENABLED: 'true' }));
  assert.throws(() => telegramStarsConfig({ TELEGRAM_STARS_USDT_UNITS_PER_STAR: '0.013' }));
  const config = configured(); assert(validTelegramSecret(config.webhookSecret, config.webhookSecret));
  assert(!validTelegramSecret('x', config.webhookSecret)); assert(!validTelegramSecret('', ''));
  const bot = new TelegramBot(config, async () => { throw new Error(config.token); });
  await assert.rejects(() => bot.call('sendInvoice', {}), error => error instanceof Error && !error.message.includes(config.token));
});
test('invoice creation and checkout never credit; payer, currency, amount and second checkout are checked', async () => {
  const f = await fixture();
  try {
    const order = await f.create(); assert.equal(order.amountUnits, '1000000');
    assert.equal((await f.update(f.message(42, { text: '/start pay_' + order.id }), 'wrong')).status, 401);
    assert.equal((await f.start(order.id)).status, 200);
    assert.equal(f.calls.at(-1)?.method, 'sendInvoice'); assert.equal(f.calls.at(-1)?.body.currency, 'XTR');
    for (const extra of [{ from: { id: 43 } }, { currency: 'USD' }, { total_amount: 101 }]) {
      assert.equal((await f.checkout(order, extra)).status, 200); assert.equal(f.calls.at(-1)?.body.ok, false);
    }
    assert.equal((await f.checkout(order)).status, 200); assert.equal(f.calls.at(-1)?.body.ok, true);
    await f.checkout(order, { id: 'another-checkout' }); assert.equal(f.calls.at(-1)?.body.ok, false);
    assert.equal((await f.wallet.snapshot(f.account) as any).balanceUnits, '0');
    assert.equal((await f.credits.snapshot(f.account)).balanceUnits, '0');
    await assert.rejects(() => f.client.stars(f.other, { id: order.id, stars: 100, termsAccepted: true }));
    assert.deepEqual((await f.client.stars(f.other)).operations, []);
  } finally { await f.close(); }
});
test('paid orders retain their rate; late concurrent receipts credit both ledgers once, even when new sales close', async () => {
  const f = await fixture();
  try {
    const order = await f.create(1000); await f.start(order.id); await f.checkout(order);
    f.config.unitsPerStar = '20000'; f.config.enabled = false; f.later();
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.pay(order)));
    assert(responses.every(response => response.status === 200)); await f.outbox.flush();
    assert.equal((await f.client.snapshot(f.account) as any).balanceUnits, '10000000');
    assert.equal((await f.client.stars(f.account)).operations[0].status, 'paid');
    assert.equal((await f.credits.snapshot(f.other)).balanceUnits, '0');
    assert.equal((await f.db.prepare('SELECT count(*)::int AS n FROM crypto_ledger').get())!.n, 1);
    assert.equal((await f.gameDb.prepare('SELECT count(*)::int AS n FROM payment_credit_events').get())!.n, 1);
    assert.equal((await f.wallet.audit()).ok, true);
    await assert.rejects(() => f.create());
  } finally { await f.close(); }
});
test('invalid and duplicate charges cannot mint money; credit and outbox failures roll back together', async () => {
  const f = await fixture();
  try {
    const order = await f.create(); await f.start(order.id); await f.checkout(order);
    assert.equal((await f.pay(order, { total_amount: 101 })).status, 409);
    const record = f.outbox.record.bind(f.outbox); f.outbox.record = async () => { throw new Error('Test delivery failure'); };
    assert.equal((await f.pay(order)).status, 503); assert.equal((await f.wallet.snapshot(f.account) as any).balanceUnits, '0');
    assert.equal((await f.client.stars(f.account)).operations[0].status, 'checkout');
    f.outbox.record = record; assert.equal((await f.pay(order)).status, 200);
    const second = await f.create(); await f.start(second.id); await f.checkout(second);
    assert.equal((await f.pay(second, { telegram_payment_charge_id: 'charge-' + order.id })).status, 503);
    assert.equal((await f.wallet.snapshot(f.account) as any).balanceUnits, '1000000');
    assert.equal((await f.wallet.audit()).ok, true);
  } finally { await f.close(); }
});
test('Stars credit can use the existing crypto withdrawal without converting or spending Stars', async () => {
  const f = await fixture();
  try {
    const order = await f.create(1000); await f.start(order.id); await f.checkout(order); await f.pay(order);
    const quote = await f.wallet.quote(f.account, { id: randomUUID(), amountUnits: '5000000', currency: 'usdttrc20', address: 'T' + 'A'.repeat(33), memo: '' });
    const operation = { id: randomUUID(), quoteId: quote.id };
    const paid = await f.wallet.withdraw(f.account, operation);
    assert.equal(paid.state, 'finished'); await f.wallet.withdraw(f.account, operation); await f.outbox.flush();
    assert.equal(f.payouts(), 1); assert.equal((await f.client.snapshot(f.account) as any).balanceUnits, '5000000');
    assert.equal((await f.wallet.audit()).ok, true);
    assert(!f.calls.some(call => /refund|withdraw|transfer/i.test(call.method)));
  } finally { await f.close(); }
});
test('refunds arriving before settlement prevent credit; paid refunds block quotes and pending payouts', async () => {
  const f = await fixture();
  try {
    const first = await f.create(); await f.start(first.id); await f.checkout(first);
    assert.equal((await f.refund(first)).status, 200); assert.equal((await f.pay(first)).status, 200);
    assert.equal((await f.wallet.snapshot(f.account) as any).balanceUnits, '0');
    const order = await f.create(1000); await f.start(order.id); await f.checkout(order); await f.pay(order);
    const quote = await f.wallet.quote(f.account, { id: randomUUID(), amountUnits: '5000000', currency: 'usdttrc20', address: 'T' + 'A'.repeat(33), memo: '' });
    const advance = f.wallet.advance.bind(f.wallet); f.wallet.advance = async () => {};
    const payout = await f.wallet.withdraw(f.account, { id: randomUUID(), quoteId: quote.id });
    assert.equal((await f.refund(order)).status, 200); assert.equal((await f.refund(order)).status, 200);
    await advance(payout.id); assert.equal(f.payouts(), 0);
    assert.equal((await f.wallet.operation(f.account, payout.id)).state, 'review');
    await assert.rejects(() => f.wallet.quote(f.account, { id: randomUUID(), amountUnits: '1000000', currency: 'usdttrc20', address: 'T' + 'A'.repeat(33), memo: '' }), /сверка/);
    assert.equal((await f.wallet.audit()).ok, true);
  } finally { await f.close(); }
});
test('reserve includes other accepted checkouts; expired or unfunded invoices are rejected', async () => {
  const f = await fixture();
  try {
    f.reserve('1');
    const first = await f.create(), second = await f.create();
    await f.start(first.id); await f.checkout(first); assert.equal(f.calls.at(-1)?.body.ok, true);
    await f.start(second.id); await f.checkout(second); assert.equal(f.calls.at(-1)?.body.ok, false);
    f.reserve('100'); f.later(); await f.checkout(second); assert.equal(f.calls.at(-1)?.body.ok, false);
    assert.equal((await f.wallet.snapshot(f.account) as any).balanceUnits, '0');
    await f.update(f.message(42, { text: '/paysupport' })); assert.match(f.calls.at(-1)?.body.text, /https:\/\/royal.example\/support/);
  } finally { await f.close(); }
});
