import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { Client } from '@colyseus/core';
import { accounts } from '../server/accounts';
import type { Activities } from '../server/activities';
import { guardLineClear } from '../server/guardNavigation';
import type { Guards } from '../server/guards';
import { LobbyRoom } from '../server/LobbyRoom';
import type { PvpRoom } from '../server/pvp/room';
import { walkable } from '../src/game/navigation';
import { isCollectionGame } from '../src/shared/arcadeCatalog';
import { CABINETS } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { PENALTY_GAME } from '../src/shared/crLeo';
import { GUARD_CONTACT_RADIUS } from '../src/shared/guardCollision';
import { VIRTUAL_PVP_SCOPE } from '../src/shared/pvp';
import { pvpSeat } from '../src/shared/pvpSeats';
import { hallLinks, hallObstacles, type HallId } from '../src/shared/world';

type Handler = (client: Client, value?: unknown) => void | Promise<void>;
type Packet = { type: string; value: unknown };

function fixture(context: TestContext) {
  const room = new LobbyRoom(), handlers = new Map<string, Handler>();
  room.roomId = randomUUID();
  context.mock.method(room, 'onMessage', (type: string, handler: Handler) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  context.mock.method(room, 'allowReconnection', async () => {});
  room.onCreate();
  context.after(() => { room.onDispose(); room.clock.clear(); });
  const { activities, guards, pvp } = room as unknown as { activities: Activities; guards: Guards; pvp: PvpRoom };

  const join = async () => {
    const login = await accounts.login(`club-wager-${randomUUID()}@example.test`, 'Club-wager-test-password!');
    const accountId = login.account.id;
    context.after(() => accounts.logout(login.token));
    await accounts.select(accountId, 0);
    await accounts.wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 50 });
    const packets: Packet[] = [], closes: (number | undefined)[] = [];
    const client = {
      sessionId: randomUUID(),
      send(type: string, value: unknown) { packets.push({ type, value }); },
      leave(code?: number) { closes.push(code); },
    } as unknown as Client;
    const headers = new Headers({ Cookie: 'royal_session=' + login.token });
    const auth = await room.onAuth(client, {}, { headers, ip: '127.0.0.1' });
    assert.equal(auth.account.id, accountId);
    client.auth = auth;
    room.clients.push(client);
    await room.onJoin(client, { activityProtocol: 1 }, auth);
    const player = room.state.players.get(client.sessionId)!;
    let seq = 0;
    const send = (type: string, value?: unknown) => handlers.get(type)!(client, value);
    const cross = async (target: HallId) => {
      const link = hallLinks(player.hall as HallId).find(candidate => candidate.target === target);
      assert(link, `no route from ${player.hall} to ${target}`);
      Object.assign(player, link.door.entry);
      await send('inputs', { revision: player.hallRevision, inputs: [{ seq: ++seq, x: 0, y: 0, ms: 0 }] });
      assert.equal(player.hall, target);
    };
    return { accountId, client, auth, player, packets, closes, send, cross };
  };

  const capture = async ({ accountId, client, player, packets }: Awaited<ReturnType<typeof join>>) => {
    const pursuitId = randomUUID();
    const { outcome: { sanction } } = await accounts.clubSanctions.recordViolation(accountId,
      { id: randomUUID(), reason: 'profanity', pursuitId });
    const hall = player.hall as HallId, obstacles = hallObstacles(hall);
    const start = [{ x: 0, y: 90 }, { x: 0, y: -90 }, { x: -90, y: 0 }, { x: 90, y: 0 }]
      .map(offset => ({ x: player.x + offset.x, y: player.y + offset.y }))
      .find(point => walkable(point.x, point.y, obstacles, 16) && guardLineClear(point, player, obstacles));
    assert(start, 'the active seat needs a walkable approach for the guard');
    const guard = room.state.guards.get('security')!;
    Object.assign(guard, { ...start, hall, phase: 'idle' });
    assert(guards.pursue(client.sessionId, { id: pursuitId, sanctionId: sanction.id, until: sanction.until, reason: 'profanity' }));
    guards.tick(.05);
    assert.equal(player.security, '');
    assert.equal(packets.filter(packet => packet.type === 'club-capture').length, 0);
    for (let i = 0; i < 200 && !player.security; i++) guards.tick(.05);
    assert.equal(player.security, 'ejecting', 'the guard has to catch the player');
    assert(Math.hypot(guard.x - player.x, guard.y - player.y) <= GUARD_CONTACT_RADIUS);
    for (let i = 0; i < 200 && !packets.some(packet => packet.type === 'club-capture'); i++) await delay(5);
    assert.deepEqual(packets.filter(packet => packet.type === 'club-capture').map(packet => packet.value), [
      { kind: 'ejecting', until: sanction.until, reason: 'profanity', pursuitId },
    ]);
    for (let i = 0; i < 1200 && player.hall !== 'street'; i++) guards.tick(.05);
    assert.equal(player.hall, 'street');
    assert.equal(player.security, '');
    assert.equal(player.connected, true);
    assert.deepEqual(packets.filter(packet => packet.type === 'club-ejected').map(packet => packet.value), [{ pursuitId }]);
    assert.deepEqual(await accounts.clubSanctions.active(accountId), sanction);
  };

  const syncPvp = async () => {
    pvp.tick();
    await (pvp as unknown as { queue: Promise<unknown> }).queue;
  };
  return { room, activities, join, capture, syncPvp };
}

