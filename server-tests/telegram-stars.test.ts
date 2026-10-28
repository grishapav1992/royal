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
async function fixture(cryptoEnabled = true) {
  const db = new PostgresDatabase(':memory:'), gameDb = new PostgresDatabase(':memory:');
  const account = randomUUID(), other = randomUUID();
  for (const database of [db, gameDb]) {
    await database.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
    await database.prepare('INSERT INTO accounts VALUES (?),(?)').run(account, other);
  }
  const credits = new PaymentCredits(gameDb), game = express(); installPaymentCredits(game, credits, eventSecret);
  const gameServer = await listen(game), outbox = new PaymentOutbox(db, gameServer.url + '/internal/payments/events', eventSecret);
  let reserve = '1000', payouts = 0, payoutData: any;
  let providerCalls = 0;
  const providerMethods = { balance: async () => ({ usdttrc20: { amount: reserve } }),
    currencies: async () => [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }],
    minimum: async () => '0.001', estimate: async (_from: string, _to: string, value: string) => value,
    createPayment: async (id: string, currency: string, value: string) => ({ payment_id: '101', order_id: id,
      pay_currency: currency, price_currency: 'usdttrc20', price_amount: value, pay_amount: value,
      pay_address: 'T' + 'A'.repeat(33), payment_status: 'waiting' }),
    validateAddress: async () => {}, fee: async () => '0.01',
    createPayout: async (id: string, currency: string, address: string, memo: string, amount: string) => {
      payouts++; payoutData = { id: '301', batch_withdrawal_id: '401', unique_external_id: id, currency, address, extra_id: memo,
        amount, status: 'finished', hash: 'fixture-payout' };
      return { id: '401', withdrawals: [payoutData] };
    }, payout: async () => payoutData, verify: async () => {} };
  const provider = new Proxy(providerMethods, { get(target, key) {
    const method = Reflect.get(target, key);
    return typeof method !== 'function' ? method : (...args: unknown[]) => {
      providerCalls++; if (!cryptoEnabled) throw new Error('Stars must not call the disabled crypto provider');
      return method(...args);
    };
  } }) as unknown as CryptoProvider;
  const wallet = new CryptoStore(db, { ...cryptoConfig({}), enabled: cryptoEnabled, withdrawals: cryptoEnabled }, provider,
    outbox.ready, undefined, undefined, event => outbox.record(event), true);
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
    reserve: (value: string) => { reserve = value; }, later: () => { now += 3600000; }, payouts: () => payouts, providerCalls: () => providerCalls,
    close: async () => { await paymentServer.close(); await gameServer.close(); await db.close(); await gameDb.close(); } };
}
test('Stars configuration fails closed and Telegram API failures never expose the token', async () => {
  assert.equal(telegramStarsConfig({}).enabled, false); assert.equal(telegramStarsConfig({}).unitsPerStar, '10000');
  assert.throws(() => telegramStarsConfig({ TELEGRAM_STARS_ENABLED: 'true' }));
  assert.throws(() => telegramStarsConfig({ TELEGRAM_STARS_USDT_UNITS_PER_STAR: '0.013' }));
  assert.throws(() => telegramStarsConfig({ TELEGRAM_STARS_TRIAL: 'true' }));
  assert.throws(() => telegramStarsConfig({ TELEGRAM_STARS_TRIAL_ACCOUNT_IDS: randomUUID() }));
  const config = configured(); assert(validTelegramSecret(config.webhookSecret, config.webhookSecret));
  assert(!validTelegramSecret('x', config.webhookSecret)); assert(!validTelegramSecret('', ''));
  const bot = new TelegramBot(config, async () => { throw new Error(config.token); });
  await assert.rejects(() => bot.call('sendInvoice', {}), error => error instanceof Error && !error.message.includes(config.token));
});
test('NOWPayments and Stars add to the same account balance and mirror, with no second wallet per provider', async () => {
  const f = await fixture();
  try {
    const request = { id: randomUUID(), currency: 'usdttrc20', amountUnits: '5000000' };
    await f.client.deposit(f.account, request);
    const order = await f.create(); await f.start(order.id); await f.checkout(order);
    const settled = { payment_id: '101', order_id: request.id, pay_currency: 'usdttrc20', price_currency: 'usdttrc20',
      price_amount: '5', pay_amount: '5', pay_address: 'T' + 'A'.repeat(33), payment_status: 'finished',
      outcome_currency: 'usdttrc20', outcome_amount: '5' };
    await Promise.all([f.wallet.applyPayment(settled), f.pay(order)]);
    await Promise.all([f.wallet.applyPayment(settled), f.pay(order)]); await f.outbox.flush();
    const wallet = await f.client.snapshot(f.account);
    assert.equal((wallet as any).balanceUnits, '6000000');
    assert.equal((wallet as any).operations.length, 2);
    assert.equal((await f.credits.snapshot(f.account)).balanceUnits, '6000000');
    assert.equal((await f.credits.snapshot(f.other)).balanceUnits, '0');
    assert.equal((await f.db.prepare('SELECT count(*)::int AS n FROM crypto_wallets WHERE account_id=?').get(f.account))!.n, 1);
    assert.equal((await f.db.prepare('SELECT count(*)::int AS n FROM crypto_ledger').get())!.n, 2);
    assert.equal((await f.gameDb.prepare('SELECT count(*)::int AS n FROM payment_credit_events').get())!.n, 2);
    assert.equal((await f.wallet.audit()).ok, true);
  } finally { await f.close(); }
});
test('owner trial accepts exactly one 100-Star checkout, restricts accounts, and preserves receipt retries', async () => {
  const f = await fixture(false);
  try {
    f.config.trialAccountIds = [f.account];
    assert.equal((await f.client.stars(f.account)).maxStars, 100);
    assert.equal((await f.client.stars(f.other)).enabled, false);
    await assert.rejects(() => f.client.stars(f.other, { id: randomUUID(), stars: 100, termsAccepted: true }));
    await assert.rejects(() => f.create(101));
    const orders = await Promise.all([f.create(), f.create()]);
    await Promise.all(orders.map(order => f.start(order.id)));
    await Promise.all(orders.map(order => f.checkout(order)));
    const accepted = f.calls.filter(call => call.method === 'answerPreCheckoutQuery' && call.body.ok);
    assert.equal(accepted.length, 1);
    const order = orders.find(order => 'checkout-' + order.id === accepted[0].body.pre_checkout_query_id)!;
    await f.checkout(order); assert.equal(f.calls.at(-1)?.body.ok, true);
    f.config.enabled = false;
    await f.pay(order); await f.pay(order); await f.outbox.flush();
    assert.equal((await f.client.snapshot(f.account) as any).balanceUnits, '1000000');
    assert.equal((await f.db.prepare('SELECT count(*)::int AS n FROM crypto_ledger').get())!.n, 1);
    f.config.enabled = true;
    await assert.rejects(() => f.create(), /уже принят/);
    assert.equal(f.providerCalls(), 0);
  } finally { await f.close(); }
});
test('trial terms are public without exposing account IDs, while webhooks still require a secret', async () => {
  const f = await fixture(false);
  try {
    f.config.trialAccountIds = [f.account];
    const server = await listen(createPaymentApp(f.wallet, requestSecret, f.stars));
    try {
      const response = await fetch(server.url + '/api/telegram-stars/terms');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /text\/plain/);
      const terms = await response.text();
      assert.match(terms, /100 Telegram Stars/); assert.match(terms, /1 USDT/);
      assert(!terms.includes(f.account)); assert(!terms.includes(f.config.token));
    } finally { await server.close(); }
  } finally { await f.close(); }
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
test('Stars credits and wallet reads work without any crypto-provider configuration or calls', async () => {
  const f = await fixture(false);
  try {
    const newcomer = randomUUID(); await f.gameDb.prepare('INSERT INTO accounts(id) VALUES (?)').run(newcomer);
    assert.equal((await f.client.snapshot(newcomer) as any).state, 'enabled');
    assert.equal((await f.client.stars(f.account)).enabled, true);
    const order = await f.create(); await f.start(order.id); await f.checkout(order);
    assert.equal(f.calls.at(-1)?.body.ok, true); await f.pay(order); await f.pay(order); await f.outbox.flush();
    const wallet = await f.client.snapshot(f.account);
    assert.equal(wallet.state, 'enabled'); assert.equal((wallet as any).balanceUnits, '1000000');
    assert.equal((wallet as any).cryptoDepositsEnabled, false); assert.equal((wallet as any).withdrawalsEnabled, false);
    assert.equal((wallet as any).gamesEnabled, false);
    await assert.rejects(() => f.client.deposit(f.account, { id: randomUUID(), amountUnits: '1000000', currency: 'usdttrc20' }));
    await assert.rejects(() => f.client.quote(f.account, { id: randomUUID(), amountUnits: '1000000', currency: 'usdttrc20', address: 'T' + 'A'.repeat(33), memo: '' }));
    f.config.enabled = false; await f.pay(order); await f.outbox.flush();
    assert.equal((await f.client.snapshot(f.account) as any).balanceUnits, '1000000');
    assert.equal((await f.client.stars(f.account)).enabled, false);
    assert.equal(f.providerCalls(), 0); assert.equal((await f.wallet.audit()).ok, true);
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
test('checkout accounts for pending amounts at the wallet cap and rejects expired invoices', async () => {
  const f = await fixture();
  try {
    f.reserve('1');
    await f.wallet.creditStarsDeposit(f.account, randomUUID(), '999999000000', 'historical-stars-credit', 10000);
    const first = await f.create(), second = await f.create();
    await f.start(first.id); await f.checkout(first); assert.equal(f.calls.at(-1)?.body.ok, true);
    await f.start(second.id); await f.checkout(second); assert.equal(f.calls.at(-1)?.body.ok, false);
    await f.checkout(first); assert.equal(f.calls.at(-1)?.body.ok, true);
    await f.pay(first); assert.equal((await f.wallet.snapshot(f.account) as any).balanceUnits, '1000000000000');
    f.later(); await f.checkout(second); assert.equal(f.calls.at(-1)?.body.ok, false);
    assert.equal(f.providerCalls(), 0);
    await f.update(f.message(42, { text: '/paysupport' })); assert.match(f.calls.at(-1)?.body.text, /https:\/\/royal.example\/support/);
  } finally { await f.close(); }
});
