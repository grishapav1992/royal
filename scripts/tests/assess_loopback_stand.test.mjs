import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assessLoopbackDirectory, assessLoopbackRecords, validateLoopbackAssessmentPlan } from '../assess-loopback-stand.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const clone = structuredClone;
function fixture() {
  const runId = '3840f6b7-5efa-450e-90d4-e4e866aef27d', standRunId = '9cd9cdbb-a53f-4be4-aa21-89fbf654aedf';
  const containerId = 'a'.repeat(64), bundleSha256 = 'b'.repeat(64), imageId = 'sha256:' + 'c'.repeat(64);
  const controlSource = Buffer.from('def main():\n    pass\n');
  const plan = { protocol: 1, targetHost: '31.56.189.118', runId, ownedRoot: '/opt/royal-load-' + runId,
    containerName: 'royal-load-' + runId + '-test', imageId, metadataSha256: 'd'.repeat(64), bundleSha256,
    machineIdSha256: 'e'.repeat(64), helperSha256: 'f'.repeat(64), clients: 4, seconds: 5, gameProcesses: 4,
    budget: { cpus: 18, memoryMiB: 32768, pidsLimit: 2048 }, sameHostGenerators: true,
    controlSha256: digest(controlSource), snapshotSourceSha256: '1'.repeat(64), generatorMetadataSha256: '2'.repeat(64), workers: 4 };
  const host = { platform: 'linux', arch: 'x64', logicalCPUs: 20, ramGiB: 48, hostFingerprint: '3'.repeat(64) };
  const ready = Array.from({ length: 4 }, () => ({ kind: 'ready', count: 1, connectedClients: 1,
    rooms: [{ id: 'room', owner: 'main', count: 1 }], errors: {}, requestedBatch: 1, joinedBatch: 1,
    connectionAttempts: 1, connectionRetries: 0, retryCodes: {} }));
  const quantiles = { count: 150, p50: 10, p95: 20, p99: 30, max: 40, sampleCount: 150, sampling: 'complete', mean: 15 };
  const results = ready.map(value => ({ kind: 'result', count: 1, connectedClients: 1, rooms: clone(value.rooms),
    durationSeconds: 5, observationSeconds: 5.01, packetsSent: 150, inputPacketsPerSecond: 30,
    receivedBytes: 1000, maxClientBufferedBytes: 0, ackMs: clone(quantiles), stateIntervalMs: clone(quantiles),
    unacknowledgedPackets: 0, unacknowledgedAtEndOfSending: 1, oldestUnacknowledgedMs: 0, drainSeconds: .01,
    errorCount: 0, errors: {}, generator: { cpuPercent: 10, rssMiB: 50, eventLoopP99Ms: 11, eventLoopMaxMs: 12 },
    inputMode: 'browser-window', sentInputSteps: 300,
    tracking: { latencyTimingSamplesDropped: 0, residualCountsExact: true } }));
  const connectionPhase = { durationSeconds: 1, batches: 4, connectionAttempts: 4, connectionRetries: 0 };
  const metric = { samples: 2, observedSeconds: 5, intervals: [
    { intervalStartedAt: 1000, sampledAt: 3500, intervalMs: 2500 },
    { intervalStartedAt: 3500, sampledAt: 6000, intervalMs: 2500 },
  ] };
  const ownerIds = ['main', 'worker-1', 'worker-2', 'worker-3'];
  const server = { productionTraffic: false, stand: { runId: standRunId }, bundle: { sha256: bundleSha256 },
    targetClients: 4, measurementSeconds: 5, gameProcesses: 4, sdkWebSocket: 'ws', host,
    differentReportedHosts: false, workload: { inputMode: 'browser-window', packetsPerClientPerSecond: 30,
      stepsPerPacket: 2, targetInputStepsPerClientPerSecond: 60, browserPredictionSendWindow: true },
    localTestBudgets: { minInputRatePercent: 99, maxWorkerAckP95Ms: 250, maxWorkerAckP99Ms: 500, maxUnacknowledgedPercent: 0 },
    checks: Object.fromEntries(['connections', 'preparationErrors', 'roomAndConnectedClientCaps', 'routedAcrossExpectedProcesses',
      'processesHealthy', 'childProcessesAlive', 'metricSamplesAvailable', 'ackTimingTrackingComplete', 'serverInputDeliveryComplete',
      'serverDiagnosticCoverageComplete', 'resourceSamplesAvailable', 'generatorSustainedTarget', 'ackSamplesAvailable',
      'ackLatencyWithinLocalBudget', 'ackResidualWithinLocalBudget'].map(key => [key, true])),
    ok: true, generators: clone(results), connectionPhase: { ...connectionPhase, generators: clone(ready) },
    inputDelivery: { sentFrames: 600, receivedFrames: 600, difference: 0 }, cleanup: { passed: true, failures: [] },
    summary: { connectedClients: 4, errorCount: 0, inputPacketsPerSecond: 120, inputRateTargetPercent: 100,
      inputRateTargetPercentByGenerator: [100, 100, 100, 100], ackP95MsByGenerator: [20, 20, 20, 20],
      ackP99MsByGenerator: [30, 30, 30, 30], maxAckMs: 40, unacknowledgedAfterDrain: 0, unacknowledgedAtEndOfSending: 4 },
    servers: Object.fromEntries(ownerIds.map(owner => [owner, clone(metric)])), orchestrator: clone(metric), proxyResources: clone(metric),
    roomTrafficDiagnostics: Object.fromEntries(ownerIds.map(owner => [owner, { inputFrames: owner === 'main' ? 600 : 0,
      decodedInputSequences: owner === 'main' ? 1200 : 0, queueAcceptedSteps: owner === 'main' ? 1200 : 0,
      queueAdvancedRemovals: owner === 'main' ? 1200 : 0, queueCancelledRemovals: 0,
      receivedSequencesCoveredByInputSeq: owner === 'main' ? 1200 : 0, limiterHits: 0, diagnosticErrors: 0,
      maxQueuedStepsPerClient: 2, receiveToInputSeqAge: { maxMs: 12 }, pending: { queuedSteps: 0, receivedSequencesAwaitingInputSeq: 0 } }])) };
  const generator = { productionTraffic: false, generatorOnly: true, runId: standRunId, bundleSha256, targetClients: 4,
    seconds: 5, inputMode: 'browser-window', sdkWebSocket: 'ws', clientHost: clone(host), serverHost: clone(host),
    differentReportedHosts: false, ok: true, ready: clone(ready), results: clone(results), connectionPhase: clone(connectionPhase),
    cleanup: { passed: true, failures: [] }, childExits: Array.from({ length: 4 }, (_, generator) => ({ generator, code: 0, signal: null, duringCleanup: true })),
    attestation: { control: true, gameApi: true, verifiedBeforeGenerators: true,
      gameApiOrigins: [17100, 17102, 17103, 17104].map(port => 'http://127.0.0.1:' + port) },
    tunnel: { apiOrigin: 'http://127.0.0.1:17100', controlOrigin: 'http://127.0.0.1:36627' }, serverReport: clone(server) };
  const generatorBytes = Buffer.from(JSON.stringify(generator) + '\n');
  const control = { runId, standRunId, containerId, productionTraffic: false, kind: 'same-container-loopback-control', capacityConfirmed: false,
    clients: 4, seconds: 5, gameProcesses: 4, workers: 4, budget: clone(plan.budget), helperSha256: plan.helperSha256,
    snapshotSourceSha256: plan.snapshotSourceSha256, generatorMetadataSha256: plan.generatorMetadataSha256,
    generatorExitCode: 0, monitorExitCode: 0, controlCompleted: true, ownedChildCommandsStopped: true, temporaryControlAssetsRemoved: true,
    generatorCompletion: { protocol: 1, purpose: 'isolated-generator-completion', runId: standRunId, bundleSha256,
      generatorExitCode: 0, reportSha256: digest(generatorBytes), reportBytes: generatorBytes.length },
    stop: { runId, containerId, stopConfirmed: true, privateFixtureGone: true },
    finalStatus: { runId, containerId, targetHost: plan.targetHost, imageId, metadataSha256: plan.metadataSha256, bundleSha256,
      budget: clone(plan.budget), phase: 'ended', containerState: 'exited', reason: 'container-ended', passed: true,
      stopConfirmed: true, privateFixtureGone: true } };
  const snapshot = { protocol: 1, purpose: 'isolated-loopback-generator-control-snapshot', partial: true, cleanupUnobserved: true,
    runId: standRunId, controlPort: 36627, preparedObservedAtMs: 900, resultsObservedAtMs: 6100, observedAtMs: 6100,
    prepared: { runId: standRunId, gameProcesses: 4, ready: clone(ready), clientHost: clone(host), inputMode: 'browser-window', connectionPhase }, results: clone(results) };
  const resourceSamples = [900, 6100, 6200].map((sampledAtMs, index) => ({ sampledAtMs, elapsedSeconds: (sampledAtMs - 800) / 1000,
    hostCpuJiffies: [index + 1, 0, 0, 0, 0, 0, 0, 0], hostMemAvailableBytes: 1024 ** 3,
    container: { Id: containerId, Image: imageId, label: runId, status: index === 2 ? 'exited' : 'running', oomKilled: false },
    ...(index < 2 ? { cgroup: { cpu: { usage_usec: (index + 1) * 1000000, user_usec: 500000, system_usec: 500000,
      nr_periods: 20, nr_throttled: 4, throttled_usec: 1000 }, memoryCurrentBytes: 1024 ** 2,
      memoryEvents: { oom: 0, oom_kill: 0 }, memoryStat: { anon: 1024 } } } : {}) }));
  // Coverage requires a bounded cadence as well as the cumulative endpoints.
  resourceSamples.splice(1, 0, clone(resourceSamples[0]));
  resourceSamples[1].sampledAtMs = 3500; resourceSamples[1].elapsedSeconds = 2.7;
  resourceSamples[1].hostCpuJiffies[0] = 2; resourceSamples[1].cgroup.cpu.usage_usec = 1500000;
  resourceSamples[2].hostCpuJiffies[0] = 3; resourceSamples[3].hostCpuJiffies[0] = 4;
  return { plan, records: { control, state: { runId, containerId, phase: 'ended', reason: 'container-ended', passed: true,
    stopConfirmed: true, privateFixtureGone: true }, guardian: { runId, containerId, phase: 'ended', reason: 'supervisor-completed',
    stopConfirmed: true, privateFixtureGone: true }, resourceSummary: { runId, containerId, imageId, sampleCount: 4, reason: 'container-ended' },
    resourceSamples, server, generator, snapshot, controlSource, generatorBytes } };
}
const failed = async (mutate, key) => {
  const { plan, records } = fixture(); mutate(records, plan);
  const result = await assessLoopbackRecords(plan, records);
  assert.equal(result.ok, false); assert.equal(result.advanceAllowed, false); assert.equal(result.checks[key], false);
  return result;
};

