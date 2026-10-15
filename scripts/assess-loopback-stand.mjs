import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { resourceCoverage } from './run-dedicated-websocket-stage.mjs';

const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = isDeepStrictEqual;
const profiles = new Map([
  ['4/5/4', 4], ['600/30/20', 4], ['600/60/20', 4], ['1000/60/20', 8], ['1000/120/20', 8],
  ['2000/60/20', 12], ['2000/120/20', 12], ['3500/120/20', 16], ['5000/120/20', 16],
  ['5000/600/20', 16], ['6000/120/20', 20],
]);
const serverChecks = ['connections', 'preparationErrors', 'roomAndConnectedClientCaps', 'routedAcrossExpectedProcesses',
  'processesHealthy', 'childProcessesAlive', 'metricSamplesAvailable', 'ackTimingTrackingComplete',
  'serverInputDeliveryComplete', 'serverDiagnosticCoverageComplete', 'resourceSamplesAvailable',
  'generatorSustainedTarget', 'ackSamplesAvailable', 'ackLatencyWithinLocalBudget', 'ackResidualWithinLocalBudget'];
const artifactSpecs = [
  ['plan', 'plan.json', 65536], ['control', 'loopback-control.json', 65536], ['state', 'state.json', 65536],
  ['guardian', 'guardian.json', 65536], ['resourceSummary', 'resource-monitor.json', 65536],
  ['resourceSamples', 'resource-monitor.jsonl', 32 * 1024 ** 2], ['server', 'server.json', 32 * 1024 ** 2],
  ['generator', 'generators.json', 16 * 1024 ** 2], ['snapshot', 'generator-snapshot.json', 16 * 1024 ** 2],
  ['controlSource', 'control-source.py', 1024 ** 2],
];
class AssessmentError extends Error { constructor(code) { super(code); this.code = code; } }
const refuse = code => { throw new AssessmentError(code); };

export function validateLoopbackAssessmentPlan(value) {
  const keys = ['protocol', 'targetHost', 'runId', 'ownedRoot', 'containerName', 'imageId', 'metadataSha256', 'bundleSha256',
    'machineIdSha256', 'helperSha256', 'clients', 'seconds', 'gameProcesses', 'budget', 'sameHostGenerators',
    'controlSha256', 'snapshotSourceSha256', 'generatorMetadataSha256', 'workers'];
  if (!object(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.protocol !== 1
    || value.targetHost !== '31.56.189.118' || typeof value.runId !== 'string' || !uuid.test(value.runId)
    || value.ownedRoot !== '/opt/royal-load-' + value.runId || value.containerName !== 'royal-load-' + value.runId + '-test'
    || typeof value.imageId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.imageId) || value.sameHostGenerators !== true
    || ['metadataSha256', 'bundleSha256', 'machineIdSha256', 'helperSha256', 'controlSha256', 'snapshotSourceSha256',
      'generatorMetadataSha256'].some(key => typeof value[key] !== 'string' || !hex.test(value[key]))
    || !integer(value.clients, 4, 6000) || !integer(value.seconds, 1, 1800) || !integer(value.gameProcesses, 1, 24)
    || profiles.get([value.clients, value.seconds, value.gameProcesses].join('/')) !== value.workers
    || !equal(value.budget, { cpus: 18, memoryMiB: 32768, pidsLimit: 2048 })) refuse('invalid-safe-loopback-plan');
  return value;
}

let schemaPromise;
async function schemas() {
  return schemaPromise ??= import('tsx/esm/api').then(({ tsImport }) => tsImport('./load-stand-contract.ts', import.meta.url));
}
const sum = (values, key) => values.reduce((total, value) => total + value[key], 0);
const clean = value => value?.passed === true && Array.isArray(value.failures) && value.failures.length === 0;
const expectedPorts = workers => [17100, ...Array.from({ length: workers - 1 }, (_, index) => 17102 + index)];
const owners = count => ['main', ...Array.from({ length: count - 1 }, (_, index) => 'worker-' + (index + 1))];

