import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { accounts } from '../server/accounts';
import { CABINETS, cabinetHall } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';

function fixture(context: TestContext) {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => unknown>();
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  context.mock.method(room, 'allowReconnection', async () => undefined as any);
  room.onCreate(); room.state.guards.clear();
  const clients = ['first', 'second'].map(id => {
    const packets: { type: string; value: any }[] = [];
    const client: any = { sessionId: id, auth: { account: { id }, hash: id },
      send(type: string, value: unknown) { packets.push({ type, value }); }, leave() {}, packets };
    room.clients.push(client);
    room.state.players.set(id, new Player());
    (room as any).controls.set(id, { dx: 0, dy: 0, at: 0, path: [], lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(), predicted: false });
    (room as any).access.set(id, { active: true, banUntil: 0, pendingEject: false, revision: 0 });
    return client;
  });
  context.after(async () => { await room.onDispose(); room.clock.clear(); });
  const player = (index = 0) => room.state.players.get(clients[index].sessionId)!;
  let requestId = 0;
  const play = async (index: number, id: string) => {
    const request = ++requestId;
    await handlers.get('cabinet-play')!(clients[index], { id, requestId: request });
    return clients[index].packets.findLast((packet: any) => packet.type === 'cabinet-play-result' && packet.value.requestId === request)?.value;
  };
  return { room, clients, player, play, handlers };
}

test('a cabinet admits one player and legacy play and stand messages cannot bypass its claim', async context => {
  const { room, clients, player, play, handlers } = fixture(context), cabinet = CABINETS[0], seat = cabinetSeat(cabinet);
  for (const p of room.state.players.values()) Object.assign(p, { hall: cabinetHall(cabinet), ...seat.entry });
  const [first, second] = await Promise.all([play(0, cabinet.id), play(1, cabinet.id)]);
  assert.equal(first.accepted, true); assert.equal(second.accepted, false); assert.match(second.reason, /занят/);
  assert.equal(player().cabinet, cabinet.id); assert.equal(player().seat, 'cabinet:' + cabinet.id);
  assert.equal(player().playing, true); assert.equal(player().action, 'sit'); assert.equal(player().facing, 'up');
  assert.equal(player().x, seat.x); assert.equal(player().y, seat.y);
  await handlers.get('playing')!(clients[1], true);
  assert.equal(player(1).playing, false, 'older pages share the authoritative claim');
  await handlers.get('stand')!(clients[0]);
  await handlers.get('target')!(clients[0], { revision: 0, x: seat.x + 100, y: seat.y + 100 });
  assert.equal(player().cabinet, cabinet.id); assert.equal(player().seat, 'cabinet:' + cabinet.id);
  assert.equal(player().x, seat.x); assert.equal(player().y, seat.y);
  const repeated = await play(0, cabinet.id); assert.equal(repeated.accepted, true, 'retrying an accepted request preserves ownership');
  assert.equal((await play(0, CABINETS[1].id)).accepted, false, 'an open game cannot switch to another cabinet');
  await handlers.get('playing')!(clients[0], true); assert.equal(player().cabinet, cabinet.id, 'legacy retries preserve the original cabinet');
  await handlers.get('activity')!(clients[0], { type: 'join', id: 'piano' });
  assert.equal(player().activity, ''); assert.equal(player().cabinet, cabinet.id, 'activity joins cannot take a seated player away');
  await handlers.get('playing')!(clients[0], false);
  assert.equal(player().cabinet, ''); assert.equal(player().seat, ''); assert.equal(player().playing, false);
  assert.equal(player().x, seat.entry.x); assert.equal(player().y, seat.entry.y);
  assert.equal((await play(1, cabinet.id)).accepted, true, 'closing the game frees the cabinet');
});

test('every playable cabinet requires its own hall, a nearby entry and an available player', async context => {
  const { clients, player, play, handlers } = fixture(context);
  for (const cabinet of CABINETS.filter(c => c.playable)) {
    const p = player(), seat = cabinetSeat(cabinet), hall = cabinetHall(cabinet);
    Object.assign(p, { hall: hall === 'arcade' ? 'tables' : 'arcade', ...seat.entry });
    assert.equal((await play(0, cabinet.id)).accepted, false, cabinet.id + ' rejects another hall');
    Object.assign(p, { hall, x: seat.entry.x, y: seat.entry.y + 91 });
    assert.equal((await play(0, cabinet.id)).accepted, false, cabinet.id + ' rejects a distant avatar');
    Object.assign(p, seat.entry);
    assert.equal((await play(0, cabinet.id)).accepted, true, cabinet.id + ' accepts its entry');
    assert.equal(p.cabinet, cabinet.id);
    await handlers.get('playing')!(clients[0], false);
    await handlers.get('playing')!(clients[0], true);
    assert.equal(p.cabinet, cabinet.id, cabinet.id + ' supports the legacy nearest-cabinet request');
    await handlers.get('playing')!(clients[0], false);
  }
  const cabinet = CABINETS[0]; Object.assign(player(), { hall: cabinetHall(cabinet), ...cabinetSeat(cabinet).entry, action: 'drink' });
  assert.equal((await play(0, cabinet.id)).accepted, false);
  Object.assign(player(), { action: 'idle', activity: 'chess' }); assert.equal((await play(0, cabinet.id)).accepted, false);
  player().activity = ''; assert.equal((await play(0, 'missing-cabinet')).accepted, false);
});

