import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { migrateAuditAttemptCapture } from '../server/audit/attempts';
import type { AuditAttempt, AuditSourceRef } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { auditCommandRoutes, observeAuditIntent } from '../server/audit/intents';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { buildAuditReconciliation } from '../server/audit/report-reconcile-core';
import { buildAuditPeriodPageReconciliation, buildAuditPeriodReconciliation } from '../server/audit/report-reconcile-period-core';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { recordDemoUnits } from '../server/demoWalletAmounts';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { FlagToteStore } from '../server/flagTote';
import { saveProviderPendingUnits } from '../server/providerPending';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { TOTE_TIMING } from '../src/shared/flagTote';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const payments = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close(), payments.close()]); });
  const account = randomUUID(), other = randomUUID(), oldId = randomUUID();
  for (const db of [game, payments]) {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(account, other);
  }
  const wallet = new DemoWalletStore(game, () => 0);
  await wallet.operate(account, { id: oldId, kind: 'deposit', amount: 100 });
  await wallet.operate(other, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const provider = { balance: async () => ({ usdttrc20: { amount: '1000' } }) } as unknown as CryptoProvider;
  const crypto = new CryptoStore(payments, { ...cryptoConfig({}), enabled: true }, provider);
  await crypto.creditStarsDeposit(account, randomUUID(), '1000000', 'opening-' + randomUUID(), 100);
  const sources = { game: game.schema, payments: payments.schema };
  const datasets = new AuditDatasets(audit, sources);
  const ledger = game.schema + '.demo_ledger', pending = game.schema + '.capro_pending_ledger';
  const capture = async (operation: string, accountId = account, entry = 'bet'): Promise<AuditSourceRef> => {
    const row = await game.prepare('SELECT id::text FROM demo_ledger WHERE operation_id=? AND account_id=? AND entry_type=?')
      .get(operation, accountId, entry);
    assert(row);
    return { namespace: ledger, rowId: row.id };
  };
  return { game, payments, audit, account, other, oldId, wallet, crypto, sources, datasets, ledger, pending, capture };
}

test('selected casino posting compares its scoped balance, exact attempt and operation, with an exact replay link', async t => {
  const f = await fixture(t);
  const { datasetId, environment } = await f.datasets.startTest();
  const scope = { datasetId, environment };
  const op = { id: randomUUID(), kind: 'play', gameId: 'royal-plinko', amount: 1,
    input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1 };
  for (const account of [f.account, f.other]) await f.wallet.operate(account, op);
  const anchor = await f.capture(op.id);
  const snapshot = await f.capture(op.id, f.account, 'win');
  const otherAnchor = await f.capture(op.id, f.other);
  const evidence = new AuditEvidence(f.audit, f.audit.schema);
  const recordAttempt = async (accountId: string, head: AuditSourceRef) => {
    const route = auditCommandRoutes.core, attemptId = randomUUID();
    const attempt: AuditAttempt = { schemaVersion: 1, scope, type: 'attempt', accountId, operationId: op.id,
      attemptId, occurredAtMs: Date.now(), route, entity: null, transport: 'http', response: 'formed',
      decision: 'unknown', statusCode: 200, delivery: 'handed-off', intentFingerprint: observeAuditIntent(route, accountId, op.id, op),
      balance: { state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 }, units: '-100', snapshot: head } };
    await evidence.record(attempt);
    return attemptId;
  };
  const attemptId = await recordAttempt(f.account, snapshot);
  const foreignAttempt = await recordAttempt(f.other, await f.capture(op.id, f.other, 'win'));
  const replayId = randomUUID(), foreignReplayId = randomUUID();
  assert.equal((await persistCapturedCasinoReplay(f.audit,
    { datasetId, gameSchema: f.game.schema, posting: anchor, replayId })).status, 'stored');
  assert.equal((await persistCapturedCasinoReplay(f.audit,
    { datasetId, gameSchema: f.game.schema, posting: otherAnchor, replayId: foreignReplayId })).status, 'stored');
  const build = (target = anchor) => buildAuditReconciliation(f.audit, f.sources, datasetId, target);
  const report = await build();
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.scope, scope);
  assert.equal(report.accountId, f.account);
  assert.deepEqual(report.requiredSources, [f.ledger]);
  assert.equal(report.entity?.gameId, 'royal-plinko');
  const found = (rule: string, code: string) => report.findings.find(item => item.rule === rule && item.code === code);
  assert.equal(found('R-01', 'available-balance-opening')?.status, 'match');
  assert.equal(found('R-01', 'stake-direction')?.observed, '-100');
  const wrong = found('R-02', 'response-balance');
  assert.equal(wrong?.status, 'mismatch');
  assert.equal(wrong?.observed, '-100');
  assert.equal(wrong?.expected, (await f.game.prepare('SELECT balance_units::text FROM demo_ledger WHERE id=?')
    .get(snapshot.rowId))!.balance_units);
  assert(wrong?.sources.some(ref => ref.rowId === snapshot.rowId));
  assert.equal(found('R-03', 'same-accepted-intent')?.status, 'match');
  assert.equal(found('R-04', 'round-stake')?.expected, '100');
  assert.equal(found('R-04', 'round-payout')?.status, 'match');
  assert.deepEqual(report.replayIds, [replayId]);
  assert(report.evidence.some(ref => ref.rowId.includes(attemptId)));
  assert(!report.evidence.some(ref => ref.rowId.includes(foreignAttempt)));
  assert.deepEqual(await build(await f.capture(f.oldId, f.account, 'deposit')), { status: 'not-found' });
  assert.deepEqual(await build({ ...anchor, namespace: f.game.schema + '.accounts' }), { status: 'unsupported' });
  await assert.rejects(buildAuditReconciliation(f.audit, f.sources, datasetId, anchor,
    AbortSignal.abort(new Error('cancel fixture'))), /cancel fixture/);

  await f.game.prepare('UPDATE demo_ledger SET amount=1,amount_units=100 WHERE id=?').run(anchor.rowId);
  const damaged = await build();
  assert.equal(damaged.status, 'ready');
  assert(damaged.findings.some(row => row.rule === 'R-01' && row.code === 'stake-direction' && row.status === 'mismatch'));
  assert(damaged.findings.some(row => row.rule === 'R-04' && row.status === 'mismatch'));
  await f.game.prepare('UPDATE demo_ledger SET created_at=created_at+1 WHERE id=?').run(anchor.rowId);
  const unavailable = await build();
  assert.equal(unavailable.status, 'ready');
  assert(unavailable.coverage.some(row => row.rule === 'R-01' && row.code === 'available-source-unavailable'));
  assert.deepEqual(unavailable.replayIds, []);
});

