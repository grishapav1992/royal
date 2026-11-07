import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { AuditAsset, AuditAttempt, AuditEntityRef, AuditScope } from '../server/audit/contract';
import { AuditDatasets, migrateAuditDatasets } from '../server/audit/datasets';
import { AuditEvidence, migrateAuditEvidence } from '../server/audit/evidence';
import { AuditPostingReader } from '../server/audit/postings';
import {
  evaluateAuditRiskRule, type AuditRiskObservation, type AuditRiskRule, type AuditRiskWindow,
} from '../server/audit/risk-rules';
import { AuditRiskSignals, migrateAuditRiskSignals } from '../server/audit/risk-store';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';

const account = 'subject', first = 'peer-a', second = 'peer-b';
const rateRule: AuditRiskRule = {
  id: 'conflicting-attempt-rate', version: '1', metric: 'rate', windowMs: 1000,
  sample: { selector: 'selected-attempts-v1', minSubject: 2, minComparison: 2, minComparisonAccounts: 2, maxObservations: 8 },
  threshold: { absolute: { numerator: '1', denominator: '2' }, comparisonMultiple: { numerator: '2', denominator: '1' } },
  cohort: { id: 'same-mode', version: '1' },
};
const entity: AuditEntityRef = { category: 'casino', kind: 'round', gameId: 'royal-plinko', modeId: 'normal',
  rulesVersion: '1', source: { namespace: 'royal_game.demo_operations', rowId: 'known-round' }, ticketId: null };

function observe(scope: AuditScope, accountId: string, at: number, numerator: '0' | '1') {
  const attempt: AuditAttempt = {
    schemaVersion: 1, scope, type: 'attempt', attemptId: randomUUID(), accountId, operationId: randomUUID(),
    occurredAtMs: at, entity, transport: 'http', route: '/api/demo-wallet/operation',
    decision: numerator === '1' ? 'rejected' : 'accepted', response: 'formed',
    statusCode: numerator === '1' ? 409 : 200, balance: { state: 'absent' },
  };
  const sample: AuditRiskObservation = {
    scope, comparisonKey: 'plinko-normal', asset: null, entity,
    primary: { kind: 'attempt', id: attempt.attemptId, accountId, operationId: attempt.operationId, occurredAtMs: at },
    supporting: [], value: { numerator, denominator: '1' },
  };
  return { attempt, sample };
}

function attempts(scope: AuditScope) {
  const evidence = [
    observe(scope, account, 1100, '1'), observe(scope, account, 1200, '1'),
    observe(scope, first, 1300, '1'), observe(scope, second, 1400, '0'),
  ];
  const input: AuditRiskWindow = { scope, fromMs: 1000, toMs: 2000, asOfMs: 2100,
    subject: { accountIds: [account], entity: null }, comparisonKey: 'plinko-normal', asset: null,
    completeness: { subject: true, comparison: true }, observations: evidence.map(row => row.sample) };
  return { evidence, input };
}

test('fixed scope and version yield a stable key, exact threshold equality and explicit coverage gaps', () => {
  const scope: AuditScope = { datasetId: randomUUID(), environment: 'test' };
  const { input } = attempts(scope);
  const signal = evaluateAuditRiskRule(rateRule, input);
  assert.equal(signal.status, 'observed');
  assert.deepEqual(signal.subject, { numerator: '2', denominator: '2', observations: 2, accounts: 1 });
  assert.deepEqual(signal.comparison, { numerator: '1', denominator: '2', observations: 2, accounts: 2 });
  assert.deepEqual(evaluateAuditRiskRule(rateRule, { ...input, observations: [...input.observations].reverse() }), signal);
  assert.notEqual(evaluateAuditRiskRule({ ...rateRule, version: '2' }, input).key, signal.key);
  assert.notEqual(evaluateAuditRiskRule({ ...rateRule, cohort: { ...rateRule.cohort, version: '2' } }, input).key, signal.key);
  const incomplete = evaluateAuditRiskRule(rateRule, { ...input, asOfMs: 1999,
    completeness: { subject: true, comparison: false }, observations: input.observations.slice(0, -1) });
  assert.equal(incomplete.status, 'insufficient-data');
  assert.equal(incomplete.key, signal.key);
  assert.deepEqual(incomplete.gaps, ['window-open', 'comparison-coverage', 'comparison-sample', 'comparison-accounts']);
  assert.throws(() => evaluateAuditRiskRule(rateRule, { ...input, observations: [...input.observations, input.observations[0]] }),
    /Duplicate audit risk/);
  const foreign = { ...input.observations[0], scope: { ...scope, datasetId: randomUUID() } };
  assert.throws(() => evaluateAuditRiskRule(rateRule, { ...input, observations: [foreign, ...input.observations.slice(1)] }),
    /Invalid audit risk observation/);
});