export async function assessLoopbackRecords(rawPlan, records, { artifactInputs = [], readFailures = [], schema } = {}) {
  const plan = validateLoopbackAssessmentPlan(rawPlan), api = schema ?? await schemas();
  const { control, state, guardian, resourceSummary, resourceSamples, server, generator, snapshot, controlSource, generatorBytes } = records;
  const checks = {}, check = (name, work) => { try { checks[name] = work() === true; } catch { checks[name] = false; } };
  let prepared, finished, coverage, traffic, summary, resources;
  check('artifactFilesComplete', () => readFailures.length === 0 && artifactSpecs.slice(1).every(([key]) => records[key] !== undefined));
  check('frozenControlSource', () => Buffer.isBuffer(controlSource) && hash(controlSource) === plan.controlSha256);
  check('controlIdentityAndProfile', () => control?.productionTraffic === false && control.kind === 'same-container-loopback-control'
    && control.capacityConfirmed === false && control.runId === plan.runId && hex.test(control.containerId ?? '')
    && uuid.test(control.standRunId ?? '') && control.clients === plan.clients && control.seconds === plan.seconds
    && control.gameProcesses === plan.gameProcesses && control.workers === plan.workers && equal(control.budget, plan.budget)
    && control.helperSha256 === plan.helperSha256 && control.snapshotSourceSha256 === plan.snapshotSourceSha256
    && control.generatorMetadataSha256 === plan.generatorMetadataSha256 && !control.failure);
  check('serverIdentityAndProfile', () => server?.productionTraffic === false && server.stand?.runId === control?.standRunId
    && server.bundle?.sha256 === plan.bundleSha256 && server.targetClients === plan.clients && server.measurementSeconds === plan.seconds
    && server.gameProcesses === plan.gameProcesses && server.sdkWebSocket === 'ws' && server.workload?.inputMode === 'browser-window'
    && server.workload.packetsPerClientPerSecond === 30 && server.workload.stepsPerPacket === 2
    && server.workload.targetInputStepsPerClientPerSecond === 60 && server.workload.browserPredictionSendWindow === true
    && equal(server.localTestBudgets, { minInputRatePercent: 99, maxWorkerAckP95Ms: 250, maxWorkerAckP99Ms: 500, maxUnacknowledgedPercent: 0 })
    && equal(Object.keys(server.servers ?? {}).sort(), owners(plan.gameProcesses).sort()));
  check('serverChecksPassed', () => server?.ok === true && object(server.checks)
    && serverChecks.every(key => server.checks[key] === true) && Object.values(server.checks).every(value => value === true));
  check('generatorIdentityAndAttestation', () => generator?.productionTraffic === false && generator.generatorOnly === true
    && generator.runId === control?.standRunId && generator.bundleSha256 === plan.bundleSha256 && generator.targetClients === plan.clients
    && generator.seconds === plan.seconds && generator.inputMode === 'browser-window' && generator.sdkWebSocket === 'ws'
    && generator.attestation?.control === true && generator.attestation.gameApi === true && generator.attestation.verifiedBeforeGenerators === true
    && equal(generator.attestation.gameApiOrigins, expectedPorts(plan.workers).map(port => 'http://127.0.0.1:' + port))
    && api.loopbackEndpoint(generator.tunnel?.apiOrigin) === 'http://127.0.0.1:17100'
    && api.loopbackEndpoint(generator.tunnel?.controlOrigin) === 'http://127.0.0.1:' + snapshot?.controlPort);
  check('snapshotSchemaAndIdentity', () => {
    if (snapshot?.protocol !== 1 || snapshot.purpose !== 'isolated-loopback-generator-control-snapshot'
      || snapshot.partial !== true || snapshot.cleanupUnobserved !== true || snapshot.runId !== control?.standRunId
      || !integer(snapshot.controlPort, 1, 65535) || !integer(snapshot.preparedObservedAtMs, 1)
      || !integer(snapshot.resultsObservedAtMs, snapshot.preparedObservedAtMs) || snapshot.observedAtMs !== snapshot.resultsObservedAtMs) return false;
    prepared = api.parseStandPrepared(snapshot.prepared, control.standRunId, plan.clients, plan.gameProcesses);
    finished = api.parseStandFinished({ runId: generator?.runId, results: generator?.results }, control.standRunId, prepared, plan.seconds);
    return prepared.ready.length === plan.workers && finished.results.length === plan.workers && prepared.inputMode === 'browser-window';
  });
  check('readyAndResultsMatch', () => prepared !== undefined && finished !== undefined
    && equal(snapshot.prepared.ready, generator.ready) && equal(snapshot.results, generator.results)
    && equal(server.generators, generator.results) && equal(server.connectionPhase?.generators, generator.ready)
    && equal(snapshot.prepared.connectionPhase, generator.connectionPhase)
    && generator.results.every((value, index) => value.count === Math.floor(plan.clients / plan.workers) + (index < plan.clients % plan.workers ? 1 : 0)));
  check('sameHostProfile', () => api.parseStandHost(server?.host).hostFingerprint === api.parseStandHost(generator?.clientHost).hostFingerprint
    && api.parseStandHost(generator.serverHost).hostFingerprint === server.host.hostFingerprint
    && prepared?.clientHost.hostFingerprint === server.host.hostFingerprint
    && generator.differentReportedHosts === false && server.differentReportedHosts === false);
  check('embeddedServerMeasurementMatches', () => typeof generator?.serverReport?.ok === 'boolean'
    && generator.serverReport.ok === server?.ok
    && generator.serverReport.stand?.runId === control?.standRunId && generator.serverReport.bundle?.sha256 === plan.bundleSha256
    && generator.serverReport.targetClients === plan.clients && generator.serverReport.measurementSeconds === plan.seconds
    && generator.serverReport.gameProcesses === plan.gameProcesses && equal(generator.serverReport.summary, server?.summary)
    && equal(generator.serverReport.checks, server?.checks) && equal(generator.serverReport.generators, generator.results)
    && equal(generator.serverReport.inputDelivery, server?.inputDelivery));
  check('independentGeneratorMeasurementsPassed', () => finished !== undefined && sum(finished.results, 'count') === plan.clients
    && finished.results.every(value => value.connectedClients === value.count && value.errorCount === 0
      && value.durationSeconds >= plan.seconds * .99 && value.durationSeconds <= plan.seconds + 15
      && value.inputMode === 'browser-window' && value.inputPacketsPerSecond / (value.count * 30) * 100 >= 99
      && value.ackMs.count > 0 && value.ackMs.p95 <= 250 && value.ackMs.p99 <= 500 && value.unacknowledgedPackets === 0
      && value.tracking?.latencyTimingSamplesDropped === 0 && value.tracking.residualCountsExact === true));
  check('serverSummaryConsistent', () => {
    if (!finished || !object(server?.summary)) return false;
    const reported = server.summary, results = finished.results, near = (actual, expected) => finite(actual) && Math.abs(actual - expected) <= .02;
    return reported.connectedClients === sum(results, 'connectedClients') && reported.errorCount === sum(results, 'errorCount')
      && near(reported.inputPacketsPerSecond, sum(results, 'inputPacketsPerSecond'))
      && near(reported.inputRateTargetPercent, sum(results, 'inputPacketsPerSecond') / (plan.clients * 30) * 100)
      && Array.isArray(reported.inputRateTargetPercentByGenerator) && reported.inputRateTargetPercentByGenerator.length === plan.workers
      && reported.inputRateTargetPercentByGenerator.every((rate, index) => near(rate, results[index].inputPacketsPerSecond / (results[index].count * 30) * 100))
      && equal(reported.ackP95MsByGenerator, results.map(value => value.ackMs.p95))
      && equal(reported.ackP99MsByGenerator, results.map(value => value.ackMs.p99))
      && reported.maxAckMs === Math.max(...results.map(value => value.ackMs.max))
      && reported.unacknowledgedAfterDrain === sum(results, 'unacknowledgedPackets')
      && reported.unacknowledgedAtEndOfSending === sum(results, 'unacknowledgedAtEndOfSending');
  });
  check('generatorFullReportValid', () => finished !== undefined && checks.generatorIdentityAndAttestation
    && checks.readyAndResultsMatch && typeof generator?.ok === 'boolean' && object(generator.cleanup)
    && typeof generator.cleanup.passed === 'boolean' && Array.isArray(generator.cleanup.failures)
    && generator.cleanup.failures.length <= plan.workers && generator.cleanup.failures.every(value => typeof value === 'string')
    && Array.isArray(generator.childExits) && generator.childExits.length === plan.workers
    && new Set(generator.childExits.map(value => value.generator)).size === plan.workers
    && generator.childExits.every(value => integer(value.generator, 0, plan.workers - 1)
      && (integer(value.code, 0, 255) && value.signal === null || value.code === null && typeof value.signal === 'string')
      && typeof value.duringCleanup === 'boolean'));
  check('generatorLifecycleClean', () => checks.generatorFullReportValid && clean(generator.cleanup)
    && new Set(generator.childExits.map(value => value.generator)).size === plan.workers
    && generator.childExits.every(value => integer(value.generator, 0, plan.workers - 1) && value.code === 0
      && value.signal === null && value.duringCleanup === true));
  check('generatorFullReportAndExit', () => checks.generatorLifecycleClean && generator?.ok === true
    && !generator.failure && control?.generatorExitCode === 0);
  check('generatorCompletionDigest', () => {
    const marker = control?.generatorCompletion;
    return marker?.protocol === 1 && marker.purpose === 'isolated-generator-completion' && marker.runId === control.standRunId
      && marker.bundleSha256 === plan.bundleSha256 && integer(control?.generatorExitCode, 0, 255)
      && marker.generatorExitCode === control.generatorExitCode && Buffer.isBuffer(generatorBytes)
      && marker.reportSha256 === hash(generatorBytes) && marker.reportBytes === generatorBytes.length;
  });
  check('serverCleanup', () => clean(server?.cleanup));
  check('ownedControlCleanup', () => control?.controlCompleted === true && control.monitorExitCode === 0
    && control.ownedChildCommandsStopped === true && control.temporaryControlAssetsRemoved === true
    && control.stop?.runId === plan.runId && control.stop.containerId === control.containerId
    && control.stop.stopConfirmed === true && control.stop.privateFixtureGone === true);
  check('supervisorCompleted', () => state?.runId === plan.runId && state.containerId === control?.containerId
    && state.phase === 'ended' && state.reason === 'container-ended' && state.passed === true
    && state.stopConfirmed === true && state.privateFixtureGone === true);
  check('guardianCompleted', () => guardian?.runId === plan.runId && guardian.containerId === control?.containerId
    && guardian.phase === 'ended' && guardian.reason === 'supervisor-completed'
    && guardian.stopConfirmed === true && guardian.privateFixtureGone === true);
  check('finalContainerIdentityAndCleanup', () => {
    const final = control?.finalStatus;
    return final?.runId === plan.runId && final.targetHost === plan.targetHost && final.containerId === control.containerId
      && final.imageId === plan.imageId && final.bundleSha256 === plan.bundleSha256 && final.metadataSha256 === plan.metadataSha256
      && equal(final.budget, plan.budget) && final.phase === 'ended' && final.containerState === 'exited'
      && final.reason === 'container-ended' && final.passed === true && final.stopConfirmed === true && final.privateFixtureGone === true;
  });
  check('resourceCoverage', () => {
    coverage = resourceCoverage({ remotePlan: plan }, server, resourceSummary, resourceSamples, control?.containerId);
    return coverage.fullIntervalObserved === true && coverage.fullCounterRangeBracketed === true;
  });
  check('noObservedOom', () => Array.isArray(resourceSamples) && resourceSamples.length >= 3
    && resourceSamples.every(row => row.container?.oomKilled === false && (!row.cgroup
      || row.cgroup.memoryEvents?.oom === 0 && row.cgroup.memoryEvents?.oom_kill === 0)));
  check('serverTrafficComplete', () => {
    if (!finished || !equal(Object.keys(server?.roomTrafficDiagnostics ?? {}).sort(), owners(plan.gameProcesses).sort())) return false;
    const rooms = Object.values(server.roomTrafficDiagnostics);
    const fields = ['inputFrames', 'decodedInputSequences', 'queueAcceptedSteps', 'queueAdvancedRemovals', 'queueCancelledRemovals',
      'receivedSequencesCoveredByInputSeq', 'limiterHits', 'diagnosticErrors', 'maxQueuedStepsPerClient'];
    if (rooms.some(value => fields.some(key => !integer(value[key])) || !integer(value.pending?.queuedSteps)
      || !integer(value.pending?.receivedSequencesAwaitingInputSeq) || !finite(value.receiveToInputSeqAge?.maxMs))) return false;
    const steps = finished.results.map(value => value.sentInputSteps);
    if (steps.some(value => !integer(value))) return false;
    traffic = { sentFrames: sum(finished.results, 'packetsSent'), receivedFrames: sum(rooms, 'inputFrames'),
      sentSteps: steps.reduce((total, value) => total + value, 0), receivedSteps: sum(rooms, 'decodedInputSequences'),
      acceptedSteps: sum(rooms, 'queueAcceptedSteps'), advancedSteps: sum(rooms, 'queueAdvancedRemovals'),
      cancelledSteps: sum(rooms, 'queueCancelledRemovals'), coveredSteps: sum(rooms, 'receivedSequencesCoveredByInputSeq'),
      limiterHits: sum(rooms, 'limiterHits'), diagnosticErrors: sum(rooms, 'diagnosticErrors'),
      finalQueuedSteps: rooms.reduce((total, value) => total + value.pending.queuedSteps, 0),
      finalAwaitingInputSeq: rooms.reduce((total, value) => total + value.pending.receivedSequencesAwaitingInputSeq, 0),
      maxQueuedStepsPerClient: Math.max(...rooms.map(value => value.maxQueuedStepsPerClient)),
      maxReceiveToInputSeqMs: Math.max(...rooms.map(value => value.receiveToInputSeqAge.maxMs)) };
    return traffic.sentFrames === traffic.receivedFrames && traffic.sentFrames === server.inputDelivery?.sentFrames
      && traffic.receivedFrames === server.inputDelivery.receivedFrames && server.inputDelivery.difference === 0
      && traffic.sentSteps === traffic.receivedSteps && traffic.receivedSteps === traffic.acceptedSteps
      && traffic.receivedSteps === traffic.advancedSteps && traffic.receivedSteps === traffic.coveredSteps
      && traffic.cancelledSteps === 0 && traffic.limiterHits === 0 && traffic.diagnosticErrors === 0
      && traffic.finalQueuedSteps === 0 && traffic.finalAwaitingInputSeq === 0;
  });
  if (finished) summary = {
    connectedClients: sum(finished.results, 'connectedClients'), errorCount: sum(finished.results, 'errorCount'),
    inputPacketsPerSecond: sum(finished.results, 'inputPacketsPerSecond'),
    ratePercentByGenerator: finished.results.map(value => value.inputPacketsPerSecond / (value.count * 30) * 100),
    worstAckP95Ms: Math.max(...finished.results.map(value => value.ackMs.p95)),
    worstAckP99Ms: Math.max(...finished.results.map(value => value.ackMs.p99)),
    maxAckMs: Math.max(...finished.results.map(value => value.ackMs.max)), drainResidual: sum(finished.results, 'unacknowledgedPackets'),
  };
  if (checks.resourceCoverage) {
    const live = resourceSamples.filter(value => value.container.status === 'running'), first = live[0], last = live.at(-1);
    const rates = live.slice(1).map((value, index) => (value.cgroup.cpu.usage_usec - live[index].cgroup.cpu.usage_usec)
      / ((value.sampledAtMs - live[index].sampledAtMs) * 1000));
    resources = { sampleCount: resourceSamples.length, liveCounterSamples: live.length, peakObservedCpuCores: Math.max(...rates),
      peakObservedMemoryMiB: Math.max(...live.map(value => value.cgroup.memoryCurrentBytes)) / 1024 ** 2,
      firstThrottleCount: first.cgroup.cpu.nr_throttled, lastThrottleCount: last.cgroup.cpu.nr_throttled,
      throttledUsecIncrease: last.cgroup.cpu.throttled_usec - first.cgroup.cpu.throttled_usec,
      definition: 'Observed discrete lifecycle peaks include game, database, Caddy aliases and SDK generators in one cgroup. They do not prove continuous peaks, distributed capacity or network quality.' };
  }
  const ok = Object.values(checks).every(value => value === true);
  return { protocol: 1, kind: 'same-container-loopback-assessment', runId: plan.runId,
    standRunId: uuid.test(control?.standRunId ?? '') ? control.standRunId : null,
    productionTraffic: false, clients: plan.clients, seconds: plan.seconds, gameProcesses: plan.gameProcesses, workers: plan.workers,
    capacityConfirmed: false, ok, advanceAllowed: ok, measurementPassed: checks.serverChecksPassed && checks.independentGeneratorMeasurementsPassed
      && checks.serverTrafficComplete, completeGeneratorReport: checks.generatorFullReportValid && checks.generatorCompletionDigest,
    generatorLifecycleClean: checks.generatorLifecycleClean, generatorSucceeded: checks.generatorFullReportAndExit,
    generatorExitCode: integer(control?.generatorExitCode, 0, 255) ? control.generatorExitCode : null,
    verdict: ok ? 'passed-preliminary-same-container-profile' : 'failed-or-incomplete-preliminary-same-container-profile',
    checks, readFailures, summary: summary ?? null, trafficObservations: traffic ?? null,
    resourceCoverage: coverage ?? null, resourceObservations: resources ?? null,
    sourcePins: Object.fromEntries(['imageId', 'bundleSha256', 'metadataSha256', 'helperSha256', 'controlSha256',
      'snapshotSourceSha256', 'generatorMetadataSha256'].map(key => [key, plan[key]])), artifactInputs,
    interpretation: 'This preliminary same-host profile shares the server budget with SDK generators and uses loopback. Even a complete PASS does not confirm public-network, recovery, mixed-API or 5000-player distributed capacity. Partial generator snapshots alone never allow advancement.' };
}

