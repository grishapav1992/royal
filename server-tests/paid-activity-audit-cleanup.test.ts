import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startAuditAttemptRuntime } from '../server/audit/attempts';
import { initializeAuditExportDirectory, registerAuditExportFile } from '../server/audit/cleanup-files';
import { AuditCleanupBlocked, applyAuditCleanup, installAuditCleanup, previewAuditCleanup } from '../server/audit/cleanup';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { installAuditReconcileReport } from '../server/audit/report-reconcile-source';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const readonly = new PostgresDatabase(audit.schema, { readOnly: true, existingSchema: true });
  t.after(async () => { await Promise.all([game.close(), audit.close(), readonly.close()]); });
  const player = randomUUID(), other = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(player, other);
  const wallet = new DemoWalletStore(game, () => 0);
  for (const id of [player,other]) await wallet.operate(id, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const sources = { game: game.schema };
  const datasets = new AuditDatasets(audit, sources);
  const dataset = await datasets.startTest();
  await installAuditCleanup(audit);
  const filesRoot = await realpath(await mkdtemp(join(tmpdir(), 'royal-audit-cutover-')));
  t.after(() => rm(filesRoot, { recursive: true, force: true }));
  const dir = await initializeAuditExportDirectory(filesRoot, dataset.datasetId);
  const file = join(dir, 'postings.csv');
  await writeFile(file, 'scope,amount\ntest,-100\n', { mode: 0o600 });
  await registerAuditExportFile(filesRoot, dataset.datasetId, 'postings.csv');
  const operationId = randomUUID();
  const play = (id: string) => wallet.operate(player, { id, kind: 'play', gameId: 'royal-plinko',
    input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1, amount: 1 });
  await play(operationId);
  const source = game.schema + '.demo_ledger';
  const posting = await game.prepare("SELECT id::text FROM demo_ledger WHERE operation_id=? AND entry_type='bet'").get(operationId);
  assert(posting);
  const anchor = { namespace: source, rowId: posting.id as string };
  const operation = { accountId: player, operationId, occurredAtMs: Date.now(),
    attemptId: randomUUID(), entity: null, transport: 'http', route: '/api/demo-wallet/operations',
    decision: 'accepted', response: 'formed', statusCode: 200, balance: { state: 'absent' },
  } as const;
  const scope = { datasetId: dataset.datasetId, environment: dataset.environment };
  await new AuditEvidence(audit, audit.schema).record({ schemaVersion: 1, type: 'attempt', scope, ...operation });
  const replayId = randomUUID();
  assert.equal((await persistCapturedCasinoReplay(audit, { datasetId: dataset.datasetId, gameSchema: game.schema,
    posting: anchor, replayId })).status, 'stored');
  const input = { sources, datasetId: dataset.datasetId, filesRoot };
  const raw = () => Promise.all(['demo_ledger','demo_wallets','demo_operations'].map(table =>
    game.prepare(`SELECT to_jsonb(s) AS row FROM ${table} s ORDER BY to_jsonb(s)::text`).all()));
  return { game, audit, readonly, wallet, datasets, dataset, input, source, anchor, operation, file, filesRoot, player, other, play, raw };
}

