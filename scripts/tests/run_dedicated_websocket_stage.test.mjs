import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assessDedicatedStage, attestationCode, checkArtifactReadExitCode, checkOwnedStatus, checkTlsGatewayStatus, checkTlsProxyFinished, checkTlsProxyReady,
  classifyArtifactError,
  directTlsProxyConfig, HELPER_SHA256, PREVIOUS_HELPER_SHA256, LEGACY_HELPER_SHA256, localMeasurementWindow, MACHINE_SHA256,
  managedCommand, privateTemporaryDirectory, remoteArtifactReadCode, resourceCoverage, resourceMonitorCode, runDedicatedWebsocketStage, sshArguments,
  stopOwnedProcessGroup, stopOwnedTlsProxyProcessGroup, validateDedicatedStagePlan, validateTlsProxyDiagnostics,
  verifyManifest, verifyPublicCertificate } from '../run-dedicated-websocket-stage.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = 'a'.repeat(64), id = 'b'.repeat(64), runId = '11111111-1111-4111-8111-111111111111';
const standRunId = '22222222-2222-4222-8222-222222222222';
const remotePlan = { protocol: 1, targetHost: '31.56.189.118', runId, ownedRoot: '/opt/royal-load-' + runId,
  containerName: 'royal-load-' + runId + '-test', imageId: 'sha256:' + sha, metadataSha256: sha, bundleSha256: sha,
  machineIdSha256: MACHINE_SHA256, helperSha256: HELPER_SHA256, clients: 100, seconds: 15, gameProcesses: 20,
  budget: { cpus: 18, memoryMiB: 32768, pidsLimit: 2048 } };
const plan = { protocol: 1, remotePlan, workers: 4, localPorts: { api: [17100, 17102, 17103, 17104], control: 17101 },
  knownHostsFile: join(project, 'deployment/royal-load-known-hosts'), knownHostsSha256: sha, outputDir: '/private/tmp/stage-test-output' };
const manifest = { protocol: 1, role: 'isolated-test-stand', runId: standRunId, secret: 'c'.repeat(64),
  tokens: ['fixture-token'], apiEndpoint: 'http://127.0.0.1:17100', controlEndpoint: 'http://127.0.0.1:17101',
  serverApiPort: 21000, serverControlPort: 21001, bundleSha256: sha, clients: 100, seconds: 15, gameProcesses: 20,
  createdAt: Date.now(), expiresAt: Date.now() + 1000000 };
const bytes = Buffer.from(JSON.stringify(manifest)), digest = createHash('sha256').update(bytes).digest('hex');
const ready = { runId, targetHost: remotePlan.targetHost, phase: 'running', containerId: id, containerState: 'running',
  imageId: remotePlan.imageId, metadataSha256: sha, bundleSha256: sha, budget: remotePlan.budget,
  guardianActive: true, ready: true, cancelRequested: false, standRunId, manifestSha256: digest,
  clients: 100, seconds: 15, gameProcesses: 20, serverApiPort: 21000, serverControlPort: 21001 };
const initial = { ...ready, phase: 'not-started', containerId: null, containerState: 'missing', ready: false, guardianActive: false };
const state = { runId, containerId: id, phase: 'ended', passed: true, reason: 'container-ended', stopConfirmed: true, privateFixtureGone: true };
const guardian = { runId, phase: 'ended', reason: 'supervisor-completed', stopConfirmed: true, privateFixtureGone: true };
const resourceSummary = { runId, containerId: id, imageId: remotePlan.imageId, reason: 'container-ended', sampleCount: 17 };
const resourceSamples = Array.from({ length: 17 }, (_, index) => ({ sampledAtMs: 99000 + index * 1000, elapsedSeconds: index,
  container: { Id: id, Image: remotePlan.imageId, label: runId, status: index === 16 ? 'exited' : 'running' },
  hostMemAvailableBytes: 42, hostCpuJiffies: Array(8).fill(1000 + index),
  ...(index === 16 ? {} : { cgroup: { cpu: { usage_usec: 10000 + index * 1000, user_usec: 1000, system_usec: 1000,
    nr_periods: 10, nr_throttled: 0, throttled_usec: 0 }, memoryCurrentBytes: 1000000, memoryEvents: { oom_kill: 0 }, memoryStat: { anon: 10000 } } }) }));
const metrics = { samples: 1, observedSeconds: 15, intervals: [{ intervalStartedAt: 100000, sampledAt: 115000, intervalMs: 15000 }] };
const server = { ok: true, productionTraffic: false, targetClients: 100, measurementSeconds: 15, gameProcesses: 20,
  cleanup: { passed: true }, bundle: { sha256: sha }, stand: { runId: standRunId }, checks: { connections: true, generatorSustainedTarget: true },
  servers: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [index ? 'worker-' + index : 'main', metrics])),
  orchestrator: metrics, proxyResources: { ...metrics, intervals: [{ sampledAt: 115000, intervalMs: 15000 }] } };
const generator = { ok: true, productionTraffic: false, generatorOnly: true, sdkWebSocket: 'ws', runId: standRunId,
  bundleSha256: sha, targetClients: 100, seconds: 15, inputMode: 'browser-window',
  results: Array.from({ length: 4 }, () => ({ durationSeconds: 15, observationSeconds: 17, drainSeconds: 2 })),
  cleanup: { passed: true }, attestation: { control: true, gameApi: true, verifiedBeforeGenerators: true } };
const pending = () => new Promise(() => {});
test('current helper pin matches source and prior TLS helper remains explicitly supported', async () => {
  const source = await readFile(join(project, 'scripts/load-dedicated-stand.py'));
  assert.equal(createHash('sha256').update(source).digest('hex'), HELPER_SHA256);
  assert.equal(validateDedicatedStagePlan({ ...plan, remotePlan: { ...remotePlan,
    helperSha256: PREVIOUS_HELPER_SHA256 } }).remotePlan.helperSha256, PREVIOUS_HELPER_SHA256);
  assert.equal(validateDedicatedStagePlan({ ...tlsPlan, remotePlan: { ...tlsPlan.remotePlan,
    helperSha256: PREVIOUS_HELPER_SHA256 } }, { platform: 'darwin' }).remotePlan.helperSha256, PREVIOUS_HELPER_SHA256);
});
const handle = (done = pending()) => ({ child: { pid: 321 }, done, ended: false, stop: async () => true });
const proxySha = '341eb48ae3909de3cb909e01dff5ef5db9cb1f0857e098b95b4988a26500de12';
const tlsPlan = { ...plan, transport: 'direct-tls', directTls: { proxySha256: proxySha },
  remotePlan: { ...remotePlan, tlsGateway: { port: 26443, serverName: 'royal-load.test' } } };
const publicCertificate = '-----BEGIN CERTIFICATE-----\nRklYVFVSRQ==\n-----END CERTIFICATE-----\n';
const certificateSha = createHash('sha256').update(publicCertificate).digest('hex');
const gateway = { runId, containerId: id, port: 26443, serverName: 'royal-load.test', ready: true,
  closed: false, assetsRemoved: false, standRunId, certificateSha256: certificateSha, configSha256: sha, caddyPid: 5432, caddyStartTicks: '54321' };
const proxyFinal = { kind: 'finished', runId, reason: 'signal', cleanup: true, independentUpstreamPerLocalTcp: true,
  durationSeconds: 20, acceptedConnections: 104, rejectedConnections: 0, activeConnections: 0, peakConnections: 104,
  upstreamSocketsCreated: 104, tlsConnections: 104, completedConnections: 104, bytesToUpstream: 123456, bytesToLocal: 789123,
  errorCount: 0, errors: {}, resources: { cpuUserSeconds: 1, cpuSystemSeconds: 0.3, maxRssMiB: 23,
    eventLoopLag: { periodMs: 100, count: 200, sampleCount: 200, sampling: 'complete', p99Ms: 1.2, maxMs: 5 } } };
