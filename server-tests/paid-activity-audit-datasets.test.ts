import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuditPostingReader } from '../server/audit/postings';
import { PvpStore } from '../server/pvp/store';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { AuditDatasets } from '../server/audit/datasets';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { PaymentCredits } from '../server/payments/credits';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const game = new PostgresDatabase(':memory:'), payment = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => {
    await Promise.all([game.close(), payment.close(), audit.close()]);
  });
  const player = randomUUID(), opponent = randomUUID();
  for (const db of [game, payment]) {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(player, opponent);
  }
  const wallet = new DemoWalletStore(game);
  const crypto = new CryptoStore(payment, cryptoConfig({}), {} as CryptoProvider, undefined, undefined, undefined, undefined, true);
  const credits = new PaymentCredits(game);
  await Promise.all([wallet.ready, crypto.ready, credits.ready]);
  const datasets = new AuditDatasets(audit, { game: game.schema, payments: payment.schema });
  await datasets.ready;
  const refs = () => audit.prepare(`SELECT dataset_id::text,source_namespace,source_row_id::text,operation_id
    FROM audit_posting_refs ORDER BY source_namespace,source_row_id`).all();
  return { game, payment, audit, player, opponent, wallet, crypto, credits, datasets, refs };
}

test('captures opening game and payment balances, earlier PvP holds, and only later canonical postings', async t => {
  const f = await fixture(t);
  for (const accountId of [f.player, f.opponent]) {
    await f.wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  }
  const pvp = new VirtualPvpLedger(f.game, f.wallet);
  await Promise.all([new PvpStore(pvp).ready, new NileCombatEscrow(pvp).ready]);
  const matchId = randomUUID();
  for (const accountId of [f.player, f.opponent]) {
    await pvp.pvpHold(accountId, { matchId, gameId: 'chess', stakeUnits: '10000000' });
  }
  const olderDeposit = randomUUID();
  await f.crypto.creditStarsDeposit(f.player, olderDeposit, '1000000', 'opening-charge', 100);
  const dataset = await f.datasets.startTest();
  assert.equal(dataset.environment, 'test');
  assert.deepEqual(await f.datasets.startTest(), dataset);
  assert.deepEqual(await f.refs(), []);
  const oldPaymentMirror = { event_id: createHash('sha256').update('deposit:telegram-stars:opening-charge').digest('hex'),
    user_id: f.player, payment_id: olderDeposit, kind: 'deposit', currency: 'USDT', scale: 6, deposit_amount: '1',
    available_delta_units: '1000000', reserved_delta_units: '0', created_at: 1 };
  await f.credits.apply(oldPaymentMirror);
  assert.deepEqual(await f.refs(), []);
  const balance = await f.audit.prepare(`SELECT available_units::text,pending_units::text FROM audit_opening_balances
    WHERE dataset_id=? AND account_id=? AND source_namespace=?`).get(dataset.datasetId, f.player, f.game.schema + '.demo_ledger');
  assert.deepEqual(balance, { available_units: '9000', pending_units: '0' });
  const real = await f.audit.prepare(`SELECT available_units::text,reserved_units::text FROM audit_opening_balances
    WHERE dataset_id=? AND account_id=? AND source_namespace=?`).get(dataset.datasetId, f.player, f.payment.schema + '.crypto_ledger');
  assert.deepEqual(real, { available_units: '1000000', reserved_units: '0' });
  const open = await f.audit.prepare(`SELECT entity_id,principal_units::text FROM audit_opening_obligations
    WHERE dataset_id=? AND source_namespace=? ORDER BY account_id`).all(dataset.datasetId, f.game.schema + '.virtual_pvp_holds');
  assert.deepEqual(open, Array.from({ length: 2 }, () => ({ entity_id: matchId, principal_units: '1000' })));

  await pvp.pvpFinish(f.player, { matchId, winnerId: null, reason: 'draw' });
  await pvp.pvpFinish(f.player, { matchId, winnerId: null, reason: 'draw' });
  const currentDeposit = randomUUID();
  await f.crypto.creditStarsDeposit(f.player, currentDeposit, '1000000', 'captured-charge', 100);
  const rows = await f.refs();
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.dataset_id === dataset.datasetId));
  assert.deepEqual(rows.map(row => row.operation_id).sort(), [currentDeposit, 'pvp:' + matchId + ':final', 'pvp:' + matchId + ':final'].sort());
  assert.equal(rows.filter(row => row.source_namespace === f.payment.schema + '.crypto_ledger').length, 1);
  const recoverable = await f.audit.prepare(`SELECT count(*)::int AS count FROM audit_posting_refs r
    JOIN audit_opening_obligations o ON o.dataset_id=r.dataset_id AND o.account_id=r.account_id
    AND r.operation_id='pvp:'||o.entity_id||':final'
    WHERE o.source_namespace=?`).get(f.game.schema + '.virtual_pvp_holds');
  assert.equal(recoverable?.count, 2);

  const reader = new AuditPostingReader(f.audit, f.game, f.payment);
  for (const row of rows) {
    const result = await reader.read(dataset.datasetId, { namespace: row.source_namespace, rowId: row.source_row_id });
    assert.equal(result.status, 'found');
    assert.equal(result.posting.scope.environment, 'test');
    assert.equal(result.posting.operationId, row.operation_id);
    if (row.operation_id === currentDeposit) assert.equal(result.posting.asset.contour, 'real');
    else {
      assert.equal(result.posting.entity?.category, 'pvp');
      assert.equal(result.posting.movement, 'refund');
      assert.equal(result.openAtStart, true);
    }
  }
  const capturedPayment = rows.find(row => row.operation_id === currentDeposit)!;
  assert.deepEqual(await new AuditPostingReader(f.audit, f.game).read(dataset.datasetId,
    { namespace: capturedPayment.source_namespace, rowId: capturedPayment.source_row_id }), { status: 'source-unavailable' });
  const casinoId = randomUUID();
  await f.wallet.operate(f.player, { id: casinoId, kind: 'play', gameId: 'royal-plinko', input: { rows: 12, risk: 'easy' },
    rulesVersion: 1, stakePolicyVersion: 1, amount: 0.1 });
  const casinoRows = (await f.refs()).filter(row => row.operation_id === casinoId);
  assert.equal(casinoRows.length, 2);
  for (const row of casinoRows) {
    const result = await reader.read(dataset.datasetId, { namespace: row.source_namespace, rowId: row.source_row_id });
    assert.equal(result.status, 'found');
    assert.equal(result.posting.entity?.category, 'casino');
    assert.equal(result.posting.entity?.gameId, 'royal-plinko');
  }
  const old = await f.payment.prepare('SELECT id::text FROM crypto_ledger WHERE operation_id=?').get(olderDeposit);
  assert.deepEqual(await reader.read(dataset.datasetId, { namespace: f.payment.schema + '.crypto_ledger', rowId: old!.id }),
    { status: 'not-captured' });
});

