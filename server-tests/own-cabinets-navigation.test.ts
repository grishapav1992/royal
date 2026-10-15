import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetHall, cabinetsInHall } from '../src/shared/cabinets';
import { HALLS, HALL_DOORS, hallObstacles } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';

test('each cabinet is reachable from its hall entrance and hall door', () => {
  for (const cabinet of CABINETS) {
    const hall = cabinetHall(cabinet), obstacles = hallObstacles(hall);
    const approach = { x: cabinet.x, y: cabinet.y + 43 };
    assert.ok(walkable(approach.x, approach.y, obstacles), cabinet.id);
    for (const origin of [HALLS[hall].spawn, HALL_DOORS[hall].arrival]) {
      const path = findPath(origin, approach, obstacles);
      assert.ok(path.length > 0, `${cabinet.id}: reachable`);
      for (const point of path) assert.ok(walkable(point.x, point.y, obstacles), cabinet.id);
      assert.deepEqual(path.at(-1), approach);
    }
  }
});

test('players can move between individual cabinets without crossing furniture', () => {
  for (const hall of ['arcade', 'tables'] as const) {
    const obstacles = hallObstacles(hall), cabinets = cabinetsInHall(hall);
    for (const origin of cabinets) for (const target of cabinets) {
      const path = findPath({ x: origin.x, y: origin.y + 43 }, { x: target.x, y: target.y + 43 }, obstacles);
      assert.ok(path.length > 0, `${origin.id} to ${target.id}`);
      for (const point of path) assert.ok(walkable(point.x, point.y, obstacles));
    }
  }
});

test('the lower row leaves grid-aligned passages instead of a detour to the wall', () => {
  const dice = CABINETS.find(cabinet => cabinet.id === 'royal-dice')!;
  const keno = CABINETS.find(cabinet => cabinet.id === 'royal-keno')!;
  const route = findPath({ x: dice.x, y: dice.y + 43 }, { x: keno.x, y: keno.y + 43 }, hallObstacles('arcade'));
  assert(route.length > 0);
  assert(route.every(point => point.x >= 400), 'an open passage between cabinets avoids the distant left wall');
});