test('a paid CR vs. Leo round keeps its stake through a physical escort and settles once after cabinet reentry', { timeout: 20000 }, async context => {
  const club = fixture(context), visitor = await club.join();
  const { accountId, player, packets, send, cross } = visitor;
  const cabinet = CABINETS.find(candidate => candidate.id === 'original-jackie-chan')!;
  assert(isCollectionGame('royal', PENALTY_GAME));
  const takeSeat = async (requestId: number) => {
    Object.assign(player, cabinetSeat(cabinet).entry);
    await send('cabinet-play', { id: cabinet.id, requestId });
    assert.deepEqual(packets.findLast(packet => packet.type === 'cabinet-play-result')?.value,
      { id: cabinet.id, requestId, accepted: true });
    assert.equal(player.cabinet, cabinet.id);
    assert.equal(player.playing, true);
  };
  await takeSeat(1);
  const expansion = accounts.wallet.expansion;
  // A fixed opening goal leaves a live round without changing its wallet or persisted state paths.
  context.mock.method(expansion as unknown as { draw: (max: number) => number }, 'draw', () => 0);
  const start = { id: randomUUID(), action: 'start', gameId: PENALTY_GAME, stakePolicyVersion: 1, stakeUnits: '1000',
    settings: { penalty: { hero: 'cr', risk: 'safe' } } };
  const accepted = await expansion.operate(accountId, start);
  assert.equal(accepted.session.state, 'active');
  assert.equal(accepted.wallet.balance, 40);

  await club.capture(visitor);
  assert.equal(player.cabinet, '');
  assert.equal(player.seat, '');
  assert.equal(player.playing, false);
  assert.deepEqual(await expansion.active(accountId), { wallet: accepted.wallet, sessions: [accepted.session] });
  await cross('arcade');
  await takeSeat(2);
  assert.deepEqual(await expansion.operate(accountId, start), { ...accepted, replayed: true });

  const cashout = { id: randomUUID(), action: 'move', gameId: PENALTY_GAME, sessionId: start.id, move: 'cashout', revision: 1 };
  const settled = await expansion.operate(accountId, cashout);
  assert.equal(settled.session.state, 'settled');
  assert.equal(settled.session.view.penalty?.status, 'banked');
  const payout = Number(settled.session.returnedUnits) / 100;
  assert(payout > 0);
  assert.deepEqual(await expansion.operate(accountId, cashout), { ...settled, replayed: true });
  assert.deepEqual((await expansion.active(accountId)).sessions, [settled.session]);
  assert.equal(settled.wallet.balance, 40 + payout);
  assert.deepEqual(settled.wallet.entries.filter(entry => entry.source === PENALTY_GAME)
    .map(({ kind, amount }) => ({ kind, amount })), [{ kind: 'win', amount: payout }, { kind: 'bet', amount: -10 }]);
});

