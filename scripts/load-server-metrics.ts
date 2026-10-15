import { Server, Socket } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type ServerMetrics = { kind: 'metrics'; intervalStartedAt: number; sampledAt: number; intervalMs: number;
  cpuPercent: number; rssMiB: number; heapMiB: number; eventLoopP99Ms: number; eventLoopMaxMs: number };
export type { RoomTraffic } from './websocket-server-diagnostics';

type ResetChannel = { on(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown; connected?: boolean;
  send?(message: unknown, callback: (error: Error | null) => void): unknown };

/** The acknowledgment is emitted only after all local measurement baselines have synchronously reset. */
export function installDiagnosticsResetHandler(channel: ResetChannel, reset: () => void, diagnosticsEnabled: boolean,
  snapshot?: () => import('./websocket-server-diagnostics').RoomTraffic) {
  const listener = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as { kind?: unknown; requestId?: unknown };
    if ((message.kind !== 'reset-load-diagnostics' && message.kind !== 'snapshot-load-diagnostics') || typeof message.requestId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(message.requestId)) return;
    if (message.kind === 'reset-load-diagnostics') {
      reset();
      if (channel.connected) channel.send?.({ kind: 'load-diagnostics-reset', requestId: message.requestId, diagnosticsEnabled }, () => {});
    } else {
      const traffic = snapshot?.();
      if (channel.connected) channel.send?.({ kind: 'load-diagnostics-snapshot', requestId: message.requestId, diagnosticsEnabled, traffic }, () => {});
    }
  };
  channel.on('message', listener);
  return () => channel.off('message', listener);
}

const loopback = (host: unknown) => host === undefined || host === 'localhost' || host === '127.0.0.1' || host === '::1';
let installed = false;

/** Test processes may listen and connect only on loopback, including redirected SDK endpoints. */
export function installLoopbackNetworking() {
  if (installed) return;
  installed = true;
  const originalListen = Server.prototype.listen as (...args: any[]) => Server;
  Server.prototype.listen = function (this: Server, ...args: any[]) {
    if (typeof args[0] === 'number') {
      if (typeof args[1] === 'string') {
        if (args[1] !== '0.0.0.0' && !loopback(args[1])) throw new Error('Load listeners require loopback');
        args[1] = '127.0.0.1';
      } else args.splice(1, 0, '127.0.0.1');
    } else if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const options = args[0];
      if (options.path || options.fd !== undefined || (options.host !== '0.0.0.0' && !loopback(options.host))) throw new Error('Load listeners require loopback');
      args[0] = { ...options, host: '127.0.0.1' };
    } else throw new Error('Load listeners require a TCP port');
    return originalListen.apply(this, args);
  } as typeof Server.prototype.listen;

  const originalConnect = Socket.prototype.connect as (...args: any[]) => Socket;
  function restrict(args: any[]): any[] {
    if (Array.isArray(args[0])) {
      // Node marks normalized argument arrays with a private symbol. Keep that array intact.
      const normalized = args[0], guarded = restrict([...normalized]);
      normalized.splice(0, normalized.length, ...guarded);
      return args;
    }
    if (args[0] && typeof args[0] === 'object') {
      const options = args[0];
      if (options.path || options.port === undefined || !loopback(options.host) || !loopback(options.hostname)) throw new Error('Load connections require loopback TCP');
      return [{ ...options, host: options.host === '::1' ? '::1' : '127.0.0.1' }, ...args.slice(1)];
    }
    if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) {
      if (typeof args[1] === 'string') {
        if (!loopback(args[1])) throw new Error('Load connections require loopback');
        return [args[0], args[1] === '::1' ? '::1' : '127.0.0.1', ...args.slice(2)];
      }
      return [args[0], '127.0.0.1', ...args.slice(1)];
    }
    throw new Error('Load connections require loopback TCP');
  }
  Socket.prototype.connect = function (this: Socket, ...args: any[]) { return originalConnect.apply(this, restrict(args)); } as typeof Socket.prototype.connect;
}

