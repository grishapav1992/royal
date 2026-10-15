import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { encodeStandServerReport, loopbackEndpoint, parseStandFinished, parseStandManifest, parseStandPrepared, parseStandResult,
  standErrorDiagnostics, standHost, standReportForControl, STAND_CONTROL_REPORT_MAX_BYTES, STAND_SERVER_ARTIFACT_MAX_BYTES, STAND_ROLE, verifyStandStatus, type StandReady, type StandResult } from '../scripts/load-stand-contract';
import { MAX_MEASUREMENT_SECONDS, MAX_STAND_CLIENTS, MAX_STAND_SESSION_MS, standGameProcessIds, standSessionDurationMs } from '../scripts/load-stand-limits';

const now = 1791670000000, runId = '12345678-1234-1234-1234-123456789abc';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = () => ({ protocol: 1, role: STAND_ROLE, runId, secret: hash('test-control'), createdAt: now,
  expiresAt: now + 600000, apiEndpoint: 'http://127.0.0.1:17100', controlEndpoint: 'http://127.0.0.1:17101',
  serverApiPort: 18100, serverControlPort: 18101, bundleSha256: hash('bundle'), clients: 4, seconds: 2,
  serverHost: standHost(), tokens: Array.from({ length: 4 }, (_, i) => hash('synthetic-' + i)) });
const ready = (index: number): StandReady => ({ kind: 'ready', count: 1, connectedClients: 1,
  rooms: [{ id: 'room-' + index, count: 1, owner: 'main' }], errors: {}, requestedBatch: 1, joinedBatch: 1,
  connectionAttempts: 1, connectionRetries: 0, retryCodes: {} });
const result = (index: number): StandResult => ({ ...ready(index), kind: 'result', durationSeconds: 2, observationSeconds: 2.1,
  packetsSent: 60, inputPacketsPerSecond: 30, receivedBytes: 1024, maxClientBufferedBytes: 0,
  ackMs: { count: 60, p50: 10, p95: 30, p99: 50, max: 100 }, stateIntervalMs: { count: 40, p50: 50, p95: 51, p99: 52, max: 60 },
  unacknowledgedPackets: 0, unacknowledgedAtEndOfSending: 0, oldestUnacknowledgedMs: 0, drainSeconds: .1,
  errorCount: 0, errors: {}, generator: { cpuPercent: 1, rssMiB: 50, eventLoopP99Ms: 10, eventLoopMaxMs: 15 } });
const preparation = () => ({ runId, ready: [0, 1, 2, 3].map(ready), clientHost: standHost(), inputMode: 'stress',
  connectionPhase: { durationSeconds: 1, batches: 4, connectionAttempts: 4, connectionRetries: 0 } });

