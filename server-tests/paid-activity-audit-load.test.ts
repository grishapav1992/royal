import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(new URL('../scripts/audit-load.ts', import.meta.url));
const run = (args: string[], env = process.env) => promisify(execFile)(
  process.execPath, ['--import', 'tsx', script, ...args], { env, timeout: 30_000 },
);
const fixtureFiles = async (directory: string) => (await readdir(directory))
  .filter(name => name.startsWith('royal-pg-') || name.startsWith('royal-audit-load-'));

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
  assert(report.reports.summary.overlappingStakeCalls > 0);
  assert(report.reports.summary.scanned >= 80);
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
  assert.equal(report.scale.csvAmountsAndBalancesMatch, true);
  assert.equal(report.scale.atLimit.scanned, 20_000);
  assert.equal(report.scale.atLimit.exactTotal, true);
  assert.equal(report.scale.overLimit.outcome, 'scan-limit');
  assert.equal(report.scale.overLimit.journalRejected, true);
  assert(report.scale.overLimit.overlappingStakeCalls > 0);
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
