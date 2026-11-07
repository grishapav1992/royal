import pg, { type ClientConfig, type QueryResult } from 'pg';
import { setTimeout as pause } from 'node:timers/promises';
import { identifier } from '../database';
import { AuditCsvExportError, writeAuditCsv } from './export-csv';
import { playerColumns, type PlayerReportCursor, type PlayerReportPage, type PlayerReportRow } from './report-player-source';

export type PlayerReportFilters = {
  accountId: string;
  fromMs: number;
  toMs: number;
  category?: 'casino' | 'pvp' | 'totalizator';
  gameId?: string;
  modeId?: string;
  asset?: string;
  contour?: 'virtual' | 'test' | 'real';
};
export type AuditReportFilters = Omit<PlayerReportFilters, 'accountId'> & { accountId?: string };
export type AuditPostingReportFilters = { source: string; postingId: string; refresh?: boolean };
export type AuditReconcilePeriodFilters = { source: string; fromMs: number; toMs: number; accountId?: string; refresh?: boolean };
export type AuditDetailLookupFilters = { source: string; lookupKind: 'operation' | 'round' | 'match' | 'ticket';
  lookupId: string; accountId?: string };
export type AuditReportKind = 'player' | 'summary' | 'detail' | 'replay' | 'reconcile';

type Limits = { maxRows: number; maxBytes: number; maxScanned: number; timeoutMs: number; pageSize: number };
const defaults: Limits = { maxRows: 10_000, maxBytes: 16 * 1024 * 1024, maxScanned: 20_000, timeoutMs: 60_000, pageSize: 128 };
const maxTempBytes = 64 * 1024 * 1024;
const units = new Set<keyof PlayerReportRow>(['schema_version', 'posting_id', 'scale', 'amount_units', 'reserved_delta_units',
  'expected_balance_units', 'stored_balance_units', 'pending_delta_units', 'stored_pending_units']);
type ReaderConfig = ClientConfig & { fixtureReplayLsn?: string };
type Failure = 'cancelled' | 'time-limit' | 'row-limit' | 'scan-limit' | 'byte-limit' | 'source-unavailable' | 'output-error' |
  'internal-error' | 'permission-denied' | 'replay-absent' | 'replay-corrupt' | 'replay-incomplete' | 'replay-unsupported';

export class AuditPlayerReportError extends Error {
  constructor(readonly code: Failure | 'journal-unavailable' | 'report-busy', readonly jobId: string | null) { super(code); }
}

function reportLimits(overrides: Partial<Limits> | undefined): Limits {
  const limits = { ...defaults, ...overrides };
  for (const key of Object.keys(defaults) as (keyof Limits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > defaults[key]) throw new Error('Invalid audit export limit');
  }
  return limits;
}

function failureCode(error: unknown, signal: AbortSignal, timeout: AbortSignal): Failure {
  if (signal.aborted) return timeout.aborted ? 'time-limit' : 'cancelled';
  if (error instanceof AuditPlayerReportError && error.code !== 'journal-unavailable' && error.code !== 'report-busy') return error.code;
  if (error instanceof AuditCsvExportError) {
    switch (error.code) {
      case 'cancelled': return 'cancelled';
      case 'timeout': return 'time-limit';
      case 'row-limit': return 'row-limit';
      case 'byte-limit': return 'byte-limit';
      default: return 'output-error';
    }
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === '42501') return 'permission-denied';
  if (code === '57014') return 'time-limit';
  if (code === '54000') return 'scan-limit';
  if (code && (code.startsWith('08') || ['42P01','3F000','ECONNREFUSED','ECONNRESET'].includes(code))) return 'source-unavailable';
  if (code && ['EEXIST','ENOENT','EACCES','EPERM','ENOSPC','EDQUOT','EROFS','EXDEV','ENOTDIR'].includes(code)) return 'output-error';
  return 'internal-error';
}

