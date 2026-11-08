import { createHash } from 'node:crypto';
import { availableParallelism, hostname, totalmem } from 'node:os';
import { ChatV2WorkloadPlan, type ChatV2WorkloadLedger, type ChatV2WorkloadProfile } from './load-chat-v2-workload';
import type { ChatAuditSummary } from './load-chat-v2-audit-types';
import { DEFAULT_GAME_PROCESSES, MAX_GAME_PROCESSES, MAX_MEASUREMENT_SECONDS, MAX_STAND_CLIENTS,
  STAND_MAX_ROOMS_PER_PROCESS, STAND_ROOM_CAPACITY, standGameProcessIds, standLoadProfile, standSessionDurationMs } from './load-stand-limits';

export const STAND_PROTOCOL = 1;
export const STAND_ROLE = 'isolated-test-stand';
export const STAND_CONTROL_REPORT_MAX_BYTES = 6 * 1024 ** 2;
export const STAND_SERVER_ARTIFACT_MAX_BYTES = 32 * 1024 ** 2;
export const STAND_CHAT_START_MAX_LEAD_MS = 10_000;
const STAND_CHAT_DRAIN_MS = 5_000;
export const STAND_OWNERS = standGameProcessIds();
export type StandHost = { platform: string; arch: string; logicalCPUs: number; ramGiB: number; hostFingerprint: string };
export type StandManifest = {
  protocol: 1; role: typeof STAND_ROLE; runId: string; secret: string; createdAt: number; expiresAt: number;
  apiEndpoint: string; controlEndpoint: string; serverApiPort: number; serverControlPort: number;
  bundleSha256: string; clients: number; seconds: number; gameProcesses?: number; serverHost: StandHost; tokens: string[];
  chatV2?: ChatV2WorkloadProfile;
};
export type StandOccupancy = { id: string; count: number; owner: string };
export type StandReady = { kind: 'ready'; count: number; connectedClients: number; rooms: StandOccupancy[];
  errors: Record<string, number>; requestedBatch: number; joinedBatch: number; connectionAttempts: number;
  connectionRetries: number; retryCodes: Record<string, number>; transport?: unknown; chatV2Ready?: number; movingClients?: number };
export type StandQuantiles = { count: number; p50: number; p95: number; p99: number; max: number;
  sampleCount?: number; sampling?: 'complete' | 'bounded-reservoir'; mean?: number };
type StandChatV2Summary = ReturnType<ChatV2WorkloadLedger['summary']>;
type StandChatV2Result = { startAtUnixMs: number; summary: StandChatV2Summary };
type StandChatV2Expectation = { profile: ChatV2WorkloadProfile; shard: { index: number; count: number }; startAtUnixMs: number };
type StandMovementResult = { plannedClients: number; sentClients: number; connectedClients: number };
export type StandResult = { kind: 'result'; count: number; connectedClients: number; rooms: StandOccupancy[];
  durationSeconds: number; observationSeconds: number; packetsSent: number; inputPacketsPerSecond: number;
  receivedBytes: number; maxClientBufferedBytes: number; ackMs: StandQuantiles; stateIntervalMs: StandQuantiles;
  unacknowledgedPackets: number; unacknowledgedAtEndOfSending: number; oldestUnacknowledgedMs: number; drainSeconds: number;
  errorCount: number; errors: Record<string, number>; generator: { cpuPercent: number; rssMiB: number; eventLoopP99Ms: number; eventLoopMaxMs: number };
  chatV2?: StandChatV2Result; movement?: StandMovementResult; [key: string]: unknown };
export type StandPrepared = { runId: string; ready: StandReady[]; gameProcesses?: number; clientHost: StandHost; inputMode: 'stress' | 'browser-window';
  connectionPhase: { durationSeconds: number; batches: number; connectionAttempts: number; connectionRetries: number }; chatV2?: ChatV2WorkloadProfile };
