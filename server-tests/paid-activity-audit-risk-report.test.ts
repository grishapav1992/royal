import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { migrateAuditAttemptCapture } from '../server/audit/attempts';
import type { AuditAttempt, AuditScope } from '../server/audit/contract';
import { migrateAuditDatasets } from '../server/audit/datasets';
import { AuditEvidence, migrateAuditEvidence } from '../server/audit/evidence';
import { evaluateAuditRiskRule, type AuditRiskRule } from '../server/audit/risk-rules';
import { RISK_WINDOW_MS, riskCandidate, type AuditRiskSelection } from '../server/audit/risk-selection';
import { AuditRiskSignals, migrateAuditRiskSignals } from '../server/audit/risk-store';
import { identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';

const scope: AuditScope = { datasetId: randomUUID(), environment: 'test' };
const selection: AuditRiskSelection = {
  scope, gameSchema: 'game_example', subjectAccountIds: ['subject'], comparisonAccountIds: ['peer-b', 'peer-a'],
  fromMs: 1000, toMs: 1000 + RISK_WINDOW_MS, asOfMs: 1000 + RISK_WINDOW_MS,
};
const rule: AuditRiskRule = {
  id: 'casino-conflicting-request-series', version: 'test-fixture', metric: 'rate', windowMs: RISK_WINDOW_MS,
  sample: { selector: 'risk-report-fixture', minSubject: 1, minComparison: 2, minComparisonAccounts: 2, maxObservations: 3 },
  threshold: { absolute: { numerator: '1', denominator: '2' }, comparisonMultiple: { numerator: '2', denominator: '1' } },
  cohort: { id: 'same-mode', version: '1' },
};
const complete = { subject: true, comparison: true };

function makeRows() {
  return ['subject', 'peer-a', 'peer-b'].map((accountId, index) => {
    const id = randomUUID(), operationId = randomUUID(), occurredAtMs = selection.fromMs + 1 + index;
    const attempt: AuditAttempt = {
      schemaVersion: 1, scope, type: 'attempt', attemptId: id, accountId, operationId, occurredAtMs, entity: null,
      transport: 'http', route: '/api/demo-wallet/operations', decision: index === 0 ? 'rejected' : 'replayed',
      response: 'formed', statusCode: index === 0 ? 409 : 200, balance: { state: 'absent' },
    };
    return { attempt, observation: { primary: { kind: 'attempt' as const, id, accountId, operationId, occurredAtMs },
      entity: null, matched: index === 0 } };
  });
}

test('selection uses a stable cohort identity and clipping never yields a complete sample', () => {
  const rows = makeRows().map(row => row.observation);
  const initial = riskCandidate(selection, rule, 'same-segment', null, rows, complete);
  const order = riskCandidate({ ...selection, comparisonAccountIds: ['peer-a', 'peer-b'] }, rule, 'same-segment', null,
    [...rows].reverse(), complete);
  assert.deepEqual(evaluateAuditRiskRule(initial.rule, initial.input), evaluateAuditRiskRule(order.rule, order.input));
  const changedGroup = riskCandidate({ ...selection, comparisonAccountIds: [...selection.comparisonAccountIds, 'peer-c'] },
    rule, 'same-segment', null, rows, complete);
  assert.notEqual(changedGroup.input.comparisonKey, initial.input.comparisonKey);
  const extra = { ...rows[0], primary: { ...rows[0].primary, id: randomUUID(), occurredAtMs: selection.fromMs + 10 } };
  const capped = riskCandidate(selection, rule, 'same-segment', null, [...rows, extra], complete);
  assert.deepEqual(capped.input.completeness, { subject: false, comparison: true });
  assert.equal(evaluateAuditRiskRule(rule, capped.input).status, 'insufficient-data');
  assert.throws(() => riskCandidate({ ...selection, comparisonAccountIds: ['subject'] }, rule, 'same-segment', null, [], complete),
    /groups overlap/);
});

test('report and manual review expose durable evidence and bind the reviewer to the database login', async t => {
  const audit = new PostgresDatabase(':memory:'), game = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close()]); });
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await new DemoWalletStore(game).ready;
  await migrateAuditDatasets(audit);
  await migrateAuditEvidence(audit);
  await migrateAuditAttemptCapture(audit);
  await migrateAuditRiskSignals(audit);
  await audit.prepare("INSERT INTO audit_datasets VALUES (?,'test',1000,NULL)").run(scope.datasetId);
  await audit.prepare('INSERT INTO audit_dataset_sources VALUES (?,?)').run(scope.datasetId, game.schema + '.demo_ledger');
  const raw = new AuditEvidence(audit, audit.schema);
  const rows = makeRows();
  for (const { attempt } of rows) await raw.record(attempt);
  const storage = new AuditRiskSignals(audit);
  const candidate = riskCandidate(selection, rule, 'same-segment', null, rows.map(row => row.observation), complete);
  const signal = evaluateAuditRiskRule(candidate.rule, candidate.input);
  assert.equal(signal.status, 'observed');
  assert.equal((await storage.record(signal))?.revision, 1);

  const login = 'risk_' + randomBytes(10).toString('hex'), password = randomBytes(24).toString('hex');
  await audit.exec(`CREATE ROLE ${identifier(login)} LOGIN PASSWORD '${password}'`);
  const schema = identifier(audit.schema), gameSchema = identifier(game.schema);
  await audit.exec(`GRANT USAGE ON SCHEMA ${schema},${gameSchema} TO ${identifier(login)};
    GRANT SELECT ON ${schema}.audit_risk_signals,${schema}.audit_datasets,${schema}.audit_evidence,
      ${schema}.audit_dataset_sources,${schema}.audit_posting_refs,${schema}.audit_attempt_capture_gaps,
      ${gameSchema}.demo_ledger TO ${identifier(login)};
    GRANT UPDATE (review) ON ${schema}.audit_risk_signals TO ${identifier(login)}`);
  t.after(async () => {
    const db = new PostgresDatabase(audit.schema, { existingSchema: true });
    try {
      await db.exec(`DROP OWNED BY ${identifier(login)}; DROP ROLE ${identifier(login)}`);
    } finally { await db.close(); }
  });
  const temp = await mkdtemp(join(tmpdir(), 'royal-audit-risk-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const config = join(temp, 'operator-url');
  const url = new URL('postgresql://localhost');
  url.hostname = process.env.PGHOST!;
  url.port = process.env.PGPORT!;
  url.pathname = '/' + process.env.PGDATABASE!;
  url.username = login;
  url.password = password;
  await writeFile(config, url.href, { mode: 0o600 });
  const cli = (command: string, ...extra: string[]) => promisify(execFile)(process.execPath, [
    '--import', 'tsx', 'scripts/audit-risk.ts', command, '--schema', audit.schema, '--dataset', scope.datasetId,
    ...extra,
  ], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, ROYAL_AUDIT_RISK_DB_URL_FILE: config } });
  const empty = JSON.parse((await cli('run', '--game-schema', game.schema, '--category', 'casino', '--day', '1970-01-02',
    '--subject', 'subject', '--peer', 'peer-a', '--peer', 'peer-b')).stdout);
  assert.equal(empty.status, 'insufficient-data');
  assert.deepEqual(empty.financial, { coverage: 'selector-observations-only', findings: [] });
  const shown = JSON.parse((await cli('show', '--key', signal.key)).stdout);
  assert.equal(shown.scope.environment, 'test');
  assert.equal(shown.reviewStatus, 'unreviewed');
  assert.equal(shown.rule.version, rule.version);
  assert.match(shown.reason, /параметров уже принятой операции/);
  assert.equal(shown.evidence[0].primary.id, rows[0].attempt.attemptId);
  const reviewed = JSON.parse((await cli('review', '--key', signal.key, '--revision', '1', '--decision', 'explained')).stdout);
  assert.equal(reviewed.reviewStatus, 'reviewed');
  assert.equal(reviewed.review.reviewerId, login);
  assert.equal(reviewed.review.revision, 1);
  await assert.rejects(cli('review', '--key', signal.key, '--revision', '2', '--decision', 'dismissed'));
  assert.equal((await storage.read(scope, signal.key))?.review?.decision, 'explained');
});
