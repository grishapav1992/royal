import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { Agent, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import express from 'express';
import { startAuditAttemptRuntime } from '../server/audit/attempts';
import { AuditDatasets } from '../server/audit/datasets';
import { auditHttpAttempts } from '../server/audit/http-attempts';
import { auditCommandRoutes } from '../server/audit/intents';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditPlayerReport, playerColumns } from '../server/audit/report-player-source';
import { AuditPlayerReportError, exportAuditPlayer } from '../server/audit/report-player';
import { AUDIT_SUMMARY_SCAN_CAP, installAuditSummaryReport } from '../server/audit/report-summary-source';
import { readAuditSummary } from '../server/audit/report-summary';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { verifyGameRound } from '../server/games/core';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { temporaryDatabase } from './database-test';

type Budget = { stakeP95Ms?: number; settlementP95Ms?: number; readerStopMs?: number };
type LoadOptions = { workers: number; roundsPerWorker: number; seedRounds: number; scaleHistory?: boolean; budget?: Budget };
type Metric = 'stake' | 'settlement' | 'casinoRound' | 'retry';
type Sample = { from: number; to: number; ok: boolean };
type Leg = [account: string, operation: string, entry: string, units: string];
type Pair = [string, string];
type Capture = ReturnType<typeof startAuditAttemptRuntime>;
type PlayerInput = Parameters<typeof exportAuditPlayer>[1];
type ReportLogin = Parameters<typeof exportAuditPlayer>[0];
const initialCents = 10000n;
const scalePlayerRows = 10_000;
const reportTempFileLimit = '32MB';
const defaults: LoadOptions = { workers: 4, roundsPerWorker: 8, seedRounds: 40 };

function loadOptions(input: LoadOptions) {
  const { workers, roundsPerWorker, seedRounds, scaleHistory, budget } = input;
  if (!Number.isInteger(workers) || workers < 1 || workers > 8 || !Number.isInteger(roundsPerWorker) ||
      roundsPerWorker < 2 || roundsPerWorker > 16 || !Number.isInteger(seedRounds) || seedRounds < 8 || seedRounds > 40) {
    throw new Error('Invalid isolated audit load options');
  }
  if (budget && Object.values(budget).some(value => !Number.isFinite(value) || value <= 0 || value > 60_000)) {
    throw new Error('Invalid isolated audit load budget');
  }
  return { workers, roundsPerWorker, seedRounds, scaleHistory, budget };
}

const rounded = (value: number) => Number(value.toFixed(3));
function stats(samples: Sample[]) {
  const success = samples.filter(item => item.ok).map(item => item.to - item.from).sort((a, b) => a - b);
  return { attempts: samples.length, completed: success.length, errors: samples.length - success.length,
    p95Ms: success.length ? rounded(success[Math.ceil(success.length * 0.95) - 1]) : null };
}

function playRequest() {
  return { id: randomUUID(), kind: 'play', gameId: 'royal-plinko', amount: 1,
    input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1 };
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const found = await probe();
    if (found !== undefined) return found;
    if (performance.now() >= deadline) throw new Error('Isolated audit load observation deadline');
    await pause(2, undefined, { signal });
  }
}