const proxyCounterKeys = ['acceptedConnections', 'rejectedConnections', 'activeConnections', 'peakConnections', 'upstreamSocketsCreated',
  'tlsConnections', 'completedConnections', 'bytesToUpstream', 'bytesToLocal', 'errorCount'];
const proxyRows = Array.from({ length: 53 }, (_, index) => ({ kind: index === 0 ? 'initial' : index === 52 ? 'final' : 'sample', runId,
  sampledAtMs: 99000 + index * 1000, intervalStartedAtMs: 99000 + Math.max(0, index - 1) * 1000,
  monotonicElapsedMs: index * 1000, intervalMs: index === 0 ? 0 : 1000,
  cpuUserSeconds: index === 0 ? 0 : 0.05, cpuSystemSeconds: index === 0 ? 0 : 0.01, cpuOneCorePercent: index === 0 ? 0 : 6,
  maxRssMiB: 23, counters: Object.fromEntries(proxyCounterKeys.map(key => [key, index === 0 ? 0 : proxyFinal[key]])),
  eventLoopLag: { count: index === 0 ? 0 : 10, sampleCount: index === 0 ? 0 : 10, sampling: 'complete', p99Ms: index === 0 ? 0 : 1.2, maxMs: index === 0 ? 0 : 5 } }));
const encodeProxyRows = rows => Buffer.from(rows.map(value => JSON.stringify(value)).join('\n') + '\n');
const diagnosticFinal = (rows = proxyRows) => { const data = encodeProxyRows(rows); return { ...proxyFinal,
  ...rows.at(-1).counters, errorDetails: {}, diagnostics: { periodMs: 1000, startedAtMs: rows[0].sampledAtMs,
    endedAtMs: rows.at(-1).sampledAtMs, rowCount: rows.length, rowsWritten: rows.length, bytesWritten: data.length,
    maxCpuOneCorePercent: 6, maxIntervalLagMs: 5, outputWritten: true } }; };
const fixtureArtifact = kind => Buffer.from(kind === 'resourceSamples' ? resourceSamples.map(row => JSON.stringify(row)).join('\n') + '\n'
  : JSON.stringify({ manifest, server, state, guardian, resourceSummary,
    tlsGateway: { ...gateway, imageId: remotePlan.imageId, phase: 'closed' } }[kind]));
const proxyReady = (config, pid = 321) => ({ kind: 'ready', ...config, pid, socketLimit: config.clientLimit + 64,
  requiredFds: 2 * (config.clientLimit + 64) + 128, fdSoftLimit: 1048575 });

