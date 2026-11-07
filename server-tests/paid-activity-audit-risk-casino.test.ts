import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { AuditAttempt } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { auditCommandRoutes, observeAuditIntent } from '../server/audit/intents';
import { AuditPostingReader } from '../server/audit/postings';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { casinoConflictRiskRule, casinoPurchaseRefundRiskRule, selectCasinoRisk } from '../server/audit/risk-casino';
import { runAuditRiskReport } from '../server/audit/risk-report';
import { evaluateAuditRiskRule } from '../server/audit/risk-rules';
import { RISK_WINDOW_MS, type AuditRiskSelection } from '../server/audit/risk-selection';
import { AuditRiskSignals } from '../server/audit/risk-store';
import { identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { recordDemoUnits } from '../server/demoWalletAmounts';
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../src/shared/caribbeanTreasures';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const account = randomUUID(), peers = [randomUUID(), randomUUID()];
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?),(?)').run(account, ...peers);
  const wallet = new DemoWalletStore(game, cascadeRandom(129733));
  for (const id of [account, ...peers]) await wallet.operate(id, { id: randomUUID(), kind: 'deposit', amount: 10000 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId, startedAtMs } = await datasets.startTest();
  const selection: AuditRiskSelection = {
    scope: { datasetId, environment: 'test' }, gameSchema: game.schema, subjectAccountIds: [account], comparisonAccountIds: peers,
    fromMs: startedAtMs, toMs: startedAtMs + RISK_WINDOW_MS, asOfMs: startedAtMs + RISK_WINDOW_MS,
  };
  const evidence = new AuditEvidence(audit, audit.schema);
  const store = new AuditRiskSignals(audit, new AuditPostingReader(audit, game));
  const candidates = () => selectCasinoRisk(audit, selection);
  return { game, audit, wallet, datasets, account, peers, selection, evidence, store, candidates };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Core = { id: string; kind: 'play'; gameId: 'royal-plinko'; input: { rows: number; risk: 'easy' };
  amount: number; rulesVersion: 1; stakePolicyVersion: 1 };

function plinko(amount = 0.1): Core {
  return { id: randomUUID(), kind: 'play', gameId: 'royal-plinko', input: { rows: 12, risk: 'easy' },
    amount, rulesVersion: 1, stakePolicyVersion: 1 };
}

async function transport(f: Fixture, accountId: string, command: Core, outcome: 'closed' | 'ok' | 'conflict') {
  const route = auditCommandRoutes.core, attemptId = randomUUID(), occurredAtMs = Date.now();
  const attempt: AuditAttempt = {
    schemaVersion: 1, scope: f.selection.scope, type: 'attempt', accountId, operationId: command.id, attemptId, occurredAtMs,
    route, entity: null, transport: 'http', intentFingerprint: observeAuditIntent(route, accountId, command.id, command),
    ...(outcome === 'closed' ? { decision: 'unknown', response: 'not-observed', delivery: 'closed',
      statusCode: null, balance: { state: 'not-recorded' } } :
      { decision: outcome === 'conflict' ? 'rejected' : 'unknown', response: 'formed', delivery: 'handed-off',
        statusCode: outcome === 'conflict' ? 409 : 200, balance: { state: 'absent' } }),
  };
  assert(attempt.intentFingerprint);
  await f.evidence.record(attempt);
  return attemptId;
}

test('casino retry control stays clear and changed-intent 409 series links the committed original', async t => {
  const f = await fixture(t);
  const command = plinko();
  await f.wallet.operate(f.account, command);
  const first = await transport(f, f.account, command, 'closed');
  const retries: string[] = [];
  for (let i = 0; i < 2; i++) {
    await f.wallet.operate(f.account, command);
    retries.push(await transport(f, f.account, command, 'ok'));
  }
  const peerCommands: Core[] = [];
  for (const peer of f.peers) {
    const own = plinko();
    peerCommands.push(own);
    await f.wallet.operate(peer, own);
    await transport(f, peer, own, 'ok');
  }
  const control = (await f.candidates()).find(item => item.rule.id === casinoConflictRiskRule.id)!;
  const clear = evaluateAuditRiskRule(control.rule, control.input);
  assert.equal(clear.status, 'clear');
  assert.deepEqual([clear.subject.numerator, clear.subject.denominator], ['0', '3']);
  assert.equal(await f.store.record(clear), null);

  const conflictIds: string[] = [];
  for (const amount of [0.2, 0.5, 1]) {
    const changed = { ...command, amount };
    await assert.rejects(f.wallet.operate(f.account, changed), { status: 409 });
    conflictIds.push(await transport(f, f.account, changed, 'conflict'));
  }
  const candidate = (await f.candidates()).find(item => item.rule.id === casinoConflictRiskRule.id)!;
  const signal = evaluateAuditRiskRule(candidate.rule, candidate.input);
  assert.equal(signal.status, 'observed');
  assert.equal(signal.key, clear.key);
  assert.deepEqual([signal.subject.numerator, signal.subject.denominator], ['3', '6']);
  assert.deepEqual([signal.comparison.numerator, signal.comparison.denominator], ['0', '2']);
  const debit = await f.game.prepare("SELECT id::text FROM demo_ledger WHERE operation_id=? AND entry_type='bet'").all(command.id);
  assert.equal(debit.length, 1);
  for (const sample of signal.input.observations.filter(row => row.primary.accountId === f.account)) {
    assert.equal(sample.primary.kind, 'attempt');
    assert(sample.primary.kind === 'attempt' && [...conflictIds, first, ...retries].includes(sample.primary.id));
    assert.equal(sample.value.numerator, sample.primary.kind === 'attempt' && conflictIds.includes(sample.primary.id) ? '1' : '0');
    assert.deepEqual(sample.supporting.map(proof => proof.kind === 'posting' ? proof.source.rowId : null), [debit[0].id]);
  }
  assert.equal(candidate.financialFindings, undefined);
  assert.equal((await f.store.record(signal))?.signal.status, 'observed');
  assert.equal(candidate.replayLinks, undefined);
  await f.store.review(f.selection.scope, signal.key, { expectedRevision: 1, reviewerId: 'operator', decision: 'explained' });
  const namespace = f.game.schema + '.demo_ledger';
  const posting = { namespace, rowId: debit[0].id }, replayId = randomUUID(), peerReplayId = randomUUID();
  const peerDebit = await f.game.prepare("SELECT id::text FROM demo_ledger WHERE operation_id=? AND entry_type='bet'").get(peerCommands[0].id);
  assert(peerDebit);
  const peerPosting = { namespace, rowId: peerDebit.id };
  const replayInput = { datasetId: f.selection.scope.datasetId, gameSchema: f.game.schema };
  assert.equal((await persistCapturedCasinoReplay(f.audit, { ...replayInput, replayId, posting })).status, 'stored');
  assert.equal((await persistCapturedCasinoReplay(f.audit, { ...replayInput, replayId: peerReplayId, posting: peerPosting })).status, 'stored');
  const link = { replayId, sequence: 1, source: posting };
  const linked = await runAuditRiskReport(f.audit, f.game, f.selection, 'casino');
  const finding = linked.signals.find(item => item.key === signal.key)!;
  assert.deepEqual(finding.replayLinks, [link]);
  assert.equal(finding.revision, 1);
  assert.equal(finding.reviewStatus, 'reviewed');
  assert.deepEqual((await f.store.read(f.selection.scope, signal.key))?.replayLinks, [link]);
  await assert.rejects(f.store.record(signal, [{ ...link, sequence: 2 }]), /subject posting or event/);
  await assert.rejects(f.store.record(signal, [{ replayId: peerReplayId, sequence: 1, source: peerPosting }]), /outside subject evidence/);
  await assert.rejects(f.store.record(signal, [{ ...link, replayId: peerReplayId }]), /subject posting or event/);

  const role = identifier('risk_no_replay_' + randomUUID().replaceAll('-', '').slice(0, 12));
  const auditSchema = identifier(f.audit.schema), gameSchema = identifier(f.game.schema);
  await f.audit.exec(`CREATE ROLE ${role}`);
  try {
    await f.audit.exec(`GRANT USAGE ON SCHEMA ${auditSchema},${gameSchema} TO ${role};
      GRANT SELECT ON ALL TABLES IN SCHEMA ${auditSchema},${gameSchema} TO ${role};
      REVOKE SELECT ON ${auditSchema}.audit_replay_fragments FROM ${role}`);
    const denied = await f.audit.transaction(async () => {
      await f.audit.exec(`SET LOCAL ROLE ${role}`);
      return f.candidates();
    }, { readOnly: true });
    const deniedCandidate = denied.find(item => item.rule.id === casinoConflictRiskRule.id)!;
    assert.equal(deniedCandidate.replayLinks, undefined);
    assert.deepEqual(deniedCandidate.input, candidate.input);
  } finally {
    await f.audit.exec(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
  }

  const observedAt = Date.now();
  await f.audit.prepare('INSERT INTO audit_attempt_capture_gaps VALUES (?,?,1,?,?)')
    .run(f.selection.scope.datasetId, randomUUID(), observedAt, observedAt);
  const gapped = (await f.candidates()).find(item => item.rule.id === casinoConflictRiskRule.id)!;
  const gappedSignal = evaluateAuditRiskRule(gapped.rule, gapped.input);
  assert.equal(gappedSignal.key, signal.key);
  assert.equal(gappedSignal.status, 'insufficient-data');
  assert.deepEqual(gappedSignal.gaps, ['subject-coverage', 'comparison-coverage']);
});

test('authorized casino bonus remains clear, extra free-step debit and unexpected refund have separate financial findings', async t => {
  const f = await fixture(t);
  const settings = { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } } as const;
  const start = (accountId: string, id = randomUUID()) => f.wallet.expansion.operate(accountId,
    { id, gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings });
  const roundId = randomUUID();
  let session = (await start(f.account, roundId)).session;
  const moves: string[] = [];
  while (session.state === 'active') {
    assert(moves.length < 40);
    const id = randomUUID();
    moves.push(id);
    session = (await f.wallet.expansion.operate(f.account,
      { id, gameId: CARIBBEAN_GAME, action: 'move', sessionId: roundId, move: 'caribbean-spin',
        revision: session.view.caribbean!.revision })).session;
  }
  assert(moves.length > 0);
  await start(f.account);
  for (const peer of f.peers) await start(peer);
  const control = (await f.candidates()).find(item => item.rule.id === casinoPurchaseRefundRiskRule.id)!;
  const clear = evaluateAuditRiskRule(control.rule, control.input);
  assert.equal(clear.status, 'clear');
  assert.deepEqual([clear.subject.numerator, clear.subject.denominator], ['0', '2']);
  assert.equal(control.financialFindings, undefined);
  const base = (await f.game.prepare("SELECT id::text,amount_units::text FROM demo_ledger WHERE operation_id=? AND entry_type='bet'")
    .get(roundId))!;
  assert.equal(base.amount_units, '-' + caribbeanInitialCost(settings.caribbean, '100'));
  assert.equal((await f.game.prepare("SELECT count(*)::int AS n FROM demo_ledger WHERE operation_id=ANY(?::text[]) AND entry_type='bet'")
    .get(moves))!.n, 0);
  const posting = { namespace: f.game.schema + '.demo_ledger', rowId: base.id }, replayId = randomUUID();
  assert.equal((await persistCapturedCasinoReplay(f.audit, { datasetId: f.selection.scope.datasetId, gameSchema: f.game.schema,
    posting, replayId })).status, 'stored');

  await recordDemoUnits(f.game, f.account, moves[0], 'bet', -1, 100, CARIBBEAN_GAME);
  await recordDemoUnits(f.game, f.account, roundId, 'refund', 50, 150, CARIBBEAN_GAME);
  const candidate = (await f.candidates()).find(item => item.rule.id === casinoPurchaseRefundRiskRule.id)!;
  const risk = evaluateAuditRiskRule(candidate.rule, candidate.input);
  assert.equal(risk.status, 'observed');
  assert.equal(risk.key, clear.key);
  assert.deepEqual([risk.subject.numerator, risk.subject.denominator], ['2', '4']);
  const anomalies = risk.input.observations.filter(row => row.value.numerator === '1');
  assert.deepEqual(new Set(anomalies.map(row => row.primary.operationId)), new Set([moves[0], roundId]));
  assert(anomalies.every(row => row.primary.kind === 'posting' &&
    row.supporting.some(proof => proof.kind === 'posting' && proof.source.rowId === base.id)));
  assert.deepEqual(candidate.financialFindings?.map(item => item.code).sort(),
    ['casino-refund-posting-source', 'casino-step-posting-count']);
  assert(candidate.financialFindings?.every(item => item.postings.some(ref => ref.rowId === base.id)));
  assert.deepEqual(candidate.replayLinks, [{ replayId, sequence: 1, source: posting }]);
  const stored = await f.store.record(risk, candidate.replayLinks);
  assert.equal(stored?.signal.status, 'observed');
  assert.deepEqual(stored?.replayLinks, candidate.replayLinks);
});

test('casino selector emits explicit incomplete coverage on source row limit and wrong scope stays closed', async t => {
  const f = await fixture(t);
  const { scope, fromMs } = f.selection;
  await f.audit.prepare(`INSERT INTO audit_evidence(dataset_id,kind,evidence_id,account_id,occurred_at_ms,payload)
    SELECT ?::uuid,'attempt','fixture-limit-'||n,?,?::bigint,'{}'::jsonb FROM generate_series(1,257) n`)
    .run(scope.datasetId, f.account, fromMs);
  const overflow = (await f.candidates()).find(item => item.rule.id === casinoConflictRiskRule.id)!;
  const signal = evaluateAuditRiskRule(overflow.rule, overflow.input);
  assert.equal(signal.status, 'insufficient-data');
  assert(signal.gaps.includes('subject-coverage') && signal.gaps.includes('comparison-coverage'));
  await assert.rejects(selectCasinoRisk(f.audit, { ...f.selection, scope: { ...scope, environment: 'live' } }),
    /dataset, source or window unavailable/);
  const cancellation = new Error('fixture operator cancelled');
  await assert.rejects(selectCasinoRisk(f.audit, { ...f.selection, signal: AbortSignal.abort(cancellation) }),
    error => error === cancellation);
});
