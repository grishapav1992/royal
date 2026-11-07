import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import type { AuditEvent } from '../server/audit/contract';
import { TOTE_ADMISSION_CLOCK } from '../server/audit/check-tote';
import { runAuditRiskReport } from '../server/audit/risk-report';
import { evaluateAuditRiskRule } from '../server/audit/risk-rules';
import { RISK_WINDOW_MS, type AuditRiskSelection } from '../server/audit/risk-selection';
import { AuditRiskSignals } from '../server/audit/risk-store';
import { selectToteRisk } from '../server/audit/risk-tote';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { FlagToteStore } from '../server/flagTote';
import type { FlagCountry } from '../src/shared/flagBattle';
import { TOTE_TIMING, type ToteRound } from '../src/shared/flagTote';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close()]); });
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?),(?),(?)').run(a, b, c, d);
  const wallet = new DemoWalletStore(game);
  for (const account of [a, b, c, d]) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId, environment } = await datasets.startTest();
  const scope = { datasetId, environment };
  const fromMs = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period;
  let now = fromMs;
  const tote = new FlagToteStore(game, account => wallet.snapshotInTransaction(account), wallet.ready, () => now, () => 0);
  const evidence = new AuditEvidence(audit, audit.schema);
  const selection: AuditRiskSelection = { scope, gameSchema: game.schema, subjectAccountIds: [a, b],
    comparisonAccountIds: [c, d], fromMs, toMs: fromMs + RISK_WINDOW_MS, asOfMs: fromMs + RISK_WINDOW_MS };
  const pool = async (offset: number) => {
    now = fromMs + offset * TOTE_TIMING.period;
    return (await tote.snapshot(a)).round;
  };
  const accept = async (round: ToteRound, accountId: string, msBeforeCutoff: number, country: FlagCountry = 'FR') => {
    now = round.closesAt - msBeforeCutoff;
    const id = randomUUID(), admittedAtMs = now;
    await tote.bet(accountId, { id, roundId: round.id, rulesVersion: 1, country, stakeUnits: '100' });
    const row = await game.prepare('SELECT id::text,created_at FROM demo_ledger WHERE account_id=? AND operation_id=?')
      .get(accountId, 'flag-tote:' + id);
    assert(row);
    return { id, accountId, admittedAtMs, round, posting: { namespace: game.schema + '.demo_ledger', rowId: row.id }, postingMs: row.created_at };
  };
  const clock = async (ticket: Awaited<ReturnType<typeof accept>>, observedAt = ticket.admittedAtMs, rowId = ticket.posting.rowId) => {
    const event: AuditEvent = { schemaVersion: 1, type: 'event', scope, occurredAtMs: observedAt,
      eventId: randomUUID(), sequence: '1', accountId: ticket.accountId, operationId: ticket.id,
      event: 'accepted', reasonCode: TOTE_ADMISSION_CLOCK, postings: [{ ...ticket.posting, rowId }],
      entity: { category: 'totalizator', kind: 'pool', gameId: 'flag-tote', modeId: 'pool', rulesVersion: '1',
        source: { namespace: game.schema + '.flag_tote_rounds', rowId: ticket.round.id }, ticketId: ticket.id } };
    assert.equal(await evidence.record(event), 'recorded');
    return event;
  };
  return { game, audit, datasets, scope, a, b, c, d, pool, accept, clock, selection };
}

test('one stable synchronized pair is explained by several pools and exact captured receipts', async t => {
  const f = await fixture(t), admissions = new Map<string, { event: AuditEvent; postingMs: number }>();
  const samePools = new Set<string>();
  for (let index = 0; index < 5; index++) {
    const round = await f.pool(index);
    if (index < 3) samePools.add(round.id);
    const comparisonTime = index === 3 ? 400 : 120;
    const early = await f.accept(round, f.d, 5000);
    const comparison = await f.accept(round, f.c, comparisonTime, index === 4 ? 'DE' : 'FR');
    const first = await f.accept(round, f.a, 100);
    const second = await f.accept(round, f.b, 30);
    for (const ticket of [early, comparison, first, second]) {
      const event = await f.clock(ticket);
      admissions.set(ticket.id, { event, postingMs: ticket.postingMs });
    }
  }
  const [candidate] = await selectToteRisk(f.audit, f.selection);
  const signal = evaluateAuditRiskRule(candidate.rule, candidate.input);
  assert.equal(signal.status, 'observed');
  assert.equal(signal.subject.numerator, '5');
  assert.equal(signal.subject.denominator, '5');
  assert.equal(signal.comparison.numerator, '0');
  assert.equal(signal.comparison.denominator, '3');
  assert.deepEqual(candidate.input.completeness, { subject: true, comparison: true });
  const subject = candidate.input.observations.filter(row => f.selection.subjectAccountIds.includes(row.primary.accountId!));
  assert.equal(new Set(subject.map(row => row.entity?.source.rowId)).size, 5);
  for (const { primary, supporting, entity } of subject) {
    assert.equal(primary.kind, 'event');
    const admitted = admissions.get(primary.operationId!)!;
    assert.equal(primary.occurredAtMs, admitted.event.occurredAtMs);
    assert.notEqual(primary.occurredAtMs, admitted.postingMs);
    assert.equal(entity?.ticketId, primary.operationId);
    assert.equal(supporting.filter(ref => ref.kind === 'event').length, 1);
    assert.equal(supporting.filter(ref => ref.kind === 'posting').length, 2);
  }
  assert.deepEqual(new Set(candidate.input.observations.filter(row => f.selection.comparisonAccountIds.includes(row.primary.accountId!))
    .map(row => row.entity?.source.rowId)), samePools);
  const report = await runAuditRiskReport(f.audit, f.game, f.selection, 'totalizator');
  assert.equal(report.signals[0].status, 'observed');
  assert.equal(report.signals[0].key, signal.key);
  assert.equal(report.signals[0].evidence.length, 5);
  assert.deepEqual(report.financial.findings, []);
  const stored = await new AuditRiskSignals(f.audit).read(f.scope, signal.key);
  assert.equal(stored?.signal.key, signal.key);
  assert.deepEqual((await selectToteRisk(f.audit, { ...f.selection,
    subjectAccountIds: [...f.selection.subjectAccountIds].reverse(), comparisonAccountIds: [...f.selection.comparisonAccountIds].reverse(),
  }))[0], candidate);
});

