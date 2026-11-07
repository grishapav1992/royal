import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the browser client with only the transport replaced, preserving its
// real claim, message matching, timeout and reconnection lifecycle.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/network/LobbyClient.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env.VITE_SERVER_URL': '"http://127.0.0.1:2567"', 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'test-lobby-transport', setup(builder) {
    builder.onResolve({ filter: /^@colyseus\/sdk$/ }, () => ({ path: 'test-sdk', namespace: 'test-sdk' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-sdk' }, () => ({ contents: `
      export class Client {}
      export class MatchMakeError extends Error { constructor(message, code) { super(message); this.code = code; } }
      export const ErrorCode = { MATCHMAKE_INVALID_ROOM_ID: 522, MATCHMAKE_EXPIRED: 524 };
    `, loader: 'js' }));
  } }],
});
const { LobbyClient } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')) as typeof import('../src/network/LobbyClient');

class TransportRoom {
  roomId = 'test-room'; sessionId = 'test-player'; reconnection = {};
  reconnectionToken = 'test-room:test-token';
  left = 0;
  stateChanged!: (state: any) => void;
  packets: { type: string; value: any }[] = [];
  handlers = new Map<string, (value: any) => void>();
  drop!: () => void; reconnect!: () => void; finalLeave!: (code: number) => void;
  onMessage(type: string, handler: (value: any) => void) { this.handlers.set(type, handler); }
  onStateChange(handler: (state: any) => void) { this.stateChanged = handler; }
  onDrop(handler: () => void) { this.drop = handler; }
  onReconnect(handler: () => void) { this.reconnect = handler; }
  onLeave(handler: (code: number) => void) { this.finalLeave = handler; }
  onError(_handler: (code: number, message: string) => void) {}
  send(type: string, value?: unknown) { this.packets.push({ type, value }); }
  leave() { this.left++; this.finalLeave?.(1000); }
}

async function fixture(context: TestContext) {
  const room = new TransportRoom(), notices: string[] = [], ejections: number[] = [], statuses: { status: string; releases: number }[] = [];
  const releases = () => room.packets.filter(packet => packet.type === 'playing' && packet.value === false);
  const ignore = () => {};
  const client = new LobbyClient({ npcTime: ignore, guards: ignore, guests: ignore, mira: ignore, security: ignore, ejected: until => ejections.push(until),
    joined: ignore, players: ignore, chat: ignore, history: ignore, activities: ignore, note: ignore,
    notice: message => notices.push(message), status: status => statuses.push({ status, releases: releases().length }) });
  (client as any).client = { joinOrCreate: async () => room, joinById: async () => room };
  await client.join(); room.packets.length = 0; statuses.length = 0;
  context.after(() => client.leave());
  const request = () => room.packets.filter(packet => packet.type === 'cabinet-play').at(-1)!.value;
  const reply = (accepted: boolean, result: Record<string, unknown> = {}) => room.handlers.get('cabinet-play-result')!({ ...request(), accepted, ...result });
  return { client, room, notices, ejections, statuses, releases, request, reply };
}

test('player recovery waits for its matching authoritative state and fails on disconnect', async context => {
  const f = await fixture(context);
  (f.client as any).hall='arcade'; (f.client as any).revision=0;
  const pending=f.client.recoverPlayer(),request=f.room.packets.at(-1)!.value;
  assert.equal(await f.client.recoverPlayer(),false);
  f.room.handlers.get('unstuck-result')!({...request,requestId:request.requestId+1,accepted:true,revision:1});
  assert.equal((f.client as any).pendingPlayerRecovery.revision,undefined);
  f.room.handlers.get('unstuck-result')!({...request,accepted:true,revision:1});
  assert((f.client as any).pendingPlayerRecovery,'acknowledgement alone cannot unlock the old position');
  (f.client as any).revision=1;(f.client as any).confirmPlayerRecovery();assert.equal(await pending,true);
  const retry=f.client.recoverPlayer();f.room.drop();assert.equal(await retry,false);
});

test('claim results match both cabinet and request, and a refused request permits a retry', async context => {
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits'), firstRequest = f.request();
  assert.equal(await f.client.claimCabinet('royal-dice'), false, 'only one admission request can be in flight');
  assert.equal(f.room.packets.filter(packet => packet.type === 'cabinet-play').length, 1);
  f.reply(true, { id: 'royal-dice' });
  f.reply(true, { requestId: firstRequest.requestId + 1 });
  assert.equal((f.client as any).pendingCabinet.requestId, firstRequest.requestId, 'mismatched replies cannot finish a live claim');
  f.reply(false, { reason: 'Этот автомат уже занят.' });
  assert.equal(await pending, false); assert.deepEqual(f.notices, ['Этот автомат уже занят.']); assert.equal(f.releases().length, 0);
  const retry = f.client.claimCabinet('royal-fruits'); assert(f.request().requestId > firstRequest.requestId);
  f.reply(true); assert.equal(await retry, true); assert.equal((f.client as any).pendingCabinet, undefined);
});

test('a lost claim reply rejects admission and releases a possible server claim before reconnect unlocks', async context => {
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits'), oldRequest = f.request();
  f.room.drop(); assert.equal(await pending, false); assert.equal(f.client.status, 'reconnecting'); assert.equal(f.releases().length, 0);
  f.room.handlers.get('cabinet-play-result')!({ ...oldRequest, accepted: true });
  assert.equal((f.client as any).pendingCabinet, undefined, 'an abandoned reply cannot restore the cancelled admission');
  f.room.reconnect(); assert.equal(f.releases().length, 1);
  assert.deepEqual(f.statuses.at(-1), { status: 'connected', releases: 1 }, 'release is sent before the UI receives connected status');
  f.room.reconnect(); assert.equal(f.releases().length, 1, 'queued release intent is consumed once');
  const retry = f.client.claimCabinet('royal-fruits'); f.reply(true); assert.equal(await retry, true);
});

test('closing an accepted game during reconnect queues one release for the recovered connection', async context => {
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits'); f.reply(true); assert.equal(await pending, true);
  f.room.drop(); f.client.releaseCabinet(); f.client.releaseCabinet();
  assert.equal(f.releases().length, 0, 'offline releases do not disappear into a disconnected transport');
  f.room.reconnect(); assert.equal(f.releases().length, 1); assert.equal(f.releases()[0].value, false);
  f.room.reconnect(); assert.equal(f.releases().length, 1);
});

test('an accepted game that stays open retains its reservation across a temporary disconnect', async context => {
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits'); f.reply(true); assert.equal(await pending, true);
  f.room.drop(); f.room.reconnect();
  assert.equal(f.releases().length, 0, 'reconnecting alone must preserve an existing open game');
  assert.equal(f.client.status, 'connected');
  f.client.releaseCabinet(); assert.equal(f.releases().length, 1, 'a later connected close releases immediately');
});

test('a timed out claim rejects, releases a possibly accepted seat and ignores a late success', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits'), oldRequest = f.request();
  context.mock.timers.tick(8000);
  assert.equal(await pending, false); assert.equal(f.releases().length, 1); assert.equal(f.notices.length, 1);
  f.room.handlers.get('cabinet-play-result')!({ ...oldRequest, accepted: true });
  assert.equal((f.client as any).pendingCabinet, undefined);
  const retry = f.client.claimCabinet('royal-fruits'); f.reply(true); assert.equal(await retry, true);
  context.mock.timers.tick(8000); assert.equal(f.releases().length, 1, 'an acknowledged retry leaves no live timeout');
});

test('a final leave rejects a pending admission and a new room does not inherit its queued release', async context => {
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits');
  f.room.finalLeave(1000); assert.equal(await pending, false); assert.equal(f.client.status, 'disconnected');
  await f.client.join(); assert.equal(f.releases().length, 0, 'a final room departure already clears its server reservation');
  const retry = f.client.claimCabinet('royal-fruits'); f.reply(true); assert.equal(await retry, true);
});

test('parallel entries share one handshake and leaving during it discards its late room', async context => {
  const f = await fixture(context); f.client.leave();
  const late = new TransportRoom(); let resolve!: (room: TransportRoom) => void, calls = 0;
  (f.client as any).client = { joinOrCreate: () => { calls++; return new Promise(done => { resolve = done; }); } };
  const first = f.client.join(), second = f.client.join();
  assert.equal(first, second); assert.equal(calls, 1);
  f.client.leave(); resolve(late); await first;
  assert.equal(late.left, 1); assert.equal(f.client.status, 'disconnected');
  assert.equal(f.client.getState().selfId, undefined);
});

test('events from a departed room cannot change the replacement connection', async context => {
  const f = await fixture(context); f.client.leave();
  const next = new TransportRoom(); next.sessionId = 'replacement';
  (f.client as any).client = { joinOrCreate: async () => next };
  await f.client.join();
  f.room.drop(); f.room.reconnect(); f.room.finalLeave(4003);
  f.room.handlers.get('notice')!('stale notice');
  f.room.stateChanged({ players: new Map(), serverNow: Date.now() });
  assert.equal(f.client.status, 'connected'); assert.equal(f.client.getState().selfId, 'replacement');
  assert.deepEqual(f.notices, []);
  assert.equal(f.room.packets.length, 0);
});

function recoveryStorage(context: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  return values;
}

test('reload adopts the reserved session and rotates its recovery token after another drop', async context => {
  const storage = recoveryStorage(context), f = await fixture(context); f.client.leave();
  storage.set('royal-lobby-recovery', JSON.stringify({ accountId: 'alice', roomId: 'test-room', token: 'test-room:saved-token' }));
  const room = new TransportRoom(); let calls = 0;
  (f.client as any).client = { reconnect: async (token: string) => { calls++; assert.equal(token, 'test-room:saved-token'); return room; } };
  await f.client.join('test-room', true, 'alice');
  assert.equal(calls, 1); assert.equal(f.client.status, 'connected');
  assert(room.packets.some(p => p.type === 'playing' && p.value === false), 'a closed game window must release its restored seat');
  room.drop(); room.reconnect(); room.reconnectionToken = 'test-room:rotated-token';
  await Promise.resolve();
  assert.equal(JSON.parse(storage.get('royal-lobby-recovery')!).token, room.reconnectionToken);
  f.client.leave(); assert.equal(storage.size, 0);
});

test('only expired recovery falls back to entry, while network and auth failures preserve the reservation', async context => {
  const storage = recoveryStorage(context), f = await fixture(context); f.client.leave();
  for (const code of [522, 524, 401, 403, 503, 'ECONNREFUSED']) {
    storage.set('royal-lobby-recovery', JSON.stringify({ accountId: 'alice', roomId: 'test-room', token: 'test-room:saved' }));
    let fresh = 0;
    (f.client as any).client = { reconnect: async () => { throw Object.assign(new Error('failed'), { code }); },
      joinById: async () => { fresh++; return new TransportRoom(); } };
    const pending = f.client.join('test-room', true, 'alice');
    if (code === 522 || code === 524) { await pending; assert.equal(fresh, 1); f.client.leave(); }
    else { await assert.rejects(pending); assert.equal(fresh, 0); assert.equal(storage.size, 1); }
  }
});

test('another account or invitation cannot adopt a saved session', async context => {
  const storage = recoveryStorage(context), f = await fixture(context); f.client.leave();
  for (const [roomId, accountId, returning] of [['test-room', 'bob', true], ['other-room', 'alice', true]] as const) {
    storage.set('royal-lobby-recovery', JSON.stringify({ accountId: 'alice', roomId: 'test-room', token: 'test-room:saved' }));
    let fresh = 0;
    (f.client as any).client = { reconnect: async () => { throw new Error('must not adopt'); },
      joinById: async () => { fresh++; return new TransportRoom(); } };
    await f.client.join(roomId, returning, accountId); assert.equal(fresh, 1); f.client.leave();
  }
});


test('exhausted reconnection automatically recovers without inventing a guard ban', async context => {
  const f = await fixture(context), pending = f.client.claimCabinet('royal-fruits');
  f.room.drop(); f.room.finalLeave(4003);
  assert.equal(f.client.status, 'reconnecting');
  assert.equal(await pending, false);
  assert.deepEqual(f.ejections, []);
  await f.client.join(); assert.equal(f.client.status, 'connected');
});

test('a warning followed by reconnection failure is not a ban', async context => {
  const f = await fixture(context);
  f.room.handlers.get('security')!({ kind: 'warning', until: Date.now() + 86400000, reason: 'spam' });
  f.room.drop(); f.room.finalLeave(4003);
  await f.client.join();
  assert.deepEqual(f.ejections, []); assert.equal(f.client.status, 'connected');
});

test('a confirmed ban keeps the exact server deadline through final departure', async context => {
  const f = await fixture(context), until = Date.now() + 120000;
  f.room.handlers.get('security')!({ kind: 'ejecting', until, reason: 'collision' });
  f.room.finalLeave(4003); assert.deepEqual(f.ejections, [until]);
});

test('an explicit ejection is honored and an expired sanction cannot restart a timer', async context => {
  const f = await fixture(context), until = Date.now() + 120000;
  f.room.handlers.get('ejected')!({ until }); assert.deepEqual(f.ejections, [until]);
  f.room.handlers.get('security')!({ kind: 'ejecting', until: Date.now() - 1 });
  f.room.drop(); f.room.finalLeave(4003); assert.deepEqual(f.ejections, [until]);
});

test('a server restart automatically enters a replacement room without a manual login', async context => {
  const f = await fixture(context), replacement = new TransportRoom(); replacement.roomId = 'replacement';
  let fresh = 0;
  (f.client as any).client = {
    joinById: async () => { throw Object.assign(new Error('Room gone'), { code: 522 }); },
    joinOrCreate: async () => { fresh++; return replacement; },
  };
  f.room.finalLeave(4001);
  assert.equal(f.client.status, 'reconnecting');
  await f.client.join();
  assert.equal(fresh, 1); assert.equal(f.client.status, 'connected');
  assert.equal(f.client.getState().roomId, 'replacement'); assert.deepEqual(f.ejections, []);
});

test('SDK retry exhaustion preserves a valid token and an open game reservation', async context => {
  const storage = recoveryStorage(context), f = await fixture(context); f.client.leave();
  await f.client.join(undefined, false, 'alice');
  const resumed = new TransportRoom(); let token = '';
  (f.client as any).client = { reconnect: async (value: string) => { token = value; return resumed; },
    joinById: async () => { throw Error('Must resume the reserved player'); } };
  f.room.finalLeave(4003);
  assert(storage.size > 0, 'Exhausted SDK retries do not prove that the server reservation expired');
  await f.client.join();
  assert.equal(token, 'test-room:test-token'); assert.equal(f.client.status, 'connected');
  assert.equal(resumed.packets.filter(p => p.type === 'playing' && p.value === false).length, 0);
});

test('a game closed during replacement handshake releases its recovered reservation once', async context => {
  recoveryStorage(context); const f = await fixture(context); f.client.leave();
  await f.client.join(undefined, false, 'alice');
  let resolve!: (room: TransportRoom) => void;
  (f.client as any).client = { reconnect: () => new Promise(done => { resolve = done; }) };
  f.room.finalLeave(4003); f.client.releaseCabinet();
  const resumed = new TransportRoom(); resolve(resumed); await f.client.join();
  assert.equal(resumed.packets.filter(p => p.type === 'playing' && p.value === false).length, 1);
});

test('recovery stops on a revoked login or a real server ban', async context => {
  for (const code of [401, 403]) {
    const f = await fixture(context); let calls = 0;
    (f.client as any).client = { joinById: async () => { calls++; throw Object.assign(new Error('Access denied'), { code }); } };
    f.room.finalLeave(4001); await (f.client as any).recovery;
    assert.equal(calls, 1); assert.equal(f.client.status, 'disconnected'); assert.deepEqual(f.ejections, []);
  }
});

test('leaving during automatic recovery discards a late room and never rejoins', async context => {
  const f = await fixture(context); let resolve!: (room: TransportRoom) => void;
  (f.client as any).client = { joinById: () => new Promise(done => { resolve = done; }) };
  f.room.finalLeave(4001); const recovery = (f.client as any).recovery;
  f.client.leave(); const late = new TransportRoom(); resolve(late); await recovery;
  assert.equal(late.left, 1); assert.equal(f.client.status, 'disconnected');
  assert.equal(f.client.getState().roomId, undefined);
});

test('leaving while a failed recovery waits cancels the pending retry', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(context); let calls = 0;
  (f.client as any).client = { joinById: async () => { calls++; throw Object.assign(new Error('Temporarily unavailable'), { code: 503 }); } };
  f.room.finalLeave(4001); const recovery = (f.client as any).recovery;
  for (let i = 0; i < 20 && !(f.client as any).recoveryWait; i++) await Promise.resolve();
  assert((f.client as any).recoveryWait); f.client.leave();
  context.mock.timers.tick(10000); await recovery;
  assert.equal(calls, 1); assert.equal(f.client.status, 'disconnected');
});

test('temporary server unavailability retries without exposing a final disconnected state', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(context), replacement = new TransportRoom(); let calls = 0;
  (f.client as any).client = { joinById: async () => { if (++calls === 1) throw Object.assign(new Error('Starting'), { code: 503 }); return replacement; } };
  f.room.finalLeave(4001); const recovery = (f.client as any).recovery;
  for (let i = 0; i < 20 && !(f.client as any).recoveryWait; i++) await Promise.resolve();
  assert((f.client as any).recoveryWait); context.mock.timers.tick(3000); await recovery;
  assert.equal(calls, 2); assert.equal(f.client.status, 'connected');
  assert(!f.statuses.some(row => row.status === 'disconnected'));
});