test('provider debit components use both registered sources and real adjustment checks both exact balances', async t => {
  const f = await fixture(t);
  await f.game.prepare('INSERT INTO capro_pending_balances VALUES (?,?)').run(f.account, '500');
  const { datasetId } = await f.datasets.startTest();
  const providerId = 'capro:' + randomUUID();
  await f.game.transaction(async () => {
    await recordDemoUnits(f.game, f.account, providerId, 'bet', 0, 10000, 'casinoapipro');
    await saveProviderPendingUnits(f.game, f.account, providerId, -100n, 400n, 'debit');
  }, { lockKey: 'account:' + f.account });
  const gameAnchor = await f.capture(providerId);
  const game = await buildAuditReconciliation(f.audit, f.sources, datasetId, gameAnchor);
  assert.equal(game.status, 'ready');
  assert.deepEqual(game.requiredSources, [f.ledger, f.pending].sort());
  assert(game.findings.some(row => row.code === 'stake-direction' && row.status === 'match' && row.observed === '-100'));
  const pending = (await f.game.prepare('SELECT id::text FROM capro_pending_ledger WHERE operation_id=?').get(providerId))!;
  const pendingReport = await buildAuditReconciliation(f.audit, f.sources, datasetId, { namespace: f.pending, rowId: pending.id });
  assert.equal(pendingReport.status, 'ready');
  assert(pendingReport.findings.some(row => row.code === 'pending-balance-opening' && row.expected === '400' && row.observed === '400'));
  assert.deepEqual(pendingReport.requiredSources, [f.ledger, f.pending].sort());

  const id = randomUUID();
  await f.crypto.adminAdjust({ id, actorId: f.account, playerId: f.account, deltaUnits: '2000000', reason: 'Reconcile fixture' },
    new Set([f.account]));
  const row = (await f.payments.prepare('SELECT id::text FROM crypto_ledger WHERE operation_id=?').get(id))!;
  const namespace = f.payments.schema + '.crypto_ledger';
  const payment = await buildAuditReconciliation(f.audit, f.sources, datasetId, { namespace, rowId: row.id });
  assert.equal(payment.status, 'ready');
  assert.deepEqual(payment.requiredSources, [namespace]);
  assert(payment.findings.some(item => item.rule === 'payment' && item.code === 'single-adjustment-posting' && item.status === 'match'));
  assert(payment.findings.some(item => item.code === 'available-balance-opening' && item.expected === '3000000'));
  assert(payment.findings.some(item => item.code === 'reserved-balance-opening' && item.expected === '0'));
});