async function workload(game: PostgresDatabase, wallet: VirtualPvpLedger, baseUrl: string, agent: Agent, pairs: Pair[],
  rounds: number, signal?: AbortSignal) {
  const samples: Record<Metric, Sample[]> = { stake: [], settlement: [], casinoRound: [], retry: [] };
  const expected: Leg[] = [], matchIds: string[] = [];
  let expectedFees = 0, completedRounds = 0;
  const timed = async <T>(kind: Metric, work: () => Promise<T>) => {
    signal?.throwIfAborted();
    const from = performance.now();
    let ok = false;
    try { const result = await work(); ok = true; return result; }
    finally { samples[kind].push({ from, to: performance.now(), ok }); }
  };
  const plinko = async (accountId: string, op: ReturnType<typeof playRequest>) => {
    const body = JSON.stringify(op);
    const response = await new Promise<string>((complete, reject) => {
      const call = request(baseUrl + auditCommandRoutes.core, { agent, method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-fixture-account': accountId } },
      reply => {
        reply.on('error', reject);
        if (reply.statusCode !== 200) {
          reply.resume();
          reject(new Error('Fixture casino operation failed'));
          return;
        }
        reply.setEncoding('utf8');
        let content = '';
        reply.on('data', (part: string) => {
          content += part;
          if (content.length > 1_048_576) reply.destroy(new Error('Fixture response exceeds bound'));
        });
        reply.on('end', () => complete(content));
      });
      call.on('error', reject);
      call.end(body);
    });
    const { gameRound } = JSON.parse(response) as { gameRound?: unknown };
    if (!verifyGameRound(gameRound) || gameRound.stakeUnits !== '100') throw new Error('Fixture casino result is invalid');
    return gameRound;
  };
  const started = performance.now();
  await Promise.all(pairs.map(async ([a, b]) => {
    try {
      for (let round = 0; round < rounds; round++) {
        const matchId = randomUUID();
        matchIds.push(matchId);
        const terms = { matchId, gameId: 'chess', stakeUnits: '1000000' };
        for (const account of [a, b]) {
          await timed('stake', () => wallet.pvpHold(account, terms));
          expected.push([account, 'pvp:' + matchId + ':hold', 'bet', '-100']);
        }
        await timed('retry', async () => {
          if (!(await wallet.pvpHold(a, terms)).replayed) throw new Error('Fixture hold replay was not recognized');
        });
        const winnerId = round % 2 ? a : null;
        const settlement = { matchId, winnerId, reason: winnerId ? 'win' : 'draw' };
        await timed('settlement', () => wallet.pvpFinish(a, settlement));
        if (winnerId) {
          expected.push([winnerId, 'pvp:' + matchId + ':final', 'win', '190']);
          expectedFees += 10;
        } else for (const account of [a, b]) expected.push([account, 'pvp:' + matchId + ':final', 'refund', '100']);
        await timed('retry', async () => {
          if (!(await wallet.pvpFinish(a, settlement)).replayed) throw new Error('Fixture settlement replay was not recognized');
        });
        const command = playRequest();
        const outcome = await timed('casinoRound', () => plinko(a, command));
        expected.push([a, command.id, 'bet', '-100'], [a, command.id, 'win', outcome.payoutUnits]);
        await timed('retry', async () => {
          const repeated = await plinko(a, command);
          if (JSON.stringify(repeated) !== JSON.stringify(outcome)) throw new Error('Fixture casino replay differs');
        });
        completedRounds++;
      }
    } catch {
      // The failed step is counted by timed(). Stop that pair instead of inventing later settlements.
    }
  }));
  const elapsedMs = rounded(performance.now() - started);
  signal?.throwIfAborted();
  const accounts = pairs.flat();
  const actual = await game.prepare(`SELECT account_id,operation_id,entry_type,amount_units::text FROM demo_ledger
    WHERE account_id=ANY(?::text[]) AND entry_type<>'deposit'`).all(accounts);
  const expectedKeys = expected.map(row => JSON.stringify(row)).sort();
  const actualKeys = actual.map(row => JSON.stringify([row.account_id, row.operation_id, row.entry_type, row.amount_units])).sort();
  const balances = await game.prepare(`SELECT account_id,(balance*100+fraction_units)::text AS units
    FROM demo_wallets WHERE account_id=ANY(?::text[])`).all(accounts);
  const bank = await game.prepare(`SELECT count(*)::int AS n,COALESCE(sum(fee_units),0)::text AS fee,
    count(*) FILTER (WHERE state='open')::int AS open FROM virtual_pvp_banks WHERE match_id=ANY(?::text[])`).get(matchIds);
  const noDoubleMoney = completedRounds === pairs.length * rounds &&
    JSON.stringify(expectedKeys) === JSON.stringify(actualKeys) && balances.length === accounts.length &&
    balances.every(row => initialCents + expected.filter(leg => leg[0] === row.account_id)
      .reduce((sum, leg) => sum + BigInt(leg[3]), 0n) === BigInt(row.units)) &&
    bank?.n === completedRounds && bank.fee === String(expectedFees) && bank.open === 0;
  const metrics = { stake: stats(samples.stake), settlement: stats(samples.settlement),
    casinoRound: stats(samples.casinoRound), retry: stats(samples.retry) };
  return { samples, metrics, elapsedMs, completedRounds, expectedPostings: expected.length, actualPostings: actual.length, noDoubleMoney };
}

/** Fixture-only bulk history. Capture comes from the normal source trigger, not a seeded reference table. */
async function seedScaleHistory(game: PostgresDatabase, player: string, other: string, fromMs: number) {
  const inserts = [
    { account: player, rows: scalePlayerRows, firstBucketRows: scalePlayerRows },
    { account: other, rows: AUDIT_SUMMARY_SCAN_CAP + 1 - scalePlayerRows,
      firstBucketRows: AUDIT_SUMMARY_SCAN_CAP - scalePlayerRows },
  ];
  await game.transaction(async () => {
    for (const { account, rows, firstBucketRows } of inserts) {
      await game.prepare(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,
        amount_units,balance_units,entry_type,source)
        SELECT ?,gen_random_uuid()::text,'deposit',1,?::integer+n,
          ?::bigint+CASE WHEN n<=?::integer THEN 0 ELSE 1 END,100,(?::bigint+n)*100,'deposit','royal-coins'
        FROM generate_series(1,?::integer) n ORDER BY n`)
        .run(account, Number(initialCents / 100n), fromMs, firstBucketRows, Number(initialCents / 100n), rows);
      await game.prepare('UPDATE demo_wallets SET balance=balance+? WHERE account_id=?').run(rows, account);
    }
  });
  return { fromMs, toMs: fromMs + 2 };
}

async function verifyScaleCsv(path: string, accountId: string) {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const header = playerColumns.map(column => JSON.stringify(column)).join(',');
  const account = playerColumns.indexOf('account_id'), id = playerColumns.indexOf('posting_id');
  const expected = playerColumns.indexOf('expected_balance_units'), stored = playerColumns.indexOf('stored_balance_units');
  const amount = playerColumns.indexOf('amount_units'), movement = playerColumns.indexOf('movement_type');
  let rowCount = -1, previousId = 0n;
  try {
    for await (const line of lines) {
      rowCount++;
      if (rowCount === 0) { if (line !== header) return false; continue; }
      // All seeded text cells use fixed labels and UUIDs, with no embedded CSV separators.
      const cells = line.split(','), balance = String(initialCents + BigInt(rowCount) * 100n);
      if (cells.length !== playerColumns.length || cells[account] !== JSON.stringify(accountId) ||
        cells[amount] !== '100' || cells[movement] !== '"deposit"' || cells[expected] !== balance ||
        cells[stored] !== balance || !/^[1-9][0-9]*$/.test(cells[id]) || BigInt(cells[id]) <= previousId) return false;
      previousId = BigInt(cells[id]);
    }
    return rowCount === scalePlayerRows;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function rejectOversizedSummary(audit: PostgresDatabase, operator: ReportLogin, input: Parameters<typeof readAuditSummary>[1],
  operatorName: string) {
  try {
    await readAuditSummary(operator, input);
    return { outcome: 'unexpected-success', journalRejected: false };
  } catch (error) {
    input.signal?.throwIfAborted();
    if (!(error instanceof AuditPlayerReportError) || !error.jobId) throw error;
    const journal = await audit.prepare(`SELECT operator_name,status,reason,row_count,byte_count FROM audit_export_jobs
      WHERE id=? AND dataset_id=?`).get(error.jobId, input.datasetId);
    return { outcome: error.code, journalRejected: error.code === 'scan-limit' && journal?.operator_name === operatorName &&
      journal.status === 'failed' && journal.reason === 'scan-limit' && journal.row_count === 0 && journal.byte_count === 0 };
  }
}

function assessBudget(budget: Budget | undefined, observed: Record<keyof Budget, number | null>) {
  if (!budget) return null;
  const keys = Object.keys(budget) as (keyof Budget)[];
  const checks = keys.map(metric => {
    const actual = observed[metric], limit = budget[metric]!;
    return { metric, actual, limit, passed: actual !== null && actual <= limit };
  });
  return { checks, ok: checks.every(check => check.passed) };
}

async function sizes(audit: PostgresDatabase, game: PostgresDatabase) {
  const row = (await audit.prepare(`SELECT pg_database_size(current_database())::text AS database_bytes,
    pg_total_relation_size(?::regclass)::text AS ledger_bytes,
    (SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0)::text FROM pg_class c JOIN pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname=? AND c.relkind='r') AS audit_bytes`)
    .get(game.schema + '.demo_ledger', audit.schema))!;
  return { databaseBytes: Number(row.database_bytes), gameLedgerBytes: Number(row.ledger_bytes), auditRelationsBytes: Number(row.audit_bytes) };
}

async function recordSizes(audit: PostgresDatabase, datasetId: string) {
  const measure = async (relation: 'audit_posting_refs' | 'audit_evidence', column: 'r' | 'payload') => {
    const row = (await audit.prepare(`SELECT count(*)::int AS n,COALESCE(sum(pg_column_size(${column})),0)::text AS bytes,
      COALESCE(max(pg_column_size(${column})),0)::int AS maximum FROM ${relation} r WHERE dataset_id=?`).get(datasetId))!;
    return { rows: row.n as number, bytes: Number(row.bytes), averageBytes: row.n ? rounded(Number(row.bytes) / row.n) : 0,
      maxBytes: row.maximum as number };
  };
  return { postingRefs: await measure('audit_posting_refs', 'r'), attemptPayloads: await measure('audit_evidence', 'payload') };
}

async function cancelReport(game: PostgresDatabase, audit: PostgresDatabase, operator: ReportLogin, input: PlayerInput,
  directory: string, abort?: AbortSignal) {
  const locker = await game.pool.connect(), controller = new AbortController();
  const signal = abort ? AbortSignal.any([abort, controller.signal]) : controller.signal;
  let pending: Promise<{ jobId: string | null; code: string }> | undefined;
  try {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE ' + identifier(game.schema) + '.demo_ledger IN ACCESS EXCLUSIVE MODE');
    pending = exportAuditPlayer(operator, { ...input, signal }).then(() => ({ code: 'unexpected-success', jobId: null }),
      error => ({ code: error instanceof AuditPlayerReportError ? error.code : 'unexpected-error',
        jobId: error instanceof AuditPlayerReportError ? error.jobId : null }));
    const backend = await waitFor(async () => {
      const row = await audit.prepare(`SELECT pid FROM pg_stat_activity
        WHERE application_name='royal/audit-player' AND wait_event_type='Lock'
          AND query LIKE '%audit_report_player_page%'`).get();
      const part = (await readdir(directory)).some(file => file.endsWith('.part'));
      return row && part ? row.pid as number : undefined;
    }, 2000, signal);
    const started = performance.now();
    controller.abort();
    const result = await pending;
    const cancellationMs = rounded(performance.now() - started);
    // The connection can only complete the blocked query after lock timeout while this lock is held.
    await waitFor(async () => await audit.prepare('SELECT 1 FROM pg_stat_activity WHERE pid=?').get(backend)
      ? undefined : true, 3000, abort);
    const databaseReaderStopMs = rounded(performance.now() - started);
    const journal = result.jobId ? await audit.prepare('SELECT status,reason FROM audit_export_jobs WHERE id=?').get(result.jobId) : null;
    const files = await readdir(directory);
    return { blockedQueryObserved: true, readerStopped: true, cancellationMs, databaseReaderStopMs, outcome: result.code,
      journalCancelled: journal?.status === 'cancelled' && journal.reason === 'cancelled',
      noPartialOutput: files.length === 1 && files[0] === 'player.csv' };
  } finally {
    controller.abort();
    await locker.query('ROLLBACK').catch(() => {});
    locker.release();
    await pending;
  }
}

/** The benchmark always owns its embedded PostgreSQL and takes no database connection input. */
export async function runAuditLoad(input: LoadOptions = defaults, signal?: AbortSignal) {
  const options = loadOptions(input);
  signal?.throwIfAborted();
  const cluster = await temporaryDatabase();
  const loopbackAgent = new Agent({ keepAlive: true, maxSockets: options.workers, proxyEnv: {} });
  let directory: string | undefined, game: PostgresDatabase | undefined, audit: PostgresDatabase | undefined;
  let runtime: Capture;
  let server: ReturnType<express.Application['listen']> | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-'));
    const config = databaseConfig({ ...cluster.env, PGPOOL_MAX: '8' });
    game = new PostgresDatabase('test_audit_load_game', { config });
    audit = new PostgresDatabase('test_audit_load', { config });
    await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    const makePairs = (): Pair[] => Array.from({ length: options.workers }, () => [randomUUID(), randomUUID()]);
    const baselinePairs = makePairs(), activePairs = makePairs(), reportAccount = randomUUID();
    const scaleAccounts = options.scaleHistory ? [randomUUID(), randomUUID()] as const : null;
    const accounts = [...baselinePairs.flat(), ...activePairs.flat(), reportAccount, ...(scaleAccounts ?? [])];
    const wallet = new DemoWalletStore(game, () => 0), pvp = new VirtualPvpLedger(game, wallet);
    for (const accountId of accounts) {
      await game.prepare('INSERT INTO accounts VALUES (?)').run(accountId);
      await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: Number(initialCents / 100n) });
    }
    const app = express(), actors = new Set(accounts);
    const observe = auditHttpAttempts(observation => runtime?.record(observation), { gameSchema: game.schema });
    app.use(express.json({ limit: '4kb' }));
    app.use((req, res, next) => runtime ? observe(req, res, next) : next());
    app.post(auditCommandRoutes.core, async (req, res) => {
      const account = req.get('x-fixture-account');
      if (!account || !actors.has(account)) { res.sendStatus(403); return; }
      res.locals.accountId = account;
      try { res.json(await wallet.operate(account, req.body)); }
      catch { res.sendStatus(409); }
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Expected isolated loopback HTTP');
    const baseUrl = 'http://127.0.0.1:' + address.port;
    const baseline = await workload(game, pvp, baseUrl, loopbackAgent, baselinePairs, options.roundsPerWorker, signal);
    const sources = { game: game.schema };
    const { datasetId, startedAtMs } = await new AuditDatasets(audit, sources).startTest();
    const group = 'audit_load_read', reader = 'audit_load_player', summaryReader = 'audit_load_summary';
    const wideReader = 'audit_load_wide', password = randomUUID();
    const readers = [reader, summaryReader, ...(scaleAccounts ? [wideReader] : [])];
    await audit.exec('CREATE ROLE ' + group + ' NOLOGIN');
    for (const name of readers) {
      await audit.exec(`CREATE ROLE ${name} LOGIN PASSWORD '${password}';
        GRANT ${group} TO ${name};
        ALTER ROLE ${name} SET temp_file_limit='${reportTempFileLimit}'`);
    }
    await installAuditReportAccess(audit, group);
    await installAuditPlayerReport(audit, group, sources);
    await installAuditSummaryReport(audit, group, sources);
    for (const name of readers) {
      await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(name, datasetId, game.schema + '.demo_ledger');
    }
    const operator = (name: string) => databaseConfig({ ...cluster.env, PGUSER: name, PGPASSWORD: password, PGPOOL_MAX: '2' });
    const before = await sizes(audit, game);
    const widePeriod = scaleAccounts ? await seedScaleHistory(game, ...scaleAccounts, startedAtMs) : null;
    if (widePeriod) {
      // Keep the live workload in a separate narrow interval even if the fixture is seeded within two milliseconds.
      await waitFor(async () => Date.now() >= widePeriod.toMs ? true : undefined, 2000, signal);
      await game.exec('ANALYZE demo_ledger');
      await audit.exec('ANALYZE audit_posting_refs');
    }
    for (let i = 0; i < options.seedRounds; i++) await wallet.operate(reportAccount, playRequest());
    runtime = startAuditAttemptRuntime({ ...cluster.env, ROYAL_AUDIT_SCHEMA: audit.schema, ROYAL_AUDIT_TEST_DATASET_ID: datasetId }, game.schema);
    if (!runtime) throw new Error('Isolated audit observer did not start');
    const period = { fromMs: widePeriod?.toMs ?? startedAtMs, toMs: Date.now() + 60_000 };
    const reportInput = { schema: audit.schema, datasetId, signal,
      filters: { accountId: scaleAccounts?.[0] ?? reportAccount, ...(widePeriod ?? period) },
      destination: join(directory, 'player.csv'), limits: scaleAccounts ? undefined : { pageSize: 1 } };
    const observeTiming = async <T>(work: () => Promise<T>) => {
      const from = performance.now(), result = await work();
      return { from, to: performance.now(), result };
    };
    const player = observeTiming(() => exportAuditPlayer(operator(reader), reportInput));
    // Attach an error handler while observing the part so an early export failure remains controlled.
    void player.catch(() => {});
    // Observe the owned part before starting the measured workload. Both the part and the benchmark DB are isolated.
    try {
      await waitFor(async () => (await readdir(directory!)).some(file => file.endsWith('.part')) ? true : undefined, 2000, signal);
    } catch (error) {
      await player.catch(() => {});
      throw error;
    }
    const [activeResult, csvResult, summaryResult, wideResult] = await Promise.allSettled([
      workload(game, pvp, baseUrl, loopbackAgent, activePairs, options.roundsPerWorker, signal),
      player,
      observeTiming(() => readAuditSummary(operator(summaryReader), { schema: audit!.schema, datasetId, filters: period, signal })),
      widePeriod ? observeTiming(() => rejectOversizedSummary(audit!, operator(wideReader),
        { schema: audit!.schema, datasetId, filters: widePeriod, signal }, wideReader)) : null,
    ]);
    if (activeResult.status === 'rejected') throw activeResult.reason;
    if (csvResult.status === 'rejected') throw csvResult.reason;
    if (summaryResult.status === 'rejected') throw summaryResult.reason;
    if (wideResult.status === 'rejected') throw wideResult.reason;
    const { value: active } = activeResult, { value: csv } = csvResult, { value: summary } = summaryResult;
    const { value: wide } = wideResult;
    await runtime.close();
    runtime = undefined;
    const stopped = await waitFor(async () => await audit!.prepare(
      "SELECT 1 FROM pg_stat_activity WHERE application_name='royal/audit-attempts' LIMIT 1").get() ? undefined : true, 1000, signal);
    const cancellation = await cancelReport(game, audit, operator(reader),
      { ...reportInput, destination: join(directory, 'cancelled.csv') }, directory, signal);
    const after = await sizes(audit, game), records = await recordSizes(audit, datasetId);
    const captureGaps = (await audit.prepare('SELECT COALESCE(sum(missing_count),0)::text AS n FROM audit_attempt_capture_gaps WHERE dataset_id=?')
      .get(datasetId))!.n;
    const overlap = (window: { from: number; to: number }, metric: Metric) =>
      active.samples[metric].filter(sample => sample.from < window.to && sample.to > window.from).length;
    const report = { player: { rows: csv.result.rowCount, bytes: csv.result.bytes, elapsedMs: rounded(csv.to - csv.from),
      overlappingStakeCalls: overlap(csv, 'stake'), overlappingSettlementCalls: overlap(csv, 'settlement') },
    summary: { rows: summary.result.rows.length, scanned: summary.result.scanned, elapsedMs: rounded(summary.to - summary.from),
      overlappingStakeCalls: overlap(summary, 'stake'), overlappingSettlementCalls: overlap(summary, 'settlement') } };
    let scale: { fixturePostings: number; capturedFixturePostings: number; reportTempFileLimit: string;
      csvAmountsAndBalancesMatch: boolean; atLimit: { scanned: number; elapsedMs: number; exactTotal: boolean };
      overLimit: { outcome: string; journalRejected: boolean; elapsedMs: number; overlappingStakeCalls: number }; ok: boolean } | null = null;
    if (widePeriod && wide && scaleAccounts) {
      const fixturePostings = AUDIT_SUMMARY_SCAN_CAP + 1;
      const captured = await audit.prepare(`SELECT count(*)::int AS n FROM audit_posting_refs
        WHERE dataset_id=? AND occurred_at_ms>=? AND occurred_at_ms<?`).get(datasetId, widePeriod.fromMs, widePeriod.toMs);
      const atLimit = await observeTiming(() => readAuditSummary(operator(summaryReader), {
        schema: audit!.schema, datasetId, filters: { ...widePeriod, toMs: widePeriod.toMs - 1 }, signal,
      }));
      const totals = atLimit.result.rows[0];
      const exactTotal = atLimit.result.rows.length === 1 && totals.movement_type === 'deposit' &&
        totals.posting_count === String(AUDIT_SUMMARY_SCAN_CAP) && totals.amount_units === String(AUDIT_SUMMARY_SCAN_CAP * 100) &&
        totals.coverage_status === 'complete';
      const csvAmountsAndBalancesMatch = await verifyScaleCsv(reportInput.destination, scaleAccounts[0]);
      scale = { fixturePostings, capturedFixturePostings: Number(captured?.n), reportTempFileLimit, csvAmountsAndBalancesMatch,
        atLimit: { scanned: atLimit.result.scanned, elapsedMs: rounded(atLimit.to - atLimit.from), exactTotal },
        overLimit: { ...wide.result, elapsedMs: rounded(wide.to - wide.from), overlappingStakeCalls: overlap(wide, 'stake') },
        ok: captured?.n === fixturePostings && csvAmountsAndBalancesMatch && atLimit.result.scanned === AUDIT_SUMMARY_SCAN_CAP &&
          exactTotal && wide.result.journalRejected && overlap(wide, 'stake') > 0 };
    }
    const expectedAttempts = options.workers * options.roundsPerWorker * 2;
    const expectedPostings = active.expectedPostings + options.seedRounds * 2 + (scale?.fixturePostings ?? 0);
    const csvMatches = csv.result.rowCount === (scaleAccounts ? scalePlayerRows : options.seedRounds * 2) &&
      (await stat(reportInput.destination)).size === csv.result.bytes;
    const observedOverlap = report.player.overlappingStakeCalls > 0 && report.player.overlappingSettlementCalls > 0 &&
      report.summary.overlappingStakeCalls > 0;
    const captureOk = stopped && records.postingRefs.rows === expectedPostings &&
      records.attemptPayloads.rows === expectedAttempts && captureGaps === '0';
    const cancellationOk = cancellation.outcome === 'cancelled' && cancellation.noPartialOutput &&
      cancellation.readerStopped && cancellation.journalCancelled;
    const budget = assessBudget(options.budget, { stakeP95Ms: active.metrics.stake.p95Ms,
      settlementP95Ms: active.metrics.settlement.p95Ms, readerStopMs: cancellation.databaseReaderStopMs });
    const postgres = (await audit.prepare('SHOW server_version').get())!.server_version as string;
    return { schemaVersion: 1, environment: 'isolated-local-postgresql', capacityConfirmed: false,
      ok: baseline.noDoubleMoney && active.noDoubleMoney && captureOk && csvMatches && observedOverlap && cancellationOk &&
        report.summary.scanned >= options.seedRounds * 2 && (scale?.ok ?? true) && (budget?.ok ?? true),
      runtime: { node: process.version, postgres, platform: process.platform, architecture: process.arch },
      workload: { workers: options.workers, roundsPerWorker: options.roundsPerWorker, seedRounds: options.seedRounds },
      ...(scale ? { scale } : {}), ...(budget ? { budget } : {}),
      baseline: { metrics: baseline.metrics, elapsedMs: baseline.elapsedMs, noDoubleMoney: baseline.noDoubleMoney, postings: baseline.actualPostings },
      withAudit: { metrics: active.metrics, elapsedMs: active.elapsedMs, noDoubleMoney: active.noDoubleMoney, postings: active.actualPostings },
      reports: report, cancellation, capture: { stopped, expectedAttempts, expectedPostings, gaps: Number(captureGaps), ...records },
      disk: { before, after, growth: { databaseBytes: after.databaseBytes - before.databaseBytes,
        gameLedgerBytes: after.gameLedgerBytes - before.gameLedgerBytes, auditRelationsBytes: after.auditRelationsBytes - before.auditRelationsBytes } } };
  } finally {
    try {
      await runtime?.close();
    } finally {
      loopbackAgent.destroy();
      if (server) {
        await new Promise<void>(resolveClose => {
          server!.close(() => resolveClose());
          server!.closeAllConnections();
        });
      }
      try { await Promise.all([game?.close(), audit?.close()]); }
      finally {
        try { if (directory) await rm(directory, { recursive: true, force: true }); }
        finally { await cluster.cleanup(); }
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  let exitCode = 1;
  try {
    const { values } = parseArgs({ options: { workers: { type: 'string' }, rounds: { type: 'string' }, seed: { type: 'string' },
      'scale-history': { type: 'boolean' }, 'stake-p95-budget-ms': { type: 'string' }, 'settlement-p95-budget-ms': { type: 'string' },
      'reader-stop-budget-ms': { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('node --import tsx scripts/audit-load.ts [--workers 1..8] [--rounds 2..16] [--seed 8..40] [--scale-history]\n' +
        '  [--stake-p95-budget-ms n] [--settlement-p95-budget-ms n] [--reader-stop-budget-ms n]');
      exitCode = 0;
    } else {
      const budget: Budget = {};
      if (values['stake-p95-budget-ms'] !== undefined) budget.stakeP95Ms = Number(values['stake-p95-budget-ms']);
      if (values['settlement-p95-budget-ms'] !== undefined) budget.settlementP95Ms = Number(values['settlement-p95-budget-ms']);
      if (values['reader-stop-budget-ms'] !== undefined) budget.readerStopMs = Number(values['reader-stop-budget-ms']);
      const result = await runAuditLoad({ workers: Number(values.workers ?? defaults.workers),
        roundsPerWorker: Number(values.rounds ?? defaults.roundsPerWorker), seedRounds: Number(values.seed ?? defaults.seedRounds),
        scaleHistory: values['scale-history'], budget: Object.keys(budget).length ? budget : undefined }, controller.signal);
      console.log(JSON.stringify(result));
      exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ error: controller.signal.aborted ? 'cancelled' : 'audit-load-failed',
      message: error instanceof Error ? error.message : 'Unknown isolated benchmark failure' }));
    exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  process.exit(exitCode);
}
