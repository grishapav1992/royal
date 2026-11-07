import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import type { Client } from 'pg';
import { startAuditLoadStandby } from '../scripts/audit-load-standby';
import { temporaryDatabase } from '../scripts/database-test';
import { AuditDatasets } from '../server/audit/datasets';
import { installAuditReportAccess } from '../server/audit/report-access';
import { AuditPlayerReportError, exportAuditPlayer } from '../server/audit/report-player';
import { installAuditPlayerReport } from '../server/audit/report-player-source';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { saveProviderPendingUnits } from '../server/providerPending';

const pgBasebackup = process.env.ROYAL_AUDIT_TEST_PG_BASEBACKUP;

async function waitFor<T>(probe: () => Promise<T | undefined>, message: string): Promise<T> {
  const deadline = performance.now() + 3000;
  do {
    const result = await probe();
    if (result !== undefined) return result;
    await pause(10);
  } while (performance.now() < deadline);
  assert.fail(message);
}

test('physical standby export times out without fallback and honors a grant revoked before admission',
  { skip: !pgBasebackup, timeout: 35_000 }, async t => {
    const cluster = await temporaryDatabase();
    const config = databaseConfig(cluster.env);
    const game = new PostgresDatabase('test_audit_standby_game', { config });
    const audit = new PostgresDatabase('test_audit_standby_boundary', { config });
    let directory: string | undefined;
    let standby: Awaited<ReturnType<typeof startAuditLoadStandby>> | undefined;
    let observer: Client | undefined;
    t.after(async () => {
      try {
        try { await observer?.end(); } finally { await standby?.stop(); }
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
    await installAuditPlayerReport(audit, reader, sources);
    const demo = game.schema + '.demo_ledger', pending = game.schema + '.capro_pending_ledger';
    const grant = audit.prepare('INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)');
    await grant.run(operator, datasetId, demo);
    await grant.run(operator, datasetId, pending);
    await wallet.operate(accountId, { id: depositId, kind: 'deposit', amount: 10 });
    await saveProviderPendingUnits(game, accountId, pendingId, 350n, 350n, 'credit');

    standby = await startAuditLoadStandby(pgBasebackup!, cluster.env);
    const standbyObserver = standby.connect();
    observer = standbyObserver;
    await observer.connect();
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

    await resumeReplay();
    const fullFile = join(directory, 'both-sources.csv');
    assert.equal((await exportAuditPlayer(login, { ...options, destination: fullFile })).rowCount, 2);
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

    // The same role and report can read from the primary, so fallback would have run the projection.
    assert.equal((await exportAuditPlayer(login, { ...options, fixtureStandbyPort: undefined,
      destination: join(directory, 'primary-control.csv') })).rowCount, 1);
    await waitFor(async () => await primaryPageCalls() > 0 ? true : undefined,
      'Expected primary function stats to observe the positive control');
  });
