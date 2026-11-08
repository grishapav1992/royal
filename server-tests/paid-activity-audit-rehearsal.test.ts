import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import pg, { type PoolClient } from 'pg';
import { startAuditAttemptRuntime } from '../server/audit/attempts';
import { checkCapturedCasinoRound } from '../server/audit/check-casino';
import { reconcileStoredPvpMatch } from '../server/audit/check-pvp';
import { reconcileStoredTotePool } from '../server/audit/check-tote';
import { initializeAuditExportDirectory, registerAuditExportFile } from '../server/audit/cleanup-files';
import { applyAuditCleanup, installAuditCleanup, previewAuditCleanup } from '../server/audit/cleanup';
import type { AuditSourceRef } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { auditHttpAttempts } from '../server/audit/http-attempts';
import { auditCommandRoutes } from '../server/audit/intents';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { persistCapturedToteReplay } from '../server/audit/replay-tote';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { installAuditPlayerReport } from '../server/audit/report-player-source';
import { exportAuditPlayer } from '../server/audit/report-player';
import { installAuditReplayReport } from '../server/audit/report-replay-source';
import { exportAuditReplay } from '../server/audit/report-replay';
import { installAuditSummaryReport } from '../server/audit/report-summary-source';
import { readAuditSummary } from '../server/audit/report-summary';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { FlagToteStore } from '../server/flagTote';
import { PaymentCredits } from '../server/payments/credits';
import { PaymentOutbox } from '../server/payments/outbox';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { seedAuditLoadReplay } from '../scripts/audit-load-replay-fixture';
import { temporaryDatabase } from '../scripts/database-test';
import { prepareViewerReplay } from '../src/audit/replay-viewer-model';
// @ts-ignore The independent qualification fixture is JavaScript without declarations.
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../src/shared/caribbeanTreasures';
import type { ExpansionAction } from '../src/shared/casinoExpansion';
import { TOTE_TIMING } from '../src/shared/flagTote';

async function observed<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = performance.now() + 3000;
  for (;;) {
    const result = await read();
    if (result !== undefined) return result;
    if (performance.now() >= deadline) throw new Error('Rehearsal observer did not reach the expected state');
    await pause(5);
  }
}

const pgBin = process.env.ROYAL_TEST_PG_BIN;
const exec = promisify(execFile);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function localArchiveTool(tool: 'pg_dump' | 'pg_restore', env: NodeJS.ProcessEnv, args: string[]) {
  assert(pgBin && isAbsolute(pgBin), 'Archive tool directory must be absolute');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.equal(env.PGDATABASE, 'royal_test');
  assert.equal(env.PGUSER, 'postgres');
  assert.match(env.PGPORT ?? '', /^[1-9][0-9]{0,4}$/);
  assert(env.PGPASSWORD);
  return exec(join(pgBin, tool + (process.platform === 'win32' ? '.exe' : '')), [
    '--host=127.0.0.1', '--port=' + env.PGPORT, '--username=postgres', '--dbname=royal_test', '--no-password', ...args,
  ], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LC_ALL: 'C', PGSSLMODE: 'disable',
    PGPASSWORD: env.PGPASSWORD }, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
}

async function archiveSnapshot<T>(game: PostgresDatabase, inspect: (client: PoolClient) => Promise<T>) {
  const client = await game.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'");
    return await inspect(client);
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { client.release(); }
  }
}

async function inspectArchiveState(client: PoolClient, schemas: string[], operator: string, group: string, audit: string) {
  const tables = await client.query<{ schema_name: string; table_name: string }>(
    `SELECT n.nspname AS schema_name,c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND n.nspname=ANY($1::text[]) ORDER BY n.nspname,c.relname`, [schemas]);
  const contents = [];
  for (const { schema_name, table_name } of tables.rows) {
    const table = identifier(schema_name) + '.' + identifier(table_name);
    const { rows } = await client.query(`SELECT count(*)::int AS rows,
      encode(sha256(convert_to(COALESCE(string_agg(body,E'\\n' ORDER BY body COLLATE "C"),''),'UTF8')),'hex') AS digest
      FROM (SELECT to_jsonb(entry)::text AS body FROM ${table} entry) contents`);
    contents.push({ table, ...rows[0] });
  }
  const triggers = (await client.query(`SELECT c.relname AS table_name,t.tgenabled,
      pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function_definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND t.tgname='royal_audit_posting_v1' ORDER BY n.nspname,c.relname`, [schemas])).rows;
  const operatorAccess = (await client.query(`SELECT pg_has_role($1::name,$2::name,'MEMBER') AS member,
      has_schema_privilege($1::name,$3::text,'USAGE') AS schema_usage,
      has_function_privilege($1::name,format('%I.audit_report_begin(uuid,text,jsonb)',$3),'EXECUTE') AS run_report,
      has_table_privilege($1::name,format('%I.audit_posting_refs',$3),'SELECT') AS read_source`, [operator, group, audit])).rows[0];
  return { contents, triggers, operatorAccess };
}

function schemaFingerprint(sql: string) {
  // PostgreSQL adds a random restrict key to each text dump.
  return sha256(sql.replace(/^\\(?:un)?restrict [^\r\n]+\r?\n/gm, ''));
}

