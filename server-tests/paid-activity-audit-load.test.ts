import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assessAuditPilotGate } from '../scripts/audit-load';
import { startAuditLoadWallet } from '../scripts/audit-load-wallet';
import { createAuditLoadLockOwnerIndex } from '../scripts/audit-load-pvp-timing';

const script = fileURLToPath(new URL('../scripts/audit-load.ts', import.meta.url));
const run = (args: string[], env = process.env, execArgs: string[] = []) => promisify(execFile)(
  process.execPath, ['--import', 'tsx', ...execArgs, script, ...args], { env, timeout: 30_000 },
);
const fixtureFiles = async (directory: string) => (await readdir(directory))
  .filter(name => /^royal-(pg|audit-load|audit-standby)-/.test(name));

function assertCapturedWalletAttempts(capture: {
  stopped: boolean; gaps: number; expectedAttempts: number; expectedCasinoAttempts: number; expectedPvpAttempts: number;
  casinoAttemptsVerified: boolean; pvpAttemptsVerified: boolean; attemptPayloads: { rows: number };
  pvpReplays: { expected: number; recorded: number; verified: boolean };
}, auditedPhases: 1 | 2) {
  // Each of the two workers runs three rounds: two cancellations and one resignation.
  assert.equal(capture.expectedCasinoAttempts, 12 * auditedPhases);
  assert.equal(capture.expectedPvpAttempts, 34 * auditedPhases);
  assert.equal(capture.expectedAttempts, 46 * auditedPhases);
  assert.equal(capture.attemptPayloads.rows, 46 * auditedPhases);
  assert.equal(capture.casinoAttemptsVerified, true);
  assert.equal(capture.pvpAttemptsVerified, true);
  assert.deepEqual(capture.pvpReplays, { expected: 2 * auditedPhases, recorded: 2 * auditedPhases, verified: true });
  assert.equal(capture.stopped, true);
  assert.equal(capture.gaps, 0);
}

test('audit load measures both wallet phases, preserves money and stops cancelled database work', { timeout: 35_000 }, async () => {
  const { stdout } = await run(['--workers', '2', '--rounds', '3', '--seed', '40'], {
    ...process.env,
    DATABASE_URL: 'postgresql://forbidden:forbidden@127.0.0.1:1/not-the-fixture',
    DATABASE_URL_FILE: '/nonexistent/royal-load-forbidden-url',
    PGHOST: 'not-the-fixture.invalid', PGPASSWORD_FILE: '/nonexistent/royal-load-forbidden-password',
    NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '',
  });
  const report = JSON.parse(stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.environment, 'isolated-local-postgresql');
  assert.equal(report.capacityConfirmed, false);
  assert.deepEqual(report.transport, { casino: 'authenticated-http', pvp: 'authenticated-websocket' });
  assert.equal(report.ok, true);
  assert.equal(report.scale, undefined);
  assert.equal(report.budget, undefined);
  assert.equal(report.pilotGate, undefined);
  assert.equal(report.pvpTiming, undefined);
  assert.equal(report.withAuditWithoutReports, undefined);
  assert.deepEqual(report.workload, { workers: 2, roundsPerWorker: 3, seedRounds: 40 });
  for (const phase of [report.baseline, report.withAudit]) {
    assert.equal(phase.noDoubleMoney, true);
    assert.equal(phase.postings, 34);
    for (const [name, count] of Object.entries({ stake: 12, settlement: 6, casinoRound: 6, retry: 18 })) {
      const metric = phase.metrics[name];
      assert.equal(metric.attempts, count);
      assert.equal(metric.completed, count);
      assert.equal(metric.errors, 0);
      assert(metric.p95Ms > 0);
    }
  }
  assert.equal(report.reports.player.rows, 80);
  assert(report.reports.player.bytes > 0);
  assert(report.reports.player.overlappingStakeCalls > 0);
  assert(report.reports.player.overlappingSettlementCalls > 0);
  assert(report.reports.summary.scanned >= 80);
  assert.deepEqual(report.reports.admission, { serialVerified: true, order: ['audit_load_player', 'audit_load_summary'] });
  assert.equal(report.cancellation.blockedQueryObserved, true);
  assert.equal(report.cancellation.readerStopped, true);
  assert.equal(report.cancellation.outcome, 'cancelled');
  assert(report.cancellation.databaseReaderStopMs >= report.cancellation.cancellationMs);
  assert.equal(report.cancellation.journalCancelled, true);
  assert.equal(report.cancellation.noPartialOutput, true);
  assertCapturedWalletAttempts(report.capture, 1);
  assert.equal(report.capture.expectedPostings, 114);
  assert.equal(report.capture.postingRefs.rows, 114);
  assert(report.capture.attemptPayloads.averageBytes > 0);
  assert(report.capture.postingRefs.averageBytes > 0);
  for (const name of ['databaseBytes', 'gameLedgerBytes', 'auditRelationsBytes']) {
    assert(report.disk.before[name] > 0);
    assert(report.disk.after[name] > 0);
    assert.equal(report.disk.growth[name], report.disk.after[name] - report.disk.before[name]);
  }
});

