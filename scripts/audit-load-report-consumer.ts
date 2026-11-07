import { fork } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AuditPlayerReportError, exportAuditPlayer } from '../server/audit/report-player';
import { readAuditSummary } from '../server/audit/report-summary';

type Login = Parameters<typeof exportAuditPlayer>[0];
type PlayerInput = Omit<Parameters<typeof exportAuditPlayer>[1], 'signal'>;
type SummaryInput = Omit<Parameters<typeof readAuditSummary>[1], 'signal'>;
type PlayerResult = Awaited<ReturnType<typeof exportAuditPlayer>>;
type SummaryResult = Awaited<ReturnType<typeof readAuditSummary>>;
type Timing = { from: number; to: number };
type Timed<T> = Timing & { result: T };
type WireLogin = { host: string; port: number; database: string; user: string; password: string };
type Work = { kind: 'player'; input: PlayerInput } | { kind: 'summary'; input: SummaryInput };
type Request = Work & { id: number; login: WireLogin };
type RequestBody = Request | { kind: 'stop' };
type Reply = { kind: 'ready' } | ({ kind: 'result'; id: number; cpu: NodeJS.CpuUsage } & Timing & (
  { result: PlayerResult | SummaryResult } | { code?: ConstructorParameters<typeof AuditPlayerReportError>[0]; jobId: string | null }));
const file = fileURLToPath(import.meta.url);
const maxRequests = 4;
const maxMessageBytes = 128 * 1024;
const stamp = () => performance.timeOrigin + performance.now();
const isolatedLogin = (login: Partial<WireLogin>): login is WireLogin => login.host === '127.0.0.1' &&
  login.database === 'royal_test' && typeof login.port === 'number' && Number.isInteger(login.port) && login.port > 0 && login.port <= 65_535 &&
  typeof login.user === 'string' && /^audit_load_(player|summary|limit|wide)$/.test(login.user) &&
  typeof login.password === 'string' && /^[a-f0-9-]{36}$/.test(login.password);

function sendReply(reply: Reply) {
  if (process.connected) process.send?.(reply, () => {});
}

function serve() {
  const controller = new AbortController();
  let active: Promise<void> | null = null;
  let requestCount = 0;
  const stop = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    void Promise.resolve(active).finally(() => { if (process.connected) process.disconnect?.(); });
  };
  process.once('disconnect', stop);
  process.once('SIGTERM', stop);
  process.on('message', (message: RequestBody) => {
    if (message?.kind === 'stop') { stop(); return; }
    if (controller.signal.aborted) return;
    if (!message || active || message.id !== ++requestCount || requestCount > maxRequests ||
        !isolatedLogin(message.login ?? {}) || message.input?.schema !== 'test_audit_load' ||
        (message.kind !== 'player' && message.kind !== 'summary')) { stop(); return; }
    const { id, login, kind } = message;
    if (kind === 'player') {
      const { destination } = message.input;
      if (typeof destination !== 'string' || basename(destination) !== 'player.csv' ||
          !basename(dirname(destination)).startsWith('royal-audit-load-') || dirname(dirname(destination)) !== tmpdir()) {
        stop();
        return;
      }
    }
    const from = stamp(), before = process.cpuUsage();
    const options = { ...login, ssl: false };
    const job = kind === 'player' ? exportAuditPlayer(options, { ...message.input, signal: controller.signal }) :
      readAuditSummary(options, { ...message.input, signal: controller.signal });
    active = job.then(result => {
      const reply = { kind: 'result' as const, id, from, to: stamp(), cpu: process.cpuUsage(before), result };
      if (Buffer.byteLength(JSON.stringify(reply)) > maxMessageBytes) throw new Error('Isolated report response exceeds bound');
      sendReply(reply);
    }).catch(error => {
      sendReply({ kind: 'result', id, from, to: stamp(), cpu: process.cpuUsage(before),
        code: error instanceof AuditPlayerReportError ? error.code : undefined,
        jobId: error instanceof AuditPlayerReportError ? error.jobId : null });
    }).finally(() => { active = null; });
  });
  sendReply({ kind: 'ready' });
}

/** One benchmark-owned Node process, idle during the no-report control. */
export async function startAuditLoadReportConsumer(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = fork(file, [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP,
      SystemRoot: process.env.SystemRoot, NODE_ENV: 'test' } });
  const closed = new Promise<true>(resolveClose => { child.once('close', () => resolveClose(true)); });
  type Pending = { id: number; requestedAt: number; resolve: (value: Timed<PlayerResult | SummaryResult>) => void;
    reject: (error: unknown) => void };
  let pending: Pending | undefined, requestCount = 0;
  let closing: Promise<void> | undefined;
  const cpu = { user: 0, system: 0 };
  const rejectPending = () => { pending?.reject(new Error('Isolated report consumer disconnected')); pending = undefined; };
  child.on('error', rejectPending);
  child.on('close', rejectPending);
  child.on('message', (reply: Reply) => {
    if (reply.kind !== 'result' || !pending || reply.id !== pending.id) return;
    const call = pending;
    pending = undefined;
    if (!Number.isFinite(reply.from) || !Number.isFinite(reply.to) || reply.from < call.requestedAt - 1 ||
        reply.to < reply.from || reply.to > stamp() + 1) {
      call.reject(new Error('Isolated report consumer clock mismatch'));
      return;
    }
    cpu.user += reply.cpu.user;
    cpu.system += reply.cpu.system;
    if ('result' in reply) {
      call.resolve({ from: reply.from - performance.timeOrigin, to: reply.to - performance.timeOrigin, result: reply.result });
    } else call.reject(reply.code ? new AuditPlayerReportError(reply.code, reply.jobId) : new Error('Isolated report consumer failed'));
  });
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', cancel);
    if (child.connected) child.send({ kind: 'stop' }, () => {});
    if (await Promise.race([closed, pause(5000, false, { ref: false })])) return;
    child.kill('SIGKILL');
    await closed;
    throw new Error('Isolated report consumer failed to stop');
  })();
  const cancel = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const readySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
    const [ready] = await Promise.race([once(child, 'message', { signal: readySignal }), closed.then(() => [])]);
    if (ready?.kind !== 'ready') throw new Error('Isolated report consumer failed to start');
  } catch (error) {
    await close();
    throw error;
  }
  const run = async (config: Login, work: Work) => {
    const { host, port, database, user, password, connectionString } = config;
    const login = { host, port, database, user, password: typeof password === 'string' ? password : undefined };
    if (connectionString || !isolatedLogin(login) || pending || closing || !child.connected || requestCount >= maxRequests) {
      throw new Error('Invalid isolated report consumer request');
    }
    const id = ++requestCount, request: Request = { ...work, id, login };
    if (Buffer.byteLength(JSON.stringify(request)) > maxMessageBytes) throw new Error('Isolated report request exceeds bound');
    return new Promise<Timed<PlayerResult | SummaryResult>>((resolveReport, reject) => {
      pending = { id, requestedAt: stamp(), resolve: resolveReport, reject };
      child.send(request, error => { if (error && pending?.id === id) rejectPending(); });
    });
  };
  return {
    player: (login: Login, input: PlayerInput) => run(login, { kind: 'player', input }) as Promise<Timed<PlayerResult>>,
    summary: (login: Login, input: SummaryInput) => run(login, { kind: 'summary', input }) as Promise<Timed<SummaryResult>>,
    metrics: () => ({ requests: requestCount, userCpuMicros: cpu.user, systemCpuMicros: cpu.system }),
    close,
  };
}

if (process.send && process.argv[1] && resolve(process.argv[1]) === file) serve();
