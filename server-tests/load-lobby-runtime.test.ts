import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import type { LobbyState } from '../server/state';
import { isolatedLoadLobbyEnvironment, parseLoadLobbyConfig } from '../scripts/load-lobby-config';
import { liveLoadLobbyProcesses, loadLobbyLeaseKey, LoadLobbyOwnerLease, parseReadyProcess, READY_PROCESSES_KEY,
  selectLoadLobbyProcess } from '../scripts/load-lobby-owners';
import { boundedLoadLobbyRoom, LoadLobbyTransport, loadLobbyRoutes } from '../scripts/load-lobby-room';
import { LOAD_RUN_REDIS_KEY } from '../scripts/load-stand-ownership';

test('stand config binds worker roles and accepts only the temporary loopback services', () => {
  const env = { NODE_ENV: 'test', PGHOST: '127.0.0.1', PGDATABASE: 'royal_test', PGUSER: 'postgres', PGSSLMODE: 'disable',
    PGPASSWORD: 'a'.repeat(64), PGPORT: '35001', AUTH_DB_PATH: 'royal_websocket_load', PGPOOL_MAX: '6', LOAD_LOBBY_RUN_ID: randomUUID(),
    LOBBY_WORKER_ID: 'worker-35', LOBBY_WORKER_ONLY: 'true', REDIS_URL: 'redis://127.0.0.1:35002',
    PUBLIC_ORIGIN: 'http://127.0.0.1:35003', PORT: '35004', NOWPAYMENTS_API_KEY: 'omitted-fixture' };
  const config = parseLoadLobbyConfig(env);
  assert.equal(config.publicAddress, '127.0.0.1:35003/workers/worker-35');
  assert.equal(config.maxAuthWork, 4);
  const sanitized = isolatedLoadLobbyEnvironment(config, env);
  assert.equal(sanitized.NOWPAYMENTS_API_KEY, undefined);
  assert.equal(sanitized.NOWPAYMENTS_ENABLED, 'false');
  for (const override of [{ NODE_ENV: 'production' }, { PGHOST: 'localhost' }, { PGDATABASE: 'royal_game' },
    { DATABASE_URL: 'postgresql://other.invalid' }, { LOAD_LOBBY_RUN_ID: undefined }, { LOBBY_WORKER_ONLY: 'false' },
    { LOBBY_WORKER_ID: 'worker-36' }, { REDIS_URL: 'redis://127.0.0.1:35002/1' },
    { REDIS_URL: 'redis://localhost:35002' }, { PUBLIC_ORIGIN: 'https://example.invalid' }, { PORT: '35001' }, { PGPOOL_MAX: '50' }]) {
    assert.throws(() => parseLoadLobbyConfig({ ...env, ...override }));
  }
});

class RedisFixture {
  readonly values = new Map<string, string>();
  readonly ready = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async hgetall(key: string) { assert.equal(key, READY_PROCESSES_KEY); return Object.fromEntries(this.ready); }
  async eval(script: string, keys: number, ...input: string[]) {
    const [marker, lease] = input, [runId, owner, processId, registration, ...rest] = input.slice(keys);
    if (this.values.get(marker) !== runId) return 0;
    if (script.startsWith('-- claim owner')) {
      if (this.values.has(lease)) return 0;
      this.values.set(lease, owner); return 1;
    }
    if (this.values.get(lease) !== owner) return 0;
    if (script.startsWith('-- register owner')) {
      if (this.ready.has(processId) && this.ready.get(processId) !== registration) return 0;
      for (const id of rest) this.ready.delete(id);
      this.ready.set(processId, registration); return 1;
    }
    if (script.startsWith('-- verify owner')) return Number(!processId || this.ready.get(processId) === registration);
    assert(script.startsWith('-- release owner'));
    if (this.ready.get(processId) === registration) this.ready.delete(processId);
    this.values.delete(lease); return 1;
  }
  async channels() { return ['p:main-id', 'p:worker-id', 'p:stale-id']; }
}