test('failure diagnostics retain safe PG, errno and caller-identified AuthError status without error payloads', () => {
  const secret = 'synthetic-secret@example.test password-token SELECT * FROM sessions';
  const error = Object.assign(new Error(secret), { name: 'error', code: '23505', errno: -111,
    detail: secret, query: secret, internalQuery: secret, token: secret, email: secret, password: secret });
  error.stack = `error: ${secret}\n    at accountLogin (/private/${secret}/accounts.ts:82:17)\n    at ${secret} (/app/dist-load/cluster.mjs:1203:9)\n    at Pool.query (/private/${secret}/node_modules/pg/lib/client.js:11:8)`;
  const pg = standErrorDiagnostics(error);
  assert.deepEqual(pg, { name: 'error', code: '23505', errno: -111,
    frames: [{ file: 'accounts.ts', line: 82, column: 17 }, { file: 'cluster.mjs', line: 1203, column: 9 }] });
  assert.equal(JSON.stringify(pg).includes(secret), false);
  assert.deepEqual(standErrorDiagnostics(new Error(secret), 401).authStatus, 401);
  assert.equal(standErrorDiagnostics(new Error(secret), 401).name, 'AuthError');
  assert.equal(standErrorDiagnostics({ name: 'Error', status: 401, message: secret }).authStatus, undefined);
});
test('failure diagnostics allow known system and crypto codes and suppress arbitrary names, codes and paths', () => {
  for (const code of ['ECONNREFUSED', 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS', '42P01', 'XX000']) assert.equal(standErrorDiagnostics({ code }).code, code);
  const secret = 'TOKEN';
  const diagnostics = standErrorDiagnostics({ name: secret, code: secret, errno: secret, stack: `Error: ${secret}\n    at ${secret} (/private/secret-module.ts:10:20)` }, 200);
  assert.deepEqual(diagnostics, { name: 'UnknownError', frames: [] });
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  assert.deepEqual(standErrorDiagnostics('private error payload'), { name: 'UnknownError', frames: [] });
  const getters = Object.defineProperties({}, { name: { get() { throw new Error(secret); } }, code: { get() { throw new Error(secret); } }, stack: { get() { throw new Error(secret); } } });
  assert.deepEqual(standErrorDiagnostics(getters), { name: 'UnknownError', frames: [] });
});
test('failure diagnostic frames are capped and contain only allowlisted filenames and positive bounded coordinates', () => {
  const frame = '\n    at run (/app/scripts/load-websocket-cluster.ts:123:45)';
  const diagnostics = standErrorDiagnostics({ name: 'TypeError', errno: -99999,
    stack: 'TypeError: private payload\n    at run (/app/server/database.ts:0:9)\n    at run (/app/server/accounts.ts:12345678:1)' + frame.repeat(20) });
  assert.equal(diagnostics.frames.length, 4); assert.equal(diagnostics.errno, undefined);
  assert.equal(diagnostics.frames.every(item => item.file === 'load-websocket-cluster.ts' && item.line === 123 && item.column === 45), true);
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostics)) < 1024);
});

test('a private synthetic fixture permits forwarded API and control ports without changing the stand ports', () => {
  const parsed = parseStandManifest(fixture(), now);
  assert.equal(parsed.serverApiPort, 18100); assert.equal(parsed.apiEndpoint, 'http://127.0.0.1:17100');
  assert.notEqual(parsed.tokens, fixture().tokens); assert.equal(parsed.tokens.length, 4);
});
test('endpoint validation rejects external, userinfo, path, query and zero-port destinations', () => {
  for (const endpoint of ['https://127.0.0.1:17100', 'http://example.test:17100', 'http://127.0.0.1.example.test:17100',
    'http://user@127.0.0.1:17100', 'http://127.0.0.1:17100/workers/', 'http://127.0.0.1:17100/?next=x',
    'http://127.0.0.1:17100/#x', 'http://127.0.0.1:0', 'http://127.0.0.1']) assert.throws(() => loopbackEndpoint(endpoint));
});
test('expired, non-isolated and duplicated-session fixtures fail before any login traffic', () => {
  assert.throws(() => parseStandManifest(fixture(), now + 600000));
  assert.throws(() => parseStandManifest({ ...fixture(), role: 'game' }, now));
  const repeated = fixture(); repeated.tokens[1] = repeated.tokens[0]; assert.throws(() => parseStandManifest(repeated, now));
  assert.throws(() => parseStandManifest({ ...fixture(), clients: 10000 }, now));
});
test('stand attestation requires the session, bundle, expiry, API origin and host identity', () => {
  const manifest = parseStandManifest(fixture(), now), status = { ...manifest, tokens: undefined, secret: undefined };
  verifyStandStatus(status, manifest);
  for (const changed of [{ role: 'game' }, { runId: 'different' }, { bundleSha256: hash('wrong') },
    { expiresAt: now }, { apiEndpoint: 'http://127.0.0.1:17102' }, { serverHost: { ...manifest.serverHost, hostFingerprint: hash('other') } }]) {
    assert.throws(() => verifyStandStatus({ ...status, ...changed }, manifest));
  }
});
test('admission must account for every client and preserve supported room owners', () => {
  const parsed = parseStandPrepared(preparation(), runId, 4); assert.equal(parsed.ready.length, 4);
  assert.throws(() => parseStandPrepared({ ...preparation(), ready: [ready(0)] }, runId, 4));
  const invalid = preparation(); invalid.ready[0].rooms[0].owner = 'foreign'; assert.throws(() => parseStandPrepared(invalid, runId, 4));
  const failed = preparation(); failed.ready[0].errors['join-429'] = 1; assert.throws(() => parseStandPrepared(failed, runId, 4));
});
test('measured rates, occupancy, errors and quantiles must be internally consistent', () => {
  assert.equal(parseStandResult(result(0)).packetsSent, 60);
  for (const changed of [{ inputPacketsPerSecond: 300 }, { connectedClients: 0 }, { errorCount: 1 },
    { ackMs: { count: 60, p50: 100, p95: 30, p99: 50, max: 100 } }, { durationSeconds: NaN }]) {
    assert.throws(() => parseStandResult({ ...result(0), ...changed }));
  }
});
test('stand reports preserve bounded percentile metadata and reject incomplete tracking metadata', () => {
  const measured = { ...result(0), packetsSent: 9000, inputPacketsPerSecond: 4500,
    ackMs: { count: 9000, sampleCount: 8192, sampling: 'bounded-reservoir', p50: 10, p95: 30, p99: 50, max: 100, mean: 20 },
    tracking: { latencyTimingSamplesDropped: 0 } };
  assert.deepEqual(parseStandResult(measured).ackMs, measured.ackMs);
  assert.throws(() => parseStandResult({ ...measured, ackMs: { ...measured.ackMs, sampling: 'complete' } }));
  assert.throws(() => parseStandResult({ ...measured, ackMs: { ...measured.ackMs, sampleCount: 9000 } }));
  assert.throws(() => parseStandResult({ ...measured, tracking: { latencyTimingSamplesDropped: -1 } }));
});
test('results cannot drop a generator, shorten measurement or change assigned client counts', () => {
  const prepared = parseStandPrepared(preparation(), runId, 4), finished = { runId, results: [0, 1, 2, 3].map(result) };
  assert.equal(parseStandFinished(finished, runId, prepared, 2).results.length, 4);
  assert.throws(() => parseStandFinished({ ...finished, results: finished.results.slice(1) }, runId, prepared, 2));
  const short = result(0); short.durationSeconds = 1; short.inputPacketsPerSecond = 60;
  assert.throws(() => parseStandFinished({ ...finished, results: [short, ...finished.results.slice(1)] }, runId, prepared, 2));
});

