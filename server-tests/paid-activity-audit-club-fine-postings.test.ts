import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { AccountStore } from '../server/accounts';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { AuditPostingReader } from '../server/audit/postings';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { exportAuditPlayer } from '../server/audit/report-player';
import { installAuditPlayerReport, playerColumns } from '../server/audit/report-player-source';
import { buildAuditReconciliation } from '../server/audit/report-reconcile-core';
import { readAuditSummary } from '../server/audit/report-summary';
import { installAuditSummaryReport } from '../server/audit/report-summary-source';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { saveDemoUnits } from '../server/demoWalletAmounts';

test('club fine reports keep one exact debit, the scoped receipt and a distinct non-game movement', async t => {
  const store = new AccountStore(':memory:');
  const audit = new PostgresDatabase(':memory:');
  const game = store.financeAdmin.db;
  t.after(() => Promise.all([store.close(), audit.close()]));
  await store.ready;
  const { account } = await store.login('audit-club-fine@example.test', 'test-password');
  const { account: other } = await store.login('audit-club-fine-other@example.test', 'test-password');
  await saveDemoUnits(game, account.id, 2275);

  const sources = { game: store.schema };
  const { datasetId, environment, startedAtMs } = await new AuditDatasets(audit, sources).startTest();
  const scope = { datasetId, environment };
  const { outcome } = await store.clubSanctions.recordViolation(account.id, { id: randomUUID(), reason: 'spam' });
  const { id: sanctionId, revision, amountCents } = outcome.sanction;
  const request = { id: randomUUID(), sanctionId, revision, amountCents };
  const paid = await store.clubSanctions.pay(account.id, request);
  assert(paid.status === 'paid' && !paid.replayed);
  const retry = await store.clubSanctions.pay(account.id, request);
  assert(retry.status === 'paid' && retry.replayed);
  const operationId = 'club-fine:' + request.id;
  const ledger = await game.prepare('SELECT id::text AS id FROM demo_ledger WHERE account_id=? AND operation_id=?')
    .all(account.id, operationId);
  assert.equal(ledger.length, 1);
  const source = { namespace: store.schema + '.demo_ledger', rowId: ledger[0].id as string };
  const receiptSource = { namespace: store.schema + '.club_fine_payments', rowId: JSON.stringify([account.id, request.id]) };
  const reader = new AuditPostingReader(audit, game);
  const canonical = await reader.read(datasetId, source);
  assert(canonical.status === 'found' && canonical.evidence && 'paymentSource' in canonical.evidence);
  assert.equal(canonical.evidence.paymentSource, 'club-fine');
  assert.deepEqual(canonical.evidence.operation, receiptSource);
  assert.deepEqual([canonical.posting.entity, canonical.posting.movement, canonical.posting.coverage,
    canonical.posting.availableDeltaUnits, canonical.posting.availableAfterUnits],
    [null, 'fine', 'complete', String(-amountCents), String(2275 - amountCents)]);

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const group = 'audit_fine_reader_' + suffix, operator = 'audit_fine_operator_' + suffix, password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(group)} NOLOGIN;
    CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(group)} TO ${identifier(operator)};
    ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB'`);
  await installAuditReportAccess(audit, group);
  await installAuditPlayerReport(audit, group, sources);
  await installAuditSummaryReport(audit, group, sources);
  await installAuditDetailReport(audit, group, sources);
  await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(operator, datasetId, source.namespace);
  const config = databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: operator, PGPASSWORD: password, PGPASSWORD_FILE: '' });
  const client = new pg.Client(config);
  t.after(() => client.end());
  await client.connect();
  await assert.rejects(client.query(`SELECT * FROM ${identifier(store.schema)}.club_fine_payments`), { code: '42501' });

  const reportScope = { schema: audit.schema, datasetId };
  const time = { fromMs: startedAtMs, toMs: Date.now() + 1000 };
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-fine-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'fine.csv');
  assert.equal((await exportAuditPlayer(config, { ...reportScope, destination,
    filters: { ...time, accountId: account.id } })).rowCount, 1);
  const cells = (await readFile(destination, 'utf8')).split('\n')[1].split(',');
  assert.equal(cells[playerColumns.indexOf('category')], '');
  assert.equal(cells[playerColumns.indexOf('movement_type')], '"fine"');
  assert.equal(cells[playerColumns.indexOf('expected_balance_units')], String(2275 - amountCents));
  assert.equal(cells[playerColumns.indexOf('stored_balance_units')], String(2275 - amountCents));

  const summary = await readAuditSummary(config, { ...reportScope, filters: time });
  assert.equal(summary.scanned, 1);
  assert.deepEqual(summary.rows.map(row => [row.category, row.movement_type, row.posting_count, row.amount_units, row.fee_units]),
    [[null, 'fine', '1', String(-amountCents), null]]);
  const casino = await readAuditSummary(config, { ...reportScope, filters: { ...time, category: 'casino' } });
  assert.deepEqual(casino.rows, []);

  const evidence = new AuditEvidence(audit, audit.schema);
  const attemptId = randomUUID();
  for (const [accountId, id] of [[account.id, attemptId], [other.id, randomUUID()]]) {
    await evidence.record({ schemaVersion: 1, type: 'attempt', scope, attemptId: id,
      occurredAtMs: paid.receipt.paidAt, accountId, operationId, entity: null, transport: 'http', route: '/api/demo-wallet/club-fine',
      decision: 'accepted', response: 'formed', statusCode: 200, balance: { state: 'absent' }, delivery: 'handed-off' });
  }
  const detail = () => readAuditDetail(config, { ...reportScope, filters: {
    source: source.namespace, lookupKind: 'operation', lookupId: operationId, accountId: account.id,
  } });
  const found = await detail();
  assert.deepEqual(found.operation, { id: request.id, kind: 'club-fine', amountUnits: String(amountCents),
    occurredAtMs: String(paid.receipt.paidAt), source: receiptSource });
  assert.equal(found.anchor?.movement, 'fine');
  assert.deepEqual(found.attempts.map(attempt => attempt.id), [attemptId]);
  const reconciliation = await buildAuditReconciliation(audit, sources, datasetId, source);
  assert.equal(reconciliation.status, 'ready');
  assert(reconciliation.findings.some(finding => finding.rule === 'R-03' && finding.code === 'single-fine-debit' &&
    finding.status === 'match' && finding.sources.some(item => item.namespace === receiptSource.namespace && item.rowId === receiptSource.rowId)));
  assert([...reconciliation.findings, ...reconciliation.coverage].every(entry => entry.rule !== 'R-04' && entry.code !== 'stake-direction'));

  await game.prepare('UPDATE club_fine_payments SET amount_cents=amount_cents+1 WHERE account_id=? AND operation_id=?')
    .run(account.id, request.id);
  const wrongAmount = await reader.read(datasetId, source);
  assert(wrongAmount.status === 'found' && wrongAmount.evidence && 'paymentSource' in wrongAmount.evidence);
  assert.deepEqual([wrongAmount.posting.movement, wrongAmount.posting.coverage, wrongAmount.evidence.operation], ['fine', 'partial', null]);
  assert.equal((await detail()).operation, null);

  await game.prepare('UPDATE club_fine_payments SET account_id=?,amount_cents=? WHERE account_id=? AND operation_id=?')
    .run(other.id, amountCents, account.id, request.id);
  const missing = await detail();
  assert.equal(missing.anchor?.movement, 'fine');
  assert.equal(missing.operation, null);
  assert.equal(missing.coverage.operation, 'not-recorded');
  assert.deepEqual(missing.attempts.map(attempt => attempt.id), [attemptId]);
  await audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
    .run(operator, datasetId, source.namespace);
  await assert.rejects(detail(), { code: 'permission-denied' });
});