test('audit load rejects an oversized workload before provisioning', async () => {
  await assert.rejects(run(['--workers', '9']), error => {
    const failure = error as { code?: number; stderr?: string };
    return failure.code === 1 && JSON.parse(failure.stderr ?? '{}').message === 'Invalid isolated audit load options';
  });
  await assert.rejects(run(['--control-after-reports']), error => {
    const failure = error as { code?: number; stderr?: string };
    return failure.code === 1 && JSON.parse(failure.stderr ?? '{}').message === 'The reversed control phase requires --pilot-gate';
  });
});

test('audit load wallet rejects an external database host or URL before starting the child', async () => {
  const fixtureEnv = { NODE_ENV: 'test', PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: 'royal_test',
    PGUSER: 'postgres', PGPASSWORD: '0'.repeat(64), PGSSLMODE: 'disable' };
  for (const override of [
    { PGHOST: 'production-db.example.invalid' },
    { DATABASE_URL: 'postgresql://reviewer@production-db.example.invalid/royal' },
  ]) {
    await assert.rejects(startAuditLoadWallet({ ...fixtureEnv, ...override }),
      { message: 'Expected credentials for the disposable audit wallet database' });
  }
});

test('retained history requires the mixed pilot and a bounded row count', async () => {
  for (const args of [
    ['0', '--mixed-history', '--pilot-gate'],
    ['1000001', '--mixed-history', '--pilot-gate'],
    ['2000', '--mixed-history'],
    ['2000', '--pilot-gate'],
  ]) {
    await assert.rejects(run(['--retained-history-rows', ...args]), error => {
      const failure = error as { code?: number; stderr?: string };
      return failure.code === 1 && JSON.parse(failure.stderr ?? '{}').message ===
        'Retained audit history requires --mixed-history, --pilot-gate and 1..1000000 rows';
    });
  }
});

test('audit load verifies both report limits, exact CSV balances and concurrent money at scale', { timeout: 35_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout } = await run(['--workers', '2', '--rounds', '3', '--scale-history',
    '--stake-p95-budget-ms', '60000', '--settlement-p95-budget-ms', '60000', '--reader-stop-budget-ms', '60000'],
  { ...process.env, TMPDIR: directory });
  assert.deepEqual(await fixtureFiles(directory), []);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.capacityConfirmed, false);
  assert.equal(report.baseline.noDoubleMoney, true);
  assert.equal(report.withAudit.noDoubleMoney, true);
  assert.equal(report.withAudit.postings, 34);
  assert.equal(report.reports.player.rows, 10_000);
  assert(report.reports.player.overlappingStakeCalls > 0);
  assert(report.reports.player.overlappingSettlementCalls > 0);
  assert(report.reports.summary.scanned >= 80 && report.reports.summary.scanned <= 114);
  assert.equal(report.scale.fixturePostings, 20_001);
  assert.equal(report.scale.capturedFixturePostings, 20_001);
  assert.equal(report.scale.mixedHistory, undefined);
  assert.equal(report.scale.csvAmountsAndBalancesMatch, true);
  assert.equal(report.scale.atLimit.scanned, 20_000);
  assert.equal(report.scale.atLimit.exactTotal, true);
  assert.equal(report.scale.overLimit.outcome, 'scan-limit');
  assert.equal(report.scale.overLimit.journalRejected, true);
  assert.deepEqual(report.reports.admission, { serialVerified: true,
    order: ['audit_load_player', 'audit_load_summary', 'audit_load_limit', 'audit_load_wide'] });
  assert.equal(report.capture.postingRefs.rows, 20_115);
  assertCapturedWalletAttempts(report.capture, 1);
  assert.equal(report.cancellation.noPartialOutput, true);
  assert.equal(report.budget.ok, true);
  assert.equal(report.budget.readerStopTarget, 'primary-active-query');
  assert.equal(report.budget.checks.find(({ metric }: { metric: string }) => metric === 'readerStopMs').actual,
    report.cancellation.databaseReaderStopMs);
  assert.deepEqual(report.budget.checks.map(({ metric, passed }: { metric: string; passed: boolean }) => [metric, passed]),
    [['stakeP95Ms', true], ['settlementP95Ms', true], ['readerStopMs', true]]);
});

