import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUARD_CHASE_SPEED, Guards, REINFORCEMENT_ID } from '../server/guards';
import { LobbyState, Player } from '../server/state';
import { walkable } from '../src/game/navigation';
import type { SecurityDecision } from '../src/shared/security';
import { hallObstacles, PLAYER_SPRINT_SPEED } from '../src/shared/world';

type Pursuit = Parameters<Guards['pursue']>[1];
const pursuit = (id: string): Pursuit => ({ id, sanctionId: 'episode-' + id, until: 4_000_000_000_000, reason: 'spam' });

function club() {
  const state = new LobbyState();
  const captures: string[] = [];
  const guards = new Guards(state, () => {}, () => .3, () => 1, {
    marked: () => undefined,
    capture: async id => { captures.push(id); return { kind: 'ejecting', until: 4_000_000_000_000 } satisfies SecurityDecision; },
  });
  const add = (id: string, hall: string, x: number, y: number) => {
    const player = new Player(); Object.assign(player, { hall, x, y });
    assert(walkable(x, y, hallObstacles(hall)), id + ' stands on open floor');
    state.players.set(id, player); return player;
  };
  return { state, guards, captures, add };
}

test('the chase runs slightly faster than a sprinting player', () => {
  assert(GUARD_CHASE_SPEED > PLAYER_SPRINT_SPEED);
  assert(GUARD_CHASE_SPEED < PLAYER_SPRINT_SPEED * 1.1);
  const { state, guards, add } = club();
  const guard = state.guards.get('security')!;
  add('runner', 'arcade', 1100, 640);
  assert.equal(guards.pursue('runner', pursuit('runner')), true);
  guards.tick(.05);
  const start = { x: guard.x, y: guard.y };
  guards.tick(.2);
  const speed = Math.hypot(guard.x - start.x, guard.y - start.y) / .2;
  assert(Math.abs(speed - GUARD_CHASE_SPEED) < 1, `chase speed ${speed}`);
});

test('a second violator while the house guard is busy brings the second guard by radio', () => {
  const { state, guards, add } = club();
  const house = state.guards.get('security')!;
  add('first', 'arcade', 700, 640);
  assert.equal(guards.pursue('first', pursuit('first')), true);
  guards.tick(.05);
  assert.equal(house.target, 'first');

  add('second', 'arcade', 1600, 900);
  assert.equal(guards.pursue('second', pursuit('second')), true);
  const backup = state.guards.get(REINFORCEMENT_ID);
  assert(backup, 'the second guard comes on duty');
  assert.equal(backup.hall, 'arcade');
  assert.equal(house.speech, 'Вызываю подмогу.');
  for (let i = 0; i < 40 && backup.target !== 'second'; i++) guards.tick(.05);
  assert.equal(backup.target, 'second');
  assert.equal(house.target, 'first', 'the house guard keeps the first pursuit');
  assert.equal(guards.pursue('second', pursuit('second-again')), false, 'one player is pursued once');
});

test('a violator on another floor is met by the second guard coming up the stairs', () => {
  const { state, guards, add } = club();
  add('upstairs', 'github', 1100, 1150);
  assert.equal(guards.pursue('upstairs', pursuit('upstairs')), true);
  const backup = state.guards.get(REINFORCEMENT_ID)!;
  assert.equal(backup.hall, 'github');
  assert.equal(state.guards.get('security')!.hall, 'arcade', 'the house guard stays on the first floor');
});

test('the second guard goes off duty after half a minute without work', () => {
  const { state, guards, add } = club();
  add('upstairs', 'tables', 900, 1100);
  guards.pursue('upstairs', pursuit('upstairs'));
  assert(state.guards.has(REINFORCEMENT_ID));
  for (let i = 0; i < 10; i++) guards.tick(.05);
  guards.cancelPursuit('upstairs');
  for (let i = 0; i < 1400 && state.guards.has(REINFORCEMENT_ID); i++) guards.tick(.05);
  assert.equal(state.guards.has(REINFORCEMENT_ID), false, 'the second guard leaves through a door');
  assert.equal(state.guards.size, 1);

  add('later', 'tables', 950, 1100);
  assert.equal(guards.pursue('later', pursuit('later')), true);
  assert(state.guards.has(REINFORCEMENT_ID), 'a later radio call brings the second guard again');
});