export async function openAuditReportReader({ fixtureReplayLsn, ...config }: ReaderConfig, jobId: string, signal: AbortSignal, readOnly = true) {
  const connection = new pg.Client(config);
  connection.on('error', () => { /* Active query errors are handled by the export. */ });
  let end: Promise<void> | undefined;
  const close = () => { end ??= connection.end().catch(() => {}); };
  const finish = async () => {
    signal.removeEventListener('abort', close);
    close();
    await end;
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    await connection.connect();
    if (fixtureReplayLsn) {
      if (!readOnly) throw new AuditPlayerReportError('source-unavailable', jobId);
      const deadline = performance.now() + 2000;
      for (;;) {
        signal.throwIfAborted();
        const { rows } = await connection.query(`SELECT pg_is_in_recovery() AS standby,
          pg_last_wal_replay_lsn() >= $1::pg_lsn AS replayed`, [fixtureReplayLsn]);
        if (!rows[0]?.standby) throw new AuditPlayerReportError('source-unavailable', jobId);
        if (rows[0].replayed) break;
        if (performance.now() >= deadline) throw new AuditPlayerReportError('source-unavailable', jobId);
        await pause(5, undefined, { signal });
      }
    }
    await connection.query(readOnly ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED');
    const settings = await connection.query("SELECT pg_size_bytes(current_setting('temp_file_limit'))::text AS bytes");
    const bytes = Number(settings.rows[0]?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxTempBytes) {
      throw new AuditPlayerReportError('source-unavailable', jobId);
    }
    return { connection, finish };
  } catch (error) {
    await finish();
    throw error;
  }
}

async function* pages(config: ReaderConfig, fn: string, jobId: string, limits: Limits, signal: AbortSignal): AsyncGenerator<PlayerReportRow> {
  const { connection, finish } = await openAuditReportReader(config, jobId, signal);
  let cursor: PlayerReportCursor | null = null, scanned = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const result: QueryResult<{ page: PlayerReportPage }> = await connection.query<{ page: PlayerReportPage }>(
        'SELECT ' + fn + '($1,$2,$3,$4,$5) AS page',
        [jobId, cursor?.at ?? null, cursor?.source ?? null, cursor?.id ?? null, limits.pageSize]);
      const page: PlayerReportPage | undefined = result.rows[0]?.page;
      if (!page || !Array.isArray(page.rows) || !Number.isSafeInteger(page.scanned) || page.scanned < page.rows.length ||
          page.scanned > limits.pageSize || (page.scanned > 0) !== (page.cursor !== null) ||
          page.cursor && cursor && page.cursor.at === cursor.at && page.cursor.source === cursor.source && page.cursor.id === cursor.id) {
        throw new AuditPlayerReportError('internal-error', jobId);
      }
      scanned += page.scanned;
      if (scanned > limits.maxScanned) throw new AuditPlayerReportError('scan-limit', jobId);
      for (const row of page.rows) yield row;
      if (page.scanned < limits.pageSize) break;
      cursor = page.cursor;
    }
    await connection.query('COMMIT');
  } finally {
    await finish();
  }
}