test('audit load returns a failed budget result and disposes of its fixture', { timeout: 35_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(run(['--workers', '2', '--rounds', '3', '--reader-stop-budget-ms', '1'],
    { ...process.env, TMPDIR: directory }), error => {
    const failure = error as { code?: number; stdout?: string };
    assert.equal(failure.code, 1);
    const report = JSON.parse(failure.stdout ?? '{}');
    assert.equal(report.ok, false);
    assert.equal(report.withAudit.noDoubleMoney, true);
    assertCapturedWalletAttempts(report.capture, 1);
    assert.equal(report.budget.ok, false);
    assert.equal(report.budget.readerStopTarget, 'primary-active-query');
    assert.deepEqual(report.budget.checks, [{ metric: 'readerStopMs',
      actual: report.cancellation.databaseReaderStopMs, limit: 1, passed: false }]);
    return true;
  });
  assert.deepEqual(await fixtureFiles(directory), []);
});

test('audit load rejects an invalid budget before provisioning', async () => {
  await assert.rejects(run(['--stake-p95-budget-ms', '0']), error => {
    const failure = error as { code?: number; stderr?: string };
    return failure.code === 1 && JSON.parse(failure.stderr ?? '{}').message === 'Invalid isolated audit load budget';
  });
});

test('pilot comparison accepts the exact 10 percent boundary and rejects p95 growth or incomplete wallet work', () => {
  const metric = (p95Ms: number, completed = 8) => ({ p95Ms, attempts: 8, completed, errors: 8 - completed });
  const control = { stake: metric(10), settlement: metric(7), casinoRound: metric(20), retry: metric(8) };
  const within = { ...control, stake: metric(11), settlement: metric(7.7), casinoRound: metric(22) };
  const pass = assessAuditPilotGate(control, within);
  assert.equal(pass.ok, true);
  assert.equal(pass.noWalletErrorsOrTimeouts, true);
  assert.deepEqual(pass.p95.map(check => [check.metric, check.growthPercent, check.passed]),
    [['stake', 10, true], ['settlement', 10, true], ['casinoRound', 10, true]]);

  const slow = assessAuditPilotGate(control, { ...within, settlement: metric(7.701) });
  assert.equal(slow.ok, false);
  assert.equal(slow.noWalletErrorsOrTimeouts, true);
  assert.equal(slow.p95[1].passed, false);
  const slowCasino = assessAuditPilotGate(control, { ...within, casinoRound: metric(22.001) });
  assert.equal(slowCasino.ok, false);
  assert.equal(slowCasino.noWalletErrorsOrTimeouts, true);
  assert.deepEqual(slowCasino.p95.map(check => [check.metric, check.passed]),
    [['stake', true], ['settlement', true], ['casinoRound', false]]);
  const failed = assessAuditPilotGate(control, { ...within, retry: metric(8, 7) });
  assert.equal(failed.ok, false);
  assert.equal(failed.noWalletErrorsOrTimeouts, false);
  assert(failed.p95.every(check => check.passed));
});