export type StandFinished = { runId: string; results: StandResult[]; chatAudit?: ChatAuditSummary };
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
function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
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
export function parseStandChatV2(value: unknown, clients: number, seconds: number): ChatV2WorkloadProfile {
  const profile = object(value);
  number(clients, 4, MAX_STAND_CLIENTS, true);
  number(seconds, 1, MAX_MEASUREMENT_SECONDS, true);
  if (!hasKeys(profile, ['clients', 'seconds', 'steadyPerSecond'], ['burst', 'movingClients']) || profile.clients !== clients || profile.seconds !== seconds) {
    throw new StandError('invalid-stand-chat-profile');
  }
  const steadyPerSecond = number(profile.steadyPerSecond, 0, 333, true);
  const movingClients = profile.movingClients === undefined ? undefined : number(profile.movingClients, 0, clients, true);
  let burst: ChatV2WorkloadProfile['burst'];
  if (profile.burst !== undefined) {
    const raw = object(profile.burst);
    if (!hasKeys(raw, ['count', 'atSecond'])) throw new StandError('invalid-stand-chat-burst');
    burst = { count: number(raw.count, 1, clients, true), atSecond: number(raw.atSecond, 0, seconds - 1, true) };
  }
  const chat = { clients, seconds, steadyPerSecond, ...(movingClients === undefined ? {} : { movingClients }), ...(burst ? { burst } : {}) };
  try { new ChatV2WorkloadPlan(chat); } catch { throw new StandError('invalid-stand-chat-profile'); }
  return chat;
}

/** Compare the barrier time with the local wall clock. This does not estimate clock offset. */
export function parseStandStart(value: unknown, manifest: Pick<StandManifest, 'runId' | 'expiresAt' | 'seconds' | 'chatV2'>,
  now = Date.now()): { start: true; runId: string; startAtUnixMs?: number } {
  const start = object(value), keys = manifest.chatV2 ? ['start', 'runId', 'startAtUnixMs'] : ['start', 'runId'];
  if (!hasKeys(start, keys) || start.start !== true || start.runId !== manifest.runId) throw new StandError('stand-start-barrier-mismatch');
  if (!manifest.chatV2) return { start: true, runId: manifest.runId };
  const latest = Math.min(now + STAND_CHAT_START_MAX_LEAD_MS, manifest.expiresAt - manifest.seconds * 1_000 - STAND_CHAT_DRAIN_MS - 1);
  if (!Number.isSafeInteger(now) || typeof start.startAtUnixMs !== 'number' || !Number.isSafeInteger(start.startAtUnixMs)
    || start.startAtUnixMs <= now || start.startAtUnixMs > latest) throw new StandError('invalid-stand-chat-start');
  return { start: true, runId: manifest.runId, startAtUnixMs: start.startAtUnixMs };
}