async function openStores(game: PostgresDatabase) {
  const wallet = new DemoWalletStore(game, cascadeRandom(129733));
  const bank = new VirtualPvpLedger(game, wallet);
  const pvp = new PvpStore(bank), combat = new NileCombatEscrow(bank);
  await Promise.all([pvp.ready, combat.ready]);
  return { wallet, bank, pvp };
}

test('isolated rehearsal settles accepted games and preserves payments through observer failure and test-to-live cutover',
  { timeout: pgBin ? 65_000 : 25_000 }, async t => {
    // The project database runner supplies these values and creates a disposable local cluster.
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.PGHOST, '127.0.0.1');
    assert.equal(process.env.PGDATABASE, 'royal_test');
    assert.equal(process.env.DATABASE_URL, '');
    assert.equal(process.env.DATABASE_URL_FILE, '');
    const originalGame = new PostgresDatabase(':memory:'), originalAudit = new PostgresDatabase(':memory:');
    const originalPayments = new PostgresDatabase(':memory:');
    let game = originalGame, audit = originalAudit, payments = originalPayments, connectionEnv = process.env;
    let restored: Awaited<ReturnType<typeof temporaryDatabase>> | undefined;
    const connections = new Set([game, audit, payments]);
    let runtime: ReturnType<typeof startAuditAttemptRuntime>;
    t.after(async () => {
      try { await runtime?.close(); }
      finally {
        try { await Promise.all([...connections].map(db => db.close())); }
        finally { await restored?.cleanup(); }
      }
    });
    const player = randomUUID(), other = randomUUID();
    await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(player, other);
    await payments.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await payments.prepare('INSERT INTO accounts VALUES (?)').run(player);
    // Credit an already confirmed Stars purchase without contacting a provider.
    const openPaymentStores = () => {
      const credits = new PaymentCredits(game);
      const outbox = new PaymentOutbox(payments, 'http://fixture/internal/payments/events', 'a'.repeat(64), credits.ready,
        async (_url, init) => Response.json(await credits.apply(JSON.parse(String(init?.body)))));
      const crypto = new CryptoStore(payments, cryptoConfig({}), {} as CryptoProvider, outbox.ready,
        undefined, undefined, change => outbox.record(change));
      return { credits, outbox, crypto };
    };
    let { credits, outbox, crypto } = openPaymentStores();
    const openingPayment = randomUUID(), testPayment = randomUUID(), livePayment = randomUUID();
    const credit = (id: string, units: string) => crypto.creditStarsDeposit(player, id, units, 'rehearsal-' + id, 100);
    await credit(openingPayment, '1000000');
    await outbox.flush();
    assert.deepEqual(await credits.snapshot(player), { balanceUnits: '1000000', reservedUnits: '0' });
    let { wallet, bank, pvp } = await openStores(game);
    for (const account of [player, other]) {
      await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 1000 });
    }
    const a = { accountId: player, name: 'Rehearsal A', roomId: 'rehearsal' };
    const b = { accountId: other, name: 'Rehearsal B', roomId: a.roomId };
    const beginMatch = async (now: number) => {
      await pvp.syncRoom(a.roomId, [a, b].map(actor => ({ ...actor, connected: true, available: true })), now);
      const command = { id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: b.accountId };
      const match = (await pvp.command(a, command, now)).active!.id;
      const accept = { id: randomUUID(), action: 'accept', challengeId: match };
      await pvp.command(b, accept, now + 1);
      await pvp.command(b, accept, now + 1);
      for (const actor of [a, b]) await pvp.command(actor, { id: randomUUID(), action: 'ready', challengeId: match }, now + 2);
      return match;
    };
    const sources = { game: game.schema, payments: payments.schema };
    const namespace = game.schema + '.demo_ledger', paymentNamespace = payments.schema + '.crypto_ledger';
    let datasets = new AuditDatasets(audit, sources);
    const seedArchivedDataset = async () => {
      const accounts: [string, string] = [randomUUID(), randomUUID()];
      for (const account of accounts) {
        await game.prepare('INSERT INTO accounts VALUES (?)').run(account);
        await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 1000 });
      }
      await payments.prepare('INSERT INTO accounts VALUES (?)').run(accounts[0]);
      const dataset = await datasets.startTest();
      const replay = await seedAuditLoadReplay(game, audit, bank, { datasetId: dataset.datasetId, environment: 'test' }, accounts);
      const paymentId = randomUUID();
      await crypto.creditStarsDeposit(accounts[0], paymentId, '4000000', 'rehearsal-' + paymentId, 100);
      await outbox.flush();
      assert.deepEqual(await credits.snapshot(accounts[0]), { balanceUnits: '4000000', reservedUnits: '0' });
      await datasets.sealTest(dataset.datasetId);
      return { dataset, replay, accountId: accounts[0], paymentId };
    };
    const archived = pgBin ? await seedArchivedDataset() : undefined;
    const testDataset = await datasets.startTest();
    await installAuditCleanup(audit);
    const filesRoot = await realpath(await mkdtemp(join(tmpdir(), 'royal-audit-rehearsal-')));
    t.after(() => rm(filesRoot, { recursive: true, force: true }));
    const testExports = await initializeAuditExportDirectory(filesRoot, testDataset.datasetId);
    const cleanup = { datasetId: testDataset.datasetId, sources, filesRoot };
    const tag = randomUUID().replaceAll('-', '').slice(0, 12);
    const group = 'rehearsal_read_' + tag, operator = 'rehearsal_operator_' + tag, password = randomUUID();
    const roleSql = `CREATE ROLE ${identifier(group)} NOLOGIN;
      CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
      ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB'`;
    const membershipSql = `GRANT ${identifier(group)} TO ${identifier(operator)}`;
    await audit.exec(roleSql + '; ' + membershipSql);
    await installAuditReportAccess(audit, group);
    await installAuditPlayerReport(audit, group, sources);
    await installAuditSummaryReport(audit, group, sources);
    await installAuditDetailReport(audit, group, sources);
    const grant = (datasetId: string) => audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?),(?,?,?)')
      .run(operator, datasetId, namespace, operator, datasetId, paymentNamespace);
    await grant(testDataset.datasetId);
    const readerFor = (env: NodeJS.ProcessEnv) => databaseConfig({ ...env, DATABASE_URL: '', DATABASE_URL_FILE: '',
      PGUSER: operator, PGPASSWORD: password, PGPASSWORD_FILE: '' });
    const testPaymentEvent = () => payments.prepare(`SELECT event_id,body,delivered_at FROM payment_outbox
      WHERE user_id=? AND body::jsonb->>'payment_id'=?`).all(player, testPayment);
    let verifyOriginal: (() => Promise<void>) | undefined;
    let verifyArchived: (() => Promise<void>) | undefined;
    let pendingPayment: Awaited<ReturnType<typeof testPaymentEvent>> | undefined;
    if (pgBin) {
      assert(archived);
      assert.notEqual(archived.dataset.datasetId, testDataset.datasetId);
      await installAuditReplayReport(audit, group, sources);
      await grant(archived.dataset.datasetId);
      const privateRoot = await mkdtemp(join(tmpdir(), 'royal-audit-rehearsal-dump-'));
      t.after(() => rm(privateRoot, { recursive: true, force: true }));
      const archive = join(privateRoot, 'rehearsal.dump');
      const schemas = [game.schema, audit.schema, payments.schema];
      const scope = schemas.map(schema => '--schema=' + schema);
      const inspect = (client: PoolClient) => inspectArchiveState(client, schemas, operator, group, originalAudit.schema);
      const reportScope = { schema: originalAudit.schema, datasetId: archived.dataset.datasetId };
      const filters = { fromMs: archived.dataset.startedAtMs, toMs: Date.now() + 60_000 };
      const csvInput = (destination: string) => ({ ...reportScope, filters: { ...filters, accountId: archived.accountId }, destination });
      const archivedReports = async (env: NodeJS.ProcessEnv, label: string) => {
        const reader = readerFor(env);
        const csvPath = join(privateRoot, label + '.csv'), replayPath = join(privateRoot, label + '.json');
        assert.equal((await exportAuditPlayer(reader, csvInput(csvPath))).rowCount, 3);
        const csv = await readFile(csvPath);
        for (const id of [archived.dataset.datasetId, archived.replay.replayId, archived.paymentId]) assert(csv.includes(id));
        const { jobId: _summaryJob, asOf, ...summary } = await readAuditSummary(reader, { ...reportScope, filters });
        assert(Number.isFinite(Date.parse(asOf)));
        assert.equal(summary.environment, 'test');
        assert.equal(summary.scanned, 4);
        const deposit = summary.rows.find(row => row.contour === 'real' && row.asset === 'USDT' && row.movement_type === 'deposit');
        assert.deepEqual([deposit?.posting_count, deposit?.amount_units], ['1', '4000000']);
        const { jobId: _detailJob, ...detail } = await readAuditDetail(reader, { ...reportScope,
          filters: { source: archived.replay.payout.namespace, postingId: archived.replay.payout.rowId } });
        assert.equal(detail.status, 'found');
        assert.equal(detail.anchor?.amountUnits, '1900');
        const result = await exportAuditReplay(reader, { ...reportScope,
          filters: { replayId: archived.replay.replayId }, destination: replayPath });
        assert.equal(result.environment, 'test');
        assert.equal(result.engineVerified, true);
        assert.equal(result.rowCount, archived.replay.events);
        const replay = await readFile(replayPath);
        const packageFile = JSON.parse(replay.toString('utf8'));
        assert.equal(packageFile.manifest.sha256, archived.replay.checksum);
        assert.equal(prepareViewerReplay(packageFile).status, 'ready');
        return { csv, summary, detail, replay };
      };
      const before = await archivedReports(process.env, 'before');
      // Keep one confirmed payment in the archive with its mirror delivery still pending.
      await credit(testPayment, '2000000');
      pendingPayment = await testPaymentEvent();
      assert.equal(pendingPayment.length, 1);
      assert.equal(pendingPayment[0].delivered_at, null);
      const expected = await archiveSnapshot(originalGame, async client => {
        const { rows: [row] } = await client.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot');
        const snapshot = '--snapshot=' + row.snapshot;
        const state = await inspect(client);
        const ddl = await localArchiveTool('pg_dump', process.env, [...scope, snapshot, '--schema-only']);
        await localArchiveTool('pg_dump', process.env, [...scope, snapshot, '--format=custom', '--file=' + archive]);
        return { state, schema: schemaFingerprint(ddl.stdout), archive: sha256(await readFile(archive)) };
      });
      assert.deepEqual(expected.state.triggers.map(row => [row.table_name, row.tgenabled]).sort(),
        [['capro_pending_ledger', 'O'], ['crypto_ledger', 'O'], ['demo_ledger', 'O']]);
      assert.deepEqual(expected.state.operatorAccess, { member: true, schema_usage: true, run_report: true, read_source: false });
      restored = await temporaryDatabase();
      assert.notEqual(restored.env.PGPORT, process.env.PGPORT);
      const owner = new pg.Client(databaseConfig(restored.env));
      try { await owner.connect(); await owner.query(roleSql); }
      finally { await owner.end(); }
      await localArchiveTool('pg_restore', restored.env, ['--single-transaction', '--exit-on-error', archive]);
      assert.equal(sha256(await readFile(archive)), expected.archive);
      connectionEnv = restored.env;
      const config = databaseConfig(connectionEnv);
      game = new PostgresDatabase(originalGame.schema, { existingSchema: true, config });
      audit = new PostgresDatabase(originalAudit.schema, { existingSchema: true, config });
      payments = new PostgresDatabase(originalPayments.schema, { existingSchema: true, config });
      connections.add(game).add(audit).add(payments);
      await Promise.all([game.ready, audit.ready, payments.ready]);
      const filesBeforeDenied = (await readdir(privateRoot)).sort();
      await assert.rejects(exportAuditPlayer(readerFor(connectionEnv), csvInput(join(privateRoot, 'denied.csv'))),
        { code: 'permission-denied', jobId: null });
      assert.deepEqual((await readdir(privateRoot)).sort(), filesBeforeDenied);
      await audit.exec(membershipSql);
      assert.deepEqual(await archiveSnapshot(game, inspect), expected.state);
      assert.equal(schemaFingerprint((await localArchiveTool('pg_dump', connectionEnv, [...scope, '--schema-only'])).stdout), expected.schema);
      assert.deepEqual(await testPaymentEvent(), pendingPayment);
      assert.deepEqual(await archivedReports(connectionEnv, 'restored'), before);
      const operatorFile = join(privateRoot, 'operator-url');
      const cliReplay = join(privateRoot, 'restored-cli.json');
      const operatorUrl = new URL('postgresql://127.0.0.1/royal_test');
      operatorUrl.port = restored.env.PGPORT;
      operatorUrl.username = operator;
      operatorUrl.password = password;
      await writeFile(operatorFile, operatorUrl.toString() + '\n', { mode: 0o600, flag: 'wx' });
      const { stdout } = await exec(process.execPath, ['--import', 'tsx',
        fileURLToPath(new URL('../scripts/audit.ts', import.meta.url)), 'replay', '--schema', reportScope.schema,
        '--dataset', reportScope.datasetId, '--replay', archived.replay.replayId, '--output', cliReplay], {
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test',
          ROYAL_AUDIT_DB_URL_FILE: operatorFile, ROYAL_AUDIT_PGSSLMODE: 'disable' }, timeout: 15_000,
      });
      const { jobId, engineVerified } = JSON.parse(stdout);
      assert.equal(engineVerified, true);
      assert.deepEqual(await readFile(cliReplay), before.replay);
      assert.deepEqual(await audit.prepare(
        'SELECT operator_name,kind,status,row_count,byte_count FROM audit_export_jobs WHERE id=?').get(jobId),
      { operator_name: operator, kind: 'replay', status: 'succeeded', row_count: archived.replay.events, byte_count: before.replay.length });
      verifyArchived = async () => {
        assert.deepEqual(await archivedReports(connectionEnv, 'after-cutover'), before);
      };
      verifyOriginal = async () => {
        assert.deepEqual(await archiveSnapshot(originalGame, inspect), expected.state);
        assert.equal(schemaFingerprint((await localArchiveTool('pg_dump', process.env, [...scope, '--schema-only'])).stdout), expected.schema);
      };
      ({ wallet, bank, pvp } = await openStores(game));
      ({ credits, outbox, crypto } = openPaymentStores());
      datasets = new AuditDatasets(audit, sources, { existingSchema: true });
    }
    const checkpoint = (datasetId: string) => audit.prepare(`SELECT available_units::text,reserved_units::text
      FROM audit_opening_balances WHERE dataset_id=? AND source_namespace=? AND account_id=?`)
      .get(datasetId, paymentNamespace, player);
    assert.deepEqual(await checkpoint(testDataset.datasetId), { available_units: '1000000', reserved_units: '0' });
    const capturePayment = async (operationId: string) => {
      const [posting, ...duplicates] = await payments.prepare('SELECT id::text FROM crypto_ledger WHERE account_id=? AND operation_id=?')
        .all(player, operationId);
      assert(posting);
      assert.equal(duplicates.length, 0);
      return { namespace: paymentNamespace, rowId: posting.id as string };
    };
    const openingPaymentAnchor = await capturePayment(openingPayment);
    const readOnlyAudit = new PostgresDatabase(audit.schema, { readOnly: true, existingSchema: true, config: databaseConfig(connectionEnv) });
    connections.add(readOnlyAudit);
    const reader = readerFor(connectionEnv);
    const detail = (datasetId: string, anchor: AuditSourceRef) => readAuditDetail(reader,
      { schema: audit.schema, datasetId, filters: { source: anchor.namespace, postingId: anchor.rowId } });
    const observerEnv = { ...connectionEnv, ROYAL_AUDIT_SCHEMA: audit.schema, ROYAL_AUDIT_RECORDER_DB_URL_FILE: undefined,
      ROYAL_AUDIT_TEST_DATASET_ID: undefined, ROYAL_AUDIT_LIVE_DATASET_ID: undefined,
      ROYAL_AUDIT_TOTE_ADMISSION: '1', ROYAL_AUDIT_CHESS_REPLAY: undefined, ROYAL_AUDIT_COMBAT_REPLAY: undefined,
      ROYAL_AUDIT_CARD_REPLAY: undefined, ROYAL_AUDIT_SPORT_REPLAY: undefined, ROYAL_AUDIT_TSU_REPLAY: undefined };
    runtime = startAuditAttemptRuntime({ ...observerEnv, ROYAL_AUDIT_TEST_DATASET_ID: testDataset.datasetId }, game.schema);
    assert(runtime?.recordToteAdmission);
    const stopObserver = async () => {
      const active = runtime;
      runtime = undefined;
      await active?.close();
    };
    const app = express();
    const observer = auditHttpAttempts(record => runtime?.record(record), { gameSchema: game.schema });
    app.use(express.json({ limit: '4kb' }));
    app.use((req, res, next) => {
      res.locals.accountId = player;
      if (runtime) observer(req, res, next);
      else next();
    });
    app.post(auditCommandRoutes.expansion, async (req, res) => { res.json(await wallet.expansion.operate(player, req.body)); });
    app.post(auditCommandRoutes.core, async (req, res) => { res.json(await wallet.operate(player, req.body)); });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>(resolveClose => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    }));
    const address = server.address();
    assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
    const send = async <T>(route: string, body: unknown): Promise<T> => {
      const result = await fetch('http://127.0.0.1:' + address.port + route, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(result.status, 200);
      return result.json() as Promise<T>;
    };
    const expand = (command: ExpansionAction) =>
      send<Awaited<ReturnType<typeof wallet.expansion.operate>>>(auditCommandRoutes.expansion, command);
    const capture = async (operationId: string, entry = 'bet', account = player) => {
      const posting = await game.prepare('SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type=?')
        .get(account, operationId, entry);
      assert(posting);
      return { namespace, rowId: posting.id as string };
    };

    let poolNow = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period + 1;
    const pool = new FlagToteStore(game, id => wallet.snapshotInTransaction(id), wallet.ready, () => poolNow, () => 0);
    pool.setAdmissionObserver(runtime.recordToteAdmission);
    const { round } = await pool.snapshot(player);
    const tickets = [
      { account: player, id: randomUUID(), roundId: round.id, rulesVersion: 1, country: 'FR', stakeUnits: '100' },
      { account: player, id: randomUUID(), roundId: round.id, rulesVersion: 1, country: 'BR', stakeUnits: '200' },
      { account: other, id: randomUUID(), roundId: round.id, rulesVersion: 1, country: 'DE', stakeUnits: '100' },
    ] as const;
    // These direct store calls represent historical tickets. The public new-ticket HTTP guard is tested independently.
    for (const { account, ...ticket } of tickets) await pool.bet(account, ticket);
    const matchClock = Date.now();
    const match = await beginMatch(matchClock);
    const roundId = randomUUID();
    const settings = { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } } as const;
    const start = { id: roundId, gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings } as const;
    await audit.exec(`CREATE FUNCTION rehearsal_reject_attempt() RETURNS trigger LANGUAGE plpgsql AS $fixture$
      BEGIN RAISE EXCEPTION 'Rehearsal injected write failure' USING ERRCODE='42501'; END $fixture$;
      CREATE TRIGGER rehearsal_reject_attempt BEFORE INSERT ON audit_evidence FOR EACH ROW
      WHEN (NEW.kind='attempt' AND NEW.payload->>'operationId'='${roundId}') EXECUTE FUNCTION rehearsal_reject_attempt()`);
    const opened = await expand(start);
    assert.equal(opened.session.state, 'active');
    assert.equal(opened.session.spentUnits, caribbeanInitialCost(settings.caribbean, '100'));
    const casinoAnchor = await capture(roundId);
    const matchAnchor = await capture('pvp:' + match + ':hold');
    const ticketAnchor = await capture('flag-tote:' + tickets[0].id);
    const failure = await observed(() => audit.prepare('SELECT missing_count FROM audit_attempt_capture_gaps WHERE dataset_id=?')
      .get(testDataset.datasetId));
    assert.equal(failure.missing_count, 1);
    const capturedStart = await audit.prepare('SELECT source_row_id::text FROM audit_posting_refs WHERE dataset_id=? AND operation_id=?')
      .get(testDataset.datasetId, roundId);
    assert.equal(capturedStart?.source_row_id, casinoAnchor.rowId);
    assert.equal(await audit.prepare("SELECT 1 FROM audit_evidence WHERE dataset_id=? AND kind='attempt'").get(testDataset.datasetId), undefined);
    await audit.exec('DROP TRIGGER rehearsal_reject_attempt ON audit_evidence; DROP FUNCTION rehearsal_reject_attempt()');
    const replayed = await expand(start);
    assert.equal(replayed.replayed, true);
    const retry = await observed(() => audit.prepare("SELECT payload FROM audit_evidence WHERE dataset_id=? AND kind='attempt'")
      .get(testDataset.datasetId));
    assert.equal(retry.payload.operationId, roundId);
    assert.equal(retry.payload.decision, 'replayed');

    const early = await previewAuditCleanup(readOnlyAudit, cleanup);
    for (const relation of ['demo_casino_sessions', 'virtual_pvp_holds', 'flag_tote_reservations']) {
      assert(early.blockers.includes('open-financial-source:' + game.schema + '.' + relation));
    }
    assert(early.blockers.includes('test-dataset-not-sealed'));
    pool.setAdmissionObserver(undefined);
    await stopObserver();

    let session = opened.session;
    const moves: Extract<ExpansionAction, { action: 'move' }>[] = [];
    while (session.state === 'active') {
      assert(moves.length < 40);
      const move = { id: randomUUID(), gameId: CARIBBEAN_GAME, action: 'move', sessionId: roundId,
        move: 'caribbean-spin', revision: session.view.caribbean!.revision } as const;
      moves.push(move);
      session = (await expand(move)).session;
    }
    assert.equal(session.state, 'settled');
    assert(moves.length > 0);
    assert.equal((await expand(moves.at(-1)!)).replayed, true);
    await pvp.adjudicate(a.roomId, match, player, 'win', matchClock + 3);
    await pvp.adjudicate(a.roomId, match, player, 'win', matchClock + 4);
    poolNow = round.finishesAt;
    await pool.advance();
    await pool.advance();
    const { account: ticketOwner, ...repeatTicket } = tickets[0];
    assert.equal((await pool.bet(ticketOwner, repeatTicket)).replayed, true);
    assert.equal((await audit.prepare("SELECT count(*)::int AS n FROM audit_evidence WHERE dataset_id=? AND kind='attempt'")
      .get(testDataset.datasetId))?.n, 1);
    assert.equal((await audit.prepare("SELECT count(*)::int AS n FROM audit_evidence WHERE dataset_id=? AND kind='event'")
      .get(testDataset.datasetId))?.n, 3);

    const casinoCheck = await checkCapturedCasinoRound(audit, { datasetId: testDataset.datasetId, gameSchema: game.schema, posting: casinoAnchor });
    assert.equal(casinoCheck.status, 'found');
    assert.equal(casinoCheck.result.stake.status, 'match');
    assert.equal(casinoCheck.result.stake.expectedUnits, caribbeanInitialCost(settings.caribbean, '100'));
    assert.equal(casinoCheck.result.payout.status, 'match');
    assert.equal(casinoCheck.result.payout.observedUnits, session.returnedUnits);
    assert(casinoCheck.result.steps.filter(step => step.kind === 'free').length === moves.length &&
      casinoCheck.result.steps.filter(step => step.kind === 'free').every(step => step.status === 'match' && step.observedUnits === '0'));
    const pvpCheck = await reconcileStoredPvpMatch(audit, game, testDataset.datasetId, match);
    assert.equal(pvpCheck.status, 'match');
    assert.deepEqual(pvpCheck.totals, { stakeUnits: '2000', payoutUnits: '1900', refundUnits: '0', feeUnits: '100', remainderUnits: '0' });
    const poolCheck = await reconcileStoredTotePool(audit, game, testDataset.datasetId, round.id);
    assert.equal(poolCheck?.status, 'match');
    assert.equal(poolCheck.bankUnits, '400');
    const finalPool = await game.prepare("SELECT account_id,amount_units::text FROM demo_ledger WHERE operation_id=? AND entry_type='win'")
      .all('flag-tote:' + round.id + ':final');
    assert.equal(finalPool.length, 2);
    assert.equal(new Set(finalPool.map(item => item.account_id)).size, finalPool.length);
    assert.equal(finalPool.reduce((total, item) => total + BigInt(item.amount_units), 0n), 380n);
    assert.equal((await persistCapturedCasinoReplay(audit, {
      datasetId: testDataset.datasetId, gameSchema: game.schema, posting: casinoAnchor, replayId: randomUUID(),
    })).status, 'stored');
    assert.equal((await persistCapturedToteReplay(audit, {
      datasetId: testDataset.datasetId, gameSchema: game.schema, poolId: round.id, replayId: randomUUID(),
    })).status, 'stored');
    await credit(testPayment, '2000000');
    await credit(testPayment, '2000000');
    if (pendingPayment) assert.deepEqual(await testPaymentEvent(), pendingPayment);
    const testPaymentAnchor = await capturePayment(testPayment);
    assert.equal((await detail(testDataset.datasetId, testPaymentAnchor)).status, 'found');
    assert.equal((await detail(testDataset.datasetId, openingPaymentAnchor)).status, 'not-captured');

    const period = (fromMs: number) => ({ fromMs, toMs: Date.now() + 60_000 });
    const testExport = join(testExports, 'postings.csv');
    const reportInput = (datasetId: string, fromMs: number, destination: string) =>
      ({ schema: audit.schema, datasetId, filters: { accountId: player, ...period(fromMs) }, destination });
    assert.equal((await exportAuditPlayer(reader, reportInput(testDataset.datasetId, testDataset.startedAtMs, testExport))).rowCount, 8);
    const csvBefore = await readFile(testExport, 'utf8');
    for (const id of [testDataset.datasetId, roundId, match, tickets[0].id, testPayment]) assert(csvBefore.includes(id));
    assert(!csvBefore.includes(openingPayment));
    const testSummary = await readAuditSummary(reader, { schema: audit.schema, datasetId: testDataset.datasetId,
      filters: period(testDataset.startedAtMs) });
    assert.equal(testSummary.environment, 'test');
    assert.equal(testSummary.scanned, 11);
    const testDeposit = testSummary.rows.find(row => row.contour === 'real' && row.asset === 'USDT' && row.movement_type === 'deposit');
    assert.deepEqual([testDeposit?.posting_count, testDeposit?.amount_units, testDeposit?.reserved_delta_units], ['1', '2000000', '0']);
    const poolPayout = testSummary.rows.find(row => row.category === 'totalizator' && row.movement_type === 'payout');
    assert.deepEqual([poolPayout?.posting_count, poolPayout?.amount_units], ['2', '380']);
    assert.equal(testSummary.rows.find(row => row.category === 'totalizator' && row.movement_type === 'fee')?.fee_units, '20');
    await registerAuditExportFile(filesRoot, testDataset.datasetId, 'postings.csv');
    await datasets.sealTest(testDataset.datasetId);
    assert.deepEqual((await previewAuditCleanup(readOnlyAudit, cleanup)).blockers,
      ['open-financial-source:' + payments.schema + '.payment_outbox']);
    await outbox.flush();
    assert.deepEqual(await credits.snapshot(player), { balanceUnits: '3000000', reservedUnits: '0' });
    if (pendingPayment) {
      const [event] = await testPaymentEvent();
      assert.equal(event?.event_id, pendingPayment[0].event_id);
      assert(Number.isSafeInteger(event?.delivered_at));
      assert.deepEqual(await game.prepare('SELECT event_id FROM payment_credit_events WHERE user_id=? AND payment_id=?')
        .all(player, testPayment), [{ event_id: pendingPayment[0].event_id }]);
    }
    const manifest = await previewAuditCleanup(readOnlyAudit, cleanup);
    assert.deepEqual(manifest.blockers, []);
    assert.equal(manifest.files.files.length, 1);
    for (const [table, rows] of [['audit_posting_refs', 11], ['audit_evidence', 4], ['audit_attempt_capture_gaps', 1],
      ['audit_replay_packages', 2], ['audit_export_jobs', 4], ['audit_report_acl', 2]] as const) {
      assert.equal(manifest.rows.find(item => item.table === table)?.rows, rows);
    }
    const tableRows = (db: PostgresDatabase, tables: string[]) => tables.map(table => db.prepare(
      'SELECT to_jsonb(s) AS row FROM ' + identifier(table) + ' s ORDER BY to_jsonb(s)::text').all());
    const sourcesSnapshot = () => Promise.all([
      ...tableRows(game, ['demo_ledger', 'demo_wallets', 'demo_casino_requests', 'demo_casino_sessions', 'pvp_matches',
        'virtual_pvp_banks', 'virtual_pvp_holds', 'flag_tote_rounds', 'flag_tote_tickets', 'flag_tote_reservations',
        'payment_credit_wallets', 'payment_credit_events']),
      ...tableRows(payments, ['crypto_ledger', 'crypto_wallets', 'crypto_operations', 'crypto_wallet_holds', 'payment_outbox']),
    ]);
    const protectedRows = await sourcesSnapshot();
    const live = await applyAuditCleanup(audit, { ...cleanup, expectedSha256: manifest.sha256 });
    assert.equal(live.status, 'complete');
    assert.notEqual(live.liveDatasetId, testDataset.datasetId);
    assert.deepEqual(await checkpoint(live.liveDatasetId), { available_units: '3000000', reserved_units: '0' });
    assert.deepEqual(await sourcesSnapshot(), protectedRows);
    await assert.rejects(readFile(testExport), { code: 'ENOENT' });
    for (const item of manifest.rows) {
      assert.equal(await audit.prepare('SELECT 1 FROM ' + identifier(item.table) + ' WHERE dataset_id=? LIMIT 1')
        .get(testDataset.datasetId), undefined);
    }
    assert.equal((await applyAuditCleanup(audit, { ...cleanup, expectedSha256: manifest.sha256 })).liveDatasetId, live.liveDatasetId);

    assert.equal((await expand(moves.at(-1)!)).replayed, true);
    assert.equal((await bank.pvpFinish(player, { matchId: match, winnerId: player, reason: 'win' })).replayed, true);
    assert.equal((await pool.bet(ticketOwner, repeatTicket)).replayed, true);
    await credit(openingPayment, '1000000');
    await credit(testPayment, '2000000');
    assert.deepEqual(await sourcesSnapshot(), protectedRows);
    assert.equal(await audit.prepare('SELECT 1 FROM audit_posting_refs WHERE dataset_id=?').get(live.liveDatasetId), undefined);
    runtime = startAuditAttemptRuntime({ ...observerEnv, ROYAL_AUDIT_LIVE_DATASET_ID: live.liveDatasetId }, game.schema);
    assert(runtime?.recordToteAdmission);
    pool.setAdmissionObserver(runtime.recordToteAdmission);
    assert.equal((await pool.bet(ticketOwner, repeatTicket)).replayed, true);
    pool.setAdmissionObserver(undefined);
    assert.deepEqual(await sourcesSnapshot(), protectedRows);
    const newOperation = { id: randomUUID(), kind: 'play', gameId: 'royal-plinko', amount: 1,
      input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1 };
    const play = () => send<Awaited<ReturnType<typeof wallet.operate>>>(auditCommandRoutes.core, newOperation);
    const played = await play();
    assert.deepEqual(await play(), played);
    const liveClock = Date.now(), newMatch = await beginMatch(liveClock);
    await pvp.adjudicate(a.roomId, newMatch, player, 'win', liveClock + 3);
    await credit(livePayment, '3000000');
    await credit(livePayment, '3000000');
    await outbox.flush();
    const livePaymentAnchor = await capturePayment(livePayment);
    const finalPaymentBalance = await payments.prepare('SELECT balance_units::text,reserved_units::text FROM crypto_wallets WHERE account_id=?')
      .get(player);
    assert.deepEqual(finalPaymentBalance, { balance_units: '6000000', reserved_units: '0' });
    assert.deepEqual(await credits.snapshot(player), { balanceUnits: '6000000', reservedUnits: '0' });
    await stopObserver();
    const liveRefs = await audit.prepare(`SELECT source_namespace,operation_id FROM audit_posting_refs
      WHERE dataset_id=? ORDER BY source_namespace,source_row_id`).all(live.liveDatasetId);
    assert.equal(liveRefs.length, 6);
    assert.deepEqual(liveRefs.filter(row => row.source_namespace === namespace).map(row => row.operation_id), [newOperation.id, newOperation.id,
      'pvp:' + newMatch + ':hold', 'pvp:' + newMatch + ':hold', 'pvp:' + newMatch + ':final']);
    assert.deepEqual(liveRefs.filter(row => row.source_namespace === paymentNamespace).map(row => row.operation_id), [livePayment]);
    const liveAttempts = await audit.prepare("SELECT payload->'scope' AS scope,payload->>'operationId' AS operation_id FROM audit_evidence WHERE dataset_id=?")
      .all(live.liveDatasetId);
    assert.equal(liveAttempts.length, 2);
    assert(liveAttempts.every(row => row.scope.environment === 'live' && row.operation_id === newOperation.id));

    await grant(live.liveDatasetId);
    const liveExport = join(filesRoot, 'live.csv');
    assert.equal((await exportAuditPlayer(reader, reportInput(live.liveDatasetId, live.liveStartedAtMs, liveExport))).rowCount, 5);
    const liveCsv = await readFile(liveExport, 'utf8');
    for (const id of [newOperation.id, newMatch, livePayment]) assert(liveCsv.includes(id));
    for (const old of [testDataset.datasetId, roundId, match, round.id, openingPayment, testPayment, ...tickets.map(ticket => ticket.id)]) {
      assert(!liveCsv.includes(old));
    }
    const summary = await readAuditSummary(reader, { schema: audit.schema, datasetId: live.liveDatasetId, filters: period(live.liveStartedAtMs) });
    assert.equal(summary.environment, 'live');
    assert.equal(summary.scanned, 6);
    assert.deepEqual([...new Set(summary.rows.flatMap(row => row.category ? [row.category] : []))].sort(), ['casino', 'pvp']);
    assert.equal(summary.rows.find(row => row.category === 'pvp' && row.movement_type === 'fee')?.fee_units, '100');
    const liveDeposit = summary.rows.find(row => row.contour === 'real' && row.asset === 'USDT' && row.movement_type === 'deposit');
    assert.deepEqual([liveDeposit?.posting_count, liveDeposit?.amount_units, liveDeposit?.reserved_delta_units], ['1', '3000000', '0']);
    for (const anchor of [casinoAnchor, matchAnchor, ticketAnchor, openingPaymentAnchor, testPaymentAnchor]) {
      assert.equal((await detail(live.liveDatasetId, anchor)).status, 'not-captured');
    }
    assert.equal((await detail(live.liveDatasetId, await capture(newOperation.id))).status, 'found');
    assert.equal((await detail(live.liveDatasetId, livePaymentAnchor)).status, 'found');
    for (const anchor of [casinoAnchor, testPaymentAnchor]) {
      await assert.rejects(detail(testDataset.datasetId, anchor), { code: 'permission-denied' });
    }
    await verifyArchived?.();
    await verifyOriginal?.();
  });