test('holder attribution requires a unique BEGIN window for the exact backend', () => {
  const owners = createAuditLoadLockOwnerIndex();
  owners.record(20, 100, 102, 'pvp-command');
  owners.record(20, 101, 104, 'pvp-sync');
  owners.record(21, 100, 104, 'pvp-sweep');
  assert.equal(owners.find({ pid: 20, transactionStartMs: 100.25 }), 'pvp-command');
  assert.equal(owners.find({ pid: 20, transactionStartMs: 101.25 }), undefined);
  assert.equal(owners.find({ pid: 20, transactionStartMs: 102 }), 'pvp-sync');
  assert.equal(owners.find({ pid: 21, transactionStartMs: 101.25 }), 'pvp-sweep');
  assert.equal(owners.find({ pid: 22, transactionStartMs: 101.25 }), undefined);
  assert.equal(owners.find({ pid: 20, transactionStartMs: 104 }), undefined);
});


test('summary-first pilot starts wallets against the observed boundary query and completes all reports in one slot', { timeout: 35_000 }, async () => {
  const stdout = await run(['--pilot-gate', '--summary-first', '--report-process', '--workers', '2', '--rounds', '3'])
    .then(result => result.stdout, error => {
      if (error.code !== 1 || !error.stdout) throw error;
      return String(error.stdout);
    });
  const report = JSON.parse(stdout);
  assert.equal(report.pilotGate.firstReport, 'at-limit-summary');
  assert.equal(report.reportProcess.sameHost, true);
  assert.equal(report.reportProcess.idleDuringControl, true);
  assert.equal(report.reportProcess.requests, 4);
  assert(report.reportProcess.userCpuMicros > 0);
  assert.equal(report.pilotGate.firstQueryObserved, true);
  assert(report.pilotGate.overlappingCasinoCalls > 0);
  assert(report.scale.atLimit.overlappingStakeCalls > 0);
  assert.equal(report.scale.atLimit.exactTotal, true);
  assert.deepEqual(report.reports.admission, { serialVerified: true,
    order: ['audit_load_limit', 'audit_load_player', 'audit_load_summary', 'audit_load_wide'] });
  assert.equal(report.reports.player.rows, 10_000);
  assert.equal(report.scale.overLimit.outcome, 'scan-limit');
  assertCapturedWalletAttempts(report.capture, 2);
});

test('mixed history verifies exact category totals, commissions and the focused CSV in the pilot', { timeout: 35_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout, exitCode } = await run(['--mixed-history', '--pilot-gate', '--summary-first', '--report-process',
    '--workers', '2', '--rounds', '3', '--seed', '8'], { ...process.env, TMPDIR: directory })
    .then(result => ({ stdout: result.stdout, exitCode: 0 }), error => {
      if (error.code !== 1 || !error.stdout) throw error;
      return { stdout: String(error.stdout), exitCode: 1 };
    });
  const report = JSON.parse(stdout);
  assert.deepEqual(await fixtureFiles(directory), []);
  assert.equal(report.capacityConfirmed, false);
  assert.equal(report.scale.fixturePostings, 20_001);
  assert.equal(report.scale.capturedFixturePostings, 20_001);
  assert.equal(report.scale.atLimit.scanned, 20_000);
  assert.equal(report.scale.atLimit.exactTotal, true);
  assert(report.scale.atLimit.overlappingStakeCalls > 0 && report.scale.atLimit.overlappingSettlementCalls > 0);
  assert.equal(report.scale.overLimit.outcome, 'scan-limit');
  assert.equal(report.scale.overLimit.journalRejected, true);
  assert.equal(report.reports.player.rows, 10_000);
  assert.equal(report.scale.csvAmountsAndBalancesMatch, true);
  assert.equal(report.scale.ok, true);
  const { accountCount, timestampCount, totals } = report.scale.mixedHistory;
  assert.equal(accountCount, 17);
  assert(timestampCount > 9_000);
  assert.deepEqual(totals.map(({ category, movement, count, amountUnits, feeUnits }: {
    category: string | null; movement: string; count: number; amountUnits: number | null; feeUnits: number | null;
  }) => [category, movement, count, amountUnits, feeUnits]), [
    ['casino', 'stake', 6300, -756000, null], ['casino', 'payout', 6300, 748310, null],
    ['pvp', 'reserve', 2000, -300000, null], ['pvp', 'refund', 400, 60000, null], ['pvp', 'payout', 800, 228000, null],
    ['totalizator', 'stake', 960, -256000, null], ['totalizator', 'refund', 192, 51200, null],
    ['totalizator', 'payout', 768, 194560, null], [null, 'deposit', 2280, 1416000, null],
    ['pvp', 'fee', 0, null, 12000], ['totalizator', 'fee', 0, null, 10240],
  ]);
  assert.equal(report.pilotGate.maxP95GrowthPercent, 10);
  assert.equal(report.pilotGate.noWalletErrorsOrTimeouts, true);
  assertCapturedWalletAttempts(report.capture, 2);
  assert.equal(report.reports.admission.serialVerified, true);
  assert.equal(report.ok, report.pilotGate.ok);
  assert.equal(exitCode, report.ok ? 0 : 1);
});