export function parseStandManifest(value: unknown, now = Date.now()): StandManifest {
  const manifest = object(value);
  if (manifest.protocol !== STAND_PROTOCOL || manifest.role !== STAND_ROLE || typeof manifest.runId !== 'string'
    || !/^[a-f0-9-]{36}$/.test(manifest.runId) || typeof manifest.secret !== 'string' || !hex.test(manifest.secret)
    || typeof manifest.bundleSha256 !== 'string' || !hex.test(manifest.bundleSha256)) throw new StandError('invalid-stand-manifest');
  const clients = number(manifest.clients, 4, MAX_STAND_CLIENTS, true), seconds = number(manifest.seconds, 1, MAX_MEASUREMENT_SECONDS, true);
  const gameProcesses = number(manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES, 1, MAX_GAME_PROCESSES, true);
  try { standLoadProfile(clients, gameProcesses); } catch { throw new StandError('invalid-stand-profile'); }
  const maximumSessionMs = standSessionDurationMs(MAX_MEASUREMENT_SECONDS, clients);
  const createdAt = number(manifest.createdAt, 1), expiresAt = number(manifest.expiresAt, now + 1, now + maximumSessionMs);
  if (createdAt > now + 30000 || expiresAt <= createdAt || expiresAt - createdAt > maximumSessionMs) throw new StandError('invalid-stand-expiry');
  if (!Array.isArray(manifest.tokens) || manifest.tokens.length !== clients || manifest.tokens.some(token => typeof token !== 'string' || !hex.test(token))
    || new Set(manifest.tokens).size !== clients) throw new StandError('invalid-stand-tokens');
  const chatV2 = manifest.chatV2 === undefined ? undefined : parseStandChatV2(manifest.chatV2, clients, seconds);
  return { protocol: 1, role: STAND_ROLE, runId: manifest.runId, secret: manifest.secret, createdAt, expiresAt,
    apiEndpoint: loopbackEndpoint(manifest.apiEndpoint), controlEndpoint: loopbackEndpoint(manifest.controlEndpoint),
    serverApiPort: number(manifest.serverApiPort, 1, 65535, true), serverControlPort: number(manifest.serverControlPort, 1, 65535, true),
    bundleSha256: manifest.bundleSha256, clients, seconds, gameProcesses, serverHost: parseStandHost(manifest.serverHost), tokens: [...manifest.tokens] as string[],
    ...(chatV2 ? { chatV2 } : {}) };
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
  const chatV2Ready = ready.chatV2Ready === undefined ? {} : { chatV2Ready: number(ready.chatV2Ready, 0, connectedClients, true) };
  const moving = ready.movingClients === undefined ? {} : { movingClients: number(ready.movingClients, 0, connectedClients, true) };
  return { kind: 'ready', count, connectedClients, rooms, errors: counts(ready.errors), ...chatV2Ready, ...moving,
    requestedBatch: number(ready.requestedBatch, 1, 4, true), joinedBatch: number(ready.joinedBatch, 0, 4, true),
    connectionAttempts: number(ready.connectionAttempts, 0, MAX_CONNECTION_ATTEMPTS, true), connectionRetries: number(ready.connectionRetries, 0, MAX_CONNECTION_ATTEMPTS, true),
    retryCodes: counts(ready.retryCodes), transport: ready.transport };
}
export function parseStandPrepared(value: unknown, runId: string, clients: number, gameProcesses = DEFAULT_GAME_PROCESSES,
  chatV2?: ChatV2WorkloadProfile): StandPrepared {
  const prepared = object(value);
  try { standLoadProfile(clients, gameProcesses); } catch { throw new StandError('invalid-stand-profile'); }
  if ((prepared.gameProcesses ?? DEFAULT_GAME_PROCESSES) !== gameProcesses) throw new StandError('stand-profile-mismatch');
  if (prepared.runId !== runId || !Array.isArray(prepared.ready) || prepared.ready.length < 1 || prepared.ready.length > 32
    || !['stress', 'browser-window'].includes(String(prepared.inputMode))) throw new StandError('invalid-stand-prepared');
  const ready = prepared.ready.map(item => parseStandReady(item, gameProcesses)), connection = object(prepared.connectionPhase);
  if (ready.reduce((sum, item) => sum + item.count, 0) !== clients || ready.some(item => item.count !== item.connectedClients
    || Object.values(item.errors).some(count => count > 0))) throw new StandError('incomplete-stand-admission');
  const profile = chatV2 && parseStandChatV2(chatV2, clients, chatV2.seconds);
  for (const [index, item] of ready.entries()) {
    const plan = profile && new ChatV2WorkloadPlan(profile, { index, count: ready.length });
    if (plan ? item.chatV2Ready !== item.count || item.count !== plan.clientsInShard : item.chatV2Ready !== undefined) {
      throw new StandError('invalid-stand-chat-readiness');
    }
    const movingClients = profile?.movingClients === undefined ? undefined : plan?.movingClients;
    if (item.movingClients !== movingClients) throw new StandError('invalid-stand-moving-readiness');
  }
  return { runId, ready, gameProcesses, clientHost: parseStandHost(prepared.clientHost), inputMode: prepared.inputMode as StandPrepared['inputMode'],
    ...(profile ? { chatV2: profile } : {}),
    connectionPhase: { durationSeconds: number(connection.durationSeconds, 0, 900), batches: number(connection.batches, 1, MAX_STAND_CLIENTS, true),
      connectionAttempts: number(connection.connectionAttempts, 0, MAX_CONNECTION_ATTEMPTS, true), connectionRetries: number(connection.connectionRetries, 0, MAX_CONNECTION_ATTEMPTS, true) } };
}
const chatCounters = ['planned', 'offered', 'missed', 'retryAttempts', 'firstResponseRetryLater', 'deferred', 'resumeMiss', 'unanswered',
  'acknowledgements', 'acceptanceConfirmed', 'acceptedWithoutTerminal', 'unresolved', 'published', 'rejected', 'cancelled', 'expired',
  'terminalByDeadline', 'witnessed'] as const;