test('reviews an exact manifest, purges only test data and records a new live checkpoint with the original wallet intact', async t => {
  const f = await fixture(t);
  const group = 'audit_cleanup_reader_' + randomUUID().replaceAll('-','').slice(0,12);
  const operator = group + '_login', password = randomUUID();
  await f.audit.exec(`CREATE ROLE ${identifier(group)} NOLOGIN;
    CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(group)} TO ${identifier(operator)};
    ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB'`);
  await installAuditReportAccess(f.audit, group);
  await installAuditDetailReport(f.audit, group, f.input.sources);
  await installAuditReconcileReport(f.audit, group);
  const grant = (dataset: string) => f.audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(operator,dataset,f.source);
  await grant(f.input.datasetId);
  assert((await previewAuditCleanup(f.readonly, f.input)).blockers.includes('test-dataset-not-sealed'));
  await f.datasets.sealTest(f.input.datasetId);
  await f.audit.prepare(`INSERT INTO audit_reconcile_requests(dataset_id,source_namespace,posting_id,status,requested_at)
    VALUES (?,?,?,'queued',clock_timestamp())`).run(f.input.datasetId,f.source,f.anchor.rowId);
  assert((await previewAuditCleanup(f.readonly,f.input)).blockers.includes('active-reconcile-requests'));
  await f.audit.prepare('DELETE FROM audit_reconcile_requests WHERE dataset_id=?').run(f.input.datasetId);
  const raw = await f.raw(), before = await previewAuditCleanup(f.readonly, f.input);
  assert.deepEqual(before.blockers, []);
  assert.equal(before.files.files.length, 1);
  assert(before.rows.some(row => row.table === 'audit_replay_fragments' && row.rows === 1));
  assert(before.rows.some(row => row.table === 'audit_report_acl' && row.rows === 1));
  assert.deepEqual(await previewAuditCleanup(f.readonly, f.input), before);
  assert.deepEqual(await f.raw(), raw);
  assert.match(await readFile(f.file,'utf8'), /test,-100/);
  assert.equal((await f.audit.prepare('SELECT count(*)::int AS n FROM audit_cleanup_runs').get())?.n, 0);

  await f.audit.prepare(`UPDATE audit_evidence SET payload=jsonb_set(payload,'{statusCode}','201'::jsonb)
    WHERE dataset_id=? AND evidence_id=?`).run(f.input.datasetId,f.operation.attemptId);
  await assert.rejects(applyAuditCleanup(f.audit, { ...f.input, expectedSha256: before.sha256 }), error =>
    error instanceof AuditCleanupBlocked && error.blockers.includes('manifest-changed'));
  assert.match(await readFile(f.file,'utf8'), /test,-100/);
  assert.equal((await f.audit.prepare('SELECT count(*)::int AS n FROM audit_datasets').get())?.n, 1);
  await f.audit.prepare(`UPDATE audit_evidence SET payload=jsonb_set(payload,'{statusCode}','200'::jsonb)
    WHERE dataset_id=? AND evidence_id=?`).run(f.input.datasetId,f.operation.attemptId);

  const writer = await f.game.pool.connect();
  try {
    await writer.query('BEGIN');
    await writer.query('LOCK TABLE ' + identifier(f.game.schema) + '.demo_wallets IN ROW EXCLUSIVE MODE');
    await assert.rejects(applyAuditCleanup(f.audit, { ...f.input, expectedSha256: before.sha256 }), { code: '55P03' });
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
  }
  assert.equal((await f.audit.prepare('SELECT count(*)::int AS n FROM audit_cleanup_runs').get())?.n, 0);
  const result = await applyAuditCleanup(f.audit, { ...f.input, expectedSha256: before.sha256 });
  assert.equal(result.status, 'complete');
  assert.notEqual(result.liveDatasetId, f.input.datasetId);
  assert.deepEqual(await f.raw(), raw);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  for (const { table } of before.rows) {
    assert.equal(await f.audit.prepare(`SELECT 1 FROM ${identifier(table)} WHERE dataset_id=?`).get(f.input.datasetId), undefined);
  }
  const live = await f.audit.prepare('SELECT environment,sealed_at_ms FROM audit_datasets WHERE id=?').get(result.liveDatasetId);
  assert.deepEqual(live, { environment: 'live', sealed_at_ms: null });
  assert.equal((await f.audit.prepare(`SELECT available_units::text FROM audit_opening_balances
    WHERE dataset_id=? AND account_id=? AND source_namespace=?`).get(result.liveDatasetId,f.player,f.source))?.available_units,
  (await f.game.prepare('SELECT (balance::numeric*100+fraction_units)::text AS units FROM demo_wallets WHERE account_id=?').get(f.player))?.units);
  await assert.rejects(previewAuditCleanup(f.readonly, { ...f.input, datasetId: result.liveDatasetId }), AuditCleanupBlocked);
  assert.equal((await applyAuditCleanup(f.audit, { ...f.input, expectedSha256: before.sha256 })).liveDatasetId, result.liveDatasetId);
  await f.play(f.operation.operationId);
  assert.deepEqual(await f.raw(), raw);

  const env = { ...process.env, ROYAL_AUDIT_SCHEMA: f.audit.schema, ROYAL_AUDIT_TEST_DATASET_ID: undefined,
    ROYAL_AUDIT_LIVE_DATASET_ID: result.liveDatasetId };
  assert.throws(() => startAuditAttemptRuntime({ ...env, ROYAL_AUDIT_TEST_DATASET_ID: f.input.datasetId }), /exactly one/);
  const runtime = startAuditAttemptRuntime(env);
  assert(runtime);
  const newId = randomUUID();
  await f.play(newId);
  runtime.record({ ...f.operation, operationId: newId, attemptId: randomUUID(), occurredAtMs: Date.now() });
  await runtime.close();
  const captured = await f.audit.prepare('SELECT dataset_id::text,operation_id FROM audit_posting_refs ORDER BY source_row_id').all();
  assert(captured.length > 0 && captured.every(row => row.dataset_id === result.liveDatasetId && row.operation_id === newId));
  const observation = await f.audit.prepare('SELECT payload FROM audit_evidence').get();
  assert.deepEqual(observation?.payload.scope, { datasetId: result.liveDatasetId, environment: 'live' });
  await grant(result.liveDatasetId);
  const config = databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: operator, PGPASSWORD: password, PGPASSWORD_FILE: '' });
  const options = { schema: f.audit.schema, datasetId: result.liveDatasetId,
    filters: { source: f.source, postingId: f.anchor.rowId } };
  assert.equal((await readAuditDetail(config, options)).status, 'not-captured');
  const posting = await f.audit.prepare('SELECT source_row_id::text AS id FROM audit_posting_refs WHERE operation_id=? LIMIT 1').get(newId);
  const report = await readAuditDetail(config, { ...options, filters: { ...options.filters, postingId: posting!.id } });
  assert.equal(report.status, 'found');
  assert.equal(report.environment, 'live');
});

