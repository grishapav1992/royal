import { createHash } from 'node:crypto';
import { availableParallelism, hostname, totalmem } from 'node:os';
import { DEFAULT_GAME_PROCESSES, MAX_GAME_PROCESSES, MAX_MEASUREMENT_SECONDS, MAX_STAND_CLIENTS, MAX_STAND_SESSION_MS,
  STAND_MAX_ROOMS_PER_PROCESS, STAND_ROOM_CAPACITY, standGameProcessIds, standLoadProfile } from './load-stand-limits';

export const STAND_PROTOCOL = 1;
export const STAND_ROLE = 'isolated-test-stand';
export const STAND_CONTROL_REPORT_MAX_BYTES = 6 * 1024 ** 2;
export const STAND_SERVER_ARTIFACT_MAX_BYTES = 32 * 1024 ** 2;
export const STAND_OWNERS = standGameProcessIds();
export type StandHost = { platform: string; arch: string; logicalCPUs: number; ramGiB: number; hostFingerprint: string };
export type StandManifest = {
  protocol: 1; role: typeof STAND_ROLE; runId: string; secret: string; createdAt: number; expiresAt: number;
  apiEndpoint: string; controlEndpoint: string; serverApiPort: number; serverControlPort: number;
  bundleSha256: string; clients: number; seconds: number; gameProcesses?: number; serverHost: StandHost; tokens: string[];
};
export type StandOccupancy = { id: string; count: number; owner: string };
export type StandReady = { kind: 'ready'; count: number; connectedClients: number; rooms: StandOccupancy[];
  errors: Record<string, number>; requestedBatch: number; joinedBatch: number; connectionAttempts: number;
  connectionRetries: number; retryCodes: Record<string, number>; transport?: unknown };
export type StandQuantiles = { count: number; p50: number; p95: number; p99: number; max: number;
  sampleCount?: number; sampling?: 'complete' | 'bounded-reservoir'; mean?: number };
export type StandResult = { kind: 'result'; count: number; connectedClients: number; rooms: StandOccupancy[];
  durationSeconds: number; observationSeconds: number; packetsSent: number; inputPacketsPerSecond: number;
  receivedBytes: number; maxClientBufferedBytes: number; ackMs: StandQuantiles; stateIntervalMs: StandQuantiles;
  unacknowledgedPackets: number; unacknowledgedAtEndOfSending: number; oldestUnacknowledgedMs: number; drainSeconds: number;
  errorCount: number; errors: Record<string, number>; generator: { cpuPercent: number; rssMiB: number; eventLoopP99Ms: number; eventLoopMaxMs: number };
  [key: string]: unknown };
export type StandPrepared = { runId: string; ready: StandReady[]; gameProcesses?: number; clientHost: StandHost; inputMode: 'stress' | 'browser-window';
  connectionPhase: { durationSeconds: number; batches: number; connectionAttempts: number; connectionRetries: number } };
export type StandFinished = { runId: string; results: StandResult[] };
export class StandError extends Error { constructor(readonly code: string) { super(code); } }
export type StandErrorDiagnostics = { name: string; code?: string; errno?: number; authStatus?: number;
  frames: { file: string; line: number; column: number }[] };
const diagnosticNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError', 'AggregateError', 'DatabaseError', 'error']);
const diagnosticCodes = new Set(['EACCES', 'ENOENT', 'ENOMEM', 'ENOSPC', 'EADDRINUSE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'EPIPE', 'EPERM', 'EBADF', 'ENOTDIR', 'EEXIST', 'EMFILE', 'ENFILE', 'EIO', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_INVALID_ARG_VALUE', 'ERR_INVALID_ARG_TYPE', 'ERR_OUT_OF_RANGE', 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS',
  'ERR_CRYPTO_SCRYPT_INVALID_PARAMETER', 'ERR_CRYPTO_SCRYPT_NOT_SUPPORTED', 'ERR_CRYPTO_OPERATION_FAILED', 'ERR_OSSL_EVP_UNSUPPORTED']);
