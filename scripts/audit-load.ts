import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { Agent, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { auditDemoLedgerSnapshot } from '../server/audit/attempts';
import { isAuditRecord } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { auditCommandRoutes } from '../server/audit/intents';
import { verifyReplayPackage } from '../server/audit/replay-package';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { installAuditPlayerReport, playerColumns } from '../server/audit/report-player-source';
import { AuditPlayerReportError, exportAuditPlayer } from '../server/audit/report-player';
import { installAuditReplayReport } from '../server/audit/report-replay-source';
import { exportAuditReplay } from '../server/audit/report-replay';
import { AUDIT_SUMMARY_SCAN_CAP, installAuditSummaryReport } from '../server/audit/report-summary-source';
import { readAuditSummary } from '../server/audit/report-summary';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { verifyGameRound } from '../server/games/core';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { gameBetCents } from '../src/shared/gameStakes';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { auditMixedHistoryPeriod, auditReportMonthMs, matchesMixedHistoryTotals, mixedHistoryAccountCount, seedMixedAuditHistory,
  type MixedHistoryPosting } from './audit-load-mixed-history';
import { MAX_RETAINED_AUDIT_HISTORY_ROWS, seedRetainedAuditHistory } from './audit-load-retained-history';
import { drainAuditLoadStandbyReport, findAuditLoadBlockedStandbyPage, grantAuditLoadStandbyReports,
  installAuditLoadStandbyPageBarrier, lockAuditLoadStandbyPageBarrier, startAuditLoadStandby,
  unlockAuditLoadStandbyPageBarrier } from './audit-load-standby';
import { auditLoadMonotonicMs, startAuditLoadReportConsumer } from './audit-load-report-consumer';
import { seedAuditLoadReplay } from './audit-load-replay-fixture';
import { startAuditLoadWallet } from './audit-load-wallet';
import { temporaryDatabase } from './database-test';

type Budget = { stakeP95Ms?: number; settlementP95Ms?: number; readerStopMs?: number };
type LoadOptions = { workers: number; roundsPerWorker: number; seedRounds: number;
  scaleHistory?: boolean; mixedHistory?: boolean; pilotGate?: boolean; summaryFirst?: boolean; replayFirst?: boolean; reportProcess?: boolean;
  controlAfterReports?: boolean;
  budget?: Budget; standbyPgBasebackup?: string; retainedHistoryRows?: number };
type Metric = 'stake' | 'settlement' | 'casinoRound' | 'retry';
type Sample = { from: number; to: number; ok: boolean };
type Leg = [account: string, operation: string, entry: string, units: string];
type Pair = [string, string];
type LoadPlayers = [left: string, right: string, casino: string];
type CasinoBalance = { accountId: string; units: string; rowId: string };
type PlayerInput = Parameters<typeof exportAuditPlayer>[1];
type ReportLogin = Parameters<typeof exportAuditPlayer>[0];
type Standby = Awaited<ReturnType<typeof startAuditLoadStandby>>;
const initialCents = 10000n;
const scalePlayerRows = 10_000;
const reportTempFileLimit = '32MB';
const pilotMaxP95GrowthPercent = 10;
const defaults: LoadOptions = { workers: 4, roundsPerWorker: 8, seedRounds: 40 };

function loadOptions(input: LoadOptions) {
  const { workers, roundsPerWorker, seedRounds, scaleHistory, mixedHistory, pilotGate, summaryFirst, replayFirst, reportProcess,
    controlAfterReports, budget, standbyPgBasebackup, retainedHistoryRows } = input;
  if (!Number.isInteger(workers) || workers < 1 || workers > 8 || !Number.isInteger(roundsPerWorker) ||
      roundsPerWorker < 2 || roundsPerWorker > 16 || !Number.isInteger(seedRounds) || seedRounds < 8 || seedRounds > 40) {
    throw new Error('Invalid isolated audit load options');
  }
  if (budget && Object.values(budget).some(value => !Number.isFinite(value) || value <= 0 || value > 60_000)) {
    throw new Error('Invalid isolated audit load budget');
  }
  if (standbyPgBasebackup !== undefined && (!pilotGate || !standbyPgBasebackup)) {
    throw new Error('The isolated standby requires --pilot-gate and a pg_basebackup executable');
  }
  if (summaryFirst && !pilotGate) throw new Error('The summary-first order requires --pilot-gate');
  if (replayFirst && (!pilotGate || summaryFirst)) {
    throw new Error('The replay-first order requires --pilot-gate and a single first report');
  }
  if (reportProcess && !pilotGate) throw new Error('The isolated report process requires --pilot-gate');
  if (controlAfterReports && !pilotGate) throw new Error('The reversed control phase requires --pilot-gate');
  if (retainedHistoryRows !== undefined && (!Number.isSafeInteger(retainedHistoryRows) || retainedHistoryRows < 1 ||
      retainedHistoryRows > MAX_RETAINED_AUDIT_HISTORY_ROWS || !mixedHistory || !pilotGate)) {
    throw new Error('Retained audit history requires --mixed-history, --pilot-gate and 1..1000000 rows');
  }
  return { workers, roundsPerWorker, seedRounds, scaleHistory: scaleHistory || mixedHistory || pilotGate, mixedHistory,
    pilotGate, summaryFirst, replayFirst, reportProcess, controlAfterReports, budget, standbyPgBasebackup, retainedHistoryRows };
}

const rounded = (value: number) => Number(value.toFixed(3));
function stats(samples: Sample[]) {
  const success = samples.filter(item => item.ok).map(item => item.to - item.from).sort((a, b) => a - b);
  return { attempts: samples.length, completed: success.length, errors: samples.length - success.length,
    p95Ms: success.length ? rounded(success[Math.ceil(success.length * 0.95) - 1]) : null };
}

type WorkloadMetrics = Record<Metric, ReturnType<typeof stats>>;

export function assessAuditPilotGate(withoutReports: WorkloadMetrics, withReports: WorkloadMetrics) {
  const noWalletErrorsOrTimeouts = (Object.keys(withoutReports) as Metric[]).every(metric => {
    const baseline = withoutReports[metric], active = withReports[metric];
    return baseline.attempts > 0 && active.attempts === baseline.attempts &&
      baseline.completed === baseline.attempts && active.completed === active.attempts &&
      baseline.errors === 0 && active.errors === 0;
  });
  const p95 = (['stake', 'settlement', 'casinoRound'] as const).map(metric => {
    const controlMs = withoutReports[metric].p95Ms, reportMs = withReports[metric].p95Ms;
    const controlMicros = controlMs === null ? 0 : Math.round(controlMs * 1000);
    const reportMicros = reportMs === null ? 0 : Math.round(reportMs * 1000);
    const measured = controlMicros > 0 && reportMicros > 0;
    return { metric, controlMs, reportMs, growthPercent: measured ? rounded((reportMicros / controlMicros - 1) * 100) : null,
      passed: measured && reportMicros * 100 <= controlMicros * (100 + pilotMaxP95GrowthPercent) };
  });
  return { maxP95GrowthPercent: pilotMaxP95GrowthPercent, noWalletErrorsOrTimeouts, p95,
    ok: noWalletErrorsOrTimeouts && p95.every(metric => metric.passed) };
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

async function workload(game: PostgresDatabase, wallet: VirtualPvpLedger, baseUrl: string, agent: Agent,
  tokens: ReadonlyMap<string, string>, workers: LoadPlayers[], rounds: number, signal?: AbortSignal) {
  const samples: Record<Metric, Sample[]> = { stake: [], settlement: [], casinoRound: [], retry: [] };
  const expected: Leg[] = [], matchIds: string[] = [];
  const casinoBalances = new Map<string, CasinoBalance>();
  let expectedFees = 0, completedRounds = 0;
  const timed = async <T>(kind: Metric, work: () => Promise<T>) => {
    signal?.throwIfAborted();
    const from = auditLoadMonotonicMs();
    let ok = false;
    try { const result = await work(); ok = true; return result; }
    finally { samples[kind].push({ from, to: auditLoadMonotonicMs(), ok }); }
  };
  const plinko = async (accountId: string, op: ReturnType<typeof playRequest>) => {
    const body = JSON.stringify(op);
    const token = tokens.get(accountId);
    if (!token) throw new Error('Fixture wallet session is missing');
    const response = await new Promise<string>((complete, reject) => {
      const call = request(baseUrl + auditCommandRoutes.core, { agent, method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
          cookie: 'royal_session=' + token, [WALLET_ACCOUNT_HEADER]: accountId } },
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
    const { gameRound, wallet } = JSON.parse(response) as { gameRound?: unknown; wallet?: { balance?: unknown } };
    const units = gameBetCents(wallet?.balance), snapshot = auditDemoLedgerSnapshot(game.schema, wallet);
    if (!verifyGameRound(gameRound) || gameRound.gameId !== op.gameId || gameRound.stakeUnits !== '100' ||
        units === undefined || snapshot === null) throw new Error('Fixture casino result or wallet snapshot is invalid');
    return { gameRound, balance: { accountId, units: String(units), rowId: snapshot.rowId } };
  };
  const pvpRound = async (a: string, b: string, round: number) => {
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
  };
  const casinoRound = async (accountId: string) => {
    const command = playRequest();
    const outcome = await timed('casinoRound', () => plinko(accountId, command));
    expected.push([accountId, command.id, 'bet', '-100'], [accountId, command.id, 'win', outcome.gameRound.payoutUnits]);
    await timed('retry', async () => {
      const repeated = await plinko(accountId, command);
      if (JSON.stringify(repeated) !== JSON.stringify(outcome)) throw new Error('Fixture casino replay differs');
    });
    casinoBalances.set(command.id, outcome.balance);
  };
  const started = performance.now();
  await Promise.all(workers.map(async ([a, b, casino]) => {
    for (let round = 0; round < rounds; round++) {
      // The failed step is counted by timed(). Wait for both lanes before stopping this worker.
      const steps = await Promise.allSettled([pvpRound(a, b, round), casinoRound(casino)]);
      if (steps.some(step => step.status === 'rejected')) return;
      completedRounds++;
    }
  }));
  const elapsedMs = rounded(performance.now() - started);
  signal?.throwIfAborted();
  const accounts = workers.flat();
  const actual = await game.prepare(`SELECT id::text,account_id,operation_id,entry_type,amount_units::text,balance_units::text FROM demo_ledger
    WHERE account_id=ANY(?::text[]) AND entry_type<>'deposit'`).all(accounts);
  const expectedKeys = expected.map(row => JSON.stringify(row)).sort();
  const actualKeys = actual.map(row => JSON.stringify([row.account_id, row.operation_id, row.entry_type, row.amount_units])).sort();
  const balances = await game.prepare(`SELECT account_id,(balance*100+fraction_units)::text AS units
    FROM demo_wallets WHERE account_id=ANY(?::text[])`).all(accounts);
  const bank = await game.prepare(`SELECT count(*)::int AS n,COALESCE(sum(fee_units),0)::text AS fee,
    count(*) FILTER (WHERE state='open')::int AS open FROM virtual_pvp_banks WHERE match_id=ANY(?::text[])`).get(matchIds);
  const casinoWallets = actual.filter(row => row.entry_type === 'win' && casinoBalances.has(row.operation_id));
  const casinoBalancesVerified = casinoWallets.length === completedRounds && casinoWallets.every(row => {
    const balance = casinoBalances.get(row.operation_id);
    return balance?.accountId === row.account_id && balance.units === row.balance_units && balance.rowId === row.id;
  });
  const noDoubleMoney = completedRounds === workers.length * rounds && casinoBalancesVerified &&
    JSON.stringify(expectedKeys) === JSON.stringify(actualKeys) && balances.length === accounts.length &&
    balances.every(row => initialCents + expected.filter(leg => leg[0] === row.account_id)
      .reduce((sum, leg) => sum + BigInt(leg[3]), 0n) === BigInt(row.units)) &&
    bank?.n === completedRounds && bank.fee === String(expectedFees) && bank.open === 0;
  const metrics = { stake: stats(samples.stake), settlement: stats(samples.settlement),
    casinoRound: stats(samples.casinoRound), retry: stats(samples.retry) };
  return { samples, metrics, elapsedMs, completedRounds, expectedPostings: expected.length, actualPostings: actual.length,
    noDoubleMoney, casinoBalances, casinoBalancesVerified };
}

async function verifyCasinoAttempts(audit: PostgresDatabase, datasetId: string, source: string,
  expected: ReadonlyMap<string, CasinoBalance>) {
  const rows = await audit.prepare("SELECT payload FROM audit_evidence WHERE dataset_id=? AND kind='attempt'").all(datasetId);
  const seen = new Set<string>();
  for (const { payload } of rows) {
    if (!isAuditRecord(payload) || payload.type !== 'attempt' || !payload.operationId ||
        payload.transport !== 'http' || payload.route !== auditCommandRoutes.core || payload.statusCode !== 200 ||
        payload.response !== 'formed' || payload.delivery !== 'handed-off' ||
        (payload.decision !== 'accepted' && payload.decision !== 'replayed')) return false;
    const balance = expected.get(payload.operationId);
    const key = payload.operationId + ':' + payload.decision;
    if (!balance || seen.has(key) || payload.accountId !== balance.accountId || payload.balance.state !== 'value' ||
        payload.balance.units !== balance.units || payload.balance.asset.code !== 'VIRTUAL_USD' ||
        payload.balance.asset.contour !== 'virtual' || payload.balance.asset.scale !== 2 ||
        payload.balance.snapshot?.namespace !== source || payload.balance.snapshot.rowId !== balance.rowId) return false;
    seen.add(key);
  }
  return seen.size === expected.size * 2;
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

async function verifyScaleCsv(path: string, accountId: string, mixed?: readonly MixedHistoryPosting[], hasPriorPosting = false) {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const header = playerColumns.map(column => JSON.stringify(column)).join(',');
  const account = playerColumns.indexOf('account_id'), id = playerColumns.indexOf('posting_id');
  const expected = playerColumns.indexOf('expected_balance_units'), stored = playerColumns.indexOf('stored_balance_units');
  const amount = playerColumns.indexOf('amount_units'), movement = playerColumns.indexOf('movement_type');
  const operation = playerColumns.indexOf('operation_id'), occurred = playerColumns.indexOf('occurred_at');
  const category = playerColumns.indexOf('category'), basis = playerColumns.indexOf('expected_balance_basis');
  let rowCount = -1, previousId = 0n;
  try {
    for await (const line of lines) {
      rowCount++;
      if (rowCount === 0) { if (line !== header) return false; continue; }
      // Seeded labels, timestamps and identifiers contain no embedded CSV separators.
      const cells = line.split(','), fixture = mixed?.[rowCount - 1];
      if (mixed && !fixture) return false;
      const balance = fixture ? String(fixture.balance_units) : String(initialCents + BigInt(rowCount) * 100n);
      if (cells.length !== playerColumns.length || cells[account] !== JSON.stringify(accountId) ||
        cells[amount] !== String(fixture?.amount_units ?? 100) || cells[movement] !== JSON.stringify(fixture?.movement ?? 'deposit') ||
        cells[expected] !== balance ||
        cells[stored] !== balance || !/^[1-9][0-9]*$/.test(cells[id]) || BigInt(cells[id]) <= previousId) return false;
      if (fixture && (cells[operation] !== JSON.stringify(fixture.operation_id) ||
          cells[occurred] !== JSON.stringify(new Date(fixture.created_at).toISOString()) ||
          cells[category] !== (fixture.category === null ? '' : JSON.stringify(fixture.category)) ||
          cells[basis] !== (rowCount === 1 && !hasPriorPosting ? '"opening"' : '"adjacent"'))) return false;
      previousId = BigInt(cells[id]);
    }
    return rowCount === scalePlayerRows;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function verifyRetainedAuditHistory(audit: PostgresDatabase, game: PostgresDatabase, datasetId: string, accountId: string,
  retained: Awaited<ReturnType<typeof seedRetainedAuditHistory>>, period: { fromMs: number; toMs: number }) {
  const source = game.schema + '.demo_ledger';
  const captured = (await audit.prepare(`SELECT count(*)::int AS rows,count(DISTINCT account_id)::int AS accounts,
    count(*) FILTER (WHERE account_id=?)::int AS player_rows,
    min(occurred_at_ms)::text AS first_at,max(occurred_at_ms)::text AS last_at
    FROM audit_posting_refs WHERE dataset_id=? AND source_namespace=? AND occurred_at_ms<?`)
    .get(accountId, datasetId, source, period.fromMs))!;
  const prior = await audit.prepare(`SELECT l.balance_units::text AS balance FROM audit_posting_refs r
    JOIN ${identifier(game.schema)}.demo_ledger l ON l.id=r.source_row_id AND l.account_id=r.account_id
      AND l.operation_id=r.operation_id AND l.created_at=r.occurred_at_ms
    WHERE r.dataset_id=? AND r.source_namespace=? AND r.account_id=? AND r.occurred_at_ms<?
    ORDER BY r.source_row_id DESC LIMIT 1`).get(datasetId, source, accountId, period.fromMs);
  const reportWindowMs = period.toMs - period.fromMs;
  const previousBalanceMatches = prior?.balance === String(retained.playerEndingUnits);
  const latest = retained.rows === 1 ? retained.fromMs : retained.toMs - 1;
  return { ...retained, capturedRows: captured.rows, capturedAccounts: captured.accounts,
    capturedPlayerRows: captured.player_rows, previousBalanceMatches, reportWindowMs,
    ok: captured.rows === retained.rows && captured.accounts === retained.accounts && captured.player_rows === retained.playerRows &&
      captured.first_at === String(retained.fromMs) && captured.last_at === String(latest) && retained.toMs === period.fromMs &&
      reportWindowMs === auditReportMonthMs && previousBalanceMatches };
}

function throwReportFailure(report: string, error: unknown): never {
  if (error instanceof AuditPlayerReportError) throw new Error('Isolated ' + report + ' failed: ' + error.code);
  throw error;
}

async function rejectOversizedSummary(audit: PostgresDatabase, input: Parameters<typeof readAuditSummary>[1],
  operatorName: string, run: () => Promise<unknown>) {
  try {
    await run();
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

async function flushFixtureStats(db: PostgresDatabase) {
  const connections = [];
  try {
    for (let pending = db.pool.totalCount; pending > 0; pending--) connections.push(await db.pool.connect());
    await Promise.all(connections.map(connection => connection.query('SELECT pg_stat_force_next_flush()')));
  } finally {
    for (const connection of connections) connection.release();
  }
}

const activitySql = `SELECT blks_read,blks_hit,temp_bytes,temp_files
  FROM pg_stat_database WHERE datname=current_database()`;

function readActivity(row: Record<string, unknown>) {
  return { blocksRead: Number(row.blks_read), blocksHit: Number(row.blks_hit),
    tempBytes: Number(row.temp_bytes), tempFiles: Number(row.temp_files) };
}

async function databaseActivity(audit: PostgresDatabase, game: PostgresDatabase) {
  // The report and recorder connections have closed. Flush the two fixture pools before sampling.
  await Promise.all([flushFixtureStats(audit), flushFixtureStats(game)]);
  return readActivity((await audit.prepare(activitySql).get())!);
}

type Activity = Awaited<ReturnType<typeof databaseActivity>>;

async function standbyActivity(standby: Standby) {
  const connection = standby.connect();
  try {
    await connection.connect();
    return readActivity((await connection.query(activitySql)).rows[0]);
  } finally { await connection.end(); }
}

async function verifyStandby(standby: Standby, audit: PostgresDatabase, signal?: AbortSignal) {
  const primary = (await audit.prepare(`SELECT system_identifier::text AS id,
    current_setting('server_version_num') AS version_number FROM pg_control_system()`).get())!;
  const connection = standby.connect();
  try {
    await connection.connect();
    return await waitFor(async () => {
      const { rows: [row] } = await connection.query(`SELECT pg_is_in_recovery() AS standby,
        EXISTS (SELECT 1 FROM pg_stat_wal_receiver WHERE status='streaming') AS streaming,
        current_setting('server_version') AS postgres, pg_last_wal_replay_lsn()::text AS replay_lsn,
        current_setting('server_version_num') AS version_number,
        (SELECT system_identifier::text FROM pg_control_system()) AS id`);
      if (!row.standby || row.id !== primary.id) throw new Error('Expected a physical standby of the isolated primary');
      if (row.version_number !== primary.version_number) throw new Error('Expected the same PostgreSQL version on both fixtures');
      return row.streaming && row.replay_lsn
        ? { streaming: true, postgres: String(row.postgres), replayLsn: String(row.replay_lsn) } : undefined;
    }, 3000, signal);
  } finally { await connection.end(); }
}

async function waitForStandbyDrain(standby: Standby, audit: PostgresDatabase, jobId: string, signal?: AbortSignal) {
  const connection = standby.connect();
  try {
    await connection.connect();
    await waitFor(async () => await drainAuditLoadStandbyReport(audit.pool, connection, audit.schema, jobId)
      ? true : undefined, 3000, signal);
  } finally { await connection.end(); }
}

function activityDelta(before: Activity, after: Activity): Activity {
  const activity = { blocksRead: after.blocksRead - before.blocksRead, blocksHit: after.blocksHit - before.blocksHit,
    tempBytes: after.tempBytes - before.tempBytes, tempFiles: after.tempFiles - before.tempFiles };
  if (Object.values(activity).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Invalid isolated audit database activity counters');
  }
  return activity;
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
    // Observe the server exit independently of the cancelled client while the fixture keeps the lock.
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

async function observeActiveReport(audit: PostgresDatabase, standby: Standby | undefined, operator: string,
  report: 'player' | 'summary' | 'replay', signal?: AbortSignal) {
  const connection = standby?.connect();
  try {
    await connection?.connect();
    const sql = `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND usename=$1 AND application_name=$2 AND state='active' AND query LIKE $3 LIMIT 1`;
    const projection = report === 'player' ? 'audit_report_player_page' : 'audit_report_' + report;
    const parameters = [operator, 'royal/audit-' + report, `%${projection}%`];
    return await waitFor(async () => {
      const rows = (await (connection ?? audit.pool).query(sql, parameters)).rows;
      return rows.length ? true : undefined;
    }, 2000, signal);
  } finally { await connection?.end(); }
}

async function measureStandbyReaderStop(observer: ReturnType<Standby['connect']>,
  backend: { pid: number; backend_start: string }, options: {
    controller: AbortController; pending: Promise<unknown>; observationMs: number; signal?: AbortSignal;
  }) {
  const started = performance.now();
  options.controller.abort();
  const [{ result, cancellationMs }, databaseReaderStopMs] = await Promise.all([
    options.pending.then(result => ({ result, cancellationMs: rounded(performance.now() - started) })),
    waitFor(async () => (await observer.query(
      'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz', [backend.pid, backend.backend_start])).rowCount
      ? undefined : rounded(performance.now() - started), options.observationMs, options.signal),
  ]);
  return { result, cancellationMs, databaseReaderStopMs };
}

async function cancelStandbyReplayWait(standby: Standby, audit: PostgresDatabase, operator: ReportLogin, input: PlayerInput,
  directory: string, abort?: AbortSignal) {
  const observer = standby.connect(), controller = new AbortController();
  const signal = abort ? AbortSignal.any([abort, controller.signal]) : controller.signal;
  let pending: Promise<unknown> | undefined;
  let replayPaused = false;
  try {
    await observer.connect();
    await observer.query('SELECT pg_wal_replay_pause()');
    replayPaused = true;
    await waitFor(async () => (await observer.query('SELECT pg_get_wal_replay_pause_state() AS state')).rows[0]?.state === 'paused'
      ? true : undefined, 2000, signal);
    pending = exportAuditPlayer(operator, { ...input, signal }).then(() => null, error => error);
    const backend = await waitFor(async () => (await observer.query<{ pid: number; backend_start: string }>(
      `SELECT pid,backend_start::text FROM pg_stat_activity
      WHERE usename=$1 AND application_name='royal/audit-player' AND query LIKE '%pg_last_wal_replay_lsn%'`,
      [operator.user])).rows[0], 2000, signal);
    const { result, cancellationMs, databaseReaderStopMs } = await measureStandbyReaderStop(observer, backend,
      { controller, pending, observationMs: 2000, signal: abort });
    const journal = result instanceof AuditPlayerReportError && result.jobId
      ? await audit.prepare('SELECT status,reason FROM audit_export_jobs WHERE id=?').get(result.jobId) : null;
    await observer.query('SELECT pg_wal_replay_resume()');
    replayPaused = false;
    if (!(result instanceof AuditPlayerReportError) || !result.jobId) throw new Error('Missing cancelled standby report job');
    await waitForStandbyDrain(standby, audit, result.jobId, abort);
    const files = await readdir(directory);
    return { replayWaitObserved: true, readerStopped: true, cancellationMs, databaseReaderStopMs,
      journalCancelled: result.code === 'cancelled' &&
        journal?.status === 'cancelled' && journal.reason === 'cancelled',
      noPartialOutput: files.length === 1 && files[0] === 'player.csv' };
  } finally {
    controller.abort();
    await pending;
    try { if (replayPaused) await observer.query('SELECT pg_wal_replay_resume()'); }
    finally { await observer.end(); }
  }
}

async function cancelActiveStandbyReport(standby: Standby, audit: PostgresDatabase, operator: ReportLogin,
  input: PlayerInput, directory: string, abort?: AbortSignal) {
  if (!operator.user) throw new Error('Missing the named audit load operator');
  const operatorName = operator.user;
  const observer = standby.connect(), controller = new AbortController();
  const signal = abort ? AbortSignal.any([abort, controller.signal]) : controller.signal;
  let pending: Promise<unknown> | undefined;
  let locked = false;
  try {
    await observer.connect();
    await lockAuditLoadStandbyPageBarrier(observer);
    locked = true;
    pending = exportAuditPlayer(operator, { ...input, limits: { ...input.limits, pageSize: 1 }, signal })
      .then(() => null, error => error);
    const backend = await waitFor(() => findAuditLoadBlockedStandbyPage(observer, operatorName), 3000, signal);
    const partial = (await readdir(directory)).find(file => file.endsWith('.part'));
    const stagedRowObserved = !!partial &&
      (await readFile(join(directory, partial), 'utf8')).includes(JSON.stringify(input.filters.accountId));
    // Keep the barrier held until PostgreSQL exits the reader, including its normal statement timeout.
    const { result, cancellationMs, databaseReaderStopMs } = await measureStandbyReaderStop(observer, backend,
      { controller, pending, observationMs: 7000, signal: abort });
    if (!(result instanceof AuditPlayerReportError) || !result.jobId) throw new Error('Missing cancelled active standby job');
    const journal = await audit.prepare(`SELECT status,reason,reader_route,row_count::text,byte_count::text
      FROM audit_export_jobs WHERE id=? AND operator_name=? AND dataset_id=?`).get(result.jobId, operatorName, input.datasetId);
    const attempt = await exportAuditPlayer(operator, { ...input, fixtureStandbyPort: undefined, signal: abort })
      .then(() => null, error => error);
    const slotRetainedUntilDrain = attempt instanceof AuditPlayerReportError && attempt.code === 'report-busy' && attempt.jobId === null;
    await waitForStandbyDrain(standby, audit, result.jobId, abort);
    const files = await readdir(directory);
    return { blockedQueryObserved: true, stagedRowObserved, readerStopped: true, cancellationMs, databaseReaderStopMs,
      journalCancelled: result.code === 'cancelled' && journal?.status === 'cancelled' && journal.reason === 'cancelled' &&
        journal.reader_route === 'standby' && journal.row_count === '0' && journal.byte_count === '0',
      noPartialOutput: files.length === 1 && files[0] === 'player.csv', slotRetainedUntilDrain };
  } finally {
    controller.abort();
    try { if (locked) await unlockAuditLoadStandbyPageBarrier(observer); }
    finally {
      await observer.end();
      await pending;
    }
  }
}

/** The benchmark always owns its embedded PostgreSQL and takes no database connection input. */
export async function runAuditLoad(input: LoadOptions = defaults, signal?: AbortSignal) {
  const options = loadOptions(input);
  signal?.throwIfAborted();
  const cluster = await temporaryDatabase();
  const loopbackAgent = new Agent({ keepAlive: true, maxSockets: options.workers, proxyEnv: {} });
  let directory: string | undefined, game: PostgresDatabase | undefined, audit: PostgresDatabase | undefined;
  let standby: Standby | undefined;
  let reportConsumer: Awaited<ReturnType<typeof startAuditLoadReportConsumer>> | undefined;
  let walletHttp: Awaited<ReturnType<typeof startAuditLoadWallet>> | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-'));
    const config = databaseConfig({ ...cluster.env, PGPOOL_MAX: '8' });
    game = new PostgresDatabase('test_audit_load_game', { config });
    audit = new PostgresDatabase('test_audit_load', { config });
    walletHttp = await startAuditLoadWallet(cluster.env, signal);
    const makeWorkers = (): LoadPlayers[] => Array.from({ length: options.workers }, () => [randomUUID(), randomUUID(), randomUUID()]);
    const baselineWorkers = makeWorkers(), activeWorkers = makeWorkers(), reportAccount = randomUUID();
    const controlWorkers = options.pilotGate ? makeWorkers() : [];
    const replayPair: Pair | null = options.replayFirst ? [randomUUID(), randomUUID()] : null;
    const scaleAccounts = options.scaleHistory
      ? Array.from({ length: options.mixedHistory ? mixedHistoryAccountCount : 2 }, () => randomUUID()) : null;
    const players = [...baselineWorkers.flat(), ...activeWorkers.flat(), ...controlWorkers.flat()];
    const accounts = [...players, reportAccount,
      ...(scaleAccounts ?? []), ...(replayPair ?? [])];
    const wallet = new DemoWalletStore(game, () => 0), pvp = new VirtualPvpLedger(game, wallet);
    for (const accountId of accounts) {
      await game.prepare('INSERT INTO accounts(id,email,name,password,created_at) VALUES (?,?,?,?,?)')
        .run(accountId, accountId + '@example.invalid', 'Audit fixture', '', 0);
      await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: Number(initialCents / 100n) });
    }
    const tokens = new Map<string, string>();
    for (const accountId of players) {
      const token = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      await game.prepare('INSERT INTO sessions(hash,account_id,expires) VALUES (?,?,?)')
        .run(hash, accountId, Date.now() + 60 * 60_000);
      tokens.set(accountId, token);
    }
    const http = walletHttp;
    const baseline = await workload(game, pvp, http.baseUrl, loopbackAgent, tokens, baselineWorkers, options.roundsPerWorker, signal);
    const sources = { game: game.schema };
    const { datasetId, startedAtMs, environment } = await new AuditDatasets(audit, sources).startTest();
    const group = 'audit_load_read', reader = 'audit_load_player', summaryReader = 'audit_load_summary';
    const wideReader = 'audit_load_wide', limitReader = 'audit_load_limit', password = randomUUID();
    const replayReader = 'audit_load_replay', detailReader = 'audit_load_detail';
    const readers = [reader, summaryReader, ...(scaleAccounts ? [wideReader, limitReader] : []),
      ...(replayPair ? [replayReader, detailReader] : [])];
    await audit.exec('CREATE ROLE ' + group + ' NOLOGIN');
    for (const name of readers) {
      await audit.exec(`CREATE ROLE ${name} LOGIN PASSWORD '${password}';
        GRANT ${group} TO ${name};
        ALTER ROLE ${name} SET temp_file_limit='${reportTempFileLimit}'`);
    }
    await installAuditReportAccess(audit, group);
    if (options.standbyPgBasebackup) await grantAuditLoadStandbyReports(audit, group);
    await installAuditPlayerReport(audit, group, sources);
    await installAuditSummaryReport(audit, group, sources);
    for (const name of readers) {
      await audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(name, datasetId, game.schema + '.demo_ledger');
    }
    const operator = (name: string) => databaseConfig({ ...cluster.env, PGUSER: name, PGPASSWORD: password, PGPOOL_MAX: '2' });
    const before = await sizes(audit, game);
    const retained = options.retainedHistoryRows !== undefined && scaleAccounts ? await seedRetainedAuditHistory(game, {
      rows: options.retainedHistoryRows, beforeMs: auditMixedHistoryPeriod(startedAtMs, true).fromMs,
      playerAccount: scaleAccounts[0], playerOpeningUnits: Number(initialCents),
    }, signal) : null;
    const mixedHistory = options.mixedHistory && scaleAccounts
      ? await seedMixedAuditHistory(game, scaleAccounts, startedAtMs, scalePlayerRows, Number(initialCents), retained ?? undefined) : null;
    const widePeriod = mixedHistory ? { fromMs: mixedHistory.fromMs, toMs: mixedHistory.toMs } :
      scaleAccounts ? await seedScaleHistory(game, scaleAccounts[0], scaleAccounts[1], startedAtMs) : null;
    if (widePeriod) {
      // Keep the live workload in a separate narrow interval even if the fixture is seeded within two milliseconds.
      await waitFor(async () => Date.now() >= widePeriod.toMs ? true : undefined, 2000, signal);
      await game.exec('ANALYZE demo_ledger');
      await audit.exec('ANALYZE audit_posting_refs');
    }
    const replayFixture = replayPair ? await seedAuditLoadReplay(game, audit, pvp, { datasetId, environment }, replayPair) : null;
    if (replayFixture) {
      await installAuditReplayReport(audit, group, sources);
      await installAuditDetailReport(audit, group, sources);
    }
    for (let i = 0; i < options.seedRounds; i++) await wallet.operate(reportAccount, playRequest());
    standby = options.standbyPgBasebackup ? await startAuditLoadStandby(options.standbyPgBasebackup, cluster.env, signal) : undefined;
    const initialStandby = standby ? await verifyStandby(standby, audit, signal) : null;
    let standbyBeforeControl = options.controlAfterReports ? null : initialStandby;
    reportConsumer = options.reportProcess ? await startAuditLoadReportConsumer(signal) : undefined;
    let control: Awaited<ReturnType<typeof workload>> | null = null, controlActivity: Activity | null = null;
    let standbyControlActivity: Activity | null = null;
    let controlNodeCpu: NodeJS.CpuUsage | null = null;
    const runControl = async () => {
      if (standby && !standbyBeforeControl) standbyBeforeControl = await verifyStandby(standby, audit!, signal);
      const beforeControl = await databaseActivity(audit!, game!);
      const standbyControl = standby ? await standbyActivity(standby) : null;
      const beforeControlCpu = process.cpuUsage();
      await http.startCapture(datasetId);
      const measured = await workload(game!, pvp, http.baseUrl, loopbackAgent, tokens, controlWorkers, options.roundsPerWorker, signal);
      await http.stopCapture();
      controlNodeCpu = process.cpuUsage(beforeControlCpu);
      controlActivity = activityDelta(beforeControl, await databaseActivity(audit!, game!));
      if (standby && standbyControl) standbyControlActivity = activityDelta(standbyControl, await standbyActivity(standby));
      return measured;
    };
    if (options.pilotGate && !options.controlAfterReports) control = await runControl();
    const beforeReports = options.pilotGate ? await databaseActivity(audit, game) : null;
    const standbyBeforeReports = standby ? await standbyActivity(standby) : null;
    const beforeReportsCpu = process.cpuUsage();
    await http.startCapture(datasetId);
    const period = { fromMs: widePeriod?.toMs ?? startedAtMs, toMs: Date.now() + 60_000 };
    // The narrow report uses seeded rows in both phase orders. Only the paired wallets vary during the run.
    const narrowFilters = options.pilotGate ? { ...period, accountId: reportAccount } : period;
    const reportInput = { schema: audit.schema, datasetId, signal, fixtureStandbyPort: standby?.port,
      filters: { accountId: scaleAccounts?.[0] ?? reportAccount, ...(widePeriod ?? period) },
      destination: join(directory, 'player.csv'), limits: scaleAccounts ? undefined : { pageSize: 1 } };
    const observeTiming = async <T>(work: () => Promise<T>) => {
      const from = auditLoadMonotonicMs(), result = await work();
      return { from, to: auditLoadMonotonicMs(), result };
    };
    const drainAfterReport = async <T extends { result: { jobId: string } }>(pending: Promise<T>) => {
      const result = await pending.catch(async (error: unknown) => {
        if (standby && error instanceof AuditPlayerReportError && error.jobId) {
          await waitForStandbyDrain(standby, audit!, error.jobId, signal);
        }
        throw error;
      });
      if (standby) await waitForStandbyDrain(standby, audit!, result.result.jobId, signal);
      return result;
    };
    const wireScope = { schema: audit.schema, datasetId, fixtureStandbyPort: standby?.port };
    const reportScope = { ...wireScope, signal };
    const rawSummary = (name: string, filters: typeof period) => drainAfterReport(reportConsumer
      ? reportConsumer.summary(operator(name), { ...wireScope, filters })
      : observeTiming(() => readAuditSummary(operator(name), { ...reportScope, filters })));
    const readSummary = (name: string, filters: typeof period, description: string) =>
      rawSummary(name, filters).catch(error => throwReportFailure(description, error));
    const { signal: _playerSignal, ...wirePlayer } = reportInput;
    const startPlayer = () => drainAfterReport(reportConsumer ? reportConsumer.player(operator(reader), wirePlayer) :
      observeTiming(() => exportAuditPlayer(operator(reader), reportInput))).catch(error => throwReportFailure('player CSV', error));
    const limitPeriod = widePeriod ? { ...widePeriod, toMs: widePeriod.toMs - 1 } : null;
    const startLimit = () => limitPeriod ? readSummary(limitReader, limitPeriod, 'at-limit summary') : null;
    const replayInput = replayFixture ? { ...wireScope, filters: { replayId: replayFixture.replayId },
      destination: join(directory, 'replay.json') } : null;
    const firstReplay = replayInput ? drainAfterReport(reportConsumer ? reportConsumer.replay(operator(replayReader), replayInput) :
      observeTiming(() => exportAuditReplay(operator(replayReader), { ...replayInput, signal })))
      .catch(error => throwReportFailure('replay', error)) : null;
    const firstPlayer = options.summaryFirst || firstReplay ? null : startPlayer();
    const firstLimit = options.summaryFirst ? startLimit() : null;
    const first = firstPlayer ?? firstLimit ?? firstReplay;
    if (!first) throw new Error('Missing first isolated audit report');
    // Keep the first report rejection controlled while waiting for a real reader backend.
    void first.catch(() => {});
    let firstQueryObserved = false;
    try {
      if (options.pilotGate) {
        firstQueryObserved = await observeActiveReport(audit, standby, firstReplay ? replayReader : options.summaryFirst ? limitReader : reader,
          firstReplay ? 'replay' : options.summaryFirst ? 'summary' : 'player', signal);
      } else {
        await waitFor(async () => (await readdir(directory!)).some(file => file.endsWith('.part')) ? true : undefined, 2000, signal);
      }
    } catch (error) {
      await first;
      throw error;
    }
    const remainingReports = async () => {
      const replay = await firstReplay;
      const initialLimit = await firstLimit;
      const csv = await (firstPlayer ?? startPlayer());
      const summary = await readSummary(summaryReader, narrowFilters, 'narrow summary');
      const atLimit = initialLimit ?? await startLimit();
      const wide = widePeriod ? await observeTiming(() => rejectOversizedSummary(audit!, { ...reportScope, filters: widePeriod },
        wideReader, () => rawSummary(wideReader, widePeriod))).catch(error => throwReportFailure('oversized summary', error)) : null;
      return { csv, summary, atLimit, wide, replay };
    };
    const [activeResult, reportsResult] = await Promise.allSettled([
      workload(game, pvp, http.baseUrl, loopbackAgent, tokens, activeWorkers, options.roundsPerWorker, signal),
      remainingReports(),
    ]);
    if (activeResult.status === 'rejected') throw activeResult.reason;
    if (reportsResult.status === 'rejected') throw reportsResult.reason;
    const { value: active } = activeResult, { value: { csv, summary, atLimit, wide, replay } } = reportsResult;
    await http.stopCapture();
    const reportsNodeCpu = process.cpuUsage(beforeReportsCpu);
    const reportActivity = beforeReports ? activityDelta(beforeReports, await databaseActivity(audit, game)) : null;
    const standbyReportActivity = standby && standbyBeforeReports ? activityDelta(standbyBeforeReports, await standbyActivity(standby)) : null;
    const standbyAfterReports = standby ? await verifyStandby(standby, audit, signal) : null;
    if (options.controlAfterReports) control = await runControl();
    await reportConsumer?.close();
    const jobOrder = options.summaryFirst ? [limitReader, reader, summaryReader, wideReader]
      : [...(replayFixture ? [replayReader] : []), reader, summaryReader, ...(scaleAccounts ? [limitReader, wideReader] : [])];
    const jobs = await audit.prepare(`SELECT operator_name,status,reason,started_at,finished_at,reader_route,standby_drained_at FROM audit_export_jobs
      WHERE dataset_id=? AND operator_name=ANY(?::name[]) ORDER BY started_at,finished_at,id`).all(datasetId, jobOrder);
    const serialVerified = jobs.length === jobOrder.length && jobs.every((job, index) => {
      const previous = jobs[index - 1];
      return job.operator_name === jobOrder[index] && job.finished_at !== null &&
        (standby ? job.reader_route === 'standby' && job.standby_drained_at !== null : job.reader_route === 'primary') &&
        (!previous || previous.finished_at <= job.started_at) &&
        (job.operator_name === wideReader ? job.status === 'failed' && job.reason === 'scan-limit' : job.status === 'succeeded');
    });
    let replayVerified = true;
    let detail: { elapsedMs: number; verified: boolean } | null = null;
    if (replay && replayInput && replayFixture) {
      const data = await readFile(replayInput.destination, 'utf8');
      const exported = verifyReplayPackage(JSON.parse(data));
      replayVerified = exported.status === 'verified' && exported.value.manifest.sha256 === replayFixture.checksum &&
        replay.result.engineVerified && replay.result.coverage === 'complete' && replay.result.environment === 'test' &&
        replay.result.replayId === replayFixture.replayId && replay.result.datasetId === datasetId &&
        replay.result.rowCount === replayFixture.events && replay.result.bytes === Buffer.byteLength(data);
      await rm(replayInput.destination);
      const { from, to, result } = await observeTiming(() => readAuditDetail(operator(detailReader), {
        schema: audit!.schema, datasetId, signal,
        filters: { source: replayFixture.payout.namespace, postingId: replayFixture.payout.rowId },
      }));
      detail = { elapsedMs: rounded(to - from), verified: result.status === 'found' &&
        result.anchor?.category === 'pvp' && result.anchor.movement === 'payout' && result.anchor.amountUnits === '1900' &&
        result.outcome?.kind === 'pvp-bank' && result.outcome.state === 'settled' && result.outcome.feeUnits === '100' };
    }
    const stopped = await waitFor(async () => await audit!.prepare(
      "SELECT 1 FROM pg_stat_activity WHERE application_name='royal/audit-attempts' LIMIT 1").get() ? undefined : true, 1000, signal);
    const cancellation = await cancelReport(game, audit, operator(reader),
      { ...reportInput, fixtureStandbyPort: undefined, destination: join(directory, 'cancelled.csv') }, directory, signal);
    const replayCancellation = standby ? await cancelStandbyReplayWait(standby, audit, operator(reader),
      { ...reportInput, destination: join(directory, 'cancelled-standby.csv') }, directory, signal) : null;
    const after = await sizes(audit, game), records = await recordSizes(audit, datasetId);
    // The barrier is installed after both wallet phases and their database counters are final.
    if (standby) await installAuditLoadStandbyPageBarrier(audit, group);
    const activeCancellation = standby ? await cancelActiveStandbyReport(standby, audit, operator(reader),
      { ...reportInput, destination: join(directory, 'cancelled-active-standby.csv') }, directory, signal) : null;
    const captureGaps = (await audit.prepare('SELECT COALESCE(sum(missing_count),0)::text AS n FROM audit_attempt_capture_gaps WHERE dataset_id=?')
      .get(datasetId))!.n;
    const overlap = (window: { from: number; to: number }, metric: Metric) =>
      active.samples[metric].filter(sample => sample.from < window.to && sample.to > window.from).length;
    const reportOverlap = (window: { from: number; to: number }) => ({
      overlappingStakeCalls: overlap(window, 'stake'),
      overlappingSettlementCalls: overlap(window, 'settlement'),
      overlappingCasinoCalls: overlap(window, 'casinoRound'),
    });
    const replayReport = replay && replayFixture ? { events: replay.result.rowCount, fragments: replayFixture.fragments,
      bytes: replay.result.bytes, elapsedMs: rounded(replay.to - replay.from), engineVerified: replay.result.engineVerified,
      verified: replayVerified, ...reportOverlap(replay) } : null;
    const report = { player: { rows: csv.result.rowCount, bytes: csv.result.bytes, elapsedMs: rounded(csv.to - csv.from),
      ...reportOverlap(csv) },
    summary: { rows: summary.result.rows.length, scanned: summary.result.scanned, elapsedMs: rounded(summary.to - summary.from),
      ...reportOverlap(summary) },
    ...(replayReport && detail ? { replay: replayReport, detail } : {}),
    admission: { serialVerified, order: jobs.map(job => job.operator_name) } };
    let scale: { fixturePostings: number; capturedFixturePostings: number; reportTempFileLimit: string;
      csvAmountsAndBalancesMatch: boolean;
      mixedHistory?: Pick<Awaited<ReturnType<typeof seedMixedAuditHistory>>, 'accountCount' | 'timestampCount' | 'totals'>;
      atLimit: { scanned: number; elapsedMs: number; exactTotal: boolean } & ReturnType<typeof reportOverlap>;
      overLimit: { outcome: string; journalRejected: boolean; elapsedMs: number } & ReturnType<typeof reportOverlap>;
      ok: boolean } | null = null;
    if (widePeriod && atLimit && wide && scaleAccounts) {
      const fixturePostings = AUDIT_SUMMARY_SCAN_CAP + 1;
      const distribution = mixedHistory ? ',count(DISTINCT account_id)::int AS account_count,count(DISTINCT occurred_at_ms)::int AS timestamp_count' : '';
      const captured = await audit.prepare(`SELECT count(*)::int AS n,min(occurred_at_ms)::text AS first_at,
        max(occurred_at_ms)::text AS last_at${distribution} FROM audit_posting_refs
        WHERE dataset_id=? AND occurred_at_ms>=? AND occurred_at_ms<?`).get(datasetId, widePeriod.fromMs, widePeriod.toMs);
      const distributionMatches = !mixedHistory || (captured?.account_count === mixedHistory.accountCount &&
        captured.timestamp_count === mixedHistory.timestampCount);
      const boundsMatch = !retained || (captured?.first_at === String(widePeriod.fromMs) && captured.last_at === String(widePeriod.toMs - 1));
      const totals = atLimit.result.rows[0];
      const exactTotal = mixedHistory ? matchesMixedHistoryTotals(atLimit.result, mixedHistory.totals) :
        atLimit.result.rows.length === 1 && totals.movement_type === 'deposit' &&
        totals.posting_count === String(AUDIT_SUMMARY_SCAN_CAP) && totals.amount_units === String(AUDIT_SUMMARY_SCAN_CAP * 100) &&
        totals.coverage_status === 'complete';
      const csvAmountsAndBalancesMatch = await verifyScaleCsv(reportInput.destination, scaleAccounts[0],
        mixedHistory?.playerPostings, !!retained);
      scale = { fixturePostings, capturedFixturePostings: Number(captured?.n), reportTempFileLimit, csvAmountsAndBalancesMatch,
        ...(mixedHistory ? { mixedHistory: { accountCount: Number(captured?.account_count), timestampCount: Number(captured?.timestamp_count),
          totals: mixedHistory.totals } } : {}),
        atLimit: { scanned: atLimit.result.scanned, elapsedMs: rounded(atLimit.to - atLimit.from), exactTotal, ...reportOverlap(atLimit) },
        overLimit: { ...wide.result, elapsedMs: rounded(wide.to - wide.from), ...reportOverlap(wide) },
        ok: captured?.n === fixturePostings && distributionMatches && boundsMatch && csvAmountsAndBalancesMatch &&
          atLimit.result.scanned === AUDIT_SUMMARY_SCAN_CAP && exactTotal && wide.result.journalRejected };
    }
    const retainedHistory = retained && scaleAccounts && widePeriod
      ? await verifyRetainedAuditHistory(audit, game, datasetId, scaleAccounts[0], retained, widePeriod) : null;
    const expectedAttempts = options.workers * options.roundsPerWorker * 2 * (control ? 2 : 1);
    const casinoBalances = new Map([...(control?.casinoBalances ?? []), ...active.casinoBalances]);
    const casinoAttemptsVerified = active.casinoBalancesVerified && (control?.casinoBalancesVerified ?? true) &&
      casinoBalances.size * 2 === expectedAttempts &&
      await verifyCasinoAttempts(audit, datasetId, game.schema + '.demo_ledger', casinoBalances);
    const expectedPostings = active.expectedPostings + (control?.expectedPostings ?? 0) +
      options.seedRounds * 2 + (scale?.fixturePostings ?? 0) + (replayFixture?.postings ?? 0) + (retained?.rows ?? 0);
    const csvMatches = csv.result.rowCount === (scaleAccounts ? scalePlayerRows : options.seedRounds * 2) &&
      (await stat(reportInput.destination)).size === csv.result.bytes;
    const firstReport = options.replayFirst ? 'replay' : options.summaryFirst ? 'at-limit-summary' : 'player';
    const firstReportOverlap = options.replayFirst ? replayReport : options.summaryFirst ? scale?.atLimit : report.player;
    const overlappingCasinoCalls = firstReportOverlap?.overlappingCasinoCalls ?? 0;
    const observedOverlap = !!firstReportOverlap && firstReportOverlap.overlappingStakeCalls > 0 &&
      firstReportOverlap.overlappingSettlementCalls > 0 && overlappingCasinoCalls > 0;
    const captureOk = stopped && records.postingRefs.rows === expectedPostings &&
      records.attemptPayloads.rows === expectedAttempts && captureGaps === '0' && casinoAttemptsVerified;
    const cancellationOk = cancellation.outcome === 'cancelled' && cancellation.noPartialOutput &&
      cancellation.readerStopped && cancellation.journalCancelled && (replayCancellation === null ||
        (replayCancellation.journalCancelled && replayCancellation.noPartialOutput)) && (activeCancellation === null ||
        (activeCancellation.stagedRowObserved && activeCancellation.journalCancelled && activeCancellation.noPartialOutput &&
          activeCancellation.slotRetainedUntilDrain));
    const readerStopMs = standby ? activeCancellation?.databaseReaderStopMs ?? null : cancellation.databaseReaderStopMs;
    const budget = assessBudget(options.budget, { stakeP95Ms: active.metrics.stake.p95Ms,
      settlementP95Ms: active.metrics.settlement.p95Ms, readerStopMs });
    const readerStopTarget = standby ? 'standby-active-query' : 'primary-active-query';
    const pilot = control ? assessAuditPilotGate(control.metrics, active.metrics) : null;
    const pilotPassed = pilot ? pilot.ok && firstQueryObserved && observedOverlap && serialVerified : true;
    const postgres = (await audit.prepare('SHOW server_version').get())!.server_version as string;
    const narrowSummaryMatches = options.pilotGate ? report.summary.scanned === options.seedRounds * 2
      : report.summary.scanned >= options.seedRounds * 2;
    return { schemaVersion: 1, environment: 'isolated-local-postgresql', capacityConfirmed: false,
      ok: baseline.noDoubleMoney && active.noDoubleMoney && captureOk && csvMatches && observedOverlap && serialVerified && cancellationOk &&
        narrowSummaryMatches && (scale?.ok ?? true) && (retainedHistory?.ok ?? true) && (budget?.ok ?? true) &&
        (control?.noDoubleMoney ?? true) && replayVerified && (detail?.verified ?? true) && pilotPassed,
      runtime: { node: process.version, postgres, platform: process.platform, architecture: process.arch },
      transport: { casino: 'authenticated-http', pvp: 'ledger' },
      workload: { workers: options.workers, roundsPerWorker: options.roundsPerWorker, seedRounds: options.seedRounds },
      ...(retainedHistory ? { retainedHistory } : {}),
      ...(scale ? { scale } : {}), ...(budget ? { budget: {
        ...budget, ...(options.budget?.readerStopMs === undefined ? {} : { readerStopTarget }),
      } } : {}),
      ...(control && pilot ? {
        withAuditWithoutReports: { metrics: control.metrics, elapsedMs: control.elapsedMs,
          noDoubleMoney: control.noDoubleMoney, postings: control.actualPostings },
        pilotGate: { ...pilot, ok: pilotPassed, firstReport, firstQueryObserved, observedOverlap, overlappingCasinoCalls,
          phaseOrder: options.controlAfterReports ? ['with-reports', 'without-reports'] : ['without-reports', 'with-reports'],
          databaseActivity: { withoutReports: controlActivity, withReports: reportActivity } },
      } : {}),
      ...(options.pilotGate ? { nodeCpuMicros: { withoutReports: controlNodeCpu, withReports: reportsNodeCpu } } : {}),
      ...(reportConsumer ? { reportProcess: { sameHost: true, idleDuringControl: true, ...reportConsumer.metrics() } } : {}),
      ...(standbyBeforeControl && standbyAfterReports ? { standby: { sameHost: true,
        beforeControl: standbyBeforeControl, afterReports: standbyAfterReports,
        databaseActivity: { withoutReports: standbyControlActivity, withReports: standbyReportActivity },
        lockCancellationTarget: 'primary', replayCancellation, activeCancellation,
      } } : {}),
      baseline: { metrics: baseline.metrics, elapsedMs: baseline.elapsedMs, noDoubleMoney: baseline.noDoubleMoney, postings: baseline.actualPostings },
      withAudit: { metrics: active.metrics, elapsedMs: active.elapsedMs, noDoubleMoney: active.noDoubleMoney, postings: active.actualPostings },
      reports: report, cancellation, capture: { stopped, expectedAttempts, expectedPostings, gaps: Number(captureGaps),
        casinoAttemptsVerified, ...records },
      disk: { before, after, growth: { databaseBytes: after.databaseBytes - before.databaseBytes,
        gameLedgerBytes: after.gameLedgerBytes - before.gameLedgerBytes, auditRelationsBytes: after.auditRelationsBytes - before.auditRelationsBytes } } };
  } finally {
    loopbackAgent.destroy();
    try {
      await Promise.allSettled([walletHttp?.close(), reportConsumer?.close()]).then(outcomes => {
        const failed = outcomes.find(outcome => outcome.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      });
    } finally {
      try { await Promise.all([game?.close(), audit?.close()]); }
      finally {
        try {
          await standby?.stop();
          if (directory) await rm(directory, { recursive: true, force: true });
        }
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
      'scale-history': { type: 'boolean' }, 'mixed-history': { type: 'boolean' }, 'pilot-gate': { type: 'boolean' },
      'retained-history-rows': { type: 'string' },
      'summary-first': { type: 'boolean' }, 'replay-first': { type: 'boolean' },
      'control-after-reports': { type: 'boolean' },
      'report-process': { type: 'boolean' },
      'standby-pg-basebackup': { type: 'string' },
      'stake-p95-budget-ms': { type: 'string' }, 'settlement-p95-budget-ms': { type: 'string' },
      'reader-stop-budget-ms': { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('node --import tsx scripts/audit-load.ts [--workers 1..8] [--rounds 2..16] [--seed 8..40] [--scale-history] [--mixed-history] [--pilot-gate] [--summary-first | --replay-first] [--report-process]\n' +
        '  [--control-after-reports] [--standby-pg-basebackup /path/to/pg_basebackup] [--stake-p95-budget-ms n]\n' +
        '  [--settlement-p95-budget-ms n] [--reader-stop-budget-ms n] [--retained-history-rows 1..1000000]');
      exitCode = 0;
    } else {
      const budget: Budget = {};
      if (values['stake-p95-budget-ms'] !== undefined) budget.stakeP95Ms = Number(values['stake-p95-budget-ms']);
      if (values['settlement-p95-budget-ms'] !== undefined) budget.settlementP95Ms = Number(values['settlement-p95-budget-ms']);
      if (values['reader-stop-budget-ms'] !== undefined) budget.readerStopMs = Number(values['reader-stop-budget-ms']);
      const result = await runAuditLoad({ workers: Number(values.workers ?? defaults.workers),
        roundsPerWorker: Number(values.rounds ?? defaults.roundsPerWorker), seedRounds: Number(values.seed ?? defaults.seedRounds),
        scaleHistory: values['scale-history'], mixedHistory: values['mixed-history'], pilotGate: values['pilot-gate'],
        retainedHistoryRows: values['retained-history-rows'] === undefined ? undefined : Number(values['retained-history-rows']),
        summaryFirst: values['summary-first'], replayFirst: values['replay-first'],
        reportProcess: values['report-process'], controlAfterReports: values['control-after-reports'],
        standbyPgBasebackup: values['standby-pg-basebackup'],
        budget: Object.keys(budget).length ? budget : undefined }, controller.signal);
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
