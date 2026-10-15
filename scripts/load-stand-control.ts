import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { MAX_STAND_SESSION_MS } from './load-stand-limits';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CLOSE_TIMEOUT_MS = 2000;
export type StandAbortCode = 'generator-aborted' | 'connection-lost' | 'expired' | 'closed' | 'signal-aborted' | 'timeout';
export class StandControlError extends Error {
  constructor(readonly code: StandAbortCode) { super(`stand-${code}`); this.name = 'StandControlError'; }
}
export type StandControlOptions<TPrepared, TResults> = {
  runId: string;
  secret: string;
  expiresAt: number;
  status?: Record<string, unknown>;
  onAbort: (code: StandAbortCode) => void;
  validatePrepared: (body: unknown) => TPrepared;
  validateResults: (body: unknown) => TResults;
  signal?: AbortSignal;
};
export type StandControl<TPrepared, TResults> = {
  port: number;
  prepared: Promise<TPrepared>;
  results: Promise<TResults>;
  start(): void;
  publish(report: object): Promise<void>;
  close(): Promise<void>;
};
type Phase = 'waiting' | 'prepared' | 'running' | 'results' | 'published' | 'aborted';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // The owner may still be setting up workers when a peer disconnects.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) throw new TypeError('invalid-stand-response');
  return encoded;
}
function statusSnapshot(status: Record<string, unknown> = {}) {
  const encoded = json(status);
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/(secret|token|authorization|cookie|password)/i.test(key)) throw new TypeError('sensitive-stand-status');
      visit(item);
    }
  };
  visit(parsed);
  return parsed;
}
class BodyError extends Error { constructor(readonly status: number) { super('invalid-stand-request'); } }
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const length = request.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new BodyError(413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new BodyError(413);
    chunks.push(bytes);
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyError(400);
    return body as Record<string, unknown>;
  } catch { throw new BodyError(400); }
}

