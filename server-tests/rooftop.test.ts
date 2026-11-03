import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkable } from '../src/game/navigation';
import { ROOF, ROOF_STAIRS, STREET_ROOF_STAIRS } from '../src/shared/rooftop';
import { HALLS, hallLinkAt, hallLinks, hallLinkToward, hallObstacles, type HallId } from '../src/shared/world';
import { atElevator, canTravelByElevator, elevatorFloors } from '../src/shared/elevator';
import { cabinetsInHall } from '../src/shared/cabinets';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { Guards } from '../server/guards';
import { LobbyState, Player } from '../server/state';

test('roof has a safe complete walking loop, solid equipment and guarded edges', () => {
  const obstacles = hallObstacles('roof'), points = [ROOF.spawn, ...ROOF.loop, ROOF.spawn, ROOF_STAIRS.entry];
  for (let i = 1; i < points.length; i++) {
    const path = findPath(points[i - 1], points[i], obstacles);
    assert(path.length, 'each roof sector is reachable');
    let before = points[i - 1];
    for (const next of path) {
      const steps = Math.max(1, Math.ceil(Math.hypot(next.x - before.x, next.y - before.y) / 3));
      for (let k = 0; k <= steps; k++) assert(walkable(before.x + (next.x - before.x) * k / steps, before.y + (next.y - before.y) * k / steps, obstacles));
      before = next;
    }
  }
  for (const p of [{ x: 100, y: 700 }, { x: 2150, y: 700 }, { x: 900, y: 250 }, { x: 900, y: 1250 }, { x: 530, y: 500 }, { x: 1120, y: 500 }]) assert(!walkable(p.x, p.y, obstacles));
  assert.equal(cabinetsInHall('roof').length, 0);
  assert(!elevatorFloors().includes('roof'));
  assert(!atElevator({ hall: 'roof', ...ROOF.spawn }));
  assert(!canTravelByElevator({ hall: 'arcade', x: 1060, y: 290 }, 'roof'));
});

test('roof uses only the rear street stairs, with safe arrivals and real multi-door navigation', () => {
  assert.deepEqual(hallLinks('roof').map(link => link.target), ['street']);
  assert.equal(hallLinkAt({ hall: 'street', ...STREET_ROOF_STAIRS.entry })?.target, 'roof');
  assert.equal(hallLinkAt({ hall: 'roof', ...ROOF_STAIRS.entry })?.target, 'street');
  for (const hall of ['street', 'roof'] as const) for (const link of hallLinks(hall)) {
    assert(walkable(link.arrival.arrival.x, link.arrival.arrival.y, hallObstacles(link.target), 16));
    assert(!hallLinkAt({ hall: link.target, ...link.arrival.arrival }));
  }
  for (const from of Object.keys(HALLS) as HallId[]) for (const target of Object.keys(HALLS) as HallId[]) {
    let here = from;
    const visited = new Set<HallId>();
    while (here !== target) {
      assert(!visited.has(here), 'routing cannot loop between floors'); visited.add(here);
      const link = hallLinkToward(here, target); assert(link); here = link.target;
    }
  }
  assert.equal(hallLinkToward('github', 'roof')?.target, 'tables');
  assert.equal(hallLinkToward('arcade', 'roof')?.target, 'street');
  assert.equal(hallLinkAt({ hall: 'street', x: 1660, y: 360 }), undefined, 'rear circulation lane does not trigger the stairs');
});

test('security can reach a roof visitor and finish without crossing a parapet', () => {
  for (const kind of ['warning', 'ejecting'] as const) {
    const state = new LobbyState(), completed: string[] = [], visited = new Set<string>();
    const guards = new Guards(state, (_id, decision) => completed.push(decision.kind), () => .5);
    const p = new Player(); Object.assign(p, { hall: 'roof', x: 1700, y: 1050 }); state.players.set('roof-visitor', p);
    guards.enqueue('roof-visitor', { kind, until: 1000 });
    for (let i = 0; i < 4500 && !completed.length; i++) {
      guards.tick(.05); const g = state.guards.get('security')!; visited.add(g.hall);
      assert(walkable(g.x, g.y, hallObstacles(g.hall)), 'security stays on accessible ground');
      assert.equal(p.hall, 'roof');
    }
    assert(visited.has('arcade') && visited.has('street') && visited.has('roof'));
    assert.deepEqual(completed, [kind]); assert(walkable(p.x, p.y, hallObstacles('roof')));
  }
});

test('server controls roof ascent and return, blocks busy visitors and ignores old movement packets', async context => {
  const session = await accounts.login(`roof-${crypto.randomUUID()}@example.test`, 'Roof-test-password!');
  await accounts.select(session.account.id, 0);
  const client: any = { sessionId: 'roof-test', auth: await accounts.session(session.token), send() {}, leave() {} };
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, data: unknown) => void>();
  context.mock.method(room, 'onMessage', (name: string, callback: any) => { handlers.set(name, callback); });
  context.mock.method(room, 'setPatchRate', () => {}); context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {}); context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); await room.onJoin(client, {}, client.auth);
  const enter = () => Reflect.get(room, 'enterDoor').call(room, client.sessionId);
  try {
    const p = room.state.players.get(client.sessionId)!;
    Object.assign(p, { hall: 'street', ...STREET_ROOF_STAIRS.foot }); assert.equal(enter(), false);
    Object.assign(p, STREET_ROOF_STAIRS.entry);
    for (const state of [{ playing: true }, { security: 'ejecting' }, { seat: 'occupied' }, { action: 'drink' }, { connected: false }]) {
      const saved = Object.fromEntries(Object.keys(state).map(key => [key, Reflect.get(p, key)]));
      Object.assign(p, state); assert.equal(enter(), false); Object.assign(p, saved);
    }
    const revision = p.hallRevision;
    assert.equal(enter(), true); assert.equal(p.hall, 'roof'); assert.equal(p.hallRevision, revision + 1);
    assert.equal(p.x, ROOF.spawn.x); assert.equal(p.y, ROOF.spawn.y); assert.equal(enter(), false);
    handlers.get('inputs')!(client, { revision, inputs: [{ seq: 1, x: 1, y: 0, ms: 50 }] });
    Reflect.get(room, 'tick').call(room, .05); assert.equal(p.x, ROOF.spawn.x);
    Object.assign(p, ROOF_STAIRS.entry); assert.equal(enter(), true);
    assert.equal(p.hall, 'street'); assert.equal(p.hallRevision, revision + 2);
    assert.equal(p.x, STREET_ROOF_STAIRS.arrival.x); assert.equal(p.y, STREET_ROOF_STAIRS.arrival.y); assert.equal(enter(), false);
  } finally { room.onDispose(); room.clock.clear(); await accounts.logout(session.token); }
});