test('PvP bank and historical pool use their committed CHECK results under the selected posting', async t => {
  const f = await fixture(t);
  const ledger = new VirtualPvpLedger(f.game, f.wallet);
  const pvp = new PvpStore(ledger), combat = new NileCombatEscrow(ledger);
  await Promise.all([pvp.ready, combat.ready]);
  const a = { accountId: f.account, name: 'Fixture A', roomId: 'reconcile' };
  const b = { accountId: f.other, name: 'Fixture B', roomId: a.roomId };
  const now = Date.now();
  await pvp.syncRoom(a.roomId, [a, b].map(actor => ({ ...actor, connected: true, available: true })), now);
  const { datasetId } = await f.datasets.startTest();
  const challenge = await pvp.command(a, {
    id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: b.accountId,
  }, now);
  const matchId = challenge.active!.id;
  const matchAnchor = await f.capture('pvp:' + matchId + ':hold');
  const match = await buildAuditReconciliation(f.audit, f.sources, datasetId, matchAnchor);
  assert.equal(match.status, 'ready');
  assert.equal(match.entity?.category, 'pvp');
  assert(match.findings.some(row => row.rule === 'R-05' && row.status === 'pending'));

  let poolNow = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period + 1;
  const pool = new FlagToteStore(f.game, account => f.wallet.snapshotInTransaction(account), f.wallet.ready, () => poolNow, () => 0);
  const { round } = await pool.snapshot(f.account);
  const ticket = { id: randomUUID(), roundId: round.id, country: 'US', rulesVersion: 1, stakeUnits: '100' };
  await pool.bet(f.account, ticket);
  poolNow = round.closesAt;
  await pool.advance();
  const poolAnchor = await f.capture('flag-tote:' + round.id + ':final', f.account, 'refund');
  const report = await buildAuditReconciliation(f.audit, f.sources, datasetId, poolAnchor);
  assert.equal(report.status, 'ready');
  assert.equal(report.entity?.category, 'totalizator');
  assert(report.coverage.some(row => row.rule === 'R-06' && row.code === 'admission-clock-unavailable'));
  await f.game.prepare('UPDATE flag_tote_tickets SET payout_units=99 WHERE id=?').run(ticket.id);
  const damaged = await buildAuditReconciliation(f.audit, f.sources, datasetId, poolAnchor);
  assert.equal(damaged.status, 'ready');
  assert(damaged.findings.some(row => row.rule === 'R-06' && row.code === 'ticket-refund' && row.status === 'mismatch'));
});

test('period selection and financial checks share one snapshot across a concurrent source commit', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const operationId = randomUUID();
  await f.wallet.operate(f.account, { id: operationId, kind: 'deposit', amount: 1 });
  const anchor = await f.capture(operationId, f.account, 'deposit');
  const posting = await f.game.prepare('SELECT created_at FROM demo_ledger WHERE id=?').get(anchor.rowId);
  assert(posting);
  const selection = { datasetId, sourceNamespace: f.ledger, accountId: f.account,
    fromMs: posting.created_at, toMs: posting.created_at + 1 };
  const prepare = f.audit.prepare.bind(f.audit);
  const mocked = t.mock.method(f.audit, 'prepare', (sql: string) => {
    const query = prepare(sql);
    if (!sql.includes('ORDER BY occurred_at_ms,source_row_id LIMIT')) return query;
    return { ...query, async all(...args: unknown[]) {
      const rows = await query.all(...args);
      await f.game.prepare('UPDATE demo_ledger SET balance_units=balance_units+7 WHERE id=?').run(anchor.rowId);
      return rows;
    } };
  });
  const before = await buildAuditPeriodReconciliation(f.audit, f.sources, selection);
  mocked.mock.restore();
  assert.equal(before.status, 'ready');
  assert.equal(before.selectedCount, 1);
  assert.deepEqual(before.financialErrors, []);

  const after = await buildAuditPeriodReconciliation(f.audit, f.sources, selection);
  assert.equal(after.status, 'ready');
  const mismatch = after.financialErrors.find(item => item.rule === 'R-01' && item.code === 'available-balance-opening');
  assert(mismatch);
  assert.deepEqual(mismatch.anchors, [anchor]);
  assert.equal(BigInt(mismatch.observed!) - BigInt(mismatch.expected!), 7n);
});