test('blocks open financial operations, shared posting links, derived foreign links and unknown audit tables', async t => {
  const f = await fixture(t);
  const pvp = new VirtualPvpLedger(f.game,f.wallet), matchId = randomUUID();
  for (const player of [f.player,f.other]) await pvp.pvpHold(player, { matchId,gameId:'chess',stakeUnits:'1000000' });
  await f.datasets.sealTest(f.input.datasetId);
  const open = await previewAuditCleanup(f.readonly,f.input);
  assert(open.blockers.some(code => code.startsWith('open-financial-source:') && code.endsWith('.virtual_pvp_holds')));
  await assert.rejects(applyAuditCleanup(f.audit,{ ...f.input,expectedSha256:open.sha256 }), AuditCleanupBlocked);
  await pvp.pvpFinish(f.player, { matchId, winnerId:null, reason:'draw' });
  const foreign = randomUUID();
  await f.audit.prepare("INSERT INTO audit_datasets VALUES (?,'live',1,2)").run(foreign);
  await f.audit.prepare('INSERT INTO audit_dataset_sources VALUES (?,?)').run(foreign,f.source);
  await f.audit.prepare(`INSERT INTO audit_posting_refs SELECT ?,source_namespace,source_row_id,account_id,operation_id,occurred_at_ms
    FROM audit_posting_refs WHERE dataset_id=? AND source_namespace=? AND source_row_id=?`)
    .run(foreign,f.input.datasetId,f.source,f.anchor.rowId);
  assert((await previewAuditCleanup(f.readonly,f.input)).blockers.includes('shared-posting-reference'));
  await f.audit.prepare('DELETE FROM audit_posting_refs WHERE dataset_id=?').run(foreign);
  await f.audit.prepare("INSERT INTO audit_evidence VALUES (?,'event','fixture-foreign',NULL,1,?::jsonb)")
    .run(foreign,JSON.stringify({ postings:[f.anchor] }));
  assert((await previewAuditCleanup(f.readonly,f.input)).blockers.includes('foreign-derived-reference:audit_evidence'));
  await f.audit.prepare('UPDATE audit_evidence SET payload=?::jsonb WHERE dataset_id=?').run(JSON.stringify({
    sources: [{ namespace: f.audit.schema + '.audit_evidence', rowId: JSON.stringify([f.input.datasetId,'attempt',f.operation.attemptId]) }],
  }),foreign);
  assert((await previewAuditCleanup(f.readonly,f.input)).blockers.includes('foreign-derived-reference:audit_evidence'));
  await f.audit.exec('CREATE TABLE audit_unregistered (dataset_id uuid)');
  assert((await previewAuditCleanup(f.readonly,f.input)).blockers.includes('unknown-audit-table'));
});

