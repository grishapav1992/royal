import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { isAuditRecord } from '../server/audit/contract';
import { resolvePaymentMirror, resolvePaymentPosting, type PaymentPostingKey } from '../server/audit/payments';
import { DemoWalletStore } from '../server/demoWallet';
import { CasinoApiProWallet } from '../server/casinoApiProWallet';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { PostgresDatabase } from '../server/database';
import { MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';
import { PaymentCredits } from '../server/payments/credits';
import { PaymentOutbox } from '../server/payments/outbox';
import { SandboxPaymentStore } from '../server/payments/sandbox';
import { LiveFreeSpinService } from '../server/progression/freeSpins';
import { ProgressionStore } from '../server/progression/store';
import { releaseProviderPending } from '../server/providerPending';
import { CommonSkinPayments } from '../server/skinPayments';
import { DEFAULT_PROGRESSION_POLICY } from '../src/shared/progression';

const accountId = randomUUID();
const scope = { datasetId: randomUUID(), environment: 'test' as const };

async function newDb() {
  const db = new PostgresDatabase(':memory:');
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts VALUES (?)').run(accountId);
  return db;
}

async function allPostings(db: PostgresDatabase, table: PaymentPostingKey['table']) {
  const rows = await db.prepare(`SELECT l.id::text AS id FROM ${table} l ORDER BY l.id`).all();
  return Promise.all(rows.map(async row => {
    const resolved = await resolvePaymentPosting(db, { table, rowId: row.id });
    assert(resolved);
    assert(isAuditRecord({ schemaVersion: 1, type: 'posting', scope, ...resolved.posting }));
    return resolved;
  }));
}

test('canonical payment postings distinguish reserves, paid withdrawals, refunds, Stars and mirrors', async () => {
  const payments = await newDb(), game = await newDb();
  try {
    const credits = new PaymentCredits(game);
    let payment: Record<string, unknown> = {};
    let payout: Record<string, unknown> = {};
    let rejectNext = false;
    let payoutNumber = 0;
    const provider: CryptoProvider = {
      currencies: async () => [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }],
      minimum: async () => '0.001', estimate: async (_from, _to, value) => value,
      balance: async () => ({ usdttrc20: { amount: '1000' } }),
      fee: async () => '0.01', validateAddress: async () => {}, verify: async () => {},
      createPayment: async (id, currency, value) => {
        payment = { payment_id: '101', order_id: id, pay_currency: currency, price_currency: 'usdttrc20',
          price_amount: value, pay_amount: value, payment_status: 'waiting', outcome_currency: 'usdttrc20' };
        return payment;
      },
      payment: async () => payment,
      convert: async () => { throw new Error('Unexpected conversion'); },
      conversion: async () => { throw new Error('Unexpected conversion lookup'); },
      createPayout: async (id, currency, address, memo, amount) => {
        payout = { id: String(201 + payoutNumber++), unique_external_id: id, currency, address,
          extra_id: memo, amount, status: rejectNext ? 'rejected' : 'finished' };
        return { id: '301', withdrawals: [payout] };
      },
      payout: async () => payout,
    };
    const outbox = new PaymentOutbox(payments, 'http://game/internal/payments/events', 'a'.repeat(64), undefined,
      async (_url, init) => Response.json(await credits.apply(JSON.parse(String(init?.body)))));
    const wallet = new CryptoStore(payments, { ...cryptoConfig({}), enabled: true, withdrawals: true }, provider,
      outbox.ready, undefined, undefined, change => outbox.record(change));
    await wallet.ready;
    const depositId = randomUUID();
    await wallet.deposit(accountId, { id: depositId, amountUnits: '25000000', currency: 'usdttrc20' });
    await wallet.applyPayment({ ...payment, payment_status: 'finished', outcome_amount: '25' });
    await wallet.applyPayment({ ...payment, payment_status: 'finished', outcome_amount: '27' });
    await wallet.applyPayment({ ...payment, payment_status: 'finished', outcome_amount: '27' });

    for (const shouldReject of [false, true]) {
      rejectNext = shouldReject;
      const quote = await wallet.quote(accountId, { id: randomUUID(), amountUnits: '5000000',
        currency: 'usdttrc20', address: 'T' + 'A'.repeat(33), memo: '' });
      await wallet.withdraw(accountId, { id: randomUUID(), quoteId: quote.id });
    }
    const starsId = randomUUID();
    await wallet.creditStarsDeposit(accountId, starsId, '1000000', 'fixture-stars-charge', 100);
    await wallet.holdStarsRefund(accountId, starsId);
    const starsRows = await payments.prepare('SELECT id FROM crypto_ledger WHERE operation_id=?').all(starsId);
    assert.equal(starsRows.length, 1);
    const adjustId = randomUUID();
    await wallet.adminAdjust({ id: adjustId, actorId: accountId, playerId: accountId,
      deltaUnits: '2000000', reason: 'Audit fixture adjustment' }, new Set([accountId]));

    const rows = await allPostings(payments, 'crypto_ledger');
    assert.deepEqual(rows.map(({ posting, paymentSource }) => [
      paymentSource, posting.movement, posting.availableDeltaUnits, posting.reservedDeltaUnits,
    ]), [
      ['nowpayments', 'deposit', '25000000', '0'],
      ['nowpayments', 'deposit', '2000000', '0'],
      ['nowpayments', 'withdrawal-reserve', '-5000000', '5000000'],
      ['nowpayments', 'withdrawal-paid', '0', '-5000000'],
      ['nowpayments', 'withdrawal-reserve', '-5000000', '5000000'],
      ['nowpayments', 'refund', '5000000', '-5000000'],
      ['telegram-stars', 'deposit', '1000000', '0'],
      ['payment-adjustment', 'adjustment', '2000000', '0'],
    ]);
    assert.equal(rows[0].posting.operationId, depositId);
    assert.equal(rows[0].posting.operationId, rows[1].posting.operationId);
    assert.notEqual(rows[0].posting.source.rowId, rows[1].posting.source.rowId);
    assert.deepEqual(rows.at(-1)!.operation, { namespace: payments.schema + '.finance_adjustments', rowId: adjustId });
    assert.deepEqual(rows.at(-1)!.posting.asset, { contour: 'real', code: 'USDT', scale: 6 });
    assert.equal(rows.at(-1)!.posting.availableAfterUnits, '25000000');
    assert.equal(rows.at(-1)!.posting.reservedAfterUnits, '0');
    assert(rows.every(row => row.posting.coverage === 'complete'));

    const eventId = rows[0].deliveryEventId!;
    assert.equal((await resolvePaymentMirror(payments, { table: 'payment_outbox', eventId }))?.state, 'queued');
    await credits.ready;
    assert.equal(await resolvePaymentMirror(game, { table: 'payment_credit_events', eventId }), null);
    await outbox.flush();
    const sent = await resolvePaymentMirror(payments, { table: 'payment_outbox', eventId });
    const received = await resolvePaymentMirror(game, { table: 'payment_credit_events', eventId });
    assert.equal(sent?.state, 'acknowledged');
    assert.equal(received?.state, 'applied');
    assert.equal(received?.operationId, sent?.operationId);
    assert.equal(received?.accountId, sent?.accountId);
    assert.equal(received?.eventId, eventId);
    assert(!Object.hasOwn(received!, 'posting'));
    assert.equal((await allPostings(payments, 'crypto_ledger')).length, rows.length);
  } finally {
    await payments.close();
    await game.close();
  }
});