test('busy cutover rolls back and retry includes the writer in the baseline', async t => {
  const f = await fixture(t);
  const writer = await f.game.pool.connect();
  try {
    await writer.query('BEGIN');
    await writer.query(`INSERT INTO demo_wallets(account_id,balance,fraction_units) VALUES ($1,10,0)`, [f.player]);
    await writer.query(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type)
      VALUES ($1,'before','deposit',10,10,1,1000,1000,'deposit')`, [f.player]);
    await assert.rejects(f.datasets.startTest(), { code: '55P03' });
    assert.deepEqual(await f.audit.prepare('SELECT id FROM audit_datasets').all(), []);
    await writer.query('COMMIT');
    const dataset = await f.datasets.startTest();
    assert.deepEqual(await f.refs(), []);
    const row = await f.audit.prepare('SELECT available_units::text FROM audit_opening_balances WHERE dataset_id=? AND account_id=?')
      .get(dataset.datasetId, f.player);
    assert.equal(row?.available_units, '1000');
  } finally {
    await writer.query('ROLLBACK').catch(() => {});
    writer.release();
  }
});

test('membership follows the source transaction, independent of ID allocation, rollback and sealing', async t => {
  const f = await fixture(t);
  const earlier = (await f.game.prepare("SELECT nextval(pg_get_serial_sequence('demo_ledger','id')) AS id").get())!.id;
  const first = await f.datasets.startTest();
  await f.wallet.operate(f.opponent, { id: '9fb8b553-7b09-465f-af44-d0e352c6289c', kind: 'deposit', amount: 1 });
  await f.game.transaction(async () => {
    await saveDemoUnits(f.game, f.player, 100);
    await f.game.prepare(`INSERT INTO demo_ledger(id,account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type)
      VALUES (?,?,'lower-id','deposit',1,1,1,100,100,'deposit')`).run(earlier, f.player);
  });
  await assert.rejects(f.game.transaction(async () => {
    await recordDemoUnits(f.game, f.player, 'rolled-back', 'deposit', 100, 200);
    await f.game.exec('SET CONSTRAINTS ALL IMMEDIATE');
    throw new Error('abort');
  }), /abort/);
  assert.deepEqual((await f.refs()).map(row => row.operation_id), ['lower-id', '9fb8b553-7b09-465f-af44-d0e352c6289c']);
  await f.datasets.sealTest(first.datasetId);
  await f.datasets.sealTest(first.datasetId);
  await f.wallet.operate(f.player, { id: randomUUID(), kind: 'deposit', amount: 1 });
  assert.equal((await f.refs()).length, 2);
  const next = await f.datasets.startTest();
  assert.notEqual(next.datasetId, first.datasetId);
  const post = randomUUID();
  await f.wallet.operate(f.player, { id: post, kind: 'deposit', amount: 1 });
  assert.equal((await f.refs()).find(row => row.operation_id === post)?.dataset_id, next.datasetId);
});
