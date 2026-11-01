import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALLS, hallLinks, hallLinkAt, hallRoute, hallObstacles, inHallDoor, type HallId } from '../src/shared/world';
import { RESTROOM } from '../src/shared/restroom';
import { atElevator, canTravelByElevator, elevatorDock, elevatorFloors } from '../src/shared/elevator';
import { findPath, walkable } from '../src/game/navigation';
import { applyMovementInput } from '../src/shared/movement';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';

test('the restroom connects only to floor three and has clear routes to every fixture and exit', () => {
  assert.equal(HALLS.restroom.floor, HALLS.github.floor);
  assert.deepEqual(hallLinks('restroom').map(link => link.target), ['github']);
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
    RESTROOM.exit.entry,
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
      for (let step = 0; hall !== target && step < 4; step++) hall = hallRoute(hall, target)!.target;
      assert.equal(hall, target, 'NPC routes can reach and leave the room without looping');
    }
  }
});

test('server transfers a visitor through the restroom doorway and rejects movement from the previous location', async context => {
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
    Object.assign(player, RESTROOM.exit.entry);
    assert((room as any).enterDoor(client.sessionId));
    assert.equal(player.hall, 'github'); assert.equal(player.hallRevision, revision + 2);
    assert.deepEqual({ x: player.x, y: player.y }, RESTROOM.entrance.arrival);
  } finally {
    room.onDispose(); room.clock.clear(); await accounts.logout(login.token);
  }
});