function chatQuantiles(value: unknown, count: number) {
  const raw = object(value);
  if (!hasKeys(raw, ['count', 'sampleCount', 'sampling', 'p50', 'p95', 'p99', 'max', 'mean'])) throw new StandError('invalid-stand-chat-latency');
  const stats = quantiles(raw), { sampleCount, sampling, mean } = stats;
  if (stats.count !== count || sampleCount !== Math.min(8192, count) || sampling === undefined || mean === undefined
    || (count === 0 && stats.max !== 0)) throw new StandError('invalid-stand-chat-latency');
  return { ...stats, sampleCount, sampling, mean };
}
function parseStandChatCohort(value: unknown, planned: number): StandChatV2Summary['steady'] {
  const row = object(value);
  if (!hasKeys(row, [...chatCounters, 'offerLag', 'acknowledgement', 'delivery']) || row.planned !== planned) {
    throw new StandError('invalid-stand-chat-cohort');
  }
  const offered = number(row.offered, 0, planned, true);
  const counters = Object.fromEntries(chatCounters.map(key => {
    let maximum = offered;
    if (key === 'planned' || key === 'missed') maximum = planned;
    if (key === 'retryAttempts' && offered > 0) maximum = MAX_RESULT_SAMPLES;
    return [key, number(row[key], 0, maximum, true)];
  })) as Record<(typeof chatCounters)[number], number>;
  const { missed, firstResponseRetryLater, deferred, resumeMiss, unanswered, acknowledgements, acceptanceConfirmed, acceptedWithoutTerminal,
    unresolved, published, rejected, cancelled, expired, terminalByDeadline, witnessed } = counters;
  const terminal = published + rejected + cancelled + expired;
  if (offered + missed !== planned || terminal + unresolved !== offered || unanswered > unresolved
    || firstResponseRetryLater > deferred || deferred > offered - unanswered || resumeMiss > offered - unanswered
    || acceptanceConfirmed < Math.max(acknowledgements, published + acceptedWithoutTerminal)
    || acceptanceConfirmed > Math.min(acknowledgements + published, published + acceptedWithoutTerminal + rejected + cancelled)
    || acceptedWithoutTerminal > Math.min(acknowledgements, unresolved - unanswered)
    || acknowledgements - acceptedWithoutTerminal > terminal - expired || terminalByDeadline > terminal || witnessed > published) {
    throw new StandError('inconsistent-stand-chat-counts');
  }
  const offerLag = chatQuantiles(row.offerLag, offered);
  if (offerLag.max > 1_000) throw new StandError('invalid-stand-chat-offer-lag');
  return { ...counters, offerLag, acknowledgement: chatQuantiles(row.acknowledgement, acknowledgements), delivery: chatQuantiles(row.delivery, witnessed) };
}

function parseStandChatResult(value: unknown, plan: ChatV2WorkloadPlan, startAtUnixMs: number, count: number): StandChatV2Result {
  const row = object(value);
  if (!hasKeys(row, ['startAtUnixMs', 'summary']) || row.startAtUnixMs !== startAtUnixMs
    || !Number.isSafeInteger(startAtUnixMs) || startAtUnixMs <= 0) throw new StandError('stand-chat-result-start-mismatch');
  if (count !== plan.clientsInShard) throw new StandError('invalid-stand-chat-shard-count');
  const summary = object(row.summary);
  if (!hasKeys(summary, ['steady', 'burst', 'unmatchedPublications'])) throw new StandError('invalid-stand-chat-summary');
  const steady = parseStandChatCohort(summary.steady, plan.planned.steady), burst = parseStandChatCohort(summary.burst, plan.planned.burst);
  return { startAtUnixMs, summary: { steady, burst,
    unmatchedPublications: number(summary.unmatchedPublications, 0, steady.planned + burst.planned - steady.published - burst.published, true) } };
}

function parseStandMovement(result: Record<string, unknown>, plan: ChatV2WorkloadPlan | undefined, connected: number,
  packetsSent: number, inputRate: number, ackMs: StandQuantiles, intervals: StandQuantiles): StandMovementResult | undefined {
  if (!plan || plan.profile.movingClients === undefined) {
    if (result.movement !== undefined) throw new StandError('unexpected-stand-moving-result');
    return;
  }
  const movement = object(result.movement), plannedClients = plan.movingClients;
  if (!hasKeys(movement, ['plannedClients', 'sentClients', 'connectedClients']) || movement.plannedClients !== plannedClients) {
    throw new StandError('invalid-stand-moving-shard-count');
  }
  const sentClients = number(movement.sentClients, 0, Math.min(packetsSent, plannedClients), true);
  const connectedClients = number(movement.connectedClients, 0, Math.min(connected, plannedClients), true);
  if ((packetsSent > 0 && sentClients === 0) || inputRate > plannedClients * 60 || ackMs.count > packetsSent
    || (!ackMs.count && ackMs.max !== 0) || (plannedClients === 0 && (intervals.count !== 0 || intervals.max !== 0))
    || result.offeredInputPacketsPerSecond !== plannedClients * 30
    || result.offeredInputStepsPerSecond !== plannedClients * 60) throw new StandError('inconsistent-stand-moving-result');
  return { plannedClients, sentClients, connectedClients };
}

