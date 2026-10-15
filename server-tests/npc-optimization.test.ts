import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AmbientGuests } from '../server/ambientGuests';
import { Bartender } from '../server/bartender';
import { Guards } from '../server/guards';
import { guardPath } from '../server/guardNavigation';
import { LobbyState, Player } from '../server/state';
import { AmbientGuests as GuestRoutine } from '../src/shared/ambientGuests';
import { MiraRoutine } from '../src/shared/miraRoutine';
import { type Obstacle, type Point } from '../src/game/navigation';

test('ambient publication preserves the existing guest trajectories and publication cadence', () => {
  const state = new LobbyState(), guests = new AmbientGuests(state), expected = new GuestRoutine();
  let elapsed = 0;
  for (let step = 0; step < 7200; step++) {
    const delta = step % 19 === 0 ? .033 : 1 / 60;
    guests.tick(delta); expected.tick(delta); elapsed += delta;
    if (elapsed < .1) continue;
    elapsed %= .1;
    assert.deepEqual([...state.guests.values()].map(guest => guest.toJSON()), expected.snapshot());
  }
});

test('bartender publication preserves the routine through serving, chatting and hall changes', () => {
  const state = new LobbyState(), bartender = new Bartender(state), expected = new MiraRoutine();
  const player = new Player(); new Guards(state, () => {});
  const guard = state.guards.get('security')!;
  state.players.set('visitor', player);
  for (let step = 0; step < 7200; step++) {
    player.hall = step % 480 < 240 ? 'arcade' : 'tables';
    player.action = step % 360 < 120 ? 'drink' : 'idle';
    player.connected = step % 600 < 500;
    guard.hall = step % 300 < 200 ? 'arcade' : 'tables';
    guard.phase = step % 240 < 80 ? 'chat' : 'watch';
    const serving = player.connected && player.hall === 'arcade' && player.action === 'drink';
    const chatting = guard.hall === 'arcade' && guard.phase === 'chat';
    bartender.tick(1 / 60); expected.tick(1 / 60, serving, chatting);
    assert.deepEqual(state.mira.toJSON(), expected.state);
  }
});

test('guard watching chooses the nearest eligible guest and preserves insertion order at equal distances', () => {
  const state = new LobbyState(), guards = new Guards(state, () => {}, () => .3);
  const duty = (guards as any).duties[0], guard = duty.guard;
  Object.assign(guard, { x: 900, y: 600, hall: 'arcade', phase: 'watch' });
  duty.elapsed = 3.1; duty.duration = 100; duty.visit = { facing: 'down', activity: 'watch' };
  const add = (id: string, x: number, hall = 'arcade', connected = true) => {
    const player = new Player(); Object.assign(player, { x, y: 600, hall, connected }); state.players.set(id, player); return player;
  };
  add('outside', 1120); add('another-hall', 901, 'tables'); add('offline', 899, 'arcade', false);
  const first = add('first', 890); add('second', 910);
  guards.tick(.01); assert.equal(guard.facing, 'left');
  first.connected = false;
  guards.tick(.01); assert.equal(guard.facing, 'right');
  add('closer', 897);
  guards.tick(.01); assert.equal(guard.facing, 'left');
});

test('cached guard routes cannot be corrupted by consuming or mutating a returned path', () => {
  const obstacles: Obstacle[] = [{ x: 360, y: 350, w: 100, h: 100 }];
  const from = { x: 300, y: 320 }, to = { x: 540, y: 480 };
  const first = guardPath(from, to, obstacles), expected = first.map(point => ({ ...point }));
  assert(first.length > 0);
  first[0].x += 1000; first.shift(); first.push({ x: 0, y: 0 });
  const second = guardPath(from, to, obstacles);
  assert.deepEqual(second, expected);
  second[0].y += 1000;
  assert.deepEqual(guardPath(from, to, obstacles), expected);
});

test('cached guard routes invalidate on obstacle coordinates, dimensions and membership changes', () => {
  const from = { x: 300, y: 320 }, to = { x: 540, y: 480 };
  const obstacles: Obstacle[] = [{ x: 800, y: 800, w: 100, h: 100 }];
  const before = guardPath(from, to, obstacles);
  const check = () => assert.deepEqual(guardPath(from, to, obstacles), guardPath(from, to, obstacles.map(obstacle => ({ ...obstacle }))));
  obstacles[0].x = 360; check();
  obstacles[0].y = 350; check();
  assert.notDeepEqual(guardPath(from, to, obstacles), before);
  obstacles[0].w = 150; check();
  obstacles[0].h = 150; check();
  obstacles.push({ x: 500, y: 430, w: 30, h: 20 }); check();
  obstacles.splice(0, 1); check();
  obstacles[0] = { x: 320, y: 340, w: 60, h: 80 }; check();
});

test('cached guard routes keep exact endpoints and recover from an initially blocked destination', () => {
  const from = { x: 300, y: 320 }, to = { x: 540.125, y: 480.25 };
  const obstacles: Obstacle[] = [{ x: 520, y: 460, w: 40, h: 40 }];
  assert.deepEqual(guardPath(from, to, obstacles), []);
  obstacles.length = 0;
  const first = guardPath(from, to, obstacles);
  assert.deepEqual(first.at(-1), to);
  const next: Point = { x: 540.25, y: 480.25 };
  assert.deepEqual(guardPath(from, next, obstacles).at(-1), next);
  assert.deepEqual(guardPath(from, to, obstacles).at(-1), to);
});