async function durableFixture(t: TestContext) {
  const audit = new PostgresDatabase(':memory:');
  t.after(() => audit.close());
  await migrateAuditDatasets(audit);
  await migrateAuditEvidence(audit);
  await migrateAuditRiskSignals(audit);
  const scope: AuditScope = { datasetId: randomUUID(), environment: 'test' };
  await audit.prepare("INSERT INTO audit_datasets VALUES (?,'test',1000,NULL)").run(scope.datasetId);
  const { evidence, input } = attempts(scope);
  const raw = new AuditEvidence(audit, audit.schema);
  for (const { attempt } of evidence) await raw.record(attempt);
  return { audit, scope, input, raw, store: new AuditRiskSignals(audit) };
}

test('scoped durable revisions keep prior reviews through clears and reject invalid evidence', async t => {
  const f = await durableFixture(t);
  const initial = evaluateAuditRiskRule(rateRule, f.input);
  assert.equal(initial.status, 'observed');
  assert.deepEqual(await Promise.all([f.store.record(initial), f.store.record(initial)]),
    [1, 1].map(revision => ({ signal: initial, revision, review: null, reviewAppliesToCurrent: false })));
  const reviewed = (await f.store.review(f.scope, initial.key,
    { expectedRevision: 1, reviewerId: 'operator-1', decision: 'explained' }))!;
  assert.equal(reviewed.reviewAppliesToCurrent, true);
  const newer = evaluateAuditRiskRule(rateRule, { ...f.input, asOfMs: 2101 });
  assert.equal((await f.store.record(newer))?.reviewAppliesToCurrent, true);
  assert.equal((await f.store.record(initial))?.signal.input.asOfMs, 2101);
  const late = observe(f.scope, account, 1500, '0');
  await f.raw.record(late.attempt);
  const complete = { ...f.input, observations: [...f.input.observations, late.sample] };
  const clear = evaluateAuditRiskRule(rateRule, { ...complete, asOfMs: 2102 });
  assert.equal(clear.status, 'clear');
  assert.equal(clear.key, initial.key);
  await assert.rejects(f.store.record(evaluateAuditRiskRule(rateRule, { ...complete, asOfMs: 2101 })),
    /Conflicting audit risk evaluation/);
  const cleared = (await f.store.record(clear))!;
  assert.equal(cleared.revision, 2);
  assert.equal(cleared.reviewAppliesToCurrent, false);
  assert.deepEqual(cleared.review, reviewed.review);
  assert.deepEqual(await f.store.read(f.scope, clear.key), cleared);
  assert.equal(await f.store.read({ ...f.scope, environment: 'live' }, clear.key), null);
  await assert.rejects(f.store.review(f.scope, clear.key, { expectedRevision: 1, reviewerId: 'operator-2', decision: 'escalated' }),
    /requires current finding/);
  assert.equal(await f.store.record(evaluateAuditRiskRule({ ...rateRule, version: '2' }, complete)), null);
  assert.equal((await f.audit.prepare('SELECT count(*) AS n FROM audit_risk_signals').get())?.n, 1);
  await assert.rejects(f.store.record({ ...clear, status: 'observed' }), /Invalid audit risk signal/);

  const badOperation = structuredClone(f.input);
  badOperation.asOfMs = 2103;
  badOperation.observations[0].primary.operationId = 'unrelated-operation';
  await assert.rejects(f.store.record(evaluateAuditRiskRule(rateRule, badOperation)), /evidence unavailable or out of scope/);
  const badEntity = structuredClone(f.input);
  badEntity.asOfMs = 2103;
  badEntity.observations[0].entity!.source.rowId = 'unrelated-entity';
  await assert.rejects(f.store.record(evaluateAuditRiskRule(rateRule, badEntity)), /evidence entity does not match/);
  const changedCohort = { ...f.input, comparisonKey: 'other-cohort',
    observations: f.input.observations.map(row => ({ ...row, comparisonKey: 'other-cohort' })) };
  const changedRule = { ...rateRule, threshold: { ...rateRule.threshold, absolute: { numerator: '2', denominator: '3' } } };
  await assert.rejects(f.store.record(evaluateAuditRiskRule(changedRule, changedCohort)), /rule version changed/);

  await f.audit.prepare('UPDATE audit_datasets SET sealed_at_ms=3000 WHERE id=?').run(f.scope.datasetId);
  const foreign: AuditScope = { datasetId: randomUUID(), environment: 'live' };
  await f.audit.prepare("INSERT INTO audit_datasets VALUES (?,'live',1000,NULL)").run(foreign.datasetId);
  const alien = observe(foreign, account, 1100, '1');
  await f.raw.record(alien.attempt);
  const missing = structuredClone(f.input);
  missing.asOfMs = 2103;
  missing.observations[0].primary = alien.sample.primary;
  await assert.rejects(f.store.record(evaluateAuditRiskRule(rateRule, missing)), /evidence unavailable or out of scope/);
  const postSeal = await f.store.record(evaluateAuditRiskRule(rateRule, { ...f.input, asOfMs: 3100 }));
  assert.equal(postSeal?.signal.status, 'observed');
  assert.equal(postSeal?.revision, 3);
  assert.equal(postSeal?.reviewAppliesToCurrent, false);
  assert.deepEqual(postSeal?.review, reviewed.review);
  const partial = evaluateAuditRiskRule(rateRule, { ...f.input, asOfMs: 3100, comparisonKey: 'partial-cohort',
    completeness: { subject: true, comparison: false },
    observations: f.input.observations.slice(0, -1).map(row => ({ ...row, comparisonKey: 'partial-cohort' })) });
  assert.equal((await f.store.record(partial))?.signal.status, 'insufficient-data');
  assert.deepEqual((await f.store.read(f.scope, partial.key))?.signal.gaps,
    ['comparison-coverage', 'comparison-sample', 'comparison-accounts']);
});