test('the monthly reports exclude retained history and use the player balance before the window', { timeout: 35_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout, exitCode } = await run(['--retained-history-rows', '2000', '--mixed-history', '--pilot-gate',
    '--summary-first', '--report-process', '--workers', '2', '--rounds', '3', '--seed', '8'],
  { ...process.env, TMPDIR: directory }).then(result => ({ stdout: result.stdout, exitCode: 0 }), error => {
    if (error.code !== 1 || !error.stdout) throw error;
    return { stdout: String(error.stdout), exitCode: 1 };
  });
  const report = JSON.parse(stdout);
  assert.deepEqual(await fixtureFiles(directory), []);
  assert.equal(report.capacityConfirmed, false);
  assert.equal(report.retainedHistory.rows, 2_000);
  assert.equal(report.retainedHistory.accounts, 1_000);
  assert.equal(report.retainedHistory.capturedRows, 2_000);
  assert.equal(report.retainedHistory.capturedAccounts, 1_000);
  assert.equal(report.retainedHistory.playerRows, 2);
  assert.equal(report.retainedHistory.capturedPlayerRows, 2);
  assert.equal(report.retainedHistory.playerEndingUnits, 10_200);
  assert.equal(report.retainedHistory.previousBalanceMatches, true);
  assert.equal(report.retainedHistory.reportWindowMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(report.retainedHistory.ok, true);
  assert.equal(report.reports.player.rows, 10_000);
  assert.equal(report.reports.summary.scanned, 16);
  assert.equal(report.scale.csvAmountsAndBalancesMatch, true);
  assert.equal(report.scale.capturedFixturePostings, 20_001);
  assert.equal(report.scale.atLimit.scanned, 20_000);
  assert.equal(report.scale.atLimit.exactTotal, true);
  assert.equal(report.scale.overLimit.outcome, 'scan-limit');
  assert.equal(report.scale.overLimit.journalRejected, true);
  assert.equal(report.scale.ok, true);
  assert.equal(report.capture.expectedPostings, 22_085);
  assert.equal(report.capture.postingRefs.rows, 22_085);
  assertCapturedWalletAttempts(report.capture, 2);
  assert.equal(report.withAuditWithoutReports.noDoubleMoney, true);
  assert.equal(report.withAudit.noDoubleMoney, true);
  assert.equal(report.pilotGate.noWalletErrorsOrTimeouts, true);
  assert.equal(report.pilotGate.firstQueryObserved, true);
  assert.equal(report.pilotGate.observedOverlap, true);
  assert.equal(report.reports.admission.serialVerified, true);
  assert.equal(report.ok, report.pilotGate.ok);
  assert.equal(exitCode, report.ok ? 0 : 1);
});