test('reactions require cabinet ownership, are throttled, expire and clear on game close', async context => {
  let now = 1800000000000; context.mock.method(Date, 'now', () => now);
  const { room, clients, player, play, handlers } = fixture(context), cabinet = CABINETS[0];
  Object.assign(player(), { hall: cabinetHall(cabinet), ...cabinetSeat(cabinet).entry }); await play(0, cabinet.id);
  const react = (index: number, id: string, reaction: unknown) => handlers.get('cabinet-reaction')!(clients[index], { id, reaction });
  await react(1, cabinet.id, 'win'); assert.equal(player().gameReaction, ''); assert.equal(player(1).gameReaction, '');
  await react(0, 'someone-else', 'win'); await react(0, cabinet.id, 'invented'); assert.equal(player().gameReaction, '');
  await react(0, cabinet.id, 'win'); assert.equal(player().gameReaction, 'win'); assert(player().gameReactionUntil > now);
  const expiry = player().gameReactionUntil;
  now += 100; await react(0, cabinet.id, 'lose'); assert.equal(player().gameReaction, 'win'); assert.equal(player().gameReactionUntil, expiry);
  now += 450; await react(0, cabinet.id, 'lose'); assert.equal(player().gameReaction, 'lose');
  now = player().gameReactionUntil; (room as any).tick(.05); assert.equal(player().gameReaction, ''); assert.equal(player().gameReactionUntil, 0);
  await react(0, cabinet.id, 'win'); await handlers.get('playing')!(clients[0], false);
  assert.equal(player().gameReaction, ''); assert.equal(player().gameReactionUntil, 0);
});

test('a dropped connection reserves its cabinet until final leave', async context => {
  const { room, clients, player, play } = fixture(context), cabinet = CABINETS[0];
  for (const p of room.state.players.values()) Object.assign(p, { hall: cabinetHall(cabinet), ...cabinetSeat(cabinet).entry });
  await play(0, cabinet.id); room.onDrop(clients[0]);
  assert.equal(player().connected, false); assert.equal(player().cabinet, cabinet.id);
  assert.equal((await play(1, cabinet.id)).accepted, false, 'the reconnecting owner cannot be replaced');
  const departed = player(); await room.onLeave(clients[0]);
  assert.equal(departed.cabinet, ''); assert.equal(departed.seat, ''); assert.equal(departed.playing, false);
  assert.equal((await play(1, cabinet.id)).accepted, true);
});

test('disconnecting cancels a play request deferred behind accepted movement', async context => {
  let now = 1800000000000; context.mock.method(Date, 'now', () => now);
  const { room, clients, player, play, handlers } = fixture(context), cabinet = CABINETS[0];
  for (const p of room.state.players.values()) Object.assign(p, { hall: cabinetHall(cabinet), ...cabinetSeat(cabinet).entry });
  const control = (room as any).controls.get('first'); control.inputs.takeDuration(100, now);
  await handlers.get('inputs')!(clients[0], { revision: 0, inputs: [{ seq: 1, x: 0, y: 0, ms: 50 }] });
  assert.equal(control.inputs.pendingCount, 1);
  await handlers.get('cabinet-play')!(clients[0], { id: cabinet.id, requestId: 101 });
  assert.equal(player().cabinet, ''); assert.equal(typeof control.afterMovement, 'function');
  room.onDrop(clients[0]); now += 100; (room as any).tick(.05);
  assert.equal(player().cabinet, ''); assert.equal(control.afterMovement, undefined);
  assert.equal(clients[0].packets.some((packet: any) => packet.type === 'cabinet-play-result' && packet.value.accepted), false);
  assert.equal((await play(1, cabinet.id)).accepted, true, 'a cancelled request never reserves the cabinet');
});

test('moderation, logout and an expired account lease release cabinet ownership immediately', async context => {
  const { room, clients, player, play } = fixture(context), cabinet = CABINETS[0], seat = cabinetSeat(cabinet);
  for (const p of room.state.players.values()) Object.assign(p, { hall: cabinetHall(cabinet), ...seat.entry });
  await play(0, cabinet.id);
  accounts.events.emit('security', 'first', { kind: 'warning', reason: 'spam' });
  assert.equal(player().cabinet, ''); assert.equal(player().playing, false); assert.equal(player().y, seat.entry.y);
  assert.equal((await play(1, cabinet.id)).accepted, true);
  accounts.events.emit('logout', 'second');
  assert.equal(player(1).cabinet, ''); assert.equal(player(1).playing, false); assert.equal(player(1).connected, false);
  Object.assign(player(), { security: '', ...seat.entry }); await play(0, cabinet.id);
  const expired = player();
  context.mock.method(accounts.lobbyLeases, 'release', async () => {});
  (room as any).accountLeases.set('first', { sessionId: 'first', token: 'expired', deadline: performance.now() - 1 });
  (room as any).fenceAccountLeases();
  assert.equal(expired.cabinet, ''); assert.equal(expired.gameReaction, ''); assert.equal(expired.playing, false);
  assert.equal(room.state.players.has('first'), false);
});