const diagnosticSqlStates = /^(?:00|01|02|03|08|09|0A|0B|0F|0L|0P|0Z|20|21|22|23|24|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|40|42|44|53|54|55|57|58|72|F0|HV|P0|XX)[0-9A-Z]{3}$/;
const diagnosticFiles = new Set(['cluster.mjs', 'load-websocket-cluster.ts', 'accounts.ts', 'database.ts']);
// Only a caller that has identified the AuthError class may supply its status.
export function standErrorDiagnostics(error: unknown, authStatus?: number): StandErrorDiagnostics {
  const read = (key: string): unknown => { try { return error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined; } catch { return undefined; } };
  const rawName = read('name'), rawCode = read('code'), rawErrno = read('errno'), rawStack = read('stack');
  const result: StandErrorDiagnostics = { name: typeof rawName === 'string' && diagnosticNames.has(rawName) ? rawName : 'UnknownError', frames: [] };
  if (Number.isInteger(authStatus) && authStatus! >= 400 && authStatus! <= 599) { result.name = 'AuthError'; result.authStatus = authStatus; }
  if (typeof rawCode === 'string' && (diagnosticCodes.has(rawCode) || diagnosticSqlStates.test(rawCode))) result.code = rawCode;
  if (typeof rawErrno === 'number' && Number.isInteger(rawErrno) && rawErrno < 0 && rawErrno >= -4095) result.errno = rawErrno;
  if (typeof rawStack === 'string') for (const frame of rawStack.slice(0, 16384).split('\n').slice(1, 65)) {
    if (!/^\s+at\s/.test(frame)) continue;
    const match = /(?:^|[/\\])([a-zA-Z0-9-]+\.(?:ts|mjs)):(\d{1,7}):(\d{1,7})\)?$/.exec(frame);
    if (!match || !diagnosticFiles.has(match[1])) continue;
    const line = Number(match[2]), column = Number(match[3]);
    if (line > 0 && column > 0) result.frames.push({ file: match[1], line, column });
    if (result.frames.length === 4) break;
  }
  return result;
}
const hex = /^[a-f0-9]{64}$/;
// Browser batches can contain fewer than two steps, so allow up to one packet per offered 60 Hz step.
const MAX_RESULT_SAMPLES = (MAX_MEASUREMENT_SECONDS + 45) * MAX_STAND_CLIENTS * 60;
const MAX_CONNECTION_ATTEMPTS = MAX_STAND_CLIENTS * 4;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StandError('invalid-stand-object');
  return value as Record<string, unknown>;
};
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) throw new StandError('invalid-stand-number');
  return value;
};
const counts = (value: unknown): Record<string, number> => {
  const entries = Object.entries(object(value)); if (entries.length > 64) throw new StandError('invalid-stand-counts');
  return Object.fromEntries(entries.map(([key, count]) => {
    if (!/^[a-zA-Z0-9_. -]{1,96}$/.test(key)) throw new StandError('invalid-stand-count-key');
    return [key, number(count, 0, MAX_RESULT_SAMPLES, true)];
  }));
};
export function standHost(): StandHost {
  return { platform: process.platform, arch: process.arch, logicalCPUs: availableParallelism(),
    ramGiB: Number((totalmem() / 1024 ** 3).toFixed(2)), hostFingerprint: createHash('sha256').update(hostname()).digest('hex') };
}
export function parseStandHost(value: unknown): StandHost {
  const host = object(value);
  if (typeof host.platform !== 'string' || !/^[a-z0-9-]{1,24}$/.test(host.platform)
    || typeof host.arch !== 'string' || !/^[a-z0-9-]{1,24}$/.test(host.arch)
    || typeof host.hostFingerprint !== 'string' || !hex.test(host.hostFingerprint)) throw new StandError('invalid-stand-host');
  return { platform: host.platform, arch: host.arch, logicalCPUs: number(host.logicalCPUs, 1, 1024, true),
    ramGiB: number(host.ramGiB, .01, 65536), hostFingerprint: host.hostFingerprint };
}
export function loopbackEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new StandError('invalid-stand-endpoint');
  let url: URL; try { url = new URL(value); } catch { throw new StandError('invalid-stand-endpoint'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new StandError('invalid-stand-endpoint');
  number(Number(url.port), 1, 65535, true); return url.origin;
}
export function parseStandManifest(value: unknown, now = Date.now()): StandManifest {
  const manifest = object(value);
  if (manifest.protocol !== STAND_PROTOCOL || manifest.role !== STAND_ROLE || typeof manifest.runId !== 'string'
    || !/^[a-f0-9-]{36}$/.test(manifest.runId) || typeof manifest.secret !== 'string' || !hex.test(manifest.secret)
    || typeof manifest.bundleSha256 !== 'string' || !hex.test(manifest.bundleSha256)) throw new StandError('invalid-stand-manifest');
  const createdAt = number(manifest.createdAt, 1), expiresAt = number(manifest.expiresAt, now + 1, now + MAX_STAND_SESSION_MS);
  if (createdAt > now + 30000 || expiresAt <= createdAt || expiresAt - createdAt > MAX_STAND_SESSION_MS) throw new StandError('invalid-stand-expiry');
  const clients = number(manifest.clients, 4, MAX_STAND_CLIENTS, true), seconds = number(manifest.seconds, 1, MAX_MEASUREMENT_SECONDS, true);
  const gameProcesses = number(manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES, 1, MAX_GAME_PROCESSES, true);
  try { standLoadProfile(clients, gameProcesses); } catch { throw new StandError('invalid-stand-profile'); }
  if (!Array.isArray(manifest.tokens) || manifest.tokens.length !== clients || manifest.tokens.some(token => typeof token !== 'string' || !hex.test(token))
    || new Set(manifest.tokens).size !== clients) throw new StandError('invalid-stand-tokens');
  return { protocol: 1, role: STAND_ROLE, runId: manifest.runId, secret: manifest.secret, createdAt, expiresAt,
    apiEndpoint: loopbackEndpoint(manifest.apiEndpoint), controlEndpoint: loopbackEndpoint(manifest.controlEndpoint),
    serverApiPort: number(manifest.serverApiPort, 1, 65535, true), serverControlPort: number(manifest.serverControlPort, 1, 65535, true),
    bundleSha256: manifest.bundleSha256, clients, seconds, gameProcesses, serverHost: parseStandHost(manifest.serverHost), tokens: [...manifest.tokens] as string[] };
}
function occupancy(value: unknown, gameProcesses: number): StandOccupancy[] {
  const owners = standGameProcessIds(gameProcesses);
  if (!Array.isArray(value) || value.length > gameProcesses * STAND_MAX_ROOMS_PER_PROCESS) throw new StandError('invalid-stand-rooms');
  const ids = new Set<string>(), ownerRooms = new Map<string, number>();
  return value.map(item => { const room = object(item);
    if (typeof room.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(room.id) || typeof room.owner !== 'string'
      || !owners.includes(room.owner) || ids.has(room.id)) throw new StandError('invalid-stand-room');
    ids.add(room.id); ownerRooms.set(room.owner, (ownerRooms.get(room.owner) ?? 0) + 1);
    if (ownerRooms.get(room.owner)! > STAND_MAX_ROOMS_PER_PROCESS) throw new StandError('invalid-stand-owner-room-cap');
    return { id: room.id, owner: room.owner, count: number(room.count, 0, STAND_ROOM_CAPACITY, true) };
  });
}
function quantiles(value: unknown): StandQuantiles {
  const stats = object(value), keys = ['p50', 'p95', 'p99', 'max'] as const;
  const parsed = { count: number(stats.count, 0, MAX_RESULT_SAMPLES, true), ...Object.fromEntries(keys.map(key => [key, number(stats[key], 0, 3600000)])) } as StandQuantiles;
  if (!(parsed.p50 <= parsed.p95 && parsed.p95 <= parsed.p99 && parsed.p99 <= parsed.max)) throw new StandError('invalid-stand-quantiles');
  if (stats.sampleCount !== undefined || stats.sampling !== undefined || stats.mean !== undefined) {
    parsed.sampleCount = number(stats.sampleCount, 0, Math.min(parsed.count, 8192), true);
    if (stats.sampling !== (parsed.sampleCount === parsed.count ? 'complete' : 'bounded-reservoir')) throw new StandError('invalid-stand-sampling');
    parsed.sampling = stats.sampling as StandQuantiles['sampling'];
    parsed.mean = number(stats.mean, 0, parsed.max);
  }
  return parsed;
}
export function parseStandReady(value: unknown, gameProcesses = DEFAULT_GAME_PROCESSES): StandReady {
  const ready = object(value); if (ready.kind !== 'ready') throw new StandError('invalid-stand-ready');
  const rooms = occupancy(ready.rooms, gameProcesses), count = number(ready.count, 1, Math.min(MAX_STAND_CLIENTS, gameProcesses * STAND_MAX_ROOMS_PER_PROCESS * STAND_ROOM_CAPACITY), true), connectedClients = number(ready.connectedClients, 0, count, true);
  if (rooms.reduce((sum, room) => sum + room.count, 0) !== connectedClients) throw new StandError('invalid-stand-ready-occupancy');
  return { kind: 'ready', count, connectedClients, rooms, errors: counts(ready.errors),
    requestedBatch: number(ready.requestedBatch, 1, 4, true), joinedBatch: number(ready.joinedBatch, 0, 4, true),
    connectionAttempts: number(ready.connectionAttempts, 0, MAX_CONNECTION_ATTEMPTS, true), connectionRetries: number(ready.connectionRetries, 0, MAX_CONNECTION_ATTEMPTS, true),
    retryCodes: counts(ready.retryCodes), transport: ready.transport };
}
export function parseStandPrepared(value: unknown, runId: string, clients: number, gameProcesses = DEFAULT_GAME_PROCESSES): StandPrepared {
  const prepared = object(value);
  try { standLoadProfile(clients, gameProcesses); } catch { throw new StandError('invalid-stand-profile'); }
  if ((prepared.gameProcesses ?? DEFAULT_GAME_PROCESSES) !== gameProcesses) throw new StandError('stand-profile-mismatch');
  if (prepared.runId !== runId || !Array.isArray(prepared.ready) || prepared.ready.length < 1 || prepared.ready.length > 32
    || !['stress', 'browser-window'].includes(String(prepared.inputMode))) throw new StandError('invalid-stand-prepared');
  const ready = prepared.ready.map(item => parseStandReady(item, gameProcesses)), connection = object(prepared.connectionPhase);
  if (ready.reduce((sum, item) => sum + item.count, 0) !== clients || ready.some(item => item.count !== item.connectedClients
    || Object.values(item.errors).some(count => count > 0))) throw new StandError('incomplete-stand-admission');
  return { runId, ready, gameProcesses, clientHost: parseStandHost(prepared.clientHost), inputMode: prepared.inputMode as StandPrepared['inputMode'],
    connectionPhase: { durationSeconds: number(connection.durationSeconds, 0, 900), batches: number(connection.batches, 1, MAX_STAND_CLIENTS, true),
      connectionAttempts: number(connection.connectionAttempts, 0, MAX_CONNECTION_ATTEMPTS, true), connectionRetries: number(connection.connectionRetries, 0, MAX_CONNECTION_ATTEMPTS, true) } };
}
export function parseStandResult(value: unknown, gameProcesses = DEFAULT_GAME_PROCESSES): StandResult {
  const result = object(value); if (result.kind !== 'result') throw new StandError('invalid-stand-result');
  const count = number(result.count, 1, Math.min(MAX_STAND_CLIENTS, gameProcesses * STAND_MAX_ROOMS_PER_PROCESS * STAND_ROOM_CAPACITY), true), connectedClients = number(result.connectedClients, 0, count, true), rooms = occupancy(result.rooms, gameProcesses);
  if (rooms.reduce((sum, room) => sum + room.count, 0) !== connectedClients) throw new StandError('invalid-stand-result-occupancy');
  const durationSeconds = number(result.durationSeconds, .001, MAX_MEASUREMENT_SECONDS + 30), observationSeconds = number(result.observationSeconds, durationSeconds, MAX_MEASUREMENT_SECONDS + 45);
  const packetsSent = number(result.packetsSent, 0, MAX_RESULT_SAMPLES, true), inputPacketsPerSecond = number(result.inputPacketsPerSecond, 0, MAX_STAND_CLIENTS * 60);
  if (Math.abs(packetsSent / durationSeconds - inputPacketsPerSecond) > Math.max(.1, inputPacketsPerSecond * .001)) throw new StandError('inconsistent-stand-rate');
  const generator = object(result.generator), errors = counts(result.errors), errorCount = number(result.errorCount, 0, MAX_RESULT_SAMPLES, true);
  if (Object.values(errors).reduce((sum, n) => sum + n, 0) !== errorCount) throw new StandError('inconsistent-stand-errors');
  if (result.tracking !== undefined) number(object(result.tracking).latencyTimingSamplesDropped, 0, MAX_RESULT_SAMPLES, true);
  // Preserve bounded diagnostics from our worker while validating fields used for the verdict.
  return { ...result, kind: 'result', count, connectedClients, rooms, durationSeconds, observationSeconds, packetsSent, inputPacketsPerSecond,
    receivedBytes: number(result.receivedBytes), maxClientBufferedBytes: number(result.maxClientBufferedBytes),
    ackMs: quantiles(result.ackMs), stateIntervalMs: quantiles(result.stateIntervalMs), unacknowledgedPackets: number(result.unacknowledgedPackets, 0, packetsSent, true),
    unacknowledgedAtEndOfSending: number(result.unacknowledgedAtEndOfSending, 0, packetsSent, true),
    oldestUnacknowledgedMs: number(result.oldestUnacknowledgedMs, 0, 3600000), drainSeconds: number(result.drainSeconds, 0, 15), errorCount, errors,
    generator: { cpuPercent: number(generator.cpuPercent, 0, 100000), rssMiB: number(generator.rssMiB),
      eventLoopP99Ms: number(generator.eventLoopP99Ms, 0, 3600000), eventLoopMaxMs: number(generator.eventLoopMaxMs, 0, 3600000) } };
}
export function parseStandFinished(value: unknown, runId: string, prepared: StandPrepared, seconds: number): StandFinished {
  const finished = object(value);
  if (finished.runId !== runId || !Array.isArray(finished.results) || finished.results.length !== prepared.ready.length) throw new StandError('invalid-stand-results');
  const results = finished.results.map(item => parseStandResult(item, prepared.gameProcesses ?? DEFAULT_GAME_PROCESSES));
  if (results.some((result, index) => result.count !== prepared.ready[index].count || result.durationSeconds < seconds * .9)) throw new StandError('incomplete-stand-measurement');
  return { runId, results };
}
export function verifyStandStatus(value: unknown, manifest: StandManifest) {
  const status = object(value);
  if (status.protocol !== STAND_PROTOCOL || status.role !== STAND_ROLE || status.runId !== manifest.runId
    || status.bundleSha256 !== manifest.bundleSha256 || status.clients !== manifest.clients || status.seconds !== manifest.seconds
    || status.expiresAt !== manifest.expiresAt || status.apiEndpoint !== manifest.apiEndpoint
    || (status.gameProcesses ?? DEFAULT_GAME_PROCESSES) !== (manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES)) throw new StandError('stand-attestation-mismatch');
  if (parseStandHost(status.serverHost).hostFingerprint !== manifest.serverHost.hostFingerprint) throw new StandError('stand-host-mismatch');
}

/** Detailed arrays stay in the server artifact when they exceed the control response budget. */
export function standReportForControl(report: Record<string, unknown>, maximumBytes = STAND_CONTROL_REPORT_MAX_BYTES): Record<string, unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > STAND_CONTROL_REPORT_MAX_BYTES) throw new StandError('invalid-stand-response-budget');
  // The authenticated control response wraps the report with a 36-character run ID.
  const reportBudget = maximumBytes - 128;
  const fullBytes = Buffer.byteLength(JSON.stringify(report));
  if (fullBytes <= reportBudget) return report;
  const omittedArrays: { path: string; items: number }[] = [];
  const omit = (value: unknown, key: string, path: string): Record<string, unknown> => {
    const source = object(value), items = source[key];
    if (!Array.isArray(items)) throw new StandError('invalid-stand-report-detail');
    omittedArrays.push({ path: path + '.' + key, items: items.length });
    const { [key]: _details, ...aggregate } = source;
    return aggregate;
  };
  const compact = { ...report };
  if (report.servers !== undefined) compact.servers = Object.fromEntries(Object.entries(object(report.servers))
    .map(([id, value]) => [id, omit(value, 'intervals', 'servers.' + id)]));
  if (report.orchestrator !== undefined) compact.orchestrator = omit(report.orchestrator, 'intervals', 'orchestrator');
  if (report.proxyResources !== undefined) compact.proxyResources = omit(report.proxyResources, 'intervals', 'proxyResources');
  if (report.roomTrafficDiagnostics !== undefined) compact.roomTrafficDiagnostics = Object.fromEntries(Object.entries(object(report.roomTrafficDiagnostics))
    .map(([id, value]) => [id, omit(value, 'windows', 'roomTrafficDiagnostics.' + id)]));
  compact.detailTransfer = { source: 'server-result-artifact', fullReportBytes: fullBytes, controlResponseMaximumBytes: maximumBytes, omittedArrays };
  if (Buffer.byteLength(JSON.stringify(compact)) > reportBudget) throw new StandError('stand-summary-response-too-large');
  return compact;
}

export function encodeStandServerReport(report: Record<string, unknown>, pretty = false): string {
  const encoded = JSON.stringify(report, null, pretty ? 2 : undefined) + '\n';
  if (Buffer.byteLength(encoded) > STAND_SERVER_ARTIFACT_MAX_BYTES) throw new StandError('stand-server-artifact-too-large');
  return encoded;
}
