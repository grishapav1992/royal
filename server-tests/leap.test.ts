import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOUNDS, walkable } from '../src/game/navigation';
import { cabinetsInHall, cabinetBounds } from '../src/shared/cabinets';
import { FURNITURE, furnitureBounds } from '../src/shared/furniture';
import { LEAP_COOLDOWN_MS, LEAP_RULES, leapLanding } from '../src/shared/leap';
import { applyMovementInput, type MovementBody } from '../src/shared/movement';
import { obstacleKind } from '../src/shared/obstacleKinds';
import { hallObstacles, PLAYER_SPRINT_SPEED } from '../src/shared/world';
import { MovementInputs } from '../server/movementInputs';

const body = (x: number, y: number, hall = 'arcade', facing = 'up'): MovementBody =>
  ({ x, y, hall, facing, moving: false, seat: '', action: 'idle', drink: '', actionUntil: 0 });

// A cabinet with open floor directly in front of and behind it.
function openCabinet() {
  const obstacles = hallObstacles('arcade');
  for (const cabinet of cabinetsInHall('arcade')) {
    const b = cabinetBounds(cabinet), x = b.x + b.w / 2, below = b.y + b.h + 16, above = b.y - 40;
    if (walkable(x, below, obstacles) && walkable(x, above, obstacles)) return { x, below, top: b.y };
  }
  throw new Error('no open cabinet in the first-floor layout');
}

// A horizontal strip of open floor long enough for a second of sprinting.
function openStrip() {
  const obstacles = hallObstacles('arcade');
  for (let y = 300; y < 1250; y += 20) for (let x = 200; x < 4000; x += 40) {
    let open = true;
    for (let dx = 0; dx <= 420 && open; dx += 6) open = walkable(x + dx, y, obstacles);
    if (open) return { x, y };
  }
  throw new Error('no open strip in the first-floor layout');
}

test('obstacles are classified: cabinets jump, game tables slide, the bar stays solid', () => {
  const kinds = new Set(hallObstacles('arcade').map(obstacleKind));
  assert(kinds.has('vault') && kinds.has('solid'));
  const tables = hallObstacles('tables');
  const pool = furnitureBounds(FURNITURE.pool);
  assert.equal(obstacleKind(tables.find(o => o.x === pool.x && o.y === pool.y && o.w === pool.w)!), 'under');
});

test('a jump clears a cabinet that walking cannot pass, and lands on open floor', () => {
  const { x, below, top } = openCabinet();
  const walker = body(x, below);
  for (let i = 0; i < 20; i++) applyMovementInput(walker, { seq: i, x: 0, y: -1, ms: 50, sprint: true });
  assert(walker.y > top, 'walking stops at the cabinet');

  const jumper = body(x, below);
  applyMovementInput(jumper, { seq: 1, x: 0, y: -1, ms: 0, leap: 'jump' });
  assert(jumper.y < top, 'the jump lands beyond the cabinet');
  assert(walkable(jumper.x, jumper.y, hallObstacles('arcade')));
  assert.equal(jumper.leapSerial, 1);
  assert.equal(jumper.leapKind, 'jump');
  assert.equal(jumper.leapFromY, below);
});

test('a slide needs a sprint and passes under the pool table, which a jump cannot clear', () => {
  // Across the short side of the table, from the open floor below it.
  const pool = furnitureBounds(FURNITURE.pool), x = pool.x + pool.w / 2, start = pool.y + pool.h + 14;
  assert(walkable(x, start, hallObstacles('tables')));
  const jump = leapLanding(body(x, start, 'tables'), 'jump', { x: 0, y: -1 });
  assert(!jump || jump.y > pool.y + pool.h, 'a jump never crosses a table');

  const walking = body(x, start, 'tables');
  applyMovementInput(walking, { seq: 1, x: 0, y: -1, ms: 0, leap: 'slide' });
  assert.equal(walking.leapSerial, undefined, 'a slide without a sprint does nothing');

  const sliding = body(x, start, 'tables');
  applyMovementInput(sliding, { seq: 1, x: 0, y: -1, ms: 0, sprint: true, leap: 'slide' });
  assert(sliding.y < pool.y, 'the slide comes out on the other side');
  assert(walkable(sliding.x, sliding.y, hallObstacles('tables')));
});

