import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { BAR_APPROACH } from '../src/shared/world';
import { addDrink, MAX_SOBER_TIME_MS } from '../src/shared/intoxication';

test('only accepted bar orders consume a dose and cancelling animation cannot bypass the account cooldown', async context => {
  const login = await accounts.login(`drinking-room-${crypto.randomUUID()}@example.test`, 'room-test-password');
  (await accounts.select(login.account.id, 0));
  const auth = (await accounts.session(login.token))!;
  const client: any = { sessionId: 'drinking-client', auth, send() {}, leave() {} };
  const room = new LobbyRoom();
  const handlers = new Map<string, (client: any, value?: unknown) => void>();
  let simulation: ((delta: number) => void) | undefined;
  let sampleClock!: () => void;
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', (callback: (delta: number) => void) => { simulation = callback; });
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', (callback: () => void, interval: number) => {
    if (interval === 1000) sampleClock = callback;
    return { clear() {} };
  });
  let now = Date.now(); context.mock.method(Date, 'now', () => now);
  room.onCreate(); (await room.onJoin(client, {}, auth));
  try {
    const player = room.state.players.get(client.sessionId)!;
    const drink = async (id: string) => (await handlers.get('drink')!(client, id));
    (await drink('beer')); assert.equal(player.soberAt, 0, 'orders away from the bar are ignored');
    Object.assign(player, BAR_APPROACH);
    (await drink('invented')); assert.equal(player.soberAt, 0);
    player.playing = true; (await drink('beer')); assert.equal(player.soberAt, 0);
    player.playing = false; (await drink('beer'));
    const first = player.soberAt;
    assert.equal(first, addDrink(0, .18, now));
    assert.equal(player.security, '');
    (await drink('whisky')); assert.equal(player.soberAt, first, 'the current sip cannot be doubled');
    (await handlers.get('stand')!(client)); assert.equal(player.action, 'idle');
    (await drink('whisky')); assert.equal(player.soberAt, first, 'standing cannot bypass the sip cooldown');
    now += 3200; (await drink('wine'));
    const second = player.soberAt;
    assert.equal(second, addDrink(first, .26, now));
    room.onLeave(client); (await room.onJoin(client, {}, auth));
    const returned = room.state.players.get(client.sessionId)!;
    assert.equal(returned.soberAt, second);
    Object.assign(returned, BAR_APPROACH);
    (await drink('whisky')); assert.equal(returned.soberAt, second, 'rejoining cannot bypass the account cooldown');
    now += 3200; (await drink('coffee')); assert.equal(returned.soberAt, second);
    now += MAX_SOBER_TIME_MS;
    const lastSample = room.state.serverNow;
    simulation!(16); assert.equal(room.state.serverNow, lastSample, 'movement simulation does not create a clock patch');
    sampleClock(); assert.equal(room.state.serverNow, now);
    room.onLeave(client); (await room.onJoin(client, {}, auth));
    assert.equal(room.state.players.get(client.sessionId)!.soberAt, 0);
  } finally { room.onDispose(); room.clock.clear(); (await accounts.logout(login.token)); }
});

test('drinking events update room state fixtures and listeners are removed on disposal', async context => {
  const login = await accounts.login(`drinking-multi-${crypto.randomUUID()}@example.test`, 'room-test-password');
  (await accounts.select(login.account.id, 0));
  const rooms = [new LobbyRoom(), new LobbyRoom()];
  const baseline = accounts.events.listenerCount('drinking');
  const auth = await accounts.session(login.token);
  const clients = rooms.map((_, index) => ({ sessionId: `same-account-${index}`, auth: auth!, send() {}, leave() {} }));
  const handlers = rooms.map(() => new Map<string, (client: any, value?: unknown) => void>());
  // These state fixtures exercise event fanout and dose serialization. Real
  // matchmaking now rejects a second room for the same account.
  context.mock.method(accounts.lobbyLeases, 'claim', async (accountId: string, sessionHash: string, roomId: string, sessionId: string) => ({
    accountId, sessionHash, roomId, sessionId, token: crypto.randomUUID(), deadline: performance.now() + 45000,
  }));
  try {
    for (let index = 0; index < rooms.length; index++) {
      const room = rooms[index], client = clients[index];
      context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers[index].set(type, handler); });
      context.mock.method(room, 'setPatchRate', () => {});
      context.mock.method(room, 'setSimulationInterval', () => {});
      context.mock.method(room, 'broadcast', () => {});
      context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
      room.onCreate(); (await room.onJoin(client as any, {}, client.auth)); room.clients.push(client as any);
      Object.assign(room.state.players.get(client.sessionId)!, BAR_APPROACH);
    }
    await Promise.all([
      handlers[0].get('drink')!(clients[0], 'whisky'),
      handlers[1].get('drink')!(clients[1], 'wine'),
    ]);
    const first = rooms[0].state.players.get(clients[0].sessionId)!, second = rooms[1].state.players.get(clients[1].sessionId)!;
    assert.ok(first.soberAt > Date.now()); assert.equal(second.soberAt, first.soberAt);
    assert.equal(second.action, 'idle', 'other connections share intoxication without a fake drinking animation');
    assert.equal((await accounts.drinking.read(login.account.id)).lastDrink, 'whisky', 'parallel rooms cannot consume two doses');
    (await handlers[1].get('drink')!(clients[1], 'wine'));
    assert.equal(second.soberAt, first.soberAt, 'the account cooldown still prevents duplicate doses');
  } finally {
    rooms.forEach(room => { room.onDispose(); room.clock.clear(); });
    (await accounts.logout(login.token));
    assert.equal(accounts.events.listenerCount('drinking'), baseline);
  }
});

