import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, walkable } from '../src/game/navigation';
import { ROOF, ROOF_STAIRS, STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE, advanceRoofStairStep } from '../src/shared/rooftop';
import { HALLS, hallLinkAt, hallLinks, hallLinkToward, hallObstacles, type HallId } from '../src/shared/world';
import { atElevator, canTravelByElevator, elevatorFloors } from '../src/shared/elevator';
import { cabinetsInHall } from '../src/shared/cabinets';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { Guards } from '../server/guards';
import { LobbyState, Player } from '../server/state';
import { StreetView } from '../src/game/streetView';
import { roofStairContains } from '../src/game/roofStairInput';

test('visible ladder rungs, flights and landings accept input without capturing the rear pavement',()=>{
  const view=new StreetView();view.configure({x:1660,y:360},false);
  const route=ROOF_STAIR_ROUTE.map(p=>view.point(p,true)),foot=route[0];
  assert(roofStairContains({x:foot.x,y:foot.y-80},route,false),'middle rung is clickable');
  for(const index of [1,3,5,7])assert(roofStairContains({x:route[index].x,y:route[index].y-35},route,false),'landing rail is clickable');
  for(const [start,end] of [[1,2],[3,4],[5,6]]){
    const a=route[start],b=route[end];
    assert(roofStairContains({x:(a.x+b.x)/2,y:(a.y+b.y)/2-20},route,false),'flight accepts a click between tread and rail');
  }
  for(let x=320;x<=2500;x+=10)assert(!roofStairContains(view.point({x,y:360}),route,false),'rear circulation lane stays free');
  assert(!roofStairContains({x:foot.x+100,y:foot.y-80},route,false),'wall beside the ladder is not interactive');
  view.configure({x:1660,y:360},true);
  const plan=ROOF_STAIR_ROUTE.map(p=>view.point(p,true));
  assert(roofStairContains(STREET_ROOF_STAIRS.click,plan,true));
  assert(!roofStairContains({x:1660,y:360},plan,true),'overview retains the pavement route');
});

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
    Object.assign(p, STREET_ROOF_STAIRS.entry); assert.equal(enter(),false,'walking straight to the top does not bypass the flights');
    Object.assign(p, STREET_ROOF_STAIRS.foot);
    for (const state of [{ playing: true }, { security: 'ejecting' }, { seat: 'occupied' }, { action: 'drink' }, { connected: false }]) {
      const saved = Object.fromEntries(Object.keys(state).map(key => [key, Reflect.get(p, key)]));
      Object.assign(p, state); assert.equal(enter(), false); Object.assign(p, saved);
    }
    const revision = p.hallRevision;
    assert.equal(enter(),false);
    assert.equal(p.stairStep,1);
    for(let segment=1;segment<ROOF_STAIR_ROUTE.length&&p.hall==='street';segment++){
      const from=ROOF_STAIR_ROUTE[segment-1],to=ROOF_STAIR_ROUTE[segment],steps=Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/3);
      for(let step=1;step<=steps&&p.hall==='street';step++){
        Object.assign(p,{x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps});
        enter();
      }
    } assert.equal(p.hall, 'roof'); assert.equal(p.hallRevision, revision + 1);
    assert.equal(p.x, ROOF.spawn.x); assert.equal(p.y, ROOF.spawn.y); assert.equal(enter(), false);
    handlers.get('inputs')!(client, { revision, inputs: [{ seq: 1, x: 1, y: 0, ms: 50 }] });
    Reflect.get(room, 'tick').call(room, .05); assert.equal(p.x, ROOF.spawn.x);
    Object.assign(p, ROOF_STAIRS.entry); assert.equal(enter(), true);
    assert.equal(p.hall, 'street'); assert.equal(p.hallRevision, revision + 2);
    assert.equal(p.x, STREET_ROOF_STAIRS.arrival.x); assert.equal(p.y, STREET_ROOF_STAIRS.arrival.y); assert.equal(enter(), false);
  } finally { room.onDispose(); room.clock.clear(); await accounts.logout(session.token); }
});


test('switchback progress requires every flight, stays walkable and resets on leaving the stairs',()=>{
  const obstacles=hallObstacles('street');let progress=0;const reached=new Set<number>();
  for(let segment=1;segment<ROOF_STAIR_ROUTE.length;segment++){
    const from=ROOF_STAIR_ROUTE[segment-1],to=ROOF_STAIR_ROUTE[segment],steps=Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/3);
    for(let step=0;step<=steps;step++){
      const point={x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps};
      assert(walkable(point.x,point.y,obstacles,16));
      progress=advanceRoofStairStep(progress,point);reached.add(progress);
    }
  }
  assert.equal(progress,ROOF_STAIR_ROUTE.length);
  for(let step=1;step<=ROOF_STAIR_ROUTE.length;step++)assert(reached.has(step));
  assert.equal(advanceRoofStairStep(0,STREET_ROOF_STAIRS.entry),0);
  assert.equal(advanceRoofStairStep(1,ROOF_STAIR_ROUTE[5]),0,'cannot jump to a later flight');
  assert.equal(advanceRoofStairStep(3,{x:1660,y:360}),0,'the normal underpass does not earn a landing');
  assert.equal(advanceRoofStairStep(2,{x:1900,y:700}),0);
  assert.equal(advanceRoofStairStep(999,STREET_ROOF_STAIRS.entry),0);
});
