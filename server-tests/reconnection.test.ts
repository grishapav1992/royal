import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, MatchMakeError, Room } from '@colyseus/sdk';
import { configureReconnection, matchmakingError } from '../src/network/reconnection';

test('reconnection retry timers fit within the 20 second seat reservation and keep SDK state', () => {
  const room = new Room('lobby'), settings = room.reconnection;
  const queue = settings.enqueuedMessages;
  settings.enabled = false;
  configureReconnection(settings, () => 1);
  let maximumWait = 0;
  assert.equal(settings.minUptime, 0);
  assert(settings.maxRetries > 0 && settings.maxRetries <= 8);
  for (let attempt = 1; attempt <= settings.maxRetries; attempt++) {
    const backoff = settings.backoff(attempt, settings.delay);
    const scheduled = Math.min(settings.maxDelay, Math.max(settings.minDelay, backoff));
    assert(scheduled >= 150 && scheduled <= 3000);
    maximumWait += scheduled;
  }
  assert(maximumWait < 20000, 'Retry timers must leave room for handshake time');
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