test('thirty-minute measurement and forty-minute session limits remain finite and coordinated', () => {
  assert.equal(MAX_MEASUREMENT_SECONDS, 1800); assert.equal(MAX_STAND_SESSION_MS, 40 * 60000);
  assert.equal(standSessionDurationMs(1), 601000); assert.equal(standSessionDurationMs(300), 900000);
  assert.equal(standSessionDurationMs(1800), MAX_STAND_SESSION_MS);
  for (const seconds of [0, -1, .5, 1801, NaN, Infinity]) assert.throws(() => standSessionDurationMs(seconds), RangeError);
  const long = { ...fixture(), seconds: 1800, expiresAt: now + standSessionDurationMs(1800) };
  assert.equal(parseStandManifest(long, now).seconds, 1800);
  assert.throws(() => parseStandManifest({ ...long, seconds: 1801 }, now));
  assert.throws(() => parseStandManifest({ ...long, expiresAt: now + MAX_STAND_SESSION_MS + 1 }, now));
  assert.throws(() => parseStandManifest({ ...long, createdAt: now - 1 }, now));
  assert.throws(() => parseStandManifest(long, long.expiresAt));
});

test('long-run results accept bounded scheduling overhead and reject oversized duration', () => {
  const long = { ...result(0), durationSeconds: 1810, observationSeconds: 1811, inputPacketsPerSecond: 60 / 1810 };
  assert.equal(parseStandResult(long).durationSeconds, 1810);
  assert.throws(() => parseStandResult({ ...long, durationSeconds: 1900, observationSeconds: 1901, inputPacketsPerSecond: 60 / 1900 }));
  assert.throws(() => parseStandResult({ ...long, observationSeconds: 1846 }));
  const prepared = parseStandPrepared(preparation(), runId, 4);
  const results = [0, 1, 2, 3].map(index => ({ ...result(index), ...long, rooms: result(index).rooms }));
  assert.equal(parseStandFinished({ runId, results }, runId, prepared, 1800).results.length, 4);
});

