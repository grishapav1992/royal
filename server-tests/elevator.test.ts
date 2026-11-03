import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALLS, hallLinks, hallObstacles, type HallId } from '../src/shared/world';
import { atElevator, canTravelByElevator, elevatorDock, elevatorFloors } from '../src/shared/elevator';
import { findPath, walkable } from '../src/game/navigation';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';

test('every registered floor has a reachable independent elevator approach and exit', () => {
  const floors = elevatorFloors();
  assert.deepEqual(new Set(floors), new Set(Object.keys(HALLS)));
  assert.deepEqual(floors.map(hall => HALLS[hall].floor), [...floors.map(hall => HALLS[hall].floor)].sort((a, b) => a - b));
  for (const hall of floors) {
    const dock = elevatorDock(hall), obstacles = hallObstacles(hall);
    for (const point of [dock.entry, dock.arrival]) {
      assert(walkable(point.x, point.y, obstacles, 16), `${hall}: clear approach/exit`);
      const route = findPath(HALLS[hall].spawn, point, obstacles);
      assert(route.length > 0, `${hall}: reachable dock`);
      assert.deepEqual(route.at(-1), point);
      assert(!hallLinks(hall).some(({ door }) => point.x >= door.left && point.x <= door.right && point.y >= door.top && point.y <= door.bottom), 'arrival never triggers a staircase');
    }
    assert(atElevator({ ...dock.entry, hall }));
    assert(!atElevator({ ...HALLS[hall].spawn, hall }));
    assert(canTravelByElevator({ ...dock.entry, hall }, floors.find(other => other !== hall)));
    assert(!canTravelByElevator({ ...dock.entry, hall }, hall));
  }
  assert(!atElevator({ hall: '__proto__', x: 0, y: 0 }));
});

test('server authorizes direct travel, rejects stale/remote/busy commands and keeps visitors independent', async context => {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => void | Promise<void>>();
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate();
  const sessions: { token: string; client: any; results: any[] }[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const login = await accounts.login(`lift-${crypto.randomUUID()}@example.test`, 'Elevator-test-password!');
      await accounts.select(login.account.id, i);
      const results: any[] = [], auth = (await accounts.session(login.token))!;
      const client: any = { sessionId: `lift-${i}`, auth, send(type: string, value: unknown) { if (type === 'elevator-result') results.push(value); }, leave() {} };
      sessions.push({ token: login.token, client, results });await room.onJoin(client, {}, auth);
    }
    const first = sessions[0], second = sessions[1];
    const p = room.state.players.get(first.client.sessionId)!, other = room.state.players.get(second.client.sessionId)!;
    let requestId = 0;
    const travel = async (target: unknown, revision = p.hallRevision) => {
      await handlers.get('elevator')!(first.client, { target, revision, requestId: ++requestId });
      return first.results.at(-1);
    };
    const originalOther = { hall: other.hall, x: other.x, y: other.y, revision: other.hallRevision };
    assert.equal((await travel('github')).accepted, false, 'cannot summon travel from the middle of the room');
    Object.assign(p, elevatorDock('arcade').entry);
    for (const target of ['missing', '__proto__', '', 3, null, 'arcade']) assert.equal((await travel(target)).accepted, false);
    for (const state of [{ connected: false }, { security: 'ejecting' }]) {
      const saved = Object.fromEntries(Object.keys(state).map(key => [key, (p as any)[key]]));
      Object.assign(p, state);await travel('github');assert.equal(p.hall, 'arcade');Object.assign(p, saved);
    }
    for (const state of [{ playing: true }, { cabinet: 'any' }, { activity: 'chess' }, { seat: 'bar-0' }, { action: 'drink' }]) {
      const saved = Object.fromEntries(Object.keys(state).map(key => [key, (p as any)[key]]));
      Object.assign(p, state);assert.equal((await travel('github')).accepted, false);Object.assign(p, saved);
    }
    const hugCheck = context.mock.method((room as any).cat, 'isHugging', (id: string) => id === first.client.sessionId);
    assert.equal((await travel('github')).accepted, false, 'a carried cat prevents travel');
    hugCheck.mock.restore();
    const revision = p.hallRevision;
    assert.equal((await travel('github')).accepted, true, 'floor 1 goes straight to floor 3');
    assert.equal(p.hall, 'github');assert.equal(p.hallRevision, revision + 1);
    assert.equal(p.x, elevatorDock('github').arrival.x);assert.equal(p.y, elevatorDock('github').arrival.y);
    const arrival = { x: p.x, y: p.y };
    await handlers.get('inputs')!(first.client, { revision, inputs: [{ seq: 1, x: 1, y: 0, ms: 50 }] });
    assert.deepEqual({ x: p.x, y: p.y }, arrival, 'in-flight movement from the old floor is ignored');
    assert.equal((await travel('tables')).accepted, false, 'the exit is distinct from the boarding point');
    assert.equal((await travel('tables', revision)).accepted, false, 'old requests cannot move a new hall revision');
    for (const target of ['arcade', 'tables', 'github'] as HallId[]) {
      if (p.hall === target) continue;
      Object.assign(p, elevatorDock(p.hall as HallId).entry);
      assert.equal((await travel(target)).accepted, true);
    }
    assert.deepEqual({ hall: other.hall, x: other.x, y: other.y, revision: other.hallRevision }, originalOther);
    Object.assign(other, elevatorDock('arcade').entry);
    await handlers.get('elevator')!(second.client, { target: 'tables', revision: other.hallRevision, requestId: 1 });
    assert.equal(second.results.at(-1).accepted, true, 'another player travels without waiting for the first');
  } finally {
    room.onDispose();room.clock.clear();
    for (const session of sessions) await accounts.logout(session.token);
  }
});