for (const reverse of [false, true]) test(`pilot gate uses equal fixtures with the control ${reverse ? 'after' : 'before'} reports`,
  { timeout: 35_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await run(['--pilot-gate', '--pvp-timing', '--workers', '2', '--rounds', '3',
    ...(reverse ? ['--control-after-reports'] : [])], { ...process.env, TMPDIR: directory })
    .then(({ stdout }) => ({ stdout, exitCode: 0 }), error => {
      if (error.code !== 1 || !error.stdout) throw error;
      return { stdout: String(error.stdout), exitCode: 1 };
    });
  const report = JSON.parse(result.stdout);
  assert.deepEqual(await fixtureFiles(directory), []);
  assert.equal(report.capacityConfirmed, false);
  assert.equal(report.scale.ok, true);
  assert(report.reports.player.overlappingStakeCalls > 0);
  assert.equal(report.reports.summary.scanned, 80);
  assert.equal(report.withAuditWithoutReports.noDoubleMoney, true);
  assert.equal(report.withAudit.noDoubleMoney, true);
  assert.equal(report.withAuditWithoutReports.postings, 34);
  assert.equal(report.withAudit.postings, 34);
  assert.equal(report.capture.postingRefs.rows, 20_149);
  assertCapturedWalletAttempts(report.capture, 2);
  const expected = assessAuditPilotGate(report.withAuditWithoutReports.metrics, report.withAudit.metrics);
  const { databaseActivity, firstReport, firstQueryObserved, observedOverlap, overlappingCasinoCalls, phaseOrder,
    ...gate } = report.pilotGate;
  assert.equal(firstReport, 'player');
  assert.equal(firstQueryObserved, true);
  assert.equal(observedOverlap, true);
  assert(overlappingCasinoCalls > 0);
  assert.deepEqual(phaseOrder, reverse ? ['with-reports', 'without-reports'] : ['without-reports', 'with-reports']);
  assert.deepEqual(gate, expected);
  assert.deepEqual(gate.p95.map(({ metric }: { metric: string }) => metric), ['stake', 'settlement', 'casinoRound']);
  assert.equal(gate.noWalletErrorsOrTimeouts, true);
  assert.equal(report.ok, expected.ok);
  assert.equal(result.exitCode, expected.ok ? 0 : 1);
  for (const phase of ['baseline', 'withAuditWithoutReports', 'withAudit'] as const) {
    const timing = report.pvpTiming[phase];
    assert.equal(timing.traced, 18);
    assert.equal(timing.completed, 18);
    assert.equal(timing.matched, 18);
    for (const count of [timing.observedAdvisoryWaits.command, timing.observedAdvisoryWaits.sync]) {
      assert(Number.isInteger(count) && count >= 0 && count <= timing.traced);
    }
    for (const stage of ['command', 'sync'] as const) {
      const observation = timing.holderObservations[stage];
      assert.equal(observation.observed, timing.observedAdvisoryWaits[stage]);
      assert(observation.unattributed >= 0 && observation.unattributed <= observation.observed);
      for (const count of Object.values<number>(observation.byKind)) {
        assert(Number.isInteger(count) && count >= 0 && count <= observation.observed - observation.unattributed);
      }
    }
    assert.deepEqual(Object.fromEntries(Object.entries<{ completed: number }>(timing.actions)
      .map(([action, result]) => [action, result.completed])), { create: 6, accept: 6, cancel: 4, resign: 2 });
    for (const metric of ['stake', 'settlement'] as const) {
      const row = timing[metric].p95;
      assert.equal(row.clientMs, report[phase].metrics[metric].p95Ms);
      assert.equal(timing[metric].overlappingFirstReport, phase === 'withAudit' ?
        report.reports.player[metric === 'stake' ? 'overlappingStakeCalls' : 'overlappingSettlementCalls'] : 0);
      const { roomMs, beforeStoreMs, commandMs, commandTransaction, beforeSyncMs, syncMs, syncTransaction,
        beforeRoomMatchesMs, roomMatchesMs, afterRoomMatchesMs } = row.server;
      const segments = [beforeStoreMs, commandMs, beforeSyncMs, syncMs, beforeRoomMatchesMs, roomMatchesMs, afterRoomMatchesMs];
      assert(segments.every(value => Number.isFinite(value) && value >= 0));
      assert(Math.abs(roomMs - segments.reduce((sum, value) => sum + value, 0)) < 0.005);
      for (const [span, transaction] of [[commandMs, commandTransaction], [syncMs, syncTransaction]]) {
        const { admissionMs, bodyMs, finishMs, checkoutMs, beginMs, advisoryMs, advisoryScope,
          advisoryHolders, observedWaitLowerBoundMs } = transaction;
        assert(admissionMs >= 0 && bodyMs > 0 && finishMs >= 0);
        assert(admissionMs + bodyMs + finishMs <= span + 0.002);
        assert([checkoutMs, beginMs, advisoryMs].every(value => Number.isFinite(value) && value >= 0));
        assert(advisoryScope === 'schema' || advisoryScope === 'key');
        assert(Array.isArray(advisoryHolders));
        assert.equal(advisoryHolders.length, new Set(advisoryHolders).size);
        for (const kind of advisoryHolders) assert(Object.hasOwn(timing.holderObservations.command.byKind, kind));
        assert(checkoutMs + beginMs + advisoryMs <= admissionMs + 0.002);
        if (observedWaitLowerBoundMs !== null) assert(observedWaitLowerBoundMs >= 0 && observedWaitLowerBoundMs <= advisoryMs);
      }
    }
  }
  for (const activity of [databaseActivity.withoutReports, databaseActivity.withReports]) {
    assert(activity.blocksHit > 0);
    for (const value of [activity.blocksRead, activity.blocksHit, activity.tempBytes, activity.tempFiles]) {
      assert(Number.isSafeInteger(value) && value >= 0);
    }
  }
});