/** Both journal and query connections use the named PostgreSQL report login. */
export async function runAuditReport<T extends { rowCount: number; bytes: number }>(
  config: ClientConfig, input: { schema: string; datasetId: string;
    filters: AuditReportFilters | AuditPostingReportFilters | AuditReconcilePeriodFilters | AuditDetailLookupFilters | { replayId: string };
    signal?: AbortSignal; fixtureStandbyPort?: number }, kind: AuditReportKind, timeoutMs: number,
  run: (settings: ReaderConfig, schema: string, jobId: string, signal: AbortSignal) => Promise<T>,
) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(input.schema)) throw new Error('Invalid audit schema name');
  const { fixtureStandbyPort } = input;
  if (fixtureStandbyPort !== undefined && (config.host !== '127.0.0.1' || config.connectionString ||
      !Number.isInteger(fixtureStandbyPort) || fixtureStandbyPort < 1 || fixtureStandbyPort > 65_535 ||
      fixtureStandbyPort === config.port || (kind !== 'player' && kind !== 'summary'))) {
    throw new Error('Expected a separate loopback report fixture');
  }
  const schema = identifier(input.schema);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const settings = { ...config, connectionTimeoutMillis: 5000, statement_timeout: 5000, lock_timeout: 1000,
    idle_in_transaction_session_timeout: 15_000, application_name: 'royal/audit-' + kind };
  const log = new pg.Client(settings);
  log.on('error', () => { /* Journal errors are handled by their own queries. */ });
  let jobId: string | null = null;
  let reportCompleted = false;
  const finish = async (outcome: string, count: number, bytes: number, reason: Failure | null) => {
    await log.query('SELECT ' + schema + '.audit_report_finish($1,$2,$3,$4,$5)', [jobId, outcome, count, bytes, reason]);
  };
  try {
    signal.throwIfAborted();
    await log.connect();
    const role = await log.query(`SELECT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls) AS privileged
      FROM pg_catalog.pg_roles WHERE rolname=session_user`);
    if (role.rows[0]?.privileged !== false) throw new AuditPlayerReportError('permission-denied', null);
    const started = await log.query('SELECT ' + schema + '.audit_report_begin($1,$2,$3) AS id',
      [input.datasetId, kind, JSON.stringify(input.filters)]);
    const id: unknown = started.rows[0]?.id;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new AuditPlayerReportError('internal-error', null);
    jobId = id;
    let reader: ReaderConfig = settings;
    if (fixtureStandbyPort !== undefined) {
      // With synchronous commit on the fixture, the journal's completed INSERT has reached the flushed WAL.
      const { rows } = await log.query('SELECT pg_current_wal_flush_lsn()::text AS lsn');
      const lsn: unknown = rows[0]?.lsn;
      if (typeof lsn !== 'string' || !/^[0-9A-F]+\/[0-9A-F]+$/.test(lsn)) {
        throw new AuditPlayerReportError('source-unavailable', jobId);
      }
      reader = { ...settings, port: fixtureStandbyPort, fixtureReplayLsn: lsn };
    }
    const written = await run(reader, schema, jobId, signal);
    reportCompleted = true;
    await finish('succeeded', written.rowCount, written.bytes, null);
    return { jobId, ...written };
  } catch (error) {
    if (!jobId && !signal.aborted && (error as { code?: string } | null)?.code === '55P03') {
      throw new AuditPlayerReportError('report-busy', null);
    }
    const code = failureCode(error, signal, timeout);
    if (jobId) {
      if (reportCompleted) throw new AuditPlayerReportError('journal-unavailable', jobId);
      try { await finish(code === 'cancelled' ? 'cancelled' : 'failed', 0, 0, code); }
      catch { throw new AuditPlayerReportError('journal-unavailable', jobId); }
    }
    throw new AuditPlayerReportError(code, jobId);
  } finally {
    await log.end().catch(() => {});
  }
}

export async function exportAuditPlayer(
  config: ClientConfig, input: { schema: string; datasetId: string; filters: PlayerReportFilters; destination: string;
    signal?: AbortSignal; limits?: Partial<Limits>; fixtureStandbyPort?: number },
) {
  const limits = reportLimits(input.limits);
  return runAuditReport(config, input, 'player', limits.timeoutMs, (settings, schema, jobId, signal) =>
    writeAuditCsv<PlayerReportRow>({
      destination: input.destination,
      columns: playerColumns.map(header => ({ header, kind: units.has(header) ? 'units' : 'text', value: row => row[header] })),
      rows: pages(settings, schema + '.audit_report_player_page', jobId, limits, signal),
      maxRows: limits.maxRows, maxBytes: limits.maxBytes, timeoutMs: limits.timeoutMs, signal,
    }));
}