export function parseStandResult(value: unknown, gameProcesses = DEFAULT_GAME_PROCESSES, expectedChat?: StandChatV2Expectation): StandResult {
  const result = object(value); if (result.kind !== 'result') throw new StandError('invalid-stand-result');
  const count = number(result.count, 1, Math.min(MAX_STAND_CLIENTS, gameProcesses * STAND_MAX_ROOMS_PER_PROCESS * STAND_ROOM_CAPACITY), true), connectedClients = number(result.connectedClients, 0, count, true), rooms = occupancy(result.rooms, gameProcesses);
  if (rooms.reduce((sum, room) => sum + room.count, 0) !== connectedClients) throw new StandError('invalid-stand-result-occupancy');
  const durationSeconds = number(result.durationSeconds, .001, MAX_MEASUREMENT_SECONDS + 30), observationSeconds = number(result.observationSeconds, durationSeconds, MAX_MEASUREMENT_SECONDS + 45);
  const packetsSent = number(result.packetsSent, 0, MAX_RESULT_SAMPLES, true), inputPacketsPerSecond = number(result.inputPacketsPerSecond, 0, MAX_STAND_CLIENTS * 60);
  if (Math.abs(packetsSent / durationSeconds - inputPacketsPerSecond) > Math.max(.1, inputPacketsPerSecond * .001)) throw new StandError('inconsistent-stand-rate');
  const generator = object(result.generator), errors = counts(result.errors), errorCount = number(result.errorCount, 0, MAX_RESULT_SAMPLES, true);
  if (Object.values(errors).reduce((sum, n) => sum + n, 0) !== errorCount) throw new StandError('inconsistent-stand-errors');
  if (result.tracking !== undefined) number(object(result.tracking).latencyTimingSamplesDropped, 0, MAX_RESULT_SAMPLES, true);
  if (!expectedChat && result.chatV2 !== undefined) throw new StandError('unexpected-stand-chat-result');
  const plan = expectedChat && new ChatV2WorkloadPlan(expectedChat.profile, expectedChat.shard);
  const chat = expectedChat && plan ? { chatV2: parseStandChatResult(result.chatV2, plan, expectedChat.startAtUnixMs, count) } : {};
  const ackMs = quantiles(result.ackMs), stateIntervalMs = quantiles(result.stateIntervalMs);
  const movement = parseStandMovement(result, plan, connectedClients, packetsSent, inputPacketsPerSecond, ackMs, stateIntervalMs);
  // Preserve bounded diagnostics from our worker while validating fields used for the verdict.
  return { ...result, ...chat, ...(movement ? { movement } : {}), kind: 'result', count, connectedClients, rooms, durationSeconds, observationSeconds, packetsSent, inputPacketsPerSecond,
    receivedBytes: number(result.receivedBytes), maxClientBufferedBytes: number(result.maxClientBufferedBytes),
    ackMs, stateIntervalMs, unacknowledgedPackets: number(result.unacknowledgedPackets, 0, packetsSent, true),
    unacknowledgedAtEndOfSending: number(result.unacknowledgedAtEndOfSending, 0, packetsSent, true),
    oldestUnacknowledgedMs: number(result.oldestUnacknowledgedMs, 0, 3600000), drainSeconds: number(result.drainSeconds, 0, 15), errorCount, errors,
    generator: { cpuPercent: number(generator.cpuPercent, 0, 100000), rssMiB: number(generator.rssMiB),
      eventLoopP99Ms: number(generator.eventLoopP99Ms, 0, 3600000), eventLoopMaxMs: number(generator.eventLoopMaxMs, 0, 3600000) } };
}
export function parseStandFinished(value: unknown, runId: string, prepared: StandPrepared, seconds: number, startAtUnixMs?: number): StandFinished {
  const finished = object(value);
  if (finished.runId !== runId || !Array.isArray(finished.results) || finished.results.length !== prepared.ready.length) throw new StandError('invalid-stand-results');
  const { chatV2 } = prepared;
  if (chatV2 ? chatV2.seconds !== seconds || startAtUnixMs === undefined : startAtUnixMs !== undefined) throw new StandError('invalid-stand-chat-finish');
  const results = finished.results.map((item, index) => parseStandResult(item, prepared.gameProcesses ?? DEFAULT_GAME_PROCESSES,
    chatV2 && startAtUnixMs !== undefined ? { profile: chatV2, shard: { index, count: prepared.ready.length }, startAtUnixMs } : undefined));
  if (results.some((result, index) => result.count !== prepared.ready[index].count || result.durationSeconds < seconds * .9)) throw new StandError('incomplete-stand-measurement');
  if (!Object.hasOwn(finished, 'chatAudit')) return { runId, results };
  if (!chatV2) throw new StandError('unexpected-stand-chat-audit');
  const published = results.reduce((sum, result) => sum + result.chatV2!.summary.steady.published + result.chatV2!.summary.burst.published, 0);
  return { runId, results, chatAudit: parseStandChatAudit(finished.chatAudit, chatV2, published) };
}

