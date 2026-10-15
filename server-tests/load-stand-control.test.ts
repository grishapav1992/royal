import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Agent, createServer, request, type RequestOptions } from 'node:http';
import { createConnection } from 'node:net';
import { test } from 'node:test';
import { createStandControl, StandControlError, type StandAbortCode, type StandControl, type StandControlOptions } from '../scripts/load-stand-control';
import { MAX_STAND_SESSION_MS } from '../scripts/load-stand-limits';

const runId = '11111111-2222-3333-4444-555555555555', secret = 'ab'.repeat(32);
type Prepared = { runId: string; ready: number[] };
type Results = { runId: string; total: number };
type Control = StandControl<Prepared, Results>;
function options(overrides: Partial<StandControlOptions<Prepared, Results>> = {}) {
  const aborts: StandAbortCode[] = [];
  const config: StandControlOptions<Prepared, Results> = {
    runId, secret, expiresAt: Date.now() + 10000, onAbort: code => { aborts.push(code); },
    validatePrepared(body) {
      const parsed = body as Prepared;
      if (!Array.isArray(parsed.ready) || !parsed.ready.length || parsed.ready.some(item => typeof item !== 'number')) throw new Error('private-validator-details');
      return { runId: parsed.runId, ready: [...parsed.ready] };
    },
    validateResults(body) {
      const parsed = body as Results;
      if (!Number.isSafeInteger(parsed.total) || parsed.total < 0) throw new Error('private-validator-details');
      return { runId: parsed.runId, total: parsed.total };
    }, ...overrides,
  };
  return { config, aborts };
}
function begin(port: number, path: string, body?: unknown, extra: RequestOptions = {}) {
  const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  let resolve!: (result: { status: number; body: any }) => void, reject!: (error: Error) => void;
  const response = new Promise<{ status: number; body: any }>((yes, no) => { resolve = yes; reject = no; });
  void response.catch(() => {});
  const req = request({ hostname: '127.0.0.1', port, path, method: data === undefined ? 'GET' : 'POST', ...extra,
    headers: { authorization: `Bearer ${secret}`, ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...extra.headers } }, res => {
    const chunks: Buffer[] = [];
    res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
    res.once('end', () => {
      try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error as Error); }
    });
  });
  req.once('error', reject); req.end(data);
  return { request: req, response };
}
async function make(overrides: Partial<StandControlOptions<Prepared, Results>> = {}) {
  const setup = options(overrides);
  return { ...setup, control: await createStandControl(setup.config) };
}
const preparedBody = { runId, ready: [1, 2] }, resultsBody = { runId, total: 3 };
const errorCode = (code: StandAbortCode) => (error: unknown) => error instanceof StandControlError && error.code === code;

test('status authenticates exactly and fixes attestation fields without exposing credentials', { timeout: 5000 }, async t => {
  const metadata = { protocol: 9, role: 'wrong-role', runId: 'wrong-run', expiresAt: 0, clients: 1000, bundleSha256: 'cd'.repeat(32), serverHost: { platform: 'test' } };
  const { control, config, aborts } = await make({ status: metadata });
  t.after(() => control.close());
  metadata.clients = 999;
  const status = await begin(control.port, '/status').response;
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { ...metadata, clients: 1000, protocol: 1, role: 'isolated-test-stand', runId, expiresAt: config.expiresAt });
  assert(!JSON.stringify(status.body).includes(secret));
  for (const authorization of ['', `Bearer ${'00'.repeat(32)}`, `bearer ${secret}`, `Bearer ${secret.toUpperCase()}`, `Bearer  ${secret}`, [`Bearer ${secret}`, `Bearer ${secret}`]]) {
    assert.equal((await begin(control.port, '/status', undefined, { headers: { authorization: authorization as string } }).response).status, 401);
  }
  assert.deepEqual(aborts, []);
});

test('invalid methods, routes, content types, run IDs and validator data cannot occupy the barrier', { timeout: 5000 }, async t => {
  const { control } = await make(); t.after(() => control.close());
  for (const [path, body, extra, status] of [
    ['/status', {}, {}, 405], ['/prepared', undefined, {}, 405], ['/status?x=1', undefined, {}, 404], ['/other', undefined, {}, 404],
    ['/prepared', preparedBody, { headers: { 'content-type': 'text/plain' } }, 415],
    ['/prepared', { ...preparedBody, runId: 'other-run' }, {}, 400], ['/prepared', [], {}, 400], ['/prepared', '{', {}, 400],
    ['/prepared', { runId, ready: [] }, {}, 400], ['/results', resultsBody, {}, 409],
  ] as const) {
    const result = await begin(control.port, path, body, extra).response;
    assert.equal(result.status, status, path); assert.deepEqual(result.body, { error: 'stand-request-rejected' });
  }
  assert.throws(() => control.start(), /stand-not-prepared/);
  await control.publish({ failed: true });
  const waiting = begin(control.port, '/prepared', preparedBody);
  assert.deepEqual(await control.prepared, preparedBody);
  control.start(); assert.equal((await waiting.response).status, 200);
});

