import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client as SDKClient, type Room as SDKRoom } from '@colyseus/sdk';
import { ClientState, defineServer, defineRoom, matchMaker, createEndpoint } from '@colyseus/core';
import type { LobbyState } from '../server/state';

// This process uses the disposable PostgreSQL provided by scripts/database-test.ts.
process.env.LOBBY_MAX_ROOMS = '1';
process.env.LOBBY_MATCHMAKING_BURST = '200';
const { LobbyAdmission, admissionConfig, lobbyAdmission, settleAuthWork } = await import('../server/lobbyAdmission');
const { lobbyRoutes } = await import('../server/lobbyRoutes');
const { LobbyRoom } = await import('../server/LobbyRoom');
const { SafeWebSocketTransport } = await import('../server/websocketSafety');
const { accounts } = await import('../server/accounts');

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const eventually = async (condition: () => boolean | Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('condition did not become true');
};

test('room claims are atomic and recover after disposal without releasing a different claim', () => {
  const gate = new LobbyAdmission({ ...admissionConfig({}), maxRooms: 2 });
  const first = {}, second = {}, denied = {};
  gate.claimRoom(first); gate.claimRoom(first); gate.claimRoom(second);
  assert.throws(() => gate.claimRoom(denied), { code: 503 });
  gate.releaseRoom(denied); assert.equal(gate.snapshot().rooms, 2);
  gate.releaseRoom(first); gate.releaseRoom(first); gate.claimRoom(denied);
  assert.equal(gate.snapshot().rooms, 2);
});

test('draining locks every room before waiting and denies new room creation', async () => {
  const gate = new LobbyAdmission({ ...admissionConfig({}), maxRooms: 3 });
  const slow = deferred(), order: string[] = [];
  gate.claimRoom({ lock() { order.push('first'); return slow.promise; } });
  gate.claimRoom({ lock() { order.push('second'); return Promise.reject(new Error('Redis unavailable')); } });
  const draining = gate.drain();
  assert.deepEqual(order, ['first', 'second']);
  assert.throws(() => gate.claimRoom({}), { code: 503 });
  slow.resolve(); await draining;
  assert.equal(gate.snapshot().rooms, 2);
});

test('new authorization cannot bypass bounded reserved work and slots recover from failures', async () => {
  const gate = new LobbyAdmission({ ...admissionConfig({}), maxAuthWork: 1 });
  const held = deferred(), reserved = deferred(), order: string[] = [];
  const first = gate.authenticate(async () => { await held.promise; throw new Error('database failure'); });
  const rejection = assert.rejects(first, /database failure/);
  const queued = gate.reserved(async () => { order.push('reserved'); await reserved.promise; });
  await assert.rejects(gate.authenticate(async () => order.push('new')), { code: 503 });
  held.resolve(); await rejection;
  await eventually(() => order.length === 1);
  assert.equal(gate.snapshot().activeAuthWork, 1);
  reserved.resolve(); await queued;
  assert.equal(gate.snapshot().activeAuthWork, 0);
  await gate.authenticate(async () => order.push('recovered'));
  assert.deepEqual(order, ['reserved', 'recovered']);
});

test('reserved work has a bounded queue and timed out work never runs later', { timeout: 7000 }, async () => {
  const gate = new LobbyAdmission({ ...admissionConfig({}), maxRooms: 1, maxAuthWork: 1 });
  const held = deferred();
  const active = gate.authenticate(() => held.promise);
  let ran = 0;
  const outcomes = Array.from({ length: 30 }, () => assert.rejects(gate.reserved(async () => { ran++; }), { code: 503 }));
  await assert.rejects(gate.reserved(async () => { ran++; }), { code: 503 });
  assert.equal(gate.snapshot().waitingAuthWork, 30);
  await Promise.all(outcomes);
  assert.equal(gate.snapshot().waitingAuthWork, 0);
  held.resolve(); await active;
  assert.equal(ran, 0);
  assert.equal(gate.snapshot().activeAuthWork, 0);
});