function parseStandChatAudit(value: unknown, profile: ChatV2WorkloadProfile, published: number): ChatAuditSummary {
  const audit = object(value);
  const countKeys = ['receipts', 'uniquePublications', 'duplicatePublications', 'eligiblePublications', 'ineligiblePublications',
    'witnessedPublications', 'unmatchedWitnesses', 'mismatchedWitnesses', 'changedVisits'] as const;
  if (!hasKeys(audit, [...countKeys, 'peerDeliveryP95Ms'])) throw new StandError('invalid-stand-chat-audit');
  const maximum = profile.seconds * profile.steadyPerSecond + (profile.burst?.count ?? 0);
  const counts = Object.fromEntries(countKeys.map(key => [key, number(audit[key], 0, maximum, true)])) as Record<typeof countKeys[number], number>;
  if (counts.receipts !== published || counts.uniquePublications + counts.duplicatePublications !== counts.receipts
    || counts.eligiblePublications + counts.ineligiblePublications + counts.changedVisits !== counts.uniquePublications
    || counts.witnessedPublications > counts.eligiblePublications || counts.witnessedPublications + counts.unmatchedWitnesses + counts.mismatchedWitnesses > maximum
    || !counts.witnessedPublications && audit.peerDeliveryP95Ms !== null) throw new StandError('inconsistent-stand-chat-audit');
  return { ...counts, peerDeliveryP95Ms: counts.witnessedPublications
    ? number(audit.peerDeliveryP95Ms, 0, (profile.seconds + 45) * 1000) : null };
}

export function chatAuditChecks(audit: ChatAuditSummary) {
  return {
    chatV2PublicationIdsUnique: audit.duplicatePublications === 0,
    chatV2PeerDeliveryComplete: audit.changedVisits === 0 && audit.eligiblePublications > 0
      && audit.witnessedPublications === audit.eligiblePublications && audit.unmatchedWitnesses === 0 && audit.mismatchedWitnesses === 0,
  };
}
export function verifyStandStatus(value: unknown, manifest: StandManifest) {
  const status = object(value);
  if (status.protocol !== STAND_PROTOCOL || status.role !== STAND_ROLE || status.runId !== manifest.runId
    || status.bundleSha256 !== manifest.bundleSha256 || status.clients !== manifest.clients || status.seconds !== manifest.seconds
    || status.expiresAt !== manifest.expiresAt || status.apiEndpoint !== manifest.apiEndpoint
    || (status.gameProcesses ?? DEFAULT_GAME_PROCESSES) !== (manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES)) throw new StandError('stand-attestation-mismatch');
  if (parseStandHost(status.serverHost).hostFingerprint !== manifest.serverHost.hostFingerprint) throw new StandError('stand-host-mismatch');
  const expected = manifest.chatV2, chat = status.chatV2 === undefined ? undefined : parseStandChatV2(status.chatV2, manifest.clients, manifest.seconds);
  if (Boolean(chat) !== Boolean(expected) || chat?.steadyPerSecond !== expected?.steadyPerSecond || chat?.movingClients !== expected?.movingClients
    || chat?.burst?.count !== expected?.burst?.count
    || chat?.burst?.atSecond !== expected?.burst?.atSecond) throw new StandError('stand-chat-attestation-mismatch');
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
