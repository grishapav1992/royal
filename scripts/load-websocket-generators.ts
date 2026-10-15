import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { installLoopbackNetworking } from './load-server-metrics';
import { DEFAULT_GAME_PROCESSES } from './load-stand-limits';
import { attestGeneratorApiOrigins, generatorApiOrigins, generatorBatchApiIndex } from './load-generator-endpoints';
import { loopbackEndpoint, parseStandManifest, parseStandReady, parseStandResult, standHost, StandError,
  verifyStandStatus, type StandManifest, type StandReady, type StandResult } from './load-stand-contract';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const round = (value: number) => Number(value.toFixed(2));
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
async function bounded<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StandError(code)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function command<T>(child: ChildProcess, payload: object, response: string, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', died); signal.removeEventListener('abort', aborted); };
    const fail = (code: string) => { cleanup(); reject(new StandError(code)); };
    const message = (value: unknown) => { const raw = value as { kind?: string }; if (raw?.kind === response) { cleanup(); resolve(value as T); } else if (raw?.kind === 'error') fail('generator-command-failed'); };
    const died = () => fail('generator-exited'), aborted = () => fail('generator-interrupted');
    const timer = setTimeout(() => fail('generator-command-timeout'), timeoutMs);
    if (signal.aborted || exited(child) || !child.connected) { fail('generator-unavailable'); return; }
    child.on('message', message); child.once('exit', died); signal.addEventListener('abort', aborted, { once: true });
    child.send(payload, error => { if (error) fail('generator-ipc-failed'); });
  });
}
async function stop(child: ChildProcess) {
  if (exited(child)) return;
  const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
  if (child.connected) child.send({ kind: 'shutdown' }, () => {}); else child.kill('SIGTERM');
  try { await bounded(done, 3500, 'generator-shutdown-timeout'); return; } catch {}
  child.kill('SIGTERM'); try { await bounded(done, 2000, 'generator-term-timeout'); return; } catch {}
  child.kill('SIGKILL'); await bounded(done, 2000, 'generator-kill-timeout');
}
async function responseBody(response: Response) {
  if (!response.ok || !response.body) throw new StandError('stand-control-rejected');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 ** 2) throw new StandError('stand-response-too-large'); chunks.push(chunk.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
    catch { throw new StandError('invalid-stand-response'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function control(manifest: StandManifest, endpoint: string, path: string, body: object | undefined, signal: AbortSignal, timeoutMs: number) {
  const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { Authorization: 'Bearer ' + manifest.secret, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
  return responseBody(response);
}
function cli() {
  if (process.argv.includes('--help')) {
    console.log('Generator-only runner, no game server or PostgreSQL on this machine.');
    console.log('node --import tsx scripts/load-websocket-generators.ts --manifest /private/path/stand.json --control-port 17101 --workers 4 --input-mode stress --output artifacts/websocket-stand/generators.json');
    console.log('Forward the manifest API origin port and the stand control port through SSH. Both endpoints remain 127.0.0.1.');
    console.log('Optional --api-ports accepts workers to 128 unique loopback ports, excluding the control port. With exactly workers ports each generator keeps one alias; more ports spread successive four-client connection batches round-robin across all aliases.'); return;
  }
  const values: Record<string, string> = {}, keys = new Set(['--manifest', '--control-port', '--api-ports', '--workers', '--input-mode', '--sdk-websocket', '--output']);
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index], value = process.argv[++index];
    if (!keys.has(key) || !value || value.startsWith('--') || values[key]) throw new StandError('invalid-generator-cli'); values[key] = value;
  }
  if (!values['--manifest']) throw new StandError('stand-manifest-required');
  const workers = Number(values['--workers'] ?? 4), controlPort = values['--control-port'] ? Number(values['--control-port']) : undefined;
  const inputMode = values['--input-mode'] ?? 'stress', sdkWebSocket = values['--sdk-websocket'] ?? 'ws';
  if (!Number.isInteger(workers) || workers < 1 || workers > 32 || controlPort !== undefined && (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535)
    || !['stress', 'browser-window'].includes(inputMode) || !['ws', 'native'].includes(sdkWebSocket)) throw new StandError('invalid-generator-cli-value');
  return { manifest: resolve(values['--manifest']), output: resolve(values['--output'] ?? 'artifacts/websocket-stand/generators-' + Date.now() + '.json'),
    workers, controlPort, apiPorts: values['--api-ports'], inputMode: inputMode as 'stress' | 'browser-window', sdkWebSocket };
}
async function run() {
  const config = cli(); if (!config) return;
  const info = await stat(config.manifest);
  if (!info.isFile() || info.size > 1024 ** 2 || process.platform !== 'win32' && (info.mode & 0o077)) throw new StandError('private-stand-manifest-required');
  const manifest = parseStandManifest(JSON.parse(await readFile(config.manifest, 'utf8')));
  if (config.workers > manifest.clients) throw new StandError('more-generators-than-clients');
  await mkdir(dirname(config.output), { recursive: true });
  try { await stat(config.output); throw new StandError('generator-report-already-exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const endpoint = manifest.apiEndpoint, controlEndpoint = config.controlPort ? loopbackEndpoint('http://127.0.0.1:' + config.controlPort) : manifest.controlEndpoint;
  const apiOrigins = generatorApiOrigins(config.apiPorts, config.workers, endpoint, controlEndpoint);
  const mappedApiOrigins = [...new Set(apiOrigins)];
  const assignmentMode = config.apiPorts === undefined ? 'canonical' : apiOrigins.length === config.workers ? 'fixed-per-generator' : 'round-robin-batches';
  const assignmentCounts = Array.from({ length: config.workers }, () => new Map<string, { batches: number; admittedClients: number }>());
  installLoopbackNetworking();
  const controller = new AbortController(), abort = () => controller.abort(), children: ChildProcess[] = [];
  process.once('SIGINT', abort); process.once('SIGTERM', abort); const overall = setTimeout(abort, manifest.expiresAt - Date.now());
  const report: Record<string, any> = { productionTraffic: false, generatorOnly: true, runId: manifest.runId,
    targetClients: manifest.clients, seconds: manifest.seconds, inputMode: config.inputMode, sdkWebSocket: config.sdkWebSocket,
    clientHost: standHost(), serverHost: manifest.serverHost, bundleSha256: manifest.bundleSha256,
    tunnel: { apiOrigin: endpoint, controlOrigin: controlEndpoint, mappedApiOrigins, transportCount: mappedApiOrigins.length, assignmentMode,
      perGeneratorApiAliases: assignmentMode === 'fixed-per-generator',
      transportCountDefinition: 'Distinct attested loopback API origins; separate SSH TCP connections must be verified by the caller',
      transport: 'Loopback endpoints, optional SSH port forwards; independent API aliases require separate SSH connections to isolate their channels. SSH CPU and network queues can affect the result' },
    hostSeparationDefinition: 'Hashed hostname comparison is not proof of distinct physical hardware', childExits: [] };
  report.differentReportedHosts = report.clientHost.hostFingerprint !== report.serverHost.hostFingerprint;
  let cleaning = false, attested = false, reported = false;
  try {
    verifyStandStatus(await control(manifest, controlEndpoint, '/status', undefined, controller.signal, 5000), manifest); attested = true;
    await attestGeneratorApiOrigins(apiOrigins, manifest, origin => control(manifest, origin, '/__load-stand/status', undefined, controller.signal, 5000));
    report.attestation = { control: true, gameApi: true, gameApiOrigins: [...new Set(apiOrigins)], verifiedBeforeGenerators: true };
    const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test', LOAD_SDK_WEBSOCKET: config.sdkWebSocket };
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    for (let index = 0; index < config.workers; index++) {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/load-websocket-worker.ts'], { env: childEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(child);
      child.on('error', () => { if (!cleaning) controller.abort(); });
      child.on('exit', (code, signal) => { report.childExits.push({ generator: index, code, signal, duringCleanup: cleaning }); if (!cleaning) controller.abort(); });
      child.on('message', value => { const heartbeat = value as { kind?: string; connectedClients?: number; inputPacketsPerSecond?: number };
        if (heartbeat?.kind === 'heartbeat') console.error(JSON.stringify({ generator: index, connectedClients: heartbeat.connectedClients, packetsPerSecond: heartbeat.inputPacketsPerSecond })); });
    }
    const groups = Array.from({ length: config.workers }, (_, index) => manifest.tokens.filter((_, tokenIndex) => tokenIndex % config.workers === index));
    const offsets = Array(config.workers).fill(0) as number[], ready: StandReady[] = []; let lastBatchAt = -Infinity, batches = 0;
    const connectedAt = performance.now();
    while (offsets.some((offset, index) => offset < groups[index].length)) for (let index = 0; index < config.workers; index++) {
      const tokens = groups[index].slice(offsets[index], offsets[index] + 4); if (!tokens.length) continue;
      await delay(Math.max(0, 200 - (performance.now() - lastBatchAt))); lastBatchAt = performance.now();
      const origin = apiOrigins[generatorBatchApiIndex(apiOrigins.length, config.workers, index, batches)];
      const result = parseStandReady(await command(children[index], { kind: 'connect', endpoint: origin, ...(config.apiPorts ? { canonicalEndpoint: endpoint } : {}), tokens, concurrency: 4,
        maxRetries: 3, retryDelayMs: 250, joinTimeoutMs: 15000 }, 'ready', controller.signal, 90000), manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES); ready[index] = result;
      if (result.joinedBatch !== tokens.length || result.connectedClients !== offsets[index] + tokens.length || Object.values(result.errors).some(count => count > 0)) throw new StandError('generator-admission-incomplete');
      const counts = assignmentCounts[index].get(origin) ?? { batches: 0, admittedClients: 0 };
      counts.batches++; counts.admittedClients += tokens.length; assignmentCounts[index].set(origin, counts);
      offsets[index] += tokens.length; batches++;
      if (batches % 25 === 0) console.error(JSON.stringify({ phase: 'connect', connectedClients: offsets.reduce((sum, n) => sum + n, 0), target: manifest.clients }));
    }
    const connectionPhase = { durationSeconds: round((performance.now() - connectedAt) / 1000), batches,
      connectionAttempts: ready.reduce((sum, item) => sum + item.connectionAttempts, 0), connectionRetries: ready.reduce((sum, item) => sum + item.connectionRetries, 0) };
    const start = await control(manifest, controlEndpoint, '/prepared', { runId: manifest.runId, ready, clientHost: report.clientHost,
      inputMode: config.inputMode, gameProcesses: manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES, connectionPhase }, controller.signal, 30000);
    if (start.start !== true || start.runId !== manifest.runId) throw new StandError('stand-start-barrier-mismatch');
    console.error(JSON.stringify({ phase: 'measure', clients: manifest.clients, seconds: manifest.seconds, workers: config.workers }));
    const results: StandResult[] = await Promise.all(children.map(async child => parseStandResult(await command(child,
      { kind: 'measure', seconds: manifest.seconds, stepsPerPacket: 2, drainMs: 2000, inputMode: config.inputMode }, 'result', controller.signal, (manifest.seconds + 15) * 1000), manifest.gameProcesses ?? DEFAULT_GAME_PROCESSES)));
    report.ready = ready; report.connectionPhase = connectionPhase; report.results = results;
    const response = await control(manifest, controlEndpoint, '/results', { runId: manifest.runId, results }, controller.signal, 90000);
    if (response.runId !== manifest.runId || !response.report || typeof response.report !== 'object') throw new StandError('stand-result-response-mismatch');
    reported = true; report.serverReport = response.report;
    report.ok = report.serverReport.ok === true; report.verdict = report.serverReport.verdict;
  } catch (error) { report.ok = false; report.verdict = 'generator-or-stand-failure'; report.failure = { code: error instanceof StandError ? error.code : 'generator-runtime-failure' }; }
  finally {
    cleaning = true; clearTimeout(overall); process.off('SIGINT', abort); process.off('SIGTERM', abort);
    const failures: string[] = [];
    await Promise.all(children.map(async (child, index) => { try { await stop(child); } catch { failures.push('generator-' + index); } }));
    if (attested && !reported) {
      try { await control(manifest, controlEndpoint, '/abort', { runId: manifest.runId, code: 'generator-aborted' }, new AbortController().signal, 3000); }
      catch { failures.push('stand-abort-unconfirmed'); }
    }
    report.cleanup = { passed: failures.length === 0, failures };
    report.tunnel.generatorAssignments = assignmentCounts.map((counts, generator) => ({ generator,
      usedApiOrigins: [...counts.keys()], aliases: [...counts].map(([apiOrigin, counts]) => ({ apiOrigin, ...counts })),
      admittedClients: [...counts.values()].reduce((sum, counts) => sum + counts.admittedClients, 0) }));
    report.tunnel.assignmentCountDefinition = 'Clients observed connected in fully verified successful admission batches per alias. Partial or failed batches are omitted. These counts are not final per-alias liveness; ready and results contain current totals per generator.';
    if (failures.length) { report.ok = false; report.verdict = 'generator-cleanup-failure'; }
    await writeFile(config.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output: config.output, ok: report.ok, verdict: report.verdict, failure: report.failure,
      summary: report.serverReport?.summary, cleanup: report.cleanup }, null, 2));
    if (!report.ok) process.exitCode = 1;
  }
}
void run().catch(error => { console.error(JSON.stringify({ ok: false, code: error instanceof StandError ? error.code : 'generator-startup-failure' })); process.exitCode = 1; });
