import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import type { AuditAttempt, AuditScope, AuditSourceRef } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { AuditPostingReader } from '../server/audit/postings';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { requestAuditPeriodReconcile, requestAuditReconcile } from '../server/audit/report-investigation';
import { installAuditReconcileReport } from '../server/audit/report-reconcile-source';
import { processAuditReconcileRequest } from '../server/audit/report-reconcile-worker';
import { installAuditReplayReport } from '../server/audit/report-replay-source';
import { evaluateAuditRiskRule } from '../server/audit/risk-rules';
import { AuditRiskSignals } from '../server/audit/risk-store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { prepareViewerReplay } from '../src/audit/replay-viewer-model';

async function fixture(t: TestContext) {
  const audit = new PostgresDatabase(':memory:'), game = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close()]); });
  const accountId = randomUUID(), peerId = randomUUID(), operationId = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(accountId, peerId);
  const wallet = new DemoWalletStore(game, () => 0);
  await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const sources = { game: game.schema };
  const { datasetId, startedAtMs } = await new AuditDatasets(audit, sources).startTest();
  const scope: AuditScope = { datasetId, environment: 'test' };
  const tag = randomUUID().slice(0, 8), group = 'reconcile_read_' + tag, operator = 'reconcile_op_' + tag;
  const worker = 'reconcile_worker_' + tag, password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(group)} NOLOGIN;
    CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(worker)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(group)} TO ${identifier(operator)};
    ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB';
    ALTER ROLE ${identifier(worker)} SET temp_file_limit='32MB'`);
  await installAuditReportAccess(audit, group);
  await installAuditDetailReport(audit, group, sources);
  await installAuditReconcileReport(audit, group);
  await installAuditReconcileReport(audit, group);
  const a = identifier(audit.schema), g = identifier(game.schema);
  await audit.exec(`GRANT USAGE ON SCHEMA ${a},${g} TO ${identifier(worker)};
    GRANT SELECT ON ALL TABLES IN SCHEMA ${a},${g} TO ${identifier(worker)};
    GRANT UPDATE ON ${a}.audit_reconcile_requests TO ${identifier(worker)}`);
  await wallet.operate(accountId, { id: operationId, kind: 'play', gameId: 'royal-plinko', input: { rows: 12, risk: 'easy' },
    rulesVersion: 1, stakePolicyVersion: 1, amount: 1 });
  const row = await game.prepare("SELECT id::text,created_at FROM demo_ledger WHERE operation_id=? AND entry_type='bet'").get(operationId);
  assert(row);
  const anchor: AuditSourceRef = { namespace: game.schema + '.demo_ledger', rowId: row.id };
  const grant = (namespace: string) => audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(operator, datasetId, namespace);
  await grant(anchor.namespace);
  const evidence = new AuditEvidence(audit, audit.schema);
  const asset = { code: 'VIRTUAL_USD', contour: 'virtual', scale: 2 } as const;
  const stamp = Math.max(Date.now(), row.created_at);
  const attempt: AuditAttempt = { schemaVersion: 1, type: 'attempt', scope, occurredAtMs: stamp, attemptId: randomUUID(),
    accountId, operationId, entity: null, transport: 'http', route: '/api/demo-wallet/operations', decision: 'accepted',
    response: 'formed', statusCode: 200, balance: { state: 'value', asset, units: '-1', snapshot: anchor } };
  const peer: AuditAttempt = { ...attempt, attemptId: randomUUID(), accountId: peerId, operationId: randomUUID(), balance: { state: 'absent' } };
  await evidence.record(attempt);
  await evidence.record(peer);
  const observations = [attempt, peer].map((item, index) => ({ scope, asset, entity: null, comparisonKey: 'fixture',
    primary: { kind: 'attempt' as const, id: item.attemptId, accountId: item.accountId, operationId: item.operationId, occurredAtMs: stamp },
    supporting: index ? [] : [{ kind: 'posting' as const, source: anchor, accountId, operationId, occurredAtMs: row.created_at }],
    value: { numerator: index ? '0' : '1', denominator: '1' } }));
  const risk = evaluateAuditRiskRule({ id: 'fixture-reconcile', version: '1', metric: 'rate', windowMs: stamp - startedAtMs + 1,
    sample: { selector: 'fixture', minSubject: 1, minComparison: 1, minComparisonAccounts: 1, maxObservations: 8 },
    threshold: { absolute: { numerator: '1', denominator: '1' }, comparisonMultiple: { numerator: '1', denominator: '1' } },
    cohort: { id: 'fixture', version: '1' },
  }, { scope, fromMs: startedAtMs, toMs: stamp + 1, asOfMs: stamp + 1, subject: { accountIds: [accountId], entity: null },
    comparisonKey: 'fixture', asset, completeness: { subject: true, comparison: true }, observations });
  await new AuditRiskSignals(audit).record(risk);
  const config = (login: string) => databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: login, PGPASSWORD: password, PGPASSWORD_FILE: '' });
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-reconcile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const connectionFile = async (name: string) => {
    const url = new URL('postgresql://localhost');
    url.hostname = process.env.PGHOST!;
    url.port = process.env.PGPORT!;
    url.pathname = '/' + process.env.PGDATABASE!;
    url.username = name;
    url.password = password;
    const file = join(directory, name);
    await writeFile(file, url.href, { mode: 0o600 });
    return file;
  };
  const workerFile = await connectionFile(worker), operatorFile = await connectionFile(operator);
  const input = { schema: audit.schema, datasetId, filters: { source: anchor.namespace, postingId: anchor.rowId } };
  return { audit, game, scope, a, sources, anchor, input, grant, group, operator, worker, risk, attempt, config, workerFile, operatorFile, directory,
    wallet, accountId, peerId, startedAtMs, occurredAtMs: Number(row.created_at) };
}

test('named operator enqueues a bounded reconciliation and receives verified, separately classified results', async t => {
  const f = await fixture(t);
  const cli = async (script: string, args: string[], env: NodeJS.ProcessEnv) =>
    JSON.parse((await promisify(execFile)(process.execPath, ['--import','tsx',script,...args],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, ...env } })).stdout);
  const request = (...extra: string[]) => cli('scripts/audit.ts', ['reconcile','--schema',f.audit.schema,'--dataset',f.scope.datasetId,
    '--source',f.anchor.namespace,'--posting',f.anchor.rowId,...extra], { ROYAL_AUDIT_DB_URL_FILE: f.operatorFile });
  const processOne = () => cli('scripts/audit-reconcile-worker.ts', ['--schema',f.audit.schema,'--game-schema',f.game.schema],
    { ROYAL_AUDIT_WORKER_DB_URL_FILE: f.workerFile });
  const detail = await cli('scripts/audit.ts', ['detail','--schema',f.audit.schema,'--dataset',f.scope.datasetId,
    '--source',f.anchor.namespace,'--posting',f.anchor.rowId], { ROYAL_AUDIT_DB_URL_FILE: f.operatorFile });
  assert.equal(detail.status, 'found');
  assert.deepEqual(detail.source, f.anchor);
  assert.equal(detail.attempts[0].balance.units, '-1');
  assert.notEqual(detail.attempts[0].balance.snapshotBalanceUnits, '-1');
  const queued = await request();
  assert.equal(queued.requestStatus, 'queued');
  assert.equal(queued.environment, 'test');
  assert.deepEqual(queued.anchor, f.anchor);
  const duplicate = await request();
  assert.equal(duplicate.requestStatus, 'queued');
  assert.equal((await f.audit.prepare('SELECT count(*) AS count FROM audit_reconcile_requests').get())?.count, 1);
  assert.deepEqual(await processOne(), { outcome: 'ready' });
  assert.deepEqual(await processOne(), { outcome: 'idle' });
  const ready = await request();
  assert.equal(ready.requestStatus, 'ready');
  assert(Number.isFinite(Date.parse(ready.finishedAt)));
  assert(ready.report.financialErrors.some((item: { rule: string; observed?: string }) => item.rule === 'R-02' && item.observed === '-1'));
  assert(ready.report.coverage.some((item: { rule: string }) => item.rule === 'replay'));
  assert.deepEqual(ready.report.signals.map((item: { key: string }) => item.key), [f.risk.key]);
  assert(ready.report.evidence.some((item: AuditSourceRef) => item.namespace === f.anchor.namespace && item.rowId === f.anchor.rowId));
  assert.deepEqual(await f.audit.prepare('SELECT operator_name,status,kind FROM audit_export_jobs WHERE id=?').get(ready.jobId),
    { operator_name: f.operator, status: 'succeeded', kind: 'reconcile' });

  const restricted = new pg.Client(f.config(f.operator));
  await restricted.connect();
  t.after(() => restricted.end());
  await assert.rejects(restricted.query('SELECT * FROM ' + f.a + '.audit_reconcile_requests'), { code: '42501' });
  await restricted.query('BEGIN');
  const internal = await restricted.query('SELECT ' + f.a + ".audit_report_begin($1,'reconcile',$2) AS id",
    [f.scope.datasetId, JSON.stringify(f.input.filters)]);
  await assert.rejects(restricted.query('SELECT ' + f.a + '.audit_report_reconcile($1,false)', [internal.rows[0].id]), { code: '42501' });
  await restricted.query('ROLLBACK');
  const queueLock = await f.audit.pool.connect();
  const queueKey = f.audit.schema + ':audit-reconcile-queue';
  try {
    await queueLock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [queueKey]);
    assert.equal((await request('--refresh')).requestStatus, 'queue-busy');
    assert.equal((await request()).requestStatus, 'ready');
  } finally {
    await queueLock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [queueKey]);
    queueLock.release();
  }
  assert.equal((await request('--refresh')).requestStatus, 'queued');
  await f.audit.exec(`UPDATE audit_reconcile_requests SET status='running',claim=pg_catalog.gen_random_uuid(),
    lease_until=pg_catalog.clock_timestamp()-interval '1 second'`);
  const worker = new PostgresDatabase(f.audit.schema, { existingSchema: true, config: f.config(f.worker) });
  t.after(() => worker.close());
  const [waited, ...outcomes] = await Promise.all([
    requestAuditReconcile(f.config(f.operator), { ...f.input, waitMs: 2500 }),
    processAuditReconcileRequest(worker, f.sources), processAuditReconcileRequest(worker, f.sources),
  ]);
  assert.deepEqual(outcomes.sort(), ['idle','ready']);
  assert.equal(waited.requestStatus, 'ready');
  await f.audit.exec(`REVOKE SELECT ON ${f.a}.audit_risk_signals FROM ${identifier(f.worker)}`);
  assert.equal((await request('--refresh')).requestStatus, 'queued');
  assert.equal(await processAuditReconcileRequest(worker, f.sources), 'ready');
  const withoutSignals = (await request()).report;
  assert.deepEqual(withoutSignals.signals, []);
  assert(withoutSignals.coverage.some((item: { code: string }) => item.code === 'signal-source-unavailable'));
  assert(withoutSignals.financialErrors.some((item: { rule: string }) => item.rule === 'R-02'));
  const counterpart = f.game.schema + '.capro_pending_ledger';
  await f.grant(counterpart);
  await f.audit.prepare('UPDATE audit_reconcile_requests SET required_sources=?::text[]')
    .run([f.anchor.namespace, counterpart]);
  assert.equal((await request()).requestStatus, 'ready');
  await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND source_namespace=?').run(f.operator, counterpart);
  const redacted = await request();
  assert.equal(redacted.requestStatus, 'source-unavailable');
  assert.equal(redacted.report, null);
  assert.equal((await request('--refresh')).requestStatus, 'source-unavailable');
  assert.equal((await f.audit.prepare('SELECT status FROM audit_reconcile_requests').get())?.status, 'ready');
  await assert.rejects(worker.exec('UPDATE ' + identifier(f.game.schema) + '.demo_ledger SET balance_units=0'), { code: '42501' });
  await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND source_namespace=?').run(f.operator, f.anchor.namespace);
  await assert.rejects(requestAuditReconcile(f.config(f.operator), f.input), { code: 'permission-denied' });
});

test('reconciliation links an authorized signal to an exported viewer frame and server outcome', async t => {
  const f = await fixture(t);
  const replayId = randomUUID();
  await installAuditReplayReport(f.audit, f.group, f.sources);
  assert.equal((await persistCapturedCasinoReplay(f.audit, { datasetId: f.scope.datasetId, gameSchema: f.game.schema,
    posting: f.anchor, replayId })).status, 'stored');
  const jump = { replayId, sequence: 1, source: f.anchor };
  const risk = new AuditRiskSignals(f.audit, new AuditPostingReader(f.audit, f.game));
  assert.deepEqual((await risk.record(f.risk, [jump]))?.replayLinks, [jump]);
  const config = f.config(f.operator);
  const worker = new PostgresDatabase(f.audit.schema, { existingSchema: true, config: f.config(f.worker) });
  t.after(() => worker.close());
  const request = (refresh = false) => requestAuditReconcile(config, { ...f.input, filters: { ...f.input.filters, refresh } });
  const run = async (refresh = false) => {
    assert.equal((await request(refresh)).requestStatus, 'queued');
    assert.equal(await processAuditReconcileRequest(worker, f.sources), 'ready');
    const response = await request();
    assert.equal(response.requestStatus, 'ready');
    return response.report!;
  };
  const report = await run();
  assert.deepEqual(report.signals[0].sources, [f.anchor]);
  assert.deepEqual(report.signals[0].replayLinks, [jump]);
  assert.equal(report.replayFrames, undefined);
  const toMs = Date.now() + 1000;
  const periodInput = { schema: f.audit.schema, datasetId: f.scope.datasetId,
    filters: { source: f.anchor.namespace, accountId: f.accountId, fromMs: f.startedAtMs, toMs } };
  assert.equal((await requestAuditPeriodReconcile(config, periodInput)).requestStatus, 'queued');
  assert.equal(await processAuditReconcileRequest(worker, f.sources), 'ready');
  const periodReport = await requestAuditPeriodReconcile(config, periodInput);
  assert.equal(periodReport.report?.status, 'ready');
  assert.deepEqual(periodReport.report?.signals[0].replayLinks, [jump]);

  const cli = (args: string[]) => promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/audit.ts', ...args,
    '--schema', f.audit.schema, '--dataset', f.scope.datasetId], { cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ROYAL_AUDIT_DB_URL_FILE: f.operatorFile } });
  const file = join(f.directory, 'linked-replay.json');
  const { replayId: linkedId, sequence } = report.signals[0].replayLinks[0];
  const exported = JSON.parse((await cli(['replay', '--replay', linkedId, '--output', file])).stdout);
  assert.equal(exported.replayId, linkedId);
  const viewer = prepareViewerReplay(JSON.parse(await readFile(file, 'utf8')));
  assert.equal(viewer.status, 'ready');
  const frame = viewer.frames.find(item => item.sequence === sequence);
  assert.deepEqual(frame?.event?.postings, [f.anchor]);
  const detail = JSON.parse((await cli(['detail', '--source', f.anchor.namespace, '--posting', f.anchor.rowId])).stdout);
  const terminal = viewer.frames.at(-1)?.event;
  assert.equal(terminal?.data.kind, 'terminal');
  assert.equal(terminal?.money?.find(leg => leg.movement === 'payout')?.units, detail.outcome.payoutUnits);

  const replaceLinks = (links: unknown[]) => f.audit.prepare(
    'UPDATE audit_risk_signals SET replay_links=?::jsonb WHERE dataset_id=? AND signal_key=?')
    .run(JSON.stringify({ version: 1, links }), f.scope.datasetId, f.risk.key);
  for (const link of [{ ...jump, sequence: 999 }, { ...jump, replayId: randomUUID() }, { ...jump, sequence: 'bad' }]) {
    await replaceLinks([link]);
    const unresolved = await run(true);
    assert.deepEqual(unresolved.signals[0].sources, [f.anchor]);
    assert.deepEqual(unresolved.signals[0].replayLinks, []);
    assert(unresolved.financialErrors.some((item: { rule: string }) => item.rule === 'R-02'));
  }
  await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND source_namespace=?').run(f.operator, f.anchor.namespace);
  await assert.rejects(request(), { code: 'permission-denied' });
  await assert.rejects(cli(['replay', '--replay', linkedId, '--output', join(f.directory, 'denied.json')]),
    (error: unknown) => (error as { stderr?: string })?.stderr?.includes('"error":"permission-denied"') === true);
});

test('period reconciliation selects captured postings by time and account and reapplies source permissions', async t => {
  const f = await fixture(t);
  const filters = { source: f.anchor.namespace, fromMs: f.occurredAtMs, toMs: f.occurredAtMs + 1, accountId: f.accountId };
  const input = { schema: f.audit.schema, datasetId: f.scope.datasetId };
  const config = f.config(f.operator);
  const request = (overrides = {}) => requestAuditPeriodReconcile(config, { ...input, filters: { ...filters, ...overrides } });
  const worker = new PostgresDatabase(f.audit.schema, { existingSchema: true, config: f.config(f.worker) });
  t.after(() => worker.close());
  const processOne = () => processAuditReconcileRequest(worker, f.sources);
  const args = ['--schema',f.audit.schema,'--dataset',f.scope.datasetId,'--source',f.anchor.namespace,
    '--from',new Date(filters.fromMs).toISOString(),'--to',new Date(filters.toMs).toISOString(),'--account',f.accountId];
  const cli = (...extra: string[]) => promisify(execFile)(process.execPath, ['--import','tsx','scripts/audit.ts','reconcile',...args,...extra],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, ROYAL_AUDIT_DB_URL_FILE: f.operatorFile } });
  await assert.rejects(cli('--posting', f.anchor.rowId), { code: 2 });
  await assert.rejects(request({ toMs: filters.fromMs }), { code: 'internal-error' });
  const queued = JSON.parse((await cli()).stdout);
  assert.equal(queued.requestStatus, 'queued');
  assert.equal(queued.environment, 'test');
  assert.deepEqual(queued.selection, filters);
  assert.equal((await request()).requestStatus, 'queued');
  assert.equal((await f.audit.prepare('SELECT count(*)::int AS n FROM audit_reconcile_requests').get())?.n, 1);
  await f.audit.exec(`UPDATE audit_reconcile_requests SET status='running',claim=pg_catalog.gen_random_uuid(),
    lease_until=pg_catalog.clock_timestamp()-interval '1 second'`);
  const outcomes = await Promise.all([processOne(), processOne()]);
  assert.deepEqual(outcomes.sort(), ['idle','ready']);
  const ready = await request();
  assert.equal(ready.requestStatus, 'ready');
  const report = ready.report as { status: string; selectedCount: number;
    financialErrors: { rule: string; observed?: string; anchors: AuditSourceRef[] }[];
    coverage: { rule: string; code: string }[]; signals: { key: string; anchors: AuditSourceRef[] }[] };
  assert.equal(report.status, 'ready');
  assert(report.selectedCount > 0);
  assert(report.financialErrors.some(item => item.rule === 'R-02' && item.observed === '-1' &&
    item.anchors.some(anchor => anchor.rowId === f.anchor.rowId && anchor.namespace === f.anchor.namespace)));
  assert(report.coverage.some(item => item.rule === 'replay'));
  assert.deepEqual(report.signals.map(item => item.key), [f.risk.key]);
  assert(report.signals[0].anchors.some(anchor => anchor.rowId === f.anchor.rowId && anchor.namespace === f.anchor.namespace));
  assert.deepEqual(await f.audit.prepare('SELECT operator_name,status,kind,filters FROM audit_export_jobs WHERE id=?').get(ready.jobId),
    { operator_name: f.operator, status: 'succeeded', kind: 'reconcile', filters });
  for (const other of [{ accountId: f.peerId }, { fromMs: filters.fromMs - 1, toMs: filters.fromMs }]) {
    assert.equal((await request(other)).requestStatus, 'queued');
    assert.equal(await processOne(), 'ready');
    const empty = await request(other);
    assert.equal(empty.report?.status, 'ready');
    assert.equal(empty.report?.selectedCount, 0);
    assert.deepEqual(empty.report?.financialErrors, []);
  }

  const counterpart = f.game.schema + '.capro_pending_ledger';
  await f.grant(counterpart);
  await f.audit.prepare('UPDATE audit_reconcile_requests SET required_sources=?::text[] WHERE account_id=? AND from_ms=?')
    .run([f.anchor.namespace, counterpart], f.accountId, filters.fromMs);
  assert.equal((await request()).requestStatus, 'ready');
  await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND source_namespace=?').run(f.operator, counterpart);
  assert.equal((await request({ refresh: true })).requestStatus, 'source-unavailable');
  assert.equal((await request()).report, null);
  await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND source_namespace=?').run(f.operator, f.anchor.namespace);
  await assert.rejects(request(), { code: 'permission-denied' });
});

test('dense periods return an explicit scan limit and share queue capacity with posting checks', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 17; index++) {
    await f.wallet.operate(f.accountId, { id: randomUUID(), kind: 'deposit', amount: 1 });
  }
  const config = f.config(f.operator);
  const input = { schema: f.audit.schema, datasetId: f.scope.datasetId,
    filters: { source: f.anchor.namespace, fromMs: f.startedAtMs, toMs: Date.now() + 1, accountId: f.accountId } };
  await f.audit.prepare(`INSERT INTO audit_reconcile_requests(dataset_id,source_namespace,from_ms,to_ms,account_id,status,requested_at)
    SELECT ?,?,n,n+1,'','queued',pg_catalog.clock_timestamp() FROM pg_catalog.generate_series(1,64) n`)
    .run(f.scope.datasetId, f.anchor.namespace);
  assert.equal((await requestAuditReconcile(config, f.input)).requestStatus, 'queue-full');
  assert.equal((await requestAuditPeriodReconcile(config, input)).requestStatus, 'queue-full');
  await f.audit.exec('DELETE FROM audit_reconcile_requests');
  assert.equal((await requestAuditPeriodReconcile(config, input)).requestStatus, 'queued');
  const worker = new PostgresDatabase(f.audit.schema, { existingSchema: true, config: f.config(f.worker) });
  t.after(() => worker.close());
  assert.equal(await processAuditReconcileRequest(worker, f.sources), 'ready');
  const result = await requestAuditPeriodReconcile(config, input);
  assert.equal(result.report?.status, 'scan-limit');
  assert.equal(result.report?.selectedCount, 17);
  assert.equal(result.report?.selectedCountLowerBound, true);
  assert.deepEqual(result.report?.financialErrors, []);
});
