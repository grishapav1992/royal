import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { LobbyState, Player } from '../server/state';
import { Guards } from '../server/guards';
import { MovementInputs } from '../server/movementInputs';
import { GUARD_STOPS } from '../server/guardRoutine';
import { GUARD_CONTACT_RADIUS } from '../src/shared/guardCollision';
import { hallObstacles } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';

test('a head-on click route and passive patrol at the wall both complete without stranding the guest', context => {
  let now = 1800000000000;
  context.mock.method(Date, 'now', () => now);
  context.mock.method(Math, 'random', () => .3);
  const room = new LobbyRoom(), player = new Player();
  Object.assign(player, { x: 90, y: 600 }); room.state.players.set('guest', player);
  const target = { x: 350, y: 600 };
  const control = { dx: 0, dy: 0, at: now, path: findPath(player, target, hallObstacles('arcade')), lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(now), predicted: false };
  (room as any).controls.set('guest', control);
  const guards = (room as any).guards as Guards, duty = (guards as any).duties[0], guard = duty.guard;
  Object.assign(guard, { x: 125, y: 600, phase: 'patrol', routine: 'lounge' });
  duty.path = [{ x: 80, y: 600 }]; duty.visit = GUARD_STOPS.arcade.find(stop => stop.id === 'lounge');
  duty.elapsed = 0;
  let pushedAside = false, reached = false, patrolArrived = false;
  try {
    for (let i = 0; i < 1000; i++) {
      now += 50; guards.tick(.05); (room as any).tick(.05);
      assert(walkable(player.x, player.y, hallObstacles(player.hall)), 'the guest must stay outside solids');
      assert(walkable(guard.x, guard.y, hallObstacles(guard.hall)), 'the patrol must stay outside solids');
      assert.equal(player.security, '', 'passive displacement must not trigger a harassment ban');
      if (Math.abs(player.y - 600) > 20) pushedAside = true;
      if (Math.abs(guard.x - 80) < .1 && Math.abs(guard.y - 600) < .1) patrolArrived = true;
      if (Math.hypot(player.x - target.x, player.y - target.y) < .1) reached = true;
    }
    assert(reached, 'the retained click route must reach the original destination within 50 seconds');
    assert(patrolArrived, 'the guard must pass the guest and finish the original patrol segment');
    assert(pushedAside, 'the trapped radial push must use its safe side instead of freezing both routes');
  } finally { room.clock.clear(); }
});

test('a blocked radial push chooses the nearest clear side and cannot tunnel through furniture', () => {
  const state = new LobbyState(), guards = new Guards(state, () => {}), duty = (guards as any).duties[0];
  const player = new Player(); Object.assign(player, { x: 90, y: 640 }); state.players.set('guest', player);
  Object.assign(duty.guard, { x: 125, y: 640 });
  assert.equal((guards as any).moveGuard(duty, 120, 640), true);
  Object.assign(player, { x: 73.9, y: 640 }); Object.assign(duty.guard, { x: 110, y: 640 });
  const before = { x: player.x, y: player.y };
  assert.equal((guards as any).moveGuard(duty, 105.75, 640), true);
  assert(player.y < 640, 'the lower side is outside the room, so use the upper side');
  assert(Math.hypot(player.x - duty.guard.x, player.y - duty.guard.y) >= GUARD_CONTACT_RADIUS);
  const steps = Math.ceil(Math.hypot(player.x - before.x, player.y - before.y));
  for (let i = 0; i <= steps; i++) assert(walkable(before.x + (player.x - before.x) * i / steps, before.y + (player.y - before.y) * i / steps, hallObstacles(player.hall)));

  const obstacles = hallObstacles('arcade'), saved = [...obstacles];
  try {
    obstacles.splice(0, obstacles.length, { x: 82, y: 577, w: 1, h: 1 }, { x: 82, y: 614, w: 1, h: 1 });
    Object.assign(player, { x: 73.9, y: 600 }); Object.assign(duty.guard, { x: 110, y: 600 });
    assert(walkable(player.x, player.y, obstacles));
    assert(walkable(105.75, 563.9, obstacles)); assert(walkable(105.75, 636.1, obstacles));
    assert.equal((guards as any).moveGuard(duty, 105.75, 600), false, 'both endpoints are free but their segments cross solids, so hold position');
    assert.equal(player.x, 73.9); assert.equal(player.y, 600);
    assert.equal(duty.guard.x, 110); assert.equal(duty.guard.y, 600);
  } finally { obstacles.splice(0, obstacles.length, ...saved); }
});

test('passive fallback keeps seated, playing and activity guests fixed and does not count a manual strike', () => {
  for (const locked of ['seat', 'playing', 'activity'] as const) {
    const state = new LobbyState(); let strikes = 0;
    const guards = new Guards(state, () => {}, () => .3, () => ++strikes), duty = (guards as any).duties[0];
    const player = new Player(); Object.assign(player, { x: 73.9, y: 600, [locked]: locked === 'playing' ? true : 'occupied' });
    state.players.set('guest', player); Object.assign(duty.guard, { x: 110, y: 600 });
    assert.equal((guards as any).moveGuard(duty, 105.75, 600), false);
    assert.equal(player.x, 73.9); assert.equal(player.y, 600); assert.equal(duty.guard.x, 110);
    assert.equal(strikes, 0);
  }
});
