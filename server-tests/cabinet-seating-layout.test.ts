import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS, cabinetHall } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { hallObstacles, HALLS } from '../src/shared/world';
import { walkable, findPath } from '../src/game/navigation';

test('all cabinet stools have a clear approach and an exit route on their own floor', () => {
  for (const cabinet of CABINETS) {
    const hall = cabinetHall(cabinet), seat = cabinetSeat(cabinet), obstacles = hallObstacles(hall);
    assert(walkable(seat.x, seat.y, obstacles, 16), cabinet.id + ' seat clears the machine');
    assert(walkable(seat.entry.x, seat.entry.y, obstacles, 16), cabinet.id + ' entry clears nearby furniture');
    const route = findPath(HALLS[hall].spawn, seat.entry, obstacles);
    assert(route.length, cabinet.id + ' has a route to the stool');
    assert.deepEqual(route.at(-1), seat.entry);
    assert(findPath(seat.entry, HALLS[hall].spawn, obstacles).length, cabinet.id + ' has a route back');
  }
});
