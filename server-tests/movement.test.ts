import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movementFacing, type Facing } from '../src/shared/movement';

test('diagonal walking keeps facing across coordinate rounding and variable frame durations', () => {
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    for (const initial of [dx < 0 ? 'left' : 'right', dy < 0 ? 'up' : 'down'] as Facing[]) {
      let facing = initial, x = 360, y = 570;
      for (let frame = 0; frame < 90; frame++) {
        const step = 155 * [16.6, 16.7, 17.1, 49.9, 50.1][frame % 5] / 1000 / Math.SQRT2;
        const nextX = x + dx * step, nextY = y + dy * step;
        facing = movementFacing(nextX - x, nextY - y, facing);
        assert.equal(facing, initial);
        x = nextX; y = nextY;
      }
    }
  }
});

test('releasing a key, reversing and sliding along a wall still turn the character', () => {
  assert.equal(movementFacing(4, 0, 'down'), 'right');
  assert.equal(movementFacing(0, 4, 'right'), 'down');
  assert.equal(movementFacing(-4, -4, 'down'), 'up');
  assert.equal(movementFacing(-4, 0, 'right'), 'left');
  assert.equal(movementFacing(0, 0, 'up'), 'up');
  assert.equal(movementFacing(4, 3.99, 'down'), 'down');
  assert.equal(movementFacing(4, 2, 'down'), 'right');
});

test('three collision substeps do not cause facing changes on the server', () => {
  let x = 420, y = 570, facing: Facing = 'down';
  for (let tick = 0; tick < 50; tick++) {
    const beforeX = x, beforeY = y;
    const step = 155 * (50 + Math.sin(tick) * .8) / 1000 / Math.SQRT2 / 3;
    for (let substep = 0; substep < 3; substep++) { x += step; y += step; }
    facing = movementFacing(x-beforeX, y-beforeY, facing);
    assert.equal(facing, 'down');
  }
});