/** A private loopback barrier for one isolated load-test generator. */
export async function createStandControl<TPrepared, TResults>(options: StandControlOptions<TPrepared, TResults>): Promise<StandControl<TPrepared, TResults>> {
  const now = Date.now();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.runId) || !/^[a-f0-9]{64}$/.test(options.secret)
    || !Number.isSafeInteger(options.expiresAt) || options.expiresAt <= now || options.expiresAt > now + MAX_STAND_SESSION_MS)
    throw new TypeError('invalid-stand-control-options');
  if (options.signal?.aborted) throw new StandControlError('signal-aborted');
  const secretBytes = Buffer.from(options.secret, 'hex');
  const status = json({ ...statusSnapshot(options.status), protocol: 1, role: 'isolated-test-stand', runId: options.runId, expiresAt: options.expiresAt });
  const prepared = deferred<TPrepared>(), results = deferred<TResults>();
  const sockets = new Set<Socket>(), held = new Set<ServerResponse>();
  let phase: Phase = 'waiting', abortCode: StandAbortCode | undefined, closing: Promise<void> | undefined, publishing: Promise<void> | undefined;
  let preparedResponse: ServerResponse | undefined, resultsResponse: ServerResponse | undefined;
  const send = (response: ServerResponse, statusCode: number, body: string, endConnection = false) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      ...(endConnection ? { connection: 'close' } : {}) });
    if (endConnection) response.once('finish', () => response.socket?.destroySoon());
    response.end(body);
  };
  const fail = (response: ServerResponse, statusCode: number) => send(response, statusCode, json({ error: 'stand-request-rejected' }), true);
  const abort = (code: StandAbortCode) => {
    if (phase === 'aborted' || phase === 'published') return;
    phase = 'aborted'; abortCode = code;
    prepared.reject(new StandControlError(code)); results.reject(new StandControlError(code));
    for (const response of held) {
      if (response.writableEnded && !response.writableFinished) response.destroy();
      else send(response, code === 'expired' ? 410 : 503, json({ error: `stand-${code}` }), true);
    }
    held.clear(); preparedResponse = undefined; resultsResponse = undefined;
    try { options.onAbort(code); } catch { /* Cleanup must also succeed if the owner's callback throws. */ }
  };
  const hold = (response: ServerResponse) => {
    held.add(response);
    response.once('close', () => { if (held.has(response) && !response.writableFinished) abort('connection-lost'); });
  };
  const authorized = (request: IncomingMessage) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(header)) return false;
    if (request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'authorization').length !== 1) return false;
    return timingSafeEqual(Buffer.from(header.slice(7), 'hex'), secretBytes);
  };
  const unavailable = () => Boolean(closing) || phase === 'aborted';
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (!authorized(request)) { fail(response, 401); return; }
    if (Date.now() >= options.expiresAt) { abort('expired'); fail(response, 410); return; }
    if (unavailable()) { fail(response, 503); return; }
    const path = request.url;
    if (!['/status', '/prepared', '/results', '/abort'].includes(path ?? '')) { fail(response, 404); return; }
    if (request.method !== (path === '/status' ? 'GET' : 'POST')) { fail(response, 405); return; }
    if (path === '/status') { send(response, 200, status); return; }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) { fail(response, 415); return; }
    const body = await readBody(request);
    if (response.destroyed) return;
    if (body.runId !== options.runId) { fail(response, 400); return; }
    // Parsing yields to other requests, so admission must be checked again here.
    if (Date.now() >= options.expiresAt) { abort('expired'); fail(response, 410); return; }
    if (unavailable()) { fail(response, 503); return; }
    if (path === '/abort') {
      if (body.code !== 'generator-aborted' || Object.keys(body).some(key => !['runId', 'code'].includes(key))) { fail(response, 400); return; }
      if (phase === 'published') { fail(response, 409); return; }
      send(response, 200, json({ runId: options.runId, aborted: true }));
      abort('generator-aborted'); return;
    }
    if (path === '/prepared') {
      if (phase !== 'waiting') { fail(response, 409); return; }
      let value: TPrepared;
      try { value = options.validatePrepared(body); } catch { fail(response, 400); return; }
      phase = 'prepared'; preparedResponse = response; hold(response); prepared.resolve(value); return;
    }
    if (phase !== 'running') { fail(response, 409); return; }
    let value: TResults;
    try { value = options.validateResults(body); } catch { fail(response, 400); return; }
    phase = 'results'; resultsResponse = response; hold(response); results.resolve(value);
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch(error => fail(response, error instanceof BodyError ? error.status : 400));
  });
  server.maxConnections = 32;
  server.headersTimeout = 15000;
  server.requestTimeout = MAX_STAND_SESSION_MS;
  server.setTimeout(MAX_STAND_SESSION_MS, socket => {
    if ([...held].some(response => response.socket === socket)) abort('timeout');
    socket.destroy();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const onSignal = () => abort('signal-aborted');
  options.signal?.addEventListener('abort', onSignal, { once: true });
  const expiry = setTimeout(() => abort('expired'), options.expiresAt - Date.now());
  expiry.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
  } catch {
    clearTimeout(expiry); options.signal?.removeEventListener('abort', onSignal);
    for (const socket of sockets) socket.destroy();
    throw new Error('stand-control-listen-failed');
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stand-control-listen-failed');
  return {
    port: address.port, prepared: prepared.promise, results: results.promise,
    start() {
      if (Date.now() >= options.expiresAt) abort('expired');
      if (phase === 'aborted' || closing) throw new StandControlError(abortCode ?? 'closed');
      if (phase === 'running' || phase === 'results' || phase === 'published') return;
      if (phase !== 'prepared' || !preparedResponse) throw new Error('stand-not-prepared');
      if (preparedResponse.destroyed) { abort('connection-lost'); throw new StandControlError('connection-lost'); }
      const response = preparedResponse;
      held.delete(response); preparedResponse = undefined; phase = 'running';
      send(response, 200, json({ start: true, runId: options.runId }));
    },
    publish(report) {
      if (publishing) return publishing;
      // A failed admission has no results response to publish to.
      if (!resultsResponse) return Promise.resolve();
      if (Date.now() >= options.expiresAt) abort('expired');
      if (phase === 'aborted' || closing) return Promise.reject(new StandControlError(abortCode ?? 'closed'));
      if (phase !== 'results') return Promise.reject(new Error('stand-results-not-ready'));
      const encoded = json({ runId: options.runId, report });
      if (resultsResponse.destroyed) { abort('connection-lost'); return Promise.reject(new StandControlError('connection-lost')); }
      const response = resultsResponse;
      publishing = new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          response.removeListener('finish', onFinish); response.removeListener('close', onClose);
          if (error) reject(error); else resolve();
        };
        const onFinish = () => {
          held.delete(response); resultsResponse = undefined;
          if (phase === 'aborted') { finish(new StandControlError(abortCode!)); return; }
          phase = 'published'; finish();
        };
        const onClose = () => { if (!response.writableFinished) { abort('connection-lost'); finish(new StandControlError(abortCode ?? 'connection-lost')); } };
        const timer = setTimeout(() => { abort('timeout'); response.destroy(); finish(new StandControlError(abortCode ?? 'timeout')); }, Math.max(1, Math.min(MAX_STAND_SESSION_MS, options.expiresAt - Date.now())));
        timer.unref();
        response.once('finish', onFinish); response.once('close', onClose);
        send(response, 200, encoded);
      });
      void publishing.catch(() => {});
      return publishing;
    },
    close() {
      if (closing) return closing;
      let done!: () => void;
      closing = new Promise<void>(resolve => { done = resolve; });
      abort('closed'); clearTimeout(expiry); options.signal?.removeEventListener('abort', onSignal);
      const timer = setTimeout(() => { for (const socket of sockets) socket.destroy(); done(); }, CLOSE_TIMEOUT_MS);
      timer.unref();
      server.close(() => { clearTimeout(timer); done(); });
      for (const socket of sockets) socket.end();
      return closing;
    },
  };
}