test('movement uses room access state and logout cancels an uncommitted asynchronous drink', async context => {
  const login = await accounts.login(`drinking-logout-${crypto.randomUUID()}@example.test`, 'room-test-password');
  await accounts.select(login.account.id, 0);
  const auth = (await accounts.session(login.token))!;
  const client: any = { sessionId: 'drinking-logout', auth, send() {}, leave() {} };
  const room = new LobbyRoom(), handlers = new Map<string, any>();
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); await room.onJoin(client, {}, auth); room.clients.push(client);
  let finish!: (active: boolean) => void;
  let sessionReads = 0, banReads = 0;
  context.mock.method(accounts, 'active', () => { sessionReads++; return new Promise<boolean>(resolve => { finish = resolve; }); });
  context.mock.method(accounts.moderation, 'banUntil', async () => { banReads++; return 0; });
  try {
    const player = room.state.players.get(client.sessionId)!;
    for (let index = 0; index < 80; index++) handlers.get('move')(client, { x: 0, y: 0, revision: player.hallRevision });
    assert.equal(sessionReads, 0); assert.equal(banReads, 0, 'movement must not wait for PostgreSQL');
    Object.assign(player, BAR_APPROACH);
    const pending = handlers.get('drink')(client, 'beer');
    assert.equal(sessionReads, 1);
    await accounts.logout(login.token);
    finish(true); await pending;
    assert.equal((await accounts.drinking.read(login.account.id)).lastDrink, '', 'revoked access cannot commit a pending order');
    assert.equal(player.soberAt, 0); assert.equal(player.connected, false);
  } finally { room.onDispose(); room.clock.clear(); room.onLeave(client); }
});

test('removed sofa and stool identifiers cannot teleport or seat an authenticated guest', async context => {
  const login = await accounts.login(`removed-seats-${crypto.randomUUID()}@example.test`, 'room-test-password');
  (await accounts.select(login.account.id, 0));
  const auth = (await accounts.session(login.token))!;
  const client: any = { sessionId: 'removed-seat-client', auth, send() {}, leave() {} };
  const room = new LobbyRoom();
  const handlers = new Map<string, (client: any, value?: unknown) => void>();
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); (await room.onJoin(client, {}, auth));
  try {
    const player = room.state.players.get(client.sessionId)!;
    for (const [id, x, y] of [
      ['sofa-1', 170, 486], ['sofa-2', 225, 486], ['sofa-3', 280, 486],
      ['bar-1', 790, 578], ['bar-2', 866, 578], ['bar-3', 942, 578],
    ] as const) {
      Object.assign(player,{x,y,seat:'',action:'idle',drink:'',actionUntil:0});
      const before = player.toJSON();
      (await handlers.get('sit')!(client,id));
      assert.deepEqual(player.toJSON(),before,id+' must not move the guest to removed furniture');
    }
    Object.assign(player,BAR_APPROACH);
    (await handlers.get('drink')!(client,'lemonade'));
    assert.equal(player.action,'drink','the bar still serves standing guests');
    assert.equal(player.seat,'');
  } finally { room.onDispose(); room.clock.clear(); (await accounts.logout(login.token)); }
});
