import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, MatchMakeError, Room } from '@colyseus/sdk';
import { configureReconnection, matchmakingError, lobbyMatchmakingFetch } from '../src/network/reconnection';

test('reconnection retry timers fit within the 90 second seat reservation and keep SDK state', () => {
  const room = new Room('lobby'), settings = room.reconnection;
  const queue = settings.enqueuedMessages;
  settings.enabled = false;
  configureReconnection(settings, () => 1);
  let maximumWait = 0;
  assert.equal(settings.minUptime, 0);
  assert(settings.maxRetries > 0 && settings.maxRetries <= 20);
  for (let attempt = 1; attempt <= settings.maxRetries; attempt++) {
    const backoff = settings.backoff(attempt, settings.delay);
    const scheduled = Math.min(settings.maxDelay, Math.max(settings.minDelay, backoff));
    assert(scheduled >= 250 && scheduled <= 3000);
    maximumWait += scheduled;
  }
  assert(maximumWait < 60000, 'Retry timers must leave room for handshake time');
  assert.equal(settings.enabled, false);
  assert.equal(settings.enqueuedMessages, queue);
});

test('clients spread their first retry and later capped retries over different times', () => {
  for (const attempt of [1, 4, 8]) {
    const scheduled = new Set<number>();
    for (let index = 0; index < 1000; index++) {
      const settings = new Room('lobby').reconnection;
      configureReconnection(settings, () => index / 1000);
      const delay = Math.min(settings.maxDelay, Math.max(settings.minDelay, settings.backoff(attempt, settings.delay)));
      assert(delay >= settings.minDelay && delay <= settings.maxDelay);
      scheduled.add(delay);
    }
    assert(scheduled.size >= 200, 'A shared outage must not schedule all clients at one retry time');
  }
});

test('SDK matchmaking busy responses keep their code, explain the refusal and do not retry entry', async () => {
  for (const code of [429, 503]) {
    let requests = 0;
    const client = new Client('http://127.0.0.1:2567', { fetchFn: async () => {
      requests++;
      return new Response(JSON.stringify({ code, error: 'Busy' }), { status: code, headers: { 'Content-Type': 'application/json' } });
    } });
    await assert.rejects(client.joinOrCreate('lobby').catch(error => { throw matchmakingError(error); }), error => {
      assert(error instanceof MatchMakeError);
      assert.equal(error.code, code);
      assert.match(error.message, /Подожди/);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('authorization, bans, missing rooms and network errors preserve the original error', () => {
  for (const code of [401, 403, 4003, 4212, 'ECONNREFUSED']) {
    const error = Object.assign(new Error('Original reason'), { code });
    assert.equal(matchmakingError(error), error);
  }
  for (const error of [undefined, null, 'failure']) assert.equal(matchmakingError(error), error);
});

test('a stalled matchmaking request is aborted once without changing credentials or retrying', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  context.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit) => {
    calls++; assert.equal(init.credentials, 'include'); assert.equal(init.method, 'POST');
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const pending = assert.rejects(lobbyMatchmakingFetch('http://fixture/matchmake', { method: 'POST', credentials: 'include' }), { name: 'AbortError' });
  context.mock.timers.tick(10000); await pending; assert.equal(calls, 1);
});

test('an external cancellation stops matchmaking promptly and cancels its deadline timer', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let aborts = 0;
  context.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => { aborts++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  }));
  const pending = assert.rejects(lobbyMatchmakingFetch('http://fixture/matchmake', { signal: controller.signal }), { name: 'AbortError' });
  controller.abort(); await pending; context.mock.timers.tick(10000); assert.equal(aborts, 1);
});

test('the matchmaking deadline also covers a response body that stalls after headers', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const stream = new ReadableStream({ start(controller) {
      init.signal!.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } });
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  });
  const pending = assert.rejects(lobbyMatchmakingFetch('http://fixture/matchmake'), { name: 'AbortError' });
  await Promise.resolve(); context.mock.timers.tick(10000); await pending;
});
