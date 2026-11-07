import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import pg, { type Client } from 'pg';
import { drainAuditLoadStandbyReport, grantAuditLoadStandbyReports, startAuditLoadStandby } from '../scripts/audit-load-standby';
import { temporaryDatabase } from '../scripts/database-test';
import { AuditDatasets } from '../server/audit/datasets';
import { installAuditReportAccess } from '../server/audit/report-access';
import { AuditPlayerReportError, exportAuditPlayer } from '../server/audit/report-player';
import { installAuditPlayerReport } from '../server/audit/report-player-source';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { saveProviderPendingUnits } from '../server/providerPending';

const pgBasebackup = process.env.ROYAL_AUDIT_TEST_PG_BASEBACKUP;
const pageBarrier = [19473, 22501] as const;

async function installPageBarrier(audit: PostgresDatabase, reader: string) {
  const schema = identifier(audit.schema), page = schema + '.audit_report_player_page';
  const signature = '(uuid,bigint,text,bigint,bigint)';
  await audit.exec(`ALTER FUNCTION ${page}${signature} RENAME TO audit_fixture_player_page;
    CREATE FUNCTION ${page}(job uuid, cursor_at bigint, cursor_source text, cursor_id bigint, page_size bigint)
    RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp SET lock_timeout='0' AS $fixture$
    DECLARE result jsonb;
    BEGIN
      result := ${schema}.audit_fixture_player_page(job, cursor_at, cursor_source, cursor_id, page_size);
      IF pg_is_in_recovery() AND cursor_at IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(${pageBarrier[0]},${pageBarrier[1]});
      END IF;
      RETURN result;
    END
    $fixture$;
    REVOKE ALL ON FUNCTION ${page}${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${page}${signature} TO ${identifier(reader)}`);
}

async function waitFor<T>(probe: () => Promise<T | undefined>, message: string): Promise<T> {
  const deadline = performance.now() + 3000;
  do {
    const result = await probe();
    if (result !== undefined) return result;
    await pause(10);
  } while (performance.now() < deadline);
  assert.fail(message);
}

