import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { encodeStandServerReport, loopbackEndpoint, parseStandChatV2, parseStandFinished, parseStandManifest, parseStandPrepared, parseStandResult,
  parseStandStart, standErrorDiagnostics, standHost, standReportForControl, STAND_CONTROL_REPORT_MAX_BYTES, STAND_SERVER_ARTIFACT_MAX_BYTES,
  STAND_ROLE, verifyStandStatus, type StandReady, type StandResult } from '../scripts/load-stand-contract';
import { MAX_GAME_PROCESSES, MAX_MEASUREMENT_SECONDS, MAX_STAND_CLIENTS, MAX_STAND_SESSION_MS,
  standAdmissionTimeoutMs, standGameProcessIds, standSessionDurationMs } from '../scripts/load-stand-limits';
import { ChatV2WorkloadLedger, ChatV2WorkloadPlan } from '../scripts/load-chat-v2-workload';
import type { ServerMetrics } from '../scripts/load-server-metrics';
import type { TrafficWindow } from '../scripts/websocket-server-diagnostics';
import { createChatMessageId } from '../src/shared/chat';

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
const chatV2 = { clients: 4, seconds: 2, steadyPerSecond: 2, burst: { count: 4, atSecond: 1 } };

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

test('V2 opt-in is exact, bound to the isolated manifest and attested by every endpoint', () => {
  const manifest = parseStandManifest({ ...fixture(), chatV2 }, now);
  assert.deepEqual(manifest.chatV2, chatV2);
  const status = { ...manifest, tokens: undefined, secret: undefined };
  verifyStandStatus({ ...status, chatV2: { burst: { atSecond: 1, count: 4 }, steadyPerSecond: 2, seconds: 2, clients: 4 } }, manifest);
  for (const malformed of [null, { ...chatV2, token: 'unexpected' }, { ...chatV2, clients: 5 }, { ...chatV2, seconds: 3 },
    { ...chatV2, steadyPerSecond: '2' }, { ...chatV2, steadyPerSecond: 334 }, { ...chatV2, steadyPerSecond: 0, burst: undefined },
    { ...chatV2, burst: { ...chatV2.burst, count: 5 } }, { ...chatV2, burst: { ...chatV2.burst, atSecond: 2 } },
    { ...chatV2, burst: { ...chatV2.burst, extra: true } }]) {
    assert.throws(() => parseStandManifest({ ...fixture(), chatV2: malformed }, now));
  }
  assert.throws(() => verifyStandStatus({ ...status, chatV2: undefined }, manifest), /stand-chat-attestation-mismatch/);
  assert.throws(() => verifyStandStatus({ ...status, chatV2: { ...chatV2, steadyPerSecond: 3 } }, manifest), /stand-chat-attestation-mismatch/);
  assert.throws(() => verifyStandStatus(status, parseStandManifest(fixture(), now)), /stand-chat-attestation-mismatch/);
  assert.throws(() => parseStandChatV2({ ...chatV2, clients: MAX_STAND_CLIENTS + 1 }, MAX_STAND_CLIENTS + 1, 2));
});

test('the V2 start time is explicit, future, bounded, and fits duration and drain before expiry', () => {
  const manifest = parseStandManifest({ ...fixture(), chatV2 }, now), legacy = parseStandManifest(fixture(), now);
  const start = { start: true, runId, startAtUnixMs: now + 2_000 };
  assert.deepEqual(parseStandStart(start, manifest, now), start);
  assert.deepEqual(parseStandStart({ start: true, runId }, legacy, now), { start: true, runId });
  assert.throws(() => parseStandStart(start, legacy, now), /start-barrier-mismatch/);
  for (const changed of [{ startAtUnixMs: undefined }, { runId: 'other' }, { extra: true }, { startAtUnixMs: now },
    { startAtUnixMs: now + 1.5 }, { startAtUnixMs: now + 10_001 }, { startAtUnixMs: String(now + 2_000) }]) {
    assert.throws(() => parseStandStart({ ...start, ...changed }, manifest, now));
  }
  assert.throws(() => parseStandStart(start, { ...manifest, expiresAt: now + 9_000 }, now), /invalid-stand-chat-start/);
});

