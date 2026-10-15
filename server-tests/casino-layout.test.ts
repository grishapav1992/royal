import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetHall, cabinetsInHall } from '../src/shared/cabinets';
import { isCardGame } from '../src/shared/cardTables';
import { ACTIVITIES } from '../src/shared/activities';
import { BAR_APPROACH, HALLS, HALL_DOORS, NPC_SPAWNS, SEATS, atBar, hallObstacles } from '../src/shared/world';
import { FURNITURE, furnitureBounds, PLANTS, plantBounds } from '../src/shared/furniture';
import { findPath, walkable, type Point, type Obstacle } from '../src/game/navigation';
import { guardPath } from '../server/guardNavigation';
import { GUARD_STOPS } from '../server/guardRoutine';
import { Guards } from '../server/guards';
import { LobbyState } from '../server/state';

function assertClearRoute(from: Point, to: Point, obstacles: Obstacle[], route: Point[], label: string) {
  assert(route.length > 0, label+' has a route');
  assert.deepEqual(route.at(-1),to,label+' reaches the intended destination');
  let previous = from;
  for (const point of route) {
    for (let step = 0; step <= 20; step++) {
      const t = step / 20;
      assert(walkable(previous.x+(point.x-previous.x)*t,previous.y+(point.y-previous.y)*t,obstacles),label+' crosses no solid bounds');
    }
    previous = point;
  }
}

test('all first-floor casino cabinets connect to the bar, piano, hall entrance and each other', () => {
  assert.equal(cabinetsInHall('arcade').length,52);
  assert(cabinetsInHall('arcade').every(c=>!isCardGame(c.id)));
  assert(CABINETS.every(c=>cabinetHall(c)===(isCardGame(c.id)?'github':'arcade')));
  const obstacles = hallObstacles('arcade');
  const approaches = cabinetsInHall('arcade').map(cabinet => ({id:cabinet.id,point:{x:cabinet.x,y:cabinet.y+43}}));
  const origins = [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH,ACTIVITIES.piano.entry,...approaches.map(approach => approach.point)];
  for (const {id,point} of approaches) {
    assert(walkable(point.x,point.y,obstacles,16),id+' has enough standing clearance');
    for (const origin of origins) assertClearRoute(origin,point,obstacles,findPath(origin,point,obstacles),id);
  }
  for (const destination of [BAR_APPROACH,ACTIVITIES.piano.entry,HALL_DOORS.arcade.entry]) {
    assert(walkable(destination.x,destination.y,obstacles,16));
    assertClearRoute(HALLS.arcade.spawn,destination,obstacles,findPath(HALLS.arcade.spawn,destination,obstacles),'retained interaction');
  }
  assert(atBar(BAR_APPROACH));
});

test('Luelon remains on the first floor with clear routes to the bar and doors', () => {
  const cabinet = CABINETS.find(item => item.id === 'luelon');
  assert(cabinet);
  assert.equal(cabinetHall(cabinet),'arcade');
  assert.equal(cabinet.demo,true);
  assert.equal(cabinet.playable,true);
  assert.deepEqual(cabinetsInHall('tables').map(item => item.id),[]);
  for (const id of ['breaker','orbit','drift','pixel']) assert(!CABINETS.some(item => item.id === id),id+' stays removed');
  const obstacles = hallObstacles('arcade'), approach = {x:cabinet.x,y:cabinet.y+43};
  assert(walkable(approach.x,approach.y,obstacles,16),'Luelon approach has standing clearance');
  assert(!walkable(cabinet.x,cabinet.y-25,obstacles),'Luelon cabinet remains solid');
  for (const origin of [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH,ACTIVITIES.piano.entry]) {
    assertClearRoute(origin,approach,obstacles,findPath(origin,approach,obstacles),'Luelon');
  }
  assertClearRoute(approach,HALL_DOORS.arcade.entry,obstacles,findPath(approach,HALL_DOORS.arcade.entry,obstacles),'Luelon exit');
});

test('removed first-hall furniture has no ghost solids while second-hall solids stay intact', () => {
  assert.equal(SEATS.filter(seat=>seat.kind==='bar').length,3);
  for(const seat of SEATS)assert(walkable(seat.entry.x,seat.entry.y,hallObstacles(seat.hall??'arcade')),'new seat has a clear approach');
  const arcade = hallObstacles('arcade'), tables = hallObstacles('tables');
  assert(walkable(230,430,arcade),'the former sofa area is open');
  for (const x of [790,866,942]) assert(walkable(x,544,arcade),'a removed bar stool cannot block the floor');
  for (const plant of PLANTS) {
    const bounds = plantBounds(plant), point = {x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2};
    assert(walkable(point.x,point.y,arcade),'first-hall plant area is open');
    assert(!walkable(point.x,point.y,tables),'second-hall plant remains solid');
  }
  for (const bounds of [furnitureBounds(FURNITURE.pool),furnitureBounds(FURNITURE.table),ACTIVITIES.hockey.bounds]) {
    assert(!walkable(bounds.x+bounds.w/2,bounds.y+bounds.h/2,tables),'table-game furniture remains solid');
  }
  for (const id of ['hockey','pool','chess'] as const) {
    const point = ACTIVITIES[id].entry;
    assertClearRoute(HALLS.tables.spawn,point,tables,findPath(HALLS.tables.spawn,point,tables),id);
  }
});

test('all player spawns, offline visitors and hall-door positions remain clear', () => {
  const obstacles = hallObstacles('arcade');
  for (let index = 0; index < 24; index++) {
    const point = {x:420+index%8*40,y:570+Math.floor(index%24/8)*25};
    assert(walkable(point.x,point.y,obstacles,16),'network spawn '+index);
  }
  for (const [x,y] of NPC_SPAWNS) assert(walkable(x,y,obstacles,16),'offline visitor spawn');
  for (const hall of ['arcade','tables'] as const) {
    const hallBounds = hallObstacles(hall);
    for (const point of [HALL_DOORS[hall].entry,HALL_DOORS[hall].arrival]) assert(walkable(point.x,point.y,hallBounds,16),hall+' doorway');
  }
});

test('guard reaches every patrol stop and completes both halls without crossing relocated cabinets', () => {
  for (const hall of ['arcade','tables'] as const) {
    const obstacles = hallObstacles(hall), destinations = GUARD_STOPS[hall];
    for (const destination of destinations) {
      assert(walkable(destination.x,destination.y,obstacles),hall+' '+destination.id+' is outside solids');
      for (const origin of [HALL_DOORS[hall].arrival,...destinations]) {
        assertClearRoute(origin,destination,obstacles,guardPath(origin,destination,obstacles),hall+' '+destination.id);
      }
    }
  }
  const state = new LobbyState();
  let seed = 2;
  const random = () => {seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  const guards = new Guards(state,() => {},random), visited = new Map<string,Set<string>>();
  for (let step = 0; step < 12000; step++) {
    guards.tick(.05);
    const guard = state.guards.get('security')!;
    assert(walkable(guard.x,guard.y,hallObstacles(guard.hall)),guard.hall+' patrol stays outside solids');
    if (['chat','window','inspect','watch'].includes(guard.phase)) {
      if (!visited.has(guard.hall)) visited.set(guard.hall,new Set());
      visited.get(guard.hall)!.add(guard.routine);
    }
  }
  for (const hall of ['arcade','tables'] as const) {
    for (const stop of GUARD_STOPS[hall]) assert(visited.get(hall)?.has(stop.id),hall+' patrol reaches '+stop.id);
  }
});
