import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickMovementPath } from '../src/game/drunkNavigation';
import { findPath, walkable, type Point } from '../src/game/navigation';
import { hallObstacles, HALLS, inHallDoor } from '../src/shared/world';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';

test('random floor routes stay reachable inside every hall and avoid doors along the whole route', () => {
  const now = 1800000000000, clicked = { x: 720, y: 620 };
  for (const hall of Object.keys(HALLS) as (keyof typeof HALLS)[]) {
    const from = { ...HALLS[hall].spawn, hall, soberAt: now + MAX_SOBER_TIME_MS };
    const destinations = new Set<string>();
    for (const sample of [0, .12, .25, .5, .75, .99]) {
      const path = clickMovementPath(from, clicked, true, () => sample, now);
      assert.ok(path.length, hall);
      const target = path.at(-1)!;
      assert.ok(Math.hypot(target.x - clicked.x, target.y - clicked.y) >= 140);
      assert.ok(Math.hypot(target.x - from.x, target.y - from.y) >= 100);
      destinations.add(`${target.x},${target.y}`);
      let previous: Point = from;
      for (const end of path) {
        const steps = Math.max(1, Math.ceil(Math.hypot(end.x - previous.x, end.y - previous.y) / 2));
        for (let i = 0; i <= steps; i++) {
          const point = { x: previous.x + (end.x - previous.x) * i / steps, y: previous.y + (end.y - previous.y) * i / steps };
          assert.ok(walkable(point.x, point.y, hallObstacles(hall)), hall);
          assert.equal(inHallDoor({ ...point, hall }), false, hall);
        }
        previous = end;
      }
    }
    assert.ok(destinations.size >= 4, hall);
  }
});

test('ordinary clicks recover below the strongest stage and interaction routes stay usable while drunk', () => {
  const now = 1800000000000, clicked = { x: 720, y: 620 }, from = { x: 540, y: 590, hall: 'arcade', soberAt: now + MAX_SOBER_TIME_MS };
  const route = findPath(from, clicked, hallObstacles(from.hall));
  assert.deepEqual(clickMovementPath(from, clicked, false, () => 0, now), route);
  for (const soberAt of [0, now + 1000, now + MAX_SOBER_TIME_MS * 2 / 3]) {
    assert.deepEqual(clickMovementPath({ ...from, soberAt }, clicked, true, () => 0, now), route);
  }
});
