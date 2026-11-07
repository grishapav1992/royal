import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { identifier, type PostgresDatabase } from '../server/database';
import { auditExportReaderSlotKey } from '../server/audit/report-export-slot';

const run = promisify(execFile);
const pageBarrier = [19473, 22501] as const;
const fixtureDatabase = "current_database()='royal_test' AND host(inet_server_addr())='127.0.0.1'";

async function assertAuditLoadPrimary(audit: PostgresDatabase) {
  if (!audit.schema.startsWith('test_')) throw new Error('Expected a test audit schema');
  const isolated = await audit.prepare(`SELECT 1 WHERE ${fixtureDatabase} AND NOT pg_is_in_recovery()`).get();
  if (!isolated) throw new Error('Expected the isolated audit primary');
}

export async function grantAuditLoadStandbyReports(audit: PostgresDatabase, group: string) {
  await assertAuditLoadPrimary(audit);
  const schema = identifier(audit.schema);
  await audit.exec(`GRANT EXECUTE ON FUNCTION ${schema}.audit_report_begin_standby(uuid,text,jsonb),
    ${schema}.audit_report_authorize_standby_publish(uuid) TO ${identifier(group)}`);
}

/** Only a standby continuation waits, after it has read the actual page. */
export async function installAuditLoadStandbyPageBarrier(audit: PostgresDatabase, group: string) {
  await assertAuditLoadPrimary(audit);
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
    GRANT EXECUTE ON FUNCTION ${page}${signature} TO ${identifier(group)}`);
}

export async function lockAuditLoadStandbyPageBarrier(standby: pg.Client) {
  const { rowCount } = await standby.query(`SELECT pg_advisory_lock($1,$2)
    WHERE ${fixtureDatabase} AND pg_is_in_recovery()`, [...pageBarrier]);
  if (rowCount !== 1) throw new Error('Expected the isolated audit standby');
}

export async function unlockAuditLoadStandbyPageBarrier(standby: pg.Client) {
  const { rows: [row] } = await standby.query<{ unlocked: boolean }>(`SELECT pg_advisory_unlock($1,$2) AS unlocked
    WHERE ${fixtureDatabase} AND pg_is_in_recovery()`, [...pageBarrier]);
  if (!row?.unlocked) throw new Error('Expected the isolated audit standby page barrier to be held');
}

export async function findAuditLoadBlockedStandbyPage(standby: pg.Client, operator: string) {
  const { rows } = await standby.query<{ pid: number; backend_start: string }>(`
    SELECT a.pid,a.backend_start::text FROM pg_stat_activity a
    JOIN pg_locks l ON l.pid=a.pid AND l.database=a.datid
    WHERE ${fixtureDatabase} AND pg_is_in_recovery() AND a.datname=current_database()
      AND a.usename=$1 AND a.application_name='royal/audit-player' AND a.state='active'
      AND l.locktype='advisory' AND l.classid=$2::oid AND l.objid=$3::oid AND l.objsubid=2 AND NOT l.granted`,
  [operator, ...pageBarrier]);
  return rows[0];
}

/** Only the controller of the exact isolated pair has the credentials to release its reader slot. */
export async function drainAuditLoadStandbyReport(
  primary: Pick<pg.Client, 'query'>, standby: Pick<pg.Client, 'query'>, schema: string, jobId: string,
): Promise<boolean> {
  if (!schema.startsWith('test_')) throw new Error('Expected a test audit schema');
  const jobs = identifier(schema) + '.audit_export_jobs';
  const identity = `SELECT current_database() AS database, pg_is_in_recovery() AS recovery,
    host(inet_server_addr()) AS address, inet_server_port() AS port, system_identifier::text AS id
    FROM pg_control_system()`;
  const [primaryIdentity, standbyIdentity] = await Promise.all([primary.query(identity), standby.query(identity)]);
  const main = primaryIdentity.rows[0], replica = standbyIdentity.rows[0];
  if (main?.database !== 'royal_test' || replica?.database !== main.database ||
      main?.recovery !== false || replica?.recovery !== true || !main?.id || replica.id !== main.id ||
      main.address !== '127.0.0.1' || replica.address !== main.address || replica.port === main.port) {
    throw new Error('Expected a physical standby of the isolated audit primary');
  }
  const { rowCount: streaming } = await standby.query(`SELECT 1 FROM pg_stat_wal_receiver
    WHERE status='streaming' AND sender_host='127.0.0.1' AND sender_port=$1`, [main.port]);
  if (!streaming) return false;
  const terminal = `SELECT status, EXTRACT(EPOCH FROM finished_at)::text AS finished
    FROM ${jobs} WHERE id=$1 AND reader_route='standby' AND status<>'running' AND finished_at IS NOT NULL`;
  let expected = (await primary.query(terminal, [jobId])).rows[0];
  if (!expected) {
    // Commit lease expiry independently of a new admission, which must still be rejected until the reader drains.
    await primary.query(`UPDATE ${jobs} SET status='expired',finished_at=clock_timestamp(),reason='lease-expired'
      WHERE id=$1 AND reader_route='standby' AND status='running' AND expires_at<=clock_timestamp()`, [jobId]);
    expected = (await primary.query(terminal, [jobId])).rows[0];
  }
  if (!expected) return false;
  await standby.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
  try {
    const { rows: [slot] } = await standby.query(`SELECT
      pg_try_advisory_xact_lock(hashtextextended($1,0)) AS available`, [auditExportReaderSlotKey(schema)]);
    if (!slot?.available) return false;
    const { rows: [replayed] } = await standby.query(terminal, [jobId]);
    if (replayed?.status !== expected.status || replayed.finished !== expected.finished) return false;
  } finally {
    await standby.query('ROLLBACK');
  }
  // The replayed terminal job cannot pass the projection's fresh check after acquiring the lock.
  const { rowCount } = await primary.query(`UPDATE ${jobs} SET standby_drained_at=COALESCE(standby_drained_at,clock_timestamp())
    WHERE id=$1 AND reader_route='standby' AND status=$2 AND EXTRACT(EPOCH FROM finished_at)::text=$3`,
  [jobId, expected.status, expected.finished]);
  return rowCount === 1;
}

async function loopbackPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/** Clone only the benchmark-owned primary. No external database connection is accepted. */
export async function startAuditLoadStandby(pgBasebackup: string,
  primary: { PGPORT: string; PGDATABASE: string; PGUSER: string; PGPASSWORD: string }, signal?: AbortSignal,
  options?: { immediateRecoveryConflicts?: boolean }) {
  const port = await loopbackPort();
  const backup = resolve(pgBasebackup);
  if (!/^pg_basebackup(?:\.exe)?$/.test(basename(backup))) throw new Error('Expected a pg_basebackup executable');
  const pgCtl = join(dirname(backup), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LC_ALL: 'C',
    PGPASSWORD: primary.PGPASSWORD, PGSSLMODE: 'disable' };
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-standby-'));
  const dataDir = join(directory, 'standby');
  const control = (args: string[]) => run(pgCtl, ['-D', dataDir, ...args], { env, timeout: 15_000 });
  const stop = async () => {
    const running = await access(join(dataDir, 'postmaster.pid')).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
    if (running) await control(['stop', '-m', 'fast', '-w', '-t', '10']);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await run(backup, ['-D', dataDir, '-h', '127.0.0.1', '-p', primary.PGPORT, '-U', primary.PGUSER,
      '--checkpoint=fast', '--wal-method=stream', '--write-recovery-conf', '--no-password'],
    { env, timeout: 20_000, signal });
    signal?.throwIfAborted();
    const recoveryDelay = options?.immediateRecoveryConflicts ? ' -c max_standby_streaming_delay=0' : '';
    await control(['start', '-w', '-t', '10', '-l', join(directory, 'standby.log'),
      '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories= -c hot_standby_feedback=off${recoveryDelay}`]);
  } catch (error) {
    await stop();
    signal?.throwIfAborted();
    throw new Error('Failed to start the isolated audit load standby', { cause: error });
  }
  const connect = (databasePort = port) => new pg.Client({ host: '127.0.0.1', port: databasePort,
    database: primary.PGDATABASE, user: primary.PGUSER, password: primary.PGPASSWORD,
    ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
  return { port, connect, stop };
}