test('plan pins only the dedicated host, exact UUID roots and frozen helper/machine', () => {
  assert.equal(validateDedicatedStagePlan(plan).identityFile, join(homedir(), '.ssh/royal_server_ed25519'));
  assert.equal(validateDedicatedStagePlan({ ...plan, remotePlan: { ...remotePlan, helperSha256: LEGACY_HELPER_SHA256 } }).remotePlan.helperSha256, LEGACY_HELPER_SHA256);
  for (const patch of [{ targetHost: '45.192.12.242' }, { runId: '../production' }, { ownedRoot: '/opt/royal' },
    { containerName: 'royal-game-1' }, { helperSha256: sha }, { machineIdSha256: sha }, { imageId: 'royal:latest' },
    { metadataSha256: 'bad' }, { gameProcesses: 25 }, { clients: 6001 }, { clients: 301, gameProcesses: 1 },
    { seconds: 1801 }, { extra: true }]) assert.throws(() => validateDedicatedStagePlan({ ...plan, remotePlan: { ...remotePlan, ...patch } }));
});
test('direct TLS requires explicit Darwin mode, gateway, source pin and exact four aliases', () => {
  const value = validateDedicatedStagePlan(tlsPlan, { platform: 'darwin' });
  assert.equal(value.transport, 'direct-tls'); assert.equal(value.directTls.proxySha256, proxySha);
  assert.equal(sshArguments(value).some(arg => arg.startsWith('ProxyCommand=')), false);
  for (const patch of [{ directTls: undefined }, { directTls: { proxySha256: 'bad' } },
    { directTls: { proxySha256: proxySha, pythonExecutable: '/tmp/python;evil' } },
    { workers: 5, localPorts: { api: [17100, 17102, 17103, 17104, 17105], control: 17101 } },
    { localPorts: { api: [18100, 18102, 18103, 18104], control: 17101 } },
    { remotePlan: { ...tlsPlan.remotePlan, helperSha256: LEGACY_HELPER_SHA256 } },
    { remotePlan: { ...tlsPlan.remotePlan, tlsGateway: { port: 26444, serverName: 'royal-load.test' } } }])
    assert.throws(() => validateDedicatedStagePlan({ ...tlsPlan, ...patch }, { platform: 'darwin' }));
  assert.throws(() => validateDedicatedStagePlan(tlsPlan, { platform: 'linux' }));
  assert.throws(() => validateDedicatedStagePlan({ ...plan, directTls: tlsPlan.directTls }));
  assert.throws(() => validateDedicatedStagePlan({ ...tlsPlan, transport: 'ssh' }));
});
test('private temp directory canonicalizes an aliased parent without loosening private permissions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'royal-temp-alias-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'canonical'), { mode: 0o700 }); await symlink(join(root, 'canonical'), join(root, 'alias'));
  const directory = await privateTemporaryDirectory(join(root, 'alias'));
  assert.equal(await realpath(directory), directory); assert.equal(directory.includes('/alias/'), false);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
});
test('only the pinned public certificate from the exact TLS gateway can be copied', () => {
  const certificate = { runId, containerId: id, certificateSha256: certificateSha, certificatePEM: publicCertificate };
  assert.equal(verifyPublicCertificate(tlsPlan, certificate, id, gateway).toString(), publicCertificate);
  for (const patch of [{ runId: standRunId }, { containerId: sha }, { certificateSha256: sha },
    { certificatePEM: publicCertificate + ' ' }, { certificatePEM: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' },
    { certificatePEM: '-----BEGIN CERTIFICATE-----\n' + 'A'.repeat(16384) + '\n-----END CERTIFICATE-----\n' }])
    assert.throws(() => verifyPublicCertificate(tlsPlan, { ...certificate, ...patch }, id, gateway));
  assert.equal(checkTlsGatewayStatus(tlsPlan, gateway, id, standRunId), gateway);
  for (const patch of [{ containerId: sha }, { standRunId: runId }, { caddyStartTicks: 'bad' }, { closed: true }, { configSha256: id }])
    assert.throws(() => checkTlsGatewayStatus(tlsPlan, { ...gateway, ...patch }, id, standRunId, gateway));
});
test('TLS failure diagnostics accept only helper fixed classifications without relaxing ready ownership', () => {
  const closed = { ...gateway, ready: false, closed: true, assetsRemoved: true,
    failureStage: 'caddy-start', failureCode: 'bounded-command-timeout' };
  assert.equal(checkTlsGatewayStatus(tlsPlan, closed, id, standRunId, gateway).failureCode, 'bounded-command-timeout');
  assert.equal(checkTlsGatewayStatus(tlsPlan, { ...closed, failureStage: 'tls-attestation', failureCode: 'tls-attestation-malformed-response' },
    id, standRunId, gateway).failureCode, 'tls-attestation-malformed-response');
  for (const patch of [{ failureStage: 'private-command-text' }, { failureCode: 'provider-secret' }, { containerId: sha },
    { certificateSha256: sha }, { ready: true }])
    assert.throws(() => checkTlsGatewayStatus(tlsPlan, { ...closed, ...patch }, id, standRunId, gateway));
});
test('proxy readiness pins certificate, interface, local listeners, PID and descriptor budget', () => {
  const config = directTlsProxyConfig(tlsPlan, '/private/tmp/fixture/certificate.pem', gateway), value = proxyReady(config);
  assert.equal(checkTlsProxyReady(config, value, 321).pid, 321);
  for (const patch of [{ pid: 322 }, { certSha256: sha }, { interface: 'utun7' }, { remoteHost: '45.192.12.242' },
    { listenPorts: [17100] }, { socketLimit: 6001 }, { requiredFds: 5 }, { fdSoftLimit: value.requiredFds - 1 }])
    assert.throws(() => checkTlsProxyReady(config, { ...value, ...patch }, 321));
});
test('proxy success requires clean final counters and meaningful bounded process resources', () => {
  assert.equal(checkTlsProxyFinished(tlsPlan, proxyFinal).tlsConnections, 104);
  for (const patch of [{ runId: standRunId }, { reason: 'session-expired' }, { cleanup: false }, { independentUpstreamPerLocalTcp: false },
    { activeConnections: 1 }, { errorCount: 1 }, { errors: { 'stream-failed': 1 } }, { rejectedConnections: 1 },
    { acceptedConnections: 10 }, { tlsConnections: 103 }, { upstreamSocketsCreated: 105 }, { peakConnections: 165 },
    { bytesToLocal: 0 }, { completedConnections: 105 }, { durationSeconds: Infinity },
    { resources: { ...proxyFinal.resources, eventLoopLag: { ...proxyFinal.resources.eventLoopLag, sampleCount: 201 } } }])
    assert.throws(() => checkTlsProxyFinished(tlsPlan, { ...proxyFinal, ...patch }));
});
test('local window distinguishes phase receipt, actual worker sends, drain and later report completion', () => {
  const value = localMeasurementWindow(plan, 100000, 150000, generator);
  assert.equal(value.nominalSendEndAtMs, 115000); assert.equal(value.estimatedSendEndAtMs, 115000);
  assert.equal(value.estimatedObservationEndAtMs, 117000); assert.equal(value.generatorCompletedAtMs, 150000);
  assert.deepEqual(value.reportedWorkerDrainSeconds, [2, 2, 2, 2]); assert.match(value.definition, /report transfer/);
  assert.equal(localMeasurementWindow(plan, null, 150000, generator).estimatedSendEndAtMs, null);
  assert.equal(localMeasurementWindow(plan, 100000, 150000, { results: [{}] }).reportedWorkerSendSeconds, null);
});
test('proxy diagnostics validate bounded exact safe schema and match cumulative final counters', () => {
  const window = localMeasurementWindow(plan, 100000, 150000, generator), data = encodeProxyRows(proxyRows);
  const value = validateTlsProxyDiagnostics(tlsPlan, data, diagnosticFinal(), window);
  assert.equal(value.rowCount, 53); assert.equal(value.localObservationPeriodBracketed, true);
  assert.equal(value.maximumSampledCpuOneCorePercent, 6); assert.equal(value.counters.activeConnections, 0);
  assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, data.subarray(0, data.length - 1), diagnosticFinal(), window));
  assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, Buffer.concat([data, Buffer.from('\n'.repeat(3302))]), diagnosticFinal(), window));
  assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, Buffer.alloc(8 * 1024 ** 2 + 1), diagnosticFinal(), window));
  assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, encodeProxyRows(Array(3303).fill(proxyRows[0])), diagnosticFinal(), window));
  for (const patch of [{ runId: standRunId }, { secret: 'DO_NOT_KEEP' }, { sampledAtMs: 99000 },
    { monotonicElapsedMs: 0 }, { intervalStartedAtMs: 42 },
    { counters: { ...proxyRows[5].counters, acceptedConnections: 1 } },
    { eventLoopLag: { ...proxyRows[5].eventLoopLag, sampleCount: 129 } }]) {
    const rows = proxyRows.map((row, index) => index === 5 ? { ...row, ...patch } : row);
    assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, encodeProxyRows(rows), diagnosticFinal(rows), window));
  }
  for (const patch of [{ bytesWritten: data.length + 1 }, { rowCount: 1 }, { outputWritten: false }])
    assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, data, { ...diagnosticFinal(), diagnostics: { ...diagnosticFinal().diagnostics, ...patch } }, window));
});
test('diagnostic final flush can share wall milliseconds and preserve classified failure without allowing PASS', () => {
  const rows = proxyRows.map((row, index) => index === proxyRows.length - 1 ? { ...row,
    sampledAtMs: proxyRows[index - 1].sampledAtMs, monotonicElapsedMs: proxyRows[index - 1].monotonicElapsedMs + 0.2,
    intervalMs: 0.2, counters: { ...row.counters, errorCount: 1 } } : row);
  const finished = { ...diagnosticFinal(rows), errorCount: 1, errors: { 'stream-failed': 1 }, errorDetails: { 'tls-handshake/timeout': 1 } };
  const value = validateTlsProxyDiagnostics(tlsPlan, encodeProxyRows(rows), finished, localMeasurementWindow(plan, 100000, 150000, generator));
  assert.deepEqual(value.errorDetails, { 'tls-handshake/timeout': 1 });
  assert.throws(() => checkTlsProxyFinished(tlsPlan, finished), /tls-proxy-final-mismatch/);
  assert.throws(() => validateTlsProxyDiagnostics(tlsPlan, encodeProxyRows(rows), { ...finished, errorDetails: { 'secret/payload': 1 } }, {}), /unsafe/);
  const missingStart = localMeasurementWindow(plan, 98000, 150000, generator);
  assert.equal(validateTlsProxyDiagnostics(tlsPlan, encodeProxyRows(rows), finished, missingStart).localObservationPeriodBracketed, false);
  const missingTail = localMeasurementWindow(plan, 140000, 160000, generator);
  assert.equal(validateTlsProxyDiagnostics(tlsPlan, encodeProxyRows(rows), finished, missingTail).localObservationPeriodBracketed, false);
});
test('resource budgets, workers and independently numerous transport ports are bounded', () => {
  for (const budget of [{ ...remotePlan.budget, cpus: 19 }, { ...remotePlan.budget, cpus: NaN },
    { ...remotePlan.budget, memoryMiB: 40961 }, { ...remotePlan.budget, pidsLimit: 2049 }, { ...remotePlan.budget, extra: true }])
    assert.throws(() => validateDedicatedStagePlan({ ...plan, remotePlan: { ...remotePlan, budget } }));
  const ports = Array.from({ length: 20 }, (_, index) => 17200 + index);
  assert.equal(validateDedicatedStagePlan({ ...plan, localPorts: { api: ports, control: 17101 } }).workers, 4);
  for (const localPorts of [{ api: ports.slice(0, 3), control: 17101 }, { api: [17100, 17100, 17103, 17104], control: 17101 },
    { api: ports, control: 17200 }, { api: Array.from({ length: 129 }, (_, i) => 18000 + i), control: 17101 }])
    assert.throws(() => validateDedicatedStagePlan({ ...plan, localPorts }));
});
test('direct interface has an exact Darwin-only ProxyCommand and no multiplexing', () => {
  for (const options of [{ platform: 'linux', directInterface: 'en0' }, { platform: 'darwin', directInterface: 'utun7' },
    { platform: 'darwin', directInterface: 'en0; echo secret' }]) assert.throws(() => validateDedicatedStagePlan(plan, options));
  const normalized = validateDedicatedStagePlan(plan, { platform: 'darwin', directInterface: 'en0' }), args = sshArguments(normalized);
  assert.ok(args.includes('ProxyCommand=/usr/bin/nc -4 -n -b en0 -G10 %h %p'));
  for (const value of ['StrictHostKeyChecking=yes', 'ControlMaster=no', 'ControlPath=none', 'ExitOnForwardFailure=yes', 'IdentityAgent=none']) assert.ok(args.includes(value));
  assert.deepEqual(args.slice(args.indexOf('-S'), args.indexOf('-S') + 2), ['-S', 'none']);
  assert.equal(sshArguments(validateDedicatedStagePlan(plan)).some(value => value.startsWith('ProxyCommand=')), false);
});
test('OpenSSH shell exec prefix works with sanitized environment and a mock network program', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-proxy-exec-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mock = join(directory, 'fake-nc');
  await writeFile(mock, '#!/bin/sh\nprintf \'%s\\n\' "proxy-executed" "$@"\n', { mode: 0o700 });
  const normalized = validateDedicatedStagePlan(plan, { platform: 'darwin', directInterface: 'en0' });
  const value = sshArguments(normalized).find(arg => arg.startsWith('ProxyCommand=')).slice('ProxyCommand='.length);
  assert.equal(value.startsWith('/usr/bin/nc '), true); assert.equal(value.includes('exec '), false);
  const escaped = "'" + mock.replaceAll("'", "'\\''") + "'";
  const command = value.replace('/usr/bin/nc', escaped).replace('%h', '31.56.189.118').replace('%p', '22');
  const env = { PATH: '/usr/bin:/bin', HOME: directory };
  // OpenSSH supplies this exec prefix itself. Only the temporary fake program runs.
  const result = spawnSync('/bin/sh', ['-c', 'exec ' + command], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), ['proxy-executed', '-4', '-n', '-b', 'en0', '-G10', '31.56.189.118', '22']);
  const duplicated = spawnSync('/bin/sh', ['-c', 'exec exec ' + command], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(duplicated.status, 127); assert.match(duplicated.stderr, /exec.*not found/);
  assert.equal(duplicated.stdout.includes('proxy-executed'), false);
});
test('reordered safe budgets work, changed container identity or guardian cannot be ready', () => {
  const normalized = validateDedicatedStagePlan(plan);
  assert.equal(checkOwnedStatus(normalized, { ...ready, budget: { pidsLimit: 2048, memoryMiB: 32768, cpus: 18 } }, id), id);
  for (const patch of [{ containerId: sha }, { imageId: 'sha256:' + id }, { guardianActive: false }, { cancelRequested: true },
    { gameProcesses: 4 }, { seconds: 16 }, { metadataSha256: id }]) assert.throws(() => checkOwnedStatus(normalized, { ...ready, ...patch }, id));
});
test('manifest digest and workload are checked before private bytes reach generators', () => {
  assert.equal(verifyManifest(plan, bytes, ready, value => value).runId, standRunId);
  assert.throws(() => verifyManifest(plan, Buffer.concat([bytes, Buffer.from(' ')]), ready, value => value), /manifest-digest/);
  const altered = Buffer.from(JSON.stringify({ ...manifest, clients: 101 })), alteredDigest = createHash('sha256').update(altered).digest('hex');
  assert.throws(() => verifyManifest(plan, altered, { ...ready, manifestSha256: alteredDigest }, value => value), /manifest-plan/);
});
test('group cleanup kills the owned ProxyCommand even when its SSH leader has exited', async () => {
  let running = true; const calls = [];
  const stopped = await stopOwnedProcessGroup({ pid: 4321, exitCode: 0, signalCode: null }, {
    kill(pid, signal) { calls.push([pid, signal]); if (!running) throw Object.assign(Error(), { code: 'ESRCH' }); if (signal === 'SIGKILL') running = false; },
    delay: async () => {}, attempts: 2 });
  assert.equal(stopped, true); assert.ok(calls.some(([pid, signal]) => pid === -4321 && signal === 'SIGTERM'));
  assert.ok(calls.some(([pid, signal]) => pid === -4321 && signal === 'SIGKILL'));
  assert.equal(calls.some(([pid]) => pid >= 0), false);
});
test('group cleanup does not declare success if children survive both signals', async () => {
  assert.equal(await stopOwnedProcessGroup({ pid: 4321 }, { kill() {}, delay: async () => {}, attempts: 1 }), false);
});
test('TLS proxy can emit a clean final report after six seconds without SIGKILL, other groups retain two seconds', async () => {
  const child = fakeChild(), calls = []; let elapsed = 0, running = true;
  const command = managedCommand('fake-python-proxy', [], { timeoutMs: 1000, spawnImpl: () => child,
    stopGroup: target => stopOwnedTlsProxyProcessGroup(target, {
      kill(pid, signal) {
        calls.push({ pid, signal, elapsed });
        if (!running) throw Object.assign(Error(), { code: 'ESRCH' });
        if (signal === 'SIGKILL') running = false;
      }, delay: async ms => {
        elapsed += ms;
        if (elapsed === 6000) { child.stdout.emit('data', Buffer.from(JSON.stringify(proxyFinal) + '\n'));
          running = false; child.emit('close', 0, null); }
      },
    }) });
  assert.equal(await command.stop(), true);
  const result = await command.done;
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout.toString()).cleanup, true);
  assert.equal(calls.some(value => value.signal === 'SIGKILL'), false); assert.equal(elapsed, 6000);
  assert.equal(calls.every(value => value.pid === -child.pid), true);
  let defaultElapsed = 0, defaultRunning = true;
  await stopOwnedProcessGroup({ pid: 445 }, { kill(_pid, signal) {
    if (!defaultRunning) throw Object.assign(Error(), { code: 'ESRCH' });
    if (signal === 'SIGKILL') { assert.equal(defaultElapsed, 2000); defaultRunning = false; }
  }, delay: async ms => { defaultElapsed += ms; } });
});
test('TLS proxy graceful timeout still forces its exact owned group after ten seconds', async () => {
  let elapsed = 0, running = true; const signals = [];
  const result = await stopOwnedTlsProxyProcessGroup({ pid: 446 }, { kill(pid, signal) {
    assert.equal(pid, -446); if (!running) throw Object.assign(Error(), { code: 'ESRCH' });
    if (signal) signals.push({ signal, elapsed }); if (signal === 'SIGKILL') running = false;
  }, delay: async ms => { elapsed += ms; } });
  assert.equal(result, true); assert.deepEqual(signals, [{ signal: 'SIGTERM', elapsed: 0 }, { signal: 'SIGKILL', elapsed: 10000 }]);
});
const fakeChild = () => {
  const child = new EventEmitter(); child.pid = 444;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {};
  return child;
};
test('bounded command timeout cleans its group without printing captured secrets', async () => {
  const child = fakeChild(); let stops = 0, options;
  const command = managedCommand('fake-ssh', [], { timeoutMs: 5, spawnImpl(_program, _args, config) { options = config; return child; },
    stopGroup: async target => { assert.equal(target, child); stops++; return true; } });
  child.stderr.emit('data', Buffer.from('secret must never be returned'));
  await assert.rejects(command.done, /bounded-command-timeout/);
  assert.equal(stops, 1); assert.equal(options.detached, true); assert.equal(options.env.NODE_ENV, undefined);
});
test('normal command exit also cleans group descendants and returns no stderr bytes', async () => {
  const child = fakeChild(); let stopped = false;
  const command = managedCommand('fake-ssh', [], { timeoutMs: 100, spawnImpl: () => child, stopGroup: async () => { stopped = true; return true; } });
  child.stdout.emit('data', Buffer.from('{}')); child.stderr.emit('data', Buffer.from('private')); child.emit('close', 0, null);
  const result = await command.done;
  assert.equal(stopped, true); assert.equal(result.stdout.toString(), '{}'); assert.equal(result.stderr, undefined); assert.equal(result.stderrBytes, 7);
});
test('proxy ready messages handle fragmented lines and reject oversized or invalid JSON with group cleanup', async () => {
  const child = fakeChild(), messages = [];
  const command = managedCommand('fake-python', [], { timeoutMs: 100, spawnImpl: () => child, stopGroup: async () => true,
    onMessage: value => messages.push(value) });
  child.stdout.emit('data', Buffer.from('{"kind":"rea'));
  child.stdout.emit('data', Buffer.from('dy","pid":444}\n{"kind":"finished"}\n'));
  child.emit('close', 0, null); await command.done;
  assert.deepEqual(messages, [{ kind: 'ready', pid: 444 }, { kind: 'finished' }]);
  for (const data of ['not-json\n', 'a'.repeat(16385)]) {
    const invalid = fakeChild(); let stopped = false;
    const failed = managedCommand('fake-python', [], { timeoutMs: 100, spawnImpl: () => invalid,
      stopGroup: async () => { stopped = true; return true; }, onMessage: () => {} });
    invalid.stdout.emit('data', Buffer.from(data));
    await assert.rejects(failed.done, /command-message-(rejected|limit)/); assert.equal(stopped, true);
  }
});
test('remote snippets whitelist files, pin IDs and use bounded resource data outside run bind', () => {
  const code = attestationCode(plan, id), monitor = resourceMonitorCode(plan, id);
  for (const value of ['O_NOFOLLOW', 'machine-identity-mismatch', 'remote-plan-mismatch', 'helper-digest-mismatch', 'pinned-container-changed']) assert.ok(code.includes(value));
  assert.ok(monitor.includes("root/'resource-monitor.jsonl'")); assert.ok(monitor.includes("base/'cpu.stat'"));
  assert.equal(monitor.includes('.Config.Env'), false); assert.equal(monitor.includes('/cmdline'), false);
  assert.equal(monitor.includes('docker stop'), false); assert.equal(monitor.includes('docker kill'), false);
});
test('artifact copy reports fixed exit categories and never saves exception text or private paths', () => {
  checkArtifactReadExitCode(0);
  for (const [exit, classification, code] of [[255, 'unavailable', 'artifact-ssh-transport-failed'],
    [44, 'missing', 'artifact-remote-not-found'], [45, 'rejected', 'artifact-remote-access-denied'],
    [46, 'rejected', 'artifact-remote-policy-refused'], [47, 'unavailable', 'artifact-remote-read-failed'],
    [1, 'unavailable', 'artifact-remote-command-failed']]) {
    try { checkArtifactReadExitCode(exit); assert.fail('expected nonzero rejection'); }
    catch (error) { assert.deepEqual(classifyArtifactError(error, 'copy'), { classification, code }); }
  }
  assert.deepEqual(classifyArtifactError(Object.assign(Error('PRIVATE /path/env'), { code: 'ENOENT' }), 'read'),
    { classification: 'missing', code: 'artifact-local-not-found' });
  assert.deepEqual(classifyArtifactError(new SyntaxError('PRIVATE TOKEN in malformed JSON'), 'parse'),
    { classification: 'rejected', code: 'artifact-invalid-json' });
  assert.equal(JSON.stringify(classifyArtifactError(Error('PRIVATE TOKEN'), 'copy')).includes('PRIVATE'), false);
  const code = remoteArtifactReadCode(tlsPlan, 'tlsGateway', id);
  assert.match(code, /except FileNotFoundError:\n sys.exit\(44\)/); assert.match(code, /sys.exit\(46\)/);
  assert.equal(code.includes('keySha256'), false); assert.equal(code.includes('tls-gateway.key.pem'), false);
});
test('generated artifact read wrapper classifies fake Python failures without a traceback or private output', () => {
  const complete = remoteArtifactReadCode(plan, 'resourceSummary', id), body = complete.slice(complete.lastIndexOf('\ntry:\n') + 1);
  const python = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  for (const [exception, expected] of [['FileNotFoundError', 44], ['PermissionError', 45], ['RuntimeError', 46], ['ValueError', 47]]) {
    // The attestation is not executed; the replacement reader only throws a fake exception.
    const prelude = 'import sys,json\nfrom pathlib import Path\nroot=Path("/unused-owned-fixture")\ndef private(*args):\n raise ' + exception + '("PRIVATE TOKEN /sensitive/path")\n';
    const result = spawnSync(python, ['-B', '-c', prelude + body], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, expected); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  }
});
test('resource coverage requires cgroup counters and brackets every process metric epoch', () => {
  const valid = resourceCoverage(plan, server, resourceSummary, resourceSamples, id);
  assert.equal(valid.fullIntervalObserved, true); assert.equal(valid.requiredStartMs, 100000); assert.equal(valid.requiredEndMs, 115000);
  const checks = [resourceSamples.slice(2), resourceSamples.slice(0, -1), [resourceSamples.at(-1)],
    resourceSamples.map((row, index) => index === 5 ? { ...row, cgroup: undefined } : row)];
  for (const rows of checks) assert.equal(resourceCoverage(plan, server, { ...resourceSummary, sampleCount: rows.length }, rows, id).fullIntervalObserved, false);
  assert.equal(resourceCoverage(plan, { ...server, proxyResources: undefined }, resourceSummary, resourceSamples, id).fullIntervalObserved, false);
  const later = { ...server, orchestrator: { ...metrics, intervals: [{ intervalStartedAt: 110000, sampledAt: 116000, intervalMs: 6000 }] } };
  assert.equal(resourceCoverage(plan, later, resourceSummary, resourceSamples, id).fullIntervalObserved, false);
});
test('terminal state coverage does not claim that live cumulative counters cover the final tail', () => {
  const coverage = resourceCoverage(plan, server, resourceSummary, resourceSamples, id);
  assert.equal(coverage.fullIntervalObserved, true);
  assert.equal(coverage.firstLiveCounterMs, 99000); assert.equal(coverage.lastLiveCounterMs, 114000);
  assert.equal(coverage.unobservedCounterTailMs, 1000); assert.equal(coverage.fullCounterRangeBracketed, false);
  assert.match(coverage.definition, /do not establish continuous CPU or memory peaks/);
  const extended = resourceSamples.map((row, index) => ({ ...row, sampledAtMs: row.sampledAtMs + (index >= 15 ? 1000 : 0),
    elapsedSeconds: row.elapsedSeconds + (index >= 15 ? 1 : 0) }));
  const complete = resourceCoverage(plan, server, resourceSummary, extended, id);
  assert.equal(complete.fullIntervalObserved, true); assert.equal(complete.lastLiveCounterMs, 115000);
  assert.equal(complete.unobservedCounterTailMs, 0); assert.equal(complete.fullCounterRangeBracketed, true);
});
test('resource timeline rejects regressions, gaps and counter resets', () => {
  for (const patch of [{ sampledAtMs: 99000 }, { elapsedSeconds: 0 }, { sampledAtMs: 110001 },
    { cgroup: { ...resourceSamples[5].cgroup, cpu: { ...resourceSamples[5].cgroup.cpu, usage_usec: 1 } } }]) {
    const rows = resourceSamples.map((row, index) => index === 5 ? { ...row, ...patch } : row);
    assert.equal(resourceCoverage(plan, server, resourceSummary, rows, id).fullIntervalObserved, false);
  }
  const sparse = resourceSamples.filter((_, index) => index < 5 || index > 8);
  assert.equal(resourceCoverage(plan, server, { ...resourceSummary, sampleCount: sparse.length }, sparse, id).fullIntervalObserved, false);
});
test('bounded metric tails use whole-epoch duration to reject missing early resource samples', () => {
  const tail = { samples: 15, observedSeconds: 15, intervals: [{ intervalStartedAt: 114000, sampledAt: 115000, intervalMs: 1000 }] };
  const boundedServer = { ...server, servers: Object.fromEntries(Object.keys(server.servers).map(key => [key, tail])), orchestrator: tail, proxyResources: tail };
  assert.equal(resourceCoverage(plan, boundedServer, resourceSummary, resourceSamples, id).fullIntervalObserved, true);
  const rows = resourceSamples.slice(5);
  assert.equal(resourceCoverage(plan, boundedServer, { ...resourceSummary, sampleCount: rows.length }, rows, id).fullIntervalObserved, false);
});
test('progress exposes only bounded counts and phases, never raw stderr or payload', async () => {
  const child = fakeChild(), updates = [];
  const command = managedCommand('fake-node', [], { timeoutMs: 100, spawnImpl: () => child, stopGroup: async () => true, onProgress: value => updates.push(value) });
  child.stderr.emit('data', Buffer.from(JSON.stringify({ phase: 'measure', clients: 100, seconds: 15, workers: 4, secret: 'PRIVATE', tokens: ['TOKEN'] }) + '\n'));
  child.stderr.emit('data', Buffer.from('private unstructured account text\n'));
  child.emit('close', 0, null); await command.done;
  assert.deepEqual(updates, [{ phase: 'measure', clients: 100, seconds: 15, workers: 4 }]);
});