test('refuses audit table inheritance or delete rewrites that could touch a different schema', async t => {
  const f = await fixture(t);
  await f.datasets.sealTest(f.input.datasetId);
  const manifest = await previewAuditCleanup(f.readonly,f.input);
  const parent = identifier(f.audit.schema) + '.audit_evidence';
  const external = identifier(f.game.schema) + '.fixture_inherited';
  await f.audit.exec(`CREATE TABLE ${external} () INHERITS (${parent})`);
  await f.audit.prepare(`INSERT INTO ${external} VALUES (?,'event','foreign-child',NULL,1,'{}'::jsonb)`).run(f.input.datasetId);
  await assert.rejects(applyAuditCleanup(f.audit,{ ...f.input,expectedSha256:manifest.sha256 }), error =>
    error instanceof AuditCleanupBlocked && error.blockers.includes('unknown-audit-table'));
  assert.equal((await f.audit.prepare(`SELECT evidence_id FROM ${external}`).get())?.evidence_id,'foreign-child');
  await f.audit.exec(`DROP TABLE ${external}; CREATE RULE fixture_delete AS ON DELETE TO ${parent} DO INSTEAD NOTHING`);
  assert((await previewAuditCleanup(f.readonly,f.input)).blockers.includes('unknown-audit-table'));
  await assert.rejects(applyAuditCleanup(f.audit,{ ...f.input,expectedSha256:manifest.sha256 }), AuditCleanupBlocked);
  assert.match(await readFile(f.file,'utf8'),/test,-100/);
});

