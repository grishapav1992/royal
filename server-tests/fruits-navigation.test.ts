import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINETS } from '../src/shared/cabinets';
import { HALLS, hallObstacles } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';

test('Royal Fruits cabinet can be reached from the casino entrance without crossing furniture', () => {
  const cabinet = CABINETS.find(item => item.id === 'royal-fruits');
  assert.ok(cabinet?.wallet && cabinet.playable);
  const obstacles = hallObstacles('arcade');
  const approach = { x: cabinet.x, y: cabinet.y + 43 };
  assert.ok(walkable(approach.x, approach.y, obstacles));
  const path = findPath(HALLS.arcade.spawn, approach, obstacles);
  assert.ok(path.length > 0);
  for (const point of path) assert.ok(walkable(point.x, point.y, obstacles));
  assert.ok(Math.hypot(path.at(-1)!.x - approach.x, path.at(-1)!.y - approach.y) < 30);
});
