import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { startAuditAttemptRuntime } from '../server/audit/attempts';
import { auditHttpAttempts } from '../server/audit/http-attempts';

const file = fileURLToPath(import.meta.url);
const gameSchema = 'test_audit_load_game';
const auditSchema = 'test_audit_load';
const commandTimeoutMs = 5000;
const datasetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Command = { kind: 'start'; datasetId: string } | { kind: 'stop' };
type Request = (Command & { id: number }) | { kind: 'shutdown' };
type Reply = { kind: 'ready'; port: number } | { kind: 'result'; id: number; ok: boolean };

function fixtureEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_ENV, PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE } = env;
  if (NODE_ENV !== 'test' || PGHOST !== '127.0.0.1' || PGDATABASE !== 'royal_test' || PGUSER !== 'postgres' ||
      PGSSLMODE !== 'disable' || !/^[1-9][0-9]{0,4}$/.test(PGPORT ?? '') || Number(PGPORT) > 65_535 ||
      !/^[a-f0-9]{64}$/.test(PGPASSWORD ?? '') || env.DATABASE_URL || env.DATABASE_URL_FILE || env.PGPASSWORD_FILE) {
    throw new Error('Expected credentials for the disposable audit wallet database');
  }
  return { NODE_ENV, PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE, AUTH_DB_PATH: gameSchema, PGPOOL_MAX: '8' };
}

function send(reply: Reply) {
  if (process.connected) process.send?.(reply, () => {});
}

async function serve() {
  const env = fixtureEnv(process.env);
  if (!process.connected || process.env.AUTH_DB_PATH !== gameSchema || process.env.PGPOOL_MAX !== env.PGPOOL_MAX) {
    throw new Error('Expected an isolated audit wallet child');
  }
  let accounts: (typeof import('../server/accounts'))['accounts'] | undefined;
  let server: ReturnType<express.Application['listen']> | undefined;
  let capture: ReturnType<typeof startAuditAttemptRuntime>;
  let active: Promise<void> = Promise.resolve();
  let closing = false, ready = false, busy = false, lastId = 0;
  const stopCapture = async () => {
    const previous = capture;
    capture = undefined;
    await previous?.close();
  };
  const stop = () => {
    if (closing) return;
    closing = true;
    void active.then(async () => {
      try { await stopCapture(); }
      finally {
        if (server) await new Promise<void>(done => {
          server!.close(() => done());
          server!.closeAllConnections();
        });
        await accounts?.close();
      }
    }).catch(() => { process.exitCode = 1; }).finally(() => {
      if (process.connected) process.disconnect?.();
    });
  };
  process.once('disconnect', stop);
  process.once('SIGTERM', stop);
  process.on('message', (request: Request) => {
    if (closing) return;
    if (request?.kind === 'shutdown') { stop(); return; }
    if (!ready || busy || request?.id !== ++lastId || (request.kind !== 'start' && request.kind !== 'stop') ||
        (request.kind === 'start' && (capture || typeof request.datasetId !== 'string' || !datasetUuid.test(request.datasetId)))) {
      process.exitCode = 1;
      stop();
      return;
    }
    busy = true;
    active = (async () => {
      if (request.kind === 'start') {
        capture = startAuditAttemptRuntime({ ...env, ROYAL_AUDIT_SCHEMA: auditSchema, ROYAL_AUDIT_TEST_DATASET_ID: request.datasetId }, gameSchema);
        if (!capture || !await capture.ready) throw new Error('Isolated audit wallet capture did not start');
      } else await stopCapture();
      send({ kind: 'result', id: request.id, ok: true });
    })().catch(() => {
      send({ kind: 'result', id: request.id, ok: false });
      process.exitCode = 1;
      stop();
    }).finally(() => { busy = false; });
  });
  active = (async () => {
    accounts = (await import('../server/accounts')).accounts;
    await accounts.ready;
    const { installDemoWallet } = await import('../server/demoWalletRoutes');
    if (accounts.schema !== gameSchema) throw new Error('Unexpected isolated audit wallet schema');
    if (closing) return;
    const app = express();
    const observe = auditHttpAttempts(observation => capture?.record(observation), { gameSchema });
    app.use((req, res, next) => capture ? observe(req, res, next) : next());
    installDemoWallet(app);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Expected isolated loopback HTTP');
    if (!closing) {
      ready = true;
      send({ kind: 'ready', port: address.port });
    }
  })().catch(() => { process.exitCode = 1; stop(); });
}

/** Runs the actual wallet installer without loading global accounts in the benchmark process. */
export async function startAuditLoadWallet(clusterEnv: NodeJS.ProcessEnv, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = fork(file, [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, SystemRoot: process.env.SystemRoot,
      ...fixtureEnv(clusterEnv) } });
  const closed = new Promise<{ code: number | null }>(done => {
    child.once('exit', code => done({ code }));
    child.once('error', () => done({ code: null }));
  });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', cancel);
    if (child.connected) child.send({ kind: 'shutdown' }, error => {
      if (error && child.connected) child.disconnect();
    });
    const status = await Promise.race([closed, pause(commandTimeoutMs, null, { ref: false })]);
    if (!status) {
      child.kill('SIGKILL');
      await closed;
      throw new Error('Isolated audit wallet failed to stop');
    }
    if (status.code !== 0) throw new Error('Isolated audit wallet stopped unsuccessfully');
  })();
  const cancel = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const receive = (abort: AbortSignal) => Promise.race([
    once(child, 'message', { signal: abort }).then(([value]) => value as Reply),
    closed.then(() => undefined),
  ]);
  const deadline = (finished: AbortController) => AbortSignal.any([
    finished.signal, AbortSignal.timeout(commandTimeoutMs), ...(signal ? [signal] : []),
  ]);
  const startup = new AbortController();
  let port: number;
  try {
    const ready = await receive(deadline(startup));
    if (ready?.kind !== 'ready' || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65_535) {
      throw new Error('Isolated audit wallet failed to start');
    }
    port = ready.port;
  } catch (error) {
    await close().catch(() => {});
    throw error;
  } finally { startup.abort(); }
  let pending = false, lastId = 0;
  const run = async (command: Command) => {
    signal?.throwIfAborted();
    if (pending || closing || !child.connected) throw new Error('Isolated audit wallet command is unavailable');
    pending = true;
    const id = ++lastId, finished = new AbortController();
    try {
      const [reply] = await Promise.all([receive(deadline(finished)), new Promise<void>((done, reject) => {
        child.send({ ...command, id }, error => { if (error) reject(error); else done(); });
      })]);
      if (reply?.kind !== 'result' || reply.id !== id || reply.ok !== true) {
        throw new Error('Isolated audit wallet command failed');
      }
    } finally { finished.abort(); pending = false; }
  };
  return {
    baseUrl: 'http://127.0.0.1:' + port,
    startCapture: (datasetId: string) => run({ kind: 'start', datasetId }),
    stopCapture: () => run({ kind: 'stop' }),
    close,
  };
}

if (process.send && process.argv[1] && resolve(process.argv[1]) === file) {
  await serve().catch(() => { process.exitCode = 1; if (process.connected) process.disconnect?.(); });
}