test('Sandbox partial credits are distinct virtual postings for one order and old top-ups retain their source', async () => {
  const db = await newDb();
  try {
    const wallet = new DemoWalletStore(db);
    const oldId = randomUUID();
    await wallet.operate(accountId, { id: oldId, kind: 'deposit', amount: 1 });
    let payment: Record<string, unknown> = {};
    const sandbox = new SandboxPaymentStore(db, { enabled: true, apiKey: 'fixture', ipnSecret: 'fixture',
      origin: 'https://royal.example.test', currency: 'btc' }, {
      create: async (id, amount) => {
        payment = { payment_id: '101', order_id: id, price_amount: amount, price_currency: 'usd',
          pay_currency: 'btc', pay_amount: '0.01', actually_paid: '0', payment_status: 'waiting' };
        return payment;
      },
      payment: async () => payment,
    }, wallet.ready);
    const sandboxId = randomUUID();
    await sandbox.create(accountId, { id: sandboxId, amount: 10, scenario: 'partially_paid' });
    Object.assign(payment, { actually_paid: '0.0025', payment_status: 'partially_paid' });
    await sandbox.refresh(accountId, sandboxId);
    await sandbox.refresh(accountId, sandboxId);
    Object.assign(payment, { actually_paid: '0.01', payment_status: 'finished' });
    await sandbox.refresh(accountId, sandboxId);
    const [old, partial, final] = await allPostings(db, 'demo_ledger');
    assert.equal(old.paymentSource, 'legacy-direct-topup');
    assert.deepEqual(old.operation, { namespace: db.schema + '.demo_operations', rowId: JSON.stringify([accountId, oldId]) });
    assert.equal(partial.paymentSource, 'nowpayments-sandbox');
    assert.equal(partial.posting.operationId, 'nowpayments-sandbox:' + sandboxId);
    assert.equal(final.posting.operationId, partial.posting.operationId);
    assert.deepEqual([partial.posting.availableDeltaUnits, final.posting.availableDeltaUnits], ['250', '750']);
    assert.notEqual(partial.posting.source.rowId, final.posting.source.rowId);
    assert.deepEqual(final.operation, { namespace: db.schema + '.nowpayments_sandbox_deposits', rowId: sandboxId });
    assert.deepEqual(final.posting.asset, { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 });
    assert.equal(final.posting.availableAfterUnits, '1100');
  } finally {
    await db.close();
  }
});