test('a failed query retains its work permit until all sibling queries finish', async () => {
  const gate = new LobbyAdmission({ ...admissionConfig({}), maxAuthWork: 1 });
  const pending = deferred();
  const failure = gate.reserved(() => settleAuthWork([Promise.reject(new Error('query failed')), pending.promise]));
  const rejected = assert.rejects(failure, /query failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gate.snapshot().activeAuthWork, 1);
  await assert.rejects(gate.authenticate(async () => {}), { code: 503 });
  pending.resolve(); await rejected;
  assert.equal(gate.snapshot().activeAuthWork, 0);
});

test('HTTP matchmaking limits include reconnect and reject before parsing a body', async () => {
  let now = 0, called = 0;
  const gate = new LobbyAdmission({ ...admissionConfig({}), matchmakingRate: 2, matchmakingBurst: 2 }, () => now);
  const router = lobbyRoutes(gate).extend({ endpoint: createEndpoint('/matchmake/:method/:roomName', { method: 'POST' }, async () => { called++; return Response.json({}); }) });
  const request = (method: string, body = '{}') => new Request('http://127.0.0.1/matchmake/' + method + '/lobby', { method: 'POST', headers: { Cookie: 'royal_session=present', 'Content-Type': 'application/json' }, body });
  assert.equal((await router.handler(request('reconnect'))).status, 200);
  assert.equal((await router.handler(request('joinOrCreate'))).status, 200);
  const rejected = request('reconnect', 'malformed json');
  const busy = await router.handler(rejected);
  assert.equal(busy.status, 429); assert.equal(busy.headers.get('Retry-After'), '2');
  assert.equal(rejected.bodyUsed, false); assert.equal(called, 2);
  now = 500; assert.equal((await router.handler(request('joinOrCreate'))).status, 200);
  now = 1000; assert.equal((await router.handler(request('create'))).status, 200);
});

test('invalid capacity settings fail at startup', () => {
  for (const value of ['0', '-1', '1.5', 'NaN', '101']) assert.throws(() => admissionConfig({ LOBBY_MAX_ROOMS: value }));
});

