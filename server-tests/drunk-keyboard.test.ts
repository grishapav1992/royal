import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drunkKeyboardDirection, nextDrunkLayout } from '../src/shared/drunkControls';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';
import { applyMovementInput, type MovementBody } from '../src/shared/movement';
import { MovementInputs } from '../server/movementInputs';
import { MovementPrediction } from '../src/network/MovementPrediction';

const now = 1800000000000;
const maximum = now + MAX_SOBER_TIME_MS;
const physical = (directions: number) => ({
  x: Number(Boolean(directions & 2)) - Number(Boolean(directions & 8)),
  y: Number(Boolean(directions & 4)) - Number(Boolean(directions & 1)), directions,
});
const body = (controlLayout = 3): MovementBody => ({ hall: 'arcade', x: 420, y: 570, soberAt: maximum, controlLayout,
  facing: 'down', moving: false, seat: '', action: 'idle', drink: '', actionUntil: 0 });

test('all nine drunken layouts change every key and remain stable for the selected layout', () => {
  const original = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  const permutations = new Set<string>();
  for (let layout = 1; layout <= 9; layout++) {
    const mapped = original.map((direction, key) => {
      const input = { ...direction, directions: 1 << key };
      const result = drunkKeyboardDirection(maximum, layout, input, now);
      assert.notDeepEqual(result, direction);
      assert.deepEqual(result, drunkKeyboardDirection(maximum + 60000, layout, input, now));
      assert.deepEqual(result, drunkKeyboardDirection(maximum, layout, input, now + 60000));
      return result;
    });
    assert.equal(new Set(mapped.map(direction => JSON.stringify(direction))).size, 4);
    permutations.add(JSON.stringify(mapped));
  }
  assert.equal(permutations.size, 9);
});

test('the next layout always differs from the previous one, including repeated random values', () => {
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => nextDrunkLayout(0, () => (index + .5) / 9)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let previous = 1; previous <= 9; previous++) {
    const seen = new Set<number>();
    for (let index = 0; index < 8; index++) {
      const selected = nextDrunkLayout(previous, () => (index + .5) / 8);
      assert.notEqual(selected, previous); assert.ok(selected >= 1 && selected <= 9);
      seen.add(selected);
    }
    assert.equal(seen.size, 8);
    for (const value of [0, .5, 1, -1, NaN, Infinity]) assert.notEqual(nextDrunkLayout(previous, () => value), previous);
  }
  let selected = 0;
  for (let episode = 0; episode < 20; episode++) {
    const next = nextDrunkLayout(selected, () => .5);
    assert.notEqual(next, selected); selected = next;
  }
});

test('only maximum intoxication remaps controls and invalid layouts use the stable first layout', () => {
  for (const remaining of [0, MAX_SOBER_TIME_MS / 3, MAX_SOBER_TIME_MS * 2 / 3]) {
    for (let directions = 0; directions <= 15; directions++) {
      const input = physical(directions);
      assert.deepEqual(drunkKeyboardDirection(now + remaining, 3, input, now), { x: input.x, y: input.y });
    }
  }
  const input = physical(1);
  const fallback = drunkKeyboardDirection(maximum, 1, input, now);
  for (const invalid of [0, -1, 10, .5, NaN, Infinity]) assert.deepEqual(drunkKeyboardDirection(maximum, invalid, input, now), fallback);
  assert.deepEqual(drunkKeyboardDirection(maximum, 3, { x: 1, y: -1 }, now), { x: 0, y: 0 });
});

test('the physical mask remaps opposite keys before combining and normalizes diagonal movement', context => {
  context.mock.method(Date, 'now', () => now);
  assert.deepEqual(drunkKeyboardDirection(maximum, 3, physical(5), now), { x: 1, y: -1 });
  assert.deepEqual(drunkKeyboardDirection(maximum, 3, physical(3), now), { x: 0, y: 0 });
  for (let layout = 1; layout <= 9; layout++) {
    assert.deepEqual(drunkKeyboardDirection(maximum, layout, physical(15), now), { x: 0, y: 0 });
    assert.deepEqual(drunkKeyboardDirection(maximum, layout, physical(0), now), { x: 0, y: 0 });
  }
  const diagonal = body(1), cardinal = body(1);
  applyMovementInput(diagonal, { seq: 1, ...physical(3), ms: 16 });
  applyMovementInput(cardinal, { seq: 1, ...physical(1), ms: 16 });
  assert.ok(Math.abs(Math.hypot(diagonal.x - 420, diagonal.y - 570) - Math.hypot(cardinal.x - 420, cardinal.y - 570)) < 1e-10);
  const cancelled = body(3);
  applyMovementInput(cancelled, { seq: 1, ...physical(3), ms: 16 });
  assert.equal(cancelled.x, 420); assert.equal(cancelled.y, 570); assert.equal(cancelled.moving, false);
});

test('server rejects invalid or contradictory physical masks and preserves accepted opposite keys', context => {
  context.mock.method(Date, 'now', () => now);
  const limiter = new MovementInputs(now), player = body();
  for (const directions of [-1, 16, 1.5, '1', null, NaN]) {
    assert.equal(limiter.accept(player, [{ seq: 1, x: 0, y: -1, directions, ms: 16 }], now), false);
  }
  assert.equal(limiter.accept(player, [{ seq: 1, x: 1, y: 0, directions: 1, ms: 16 }], now), false);
  assert.equal(limiter.accept(player, [{ seq: 1, ...physical(5), ms: 16 }], now), true);
  assert.ok(player.x > 420); assert.ok(player.y < 570);
  assert.equal(limiter.sequence, 1);
});

test('client prediction, delayed replay and server execution share the same scrambled keys', context => {
  context.mock.method(Date, 'now', () => now);
  const local = body(), server = body(), prediction = new MovementPrediction(), limiter = new MovementInputs(now);
  for (const [index, directions] of [1, 3, 5, 2, 10, 4, 12, 8].entries()) {
    const input = physical(directions);
    prediction.step(local, input.x, input.y, 16, index % 2 === 0, [], directions);
  }
  prediction.finish(local);
  prediction.flush(batch => {
    assert.equal(batch.at(-1)!.directions, 0);
    limiter.accept(server, batch, now + 128);
  });
  assert.ok(limiter.pendingCount > 0);
  assert.deepEqual(prediction.reconcile(server, limiter.sequence), local);
  limiter.advance(server, now + 200);
  assert.deepEqual(server, local);
  assert.deepEqual(prediction.reconcile(server, limiter.sequence), local);
  assert.equal(prediction.pendingCount, 0); assert.equal(prediction.active, false);
});