test('V2 readiness requires every authenticated client and exact worker shard counts', () => {
  const clients = (index: number, count: number): StandReady => ({ ...ready(index), count, connectedClients: count,
    rooms: [{ id: 'room-' + index, count, owner: 'main' }], chatV2Ready: count });
  const readiness = { ...preparation(), ready: [clients(0, 2), clients(1, 1), clients(2, 1)] };
  assert.deepEqual(parseStandPrepared(readiness, runId, 4, 4, chatV2).chatV2, chatV2);
  assert.throws(() => parseStandPrepared(readiness, runId, 4), /invalid-stand-chat-readiness/);
  assert.throws(() => parseStandPrepared(preparation(), runId, 4, 4, chatV2), /invalid-stand-chat-readiness/);
  assert.throws(() => parseStandPrepared({ ...readiness, ready: [clients(0, 1), clients(1, 2), clients(2, 1)] }, runId, 4, 4, chatV2),
    /invalid-stand-chat-readiness/);
  assert.throws(() => parseStandPrepared({ ...readiness, ready: [{ ...clients(0, 2), chatV2Ready: 1 }, ...readiness.ready.slice(1)] },
    runId, 4, 4, chatV2), /invalid-stand-chat-readiness/);
});

test('an explicit moving subset binds attestation, readiness and results to each shard including zero movers', () => {
  const startAtUnixMs = now + 2_000, profile = { ...chatV2, movingClients: 1 };
  const manifest = parseStandManifest({ ...fixture(), chatV2: profile }, now);
  const status = { ...manifest, tokens: undefined, secret: undefined };
  verifyStandStatus(status, manifest);
  assert.throws(() => verifyStandStatus({ ...status, chatV2 }, manifest), /stand-chat-attestation-mismatch/);
  for (const movingClients of [-1, 1.5, 5, '1', null]) {
    assert.throws(() => parseStandManifest({ ...fixture(), chatV2: { ...profile, movingClients } }, now));
  }
  const admission = { ...preparation(), ready: preparation().ready.map((row, index) => ({ ...row, chatV2Ready: 1, movingClients: Number(index === 0) })) };
  const prepared = parseStandPrepared(admission, runId, 4, 4, profile);
  assert.throws(() => parseStandPrepared(admission, runId, 4, 4, chatV2), /invalid-stand-moving-readiness/);
  const swapped = { ...admission, ready: admission.ready.map((row, index) => ({ ...row, movingClients: Number(index === 1) })) };
  assert.throws(() => parseStandPrepared(swapped, runId, 4, 4, profile), /invalid-stand-moving-readiness/);
  const noSamples = { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const results = prepared.ready.map((_, index) => {
    const plan = new ChatV2WorkloadPlan(profile, { index, count: 4 });
    const plannedClients = plan.movingClients;
    return { ...result(index), ...(plannedClients ? {} : { packetsSent: 0, inputPacketsPerSecond: 0, ackMs: noSamples, stateIntervalMs: noSamples }),
      offeredInputPacketsPerSecond: plannedClients * 30, offeredInputStepsPerSecond: plannedClients * 60,
      chatV2: { startAtUnixMs, summary: new ChatV2WorkloadLedger(plan).summary() },
      movement: { plannedClients, sentClients: plannedClients, connectedClients: plannedClients } };
  });
  const finished = parseStandFinished({ runId, results }, runId, prepared, 2, startAtUnixMs);
  assert.deepEqual(finished.results.map(row => row.movement?.plannedClients), [1, 0, 0, 0]);
  assert.equal(finished.results[1].connectedClients, 1);
  const expectation = { profile, shard: { index: 0, count: 4 }, startAtUnixMs };
  for (const changed of [{ movement: undefined }, { movement: { ...results[0].movement, sentClients: 0 } },
    { movement: { ...results[0].movement, extra: true } }, { movement: { ...results[0].movement, connectedClients: 2 } },
    { offeredInputPacketsPerSecond: 120 }, { offeredInputStepsPerSecond: 30 }]) {
    assert.throws(() => parseStandResult({ ...results[0], ...changed }, 4, expectation));
  }
  assert.throws(() => parseStandResult({ ...results[1], packetsSent: 2, inputPacketsPerSecond: 1 }, 4,
    { ...expectation, shard: { index: 1, count: 4 } }), /inconsistent-stand-moving-result/);
});

test('V2 results must reconcile with the expected start, shard counts and exact aggregate schema', () => {
  const startAtUnixMs = now + 2_000, roomEpoch = 'b98e89c0-4a94-4ad1-9af0-3f5dd9959282';
  const prepared = parseStandPrepared({ ...preparation(), ready: preparation().ready.map(row => ({ ...row, chatV2Ready: 1 })) }, runId, 4, 4, chatV2);
  const results = prepared.ready.map((_, index) => {
    const plan = new ChatV2WorkloadPlan(chatV2, { index, count: 4 }), ledger = new ChatV2WorkloadLedger(plan);
    if (index === 0) {
      const messageId = createChatMessageId(now), publicationId = 'bcf0f919-3c62-4307-b61b-530f8559f2c2';
      ledger.offer('steady', 0, { messageId, roomEpoch, text: 'Hello', visitId: 1 }, 0);
      ledger.observeResult(0, { messageId, status: 'accepted' }, 5);
      ledger.observePublication(0, { roomEpoch }, { publicationId, publicationSeq: 1 }, 10);
      ledger.observeResult(0, { messageId, status: 'published', publicationId }, 11);
    }
    return { ...result(index), chatV2: { startAtUnixMs, summary: ledger.summary() } };
  });
  assert.deepEqual(parseStandFinished({ runId, results }, runId, prepared, 2, startAtUnixMs).results[0].chatV2, results[0].chatV2);
  assert.throws(() => parseStandResult(results[0]), /unexpected-stand-chat-result/);
  assert.throws(() => parseStandFinished({ runId, results }, runId, prepared, 2), /invalid-stand-chat-finish/);
  assert.throws(() => parseStandFinished({ runId, results }, runId, prepared, 2, startAtUnixMs + 1), /stand-chat-result-start-mismatch/);
  const { chatV2: original } = results[0];
  const expected = { profile: chatV2, shard: { index: 0, count: 4 }, startAtUnixMs };
  for (const changed of [{ planned: 2 }, { missed: 1 }, { offered: 2 }, { published: 0 }, { acceptanceConfirmed: 0 },
    { messageIds: ['unexpected'] }, { delivery: { ...original.summary.steady.delivery, count: 0 } },
    { offerLag: { ...original.summary.steady.offerLag, max: 1_001 } }]) {
    const summary = { ...original.summary, steady: { ...original.summary.steady, ...changed } };
    assert.throws(() => parseStandResult({ ...results[0], chatV2: { ...original, summary } }, 4, expected));
  }
  assert.throws(() => parseStandResult({ ...results[0], chatV2: undefined }, 4, expected));
  assert.throws(() => parseStandResult(results[0], 4, { ...expected, shard: { index: 0, count: 2 } }), /invalid-stand-chat-shard-count/);
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

test('admission and session budgets are bounded by the configured client profile', () => {
  assert.equal(MAX_MEASUREMENT_SECONDS, 1800); assert.equal(MAX_STAND_SESSION_MS, 50 * 60000);
  assert.equal(standSessionDurationMs(1), 601000); assert.equal(standSessionDurationMs(300), 900000);
  assert.equal(standSessionDurationMs(1800, 6000), 40 * 60000);
  assert.equal(standSessionDurationMs(1800, 6001), MAX_STAND_SESSION_MS);
  assert.equal(standSessionDurationMs(1800, 10000), MAX_STAND_SESSION_MS);
  assert.equal(standAdmissionTimeoutMs(6000), 480000);
  assert.equal(standAdmissionTimeoutMs(6001), 900000);
  assert.equal(standAdmissionTimeoutMs(10000), 900000);
  for (const seconds of [0, -1, .5, 1801, NaN, Infinity]) assert.throws(() => standSessionDurationMs(seconds), RangeError);
  for (const clients of [3, 10001, 6000.5, NaN]) {
    assert.throws(() => standAdmissionTimeoutMs(clients), RangeError);
    assert.throws(() => standSessionDurationMs(1800, clients), RangeError);
  }
  const long = { ...fixture(), seconds: 1800, expiresAt: now + standSessionDurationMs(1800) };
  assert.equal(parseStandManifest(long, now).seconds, 1800);
  assert.throws(() => parseStandManifest({ ...long, seconds: 1801 }, now));
  assert.throws(() => parseStandManifest({ ...long, expiresAt: long.expiresAt + 1 }, now));
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
  const excessiveSamples = (MAX_MEASUREMENT_SECONDS + 45) * MAX_STAND_CLIENTS * 60 + 1;
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
    assert.throws(() => parseStandResult({ ...measured, ackMs: { ...measured.ackMs, count: excessiveSamples } }));
    assert.throws(() => parseStandResult({ ...measured, packetsSent: excessiveSamples, inputPacketsPerSecond: excessiveSamples / 1800 }));
    assert.equal(parseStandResult({ ...measured, errors: { send: packetsSent }, errorCount: packetsSent,
      tracking: { latencyTimingSamplesDropped: packetsSent } }).errorCount, packetsSent);
  }
});

const capacityProfiles = [{ clients: 6000, gameProcesses: 20 }, { clients: 10_000, gameProcesses: 34 }];

for (const { clients, gameProcesses } of capacityProfiles) test(`${clients} clients require an explicit adequate process profile in the private manifest`, () => {
  const seconds = MAX_MEASUREMENT_SECONDS;
  const large = { ...fixture(), clients, gameProcesses, seconds, expiresAt: now + standSessionDurationMs(seconds, clients),
    chatV2: { clients, seconds, steadyPerSecond: 333, movingClients: 1000, burst: { count: clients, atSecond: 2 } },
    tokens: Array.from({ length: clients }, (_, index) => hash('large-client-' + index)) };
  assert(Buffer.byteLength(JSON.stringify(large)) < 1024 ** 2);
  assert.equal(parseStandManifest(large, now).gameProcesses, gameProcesses);
  assert.deepEqual(parseStandManifest(large, now).chatV2, large.chatV2);
  assert.equal(parseStandManifest(fixture(), now).gameProcesses, 4);
  for (const invalid of [undefined, gameProcesses - 1, MAX_GAME_PROCESSES + 1, 0, gameProcesses + .5, NaN]) {
    assert.throws(() => parseStandManifest({ ...large, gameProcesses: invalid }, now));
  }
  assert.throws(() => parseStandManifest({ ...large, expiresAt: large.expiresAt + 1 }, now));
  assert.throws(() => parseStandManifest({ ...large, clients: MAX_STAND_CLIENTS + 1 }, now));
  const manifest = parseStandManifest(large, now), status = { ...manifest, tokens: undefined, secret: undefined };
  verifyStandStatus(status, manifest);
  assert.throws(() => verifyStandStatus({ ...status, gameProcesses: gameProcesses - 1 }, manifest));
  assert.throws(() => verifyStandStatus({ ...status, gameProcesses: undefined }, manifest));
});

for (const { clients, gameProcesses } of capacityProfiles) test(`${clients}-client admission and long results retain exact owners and finite counters`, () => {
  const owners = standGameProcessIds(gameProcesses), roomCount = Math.ceil(clients / 30);
  const rooms = Array.from({ length: roomCount }, (_, index) => ({ id: 'large-room-' + index,
    count: Math.min(30, clients - index * 30), owner: owners[Math.floor(index / 10)] }));
  const largeReady = { ...ready(0), count: clients, connectedClients: clients, rooms, requestedBatch: 4, joinedBatch: 4,
    connectionAttempts: clients, connectionRetries: 0 };
  const preparedValue = { ...preparation(), ready: [largeReady], gameProcesses,
    connectionPhase: { durationSeconds: clients / 20, batches: clients / 4, connectionAttempts: clients, connectionRetries: 0 } };
  const prepared = parseStandPrepared(preparedValue, runId, clients, gameProcesses);
  assert.equal(prepared.ready[0].rooms.length, roomCount);
  assert.equal(prepared.ready[0].rooms.at(-1)?.owner, owners.at(-1));
  assert.throws(() => parseStandPrepared(preparedValue, runId, clients));
  assert.throws(() => parseStandPrepared({ ...preparedValue, gameProcesses: gameProcesses - 1 }, runId, clients, gameProcesses));
  const packetsSent = clients * 60 * MAX_MEASUREMENT_SECONDS;
  const measured = { ...result(0), count: clients, connectedClients: clients, rooms, durationSeconds: MAX_MEASUREMENT_SECONDS,
    observationSeconds: MAX_MEASUREMENT_SECONDS + 2, packetsSent, inputPacketsPerSecond: clients * 60,
    ackMs: { count: packetsSent, sampleCount: 8192, sampling: 'bounded-reservoir', p50: 10, p95: 30, p99: 50, max: 100, mean: 20 },
    tracking: { latencyTimingSamplesDropped: 0 } };
  assert.equal(parseStandFinished({ runId, results: [measured] }, runId, prepared, MAX_MEASUREMENT_SECONDS).results[0].packetsSent, packetsSent);
  assert.throws(() => parseStandResult(measured));
  const foreignRooms = rooms.map((room, index) => index === 0 ? { ...room, owner: 'worker-' + gameProcesses } : room);
  assert.throws(() => parseStandResult({ ...measured, rooms: foreignRooms }, gameProcesses));
  assert.throws(() => parseStandResult({ ...measured, rooms: [...rooms, rooms[0]] }, gameProcesses));
  const tooManySamples = (MAX_MEASUREMENT_SECONDS + 45) * MAX_STAND_CLIENTS * 60 + 1;
  assert.throws(() => parseStandResult({ ...measured, ackMs: { ...measured.ackMs, count: tooManySamples } }, gameProcesses));
  assert.throws(() => parseStandResult({ ...measured, errors: { send: tooManySamples }, errorCount: tooManySamples }, gameProcesses));
  const tooFast = MAX_STAND_CLIENTS * 60 + 1;
  assert.throws(() => parseStandResult({ ...measured, inputPacketsPerSecond: tooFast, packetsSent: tooFast * MAX_MEASUREMENT_SECONDS }, gameProcesses));
});

test('ten thousand clients across 32 V2 generator shards fit the two MiB control request budget', () => {
  const clients = 10_000, gameProcesses = 34, count = 32, seconds = MAX_MEASUREMENT_SECONDS;
  const startAtUnixMs = now + 2_000, owners = standGameProcessIds(gameProcesses);
  const profile = { clients, seconds, movingClients: 1000, steadyPerSecond: 333, burst: { count: clients, atSecond: 2 } };
  const shards = Array.from({ length: count }, (_, index) => {
    const plan = new ChatV2WorkloadPlan(profile, { index, count });
    // With 30 seats per room and 32 shards, a shard can report one room entry per connected client.
    const rooms = Array.from({ length: plan.clientsInShard }, (_, offset) => {
      const roomIndex = Math.floor((index + offset * count) / 30);
      return { id: String(roomIndex).padStart(64, 'r'), owner: owners[Math.floor(roomIndex / 10)], count: 1 };
    });
    const occupancy = { rooms, count: plan.clientsInShard, connectedClients: plan.clientsInShard };
    const inputPacketsPerSecond = plan.movingClients * 30, packetsSent = inputPacketsPerSecond * seconds;
    const batchSize = plan.clientsInShard % 4 || 4, measured = result(index);
    return {
      ready: { ...ready(index), ...occupancy, requestedBatch: batchSize, joinedBatch: batchSize,
        connectionAttempts: plan.clientsInShard, chatV2Ready: plan.clientsInShard, movingClients: plan.movingClients },
      result: { ...measured, ...occupancy, durationSeconds: seconds, observationSeconds: seconds + 5, packetsSent, inputPacketsPerSecond,
        offeredInputPacketsPerSecond: inputPacketsPerSecond, offeredInputStepsPerSecond: inputPacketsPerSecond * 2,
        ackMs: { ...measured.ackMs, count: packetsSent }, chatV2: { startAtUnixMs, summary: new ChatV2WorkloadLedger(plan).summary() },
        movement: { plannedClients: plan.movingClients, sentClients: plan.movingClients, connectedClients: plan.movingClients } },
    };
  });
  const preparedBody = { ...preparation(), gameProcesses, ready: shards.map(shard => shard.ready),
    connectionPhase: { durationSeconds: 550, batches: shards.reduce((sum, shard) => sum + Math.ceil(shard.ready.count / 4), 0),
      connectionAttempts: clients, connectionRetries: 0 } };
  const resultBody = { runId, results: shards.map(shard => shard.result) };
  for (const body of [preparedBody, resultBody]) assert(Buffer.byteLength(JSON.stringify(body)) < 2 * 1024 ** 2);
  const prepared = parseStandPrepared(preparedBody, runId, clients, gameProcesses, profile);
  const finished = parseStandFinished(resultBody, runId, prepared, seconds, startAtUnixMs);
  assert.equal(finished.results.reduce((sum, worker) => sum + worker.connectedClients, 0), clients);
  assert.equal(finished.results.reduce((sum, worker) => sum + (worker.movement?.plannedClients ?? 0), 0), profile.movingClients);
});

test('room identities and ten rooms per owner remain bounded for expanded profiles', () => {
  const duplicated = { ...result(0), count: 2, connectedClients: 2, rooms: [ready(0).rooms[0], ready(0).rooms[0]] };
  assert.throws(() => parseStandResult(duplicated, MAX_GAME_PROCESSES));
  const lastOwner = 'worker-35';
  const rooms = Array.from({ length: 11 }, (_, index) => ({ id: 'over-room-' + index, owner: lastOwner, count: 1 }));
  assert.throws(() => parseStandResult({ ...result(0), count: 11, connectedClients: 11, rooms }, MAX_GAME_PROCESSES));
  const last = { ...result(0), rooms: [{ id: 'last-room', owner: lastOwner, count: 1 }] };
  assert.equal(parseStandResult(last, MAX_GAME_PROCESSES).rooms[0].owner, lastOwner);
  assert.throws(() => parseStandResult(last, MAX_GAME_PROCESSES - 1));
});

for (const gameProcesses of [20, 24, 34, 36]) test(`${gameProcesses}-process control report fits six MiB without changing proof or cumulative totals`, () => {
  const owners = standGameProcessIds(gameProcesses), clients = gameProcesses <= 24 ? 6000 : 10_000;
  const totalFrames = clients * 30 * MAX_MEASUREMENT_SECONDS;
  const processTraffic = (clientCount: number) => {
    const traffic = { incomingFrames: clientCount * 30, incomingBytes: clientCount * 30 * 90, inputFrames: clientCount * 30,
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
    const windows: TrafficWindow[] = Array.from({ length: 300 }, (_, index) => ({ ...traffic, startedAtMs: index * 1000 + .234567891,
      endedAtMs: (index + 1) * 1000 + .234567891, intervalMs: 1000 }));
    const inputFrames = clientCount * 30 * MAX_MEASUREMENT_SECONDS;
    return { inputFrames, diagnosticErrors: 0, maxQueuedStepsPerClient: 12, receiveToInputSeqAge: { count: inputFrames, maxMs: 200 }, windows,
      coverage: { inputQueueClients: clientCount }, limits: { windows: 300, trackedClients: 330 } };
  };
  const intervals: ServerMetrics[] = Array.from({ length: 300 }, (_, index) => ({ kind: 'metrics', intervalStartedAt: now + index * 1000,
    sampledAt: now + (index + 1) * 1000, intervalMs: 1000.123456789, cpuPercent: 50.123456789, rssMiB: 222.123456789,
    heapMiB: 88.123456789, eventLoopP99Ms: 25.123456789, eventLoopMaxMs: 34.123456789 }));
  const serverMetrics = { samples: 1800, cpuMaxPercent: 97, retainedIntervalCount: 300, droppedIntervalCount: 1500, intervals };
  const full = { ok: true, verdict: 'passed-local-comparison', productionTraffic: false, gameProcesses,
    checks: { connections: true, serverInputDeliveryComplete: true },
    summary: { connectedClients: clients, inputPacketsPerSecond: clients * 30 }, inputDelivery: { sentFrames: totalFrames, receivedFrames: totalFrames },
    processLimits: owners.map(id => ({ id, maxRooms: 10, roomCapacity: 30, maxConnections: 330 })),
    servers: Object.fromEntries(owners.map(id => [id, serverMetrics])),
    orchestrator: serverMetrics,
    roomTrafficDiagnostics: Object.fromEntries(owners.map((id, index) => [
      id, processTraffic(Math.floor(clients / gameProcesses) + (index < clients % gameProcesses ? 1 : 0)),
    ])) };
  assert(Buffer.byteLength(JSON.stringify(full)) > STAND_CONTROL_REPORT_MAX_BYTES);
  assert(Buffer.byteLength(encodeStandServerReport(full)) <= STAND_SERVER_ARTIFACT_MAX_BYTES);
  const compact = standReportForControl(full);
  assert(Buffer.byteLength(JSON.stringify({ runId, report: compact })) <= STAND_CONTROL_REPORT_MAX_BYTES);
  for (const key of ['ok', 'verdict', 'productionTraffic', 'gameProcesses', 'checks', 'summary', 'inputDelivery', 'processLimits'] as const) assert.deepEqual(compact[key], full[key]);
  const servers = compact.servers as Record<string, Record<string, unknown>>;
  const diagnostics = compact.roomTrafficDiagnostics as Record<string, Record<string, unknown>>;
  assert.equal(servers.main.samples, 1800); assert.equal(servers.main.cpuMaxPercent, 97); assert.equal(servers.main.intervals, undefined);
  assert.equal(diagnostics.main.inputFrames, full.roomTrafficDiagnostics.main.inputFrames); assert.equal(diagnostics.main.maxQueuedStepsPerClient, 12);
  assert.equal(Object.values(diagnostics).reduce((sum, row) => sum + Number(row.inputFrames), 0), totalFrames);
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