test('real matchmaking protects rooms, retains existing players and recovers capacity', { timeout: 20000 }, async t => {
  // A small room exercises the actual framework lifecycle without 30 account fixtures.
  class TestLobby extends LobbyRoom { maxClients = 2; seatReservationTimeout = .1; }
  const transport = new SafeWebSocketTransport({ pingInterval: 0 }, { maxConnections: 4 });
  const server = defineServer({ transport, rooms: { lobby: defineRoom(TestLobby) }, routes: lobbyRoutes(), greet: false, gracefullyShutdown: false });
  const clients: SDKRoom<LobbyState>[] = [];
  await accounts.ready;
  const fixture = async () => {
    const login = await accounts.login(`admission-${crypto.randomUUID()}@example.test`, 'Admission-test-123!');
    await accounts.select(login.account.id, 0);
    return login;
  };
  const login = await Promise.all(Array.from({ length: 4 }, () => fixture()));
  const sdk = (token: string) => new SDKClient(endpoint, { headers: { Cookie: 'royal_session=' + token } });
  let endpoint = '';
  try {
    await server.listen(0, '127.0.0.1');
    const address = transport.server!.address(); assert(address && typeof address !== 'string');
    endpoint = 'http://127.0.0.1:' + address.port;
    const reserve = (token?: string, method = 'joinOrCreate') => fetch(endpoint + '/matchmake/' + method + '/lobby', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: 'royal_session=' + token } : {}) }, body: '{}' });
    await t.test('anonymous and invalid sessions create no room or simulation', async () => {
      assert.equal((await reserve()).status, 401);
      assert.equal((await reserve(undefined, 'create')).status, 401);
      assert.equal((await reserve('invalid-token')).status, 401);
      assert.equal((await matchMaker.query({ name: 'lobby' })).length, 0);
      assert.equal(lobbyAdmission.snapshot().rooms, 0);
      const forbidden = await fetch(endpoint + '/matchmake/joinOrCreate/lobby', { method: 'POST', headers: { Origin: 'https://forbidden.example', Cookie: 'royal_session=' + login[0].token, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(forbidden.status, 403);
    });
    await t.test('a partial onCreate failure releases its claim and listeners', () => {
      const room = new LobbyRoom(), baseline = accounts.events.listenerCount('name');
      t.mock.method(room, 'setPatchRate', () => { throw new Error('initialization failed'); });
      assert.throws(() => room.onCreate(), /initialization failed/);
      room.onDispose(); room.clock.clear();
      assert.equal(lobbyAdmission.snapshot().rooms, 0);
      assert.equal(accounts.events.listenerCount('name'), baseline);
    });
    const first = await sdk(login[0].token).joinOrCreate<LobbyState>('lobby', { activityProtocol: 1 }); clients.push(first); first.reconnection.enabled = false; first.onMessage('*', () => {});
    const second = await sdk(login[1].token).joinOrCreate<LobbyState>('lobby', { activityProtocol: 1 }); clients.push(second); second.reconnection.enabled = false; second.onMessage('*', () => {});
    await t.test('full capacity rejects the next room without disturbing movement', async () => {
      await assert.rejects(sdk(login[2].token).joinOrCreate('lobby'), { code: 503 });
      assert.equal(lobbyAdmission.snapshot().rooms, 1);
      assert.equal(first.connection.isOpen, true); assert.equal(second.connection.isOpen, true);
      await eventually(() => Boolean(first.state.players.get(first.sessionId)));
      const own = first.state.players.get(first.sessionId)!;
      first.send('inputs', { revision: own.hallRevision, inputs: [{ seq: 1, x: 1, y: 0, ms: 16 }] });
      await eventually(() => first.state.players.get(first.sessionId)?.inputSeq === 1);
    });
    await first.leave(); await second.leave();
    await eventually(() => lobbyAdmission.snapshot().rooms === 0);
    await t.test('abandoned reservations expire and recover room capacity', async () => {
      assert.equal((await reserve(login[2].token, 'create')).status, 200);
      assert.equal(lobbyAdmission.snapshot().rooms, 1);
      await eventually(() => lobbyAdmission.snapshot().rooms === 0);
    });
    await t.test('revoked auth between reservation and WebSocket cannot add a player', async () => {
      const response = await reserve(login[3].token); assert.equal(response.status, 200);
      const reservation = await response.json();
      await accounts.logout(login[3].token);
      await assert.rejects(sdk(login[3].token).consumeSeatReservation(reservation), { code: 401 });
      await eventually(() => lobbyAdmission.snapshot().rooms === 0);
    });
    await t.test('a socket closed while queued never starts access queries', async context => {
      const held = deferred();
      const active = Array.from({ length: lobbyAdmission.config.maxAuthWork }, () => lobbyAdmission.authenticate(() => held.promise));
      const room = new LobbyRoom();
      const client = { state: ClientState.JOINING, readyState: 1, sessionId: 'queued-client' };
      context.mock.method(accounts, 'active', () => { assert.fail('closed queued joins must not query access'); });
      const joining = room.onJoin(client as any, {}, {} as any);
      const refused = assert.rejects(joining, { code: 503 });
      assert.equal(lobbyAdmission.snapshot().waitingAuthWork, 1);
      client.readyState = 2;
      held.resolve(); await Promise.all(active); await refused;
      assert.equal(room.state.players.size, 0); room.clock.clear();
    });
    await t.test('a socket closed during access queries never publishes a player', async context => {
      const room = new LobbyRoom(), held = deferred();
      const auth = (await accounts.session(login[0].token))!;
      const client = { state: ClientState.JOINING, readyState: 1, sessionId: 'closing-client', auth };
      context.mock.method(accounts, 'active', async () => { await held.promise; return true; });
      context.mock.method(room, 'broadcast', () => { assert.fail('closed joins must not announce a player'); });
      const refused = assert.rejects(room.onJoin(client as any, {}, auth), { code: 401 });
      client.readyState = 2; held.resolve(); await refused;
      assert.equal(room.state.players.size, 0); room.clock.clear();
    });
    await t.test('a closed join never queries the database or resurrects a player', async context => {
      const room = new LobbyRoom();
      context.mock.method(accounts, 'active', () => { assert.fail('closed joins must not query access'); });
      await assert.rejects(room.onJoin({ state: ClientState.LEAVING } as any, {}, {} as any), { code: 503 });
      assert.equal(room.state.players.size, 0); room.clock.clear();
    });
  } finally {
    await Promise.allSettled(clients.filter(client => client.connection.isOpen).map(client => client.leave()));
    await server.gracefullyShutdown(false);
    await accounts.close();
  }
});