async function fixture(t, overrides = {}, changes = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'royal-dedicated-runner-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const local = { ...plan, outputDir: join(directory, 'output'), ...changes }, actions = [], tunnels = [], stopped = [];
  let generated = false, privateManifest, initialStatus = true, remoteStopped = false, proxyConfig, proxyConfigPath;
  const dependencies = {
    contract: { parseStandManifest: value => value }, pins: async () => {}, availablePort: async () => {}, delay: async () => {},
    attest: async () => {},
    remote: async (action, expectedId, signal) => {
      actions.push({ action, expectedId, aborted: signal?.aborted });
      if (action === 'status' && initialStatus) { initialStatus = false; return initial; }
      if (action === 'start') return { runId, phase: 'creating' };
      if (action === 'stop') { remoteStopped = true; return { stopConfirmed: true, privateFixtureGone: true }; }
      if (['tls-start', 'tls-status'].includes(action)) return remoteStopped ? { ...gateway, ready: false, closed: true, assetsRemoved: true } : gateway;
      if (action === 'tls-certificate') return { runId, containerId: id, certificateSha256: certificateSha, certificatePEM: publicCertificate };
      return generated ? { ...ready, phase: 'ended', containerState: 'exited', ready: false, stopConfirmed: true, privateFixtureGone: true, passed: true } : ready;
    },
    copy: async kind => fixtureArtifact(kind),
    monitor: async () => handle(Promise.resolve({ code: 0 })),
    tunnel: async (index, args) => { tunnels.push({ index, args }); const result = handle(); result.stop = async () => { stopped.push(index); return true; }; return result; },
    tlsProxy: async (configPath, outputPath, config, _signal, diagnosticsPath) => {
      proxyConfig = config; proxyConfigPath = configPath;
      assert.equal(await realpath(configPath), configPath); assert.equal(await realpath(config.publicCertPath), config.publicCertPath);
      assert.equal((await lstat(configPath)).mode & 0o777, 0o600); assert.equal((await lstat(dirname(configPath))).mode & 0o777, 0o700);
      assert.equal((await lstat(config.publicCertPath)).mode & 0o777, 0o600);
      assert.equal(await realpath(dirname(outputPath)), dirname(outputPath));
      assert.equal(await readFile(config.publicCertPath, 'utf8'), publicCertificate);
      let finish; const result = handle(new Promise(resolve => { finish = resolve; }));
      result.stop = async () => { await writeFile(outputPath, JSON.stringify(diagnosticFinal()), { flag: 'wx', mode: 0o600 });
        await writeFile(diagnosticsPath, encodeProxyRows(proxyRows), { flag: 'wx', mode: 0o600 }); finish({ code: 0 }); return true; };
      return { handle: result, ready: Promise.resolve(proxyReady(config)) };
    },
    command: (program, args, options) => {
      assert.equal(program, process.execPath); assert.ok(options.signal);
      const reportPath = args[args.indexOf('--output') + 1]; privateManifest = args[args.indexOf('--manifest') + 1];
      return handle((async () => { assert.equal((await lstat(privateManifest)).mode & 0o777, 0o600);
        assert.deepEqual(JSON.parse(await readFile(privateManifest, 'utf8')), manifest);
        options.onProgress?.({ phase: 'measure' });
        await writeFile(reportPath, JSON.stringify(generator)); generated = true; return { code: 0 }; })());
    },
    wallNow: (() => { let first = true; return () => { const value = first ? 100000 : 150000; first = false; return value; }; })(),
    ...overrides,
  };
  const result = await runDedicatedWebsocketStage(local, dependencies);
  return { result, actions, tunnels, stopped, directory, local, privateManifest, proxyConfig, proxyConfigPath };
}
test('complete mocked lifecycle uses independent transports and cleans every private fixture', async t => {
  const { result, actions, tunnels, stopped, privateManifest, directory } = await fixture(t, {},
    { localPorts: { api: Array.from({ length: 20 }, (_, index) => 17200 + index), control: 17101 } });
  assert.equal(result.ok, true); assert.equal(result.transports, 20); assert.equal(result.workers, 4); assert.equal(tunnels.length, 20);
  assert.equal(tunnels.filter(item => item.args.includes('127.0.0.1:17101:127.0.0.1:21001')).length, 1);
  assert.equal(stopped.length, 20); assert.equal(actions.at(-2).action, 'stop'); assert.equal(actions.at(-2).expectedId, id);
  await assert.rejects(lstat(privateManifest), { code: 'ENOENT' });
  const outcome = await readFile(join(directory, 'output/outcome.json'), 'utf8');
  assert.equal(outcome.includes(manifest.secret), false); assert.equal(outcome.includes('fixture-token'), false);
});
const tlsChanges = { transport: tlsPlan.transport, directTls: tlsPlan.directTls, remotePlan: tlsPlan.remotePlan };
test('direct TLS mocked lifecycle uses exactly one control SSH and four attested API listeners before SDK', async t => {
  let attestations = 0;
  const { result, tunnels, actions, proxyConfig, proxyConfigPath, privateManifest, directory } = await fixture(t,
    { platform: 'darwin', attest: async current => { attestations++; assert.deepEqual(current.localPorts.api, [17100, 17102, 17103, 17104]); } }, tlsChanges);
  assert.equal(result.ok, true); assert.equal(result.transport, 'direct-tls'); assert.equal(result.sshGameCarriers, 0);
  assert.equal(result.sshControlCarriers, 1); assert.equal(tunnels.length, 1); assert.equal(attestations, 1);
  assert.deepEqual(tunnels[0].args.filter(arg => arg.startsWith('127.0.0.1:')), ['127.0.0.1:17101:127.0.0.1:21001']);
  assert.deepEqual(proxyConfig.listenPorts, [17100, 17102, 17103, 17104]); assert.equal(proxyConfig.remotePort, 26443);
  assert.equal(result.tlsProxyReadyValidated, true); assert.equal(result.tlsProxyFinalValidated, true);
  assert.equal(result.tlsProxyFinal.activeConnections, 0); assert.equal(result.tlsGatewayFinal.assetsRemoved, true);
  assert.equal(result.localMeasurementWindow.measurePhaseObservedAtMs, 100000);
  assert.equal(result.localMeasurementWindow.generatorCompletedAtMs, 150000);
  assert.equal(result.tlsProxyDiagnostics.rowCount, 53); assert.equal(result.tlsProxyDiagnostics.localObservationPeriodBracketed, true);
  assert.equal(actions.filter(({ action }) => action === 'tls-certificate').length, 1);
  for (const path of [privateManifest, proxyConfigPath, proxyConfig.publicCertPath]) await assert.rejects(lstat(path), { code: 'ENOENT' });
  for (const file of ['outcome.json', 'tlsGateway.json', 'direct-tls-proxy.json']) {
    const text = await readFile(join(directory, 'output', file), 'utf8');
    assert.equal(text.includes(manifest.secret), false); assert.equal(text.includes('fixture-token'), false);
    assert.equal(text.includes('PRIVATE KEY'), false);
  }
});
test('one proven SSH artifact failure retries the same pinned read and records recovery', async t => {
  let reads = 0; const { result } = await fixture(t, { copy: async (kind, expectedId) => {
    if (kind === 'resourceSummary') { assert.equal(expectedId, id); if (++reads === 1) checkArtifactReadExitCode(255); }
    return fixtureArtifact(kind);
  } });
  assert.equal(result.ok, true); assert.equal(reads, 2); assert.deepEqual(result.artifactErrors, []);
  assert.deepEqual(result.artifactRetries, [{ artifact: 'resourceSummary', code: 'artifact-ssh-transport-failed', readRecovered: true }]);
});
test('artifact retry budget is global and never retries absent files or ownership policy failures', async t => {
  const reads = new Map(); const { result } = await fixture(t, { copy: async kind => {
    reads.set(kind, (reads.get(kind) ?? 0) + 1);
    if (['server', 'state', 'resourceSummary'].includes(kind)) checkArtifactReadExitCode(255);
    if (kind === 'guardian') checkArtifactReadExitCode(46);
    if (kind === 'resourceSamples') checkArtifactReadExitCode(44);
    return fixtureArtifact(kind);
  } });
  assert.equal(reads.get('server'), 2); assert.equal(reads.get('state'), 2); assert.equal(reads.get('resourceSummary'), 1);
  assert.equal(reads.get('guardian'), 1); assert.equal(reads.get('resourceSamples'), 1);
  assert.equal(result.artifactRetries.length, 2); assert.equal(result.artifactRetries.every(value => value.readRecovered === false), true);
  assert.equal(result.rejectedArtifacts.includes('guardian'), true); assert.equal(result.missingArtifacts.includes('guardian'), false);
  assert.equal(result.missingArtifacts.includes('resourceSamples'), true); assert.equal(result.ok, false);
});
test('malformed copied JSON is rejected without being labeled missing or logging its body', async t => {
  const { result } = await fixture(t, { copy: async kind => kind === 'resourceSummary' ? Buffer.from('{PRIVATE TOKEN') : fixtureArtifact(kind) });
  assert.equal(result.rejectedArtifacts.includes('resourceSummary'), true); assert.equal(result.missingArtifacts.includes('resourceSummary'), false);
  assert.deepEqual(result.artifactErrors.find(value => value.artifact === 'resourceSummary'),
    { artifact: 'resourceSummary', stage: 'parse', classification: 'rejected', code: 'artifact-invalid-json' });
  assert.equal(JSON.stringify(result).includes('PRIVATE TOKEN'), false); assert.equal(result.checks.artifactsComplete, false);
});
test('existing proxy error report is rejected rather than missing, retaining safe sidecar failure facts', async t => {
  const rows = proxyRows.map((row, index) => index === proxyRows.length - 1 ? { ...row, counters: { ...row.counters, errorCount: 45 } } : row);
  const failed = { ...diagnosticFinal(rows), errors: { 'stream-failed': 45 }, errorDetails: { 'to-upstream-read/connection-reset': 45 } };
  const { result, directory } = await fixture(t, { platform: 'darwin', tlsProxy: async (_configPath, outputPath, config, _signal, diagnosticsPath) => {
    let complete; const value = handle(new Promise(resolve => { complete = resolve; }));
    value.stop = async () => { await writeFile(outputPath, JSON.stringify(failed), { mode: 0o600, flag: 'wx' });
      await writeFile(diagnosticsPath, encodeProxyRows(rows), { mode: 0o600, flag: 'wx' }); complete({ code: 1 }); return true; };
    return { handle: value, ready: Promise.resolve(proxyReady(config)) };
  } }, tlsChanges);
  assert.equal(result.rejectedArtifacts.includes('tlsProxy'), true); assert.equal(result.missingArtifacts.includes('tlsProxy'), false);
  assert.deepEqual(result.artifactErrors.find(value => value.artifact === 'tlsProxy'),
    { artifact: 'tlsProxy', stage: 'validate', classification: 'rejected', code: 'tls-proxy-final-mismatch' });
  assert.equal(result.tlsProxyDiagnostics.counters.errorCount, 45); assert.equal(result.checks.artifactsComplete, false);
  assert.equal(result.ok, false); assert.equal((await lstat(join(directory, 'output/direct-tls-proxy.json'))).isFile(), true);
});
test('measure phase observation remains available without a UI callback and records its first receipt only', async t => {
  let clock = 0;
  const { result } = await fixture(t, { wallNow: () => 100000 + clock++ * 1000,
    progress: undefined,
    command: (_program, args, options) => {
      options.onProgress({ phase: 'measure' }); options.onProgress({ phase: 'measure' });
      const output = args[args.indexOf('--output') + 1];
      return handle(writeFile(output, JSON.stringify(generator)).then(() => ({ code: 1 })));
    },
  });
  assert.equal(result.localMeasurementWindow.measurePhaseObservedAtMs, 100000);
  assert.equal(result.localMeasurementWindow.generatorCompletedAtMs, 101000);
  assert.equal(result.ok, false);
});
test('changed certificate bytes fail before proxy, carrier or generator admission and still stop our stand', async t => {
  let first = true, proxyCalls = 0;
  const { result, tunnels } = await fixture(t, { platform: 'darwin', tlsProxy: async () => { proxyCalls++; throw Error(); },
    remote: async action => {
      if (action === 'status' && first) { first = false; return initial; }
      if (action === 'start') return {};
      if (action === 'stop') return { stopConfirmed: true, privateFixtureGone: true };
      if (action === 'tls-certificate') return { runId, containerId: id, certificateSha256: certificateSha, certificatePEM: publicCertificate.replace('RklY', 'AAAA') };
      if (action.startsWith('tls-')) return gateway;
      return ready;
    } }, tlsChanges);
  assert.equal(result.failure, 'public-tls-certificate-digest-mismatch'); assert.equal(proxyCalls, 0); assert.equal(tunnels.length, 0);
  assert.equal(result.generatorExitCode, undefined); assert.equal(result.localPrivateFixtureGone, true);
});
test('wrong proxy readiness cannot start the control carrier or SDK and its owned group is stopped', async t => {
  let stopped = false;
  const { result, tunnels } = await fixture(t, { platform: 'darwin', tlsProxy: async (_configPath, _outputPath, config) => {
    const result = handle(Promise.resolve({ code: 1 })); result.stop = async () => { stopped = true; return true; };
    return { handle: result, ready: Promise.resolve({ ...proxyReady(config), certSha256: sha }) };
  } }, tlsChanges);
  assert.equal(result.failure, 'tls-proxy-ready-mismatch'); assert.equal(tunnels.length, 0); assert.equal(stopped, true);
  assert.equal(result.localPrivateFixtureGone, true); assert.equal(result.ok, false);
});
test('TLS transport cannot pass on sockets alone when final counters or gateway cleanup fail', () => {
  const outcome = { generatorExitCode: 0, attestedBeforeGenerators: true, standRunId, containerId: id,
    resourceMonitorExitCode: 0, resourceCoverage: { fullIntervalObserved: true }, stopConfirmed: true, remotePrivateFixtureGone: true,
    ownedGroupsStopped: true, localPrivateFixtureGone: true, missingArtifacts: [], tlsGatewayReadyValidated: true,
    tlsProxyReadyValidated: true, tlsGatewayFinal: { closed: true, assetsRemoved: true }, tlsProxyExitCode: 0, tlsProxyFinalValidated: true,
    tlsProxyDiagnostics: { localObservationPeriodBracketed: true } };
  const reports = { server, generator, state, guardian, resourceSummary };
  assert.equal(assessDedicatedStage(tlsPlan, outcome, reports).ok, true);
  for (const patch of [{ tlsProxyFinalValidated: false }, { tlsGatewayFinal: { closed: true, assetsRemoved: false } }, { tlsProxyExitCode: 1 }])
    assert.equal(assessDedicatedStage(tlsPlan, { ...outcome, ...patch }, reports).ok, false);
});
test('a lost start reply still attempts fresh owned stop and cannot pass', async t => {
  const calls = []; let first = true;
  const { result } = await fixture(t, { remote: async action => { calls.push(action);
    if (action === 'status' && first) { first = false; return initial; }
    if (action === 'start') throw Error('network message with private value');
    return action === 'stop' ? { stopConfirmed: true, privateFixtureGone: true }
      : { ...ready, phase: 'ended', containerState: 'exited', ready: false, stopConfirmed: true, privateFixtureGone: true }; } });
  assert.equal(result.ok, false); assert.deepEqual(calls, ['status', 'start', 'stop', 'status']);
  assert.equal(result.failure, 'dedicated-stage-runtime-failure'); assert.equal(JSON.stringify(result).includes('private value'), false);
});
test('an already running UUID is refused without stopping someone else’s active stage', async t => {
  const calls = [];
  const { result } = await fixture(t, { remote: async action => { calls.push(action); return ready; } });
  assert.equal(result.failure, 'fresh-unstarted-run-required'); assert.deepEqual(calls, ['status']);
  assert.equal(result.stopConfirmed, false); assert.equal(result.ok, false);
});
test('failed local SSH pins cannot dispatch start or stop', async t => {
  const calls = [];
  const { result } = await fixture(t, { pins: async () => { throw Error('changed pin'); }, remote: async action => { calls.push(action); return initial; } });
  assert.deepEqual(calls, []); assert.equal(result.ok, false);
});
test('manifest corruption never creates tunnels or starts the generator', async t => {
  let commands = 0, tunnels = 0;
  const { result } = await fixture(t, { copy: async kind => kind === 'manifest' ? Buffer.from('{}') : Buffer.from('{}'),
    tunnel: async () => { tunnels++; return handle(); }, command: () => { commands++; return handle(); } });
  assert.equal(result.failure, 'manifest-digest-mismatch'); assert.equal(commands, 0); assert.equal(tunnels, 0); assert.equal(result.ok, false);
});
test('changed container ID during completion refuses replacement cleanup', async t => {
  let statuses = 0, foreignStops = 0;
  const { result } = await fixture(t, { remote: async (action, expectedId) => {
    if (action === 'start') return { phase: 'creating' };
    if (action === 'status') return ++statuses === 1 ? initial : statuses === 2 ? ready : { ...ready, containerId: sha };
    if (expectedId === id) throw Error('pinned-container-changed'); foreignStops++; return {};
  } });
  assert.equal(result.failure, 'owned-stand-status-mismatch'); assert.equal(result.stopConfirmed, false);
  assert.equal(foreignStops, 0); assert.equal(result.ownedGroupsStopped, true);
});
test('readiness timeout is bounded and still requests stop', async t => {
  let time = 0, first = true; const calls = [];
  const { result } = await fixture(t, { now: () => time, delay: async () => { time += 1000000; }, remote: async action => {
    calls.push(action); if (action === 'start') return {};
    if (action === 'status' && first) { first = false; return initial; }
    return action === 'stop' ? { stopConfirmed: true, privateFixtureGone: true }
      : { ...ready, phase: 'creating', ready: false, containerId: null }; } });
  assert.equal(result.failure, 'stand-readiness-timeout'); assert.ok(calls.includes('stop')); assert.equal(result.ok, false);
});
test('tunnel cleanup failure cannot skip owned remote cleanup', async t => {
  const { result, actions } = await fixture(t, { tunnel: async () => ({ ...handle(), stop: async () => { throw Error('private failure'); } }) });
  assert.equal(result.ok, false); assert.equal(result.ownedGroupsStopped, false); assert.equal(result.stopConfirmed, true);
  assert.ok(actions.some(item => item.action === 'stop'));
});
test('guardian watching snapshot is retried until its terminal verdict', async t => {
  let guardianReads = 0;
  const { result } = await fixture(t, { copy: async kind => Buffer.from(kind === 'resourceSamples'
    ? resourceSamples.map(row => JSON.stringify(row)).join('\n') + '\n'
    : JSON.stringify(kind === 'guardian' && ++guardianReads === 1 ? { ...guardian, phase: 'watching' }
      : { manifest, server, state, guardian, resourceSummary }[kind])) });
  assert.equal(result.ok, true); assert.equal(guardianReads, 2);
});
test('each SSH carrier is attested before opening the next or starting SDK workers', async t => {
  let opened = 0, attested = 0;
  const { result } = await fixture(t, {
    tunnel: async index => { assert.equal(index, attested); opened++; return handle(); },
    attest: async current => {
      if (current.localPorts.api.length === 1) { assert.equal(opened, attested + 1); attested++; }
      else assert.equal(attested, 4);
    },
  });
  assert.equal(result.ok, true); assert.equal(opened, 4); assert.equal(attested, 4);
});
test('empty or failed load checks cannot pass on connection counts alone', () => {
  const outcome = { generatorExitCode: 0, attestedBeforeGenerators: true, standRunId, containerId: id,
    resourceMonitorExitCode: 0, resourceCoverage: { fullIntervalObserved: true }, stopConfirmed: true, remotePrivateFixtureGone: true,
    ownedGroupsStopped: true, localPrivateFixtureGone: true, missingArtifacts: [] };
  const reports = { server, generator, state, guardian, resourceSummary };
  assert.equal(assessDedicatedStage(plan, outcome, reports).ok, true);
  for (const patch of [{ checks: {} }, { checks: { generatorSustainedTarget: false } }, { gameProcesses: 4 }, { cleanup: { passed: false } }])
    assert.equal(assessDedicatedStage(plan, outcome, { ...reports, server: { ...server, ...patch } }).ok, false);
  assert.equal(assessDedicatedStage(plan, outcome, { ...reports, generator: { ...generator, results: [{}] } }).ok, false);
});