test('a complete same-host profile passes while distributed capacity remains unconfirmed', async () => {
  const { plan, records } = fixture(), result = await assessLoopbackRecords(plan, records);
  assert.equal(result.ok, true, JSON.stringify(result.checks)); assert.equal(result.advanceAllowed, true);
  assert.equal(result.completeGeneratorReport, true); assert.equal(result.capacityConfirmed, false);
  assert.equal(result.resourceCoverage.fullCounterRangeBracketed, true); assert.equal(result.trafficObservations.advancedSteps, 1200);
});
test('partial snapshot and server PASS cannot replace the full generator report', async () => {
  const result = await failed(records => { delete records.generator; records.control.generatorExitCode = 137; }, 'generatorFullReportAndExit');
  assert.equal(result.completeGeneratorReport, false);
});
test('nonzero SDK exit blocks advancement even with complete passing reports', async () => {
  await failed(records => { records.control.generatorExitCode = 137; }, 'generatorFullReportAndExit');
});
function failedWorkloadFixture() {
  const value = fixture(), records = value.records, results = records.generator.results;
  for (const result of results) {
    result.packetsSent = 147; result.inputPacketsPerSecond = 29.4; result.sentInputSteps = 294;
    result.ackMs.count = result.ackMs.sampleCount = 147;
  }
  records.server.ok = false; records.server.checks.generatorSustainedTarget = false;
  records.server.generators = clone(results); records.snapshot.results = clone(results);
  Object.assign(records.server.summary, { inputPacketsPerSecond: 117.6, inputRateTargetPercent: 98,
    inputRateTargetPercentByGenerator: [98, 98, 98, 98] });
  records.server.inputDelivery.sentFrames = records.server.inputDelivery.receivedFrames = 588;
  Object.assign(records.server.roomTrafficDiagnostics.main, { inputFrames: 588, decodedInputSequences: 1176,
    queueAcceptedSteps: 1176, queueAdvancedRemovals: 1176, receivedSequencesCoveredByInputSeq: 1176 });
  records.generator.ok = false; records.generator.serverReport = clone(records.server);
  records.generatorBytes = Buffer.from(JSON.stringify(records.generator) + '\n');
  records.control.generatorExitCode = 1;
  Object.assign(records.control.generatorCompletion, { generatorExitCode: 1,
    reportSha256: digest(records.generatorBytes), reportBytes: records.generatorBytes.length });
  Object.assign(records.state, { phase: 'failed', reason: 'container-failed', passed: false });
  Object.assign(records.control.finalStatus, { phase: 'failed', reason: 'container-failed', passed: false });
  return value;
}
test('complete matching failed-workload reports remain complete without permitting advancement', async () => {
  const { plan, records } = failedWorkloadFixture(), result = await assessLoopbackRecords(plan, records);
  assert.equal(result.completeGeneratorReport, true); assert.equal(result.generatorLifecycleClean, true);
  assert.equal(result.generatorSucceeded, false); assert.equal(result.generatorExitCode, 1);
  assert.equal(result.checks.embeddedServerMeasurementMatches, true); assert.equal(result.checks.generatorCompletionDigest, true);
  assert.equal(result.measurementPassed, false); assert.equal(result.ok, false); assert.equal(result.advanceAllowed, false);
  assert.equal(result.checks.independentGeneratorMeasurementsPassed, false);
});
test('a failed report completion marker must record the actual observed exit code', async () => {
  const { plan, records } = failedWorkloadFixture(); records.control.generatorCompletion.generatorExitCode = 0;
  const result = await assessLoopbackRecords(plan, records);
  assert.equal(result.checks.generatorCompletionDigest, false); assert.equal(result.completeGeneratorReport, false);
  assert.equal(result.ok, false); assert.equal(result.advanceAllowed, false);
});
test('digest and exact-byte completion marker are required', async () => {
  await failed(records => { records.control.generatorCompletion.reportSha256 = '0'.repeat(64); }, 'generatorCompletionDigest');
  await failed(records => { records.control.generatorCompletion.reportBytes++; }, 'generatorCompletionDigest');
});
test('unexpected child exit or incomplete generator cleanup blocks PASS', async () => {
  await failed(records => { records.generator.childExits[0].duringCleanup = false; }, 'generatorFullReportAndExit');
  await failed(records => { records.generator.cleanup.failures = ['generator-0']; }, 'generatorFullReportAndExit');
});
test('all required server checks must be present and true', async () => {
  await failed(records => { delete records.server.checks.ackLatencyWithinLocalBudget; }, 'serverChecksPassed');
  await failed(records => { records.server.checks.connections = false; }, 'serverChecksPassed');
});
test('forged PASS flags cannot hide a failed measured ACK budget', async () => {
  await failed(records => { records.generator.results[0].ackMs.p99 = 600; records.generator.results[0].ackMs.max = 600; }, 'independentGeneratorMeasurementsPassed');
});
test('the saved server summary cannot contradict its measured generator results', async () => {
  await failed(records => { records.server.summary.connectedClients = 5; }, 'serverSummaryConsistent');
});
test('snapshot, saved server and full generator results must agree', async () => {
  await failed(records => { records.snapshot.results[0].receivedBytes++; }, 'readyAndResultsMatch');
  await failed(records => { records.server.generators[0].packetsSent--; }, 'readyAndResultsMatch');
});
test('mixed stand identities and frozen bundle mismatches are rejected', async () => {
  await failed(records => { records.control.standRunId = '00000000-0000-0000-0000-000000000000'; }, 'serverIdentityAndProfile');
  await failed(records => { records.server.bundle.sha256 = '0'.repeat(64); }, 'serverIdentityAndProfile');
  await failed(records => { records.controlSource = Buffer.from('modified control'); }, 'frozenControlSource');
});
test('attestation must precede generators and cover the exact loopback aliases', async () => {
  await failed(records => { records.generator.attestation.verifiedBeforeGenerators = false; }, 'generatorIdentityAndAttestation');
  await failed(records => { records.generator.attestation.gameApiOrigins[0] = 'http://example.invalid'; }, 'generatorIdentityAndAttestation');
});
test('terminal timestamp coverage alone is insufficient without final live counters', async () => {
  const result = await failed(records => { records.resourceSamples[2].sampledAtMs = 5999; records.resourceSamples[2].elapsedSeconds = 5.199; }, 'resourceCoverage');
  assert.equal(result.resourceCoverage.fullIntervalObserved, true); assert.equal(result.resourceCoverage.fullCounterRangeBracketed, false);
});
test('an observed OOM prevents advancement even with complete coverage', async () => {
  await failed(records => { records.resourceSamples[1].cgroup.memoryEvents.oom_kill = 1; }, 'noObservedOom');
});
test('supervisor failure or unconfirmed owned cleanup prevents success', async () => {
  await failed(records => { records.state.passed = false; }, 'supervisorCompleted');
  await failed(records => { records.control.stop.privateFixtureGone = false; }, 'ownedControlCleanup');
});
test('received steps must all advance without cancellation or residual queues', async () => {
  await failed(records => { records.server.roomTrafficDiagnostics.main.queueCancelledRemovals = 1; }, 'serverTrafficComplete');
  await failed(records => { records.server.roomTrafficDiagnostics.main.pending.queuedSteps = 1; }, 'serverTrafficComplete');
});
test('safe plans reject extra secret fields, production targets and unsupported ramps', () => {
  for (const change of [{ secret: 'private-test-value' }, { targetHost: '45.192.12.242' }, { clients: 5001 }, { workers: 3 }]) {
    assert.throws(() => validateLoopbackAssessmentPlan({ ...fixture().plan, ...change }), /invalid-safe-loopback-plan/);
  }
});
test('the approved 5000 and 6000 stages retain explicit worker and owner counts', () => {
  const plan = fixture().plan;
  assert.equal(validateLoopbackAssessmentPlan({ ...plan, clients: 5000, seconds: 600, gameProcesses: 20, workers: 16 }).clients, 5000);
  assert.equal(validateLoopbackAssessmentPlan({ ...plan, clients: 6000, seconds: 120, gameProcesses: 20, workers: 20 }).clients, 6000);
  assert.throws(() => validateLoopbackAssessmentPlan({ ...plan, clients: 6000, seconds: 120, gameProcesses: 19, workers: 20 }), /invalid-safe-loopback-plan/);
});
test('identity pins must be strings rather than values coerced by regular expressions', () => {
  const plan = fixture().plan;
  for (const key of ['runId', 'imageId', 'machineIdSha256']) {
    assert.throws(() => validateLoopbackAssessmentPlan({ ...plan, [key]: [plan[key]] }), /invalid-safe-loopback-plan/);
  }
});
async function diskFixture() {
  const { plan, records } = fixture(), directory = await realpath(await mkdtemp(join(tmpdir(), 'loopback-assessment-')));
  const names = { control: 'loopback-control.json', state: 'state.json', guardian: 'guardian.json', resourceSummary: 'resource-monitor.json',
    server: 'server.json', generator: 'generators.json', snapshot: 'generator-snapshot.json' };
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan));
  for (const [key, name] of Object.entries(names)) await writeFile(join(directory, name), key === 'generator' ? records.generatorBytes : JSON.stringify(records[key]));
  await writeFile(join(directory, 'resource-monitor.jsonl'), records.resourceSamples.map(value => JSON.stringify(value)).join('\n') + '\n');
  await writeFile(join(directory, 'control-source.py'), records.controlSource);
  return directory;
}
test('local artifact assessment records exact SHA inputs without exposing missing-file errors', async () => {
  const directory = await diskFixture();
  try {
    const success = await assessLoopbackDirectory(directory); assert.equal(success.ok, true); assert.equal(success.artifactInputs.length, 10);
    await rm(join(directory, 'generators.json'));
    const failed = await assessLoopbackDirectory(directory); assert.equal(failed.ok, false);
    assert.deepEqual(failed.readFailures, [{ file: 'generators.json', code: 'artifact-missing' }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('symlinked artifacts and secret-bearing report keys fail closed', async () => {
  const directory = await diskFixture();
  try {
    await rm(join(directory, 'guardian.json')); await symlink(join(directory, 'state.json'), join(directory, 'guardian.json'));
    const result = await assessLoopbackDirectory(directory); assert.equal(result.ok, false);
    assert.deepEqual(result.readFailures, [{ file: 'guardian.json', code: 'artifact-unavailable' }]);
    await rm(join(directory, 'guardian.json'));
    const secret = { ...JSON.parse(await readFile(join(directory, 'state.json'))), secret: 'private-test-value' };
    await writeFile(join(directory, 'guardian.json'), JSON.stringify(secret));
    const refused = await assessLoopbackDirectory(directory); assert.equal(refused.ok, false);
    assert.ok(!JSON.stringify(refused).includes('private-test-value'));
    assert.deepEqual(refused.readFailures, [{ file: 'guardian.json', code: 'secret-bearing-artifact-refused' }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('oversized control sources are rejected before parsing or hashing their body', async () => {
  const directory = await diskFixture();
  try {
    await writeFile(join(directory, 'control-source.py'), Buffer.alloc(1024 ** 2 + 1));
    const result = await assessLoopbackDirectory(directory);
    assert.equal(result.ok, false); assert.equal(result.advanceAllowed, false);
    assert.deepEqual(result.readFailures, [{ file: 'control-source.py', code: 'artifact-file-refused' }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('CLI writes a fresh assessment and exits nonzero for incomplete artifacts', async () => {
  const run = promisify(execFile), script = fileURLToPath(new URL('../assess-loopback-stand.mjs', import.meta.url));
  for (const complete of [true, false]) {
    const directory = await diskFixture();
    try {
      if (!complete) await rm(join(directory, 'generators.json'));
      let response;
      try { response = await run(process.execPath, [script, '--artifacts', directory], { maxBuffer: 65536 }); }
      catch (error) { assert.equal(complete, false); assert.equal(error.code, 1); response = error; }
      const assessed = JSON.parse(await readFile(join(directory, 'assessment.json'), 'utf8'));
      assert.equal(assessed.ok, complete); assert.equal(assessed.advanceAllowed, complete); assert.equal(assessed.capacityConfirmed, false);
      assert.equal(JSON.parse(response.stdout).ok, complete);
      assert.equal(response.stderr, '');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