const pgBasebackup = process.env.ROYAL_AUDIT_TEST_PG_BASEBACKUP;
const skewedParentClock = 'data:text/javascript,' + encodeURIComponent(
  "Object.defineProperty(performance, 'timeOrigin', { value: performance.timeOrigin + 60000 })");
function assertStandbyCancellation(cancellation: {
  cancellationMs: number; databaseReaderStopMs: number; replayWaitObserved: boolean;
  readerStopped: boolean; journalCancelled: boolean; noPartialOutput: boolean;
}) {
  const { cancellationMs, databaseReaderStopMs, ...outcome } = cancellation;
  assert(Number.isFinite(cancellationMs) && cancellationMs > 0);
  assert(Number.isFinite(databaseReaderStopMs) && databaseReaderStopMs > 0);
  assert.deepEqual(outcome, { replayWaitObserved: true, readerStopped: true, journalCancelled: true, noPartialOutput: true });
}

function assertActiveStandbyCancellation(cancellation: {
  cancellationMs: number; databaseReaderStopMs: number; blockedQueryObserved: boolean;
  stagedRowObserved: boolean; readerStopped: boolean; journalCancelled: boolean;
  noPartialOutput: boolean; slotRetainedUntilDrain: boolean;
}) {
  const { cancellationMs, databaseReaderStopMs, ...outcome } = cancellation;
  assert(Number.isFinite(cancellationMs) && cancellationMs > 0);
  assert(Number.isFinite(databaseReaderStopMs) && databaseReaderStopMs > 0);
  assert.deepEqual(outcome, { blockedQueryObserved: true, stagedRowObserved: true, readerStopped: true,
    journalCancelled: true, noPartialOutput: true, slotRetainedUntilDrain: true });
}