async function boundedFile(path, maximum) {
  let fd;
  try {
    fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum) refuse('artifact-file-refused');
    let size = 0;
    const chunks = [];
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, maximum + 1 - size));
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maximum) refuse('artifact-byte-budget');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally { await fd?.close(); }
}
export async function assessLoopbackDirectory(directory) {
  const root = resolve(directory), info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) refuse('canonical-artifact-directory-required');
  const records = {}, artifactInputs = [], readFailures = [];
  for (const [key, name, maximum] of artifactSpecs) {
    try {
      const bytes = await boundedFile(join(root, name), maximum);
      artifactInputs.push({ file: name, sha256: hash(bytes), bytes: bytes.length });
      if (key === 'controlSource') records[key] = bytes;
      else if (key === 'resourceSamples') {
        const lines = bytes.toString('utf8').trim().split('\n');
        if (lines.length > 3301 || lines.some(line => Buffer.byteLength(line) > 8192)) refuse('artifact-jsonl-budget');
        records[key] = lines.map(line => JSON.parse(line));
      } else {
        records[key] = JSON.parse(bytes.toString('utf8'));
        if (key === 'generator') records.generatorBytes = bytes;
      }
      if (key !== 'controlSource' && /"(?:secret|tokens|password|authorization|sessionHash|Env|cmdline)"\s*:/i.test(bytes.toString('utf8'))) refuse('secret-bearing-artifact-refused');
    } catch (error) {
      delete records[key];
      readFailures.push({ file: name, code: error?.code === 'ENOENT' ? 'artifact-missing'
        : error instanceof SyntaxError ? 'artifact-invalid-json' : error instanceof AssessmentError ? error.code : 'artifact-unavailable' });
    }
  }
  const plan = validateLoopbackAssessmentPlan(records.plan);
  return assessLoopbackRecords(plan, records, { artifactInputs, readFailures });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/assess-loopback-stand.mjs --artifacts /absolute/run-directory\nReads the exported nonsecret plan.json and saved loopback artifacts only. Writes a fresh assessment.json. Exit 0 requires a complete preliminary same-host PASS; distributed capacity stays unconfirmed.');
    return;
  }
  if (args.length !== 2 || args[0] !== '--artifacts' || !args[1] || args[1].startsWith('--')) refuse('invalid-assessment-cli');
  const result = await assessLoopbackDirectory(args[1]);
  await writeFile(join(resolve(args[1]), 'assessment.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ runId: result.runId, ok: result.ok, advanceAllowed: result.advanceAllowed, verdict: result.verdict,
    failedChecks: Object.keys(result.checks).filter(key => !result.checks[key]), readFailures: result.readFailures }));
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ ok: false, advanceAllowed: false, code: error instanceof AssessmentError ? error.code : 'assessment-runtime-failed' }));
  process.exitCode = 1;
});
