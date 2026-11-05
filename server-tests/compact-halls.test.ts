import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES } from '../src/shared/activities';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { cabinetsInHall } from '../src/shared/cabinets';
import { CAT_CARE } from '../src/shared/catCare';
import { CAT_HOME } from '../src/shared/catHome';
import { hallBounds } from '../src/shared/clubGeometry';
import { elevatorDock, elevatorFloors } from '../src/shared/elevator';
import { STAIR_WINDOW } from '../src/shared/stairWindow';
import { activityHall, HALLS, hallLinks, hallObstacles, SEATS } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';

test('compact floors keep their destinations connected and block access beyond the new walls', () => {
  for (const hall of elevatorFloors()) {
    const spawn = HALLS[hall].spawn;
    const obstacles = hallObstacles(hall);
    const outside = { x: hallBounds(hall).right + 20, y: spawn.y };
    assert(!walkable(outside.x, outside.y, obstacles), hall);
    assert.deepEqual(findPath(spawn, outside, obstacles), [], hall);

    const destinations = [
      ...hallLinks(hall).map(({ door }) => door.entry),
      ...SEATS.filter(seat => seat.hall === hall).map(seat => seat.entry),
      ...cabinetsInHall(hall).map(cabinet => cabinetSeat(cabinet).entry),
      ...Object.entries(ACTIVITIES).filter(([id]) => activityHall(id) === hall).map(([, activity]) => activity.entry),
    ];
    if (hall === 'arcade') destinations.push(CAT_HOME.approach, CAT_CARE.food.approach, CAT_CARE.scratcher.approach);
    if (hall === 'github') destinations.push(STAIR_WINDOW.entry, STAIR_WINDOW.arrival);

    for (const point of destinations) {
      const label = `${hall} (${point.x}, ${point.y})`;
      assert(walkable(point.x, point.y, obstacles, 16), label);
      for (const origin of [spawn, elevatorDock(hall).arrival]) {
        assert.deepEqual(findPath(origin, point, obstacles).at(-1), point, label);
      }
    }
  }
});