for (const standby of [false, true]) test(
  `replay-first ${standby ? 'standby' : 'primary'} pilot verifies replay and detail with separate process clocks`,
  { timeout: 35_000, skip: standby && !pgBasebackup }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { stdout, exitCode } = await run(['--pilot-gate', '--replay-first', '--report-process', '--mixed-history',
    '--workers', '2', '--rounds', '3', '--seed', '8',
    ...(standby ? ['--standby-pg-basebackup', pgBasebackup!, '--control-after-reports'] : [])],
  { ...process.env, TMPDIR: directory }, ['--import', skewedParentClock])
    .then(result => ({ stdout: result.stdout, exitCode: 0 }), error => {
      if (error.code !== 1 || !error.stdout) throw error;
      return { stdout: String(error.stdout), exitCode: 1 };
    });
  const report = JSON.parse(stdout);
  assert.deepEqual(await fixtureFiles(directory), []);
  assert.equal(report.capacityConfirmed, false);
  assert.equal(report.pilotGate.firstReport, 'replay');
  assert.equal(report.pilotGate.firstQueryObserved, true);
  assert(report.pilotGate.overlappingCasinoCalls > 0);
  assert.deepEqual(report.pilotGate.phaseOrder, standby ? ['with-reports', 'without-reports'] : ['without-reports', 'with-reports']);
  assert.equal(report.pilotGate.noWalletErrorsOrTimeouts, true);
  assert.equal(report.pilotGate.maxP95GrowthPercent, 10);
  assert.equal(report.reports.replay.engineVerified, true);
  assert.equal(report.reports.replay.verified, true);
  assert(report.reports.replay.events > 128 && report.reports.replay.fragments > 1);
  assert(report.reports.replay.bytes > 0 && report.reports.replay.elapsedMs > 0);
  assert(report.reports.replay.overlappingStakeCalls > 0 && report.reports.replay.overlappingSettlementCalls > 0);
  assert.equal(report.reports.detail.verified, true);
  assert(report.reports.detail.elapsedMs > 0);
  assert.equal(report.reports.player.rows, 10_000);
  assert.equal(report.scale.atLimit.scanned, 20_000);
  assert.equal(report.scale.ok, true);
  assert.equal(report.reportProcess.requests, 5);
  assert.deepEqual(report.reports.admission, { serialVerified: true,
    order: ['audit_load_replay', 'audit_load_player', 'audit_load_summary', 'audit_load_limit', 'audit_load_wide'] });
  assertCapturedWalletAttempts(report.capture, 2);
  assert.equal(!!report.standby, standby);
  if (standby) {
    assert.equal(report.standby.beforeControl.streaming, true);
    assert.equal(report.standby.afterReports.streaming, true);
    assert.equal(report.pilotGate.databaseActivity.withReports.tempBytes, 0);
    assert(report.standby.databaseActivity.withReports.tempBytes > 0);
    assertStandbyCancellation(report.standby.replayCancellation);
    assertActiveStandbyCancellation(report.standby.activeCancellation);
  }
  assert.equal(report.ok, report.pilotGate.ok);
  assert.equal(exitCode, report.ok ? 0 : 1);
});

test('standby pilot cancels both WAL wait and an active query, budgeting the active reader',
  { timeout: 35_000, skip: !pgBasebackup }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    // The supported macOS and Linux fixtures detect a closed client while executing SQL.
    const readerStopBudgetMs = process.platform === 'darwin' || process.platform === 'linux' ? 1000 : 60000;
    const { stdout, exitCode } = await run(['--pilot-gate', '--workers', '2', '--rounds', '3',
      '--standby-pg-basebackup', pgBasebackup!, '--reader-stop-budget-ms', String(readerStopBudgetMs)],
    { ...process.env, TMPDIR: directory })
      .then(({ stdout }) => ({ stdout, exitCode: 0 }), error => {
        if (error.code !== 1 || !error.stdout) throw error;
        return { stdout: String(error.stdout), exitCode: 1 };
      });
    const report = JSON.parse(stdout);
    assert.deepEqual(await fixtureFiles(directory), []);
    assert.equal(report.capacityConfirmed, false);
    assert.equal(report.scale.ok, true);
    assertCapturedWalletAttempts(report.capture, 2);
    assert.equal(report.pilotGate.noWalletErrorsOrTimeouts, true);
    assert.equal(report.standby.sameHost, true);
    assert.equal(report.standby.beforeControl.streaming, true);
    assert.equal(report.standby.afterReports.streaming, true);
    assert.notEqual(report.standby.beforeControl.replayLsn, report.standby.afterReports.replayLsn);
    assert(report.standby.databaseActivity.withReports.blocksHit > report.standby.databaseActivity.withoutReports.blocksHit);
    assert.equal(report.standby.lockCancellationTarget, 'primary');
    assertStandbyCancellation(report.standby.replayCancellation);
    assertActiveStandbyCancellation(report.standby.activeCancellation);
    assert(report.cancellation.databaseReaderStopMs >= report.cancellation.cancellationMs);
    assert.equal(report.budget.readerStopTarget, 'standby-active-query');
    assert.deepEqual(report.budget.checks, [{ metric: 'readerStopMs',
      actual: report.standby.activeCancellation.databaseReaderStopMs, limit: readerStopBudgetMs, passed: true }]);
    assert.equal(report.ok, report.pilotGate.ok);
    assert.equal(exitCode, report.ok ? 0 : 1);
  });