test('both advertised and streamed oversized bodies are rejected without poisoning the session', { timeout: 5000 }, async t => {
  const { control } = await make(); t.after(() => control.close());
  assert.equal((await begin(control.port, '/prepared', '', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }).response).status, 413);
  assert.equal((await begin(control.port, '/prepared', 'x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'transfer-encoding': 'chunked' } }).response).status, 413);
  const waiting = begin(control.port, '/prepared', preparedBody); await control.prepared;
  control.start(); assert.equal((await waiting.response).status, 200);
});

test('concurrent preparations admit exactly one and keep the first start barrier intact', { timeout: 5000 }, async t => {
  const { control, aborts } = await make(); t.after(() => control.close());
  const waiting = Array.from({ length: 8 }, () => begin(control.port, '/prepared', preparedBody));
  await control.prepared;
  let completed = 0;
  for (const item of waiting) void item.response.then(() => completed++);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(completed, 7);
  assert.equal((await begin(control.port, '/results', resultsBody).response).status, 409);
  control.start(); control.start();
  assert.deepEqual((await Promise.all(waiting.map(item => item.response))).map(item => item.status).sort(), [200, 409, 409, 409, 409, 409, 409, 409]);
  assert.deepEqual(aborts, []);
});

test('results are validated once, wait for publication, and flush before immediate shutdown', { timeout: 5000 }, async t => {
  const { control, aborts } = await make(); t.after(() => control.close());
  const ready = begin(control.port, '/prepared', preparedBody); await control.prepared;
  let readyCompleted = false; void ready.response.then(() => { readyCompleted = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(readyCompleted, false);
  control.start(); assert.deepEqual((await ready.response).body, { start: true, runId });
  assert.equal((await begin(control.port, '/prepared', preparedBody).response).status, 409);
  assert.equal((await begin(control.port, '/results', { runId, total: -1 }).response).status, 400);
  const finished = begin(control.port, '/results', resultsBody); assert.deepEqual(await control.results, resultsBody);
  assert.equal((await begin(control.port, '/results', resultsBody).response).status, 409);
  let finishedCompleted = false; void finished.response.then(() => { finishedCompleted = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finishedCompleted, false);
  const report = { ok: true, padding: 'x'.repeat(3 * 1024 * 1024) };
  await control.publish(report); await control.close();
  assert.deepEqual(await finished.response, { status: 200, body: { runId, report } });
  assert.deepEqual(aborts, []);
});

test('losing the held preparation cancels remaining promises and notifies the owner once', { timeout: 5000 }, async t => {
  const { control, aborts } = await make(); t.after(() => control.close());
  const ready = begin(control.port, '/prepared', preparedBody); await control.prepared;
  ready.request.destroy(); await assert.rejects(ready.response);
  await assert.rejects(control.results, errorCode('connection-lost'));
  assert.deepEqual(aborts, ['connection-lost']);
  assert.throws(() => control.start(), errorCode('connection-lost'));
  await control.publish({ failed: true }); await control.close(); assert.deepEqual(aborts, ['connection-lost']);
});

test('losing the held results notifies the owner before cleanup publication', { timeout: 5000 }, async t => {
  const { control, aborts } = await make(); t.after(() => control.close());
  const ready = begin(control.port, '/prepared', preparedBody); await control.prepared; control.start(); await ready.response;
  const finished = begin(control.port, '/results', resultsBody); await control.results;
  finished.request.destroy(); await assert.rejects(finished.response);
  for (let attempt = 0; !aborts.length && attempt < 20; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(aborts, ['connection-lost']);
  await control.publish({ failed: true });
});

test('only a fixed abort payload is accepted and errors contain no supplied private data', { timeout: 5000 }, async t => {
  const { control, aborts } = await make(); t.after(() => control.close());
  assert.equal((await begin(control.port, '/abort', { runId, code: 'private-failure-details' }).response).status, 400);
  assert.equal((await begin(control.port, '/abort', { runId, code: 'generator-aborted', details: secret }).response).status, 400);
  const aborted = await begin(control.port, '/abort', { runId, code: 'generator-aborted' }).response;
  assert.deepEqual(aborted, { status: 200, body: { runId, aborted: true } });
  await assert.rejects(control.prepared, errorCode('generator-aborted')); await assert.rejects(control.results, errorCode('generator-aborted'));
  assert.deepEqual(aborts, ['generator-aborted']);
});

test('expiry rejects waiting work and returns an authenticated expired status', { timeout: 5000 }, async t => {
  const { control, aborts } = await make({ expiresAt: Date.now() + 80 }); t.after(() => control.close());
  const ready = begin(control.port, '/prepared', preparedBody); await control.prepared;
  await assert.rejects(control.results, errorCode('expired'));
  assert.equal((await ready.response).status, 410);
  assert.equal((await begin(control.port, '/status').response).status, 410);
  assert.deepEqual(aborts, ['expired']);
});

test('AbortSignal cancels promises and rechecks a body that was still being read', { timeout: 5000 }, async t => {
  const signal = new AbortController(), { control, aborts } = await make({ signal: signal.signal }); t.after(() => control.close());
  const req = request({ hostname: '127.0.0.1', port: control.port, path: '/prepared', method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' } });
  req.on('error', () => {});
  const reply = new Promise<number>((resolve, reject) => {
    req.once('response', response => { response.resume(); response.once('end', () => resolve(response.statusCode!)); }); req.once('error', reject);
  });
  void reply.catch(() => {});
  req.write('{"runId":'); await once(req, 'socket');
  signal.abort(); req.end(`${JSON.stringify(runId)},"ready":[1]}`);
  await assert.rejects(control.prepared, errorCode('signal-aborted')); await assert.rejects(control.results, errorCode('signal-aborted'));
  assert.equal(await reply, 503); assert.deepEqual(aborts, ['signal-aborted']);
});

test('close releases held and idle sockets, is idempotent, and leaves unrelated listeners usable', { timeout: 5000 }, async t => {
  const { control, aborts } = await make(); t.after(() => control.close());
  const unrelated = createServer((_req, res) => res.end('{}'));
  unrelated.listen(0, '127.0.0.1'); await once(unrelated, 'listening');
  t.after(() => new Promise<void>(resolve => unrelated.close(() => resolve())));
  const agent = new Agent({ keepAlive: true }); t.after(() => agent.destroy());
  assert.equal((await begin(control.port, '/status', undefined, { agent }).response).status, 200);
  const idle = createConnection({ host: '127.0.0.1', port: control.port }); idle.on('error', () => {}); await once(idle, 'connect');
  const idleClosed = once(idle, 'close');
  const ready = begin(control.port, '/prepared', preparedBody); await control.prepared;
  const first = control.close(); assert.equal(control.close(), first); await first; await idleClosed;
  assert.equal((await ready.response).status, 503);
  await assert.rejects(control.results, errorCode('closed')); assert.deepEqual(aborts, ['closed']);
  const address = unrelated.address(); assert(address && typeof address !== 'string');
  assert.equal((await begin(address.port, '/status').response).status, 200);
  await assert.rejects(begin(control.port, '/status').response);
});

test('invalid options and sensitive metadata fail before opening any listener', async () => {
  for (const overrides of [{ secret: 'wrong' }, { secret: secret.toUpperCase() }, { runId: '../other' }, { expiresAt: Date.now() - 1 },
    { expiresAt: Date.now() + MAX_STAND_SESSION_MS + 60000 }, { status: { nested: { tokens: ['private'] } } }]) {
    await assert.rejects(createStandControl(options(overrides).config), TypeError);
  }
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(createStandControl(options({ signal: aborted.signal }).config), errorCode('signal-aborted'));
});

test('a bounded long-run control session accepts a forty-minute lifetime without waiting for it', { timeout: 5000 }, async t => {
  const expiresAt = Date.now() + MAX_STAND_SESSION_MS - 1000;
  const { control } = await make({ expiresAt }); t.after(() => control.close());
  const response = await begin(control.port, '/status').response;
  assert.equal(response.status, 200); assert.equal(response.body.expiresAt, expiresAt);
  await control.close(); await assert.rejects(control.prepared, errorCode('closed')); await assert.rejects(control.results, errorCode('closed'));
});

test('close releases a half-open peer whether FIN or a forced reset reaches it first', { timeout: 5000 }, async t => {
  const { control } = await make(); t.after(() => control.close());
  const peer = createConnection({ host: '127.0.0.1', port: control.port, allowHalfOpen: true });
  peer.on('error', () => {}); peer.resume(); t.after(() => peer.destroy()); await once(peer, 'connect');
  const released = new Promise<'fin' | 'closed' | 'reset'>((resolve, reject) => {
    const cleanup = () => { peer.off('end', onEnd); peer.off('close', onClose); peer.off('error', onError); };
    const onEnd = () => { cleanup(); resolve('fin'); };
    const onClose = () => { cleanup(); resolve('closed'); };
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup(); if (error.code === 'ECONNRESET') resolve('reset'); else reject(error);
    };
    peer.once('end', onEnd); peer.once('close', onClose); peer.once('error', onError);
  });
  const started = performance.now(), closed = control.close(), disposition = await released;
  // A peer that receives FIN preserves its half-open write side; an immediate reset already released it.
  if (disposition === 'fin' && !peer.destroyed) assert.equal(peer.writable, true);
  await closed; assert(performance.now() - started < 2500);
  await assert.rejects(begin(control.port, '/status').response);
  await assert.rejects(control.prepared, errorCode('closed')); await assert.rejects(control.results, errorCode('closed'));
});

test('an owner callback can reenter close or throw without leaking work or private errors', { timeout: 5000 }, async () => {
  let control!: Control, callbacks = 0;
  control = await createStandControl(options({ onAbort() { callbacks++; void control.close(); throw new Error(secret); } }).config);
  await control.close();
  await assert.rejects(control.prepared, errorCode('closed')); await assert.rejects(control.results, errorCode('closed'));
  assert.equal(callbacks, 1); await assert.rejects(begin(control.port, '/status').response);
});
