import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { findPath, walkable } from '../src/game/navigation';
import { hallObstacles, PLAYER_SPRINT_SPEED } from '../src/shared/world';

test('fractional keyboard budget preserves a click route without allowing movement beyond elapsed time', context => {
  let now = 1800000000000;
  context.mock.method(Date, 'now', () => now);
  const room = new LobbyRoom(); room.state.guards.clear();
  const player = new Player(); Object.assign(player, { x: 540, y: 570 });
  room.state.players.set('a', player);
  const inputs = new MovementInputs(now);
  assert(inputs.accept(player, [{ seq: 1, x: 0, y: 0, ms: 50 }, { seq: 2, x: 0, y: 0, ms: 49.99 }], now));
  const target = { x: 866, y: 578 };
  const control = { dx: 0, dy: 0, at: now, path: findPath(player, target, hallObstacles(player.hall)), lastTarget: 0, chatRevision: 0, inputs, predicted: false };
  (room as any).controls.set('a', control);
  const step = () => (room as any).tick(.05);
  try {
    const before = { x: player.x, y: player.y };
    step();
    assert(control.path.length > 0, 'a subpixel step must not cancel the route');
    assert(Math.hypot(player.x - before.x, player.y - before.y) <= PLAYER_SPRINT_SPEED * .01 / 1000 + 1e-9);
    const exhausted = { x: player.x, y: player.y };
    for (let i = 0; i < 20; i++) step();
    assert.equal(player.x, exhausted.x); assert.equal(player.y, exhausted.y);
    assert(control.path.length > 0, 'zero elapsed time retains the route without moving');
    now += 50; step();
    assert(Math.hypot(player.x - exhausted.x, player.y - exhausted.y) > 1);
    assert(Math.hypot(player.x - exhausted.x, player.y - exhausted.y) <= PLAYER_SPRINT_SPEED * .05 + 1e-9);
    for (let i = 0; i < 200 && control.path.length; i++) {
      now += 50; step();
      assert(walkable(player.x, player.y, hallObstacles(player.hall)));
    }
    assert(Math.hypot(player.x - target.x, player.y - target.y) < .1, 'the retained route reaches the bar');

    Object.assign(player, { x: 729, y: 450 });
    control.path = [{ x: 760, y: 450 }]; now += 50; step();
    assert.equal(player.x, 729); assert.equal(player.y, 450);
    assert.equal(control.path.length, 0, 'a full step genuinely blocked by furniture still cancels');
  } finally { room.clock.clear(); }
});

test('a tiny remainder after reaching a waypoint retains the next waypoint without any keyboard inputs', context => {
  const now = 1800000000000; context.mock.method(Date, 'now', () => now);
  const room = new LobbyRoom(); room.state.guards.clear();
  const player = new Player(); Object.assign(player, { x: 540, y: 570 }); room.state.players.set('a', player);
  const duration = .05, distance = PLAYER_SPRINT_SPEED * duration;
  const first = { x: player.x + distance - .005, y: player.y }, final = { x: 580, y: 570 };
  const inputs = new MovementInputs(now);
  const control = { dx: 0, dy: 0, at: now, path: [first, final], lastTarget: 0, chatRevision: 0, inputs, predicted: false };
  (room as any).controls.set('a', control);
  try {
    (room as any).tick(duration);
    assert.equal(inputs.sequence, 0);
    assert(player.x > first.x, 'the tick spends its tiny remainder on the next segment');
    assert.equal(control.path.length, 1, 'tiny progress does not mean the next segment is blocked');
    assert(Math.abs(player.x - 540 - distance) < 1e-9);
    for (let i = 0; i < 5; i++) (room as any).tick(duration);
    assert.equal(control.path.length, 0); assert(Math.abs(player.x - final.x) < 1e-9);
  } finally { room.clock.clear(); }
});