test('large sustained packet and ACK totals fit long runs while reservoirs stay bounded', () => {
  for (const count of [250, 300, 1200]) {
    const packetsSent = count * 30 * 1800;
    const measured = { ...result(0), count, connectedClients: count, packetsSent, durationSeconds: 1800, observationSeconds: 1802,
      inputPacketsPerSecond: count * 30,
      rooms: Array.from({ length: Math.ceil(count / 30) }, (_, index) => ({ id: 'long-room-' + index,
        owner: ['main', 'worker-1', 'worker-2', 'worker-3'][Math.floor(index / 10)], count: Math.min(30, count - index * 30) })),
      ackMs: { count: packetsSent, sampleCount: 8192, sampling: 'bounded-reservoir', p50: 10, p95: 30, p99: 50, max: 100, mean: 20 },
      tracking: { latencyTimingSamplesDropped: 0 } };
    const parsed = parseStandResult(measured);
    assert.equal(parsed.packetsSent, packetsSent); assert.equal(parsed.ackMs.count, packetsSent); assert.equal(parsed.ackMs.sampleCount, 8192);
    assert.throws(() => parseStandResult({ ...measured, ackMs: { ...measured.ackMs, count: 1e9 } }));
    assert.throws(() => parseStandResult({ ...measured, packetsSent: 1e9, inputPacketsPerSecond: 1e9 / 1800 }));
    assert.equal(parseStandResult({ ...measured, errors: { send: packetsSent }, errorCount: packetsSent,
      tracking: { latencyTimingSamplesDropped: packetsSent } }).errorCount, packetsSent);
  }
});

test('six thousand clients require an explicit adequate process profile in the private manifest', () => {
  const large = { ...fixture(), clients: MAX_STAND_CLIENTS, gameProcesses: 20,
    tokens: Array.from({ length: MAX_STAND_CLIENTS }, (_, index) => hash('large-client-' + index)) };
  assert.equal(parseStandManifest(large, now).gameProcesses, 20);
  assert.equal(parseStandManifest(fixture(), now).gameProcesses, 4);
  for (const gameProcesses of [undefined, 19, 25, 0, 20.5, NaN]) assert.throws(() => parseStandManifest({ ...large, gameProcesses }, now));
  assert.throws(() => parseStandManifest({ ...large, clients: MAX_STAND_CLIENTS + 1 }, now));
  const manifest = parseStandManifest(large, now), status = { ...manifest, tokens: undefined, secret: undefined };
  verifyStandStatus(status, manifest);
  assert.throws(() => verifyStandStatus({ ...status, gameProcesses: 19 }, manifest));
  assert.throws(() => verifyStandStatus({ ...status, gameProcesses: undefined }, manifest));
});

test('six thousand-client admission and long results retain exact owners and finite report limits', () => {
  const owners = standGameProcessIds(20), clients = MAX_STAND_CLIENTS;
  const rooms = Array.from({ length: clients / 30 }, (_, index) => ({ id: 'large-room-' + index, count: 30, owner: owners[Math.floor(index / 10)] }));
  const largeReady = { ...ready(0), count: clients, connectedClients: clients, rooms, requestedBatch: 4, joinedBatch: 4,
    connectionAttempts: clients, connectionRetries: 0 };
  const preparedValue = { ...preparation(), ready: [largeReady], gameProcesses: 20,
    connectionPhase: { durationSeconds: 300, batches: clients / 4, connectionAttempts: clients, connectionRetries: 0 } };
  const prepared = parseStandPrepared(preparedValue, runId, clients, 20);
  assert.equal(prepared.ready[0].rooms.length, 200);
  assert.throws(() => parseStandPrepared(preparedValue, runId, clients));
  assert.throws(() => parseStandPrepared({ ...preparedValue, gameProcesses: 19 }, runId, clients, 20));
  const packetsSent = clients * 30 * MAX_MEASUREMENT_SECONDS;
  const measured = { ...result(0), count: clients, connectedClients: clients, rooms, durationSeconds: MAX_MEASUREMENT_SECONDS,
    observationSeconds: MAX_MEASUREMENT_SECONDS + 2, packetsSent, inputPacketsPerSecond: clients * 30,
    ackMs: { count: packetsSent, sampleCount: 8192, sampling: 'bounded-reservoir', p50: 10, p95: 30, p99: 50, max: 100, mean: 20 },
    tracking: { latencyTimingSamplesDropped: 0 } };
  assert.equal(parseStandFinished({ runId, results: [measured] }, runId, prepared, MAX_MEASUREMENT_SECONDS).results[0].packetsSent, packetsSent);
  assert.throws(() => parseStandResult(measured));
  const foreignRooms = rooms.map((room, index) => index === 0 ? { ...room, owner: 'worker-20' } : room);
  assert.throws(() => parseStandResult({ ...measured, rooms: foreignRooms }, 20));
  assert.throws(() => parseStandResult({ ...measured, rooms: [...rooms, rooms[0]] }, 20));
  const tooManySamples = (MAX_MEASUREMENT_SECONDS + 45) * MAX_STAND_CLIENTS * 60 + 1;
  assert.throws(() => parseStandResult({ ...measured, ackMs: { ...measured.ackMs, count: tooManySamples } }, 20));
  assert.throws(() => parseStandResult({ ...measured, errors: { send: tooManySamples }, errorCount: tooManySamples }, 20));
  const tooFast = MAX_STAND_CLIENTS * 60 + 1;
  assert.throws(() => parseStandResult({ ...measured, inputPacketsPerSecond: tooFast, packetsSent: tooFast * MAX_MEASUREMENT_SECONDS }, 20));
});

