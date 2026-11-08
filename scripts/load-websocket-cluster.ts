import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type Socket } from 'node:net';
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Redis } from 'ioredis';
import { installLoopbackNetworking, type ServerMetrics, type RoomTraffic } from './load-server-metrics';
import { assertOwnedLoadDatabase, LOAD_RUN_REDIS_KEY } from './load-stand-ownership';
import type { AccountStore } from '../server/accounts';
import { createStandControl, type StandControl } from './load-stand-control';
import { chatAuditChecks, encodeStandServerReport, loopbackEndpoint, parseStandChatV2, parseStandFinished, parseStandPrepared, standErrorDiagnostics, standHost, standReportForControl, STAND_ROLE,
  type StandManifest, type StandPrepared, type StandFinished, type StandErrorDiagnostics, type StandResult } from './load-stand-contract';
import { DEFAULT_GAME_PROCESSES, MAX_GAME_PROCESSES, MAX_MEASUREMENT_SECONDS, MAX_STAND_CLIENTS, MAX_STAND_METRIC_INTERVALS,
  STAND_MAX_CONNECTIONS_PER_PROCESS, STAND_MAX_ROOMS_PER_PROCESS, STAND_ROOM_CAPACITY,
  standAdmissionTimeoutMs, standLoadProfile, standPreparationTimeoutMs, standSessionDurationMs, standStartupTimeoutMs } from './load-stand-limits';

type Occupancy = { id: string; count: number; owner: string };
type Quantiles = { count: number; p50: number; p95: number; p99: number; max: number };
type Ready = { kind: 'ready'; count: number; connectedClients: number; rooms: Occupancy[]; errors: Record<string, number>;
  requestedBatch: number; joinedBatch: number; connectionAttempts: number; connectionRetries: number; retryCodes: Record<string, number> };
type Result = { kind: 'result'; count: number; connectedClients: number; rooms: Occupancy[]; durationSeconds: number; observationSeconds: number;
  packetsSent: number; inputPacketsPerSecond: number; receivedBytes: number; maxClientBufferedBytes: number; ackMs: Quantiles; stateIntervalMs: Quantiles;
  unacknowledgedPackets: number; unacknowledgedAtEndOfSending: number; oldestUnacknowledgedMs: number; drainSeconds: number;
  tracking?: { latencyTimingSamplesDropped: number }; chatV2?: StandResult['chatV2']; movement?: StandResult['movement'];
  errorCount: number; errors: Record<string, number>; generator: { cpuPercent: number; rssMiB: number; eventLoopP99Ms: number; eventLoopMaxMs: number } };
type Cli = { bundle: string; output: string; proxyBinary?: string; metricsScript?: string; standManifest?: string; clientOrigin?: string;
  inputMode: 'stress' | 'browser-window'; frameDiagnostics: boolean; resourceDiagnostics: boolean; sdkWebSocket: 'ws' | 'native'; clients: number; gameProcesses: number; seconds: number;
  minRatePercent: number; ackP95Ms: number; ackP99Ms: number; maxUnacknowledgedPercent: number; chatV2?: StandManifest['chatV2'] };
class HarnessError extends Error { constructor(readonly code: string, readonly diagnostics?: StandErrorDiagnostics) { super(code); } }
const chatV2StartLeadMs = 2_000;
const round = (value: number) => Number(value.toFixed(2));
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

