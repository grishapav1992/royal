import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkable, type Point } from '../src/game/navigation';
import { STREET, STREET_DOOR, CASINO_EXIT, streetFacadeAlpha } from '../src/shared/street';
import { HALLS, hallLinks, hallLinkAt, hallObstacles } from '../src/shared/world';
import { applyMovementInput } from '../src/shared/movement';
import { cabinetsInHall } from '../src/shared/cabinets';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { Guards } from '../server/guards';
import { LobbyState, Player } from '../server/state';

test('the front, both sides and rear form a completely walkable exterior loop', () => {
  const obstacles = hallObstacles('street');
  const points = [STREET.spawn, ...STREET.loop, STREET.loop[0], STREET_DOOR.entry];
  for (let i = 1; i < points.length; i++) {
    const path = findPath(points[i - 1], points[i], obstacles);
    assert(path.length, 'route around the casino exists');
    assert.deepEqual(path.at(-1), points[i]);
    let previous: Point = points[i - 1];
    for (const next of path) {
      const steps = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y) / 3));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        assert(walkable(previous.x + (next.x - previous.x) * t, previous.y + (next.y - previous.y) * t, obstacles));
      }
      previous = next;
    }
  }
  assert.equal(cabinetsInHall('street').length, 0, 'the street adds no games');
  const body = { hall: 'street', x: 1100, y: 1030, facing: 'up', moving: false, seat: '', action: 'idle', drink: '', actionUntil: 0 };
  for (let seq = 1; seq <= 200; seq++) applyMovementInput(body, { seq, x: 0, y: -1, ms: 50 });
  assert(body.y >= STREET.building.y + STREET.building.h + 12, 'keyboard movement cannot enter the footprint');
  assert(!walkable(2800, 1000, obstacles), 'the street has its own right boundary');
  assert(!walkable(1000, 1240, obstacles), 'the road is outside the pedestrian area');
});

test('the street connects only to the lower left of the first floor with safe arrivals', () => {
  assert.deepEqual(hallLinks('street').map(link => link.target), ['arcade']);
  assert.equal(hallLinkAt({ hall: 'arcade', ...CASINO_EXIT.entry })?.target, 'street');
  assert.equal(hallLinkAt({ hall: 'street', ...STREET_DOOR.entry })?.target, 'arcade');
  assert.equal(hallLinkAt({ hall: 'tables', ...CASINO_EXIT.entry }), undefined);
  assert.equal(hallLinkAt({ hall: 'github', ...CASINO_EXIT.entry }), undefined);
  assert(CASINO_EXIT.entry.x < 250 && CASINO_EXIT.entry.y >= 1290);
  for (const hall of ['street', 'arcade'] as const) {
    for (const link of hallLinks(hall)) {
      assert(findPath(HALLS[hall].spawn, link.door.entry, hallObstacles(hall)).length);
      assert(walkable(link.arrival.arrival.x, link.arrival.arrival.y, hallObstacles(link.target), 16));
      assert.equal(hallLinkAt({ hall: link.target, ...link.arrival.arrival }), undefined, 'arrival cannot bounce back');
    }
  }
});

test('facade visibility depends on occlusion, never on the number of floors', () => {
  assert.equal(streetFacadeAlpha(STREET.spawn), 1);
  assert.equal(streetFacadeAlpha({ x: 1300, y: 360 }), .16);
  assert.equal(streetFacadeAlpha({ x: 480, y: 360 }), 1);
  assert.equal(streetFacadeAlpha({ x: 2320, y: 360 }), 1);
});

test('security reaches outdoor players through the real door and escorts them on walkable street ground', () => {
  for(const kind of ['warning','ejecting'] as const){
    const state=new LobbyState(), completed:string[]=[], visited=new Set<string>();
    const guards=new Guards(state,(_id,decision)=>completed.push(decision.kind),()=>.5);
    const player=new Player();Object.assign(player,{hall:'street',x:1300,y:360});state.players.set('outside',player);
    guards.enqueue('outside',{kind,until:1000});
    for(let tick=0;tick<2200&&!completed.length;tick++){
      guards.tick(.05);const guard=state.guards.get('security')!;visited.add(guard.hall);
      assert(walkable(guard.x,guard.y,hallObstacles(guard.hall)),'guard never crosses a footprint');
      assert.equal(player.hall,'street','an escort does not silently change the player location');
    }
    assert(visited.has('arcade')&&visited.has('street'));
    assert.deepEqual(completed,[kind]);
    assert(walkable(player.x,player.y,hallObstacles('street')));
  }
});

test('server owns street transitions, pins movement revisions and refuses travel during play', async context => {
  const session = await accounts.login(`street-${crypto.randomUUID()}@example.test`, 'Street-test-password!');
  await accounts.select(session.account.id, 0);
  const client: any = { sessionId: 'street-test', auth: await accounts.session(session.token), send() {}, leave() {} };
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, data: unknown) => void>();
  context.mock.method(room, 'onMessage', (name: string, callback: any) => { handlers.set(name, callback); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); await room.onJoin(client, {}, client.auth);
  try {
    const player = room.state.players.get(client.sessionId)!;
    Object.assign(player, { hall: 'arcade', ...CASINO_EXIT.entry, playing: true });
    assert.equal(Reflect.get(room, 'enterDoor').call(room, client.sessionId), false);
    player.playing = false;
    const revision = player.hallRevision;
    assert.equal(Reflect.get(room, 'enterDoor').call(room, client.sessionId), true);
    assert.equal(player.hall, 'street');
    assert.equal(player.hallRevision, revision + 1);
    assert.equal(player.x, STREET.spawn.x); assert.equal(player.y, STREET.spawn.y);
    assert.equal(Reflect.get(room, 'enterDoor').call(room, client.sessionId), false);
    handlers.get('inputs')!(client, { revision, inputs: [{ seq: 1, x: 1, y: 0, ms: 50 }] });
    Reflect.get(room, 'tick').call(room, .05);
    assert.equal(player.x, STREET.spawn.x, 'an indoor movement packet is rejected outdoors');
    Object.assign(player, STREET_DOOR.entry);
    assert.equal(Reflect.get(room, 'enterDoor').call(room, client.sessionId), true);
    assert.equal(player.hall, 'arcade');
    assert.equal(player.hallRevision, revision + 2);
    assert.equal(player.x, CASINO_EXIT.arrival.x); assert.equal(player.y, CASINO_EXIT.arrival.y);
  } finally { room.onDispose(); room.clock.clear(); await accounts.logout(session.token); }
});