test('Redis readiness requires the run marker, unique worker lease and current registration', async t => {
  const redis = new RedisFixture(), runId = randomUUID();
  let lost = 0;
  const main = new LoadLobbyOwnerLease(redis, runId, 'main', () => { lost++; });
  const duplicate = new LoadLobbyOwnerLease(redis, runId, 'main', () => {});
  const worker = new LoadLobbyOwnerLease(redis, runId, 'worker-1', () => {});
  t.after(async () => { await Promise.all([main.close(), duplicate.close(), worker.close()]); });
  await assert.rejects(main.start(), /load-lobby-owner-lease-refused/);
  assert.equal(redis.values.size, 0);
  redis.values.set(LOAD_RUN_REDIS_KEY, runId);
  redis.ready.set('stale-id', JSON.stringify({ workerId: 'main', owner: randomUUID() }));
  await main.start();
  assert.equal(main.ready, false);
  await assert.rejects(duplicate.start(), /load-lobby-owner-lease-refused/);
  await main.activate('main-id');
  assert.equal(await main.checkReady(), true);
  assert.equal(redis.ready.has('stale-id'), false);
  assert.equal(parseReadyProcess(redis.ready.get('main-id'))?.workerId, 'main');
  await worker.start(); await worker.activate('worker-id');
  redis.ready.set('stale-id', JSON.stringify({ workerId: 'worker-2', owner: randomUUID() }));
  const stats = async () => ['main-id', 'worker-id', 'stale-id'].map(processId => ({ processId, roomCount: 0 }));
  assert.deepEqual((await liveLoadLobbyProcesses(redis, stats)).map(row => row.processId), ['main-id', 'worker-id']);
  const replacement = randomUUID();
  redis.values.set(loadLobbyLeaseKey('main'), replacement);
  assert.equal(await main.checkReady(), false);
  assert.equal(await main.checkReady(), false);
  assert.equal(lost, 1);
  await main.close();
  assert.equal(redis.values.get(loadLobbyLeaseKey('main')), replacement);
  await worker.close();
  assert.equal(redis.ready.has('worker-id'), false);
});

test('owner selection balances provisional rooms and enforces the room cap before stats catch up', async () => {
  let now = 0;
  const stats = [{ processId: 'a', roomCount: 0 }, { processId: 'b', roomCount: 0 }];
  const select = selectLoadLobbyProcess(async () => stats, () => now);
  const picks = await Promise.all(Array.from({ length: 20 }, () => select()));
  assert.deepEqual(picks, Array.from({ length: 20 }, (_, index) => index % 2 ? 'b' : 'a'));
  await assert.rejects(select(), /load-lobby-owner-unavailable/);
  now = 5_001;
  assert.equal(await select(), 'a');
});

test('stand room and transport admit a real test player and acknowledge movement', { timeout: 20_000 }, async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.PGDATABASE, 'royal_test');
  const [{ accounts, cookieToken }, { LobbyRoom }] = await Promise.all([import('../server/accounts'), import('../server/LobbyRoom')]);
  await accounts.ready;
  let closeLobby: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await closeLobby?.(); }
    finally { await accounts.close(); }
  });
  const login = await accounts.login(`load-lobby-${randomUUID()}@example.test`, 'Synthetic-load-test-123!');
  await accounts.select(login.account.id, 0);
  let ready = false;
  const transport = new LoadLobbyTransport(() => ready);
  const server = defineServer({ transport, routes: loadLobbyRoutes(false, () => ready, cookieToken),
    rooms: { lobby: defineRoom(boundedLoadLobbyRoom(LobbyRoom, () => ready, 4)) }, greet: false, gracefullyShutdown: false });
  closeLobby = async () => { transport.disconnectClients(); await server.gracefullyShutdown(false); transport.shutdown(); };
  await server.listen(0, '127.0.0.1');
  const address = transport.server!.address(); assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const headers = { Cookie: `royal_session=${login.token}` };
  const matchmaking = (extra: Record<string, string> = {}) => fetch(`${endpoint}/matchmake/joinOrCreate/lobby`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extra }, body: '{}' });
  assert.equal((await matchmaking()).status, 503);
  ready = true;
  assert.equal((await matchmaking({ Origin: 'https://outside.invalid' })).status, 403);
  const room = await new Client(endpoint, { headers }).joinOrCreate<LobbyState>('lobby', { activityProtocol: 1 });
  room.reconnection.enabled = false;
  room.onMessage('*', () => {});
  assert(matchMaker.getLocalRoomById(room.roomId) instanceof LobbyRoom);
  const until = performance.now() + 3_000;
  while (!room.state?.players?.get(room.sessionId) && performance.now() < until) await delay(20);
  const player = room.state?.players?.get(room.sessionId); assert(player);
  room.send('inputs', { revision: player.hallRevision, inputs: [{ seq: 1, x: 1, y: 0, ms: 1000 / 60 }] });
  while (player.inputSeq < 1 && performance.now() < until) await delay(20);
  assert.equal(player.inputSeq, 1);
  await room.leave();
});