async function runServer() {
  if (process.env.NODE_ENV !== 'test' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'royal_test') throw new Error('Temporary local PostgreSQL is required');
  for (const key of ['REDIS_URL', 'PUBLIC_ORIGIN']) {
    const url = new URL(process.env[key] || '');
    if (url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Temporary loopback cluster endpoints are required');
  }
  const index = process.argv.indexOf('--server-bundle'), bundle = process.argv[index + 1];
  if (index < 0 || !bundle) throw new Error('A server bundle is required');
  installLoopbackNetworking();
  const diagnostics = process.env.LOAD_FRAME_DIAGNOSTICS === '1' ? await (async () => {
    const [{ Room, ClientState }, { installServerDiagnostics }] = await Promise.all([
      import('@colyseus/core'), import('./websocket-server-diagnostics'),
    ]);
    return installServerDiagnostics(Room.prototype as unknown as import('./websocket-server-diagnostics').RoomMessagePrototype,
      { leavingState: ClientState.LEAVING });
  })() : undefined;
  process.on('uncaughtExceptionMonitor', (failure: Error & { code?: unknown }, origin) => {
    const code = typeof failure.code === 'string' && /^(?:[0-9A-Z]{5}|ERR_[A-Z_]{1,40}|E(?:ADDRINUSE|CONNRESET|PIPE|TIMEDOUT|CONNREFUSED))$/.test(failure.code) ? failure.code : 'other';
    const name = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'AggregateError', 'ReplyError'].includes(failure.name) ? failure.name : 'other';
    const category = /connection terminated/i.test(failure.message) ? 'connection-terminated' : /redis|presence/i.test(failure.message) ? 'redis'
      : /timeout|timed out/i.test(failure.message) ? 'timeout' : /lease/i.test(failure.message) ? 'lease' : 'other';
    const frames = [...(failure.stack ?? '').matchAll(/(?:server-bundle|index)\.js:(\d+):(\d+)/g)].slice(0, 4).map(match => ({ line: Number(match[1]), column: Number(match[2]) }));
    if (process.connected) process.send?.({ kind: 'fatal-diagnostic', name, code, origin, category, bundleFrames: frames });
  });
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  let lastCpu = process.cpuUsage(), lastTime = performance.now(), lastWall = Date.now();
  const removeResetHandler = installDiagnosticsResetHandler(process as unknown as ResetChannel, () => {
    diagnostics?.reset();
    lastCpu = process.cpuUsage(); lastTime = performance.now(); lastWall = Date.now(); loop.reset();
  }, Boolean(diagnostics), diagnostics ? () => diagnostics.snapshot(true) : undefined);
  const timer = setInterval(() => {
    const now = performance.now(), sampledAt = Date.now(), cpu = process.cpuUsage(), memory = process.memoryUsage();
    const message: ServerMetrics = { kind: 'metrics', intervalStartedAt: lastWall, sampledAt, intervalMs: now - lastTime,
      cpuPercent: (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / ((now - lastTime) * 10),
      rssMiB: memory.rss / 1024 ** 2, heapMiB: memory.heapUsed / 1024 ** 2,
      eventLoopP99Ms: loop.percentile(99) / 1e6, eventLoopMaxMs: loop.max / 1e6 };
    if (process.connected) process.send?.(message);
    if (diagnostics && process.connected) process.send?.({ kind: 'room-traffic', traffic: diagnostics.snapshot(true, { compact: true }) });
    lastCpu = cpu; lastTime = now; lastWall = sampledAt; loop.reset();
  }, 1000);
  timer.unref();
  process.once('disconnect', () => {
    clearInterval(timer); loop.disable(); removeResetHandler(); diagnostics?.close();
    // A dead orchestrator must not leave game processes and their account leases running.
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => process.exit(1), 10000).unref();
  });
  await import(pathToFileURL(resolve(bundle)).href);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runServer().catch(() => { console.error('Local metrics server could not start'); process.exit(1); });
}