test('a funded chess game pauses during escort and reconnect until the player returns to the original floor', { timeout: 20000 }, async context => {
  const club = fixture(context), first = await club.join(), second = await club.join();
  for (const [index, visitor] of [first, second].entries()) {
    await visitor.cross('tables');
    Object.assign(visitor.player, pvpSeat('chess', index));
  }
  await club.syncPvp();
  const create = { id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: null };
  const pvp = (visitor: typeof first, request: object) => visitor.send('pvp', { ...request, walletScope: VIRTUAL_PVP_SCOPE });
  const matches = () => accounts.pvp.roomMatches(club.room.roomId);
  await pvp(first, create);
  const [match] = await matches();
  assert(match, 'the create command must reach the real funded PvP store');
  assert.equal(match.status, 'open');
  await pvp(second, { id: randomUUID(), action: 'accept', challengeId: match.id });
  for (const visitor of [first, second]) await pvp(visitor, { id: randomUUID(), action: 'ready', challengeId: match.id });
  assert.equal((await matches())[0]?.status, 'playing');
  const { activities } = club, chess = activities.chess.state;
  assert.deepEqual(activities.wagers.get('chess'), [first.client.sessionId, second.client.sessionId]);
  await first.send('activity', { type: 'chess-move', from: 'e2', to: 'e4' });
  assert.deepEqual(chess.last, { from: 'e2', to: 'e4' });
  const funded = await Promise.all([first, second].map(visitor => accounts.wallet.snapshot(visitor.accountId)));
  assert.deepEqual(funded.map(wallet => wallet.balance), [40, 40]);

  await club.capture(first);
  await club.syncPvp();
  assert.equal(first.player.playing, false);
  assert.equal(second.player.playing, true);
  assert.deepEqual((await matches())[0]?.disconnected.map(row => row.accountId), [first.accountId]);
  activities.tick(.05);
  const pausedClock = structuredClone(chess.clock);
  assert.equal(pausedClock.running, null);

  club.room.onDrop(first.client, 1006);
  await club.room.onReconnect(first.client);
  assert.equal(first.player.hall, 'street');
  assert.equal(first.player.connected, true);
  assert.deepEqual(first.closes, []);
  await first.cross('arcade');
  await club.syncPvp();
  assert.deepEqual((await matches())[0]?.disconnected.map(row => row.accountId), [first.accountId]);
  await second.send('activity', { type: 'chess-move', from: 'e7', to: 'e5' });
  activities.tick(.05);
  assert.deepEqual(chess.last, { from: 'e2', to: 'e4' });
  assert.deepEqual(chess.clock, pausedClock);
  assert.deepEqual(await Promise.all([first, second].map(visitor => accounts.wallet.snapshot(visitor.accountId))), funded);

  await first.cross('tables');
  await club.syncPvp();
  assert.deepEqual((await matches())[0]?.disconnected, []);
  assert.equal(first.player.playing, true);
  assert.deepEqual(activities.wagers.get('chess'), [first.client.sessionId, second.client.sessionId]);
  await second.send('activity', { type: 'chess-move', from: 'e7', to: 'e5' });
  assert.deepEqual(chess.last, { from: 'e7', to: 'e5' });
  await first.send('activity', { type: 'chess-resign' });
  await club.syncPvp();
  await club.syncPvp();
  assert.deepEqual(await matches(), []);
  const wallets = await Promise.all([first, second].map(visitor => accounts.wallet.snapshot(visitor.accountId)));
  assert.deepEqual(wallets.map(wallet => wallet.balance), [40, 59]);
  assert.deepEqual(wallets.map(wallet => wallet.entries.filter(entry => entry.source === 'pvp:chess').map(entry => entry.amount)), [[-10], [19, -10]]);
});