test('the service CLI installs report access, stops capture and safely resumes the reviewed cutover', async t => {
  const f = await fixture(t);
  const url = new URL('postgresql://localhost');
  url.hostname = process.env.PGHOST!;
  url.port = process.env.PGPORT!;
  url.pathname = '/' + process.env.PGDATABASE!;
  url.username = process.env.PGUSER!;
  url.password = process.env.PGPASSWORD!;
  // Scratch PostgreSQL only. Give the fixture's service login a bounded temp limit.
  await f.audit.exec("ALTER ROLE CURRENT_USER SET temp_file_limit='32MB'");
  t.after(async () => {
    const admin = new PostgresDatabase(f.audit.schema, { existingSchema: true });
    try { await admin.exec('ALTER ROLE CURRENT_USER RESET temp_file_limit'); } finally { await admin.close(); }
  });
  const file = join(f.filesRoot,'cleanup-config');
  await writeFile(file,url.href,{ mode:0o600 });
  const group = 'audit_install_reader_' + randomUUID().replaceAll('-','').slice(0,12);
  await f.audit.exec(`CREATE ROLE ${identifier(group)} NOLOGIN`);
  const run = (command:string,...extra:string[]) => promisify(execFile)(process.execPath,
    ['--import','tsx','scripts/audit-cleanup.ts',command,'--schema',f.audit.schema,'--game-schema',f.game.schema,
      ...(command === 'install' ? [] : ['--dataset',f.input.datasetId]),
      ...(['plan','apply'].includes(command) ? ['--files-root',f.filesRoot] : []),...extra],
    { cwd:fileURLToPath(new URL('..',import.meta.url)),env:{ ...process.env,ROYAL_AUDIT_CLEANUP_DB_URL_FILE:file } });
  const expectedInstallation = { status:'installed', readerRole:group };
  assert.deepEqual(JSON.parse((await run('install','--reader-role',group)).stdout),expectedInstallation);
  assert.deepEqual(JSON.parse((await run('install','--reader-role',group)).stdout),expectedInstallation);
  const privileges = await f.audit.prepare(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=? AND has_function_privilege(?,p.oid,'EXECUTE') ORDER BY p.proname`).all(f.audit.schema,group);
  assert.deepEqual(privileges.map(row => row.proname), [
    'audit_report_begin','audit_report_detail','audit_report_finish','audit_report_player_page',
    'audit_report_reconcile','audit_report_replay','audit_report_summary',
  ]);
  assert.equal((await f.audit.prepare("SELECT has_table_privilege(?,?,'SELECT') AS direct").get(group,f.source))?.direct,false);
  const stopped = JSON.parse((await run('stop-capture','--environment','test')).stdout);
  assert.equal(stopped.status,'stopped');
  assert.equal(stopped.datasetId,f.input.datasetId);
  assert.equal((await f.game.prepare(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='demo_ledger'::regclass
    AND tgname='royal_audit_posting_v1'`).get())?.tgenabled,'D');
  await f.audit.exec(`CREATE FUNCTION stop_cleanup_journal() RETURNS trigger LANGUAGE plpgsql AS $audit$
    BEGIN RAISE EXCEPTION 'fixture interruption'; END $audit$;
    CREATE TRIGGER stop_cleanup_journal BEFORE UPDATE ON audit_cleanup_runs FOR EACH ROW EXECUTE FUNCTION stop_cleanup_journal()`);
  const manifest = JSON.parse((await run('plan')).stdout);
  assert.deepEqual(manifest.blockers,[]);
  await assert.rejects(run('apply','--sha256',manifest.sha256), error => {
    const pending = JSON.parse(String((error as { stdout?: string }).stdout));
    assert.equal(pending.status,'files-pending');
    return true;
  });
  const row = await f.audit.prepare('SELECT live_dataset_id::text,files_completed_at_ms FROM audit_cleanup_runs').get();
  assert(row && row.files_completed_at_ms === null);
  await f.audit.exec('DROP TRIGGER stop_cleanup_journal ON audit_cleanup_runs');
  const finished = JSON.parse((await run('apply','--sha256',manifest.sha256)).stdout);
  assert.equal(finished.status,'complete');
  assert.equal(finished.liveDatasetId,row.live_dataset_id);
  assert.equal(finished.files.alreadyAbsent,1);
  assert.equal((await f.audit.prepare("SELECT count(*)::int AS n FROM audit_datasets WHERE environment='live'").get())?.n,1);
  assert.equal((await f.game.prepare(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='demo_ledger'::regclass
    AND tgname='royal_audit_posting_v1'`).get())?.tgenabled,'O');
  await assert.rejects(run('stop-capture','--environment','test'));
  await assert.rejects(promisify(execFile)(process.execPath, ['--import','tsx','scripts/audit-cleanup.ts',
    'init-files','--schema',f.audit.schema,'--dataset',f.input.datasetId,'--files-root',f.filesRoot], {
    cwd:fileURLToPath(new URL('..',import.meta.url)),env:{ ...process.env,ROYAL_AUDIT_CLEANUP_DB_URL_FILE:file },
  }), error => String((error as { stderr?: string }).stderr).includes('test-dataset-already-cleaned'));
  const stoppedLive = await f.datasets.stopCapture(row.live_dataset_id,'live');
  assert.equal(stoppedLive.environment,'live');
  const unobserved = randomUUID();
  await f.play(unobserved);
  assert.equal((await f.game.prepare('SELECT count(*)::int AS n FROM demo_ledger WHERE operation_id=?').get(unobserved))?.n,2);
  assert.equal((await f.audit.prepare('SELECT count(*)::int AS n FROM audit_posting_refs WHERE operation_id=?').get(unobserved))?.n,0);
});