test('unit comparisons use exact canonical amounts, asset and posting source inside the dataset', async t => {
  const game = new PostgresDatabase(':memory:'), payments = new PostgresDatabase(':memory:');
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), payments.close(), audit.close()]); });
  for (const db of [game, payments]) {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await db.prepare('INSERT INTO accounts VALUES (?),(?),(?)').run(account, first, second);
  }
  const wallet = new DemoWalletStore(game);
  const crypto = new CryptoStore(payments, cryptoConfig({}), {} as CryptoProvider);
  await Promise.all([wallet.ready, crypto.ready]);
  const { datasetId, startedAtMs: fromMs } = await new AuditDatasets(audit,
    { game: game.schema, payments: payments.schema }).startTest();
  await migrateAuditRiskSignals(audit);
  const scope: AuditScope = { datasetId, environment: 'test' };
  const asset: AuditAsset = { contour: 'real', code: 'USDT', scale: 6 };
  const high = '9007199254740993123', low = '9007199254740993122';
  const rule: AuditRiskRule = { ...rateRule, id: 'large-adjustment-units', metric: 'mean-units',
    sample: { ...rateRule.sample, selector: 'selected-postings-v1', minSubject: 1 },
    threshold: { absolute: { numerator: high, denominator: '1' }, comparisonMultiple: { numerator: '1', denominator: '1' } } };
  const observations: AuditRiskObservation[] = [];
  for (const [accountId, numerator] of [[account, high], [first, low], [second, low]]) {
    const operationId = randomUUID(), occurredAtMs = fromMs + 20;
    const row = await payments.prepare(`INSERT INTO crypto_ledger(account_id,operation_id,entry_key,
      available_delta,reserved_delta,counterparty_delta,balance_units,reserved_units,created_at)
      VALUES (?,?,?,?::bigint,0,-(?::bigint),?::bigint,0,?) RETURNING id::text`)
      .get(accountId, operationId, 'adjustment:' + operationId, numerator, numerator, numerator, occurredAtMs);
    observations.push({ scope, comparisonKey: 'usdt-adjustments', entity: null, asset,
      primary: { kind: 'posting', source: { namespace: payments.schema + '.crypto_ledger', rowId: row!.id },
        accountId, operationId, occurredAtMs }, supporting: [], value: { numerator, denominator: '1' } });
  }
  const input: AuditRiskWindow = { scope, fromMs, toMs: fromMs + 1000, asOfMs: fromMs + 1001,
    subject: { accountIds: [account], entity: null }, comparisonKey: 'usdt-adjustments', asset,
    completeness: { subject: true, comparison: true }, observations };
  const signal = evaluateAuditRiskRule(rule, input);
  assert.equal(signal.status, 'observed');
  assert.equal(signal.comparison.numerator, String(BigInt(low) * 2n));
  const changed = structuredClone(input);
  changed.observations[0].value.numerator = low;
  const incorrect = evaluateAuditRiskRule(rule, changed);
  assert.equal(incorrect.status, 'clear');
  await assert.rejects(new AuditRiskSignals(audit).record(signal), /posting context unavailable/);
  const store = new AuditRiskSignals(audit, new AuditPostingReader(audit, game, payments));
  await assert.rejects(store.record(incorrect), /amount does not match the canonical posting/);
  assert.equal((await store.record(signal))?.signal.subject.numerator, high);
});
