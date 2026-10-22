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
  const room = new TransportRoom(), notices: string[] = [], statuses: { status: string; releases: number }[] = [];
  const releases = () => room.packets.filter(packet => packet.type === 'playing' && packet.value === false);
  const ignore = () => {};
  const client = new LobbyClient({ npcTime: ignore, guards: ignore, guests: ignore, mira: ignore, security: ignore, ejected: ignore,
    checking: ignore, joined: ignore, players: ignore, chat: ignore, history: ignore, activities: ignore, note: ignore,
    notice: message => notices.push(message), status: status => statuses.push({ status, releases: releases().length }) });
  (client as any).client = { joinOrCreate: async () => room, joinById: async () => room };
  await client.join(); room.packets.length = 0; statuses.length = 0;
  context.after(() => { (client as any).setStatus('disconnected'); });
  const request = () => room.packets.filter(packet => packet.type === 'cabinet-play').at(-1)!.value;
  const reply = (accepted: boolean, result: Record<string, unknown> = {}) => room.handlers.get('cabinet-play-result')!({ ...request(), accepted, ...result });
  return { client, room, notices, statuses, releases, request, reply };
}

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
  for (const [roomId, accountId, returning] of [['test-room', 'bob', true], ['other-room', 'alice', true], ['test-room', 'alice', false]] as const) {
    storage.set('royal-lobby-recovery', JSON.stringify({ accountId: 'alice', roomId: 'test-room', token: 'test-room:saved' }));
    let fresh = 0;
    (f.client as any).client = { reconnect: async () => { throw new Error('must not adopt'); },
      joinById: async () => { fresh++; return new TransportRoom(); } };
    await f.client.join(roomId, returning, accountId); assert.equal(fresh, 1); f.client.leave();
  }
});