test('physical standby enforces WAL, routes and grants when exporting a player report',
  { skip: !pgBasebackup, timeout: 35_000 }, async t => {
    const cluster = await temporaryDatabase();
    const config = databaseConfig(cluster.env);
    const game = new PostgresDatabase('test_audit_standby_game', { config });
    const audit = new PostgresDatabase('test_audit_standby_boundary', { config });
    let directory: string | undefined;
    let standby: Awaited<ReturnType<typeof startAuditLoadStandby>> | undefined;
    const clients: Client[] = [];
    t.after(async () => {
      try {
        try { await Promise.all(clients.map(client => client.end())); } finally { await standby?.stop(); }
      } finally {
        try {
          await Promise.all([audit.close(), game.close(), directory && rm(directory, { recursive: true, force: true })]);
        } finally { await cluster.cleanup(); }
      }
    });

    directory = await mkdtemp(join(tmpdir(), 'royal-audit-standby-boundary-'));
    const accountId = randomUUID(), depositId = randomUUID(), pendingId = randomUUID();
    await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await game.prepare('INSERT INTO accounts VALUES (?)').run(accountId);
    const wallet = new DemoWalletStore(game, () => 0);
    await wallet.ready;
    const sources = { game: game.schema };
    const { datasetId, startedAtMs } = await new AuditDatasets(audit, sources).startTest();
    const reader = 'audit_boundary_reader', operator = 'audit_boundary_operator', password = randomUUID();
    await audit.exec(`CREATE ROLE ${identifier(reader)} NOLOGIN;
      CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
      GRANT ${identifier(reader)} TO ${identifier(operator)};
      ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB';
      ALTER ROLE ${identifier(operator)} SET track_functions='pl'`);
    await installAuditReportAccess(audit, reader);
    await grantAuditLoadStandbyReports(audit, reader);
    await installAuditPlayerReport(audit, reader, sources);
    await installPageBarrier(audit, reader);
    const demo = game.schema + '.demo_ledger', pending = game.schema + '.capro_pending_ledger';
    const grant = audit.prepare('INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)');
    await grant.run(operator, datasetId, demo);
    await grant.run(operator, datasetId, pending);
    await wallet.operate(accountId, { id: depositId, kind: 'deposit', amount: 10 });
    const pendingClock = t.mock.method(Date, 'now', () => startedAtMs);
    try {
      await saveProviderPendingUnits(game, accountId, pendingId, 350n, 350n, 'credit');
    } finally {
      pendingClock.mock.restore();
    }

    standby = await startAuditLoadStandby(pgBasebackup!, cluster.env, undefined, { immediateRecoveryConflicts: true });
    const standbyObserver = standby.connect();
    const primaryObserver = standby.connect(Number(cluster.env.PGPORT));
    clients.push(standbyObserver, primaryObserver);
    await Promise.all([standbyObserver.connect(), primaryObserver.connect()]);
    const login = databaseConfig({ ...cluster.env, PGUSER: operator, PGPASSWORD: password });
    const options = { schema: audit.schema, datasetId, fixtureStandbyPort: standby.port,
      filters: { accountId, fromMs: startedAtMs, toMs: Date.now() + 60_000 } };
    const application = 'royal/audit-player';
    const primaryPageCalls = async () => Number((await audit.prepare(`SELECT pg_stat_get_function_calls(
      ?::regprocedure) AS calls`).get(audit.schema + '.audit_report_player_page(uuid,bigint,text,bigint,bigint)'))?.calls ?? 0);
    const waitForWalReader = () => waitFor(async () => {
      const result = await standbyObserver.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
        WHERE usename=$1 AND application_name=$2 AND query LIKE '%pg_last_wal_replay_lsn%'`, [operator, application]);
      return result.rows[0]?.pid;
    }, 'Expected the named standby reader to wait for the journal WAL');
    const pauseReplay = async () => {
      await standbyObserver.query('SELECT pg_wal_replay_pause()');
      await waitFor(async () => (await standbyObserver.query('SELECT pg_get_wal_replay_pause_state() AS state'))
        .rows[0]?.state === 'paused' ? true : undefined, 'Expected physical standby WAL to be paused');
    };
    const resumeReplay = () => standbyObserver.query('SELECT pg_wal_replay_resume()');
    const drain = (jobId: string) => drainAuditLoadStandbyReport(primaryObserver, standbyObserver, audit.schema, jobId);
    const waitForDrain = (jobId: string) => waitFor(async () => await drain(jobId) ? true : undefined,
      'Expected replay of the terminal report and release of the standby reader slot');

    await pauseReplay();
    const beganAt = performance.now();
    const [outcome, waiting] = await Promise.allSettled([
      exportAuditPlayer(login, { ...options, destination: join(directory, 'timed-out.csv') }),
      waitForWalReader(),
    ]);
    assert(waiting.status === 'fulfilled');
    assert(outcome.status === 'rejected');
    assert(outcome.reason instanceof AuditPlayerReportError);
    assert.equal(outcome.reason.code, 'source-unavailable');
    assert(outcome.reason.jobId);
    assert(performance.now() - beganAt < 10_000);
    assert.deepEqual(await audit.prepare(`SELECT status,reason,row_count::text,byte_count::text
      FROM audit_export_jobs WHERE id=? AND operator_name=? AND dataset_id=?`).get(outcome.reason.jobId, operator, datasetId),
    { status: 'failed', reason: 'source-unavailable', row_count: '0', byte_count: '0' });
    await waitFor(async () => (await standbyObserver.query(`SELECT 1 FROM pg_stat_activity
      WHERE pid=$1 OR (usename=$2 AND application_name=$3)`, [waiting.value, operator, application]))
      .rowCount === 0 ? true : undefined, 'Timed out standby export left a report reader');
    assert.equal((await audit.prepare('SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename=? AND application_name=?')
      .get(operator, application))?.count, 0);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(await primaryPageCalls(), 0);
    assert.equal(await drain(outcome.reason.jobId), false);

    await resumeReplay();
    await waitForDrain(outcome.reason.jobId);
    const fullFile = join(directory, 'both-sources.csv');
    const full = await exportAuditPlayer(login, { ...options, destination: fullFile });
    assert.equal(full.rowCount, 2);
    await waitForDrain(full.jobId);
    const fullCsv = await readFile(fullFile, 'utf8');
    assert(fullCsv.includes(depositId) && fullCsv.includes(pendingId));

    await pauseReplay();
    await audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
      .run(operator, datasetId, pending);
    const standbyAcl = await standbyObserver.query(`SELECT 1 FROM ${identifier(audit.schema)}.audit_report_acl
      WHERE operator_name=$1 AND dataset_id=$2 AND source_namespace=$3`, [operator, datasetId, pending]);
    assert.equal(standbyAcl.rowCount, 1);
    const scopedFile = join(directory, 'one-source.csv');
    const [scoped, resumed] = await Promise.allSettled([
      exportAuditPlayer(login, { ...options, destination: scopedFile }),
      waitForWalReader().then(() => resumeReplay()),
    ]);
    assert.equal(resumed.status, 'fulfilled');
    if (scoped.status === 'rejected') throw scoped.reason;
    assert.equal(scoped.value.rowCount, 1);
    const scopedCsv = await readFile(scopedFile, 'utf8');
    assert(scopedCsv.includes(depositId));
    assert(!scopedCsv.includes(pendingId));
    assert.equal(await primaryPageCalls(), 0);
    await waitForDrain(scoped.value.jobId);

    // The same role and report can read from the primary, so fallback would have run the projection.
    assert.equal((await exportAuditPlayer(login, { ...options, fixtureStandbyPort: undefined,
      destination: join(directory, 'primary-control.csv') })).rowCount, 1);
    await waitFor(async () => await primaryPageCalls() > 0 ? true : undefined,
      'Expected primary function stats to observe the positive control');

    const outputDirectory = directory;
    const primaryReader = new pg.Client(login);
    clients.push(primaryReader);
    await primaryReader.connect();
    const schema = identifier(audit.schema);
    const beginPrimary = () => primaryReader.query<{ id: string }>(`
      SELECT ${schema}.audit_report_begin($1,'player',$2::jsonb) AS id`, [datasetId, JSON.stringify(options.filters)]);
    const waitForBlockedPage = () => waitFor(async () => {
      const { rows } = await standbyObserver.query<{ pid: number; backend_start: string }>(`
        SELECT a.pid,a.backend_start::text FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
        WHERE a.usename=$1 AND a.application_name=$2 AND a.state='active'
          AND l.locktype='advisory' AND l.classid=$3::oid AND l.objid=$4::oid AND l.objsubid=2 AND NOT l.granted`,
      [operator, application, ...pageBarrier]);
      return rows[0];
    }, 'Expected a live standby backend to reach the second player page');

    await t.test('WAL recovery aborts a blocked CSV without falling back or releasing the slot early', async () => {
      const filesBefore = (await readdir(outputDirectory)).sort();
      const primaryCallsBefore = await primaryPageCalls();
      const lockConflicts = async () => (await standbyObserver.query<{ count: number }>(`
        SELECT confl_lock::int AS count FROM pg_stat_database_conflicts WHERE datname=current_database()`)).rows[0].count;
      const conflictsBefore = await lockConflicts();
      await standbyObserver.query('SELECT pg_advisory_lock($1,$2)', [...pageBarrier]);
      const exportResult = exportAuditPlayer(login, { ...options, limits: { pageSize: 1 },
        destination: join(outputDirectory, 'recovery-conflict.csv') })
        .then(result => ({ result }), (error: unknown) => ({ error }));
      try {
        const backend = await waitForBlockedPage();
        const partial = (await readdir(outputDirectory)).find(file => file.endsWith('.part'));
        assert(partial);
        assert((await readFile(join(outputDirectory, partial), 'utf8')).includes(depositId));
        const postingRefs = schema + '.audit_posting_refs';
        assert.equal((await standbyObserver.query(`SELECT 1 FROM pg_locks
          WHERE pid=$1 AND relation=$2::regclass AND mode='AccessShareLock' AND granted`,
        [backend.pid, postingRefs])).rowCount, 1);

        // Keep the page barrier held while WAL applies the primary's exclusive lock.
        await primaryObserver.query(`BEGIN; LOCK TABLE ${postingRefs} IN ACCESS EXCLUSIVE MODE; COMMIT`);
        const result = await exportResult;
        assert('error' in result && result.error instanceof AuditPlayerReportError);
        assert.equal(result.error.code, 'source-unavailable');
        assert(result.error.jobId);
        const jobId = result.error.jobId;
        assert.deepEqual(await audit.prepare(`SELECT status,reason,row_count::text,byte_count::text,reader_route,standby_drained_at
          FROM audit_export_jobs WHERE id=?`).get(jobId),
        { status: 'failed', reason: 'source-unavailable', row_count: '0', byte_count: '0', reader_route: 'standby',
          standby_drained_at: null });
        assert.deepEqual((await readdir(outputDirectory)).sort(), filesBefore);
        await waitFor(async () => (await standbyObserver.query(`SELECT 1 FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz`, [backend.pid, backend.backend_start])).rowCount === 0
          ? true : undefined, 'Recovery conflict left its standby PostgreSQL backend active');
        await waitFor(async () => await lockConflicts() > conflictsBefore ? true : undefined,
          'Expected PostgreSQL to count a standby lock conflict');
        assert.equal(await lockConflicts(), conflictsBefore + 1);
        assert.equal(await primaryPageCalls(), primaryCallsBefore);
        await assert.rejects(beginPrimary(), { code: '55P03' });
        await waitForDrain(jobId);
        const next = await beginPrimary();
        await primaryReader.query(`SELECT ${schema}.audit_report_finish($1,'cancelled',0,0,'cancelled')`, [next.rows[0].id]);

        const retryFile = join(outputDirectory, 'after-recovery-conflict.csv');
        const retry = await exportAuditPlayer(login, { ...options, destination: retryFile });
        assert.equal(retry.rowCount, 1);
        assert((await readFile(retryFile, 'utf8')).includes(depositId));
        await waitForDrain(retry.jobId);
      } finally {
        await standbyObserver.query('SELECT pg_advisory_unlock_all()');
        await exportResult;
      }
    });

    await t.test('an active standby job cannot read on primary or publish after a source is revoked', async () => {
      await grant.run(operator, datasetId, pending);
      const filesBefore = (await readdir(outputDirectory)).sort();
      await standbyObserver.query('SELECT pg_advisory_lock($1,$2)', [...pageBarrier]);
      const exportResult = exportAuditPlayer(login, { ...options, limits: { pageSize: 1 },
        destination: join(outputDirectory, 'revoked-during-read.csv') })
        .then(result => ({ result }), (error: unknown) => ({ error }));
      try {
        const backend = await waitForBlockedPage();
        const partial = (await readdir(outputDirectory)).find(file => file.endsWith('.part'));
        assert(partial);
        assert((await readFile(join(outputDirectory, partial), 'utf8')).includes(pendingId));
        const job = await audit.prepare(`SELECT id::text,reader_route FROM audit_export_jobs
          WHERE operator_name=? AND dataset_id=? AND kind='player' AND status='running'`).get(operator, datasetId);
        assert(job);
        assert.equal(job.reader_route, 'standby');
        await assert.rejects(primaryReader.query(`SELECT ${schema}.audit_report_player_page($1,NULL,NULL,NULL,1)`, [job.id]),
          { code: '42501' });

        await pauseReplay();
        await audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
          .run(operator, datasetId, pending);
        assert.equal((await standbyObserver.query(`SELECT 1 FROM ${schema}.audit_report_acl
          WHERE operator_name=$1 AND dataset_id=$2 AND source_namespace=$3`, [operator, datasetId, pending])).rowCount, 1);
        await standbyObserver.query('SELECT pg_advisory_unlock_all()');
        const result = await exportResult;
        assert('error' in result && result.error instanceof AuditPlayerReportError);
        assert.equal(result.error.code, 'permission-denied');
        assert.equal(result.error.jobId, job.id);
        assert.deepEqual(await audit.prepare(`SELECT status,reason,row_count::text,byte_count::text,standby_drained_at
          FROM audit_export_jobs WHERE id=?`).get(job.id),
        { status: 'failed', reason: 'permission-denied', row_count: '0', byte_count: '0', standby_drained_at: null });
        assert.deepEqual((await readdir(outputDirectory)).sort(), filesBefore);
        await waitFor(async () => (await standbyObserver.query(`SELECT 1 FROM pg_stat_activity
          WHERE pid=$1 AND backend_start=$2::timestamptz`, [backend.pid, backend.backend_start])).rowCount === 0
          ? true : undefined, 'Revoked report left its standby PostgreSQL backend active');
        assert.equal(await drain(job.id), false);
        await assert.rejects(beginPrimary(), { code: '55P03' });
        await resumeReplay();
        await waitForDrain(job.id);
      } finally {
        await standbyObserver.query('SELECT pg_advisory_unlock_all()');
        await resumeReplay();
        await exportResult;
      }
    });

    await t.test('terminal WAL alone does not drain a still-open standby reader transaction', async () => {
      const standbyReader = new pg.Client({ ...login, port: options.fixtureStandbyPort });
      clients.push(standbyReader);
      await standbyReader.connect();
      const { rows: [{ id: jobId }] } = await primaryReader.query<{ id: string }>(`
        SELECT ${schema}.audit_report_begin_standby($1,'player',$2::jsonb) AS id`,
      [datasetId, JSON.stringify(options.filters)]);
      const waitForJobStatus = (id: string, status: string, route: string) => waitFor(async () => (await standbyObserver.query(`
        SELECT 1 FROM ${schema}.audit_export_jobs WHERE id=$1 AND status=$2 AND reader_route=$3`, [id, status, route])).rowCount === 1
        ? true : undefined, 'Expected the standby to replay the report status ' + status);
      const finishCancelled = (id: string) => primaryReader.query(`
        SELECT ${schema}.audit_report_finish($1,'cancelled',0,0,'cancelled')`, [id]);
      const readPage = (id: string) => standbyReader.query<{ page: { rows: { operation_id: string }[] } }>(`
        SELECT ${schema}.audit_report_player_page($1,NULL,NULL,NULL,2) AS page`, [id]);
      await waitForJobStatus(jobId, 'running', 'standby');
      await grant.run(operator, datasetId, pending);
      try {
        await waitFor(async () => (await standbyObserver.query(`
          SELECT 1 FROM ${schema}.audit_report_acl
          WHERE operator_name=$1 AND dataset_id=$2 AND source_namespace=$3`, [operator, datasetId, pending])).rowCount === 1
          ? true : undefined, 'Expected the standby to replay the new pending source grant');
        await standbyReader.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
        try {
          const page = await readPage(jobId);
          assert.deepEqual(page.rows[0].page.rows.map(row => row.operation_id), [depositId]);
          const { rows: [{ pid }] } = await standbyReader.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          assert.equal((await standbyObserver.query(`
            SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted`, [pid])).rowCount, 1);
          await finishCancelled(jobId);
          await waitForJobStatus(jobId, 'cancelled', 'standby');
          assert.equal(await drain(jobId), false);
          await assert.rejects(beginPrimary(), { code: '55P03' });
        } finally {
          await standbyReader.query('ROLLBACK');
        }
      } finally {
        await audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
          .run(operator, datasetId, pending);
      }
      await waitForDrain(jobId);
      const { rows: [{ id: primaryJobId }] } = await beginPrimary();
      try {
        await waitForJobStatus(primaryJobId, 'running', 'primary');
        await assert.rejects(readPage(primaryJobId), { code: '42501' });
      } finally {
        await finishCancelled(primaryJobId);
      }
    });

    await t.test('the controller recovers an expired standby lease without a journal finish', async () => {
      const { rows: [{ id: jobId }] } = await primaryReader.query<{ id: string }>(`
        SELECT ${schema}.audit_report_begin_standby($1,'player',$2::jsonb) AS id`,
      [datasetId, JSON.stringify(options.filters)]);
      await audit.prepare(`UPDATE audit_export_jobs SET started_at=clock_timestamp()-interval '6 minutes',
        expires_at=clock_timestamp()-interval '1 minute' WHERE id=?`).run(jobId);
      await assert.rejects(beginPrimary(), { code: '55P03' });
      assert.equal((await audit.prepare('SELECT status FROM audit_export_jobs WHERE id=?').get(jobId))?.status, 'running');
      await waitForDrain(jobId);
      assert.deepEqual(await audit.prepare(`SELECT status,reason,standby_drained_at IS NOT NULL AS drained
        FROM audit_export_jobs WHERE id=?`).get(jobId), { status: 'expired', reason: 'lease-expired', drained: true });
      const next = await beginPrimary();
      await primaryReader.query(`SELECT ${schema}.audit_report_finish($1,'cancelled',0,0,'cancelled')`, [next.rows[0].id]);
    });
  });