test('skin purchases and reward spins keep their non-stake meaning', async () => {
  const db = await newDb();
  try {
    const wallet = new DemoWalletStore(db);
    await wallet.ready;
    await saveDemoUnits(db, accountId, 5000);
    const skin = new CommonSkinPayments(db, wallet.ready), reserved = randomUUID(), captured = randomUUID();
    await skin.skinPurchase(accountId, reserved, 'reserve');
    await skin.skinPurchase(accountId, reserved, 'refund');
    await skin.skinPurchase(accountId, captured, 'reserve');
    await skin.skinPurchase(accountId, captured, 'capture');
    const progression = new ProgressionStore(db, { now: () => 1000 });
    const rewards = new LiveFreeSpinService(db, wallet, progression, () => 0, () => 1000);
    await rewards.ready;
    const grantId = randomUUID(), spinId = randomUUID();
    await db.prepare(`INSERT INTO progression_rewards(id,account_id,location_id,milestone_id,policy_version,type,
      level,game_id,count,remaining,nominal_units,currency,rules_version,created_at,pool_id)
      VALUES(?,?,?,?,?,'free_spins',5,'',1,1,'500000','VIRTUAL_USD',1,1000,'royal-slots-v1')`)
      .run(grantId, accountId, 'south-park', grantId, DEFAULT_PROGRESSION_POLICY.version);
    await rewards.spin(accountId, { id: spinId, grantId, gameId: 'royal-coins' });
    const rows = await allPostings(db, 'demo_ledger');
    assert.deepEqual(rows.map(row => row.posting.movement), ['purchase', 'refund', 'purchase', 'reward']);
    assert.deepEqual(rows[0].operation, { namespace: db.schema + '.skin_purchases', rowId: reserved });
    assert.equal(rows[1].operation?.rowId, reserved);
    assert.equal(rows[2].operation?.rowId, captured);
    assert.deepEqual(rows[3].operation,
      { namespace: db.schema + '.progression_spin_uses', rowId: JSON.stringify([accountId, spinId]) });
    assert(rows.every(row => row.posting.reservedDeltaUnits === null));
  } finally {
    await db.close();
  }
});

test('Casino Api Pro preserves pending postings and its internal releases never appear as a new win', async () => {
  const db = await newDb();
  try {
    const wallet = new DemoWalletStore(db), provider = new CasinoApiProWallet(db);
    await Promise.all([wallet.ready, provider.ready]);
    await saveDemoUnits(db, accountId, MAX_DEMO_UNITS - 20);
    const playerId = await provider.player(accountId);
    const callback = { playerId, currency: 'USD', transactionId: 'transfer:provider-credit', amount: '1.00' };
    await provider.callback('credit', callback, 'USD');
    await provider.callback('credit', callback, 'USD');
    await provider.callback('debit', { ...callback, transactionId: 'provider-debit', amount: '0.30' }, 'USD');
    await db.transaction(async () => {
      await saveDemoUnits(db, accountId, MAX_DEMO_UNITS - 100);
      await releaseProviderPending(db, accountId);
    }, { lockKey: 'account:' + accountId });

    const available = await allPostings(db, 'demo_ledger');
    const pending = await allPostings(db, 'capro_pending_ledger');
    assert.deepEqual(available.map(row => [row.posting.movement, row.posting.availableDeltaUnits]),
      [['payout', '20'], ['stake', '0'], ['release', '50']]);
    assert.deepEqual(pending.map(row => [row.posting.movement, row.pendingDeltaUnits, row.pendingAfterUnits]),
      [['payout', '80', '80'], ['stake', '-30', '50'], ['release', '-50', '0']]);
    assert.deepEqual(available[0].operation, { namespace: db.schema + '.capro_transactions', rowId: callback.transactionId });
    assert.deepEqual(available[2].operation, pending[2].posting.source);
    assert.deepEqual(pending[2].operation, available[2].posting.source);
    assert.equal(pending[2].posting.operationId, available[2].posting.operationId);
    assert.equal(pending[2].posting.availableDeltaUnits, '0');
    assert.equal(pending[2].posting.availableAfterUnits, null);
  } finally {
    await db.close();
  }
});

test('a resolver never imports an uncommitted source row or invents an absent operation link', async () => {
  const db = await newDb();
  const reader = new PostgresDatabase(db.schema, { readOnly: true });
  try {
    const wallet = new DemoWalletStore(db);
    await wallet.ready;
    let rowId!: string;
    await db.transaction(async () => {
      await recordDemoUnits(db, accountId, randomUUID(), 'deposit', 100, 100, 'royal-coins');
      rowId = (await db.prepare('SELECT id::text FROM demo_ledger').get())!.id;
      const key = { table: 'demo_ledger', rowId } as const;
      assert.equal(await resolvePaymentPosting(reader, key), null);
      await assert.rejects(() => resolvePaymentPosting(db, key), /independent source snapshot/);
    });
    const posting = await resolvePaymentPosting(reader, { table: 'demo_ledger', rowId });
    assert.equal(posting?.posting.coverage, 'partial');
    assert.equal(posting?.operation, null);
    assert.equal(await resolvePaymentPosting(reader, { table: 'demo_ledger', rowId: '9223372036854775808' }), null);
  } finally {
    await reader.close();
    await db.close();
  }
});