function cli(): Cli | undefined {
  if (process.argv.includes('--help')) {
    console.log('Run with temporary PostgreSQL: node dist-load/database.mjs dist-load/cluster.mjs --metrics-script dist-load/metrics.mjs --proxy-binary /path/to/caddy --stand-manifest /private/path/stand.json --output artifacts/websocket-simulation/load.json --clients 1000 --seconds 70 --60hz');
    console.log('Optional local test budgets: --min-rate-percent 90 --ack-p95-ms 250 --ack-p99-ms 500 --max-unacknowledged-percent 1');
    console.log('Use a native loopback Caddy proxy with --proxy-binary /path/to/caddy or ROYAL_CADDY_BINARY. The Node proxy fallback is restricted to smoke tests of at most 100 clients.');
    console.log('The SDK generator uses ws by default. Optional diagnostics: --frame-diagnostics and --sdk-websocket native; diagnostics are off for performance comparisons.');
    console.log('Optional --resource-diagnostics samples native proxy CPU/RSS and macOS host compression/swap counters.');
    console.log('Optional --metrics-script /path/to/metrics.mjs uses prebuilt metrics without tsx.');
    console.log(`Game processes: --game-processes 4 (default), 1 to ${MAX_GAME_PROCESSES}; each admits ten rooms of thirty players. ${MAX_STAND_CLIENTS} clients require at least ${Math.ceil(MAX_STAND_CLIENTS / (STAND_MAX_ROOMS_PER_PROCESS * STAND_ROOM_CAPACITY))} game processes.`);
    console.log('Server-only stand: --stand-manifest /private/path/stand.json --client-origin http://127.0.0.1:17100. Run load-websocket-generators.ts separately through SSH loopback port forwards.');
    console.log('For an isolated Chat V2 pilot, use --chat-v2-rate 333, --chat-v2-burst 100 --chat-v2-burst-at-second 2, or both. Requires --stand-manifest and a compatible server bundle.');
    console.log('For a mixed Chat V2 pilot, --chat-v2-moving-clients sets how many connected clients also send movement input. By default all move.');
    console.log('Input mode: --input-mode stress (default) or browser-window. A throttled input rate never passes the same load budget.');
    return;
  }
  const values: Record<string, string> = {};
  const known = new Set(['--server-bundle', '--output', '--proxy-binary', '--metrics-script', '--sdk-websocket', '--stand-manifest', '--client-origin', '--input-mode', '--clients', '--game-processes', '--seconds', '--min-rate-percent', '--ack-p95-ms', '--ack-p99-ms', '--max-unacknowledged-percent',
    '--chat-v2-rate', '--chat-v2-burst', '--chat-v2-burst-at-second', '--chat-v2-moving-clients']);
  let frameDiagnostics = false, resourceDiagnostics = false;
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === '--60hz') continue;
    if (key === '--frame-diagnostics') { if (frameDiagnostics) throw new HarnessError('duplicate-diagnostics-flag'); frameDiagnostics = true; continue; }
    if (key === '--resource-diagnostics') { if (resourceDiagnostics) throw new HarnessError('duplicate-resource-flag'); resourceDiagnostics = true; continue; }
    const value = process.argv[++index];
    if (!known.has(key) || !value || value.startsWith('--') || values[key] !== undefined) throw new HarnessError('invalid-cli');
    values[key] = value;
  }
  const number = (key: string, fallback: number, min: number, max: number, integer = true) => {
    const value = Number(values[key] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new HarnessError('invalid-cli-number');
    return value;
  };
  const sdkWebSocket = values['--sdk-websocket'] ?? 'ws';
  if (sdkWebSocket !== 'ws' && sdkWebSocket !== 'native') throw new HarnessError('invalid-sdk-websocket');
  const inputMode = values['--input-mode'] ?? 'stress';
  if (inputMode !== 'stress' && inputMode !== 'browser-window') throw new HarnessError('invalid-input-mode');
  if (values['--client-origin'] && !values['--stand-manifest']) throw new HarnessError('client-origin-needs-stand');
  const clients = number('--clients', 1000, 4, MAX_STAND_CLIENTS), gameProcesses = number('--game-processes', DEFAULT_GAME_PROCESSES, 1, MAX_GAME_PROCESSES);
  try { standLoadProfile(clients, gameProcesses); } catch { throw new HarnessError('stand-profile-capacity-exceeded'); }
  const seconds = number('--seconds', 70, 1, MAX_MEASUREMENT_SECONDS);
  const hasBurst = values['--chat-v2-burst'] !== undefined, hasBurstAt = values['--chat-v2-burst-at-second'] !== undefined;
  let chatV2: StandManifest['chatV2'];
  const hasMoving = values['--chat-v2-moving-clients'] !== undefined;
  if (values['--chat-v2-rate'] !== undefined || hasBurst || hasBurstAt || hasMoving) {
    if (!values['--stand-manifest']) throw new HarnessError('chat-v2-needs-stand');
    if (hasBurst !== hasBurstAt) throw new HarnessError('chat-v2-burst-needs-count-and-time');
    const steadyPerSecond = number('--chat-v2-rate', 0, 0, 333);
    const burst = hasBurst ? { count: number('--chat-v2-burst', 0, 1, clients),
      atSecond: number('--chat-v2-burst-at-second', 0, 0, seconds - 1) } : undefined;
    const movement = hasMoving ? { movingClients: number('--chat-v2-moving-clients', clients, 0, clients) } : {};
    try { chatV2 = parseStandChatV2({ clients, seconds, steadyPerSecond, ...(burst ? { burst } : {}), ...movement }, clients, seconds); }
    catch { throw new HarnessError('invalid-stand-chat-profile'); }
  }
  return { bundle: resolve(values['--server-bundle'] ?? 'dist-load/lobby-server.mjs'),
    metricsScript: values['--metrics-script'] ? resolve(values['--metrics-script']) : undefined,
    standManifest: values['--stand-manifest'] ? resolve(values['--stand-manifest']) : undefined,
    clientOrigin: values['--client-origin'] ? loopbackEndpoint(values['--client-origin']) : undefined, inputMode,
    proxyBinary: values['--proxy-binary'] || process.env.ROYAL_CADDY_BINARY, frameDiagnostics, resourceDiagnostics, sdkWebSocket,
    output: resolve(values['--output'] ?? `artifacts/websocket-simulation/load-cluster-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    clients, gameProcesses, seconds, chatV2,
    minRatePercent: number('--min-rate-percent', 90, 1, 100, false), ackP95Ms: number('--ack-p95-ms', 250, 1, 30000, false),
    ackP99Ms: number('--ack-p99-ms', 500, 1, 30000, false), maxUnacknowledgedPercent: number('--max-unacknowledged-percent', 1, 0, 100, false) };
}
async function bounded<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HarnessError(code)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function reserveStandPorts(count: number) {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GAME_PROCESSES + 1) throw new RangeError('invalid-stand-port-count');
  const listeners = new Map<number, ReturnType<typeof createTcpServer>>();
  const release = async (port: number) => {
    const listener = listeners.get(port);
    if (!listener) return;
    listeners.delete(port);
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  };
  const close = async () => { await Promise.all([...listeners.keys()].map(release)); };
  try {
    for (let index = 0; index < count; index++) {
      const listener = createTcpServer(socket => socket.destroy());
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
      });
      listeners.set((listener.address() as { port: number }).port, listener);
    }
    return { ports: [...listeners.keys()], release, close };
  } catch (error) {
    await close();
    throw error;
  }
}
function requestWorker<T>(child: ChildProcess, command: object, response: string, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); signal.removeEventListener('abort', onAbort); };
    const fail = (code: string) => { cleanup(); reject(new HarnessError(code)); };
    const onMessage = (raw: unknown) => {
      const message = raw as { kind?: string };
      if (message?.kind === response) { cleanup(); resolve(raw as T); }
      else if (message?.kind === 'error') fail('generator-command');
    };
    const onExit = () => fail('generator-exited');
    const onAbort = () => fail('interrupted');
    const timer = setTimeout(() => fail('generator-timeout'), timeoutMs);
    if (signal.aborted || exited(child) || !child.connected) { fail('generator-unavailable'); return; }
    child.on('message', onMessage); child.once('exit', onExit); signal.addEventListener('abort', onAbort, { once: true });
    child.send(command, error => { if (error) fail('generator-ipc'); });
  });
}
async function stopChild(child: ChildProcess, command: boolean) {
  if (exited(child)) return;
  const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
  if (command && child.connected) child.send({ kind: 'shutdown' }, () => {}); else child.kill('SIGTERM');
  try { await bounded(done, command ? 3500 : 10000, 'child-grace-timeout'); return; } catch {}
  child.kill('SIGTERM');
  try { await bounded(done, 2000, 'child-term-timeout'); return; } catch {}
  child.kill('SIGKILL');
  await bounded(done, 2000, 'child-kill-timeout');
}
function summarizeMetrics(samples: ServerMetrics[]) {
  const time = samples.reduce((sum, sample) => sum + sample.intervalMs, 0);
  const max = (key: keyof ServerMetrics) => Math.max(0, ...samples.map(sample => Number(sample[key])));
  return { samples: samples.length, observedSeconds: round(time / 1000),
    cpuMeanPercent: round(samples.reduce((sum, sample) => sum + sample.cpuPercent * sample.intervalMs, 0) / Math.max(1, time)),
    cpuMaxPercent: round(max('cpuPercent')), maxRssMiB: round(max('rssMiB')), maxHeapMiB: round(max('heapMiB')),
    maxWindowEventLoopP99Ms: round(max('eventLoopP99Ms')), eventLoopMaxMs: round(max('eventLoopMaxMs')) };
}
function reportMetricIntervals<T>(samples: T[]) {
  const intervals = samples.slice(-MAX_STAND_METRIC_INTERVALS);
  return { intervals, intervalHistory: 'bounded-tail', retainedIntervalCount: intervals.length, droppedIntervalCount: samples.length - intervals.length };
}
async function readResourceCommand(file: string, args: string[]) {
  const child = spawn(file, args, { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  const completed = new Promise<string>((resolve, reject) => {
    child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.length > 16384) { child.kill('SIGKILL'); reject(new HarnessError('resource-output-limit')); } });
    child.once('error', () => reject(new HarnessError('resource-command-unavailable')));
    child.once('exit', code => code === 0 ? resolve(output) : reject(new HarnessError('resource-command-failed')));
  });
  try { return await bounded(completed, 2000, 'resource-command-timeout'); }
  finally { if (!exited(child)) child.kill('SIGKILL'); }
}
async function proxyResources(pid: number) {
  const fields = (await readResourceCommand('/bin/ps', ['-p', String(pid), '-o', 'pid=', '-o', 'time=', '-o', 'rss='])).trim().split(/\s+/);
  if (fields.length !== 3 || Number(fields[0]) !== pid || !/^\d+(?:-\d+)?(?::\d+){1,2}(?:\.\d+)?$/.test(fields[1]) || !/^\d+$/.test(fields[2])) throw new HarnessError('invalid-proxy-resource-fields');
  const parts = fields[1].split('-'), days = parts.length === 2 ? Number(parts[0]) : 0;
  const time = parts.at(-1)!.split(':').map(Number);
  const cpuSeconds = days * 86400 + time.reduce((seconds, component) => seconds * 60 + component, 0);
  return { sampledAt: Date.now(), cpuSeconds, rssMiB: Number(fields[2]) / 1024 };
}
async function hostVirtualMemory() {
  if (process.platform !== 'darwin') return;
  const output = await readResourceCommand('/usr/bin/vm_stat', []);
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1]);
  if (!pageSize) throw new HarnessError('invalid-host-resource-fields');
  const values: Record<string, number> = {};
  for (const key of ['Pages free', 'Pages active', 'Pages inactive', 'Pages speculative', 'Pages wired down', 'Pages stored in compressor', 'Pages occupied by compressor', 'Decompressions', 'Compressions', 'Pageins', 'Pageouts', 'Swapins', 'Swapouts']) {
    const match = output.match(new RegExp('"?' + key + '"?:\\s*(\\d+)')); if (match) values[key] = Number(match[1]);
  }
  if (Object.keys(values).length !== 13) throw new HarnessError('invalid-host-resource-fields');
  return { sampledAt: Date.now(), pageSize, values };
}
function observedClients(reports: { connectedClients: number; rooms: Occupancy[] }[], expectedOwners: Map<string, string>, ids: string[]) {
  const counts = new Map(ids.map(id => [id, 0]));
  let total = 0, valid = true;
  for (const report of reports) {
    const connected = report.rooms.reduce((sum, room) => sum + room.count, 0);
    valid &&= connected === report.connectedClients;
    total += connected;
    for (const room of report.rooms) {
      if (!counts.has(room.owner) || expectedOwners.get(room.id) !== room.owner || !Number.isSafeInteger(room.count) || room.count < 0) valid = false;
      else counts.set(room.owner, counts.get(room.owner)! + room.count);
    }
  }
  return { total, countsByOwner: Object.fromEntries(counts), valid: valid && [...counts.values()].every(count => count <= STAND_MAX_CONNECTIONS_PER_PROCESS) };
}
export function chatV2Pilot(results: readonly Pick<Result, 'chatV2'>[], profile: NonNullable<StandManifest['chatV2']>,
  startAtUnixMs: number, audit?: StandFinished['chatAudit']) {
  const summaries = results.map(result => {
    if (result.chatV2?.startAtUnixMs !== startAtUnixMs) throw new HarnessError('stand-chat-result-epoch-mismatch');
    return result.chatV2.summary;
  });
  const totals = (cohort: 'steady' | 'burst') => summaries.reduce((total, summary) => {
    const row = summary[cohort];
    return { planned: total.planned + row.planned, offered: total.offered + row.offered,
      acceptanceConfirmed: total.acceptanceConfirmed + row.acceptanceConfirmed, published: total.published + row.published,
      terminalByDeadline: total.terminalByDeadline + row.terminalByDeadline, witnessed: total.witnessed + row.witnessed,
      unresolved: total.unresolved + row.unresolved };
  }, { planned: 0, offered: 0, acceptanceConfirmed: 0, published: 0, terminalByDeadline: 0, witnessed: 0, unresolved: 0 });
  const steady = totals('steady'), burst = totals('burst');
  const unmatchedPublications = summaries.reduce((sum, summary) => sum + summary.unmatchedPublications, 0);
  const complete = (row: typeof steady) => row.unresolved === 0 && row.offered === row.acceptanceConfirmed
    && row.offered === row.published && row.offered === row.terminalByDeadline && row.offered === row.witnessed;
  return { profile, startAtUnixMs, qualification: 'isolated-websocket-pilot', targetAccepted: false, steady, burst, unmatchedPublications,
    ...(audit ? { audit } : {}),
    checks: {
      chatV2OfferedAtTarget: steady.planned === profile.steadyPerSecond * profile.seconds
        && summaries.every(({ steady }) => steady.offered * 100 >= steady.planned * 99)
        && burst.planned === (profile.burst?.count ?? 0) && burst.offered === burst.planned,
      chatV2DeliveryComplete: complete(steady) && complete(burst) && unmatchedPublications === 0,
      ...(audit ? chatAuditChecks(audit) : {}),
    } };
}
const diagnosticKinds = ['too many messages per second', 'not registered.', 'Room account lease renewal failed', 'Room account lease release failed', "couldn't decode message", 'Redis cluster runtime failed', 'Lobby cluster connection lost. Restarting this process.'] as const;
function collectDiagnostics(child: ChildProcess, counts: Record<string, number>) {
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream?.on('data', (chunk: Buffer) => {
      // Classify known local messages only. Account identifiers and payloads are never stored or printed.
      pending = (pending + chunk.toString()).slice(-8192);
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) for (const kind of diagnosticKinds) if (line.includes(kind)) counts[kind] = (counts[kind] ?? 0) + 1;
    });
  }
}

async function run() {
  const config = cli(); if (!config) return;
  const profile = standLoadProfile(config.clients, config.gameProcesses), ids = profile.owners;
  if (config.clients > 100 && !config.proxyBinary) throw new HarnessError('native-proxy-required-above-100-clients');
  installLoopbackNetworking();
  const loadRunId = await assertOwnedLoadDatabase().catch(error => {
    throw new HarnessError(error instanceof Error && error.message === 'use-temporary-postgresql-wrapper'
      ? 'use-temporary-postgresql-wrapper' : 'load-database-not-owned');
  });
  await mkdir(dirname(config.output), { recursive: true });
  try { await stat(config.output); throw new HarnessError('output-already-exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bundle = await realpath(config.bundle);
  if (!(await stat(bundle)).isFile() || !/\.(?:m?js)$/.test(bundle)) throw new HarnessError('invalid-server-bundle');
  const bundleSha256 = createHash('sha256').update(await readFile(bundle)).digest('hex');
  const metricsScript = config.metricsScript ? await realpath(config.metricsScript) : undefined;
  if (metricsScript && (!(await stat(metricsScript)).isFile() || !metricsScript.endsWith('.mjs'))) throw new HarnessError('invalid-metrics-script');
  const proxyBinary = config.proxyBinary ? await realpath(config.proxyBinary) : undefined;
  if (proxyBinary && !(await stat(proxyBinary)).isFile()) throw new HarnessError('invalid-proxy-binary');
  if (config.standManifest) {
    if (config.standManifest === config.output) throw new HarnessError('stand-manifest-is-report');
    await mkdir(dirname(config.standManifest), { recursive: true });
    try { await stat(config.standManifest); throw new HarnessError('stand-manifest-already-exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  // Account preparation and all child processes must ignore inherited provider credentials.
  for (const key of Object.keys(process.env)) if (/^(?:NOWPAYMENTS_|CASINOAPIPRO_|NILE_|CODEX_SALE_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { AUTH_DB_PATH: 'royal_websocket_load', DATABASE_URL: '', DATABASE_URL_FILE: '', PGPASSWORD_FILE: '',
    NODE_ENV: 'test', PGSSLMODE: 'disable', PGPOOL_MAX: '10', CODEX_SALE_API_KEY: '', NOWPAYMENTS_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false' });
  const baseEnv: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'NODE_ENV', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE']) {
    if (process.env[key] !== undefined) baseEnv[key] = process.env[key];
  }
  Object.assign(baseEnv, { LOAD_LOBBY_RUN_ID: loadRunId, AUTH_DB_PATH: 'royal_websocket_load', DATABASE_URL: '', DATABASE_URL_FILE: '', PGPASSWORD_FILE: '',
    CODEX_SALE_API_KEY: '', NOWPAYMENTS_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false',
    LOBBY_MAX_ROOMS: String(STAND_MAX_ROOMS_PER_PROCESS), WS_MAX_CONNECTIONS: String(STAND_MAX_CONNECTIONS_PER_PROCESS), WS_MAX_BUFFERED_BYTES: '262144', LOBBY_MATCHMAKING_RATE: '30', LOBBY_MATCHMAKING_BURST: '60',
    LOAD_FRAME_DIAGNOSTICS: config.frameDiagnostics ? '1' : '0', LOAD_SDK_WEBSOCKET: config.sdkWebSocket });

  const movingClients = config.chatV2?.movingClients ?? config.clients;
  const report: Record<string, any> = { productionTraffic: false, setup: 'Temporary local PostgreSQL and Valkey, configured game processes and independent SDK generators; loopback TCP only, no .env files',
    bundle: { path: bundle, sha256: bundleSha256 }, host: standHost(),
    generatorLocation: config.standManifest ? 'separate-runner' : 'same-host',
    ...(config.chatV2 ? { chatV2: { profile: config.chatV2, qualification: 'isolated-websocket-pilot', targetAccepted: false } } : {}),
    targetClients: config.clients, gameProcesses: config.gameProcesses, capacity: { maxSeats: profile.maxSeats, maxRooms: profile.maxRooms }, measurementSeconds: config.seconds, proxy: { kind: proxyBinary ? 'native-caddy' : 'node-tcp', tcpNoDelay: true },
    frameDiagnostics: config.frameDiagnostics, resourceDiagnostics: config.resourceDiagnostics, sdkWebSocket: config.sdkWebSocket,
    workload: { packetsPerClientPerSecond: 30, stepsPerPacket: 2, targetInputStepsPerClientPerSecond: 60, browserPredictionSendWindow: config.inputMode === 'browser-window', inputMode: config.inputMode,
      ...(config.chatV2?.movingClients !== undefined ? { movingClients, targetInputPacketsPerSecond: movingClients * 30 } : {}),
      movement: 'Horizontal input direction alternates every two seconds; collisions can prevent actual displacement', admissionBatchSize: 4, maximumNewJoinsPerSecond: 20, maxJoinRetries: 3, ackDrainLimitMs: config.chatV2 ? 5000 : 2000 },
    localTestBudgets: { minInputRatePercent: config.minRatePercent, maxWorkerAckP95Ms: config.ackP95Ms, maxWorkerAckP99Ms: config.ackP99Ms, maxUnacknowledgedPercent: config.maxUnacknowledgedPercent },
    metricDefinitions: { ackMs: 'Send to SDK state callback observing inputSeq advancement; cumulative sequence observation, not network RTT or proof every input was applied',
      stateIntervalMs: 'Intervals between SDK state callbacks in a generator process', receivedBytes: 'WebSocket application message payload only, excluding framing, TCP and TLS',
      maxClientBufferedBytes: 'Generator outgoing WebSocket buffer, not server outgoing buffers', cpuPercent: 'Process CPU over each reported interval; 100 percent is one fully used logical core',
      ownerConnectedClients: 'Aggregated SDK connections, excluding unreserved, closing and probing sockets; these are not runtime WebSocket server socket counts',
      nativeProxyCpu: 'Deltas of cumulative ps CPU time for the test proxy PID only; 100 percent is one logical core, sampled every two seconds through result collection',
      hostVirtualMemory: 'Whole-host macOS page counters at measurement boundaries, including other applications; deltas are not attributed to the game processes',
      serverEventLoopP99: 'Maximum p99 among one-second windows, not a percentile of the complete run', ackResidual: 'Recorded before stop, both at the end of sending and after a bounded drain',
      generatorQuantiles: 'Bounded reservoir percentiles are estimates after 8192 samples; count, maximum and mean remain totals. Lost per-client packet timestamps are reported separately and invalidate ACK completeness.',
      metricIntervals: 'Aggregate counts, means and maxima cover the full measurement; interval arrays retain only the last 300 samples with explicit retained and dropped counts.',
      budgets: 'Local comparison criteria, not a hardware or production capacity guarantee' }, processLimits: ids.map(id => ({ id, maxRooms: STAND_MAX_ROOMS_PER_PROCESS, roomCapacity: STAND_ROOM_CAPACITY, maxConnections: STAND_MAX_CONNECTIONS_PER_PROCESS,
        authConcurrency: id === 'main' ? 8 : 4, pgPoolMax: id === 'main' ? 10 : 6 })), childExits: [] };
  const games = new Map<string, ChildProcess>(), generators: ChildProcess[] = [], sockets = new Set<Socket>();
  const metrics = new Map(ids.map(id => [id, [] as ServerMetrics[]]));
  const parentMetrics: ServerMetrics[] = [];
  const proxyMetrics: { sampledAt: number; intervalMs: number; cpuPercent: number; rssMiB: number }[] = [];
  const resourceErrors: string[] = [];
  let hostBefore: Awaited<ReturnType<typeof hostVirtualMemory>>, hostAfter: Awaited<ReturnType<typeof hostVirtualMemory>>;
  let proxyBefore: Awaited<ReturnType<typeof proxyResources>>;
  let proxySample: Promise<void> | undefined, proxyTimer: ReturnType<typeof setInterval> | undefined;
  const diagnostics = Object.fromEntries(ids.map(id => [id, {} as Record<string, number>]));
  const trafficDiagnostics: Record<string, RoomTraffic> = {};
  const fatalDiagnostics: Record<string, unknown[]> = {};
  let ready: (Ready | undefined)[] = new Array(4);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const sessionMs = standSessionDurationMs(config.seconds, config.clients);
  const overallTimer = setTimeout(interrupt, sessionMs + standPreparationTimeoutMs(config.clients));
  let front: Server | undefined, redis: Awaited<ReturnType<typeof import('./temporary-redis')['temporaryRedis']>> | undefined;
  let portReservations: Awaited<ReturnType<typeof reserveStandPorts>> | undefined;
  let observer: Redis | undefined, accounts: AccountStore | undefined;
  let proxy: ChildProcess | undefined, proxyDirectory: string | undefined, parentTimer: ReturnType<typeof setInterval> | undefined;
  let standControl: StandControl<StandPrepared, StandFinished> | undefined, standPrepared: StandPrepared | undefined;
  let standChatStartAtUnixMs: number | undefined;
  let standManifestCreated = false;
  const parentLoop = monitorEventLoopDelay({ resolution: 10 });
  let phase = 'prepare', cleaning = false, measuring = false, measureStartedAt = 0, measureEndedAt = 0;
  const check = () => { if (controller.signal.aborted) throw new HarnessError('interrupted'); };
  const sampleProxy = () => {
    if (!proxy?.pid || proxySample) return proxySample;
    proxySample = (async () => {
      try {
        const current = await proxyResources(proxy!.pid!);
        if (proxyBefore) { const intervalMs = current.sampledAt - proxyBefore.sampledAt;
          proxyMetrics.push({ sampledAt: current.sampledAt, intervalMs, cpuPercent: (current.cpuSeconds - proxyBefore.cpuSeconds) * 100000 / Math.max(1, intervalMs), rssMiB: current.rssMiB }); }
        proxyBefore = current;
      } catch (error) { resourceErrors.push(error instanceof HarnessError ? error.code : 'proxy-resource-unavailable'); }
      finally { proxySample = undefined; }
    })();
    return proxySample;
  };
  const watch = (child: ChildProcess, role: string) => {
    child.on('error', () => { if (!cleaning) controller.abort(); });
    child.on('exit', (code, signal) => { report.childExits.push({ role, code, signal, duringCleanup: cleaning }); if (!cleaning) controller.abort(); });
  };
  try {
    // Guard argument-only invocations before loading the dedicated cluster runtime.
    const [{ Redis }, { RedisDriver }, { temporaryRedis }, { READY_PROCESSES_KEY, parseReadyProcess }] = await Promise.all([
      import('ioredis'), import('@colyseus/redis-driver'), import('./temporary-redis'), import('./load-lobby-owners'),
    ]).catch(error => { throw new HarnessError('cluster-runtime-unavailable', standErrorDiagnostics(error)); });
    redis = await temporaryRedis(loadRunId); check();
    observer = new Redis(redis.url, { lazyConnect: true, enableOfflineQueue: false, retryStrategy: null,
      maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000 });
    const redisUnavailable = () => { if (!cleaning) controller.abort(); };
    observer.on('error', redisUnavailable);
    observer.on('close', redisUnavailable);
    await observer.connect();
    if (await observer.get(LOAD_RUN_REDIS_KEY) !== loadRunId) throw new HarnessError('load-redis-not-owned');
    const accountModule = await import('../server/accounts'); accounts = accountModule.accounts;
    const accountFailure = (code: string, error: unknown) => new HarnessError(code,
      standErrorDiagnostics(error, error instanceof accountModule.AuthError ? error.status : undefined));
    await accounts.ready.catch(error => { throw accountFailure('account-store-ready-failed', error); }); check();
    const tokens: string[] = []; let next = 0;
    console.error(`Preparing ${config.clients} accounts in temporary PostgreSQL.`);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < config.clients) {
        check(); const index = next++;
        const login = await accounts!.login(`cluster-load-${randomUUID()}@example.test`, 'Local-load-test-123!')
          .catch(error => { throw accountFailure('account-login-failed', error); });
        await accounts!.select(login.account.id, index % 6).catch(error => { throw accountFailure('account-select-failed', error); });
        tokens[index] = login.token;
      }
    }));
    phase = 'accounts-prepared';
    const reserved = portReservations = await reserveStandPorts(ids.length + 1);
    const ports = new Map(ids.map((id, index) => [id, reserved.ports[index]]));
    const frontPort = reserved.ports[ids.length];
    const endpoint = 'http://127.0.0.1:' + frontPort;
    const clientEndpoint = config.clientOrigin ?? endpoint;
    let standIdentity: { runId: string; secret: string; createdAt: number; expiresAt: number } | undefined;
    if (config.standManifest) {
      phase = 'control';
      const runId = randomUUID(), secret = randomBytes(32).toString('hex');
      const createdAt = Date.now(), expiresAt = createdAt + sessionMs;
      standIdentity = { runId, secret, createdAt, expiresAt };
      standControl = await createStandControl<StandPrepared, StandFinished>({ runId, secret, expiresAt, signal: controller.signal,
        status: { bundleSha256, clients: config.clients, gameProcesses: config.gameProcesses, seconds: config.seconds, apiEndpoint: clientEndpoint, serverHost: report.host,
          ...(config.chatV2 ? { chatV2: config.chatV2 } : {}) },
        onAbort: () => { if (!cleaning) controller.abort(); },
        validatePrepared: body => {
          const parsed = parseStandPrepared(body, runId, config.clients, config.gameProcesses, config.chatV2);
          if (parsed.inputMode !== config.inputMode) throw new HarnessError('stand-input-mode-mismatch');
          standPrepared = parsed; return parsed;
        },
        validateResults: body => {
          if (!standPrepared) throw new HarnessError('stand-not-prepared');
          const parsed = parseStandFinished(body, runId, standPrepared, config.seconds, standChatStartAtUnixMs);
          if (config.chatV2 && !parsed.chatAudit) throw new HarnessError('stand-chat-audit-required');
          return parsed;
        },
      });
    }
    phase = 'proxy';
    const routed = (url: string) => {
      if (standControl && url === '/__load-stand/status') return { port: standControl.port, path: '/status' };
      const owner = url.match(/^\/workers\/([a-z0-9-]+)(\/.*)$/);
      if (url.startsWith('/workers/') && !owner) return;
      const port = ports.get(owner?.[1] ?? 'main'); if (!port || !url.startsWith('/')) return;
      return { port, path: owner?.[2] ?? url };
    };
    front = createServer((req, res) => {
      const route = routed(req.url || '/'); if (!route) { res.writeHead(404); res.end(); return; }
      const upstream = request({ hostname: '127.0.0.1', port: route.port, path: route.path, method: req.method,
        headers: { ...req.headers, 'x-forwarded-proto': 'http' } }, reply => { res.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(res); });
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
    });
    front.on('connection', socket => { socket.setNoDelay(true); sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    front.on('upgrade', (req, socket, head) => {
      const route = routed(req.url || '/'); if (!route) { socket.destroy(); return; }
      (socket as Socket).setNoDelay(true);
      const upstream = connect(route.port, '127.0.0.1'); upstream.setNoDelay(true); sockets.add(upstream);
      const timer = setTimeout(() => { socket.destroy(); upstream.destroy(); }, 5000);
      upstream.once('connect', () => {
        clearTimeout(timer); const headers: string[] = [];
        for (let index = 0; index < req.rawHeaders.length; index += 2) headers.push(req.rawHeaders[index] + ': ' + req.rawHeaders[index + 1]);
        upstream.write(`${req.method} ${route.path} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length) upstream.write(head); socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      upstream.once('close', () => { clearTimeout(timer); sockets.delete(upstream); socket.destroy(); });
      socket.once('close', () => { clearTimeout(timer); upstream.destroy(); });
    });
    if (proxyBinary) {
      proxyDirectory = await mkdtemp(resolve(tmpdir(), 'royal-load-caddy-'));
      const caddyfile = resolve(proxyDirectory, 'Caddyfile');
      const routes = ids.map(id => `  handle_path /workers/${id}/* {\n    reverse_proxy 127.0.0.1:${ports.get(id)}\n  }`).join('\n');
      const attestationRoute = standControl ? `  handle /__load-stand/status {\n    rewrite * /status\n    reverse_proxy 127.0.0.1:${standControl.port}\n  }\n` : '';
      await writeFile(caddyfile, `{\n  admin off\n  auto_https off\n}\nhttp://127.0.0.1:${frontPort} {\n  bind 127.0.0.1\n${attestationRoute}${routes}\n  handle {\n    reverse_proxy 127.0.0.1:${ports.get('main')}\n  }\n}\n`, { mode: 0o600 });
      await reserved.release(frontPort); check();
      proxy = spawn(proxyBinary, ['run', '--config', caddyfile, '--adapter', 'caddyfile'],
        { env: { PATH: baseEnv.PATH, HOME: proxyDirectory, TMPDIR: baseEnv.TMPDIR }, stdio: 'ignore' });
      watch(proxy, 'proxy/caddy');
      await new Promise<void>((resolve, reject) => { proxy!.once('spawn', resolve); proxy!.once('error', reject); })
        .catch(error => { throw new HarnessError('proxy-spawn-failed', standErrorDiagnostics(error)); });
      front = undefined;
    } else {
      await reserved.release(frontPort); check();
      await new Promise<void>((resolve, reject) => { front!.once('error', reject); front!.listen(frontPort, '127.0.0.1', resolve); });
    }
    phase = 'startup';
    for (const id of ids) {
      await reserved.release(ports.get(id)!); check();
      const game = spawn(process.execPath, [...(metricsScript ? [metricsScript] : ['--import', 'tsx', 'scripts/load-server-metrics.ts']), '--server-bundle', bundle], {
        env: { ...baseEnv, PORT: String(ports.get(id)), REDIS_URL: redis.url, PUBLIC_ORIGIN: clientEndpoint, LOBBY_WORKER_ID: id,
          LOBBY_WORKER_ONLY: String(id !== 'main'), LOBBY_AUTH_CONCURRENCY: id === 'main' ? '8' : '4', PGPOOL_MAX: id === 'main' ? '10' : '6', DEBUG: 'colyseus:matchmaking' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      games.set(id, game); watch(game, 'game/' + id);
      collectDiagnostics(game, diagnostics[id]);
      game.on('message', raw => {
        const message = raw as ServerMetrics;
        const diagnostic = raw as { kind?: string; traffic?: RoomTraffic };
        if (diagnostic.kind === 'room-traffic' && diagnostic.traffic) trafficDiagnostics[id] = diagnostic.traffic;
        if (diagnostic.kind === 'fatal-diagnostic') (fatalDiagnostics[id] ??= []).push(raw);
        if (measuring && message?.kind === 'metrics' && message.intervalStartedAt >= measureStartedAt
          && [message.intervalMs, message.cpuPercent, message.rssMiB, message.eventLoopP99Ms, message.eventLoopMaxMs].every(Number.isFinite)) metrics.get(id)!.push(message);
      });
    }
    const startupUntil = performance.now() + standStartupTimeoutMs(config.gameProcesses);
    for (;;) {
      check();
      const health = await Promise.all(ids.map(async id => {
        try { return (await fetch('http://127.0.0.1:' + ports.get(id) + '/healthz', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]) })).ok; } catch { return false; }
      }));
      const registry = await observer.hgetall(READY_PROCESSES_KEY);
      if (health.every(Boolean) && Object.values(registry).map(value => parseReadyProcess(value)?.workerId).sort().join(',') === [...ids].sort().join(',')) break;
      if (performance.now() >= startupUntil) throw new HarnessError('cluster-startup-timeout'); await delay(100);
    }
    if (config.standManifest) {
      phase = 'stand-ready';
      const { runId, secret, createdAt, expiresAt } = standIdentity!;
      const manifest: StandManifest = { protocol: 1, role: STAND_ROLE, runId, secret, createdAt, expiresAt,
        apiEndpoint: clientEndpoint, controlEndpoint: 'http://127.0.0.1:' + standControl!.port,
        serverApiPort: frontPort, serverControlPort: standControl!.port, bundleSha256,
        clients: config.clients, gameProcesses: config.gameProcesses, seconds: config.seconds, serverHost: report.host, tokens,
        ...(config.chatV2 ? { chatV2: config.chatV2 } : {}) };
      await writeFile(config.standManifest, JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 }); standManifestCreated = true;
      report.stand = { runId, expiresAt, serverApiPort: frontPort, serverControlPort: standControl!.port, clientEndpoint };
      console.error(JSON.stringify({ phase: 'stand-ready', ...report.stand, manifestPath: config.standManifest }));
      const prepared = await bounded(standControl!.prepared, standAdmissionTimeoutMs(config.clients), 'stand-generator-connect-timeout'); check();
      ready = prepared.ready; report.generatorHost = prepared.clientHost;
      report.differentReportedHosts = prepared.clientHost.hostFingerprint !== report.host.hostFingerprint;
      report.hostSeparationDefinition = 'Hashed hostname comparison, not proof of separate physical hardware; SSH and proxy costs remain part of the transport';
      report.connectionPhase = { ...prepared.connectionPhase, connectedClients: ready.reduce((sum, item) => sum + (item?.connectedClients ?? 0), 0), generators: ready };
    } else {
    for (let index = 0; index < 4; index++) {
      const generator = spawn(process.execPath, ['--import', 'tsx', 'scripts/load-websocket-worker.ts'], { env: baseEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      generators.push(generator); watch(generator, 'generator/' + index);
      generator.on('message', raw => {
        const message = raw as { kind?: string; connectedClients?: number; inputPacketsPerSecond?: number };
        if (message?.kind === 'heartbeat' && Number.isFinite(message.connectedClients) && Number.isFinite(message.inputPacketsPerSecond)) {
          console.error(JSON.stringify({ generator: index, connectedClients: message.connectedClients, inputPacketsPerSecond: round(message.inputPacketsPerSecond!) }));
        }
      });
    }
    phase = 'connect'; const connectStarted = performance.now();
    const groups = Array.from({ length: 4 }, (_, index) => tokens.filter((_, tokenIndex) => tokenIndex % 4 === index));
    const offsets = [0, 0, 0, 0]; let lastBatchAt = -Infinity, batches = 0;
    while (offsets.some((offset, index) => offset < groups[index].length)) {
      for (let index = 0; index < 4; index++) {
        const batch = groups[index].slice(offsets[index], offsets[index] + 4); if (!batch.length) continue;
        check(); await delay(Math.max(0, 200 - (performance.now() - lastBatchAt))); check(); lastBatchAt = performance.now();
        const result = await requestWorker<Ready>(generators[index], { kind: 'connect', endpoint, tokens: batch, concurrency: 4, maxRetries: 3, retryDelayMs: 250, joinTimeoutMs: 15000 }, 'ready', 90000, controller.signal);
        ready[index] = result;
        if (Object.values(result.errors).some(count => count > 0) || result.joinedBatch !== batch.length
          || result.connectedClients !== offsets[index] + batch.length) throw new HarnessError('connection-batch-incomplete');
        offsets[index] += batch.length; batches++;
        if (batches % 25 === 0) console.error(JSON.stringify({ phase: 'connect', connectedClients: offsets.reduce((sum, value) => sum + value, 0), target: config.clients }));
      }
    }
    report.connectionPhase = { durationSeconds: round((performance.now() - connectStarted) / 1000), batches,
      connectedClients: ready.reduce((sum, item) => sum + (item?.connectedClients ?? 0), 0),
      connectionAttempts: ready.reduce((sum, item) => sum + (item?.connectionAttempts ?? 0), 0),
      connectionRetries: ready.reduce((sum, item) => sum + (item?.connectionRetries ?? 0), 0), generators: ready };
    }
    await delay(1000); check();
    const registry = await observer.hgetall(READY_PROCESSES_KEY), processOwners = new Map(Object.entries(registry).map(([id, value]) => [id, parseReadyProcess(value)?.workerId]));
    const driver = new RedisDriver(observer), listings = await driver.query({ name: 'lobby' });
    report.roomLayout = listings.map(room => ({ roomId: room.roomId, owner: processOwners.get(room.processId), clients: room.clients, maxClients: room.maxClients }));
    const roomOwners = new Map<string, string>(report.roomLayout.map((room: { roomId: string; owner: string }) => [room.roomId, room.owner]));
    const preparedClients = observedClients(ready as Ready[], roomOwners, ids);
    report.connectionPhase.ownerConnectedClients = preparedClients;
    const counts = new Map<string, number>();
    for (const room of listings) { const owner = processOwners.get(room.processId); if (!owner || !ids.includes(owner)) throw new HarnessError('unregistered-room-owner'); counts.set(owner, (counts.get(owner) ?? 0) + 1); }
    if (listings.length > profile.maxRooms || listings.some(room => room.clients > STAND_ROOM_CAPACITY || room.maxClients !== STAND_ROOM_CAPACITY) || [...counts.values()].some(count => count > STAND_MAX_ROOMS_PER_PROCESS)) throw new HarnessError('room-cap-exceeded');
    if (!preparedClients.valid || preparedClients.total !== config.clients) throw new HarnessError('prepared-owner-counts-invalid');
    if (config.resourceDiagnostics) {
      try { hostBefore = await hostVirtualMemory(); } catch (error) { resourceErrors.push(error instanceof HarnessError ? error.code : 'host-resource-unavailable'); }
      await sampleProxy();
    }
    await Promise.all([...games.values()].map(game => requestWorker(game, { kind: 'reset-load-diagnostics', requestId: randomUUID() }, 'load-diagnostics-reset', 5000, controller.signal)));
    phase = 'measure';
    if (config.chatV2) {
      if (!standControl) throw new HarnessError('chat-v2-needs-stand');
      standChatStartAtUnixMs = Date.now() + chatV2StartLeadMs;
      report.chatV2.startAtUnixMs = standChatStartAtUnixMs;
      standControl.start(standChatStartAtUnixMs);
      await delay(Math.max(0, standChatStartAtUnixMs - Date.now())); check();
    }
    measureStartedAt = standChatStartAtUnixMs ?? Date.now(); measuring = true;
    if (config.resourceDiagnostics && proxy) proxyTimer = setInterval(() => { void sampleProxy(); }, 2000);
    let parentLastCpu = process.cpuUsage(), parentLastTime = performance.now(), parentLastWall = Date.now();
    parentLoop.enable(); parentLoop.reset();
    parentTimer = setInterval(() => {
      const now = performance.now(), wall = Date.now(), cpu = process.cpuUsage(), memory = process.memoryUsage();
      parentMetrics.push({ kind: 'metrics', intervalStartedAt: parentLastWall, sampledAt: wall, intervalMs: now - parentLastTime,
        cpuPercent: (cpu.user - parentLastCpu.user + cpu.system - parentLastCpu.system) / ((now - parentLastTime) * 10),
        rssMiB: memory.rss / 1024 ** 2, heapMiB: memory.heapUsed / 1024 ** 2, eventLoopP99Ms: parentLoop.percentile(99) / 1e6, eventLoopMaxMs: parentLoop.max / 1e6 });
      parentLastCpu = cpu; parentLastTime = now; parentLastWall = wall; parentLoop.reset();
    }, 1000);
    console.error(`Measuring ${config.clients} clients for ${config.seconds}s with ${movingClients} sending 60 input steps/s on ${config.gameProcesses} game processes.`);
    let results: Result[];
    let chatAudit: StandFinished['chatAudit'];
    if (standControl) {
      if (standChatStartAtUnixMs === undefined) standControl.start();
      const finished = await bounded(standControl.results, (config.seconds + (config.chatV2 ? 60 : 30)) * 1000, 'stand-generator-result-timeout');
      results = finished.results;
      chatAudit = finished.chatAudit;
    } else {
      results = await Promise.all(generators.map(generator => requestWorker<Result>(generator,
        { kind: 'measure', seconds: config.seconds, stepsPerPacket: 2, drainMs: 2000, inputMode: config.inputMode }, 'result', (config.seconds + 15) * 1000, controller.signal)));
    }
    measureEndedAt = Date.now(); measuring = false; report.generators = results;
    const chatPilot = config.chatV2 && standChatStartAtUnixMs !== undefined
      ? chatV2Pilot(results, config.chatV2, standChatStartAtUnixMs, chatAudit) : undefined;
    if (chatPilot) report.chatV2 = chatPilot;
    if (config.frameDiagnostics) {
      await Promise.all([...games].map(async ([id, game]) => {
        const snapshot = await requestWorker<{ traffic?: RoomTraffic }>(game, { kind: 'snapshot-load-diagnostics', requestId: randomUUID() },
          'load-diagnostics-snapshot', 5000, controller.signal);
        if (!snapshot.traffic) throw new HarnessError('server-diagnostic-snapshot-missing'); trafficDiagnostics[id] = snapshot.traffic;
      }));
      const receivedFrames = Object.values(trafficDiagnostics).reduce((sum, traffic) => sum + traffic.inputFrames, 0);
      const sentFrames = results.reduce((sum, result) => sum + result.packetsSent, 0);
      report.inputDelivery = { sentFrames, receivedFrames, difference: sentFrames - receivedFrames,
        definition: 'Existing inputs messages counted before the server limiter after the reset barrier. Counts do not prove that all movement steps were applied. A final snapshot is taken before cleanup.' };
    }
    if (proxyTimer) clearInterval(proxyTimer); proxyTimer = undefined;
    if (config.resourceDiagnostics) {
      await proxySample; await sampleProxy();
      try { hostAfter = await hostVirtualMemory(); } catch (error) { resourceErrors.push(error instanceof HarnessError ? error.code : 'host-resource-unavailable'); }
    }
    clearInterval(parentTimer); parentTimer = undefined; parentLoop.disable();
    const measuredClients = observedClients(results, roomOwners, ids);
    const perSecond = results.reduce((sum, result) => sum + result.inputPacketsPerSecond, 0), packets = results.reduce((sum, result) => sum + result.packetsSent, 0);
    const moversByGenerator = results.map(result => result.movement?.plannedClients ?? result.count);
    const ratePercentByGenerator = results.map((result, index) => {
      const target = moversByGenerator[index] * 30;
      return target > 0 ? result.inputPacketsPerSecond / target * 100 : null;
    });
    const afterDrain = results.reduce((sum, result) => sum + result.unacknowledgedPackets, 0), atEnd = results.reduce((sum, result) => sum + result.unacknowledgedAtEndOfSending, 0);
    const health = await Promise.all(ids.map(async id => { try { return (await fetch('http://127.0.0.1:' + ports.get(id) + '/healthz', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }));
    report.summary = { connectedClients: results.reduce((sum, result) => sum + result.connectedClients, 0), errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
      inputPacketsPerSecond: round(perSecond), inputRateTargetPercent: movingClients ? round(perSecond / (movingClients * 30) * 100) : null,
      inputRateTargetPercentByGenerator: ratePercentByGenerator.map(rate => rate === null ? null : round(rate)),
      ackP95MsByGenerator: results.map((result, index) => moversByGenerator[index] ? result.ackMs.p95 : null),
      ackP99MsByGenerator: results.map((result, index) => moversByGenerator[index] ? result.ackMs.p99 : null),
      ...(config.chatV2?.movingClients !== undefined ? { movement: {
        plannedClients: movingClients, sentClients: results.reduce((sum, result) => sum + (result.movement?.sentClients ?? 0), 0),
        connectedClients: results.reduce((sum, result) => sum + (result.movement?.connectedClients ?? 0), 0),
      } } : {}),
      maxAckMs: Math.max(...results.map(result => result.ackMs.max)), unacknowledgedAtEndOfSending: atEnd, unacknowledgedAfterDrain: afterDrain,
      unacknowledgedPercentAfterDrain: round(afterDrain / Math.max(1, packets) * 100), oldestUnacknowledgedMs: round(Math.max(...results.map(result => result.oldestUnacknowledgedMs))),
      rooms: listings.length, activeRoomProcesses: counts.size, roomsByProcess: Object.fromEntries(counts),
      ownerConnectedClients: measuredClients,
      receivedMiB: round(results.reduce((sum, result) => sum + result.receivedBytes, 0) / 1024 ** 2),
      sendingSecondsByGenerator: results.map(result => round(result.durationSeconds)), observationSecondsByGenerator: results.map(result => round(result.observationSeconds)),
      serverCollectionWallSeconds: round((measureEndedAt - measureStartedAt) / 1000) };
    report.checks = { connections: report.summary.connectedClients === config.clients && report.summary.errorCount === 0,
      preparationErrors: ready.every(result => result && Object.values(result.errors).every(count => count === 0)),
      roomAndConnectedClientCaps: listings.length <= profile.maxRooms && listings.every(room => room.clients <= STAND_ROOM_CAPACITY && room.maxClients === STAND_ROOM_CAPACITY)
        && [...counts].every(([owner, count]) => ids.includes(owner) && count <= STAND_MAX_ROOMS_PER_PROCESS)
        && preparedClients.valid && preparedClients.total === config.clients && measuredClients.valid && measuredClients.total === config.clients,
      routedAcrossExpectedProcesses: counts.size >= Math.min(config.gameProcesses, Math.ceil(config.clients / STAND_ROOM_CAPACITY)), processesHealthy: health.every(Boolean),
      childProcessesAlive: [...games.values(), ...generators, ...(proxy ? [proxy] : [])].every(child => !exited(child)),
      metricSamplesAvailable: ids.every(id => metrics.get(id)!.length > 0) && parentMetrics.length > 0,
      ackTimingTrackingComplete: results.every(result => result.tracking?.latencyTimingSamplesDropped === 0),
      serverInputDeliveryComplete: !config.frameDiagnostics || report.inputDelivery.difference === 0,
      serverDiagnosticCoverageComplete: !config.frameDiagnostics || Object.keys(trafficDiagnostics).length === ids.length
        && Object.values(trafficDiagnostics).every(traffic => traffic.diagnosticErrors === 0 && traffic.inputDecodeErrors === 0
          && traffic.arrivalTrackingEvictions === 0 && traffic.untrackedClientFrames === 0 && traffic.inputQueueCoverageMisses === 0
          && traffic.rollingWindowOverflows === 0 && (traffic.inputFrames === 0 || traffic.coverage.inputQueueClients > 0
            && traffic.coverage.inputSeqClients > 0 && traffic.coverage.tickRooms > 0 && traffic.coverage.dispatchRooms > 0)),
      resourceSamplesAvailable: !config.resourceDiagnostics || ((!proxy || proxyMetrics.length > 0) && (process.platform !== 'darwin' || !!hostBefore && !!hostAfter) && resourceErrors.length === 0),
      generatorSustainedTarget: ratePercentByGenerator.every((rate, index) => rate === null
        ? results[index].packetsSent === 0 && results[index].inputPacketsPerSecond === 0 : rate >= config.minRatePercent),
      ...(config.chatV2?.movingClients !== undefined ? { movementCoverage: results.every(({ movement }) => movement !== undefined
        && movement.sentClients === movement.plannedClients && movement.connectedClients === movement.plannedClients) } : {}),
      ackSamplesAvailable: results.every((result, index) => moversByGenerator[index] === 0 || result.ackMs.count > 0),
      ackLatencyWithinLocalBudget: results.every(result => result.ackMs.p95 <= config.ackP95Ms && result.ackMs.p99 <= config.ackP99Ms),
      ackResidualWithinLocalBudget: afterDrain / Math.max(1, packets) * 100 <= config.maxUnacknowledgedPercent,
      ...chatPilot?.checks };
    report.ok = Object.values(report.checks).every(Boolean);
    report.verdict = report.ok ? 'passed-local-comparison'
      : !report.checks.connections ? 'failed-connections'
      : !report.checks.preparationErrors || !report.checks.roomAndConnectedClientCaps || !report.checks.routedAcrossExpectedProcesses ? 'failed-admission'
      : !report.checks.processesHealthy || !report.checks.childProcessesAlive ? 'failed-processes'
      : !report.checks.metricSamplesAvailable || !report.checks.resourceSamplesAvailable || !report.checks.ackTimingTrackingComplete
        || !report.checks.serverDiagnosticCoverageComplete ? 'inconclusive-metrics'
      : !report.checks.generatorSustainedTarget || report.checks.movementCoverage === false ? 'inconclusive-generator-rate'
      : chatPilot && !chatPilot.checks.chatV2OfferedAtTarget ? 'inconclusive-chat-v2-offer-rate'
      : chatPilot?.checks.chatV2PublicationIdsUnique === false ? 'failed-chat-v2-publication-identity'
      : chatPilot && !chatPilot.checks.chatV2DeliveryComplete ? 'failed-chat-v2-delivery'
      : chatPilot?.checks.chatV2PeerDeliveryComplete === false ? 'failed-chat-v2-peer-delivery'
      : !report.checks.serverInputDeliveryComplete ? 'failed-input-delivery' : 'failed-local-checks';
  } catch (error) {
    report.ok = false; report.verdict = phase === 'connect' ? 'failed-admission' : 'setup-or-runtime-failure';
    report.failure = { phase, code: error instanceof HarnessError ? error.code : 'unexpected-local-error',
      diagnostics: error instanceof HarnessError && error.diagnostics ? error.diagnostics : standErrorDiagnostics(error) };
    if (phase === 'connect' && !report.connectionPhase) report.connectionPhase = { partial: true, generators: ready,
      connectedClients: ready.reduce((sum, item) => sum + (item?.connectedClients ?? 0), 0),
      connectionAttempts: ready.reduce((sum, item) => sum + (item?.connectionAttempts ?? 0), 0),
      connectionRetries: ready.reduce((sum, item) => sum + (item?.connectionRetries ?? 0), 0) };
  } finally {
    cleaning = true; measuring = false; clearTimeout(overallTimer);
    if (proxyTimer) clearInterval(proxyTimer); await proxySample;
    if (parentTimer) clearInterval(parentTimer); parentLoop.disable();
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    const cleanupFailures: string[] = [];
    const cleanup = async (name: string, action: () => Promise<unknown>, ms: number) => { try { await bounded(action(), ms, name); } catch { cleanupFailures.push(name); } };
    await Promise.all(generators.map((child, index) => cleanup('generator-cleanup-' + index, () => stopChild(child, true), 8500)));
    for (const socket of sockets) socket.destroy();
    if (proxy) await cleanup('proxy-child-cleanup', () => stopChild(proxy!, false), 15000);
    await Promise.all([...games].map(([id, child]) => cleanup('game-cleanup-' + id, () => stopChild(child, false), 15000)));
    if (front) await cleanup('proxy-cleanup', () => new Promise<void>(resolve => front!.close(() => resolve())), 2000);
    if (accounts) await cleanup('accounts-cleanup', () => accounts!.close(), 6000);
    if (portReservations) await cleanup('port-reservation-cleanup', () => portReservations!.close(), 2000);
    if (observer) { await cleanup('observer-cleanup', () => observer!.quit(), 1500); observer.disconnect(); }
    if (redis) await cleanup('valkey-cleanup', () => redis!.cleanup(), 5000);
    if (proxyDirectory) await cleanup('proxy-directory-cleanup', () => rm(proxyDirectory!, { recursive: true, force: true }), 2000);
    report.servers = Object.fromEntries([...metrics].map(([id, samples]) => [id, { ...summarizeMetrics(samples), ...reportMetricIntervals(samples) }]));
    report.orchestrator = { ...summarizeMetrics(parentMetrics), ...reportMetricIntervals(parentMetrics) };
    if (config.resourceDiagnostics) {
      const proxyObservedMs = proxyMetrics.reduce((sum, sample) => sum + sample.intervalMs, 0);
      report.proxyResources = { samples: proxyMetrics.length, observedSeconds: round(proxyObservedMs / 1000),
        cpuMeanPercent: round(proxyMetrics.reduce((sum, sample) => sum + sample.cpuPercent * sample.intervalMs, 0) / Math.max(1, proxyObservedMs)),
        cpuMaxPercent: round(Math.max(0, ...proxyMetrics.map(sample => sample.cpuPercent))), maxRssMiB: round(Math.max(0, ...proxyMetrics.map(sample => sample.rssMiB))), ...reportMetricIntervals(proxyMetrics) };
      const deltas = hostBefore && hostAfter ? Object.fromEntries(Object.keys(hostAfter.values).map(key => [key, hostAfter!.values[key] - hostBefore!.values[key]])) : undefined;
      report.hostVirtualMemory = { before: hostBefore, after: hostAfter, deltas, errors: resourceErrors };
    }
    report.serverDiagnosticCounts = diagnostics;
    report.roomTrafficDiagnostics = trafficDiagnostics;
    report.fatalDiagnostics = fatalDiagnostics;
    report.sumProcessMaxRssMiB = round(Object.values(report.servers).reduce((sum: number, item: any) => sum + item.maxRssMiB, 0));
    report.cleanup = { passed: cleanupFailures.length === 0, failures: cleanupFailures };
    if (cleanupFailures.length) { report.ok = false; report.verdict = 'failed-cleanup'; }
    if (standManifestCreated) await cleanup('stand-manifest-cleanup', () => rm(config.standManifest!, { force: true }), 2000);
    report.cleanup = { passed: cleanupFailures.length === 0, failures: cleanupFailures };
    if (cleanupFailures.length) { report.ok = false; report.verdict = 'failed-cleanup'; }
    if (standControl) {
      await cleanup('stand-result-response', () => standControl!.publish(standReportForControl(report)), 5000);
      await cleanup('stand-control-cleanup', () => standControl!.close(), 5000);
    }
    report.cleanup = { passed: cleanupFailures.length === 0, failures: cleanupFailures };
    if (cleanupFailures.length) { report.ok = false; report.verdict = 'failed-cleanup'; }
    await writeFile(config.output, encodeStandServerReport(report, config.gameProcesses <= DEFAULT_GAME_PROCESSES), { flag: 'wx' });
    console.log(JSON.stringify({ output: config.output, ok: report.ok, verdict: report.verdict, summary: report.summary, checks: report.checks, failure: report.failure, cleanup: report.cleanup }, null, 2));
    if (!report.ok) process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void run().catch(error => { console.error(JSON.stringify({ ok: false, code: error instanceof HarnessError ? error.code : 'local-harness-startup-failure',
    diagnostics: error instanceof HarnessError && error.diagnostics ? error.diagnostics : standErrorDiagnostics(error) })); process.exitCode = 1; });
}