test('room identities and ten rooms per owner remain bounded for expanded profiles', () => {
  const duplicated = { ...result(0), count: 2, connectedClients: 2, rooms: [ready(0).rooms[0], ready(0).rooms[0]] };
  assert.throws(() => parseStandResult(duplicated, 24));
  const rooms = Array.from({ length: 11 }, (_, index) => ({ id: 'over-room-' + index, owner: 'worker-23', count: 1 }));
  assert.throws(() => parseStandResult({ ...result(0), count: 11, connectedClients: 11, rooms }, 24));
  const last = { ...result(0), rooms: [{ id: 'last-room', owner: 'worker-23', count: 1 }] };
  assert.equal(parseStandResult(last, 24).rooms[0].owner, 'worker-23');
  assert.throws(() => parseStandResult(last, 23));
});

for (const gameProcesses of [20, 24]) test(`${gameProcesses}-process control report fits six MiB without changing proof or cumulative totals`, () => {
  const owners = standGameProcessIds(gameProcesses), clientCount = 6000 / gameProcesses, totalFrames = 324000000 / gameProcesses;
  const trafficWindow = { incomingFrames: clientCount * 30, incomingBytes: clientCount * 30 * 90, inputFrames: clientCount * 30,
    decodedInputSequences: clientCount * 60, inputDecodeErrors: 0, oversizedInputFrames: 0, repeatedInputSequences: 0,
    regressingInputSequences: 0, sequenceGapEvents: 0, sequenceGapSize: 0, inputDispatchEvents: clientCount * 30,
    inputAcceptCalls: clientCount * 30, inputAcceptSuccesses: clientCount * 30, queueAcceptedSteps: clientCount * 60,
    queueAdvancedRemovals: clientCount * 60, queueCancelledRemovals: 0, inputSeqAdvancements: clientCount * 30,
    receivedSequencesCoveredByInputSeq: clientCount * 60, outgoingSendCalls: clientCount * 20, outgoingBytes: clientCount * 20 * 300,
    outgoingSendThrows: 0, limiterHits: 0, arrivalTrackingEvictions: 0, rollingWindowOverflows: 0, untrackedClientFrames: 0,
    inputQueueCoverageMisses: 0, unacknowledgedSequencesAtClose: 0, diagnosticErrors: 0, maxRollingFramesPerClientSecond: 30,
    maxRollingInputsPerClientSecond: 30, maxClockWindowFrames: 30, maxRoomClockLagMs: 17, minRoomClockLagMs: 0,
    maxQueuedStepsPerClient: 2, maxQueuedMovementMsPerClient: 33.333333333333336, maxQueueResidenceMs: 16.666666666666668,
    maxWebSocketBufferedBytes: 100000, maxSocketReadableBytes: 65536, maxSocketWritableBytes: 65536,
    pendingAtEnd: { clients: clientCount, queuedSteps: 0, queuedMovementMs: 0, oldestQueueResidenceMs: 0, webSocketBufferedBytes: 0,
      socketReadableBytes: 0, socketWritableBytes: 0, socketsAboveBufferedLimit: 0, receivedSequencesAwaitingInputSeq: 0 } };
  const windows = Array.from({ length: 300 }, (_, index) => ({ ...trafficWindow, startedAtMs: index * 1000,
    endedAtMs: (index + 1) * 1000, intervalMs: 1000 }));
  const full = { ok: true, verdict: 'passed-local-comparison', productionTraffic: false, gameProcesses,
    checks: { connections: true, serverInputDeliveryComplete: true },
    summary: { connectedClients: 6000, inputPacketsPerSecond: 180000 }, inputDelivery: { sentFrames: 324000000, receivedFrames: 324000000 },
    processLimits: owners.map(id => ({ id, maxRooms: 10, roomCapacity: 30, maxConnections: 330 })),
    servers: Object.fromEntries(owners.map(id => [id, { samples: 1800, cpuMaxPercent: 97, retainedIntervalCount: 300, droppedIntervalCount: 1500,
      intervals: Array.from({ length: 300 }, (_, index) => ({ sampledAt: index, cpuPercent: 50 })) }])),
    roomTrafficDiagnostics: Object.fromEntries(owners.map(id => [id, { inputFrames: totalFrames, diagnosticErrors: 0,
      maxQueuedStepsPerClient: 12, receiveToInputSeqAge: { count: totalFrames, maxMs: 200 }, windows,
      coverage: { inputQueueClients: clientCount }, limits: { windows: 300, trackedClients: 330 } }])) };
  assert(Buffer.byteLength(JSON.stringify(full)) > STAND_CONTROL_REPORT_MAX_BYTES);
  assert(Buffer.byteLength(encodeStandServerReport(full)) <= STAND_SERVER_ARTIFACT_MAX_BYTES);
  const compact = standReportForControl(full);
  assert(Buffer.byteLength(JSON.stringify({ runId, report: compact })) <= STAND_CONTROL_REPORT_MAX_BYTES);
  for (const key of ['ok', 'verdict', 'productionTraffic', 'gameProcesses', 'checks', 'summary', 'inputDelivery', 'processLimits'] as const) assert.deepEqual(compact[key], full[key]);
  const servers = compact.servers as Record<string, Record<string, unknown>>;
  const diagnostics = compact.roomTrafficDiagnostics as Record<string, Record<string, unknown>>;
  assert.equal(servers.main.samples, 1800); assert.equal(servers.main.cpuMaxPercent, 97); assert.equal(servers.main.intervals, undefined);
  assert.equal(diagnostics.main.inputFrames, totalFrames); assert.equal(diagnostics.main.maxQueuedStepsPerClient, 12);
  assert.deepEqual(diagnostics.main.coverage, full.roomTrafficDiagnostics.main.coverage);
  assert.equal(diagnostics.main.windows, undefined); assert.equal(full.roomTrafficDiagnostics.main.windows.length, 300);
  const transfer = compact.detailTransfer as { source: string; omittedArrays: { path: string; items: number }[] };
  assert.equal(transfer.source, 'server-result-artifact');
  assert.deepEqual(transfer.omittedArrays.find(item => item.path === 'roomTrafficDiagnostics.' + owners.at(-1) + '.windows'),
    { path: 'roomTrafficDiagnostics.' + owners.at(-1) + '.windows', items: 300 });
  assert.throws(() => standReportForControl(full, 128));
  assert.throws(() => standReportForControl(full, STAND_CONTROL_REPORT_MAX_BYTES + 1));
  const small = { ok: true, checks: { connections: true } }; assert.equal(standReportForControl(small), small);
});

test('server artifact serialization has a strict independent thirty-two MiB transfer budget', () => {
  const small = { ok: true, checks: { connections: true } };
  assert.deepEqual(JSON.parse(encodeStandServerReport(small)), small);
  assert(encodeStandServerReport(small, true).includes('\n  "ok"'));
  assert.throws(() => encodeStandServerReport({ details: 'x'.repeat(STAND_SERVER_ARTIFACT_MAX_BYTES) }));
});