test('isolated lawful last-second tickets are negative controls even when repeated', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) {
    const round = await f.pool(index);
    for (const ticket of [await f.accept(round, f.d, 5000), await f.accept(round, f.c, 10), await f.accept(round, f.a, 1)]) {
      await f.clock(ticket);
    }
  }
  const [candidate] = await selectToteRisk(f.audit, f.selection);
  const signal = evaluateAuditRiskRule(candidate.rule, candidate.input);
  assert.equal(signal.status, 'clear');
  assert.deepEqual([signal.subject.numerator, signal.subject.denominator], ['0', '3']);
  assert.equal(candidate.financialFindings, undefined);
});

test('missing and ambiguous acceptance clocks never fall back to the posting timestamp', async t => {
  const f = await fixture(t), round = await f.pool(0);
  const early = await f.accept(round, f.d, 5000), control = await f.accept(round, f.c, 150);
  const missing = await f.accept(round, f.a, 100), peer = await f.accept(round, f.b, 30);
  for (const ticket of [early, control, peer]) await f.clock(ticket);
  await f.clock(peer);
  // Keep the canonical link exact while making the posting timestamp look synchronized.
  await f.game.prepare('UPDATE demo_ledger SET created_at=? WHERE id=?').run(missing.admittedAtMs, missing.posting.rowId);
  await f.audit.prepare('UPDATE audit_posting_refs SET occurred_at_ms=? WHERE dataset_id=? AND source_namespace=? AND source_row_id=?')
    .run(missing.admittedAtMs, f.scope.datasetId, missing.posting.namespace, missing.posting.rowId);
  const [candidate] = await selectToteRisk(f.audit, f.selection);
  const signal = evaluateAuditRiskRule(candidate.rule, candidate.input);
  assert.equal(signal.status, 'insufficient-data');
  assert.equal(candidate.input.completeness.subject, false);
  assert.equal(candidate.input.observations.length, 0);
  assert.equal(candidate.financialFindings, undefined);
  await assert.rejects(selectToteRisk(f.audit, { ...f.selection, scope: { ...f.scope, environment: 'live' } }), /dataset/);
  await assert.rejects(selectToteRisk(f.audit, { ...f.selection, comparisonAccountIds: [f.a, f.c] }), /overlap/);
});

test('a unique exact receipt at cutoff yields a separate finding with its actual debit', async t => {
  const f = await fixture(t), round = await f.pool(0);
  const ticket = await f.accept(round, f.a, 1);
  const clock = await f.clock(ticket, round.closesAt);
  const [candidate] = await selectToteRisk(f.audit, f.selection);
  assert.deepEqual(candidate.financialFindings, [{ code: 'ticket-outside-window',
    source: { namespace: f.audit.schema + '.audit_evidence', rowId: JSON.stringify([f.scope.datasetId, 'event', clock.eventId]) },
    postings: [ticket.posting],
  }]);
  assert.equal(evaluateAuditRiskRule(candidate.rule, candidate.input).status, 'insufficient-data');
  const report = await runAuditRiskReport(f.audit, f.game, f.selection, 'totalizator');
  assert.equal(report.signals[0].status, 'insufficient-data');
  assert.deepEqual(report.financial.findings, candidate.financialFindings);
  await f.game.prepare('UPDATE demo_ledger SET operation_id=? WHERE id=?').run('unrelated', ticket.posting.rowId);
  const [damaged] = await selectToteRisk(f.audit, f.selection);
  assert.equal(damaged.financialFindings, undefined);
  assert.equal(damaged.input.completeness.subject, false);
});