test('an empty period shows recorded attempt capture gaps without attributing them to an account', async t => {
  const f = await fixture(t);
  const { datasetId, startedAtMs } = await f.datasets.startTest();
  await migrateAuditAttemptCapture(f.audit);
  const at = startedAtMs + 100;
  await f.audit.prepare(`INSERT INTO audit_attempt_capture_gaps(dataset_id,producer_id,missing_count,first_at_ms,last_at_ms)
    VALUES (?,?,4,?,?)`).run(datasetId, randomUUID(), at, at + 10);
  const check = (fromMs: number, toMs: number, sourceNamespace = f.ledger) => buildAuditPeriodReconciliation(f.audit,
    f.sources, { datasetId, sourceNamespace, accountId: f.account, fromMs, toMs });
  const overlap = await check(at, at + 1);
  assert.equal(overlap.status, 'ready');
  assert.equal(overlap.selectedCount, 0);
  assert.deepEqual(overlap.financialErrors, []);
  assert.deepEqual(overlap.coverage.find(row => row.code === 'attempt-capture-gap-overlap'),
    { rule: 'period', code: 'attempt-capture-gap-overlap', anchors: [], sources: [] });
  for (const selection of [[at - 1, at], [at + 11, at + 12]] as const) {
    const boundary = await check(...selection);
    assert.equal(boundary.status, 'ready');
    assert(!boundary.coverage.some(row => row.code === 'attempt-capture-gap-overlap'));
  }
  const payment = await check(at, at + 1, f.payments.schema + '.crypto_ledger');
  assert.equal(payment.status, 'ready');
  assert(!payment.coverage.some(row => row.code === 'attempt-capture-gap-overlap'));
});

test('paged selection freezes tied source IDs and excludes late commits on both sides of the page boundary', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const at = Date.now();
  const selection = { datasetId, sourceNamespace: f.ledger, accountId: f.account, fromMs: at, toMs: at + 1 };
  const page = (manifest: unknown, offset: number) => buildAuditPeriodPageReconciliation(
    f.audit, f.sources, selection, { manifest, offset });
  const insert = `INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source)
    SELECT $1,gen_random_uuid()::text,'deposit',0,100,$2,0,10000,'deposit','royal-coins'
    FROM generate_series(1,$3) RETURNING id::text`;
  const late = await f.game.pool.connect();
  try {
    await late.query('BEGIN');
    const earlyId = (await late.query(insert, [f.account, at, 1])).rows[0].id;
    const captured = (await f.game.pool.query(insert, [f.account, at, 19])).rows.map(row => row.id as string);
    const laterId = (await late.query(insert, [f.account, at, 1])).rows[0].id;
    const first = await page(null, 0);
    assert.equal(first.report.status, 'ready');
    assert(first.manifest);
    assert.deepEqual(first.manifest.rowIds, captured);
    assert.deepEqual(first.report.page, { offset: 0, processed: 16, total: 19, hasMore: true,
      anchors: captured.slice(0, 16).map(rowId => ({ namespace: f.ledger, rowId })) });
    assert.equal(first.report.selectionAsOfMs, first.report.asOfMs);
    await late.query('COMMIT');

    const second = await page(first.manifest, 16);
    assert.equal(second.report.status, 'ready');
    assert.equal(second.report.selectionAsOfMs, first.report.selectionAsOfMs);
    assert(second.report.asOfMs >= first.report.asOfMs);
    assert.deepEqual(second.report.page, { offset: 16, processed: 3, total: 19, hasMore: false,
      anchors: captured.slice(16).map(rowId => ({ namespace: f.ledger, rowId })) });
    assert.deepEqual(second.manifest, first.manifest);
    const refreshed = await page(null, 0);
    assert.deepEqual(refreshed.manifest?.rowIds, [earlyId, ...captured, laterId]);

    await f.audit.prepare('UPDATE audit_posting_refs SET account_id=? WHERE dataset_id=? AND source_namespace=? AND source_row_id=?')
      .run(f.other, datasetId, f.ledger, captured[16]);
    const changed = await page(first.manifest, 16);
    assert.equal(changed.report.status, 'ready');
    assert.deepEqual(changed.report.page, second.report.page);
    assert(changed.report.coverage.some(item => item.code === 'posting-unavailable' && item.anchors[0].rowId === captured[16]));
    await assert.rejects(buildAuditPeriodPageReconciliation(f.audit, f.sources, { ...selection, accountId: f.other },
      { manifest: first.manifest, offset: 16 }), /Invalid audit reconciliation scan manifest/);
  } finally {
    await late.query('ROLLBACK');
    late.release();
  }
});

test('a paged selection over its hard cap returns a lower bound and no processed anchors', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const at = Date.now();
  await f.audit.prepare(`INSERT INTO audit_posting_refs(dataset_id,source_namespace,source_row_id,account_id,operation_id,occurred_at_ms)
    SELECT ?,?,n,?,n::text,? FROM generate_series(1,4097) n`).run(datasetId, f.ledger, f.account, at);
  const { report, manifest } = await buildAuditPeriodPageReconciliation(f.audit, f.sources,
    { datasetId, sourceNamespace: f.ledger, accountId: f.account, fromMs: at, toMs: at + 1 }, { manifest: null, offset: 0 });
  assert.equal(report.status, 'scan-limit');
  assert.equal(report.selectedCountLowerBound, true);
  assert.deepEqual(report.page, { offset: 0, processed: 0, total: 4097, hasMore: false, anchors: [] });
  assert.equal(manifest, null);
});