test('the distance owed after a leap makes it no faster than sprinting on open floor', () => {
  const { x, y } = openStrip();
  const sprinter = body(x, y, 'arcade', 'right'), jumper = body(x, y, 'arcade', 'right');
  applyMovementInput(jumper, { seq: 0, x: 1, y: 0, ms: 0, sprint: true, leap: 'jump' });
  assert.equal(jumper.leapDebt, LEAP_RULES.jump.distance);
  for (let i = 1; i <= 20; i++) {
    applyMovementInput(sprinter, { seq: i, x: 1, y: 0, ms: 50, sprint: true });
    applyMovementInput(jumper, { seq: i, x: 1, y: 0, ms: 50, sprint: true });
  }
  assert(Math.abs(jumper.x - sprinter.x) < .01, 'a second of sprinting covers the same distance either way');
  assert.equal(jumper.leapDebt, 0);
  assert(Math.abs(sprinter.x - x - PLAYER_SPRINT_SPEED) < .01);
});

test('a leap never passes through a guard', () => {
  const { x, y } = openStrip();
  const start = body(x, y, 'arcade', 'right');
  const guard = { x: start.x + 60, y: start.y, hall: 'arcade', phase: 'approach' };
  const landing = leapLanding(start, 'jump', { x: 1, y: 0 }, [guard]);
  assert(!landing || landing.x < guard.x - 30, 'the jump stops in front of the guard');
});

test('the server accepts one leap per cooldown and still applies the movement of a refused one', () => {
  const { x, y } = openStrip();
  const player = body(x, y, 'arcade', 'right'), inputs = new MovementInputs(0);
  inputs.accept(player, [{ seq: 1, x: 1, y: 0, ms: 0, sprint: true, leap: 'jump' }], 100);
  assert.equal(player.leapSerial, 1);
  inputs.accept(player, [{ seq: 2, x: 1, y: 0, ms: 0, sprint: true, leap: 'jump' }], 100 + LEAP_COOLDOWN_MS - 1);
  assert.equal(player.leapSerial, 1, 'a second leap inside the window is refused');
  inputs.accept(player, [{ seq: 3, x: 1, y: 0, ms: 0, sprint: true, leap: 'jump' }], 100 + LEAP_COOLDOWN_MS);
  assert.equal(player.leapSerial, 2);
  assert.equal(inputs.accept(player, [{ seq: 4, x: 1, y: 0, ms: 0, leap: 'fly' }], 5000), false, 'unknown leaps are rejected');
});

test('a click route continues after a leap while the owed distance is paid off', async () => {
  const { MovementPrediction, advanceClickMovement } = await import('../src/network/MovementPrediction');
  const { x, y } = openStrip();
  const player = body(x, y, 'arcade', 'right'), prediction = new MovementPrediction();
  prediction.step(player, 1, 0, 0, true, [], false, 'jump');
  assert(player.leapDebt! > 0);
  const path = [{ x: x + LEAP_RULES.jump.distance + 200, y }];
  for (let i = 0; i < 20 && path.length; i++) advanceClickMovement(player, path, 50, prediction, [], true);
  assert.equal(player.leapDebt, 0, 'the debt is paid by the route');
  assert(player.x > x + LEAP_RULES.jump.distance + 20, 'the route keeps moving after the debt');
});

test('a jump against a wall hops on the spot without moving or owing distance', () => {
  const player = body(200, 300, 'arcade', 'up');
  const obstacles = hallObstacles('arcade');
  // Against the outer wall at the top of the hall, which no leap crosses.
  let start = { x: 0, y: 0 };
  for (let x = 200; x < 4000 && !start.x; x += 20) if (walkable(x, BOUNDS.top + 2, obstacles)) start = { x, y: BOUNDS.top + 2 };
  assert(start.x, 'open floor along the top wall');
  Object.assign(player, start);
  applyMovementInput(player, { seq: 1, x: 0, y: -1, ms: 0, leap: 'jump' });
  assert.equal(player.leapSerial, 1);
  assert.deepEqual([player.x, player.y], [start.x, start.y]);
  assert.equal(player.leapDebt, 0);
  const slider = body(start.x, start.y, 'arcade', 'up');
  applyMovementInput(slider, { seq: 1, x: 0, y: -1, ms: 0, sprint: true, leap: 'slide' });
  assert.equal(slider.leapSerial, undefined);
});
