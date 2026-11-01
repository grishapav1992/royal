import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALLS, hallLinks, hallLinkAt, hallRoute, hallObstacles, inHallDoor, type HallId } from '../src/shared/world';
import { RESTROOM, RESTROOM_WINDOW, RESTROOM_BALCONY } from '../src/shared/restroom';
import { atElevator, canTravelByElevator, elevatorDock, elevatorFloors } from '../src/shared/elevator';
import { findPath, walkable } from '../src/game/navigation';
import { applyMovementInput } from '../src/shared/movement';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';

test('the restroom connects only to floor three and has clear routes to every fixture and exit', () => {
  assert.equal(HALLS.restroom.floor, HALLS.github.floor);
  assert.deepEqual(hallLinks('restroom').map(link => link.target), ['github', 'restroom-balcony']);
  const entrance = hallLinks('github').find(link => link.target === 'restroom')!;
  assert(entrance);
  for (const hall of ['github', 'restroom'] as const) {
    const link = hall === 'github' ? entrance : hallLinks(hall)[0], obstacles = hallObstacles(hall);
    assert.equal(hallLinkAt({ hall, ...link.door.entry })?.target, link.target);
    assert(walkable(link.door.entry.x, link.door.entry.y, obstacles, 16));
    assert(findPath(HALLS[hall].spawn, link.door.entry, obstacles).length);
    const body = { hall, ...link.door.arrival, facing: link.door.facing, moving: false, seat: '', action: 'idle', drink: '', actionUntil: 0 };
    assert(!inHallDoor(body), 'arrival does not bounce back through the doorway');
    for (let seq = 1; seq < 20; seq++) {
      applyMovementInput(body, { seq, x: 0, y: link.door.facing === 'up' ? -1 : 1, ms: 50 });
      assert(!inHallDoor(body));
    }
  }
  const obstacles = hallObstacles('restroom');
  for (const point of [
    ...RESTROOM.stalls.map(x => ({ x, y: 370 })),
    ...RESTROOM.sinks.map(y => ({ x: 1170, y })),
    RESTROOM.exit.entry, RESTROOM_WINDOW.entry,
  ]) assert(findPath(RESTROOM.exit.arrival, point, obstacles).length, JSON.stringify(point));
  for (const point of [{ x: 145, y: 400 }, { x: 250, y: 270 }, { x: 1260, y: 370 }, { x: 1400, y: 700 }, { x: 900, y: 1080 }]) {
    assert(!walkable(point.x, point.y, obstacles), 'walls and fixtures stop movement');
  }
  assert.deepEqual(elevatorFloors(), ['arcade', 'tables', 'github']);
  assert(!atElevator({ hall: 'restroom', ...elevatorDock('restroom').entry }));
  assert(!canTravelByElevator({ hall: 'github', ...elevatorDock('github').entry }, 'restroom'));
  for (const source of Object.keys(HALLS) as HallId[]) {
    for (const target of Object.keys(HALLS) as HallId[]) {
      let hall = source;
      for (let step = 0; hall !== target && step < Object.keys(HALLS).length; step++) hall = hallRoute(hall, target)!.target;
      assert.equal(hall, target, 'NPC routes can reach and leave the room without looping');
    }
  }
});

test('the open window has clear approaches on both sides and the balcony rail contains movement', () => {
  for (const hall of ['restroom', 'restroom-balcony'] as const) {
    const link = hallLinks(hall).find(link => link.kind === 'window')!;
    const obstacles = hallObstacles(hall);
    assert.equal(hallLinkAt({ hall, ...RESTROOM_WINDOW.entry })?.target, link.target);
    assert(findPath(HALLS[hall].spawn, link.door.entry, obstacles).length);
    assert(walkable(link.door.entry.x, link.door.entry.y, obstacles, 16));
    assert(!inHallDoor({ hall, ...link.door.arrival }));
    assert(!canTravelByElevator({ hall, ...RESTROOM_WINDOW.arrival }, 'arcade'));
  }
  const body = { hall: 'restroom-balcony', ...RESTROOM_WINDOW.arrival, facing: 'down', moving: false, seat: '', action: 'idle', drink: '', actionUntil: 0 };
  for (let seq = 1; seq <= 200; seq++) applyMovementInput(body, { seq, x: 0, y: 1, ms: 50 });
  assert(body.y <= RESTROOM_BALCONY.bounds.bottom + 4, 'the near railing stops the player');
  assert(body.y > RESTROOM_WINDOW.arrival.y, 'the balcony can be explored');
  for (let seq = 201; seq <= 400; seq++) applyMovementInput(body, { seq, x: 1, y: 0, ms: 50 });
  assert(body.x <= RESTROOM_BALCONY.bounds.right + 4, 'the side railing stops the player');
  assert(!walkable(900, 680, hallObstacles('restroom-balcony')));
  assert(findPath(body, RESTROOM_WINDOW.entry, hallObstacles(body.hall)).length, 'the window remains reachable after exploring');
});

test('server transfers a visitor through the restroom and window and rejects movement from the previous location', async context => {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => void>();
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate();
  const login = await accounts.login(`restroom-${crypto.randomUUID()}@example.test`, 'Restroom-test-password!');
  await accounts.select(login.account.id, 0);
  const client: any = { sessionId: 'restroom-visitor', send() {}, leave() {} };
  await room.onJoin(client, {}, (await accounts.session(login.token))!);
  try {
    const player = room.state.players.get(client.sessionId)!;
    Object.assign(player, { hall: 'github', ...RESTROOM.entrance.entry });
    const revision = player.hallRevision;
    assert((room as any).enterDoor(client.sessionId));
    assert.equal(player.hall, 'restroom'); assert.equal(player.hallRevision, revision + 1);
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM.exit.arrival);
    assert(!(room as any).enterDoor(client.sessionId), 'arrival cannot instantly return');
    handlers.get('inputs')!(client, { revision, inputs: [{ seq: 1, x: 1, y: 0, ms: 50 }] });
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM.exit.arrival);
    Object.assign(player, RESTROOM_WINDOW.entry);
    for (const busy of [{ playing: true }, { security: 'ejecting' }, { seat: 'any' }, { action: 'drink' }]) {
      const saved = Object.fromEntries(Object.keys(busy).map(key => [key, (player as any)[key]]));
      Object.assign(player, busy);
      assert(!(room as any).enterDoor(client.sessionId), 'window follows the same activity and security locks as doors');
      assert.equal(player.hall, 'restroom'); Object.assign(player, saved);
    }
    assert((room as any).enterDoor(client.sessionId));
    assert.equal(player.hall, 'restroom-balcony'); assert.equal(player.hallRevision, revision + 2);
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM_WINDOW.arrival);
    assert(!(room as any).enterDoor(client.sessionId));
    handlers.get('inputs')!(client, { revision: revision + 1, inputs: [{ seq: 2, x: 1, y: 0, ms: 50 }] });
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM_WINDOW.arrival, 'old indoor inputs cannot move the outdoor arrival');
    Object.assign(player, RESTROOM_WINDOW.entry);
    assert((room as any).enterDoor(client.sessionId));
    assert.equal(player.hall, 'restroom'); assert.equal(player.hallRevision, revision + 3);
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM_WINDOW.arrival);
    assert(!(room as any).enterDoor(client.sessionId));
    Object.assign(player, RESTROOM.exit.entry);
    assert((room as any).enterDoor(client.sessionId));
    assert.equal(player.hall, 'github'); assert.equal(player.hallRevision, revision + 4);
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM.entrance.arrival);
  } finally {
    room.onDispose(); room.clock.clear(); await accounts.logout(login.token);
  }
});
