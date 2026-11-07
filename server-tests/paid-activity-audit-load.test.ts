import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assessAuditPilotGate } from '../scripts/audit-load';

const script = fileURLToPath(new URL('../scripts/audit-load.ts', import.meta.url));
const run = (args: string[], env = process.env) => promisify(execFile)(
  process.execPath, ['--import', 'tsx', script, ...args], { env, timeout: 30_000 },
);
const fixtureFiles = async (directory: string) => (await readdir(directory))
  .filter(name => /^royal-(pg|audit-load|audit-standby)-/.test(name));

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
  assert.equal(report.ok, true);
  assert.equal(report.scale, undefined);
  assert.equal(report.budget, undefined);
  assert.equal(report.pilotGate, undefined);
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
  assert.equal(report.capture.stopped, true);
  assert.equal(report.capture.gaps, 0);
  assert.equal(report.capture.expectedAttempts, 12);
  assert.equal(report.capture.attemptPayloads.rows, 12);
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
  assert.equal(report.capture.gaps, 0);
  assert.equal(report.cancellation.noPartialOutput, true);
  assert.equal(report.budget.ok, true);
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
    assert.equal(report.budget.ok, false);
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
  const within = { ...control, stake: metric(11), settlement: metric(7.7) };
  const pass = assessAuditPilotGate(control, within);
  assert.equal(pass.ok, true);
  assert.equal(pass.noWalletErrorsOrTimeouts, true);
  assert.deepEqual(pass.p95.map(check => [check.metric, check.growthPercent, check.passed]),
    [['stake', 10, true], ['settlement', 10, true]]);

  const slow = assessAuditPilotGate(control, { ...within, settlement: metric(7.701) });
  assert.equal(slow.ok, false);
  assert.equal(slow.noWalletErrorsOrTimeouts, true);
  assert.equal(slow.p95[1].passed, false);
  const failed = assessAuditPilotGate(control, { ...within, retry: metric(8, 7) });
  assert.equal(failed.ok, false);
  assert.equal(failed.noWalletErrorsOrTimeouts, false);
  assert(failed.p95.every(check => check.passed));
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
  assert(report.scale.atLimit.overlappingStakeCalls > 0);
  assert.equal(report.scale.atLimit.exactTotal, true);
  assert.deepEqual(report.reports.admission, { serialVerified: true,
    order: ['audit_load_limit', 'audit_load_player', 'audit_load_summary', 'audit_load_wide'] });
  assert.equal(report.reports.player.rows, 10_000);
  assert.equal(report.scale.overLimit.outcome, 'scan-limit');
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
  assert.equal(report.capture.gaps, 0);
  assert.equal(report.reports.admission.serialVerified, true);
  assert.equal(report.ok, report.pilotGate.ok);
  assert.equal(exitCode, report.ok ? 0 : 1);
});

test('pilot gate measures audited wallets without reports and exits according to the fixed comparison', { timeout: 35_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await run(['--pilot-gate', '--workers', '2', '--rounds', '3'], { ...process.env, TMPDIR: directory })
    .then(({ stdout }) => ({ stdout, exitCode: 0 }), error => {
      if (error.code !== 1 || !error.stdout) throw error;
      return { stdout: String(error.stdout), exitCode: 1 };
    });
  const report = JSON.parse(result.stdout);
  assert.deepEqual(await fixtureFiles(directory), []);
  assert.equal(report.capacityConfirmed, false);
  assert.equal(report.scale.ok, true);
  assert(report.reports.player.overlappingStakeCalls > 0);
  assert.equal(report.withAuditWithoutReports.noDoubleMoney, true);
  assert.equal(report.withAudit.noDoubleMoney, true);
  assert.equal(report.withAuditWithoutReports.postings, 34);
  assert.equal(report.withAudit.postings, 34);
  assert.equal(report.capture.postingRefs.rows, 20_149);
  assert.equal(report.capture.attemptPayloads.rows, 24);
  assert.equal(report.capture.gaps, 0);
  const expected = assessAuditPilotGate(report.withAuditWithoutReports.metrics, report.withAudit.metrics);
  const { databaseActivity, firstReport, firstQueryObserved, observedOverlap, ...gate } = report.pilotGate;
  assert.equal(firstReport, 'player');
  assert.equal(firstQueryObserved, true);
  assert.equal(observedOverlap, true);
  assert.deepEqual(gate, expected);
  assert.equal(gate.noWalletErrorsOrTimeouts, true);
  assert.equal(report.ok, expected.ok);
  assert.equal(result.exitCode, expected.ok ? 0 : 1);
  for (const activity of [databaseActivity.withoutReports, databaseActivity.withReports]) {
    assert(activity.blocksHit > 0);
    for (const value of [activity.blocksRead, activity.blocksHit, activity.tempBytes, activity.tempFiles]) {
      assert(Number.isSafeInteger(value) && value >= 0);
    }
  }
});

const pgBasebackup = process.env.ROYAL_AUDIT_TEST_PG_BASEBACKUP;
test('standby pilot waits for journal WAL and releases a reader when replay is paused',
  { timeout: 35_000, skip: !pgBasebackup }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-audit-load-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { stdout, exitCode } = await run(['--pilot-gate', '--workers', '2', '--rounds', '3',
      '--standby-pg-basebackup', pgBasebackup!], { ...process.env, TMPDIR: directory })
      .then(({ stdout }) => ({ stdout, exitCode: 0 }), error => {
        if (error.code !== 1 || !error.stdout) throw error;
        return { stdout: String(error.stdout), exitCode: 1 };
      });
    const report = JSON.parse(stdout);
    assert.deepEqual(await fixtureFiles(directory), []);
    assert.equal(report.capacityConfirmed, false);
    assert.equal(report.scale.ok, true);
    assert.equal(report.capture.gaps, 0);
    assert.equal(report.pilotGate.noWalletErrorsOrTimeouts, true);
    assert.equal(report.ok, report.pilotGate.ok);
    assert.equal(exitCode, report.ok ? 0 : 1);
    assert.equal(report.standby.sameHost, true);
    assert.equal(report.standby.beforeControl.streaming, true);
    assert.equal(report.standby.afterReports.streaming, true);
    assert.notEqual(report.standby.beforeControl.replayLsn, report.standby.afterReports.replayLsn);
    assert(report.standby.databaseActivity.withReports.blocksHit > report.standby.databaseActivity.withoutReports.blocksHit);
    assert.equal(report.standby.lockCancellationTarget, 'primary');
    assert.deepEqual(report.standby.replayCancellation,
      { replayWaitObserved: true, readerStopped: true, journalCancelled: true, noPartialOutput: true });
  });
