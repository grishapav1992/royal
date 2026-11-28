import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Guards } from '../server/guards';
import { GUARD_REMARKS, pickRemark } from '../server/guardRemarks';
import { LobbyState, Player } from '../server/state';

function watching(disguised: (id: string) => boolean = () => false) {
  const state = new LobbyState();
  const guards = new Guards(state, () => {}, () => .3, () => 1, {
    marked: () => undefined, capture: async () => null, disguised,
  });
  const duty = (guards as any).duties[0], guard = state.guards.get('security')!;
  Object.assign(guard, { x: 900, y: 600, hall: 'arcade', phase: 'watch' });
  duty.elapsed = 0; duty.duration = 1000; duty.visit = { facing: 'down', activity: 'watch' };
  const add = (id: string, x: number, extra: Partial<Player> = {}) => {
    const player = new Player(); Object.assign(player, { x, y: 600, hall: 'arcade', connected: true }, extra);
    state.players.set(id, player); return player;
  };
  const run = (seconds: number) => { const seen: string[] = []; for (let t = 0; t < seconds; t += .05) { guards.tick(.05); if (guard.speech && seen.at(-1) !== guard.speech) seen.push(guard.speech); } return seen; };
  return { guards, guard, add, run };
}

test('a watching guard greets one nearby guest, faces them and the line fades', () => {
  const { guard, add, run } = watching();
  add('guest', 960);
  const lines = run(.1);
  assert.equal(lines.length, 1);
  assert((GUARD_REMARKS.greeting as readonly string[]).includes(lines[0]));
  assert.equal(guard.facing, 'right');
  run(4);
  assert.equal(guard.speech, '');
});

test('the same guest is not addressed again soon, while another guest is after the cooldown', () => {
  const { add, run } = watching();
  add('guest', 960);
  assert.equal(run(.1).length, 1);
  run(4);
  assert.deepEqual(run(26), [], 'one guest hears at most one line in two minutes');
  add('newcomer', 850);
  const lines = run(.1);
  assert.equal(lines.length, 1, 'the cooldown has passed, so a new guest is greeted');
});

test('drunk guests and players in an unexposed Janitor disguise hear their own lines', () => {
  const drunk = watching();
  drunk.add('tipsy', 960, { soberAt: Date.now() + 600_000 });
  assert((GUARD_REMARKS.drunk as readonly string[]).includes(drunk.run(.1)[0]));

  const janitor = watching(id => id === 'janitor');
  janitor.add('janitor', 960);
  assert((GUARD_REMARKS.disguised as readonly string[]).includes(janitor.run(.1)[0]));
});

test('distant, hidden by another hall, offline and escorted guests are ignored', () => {
  const { add, run } = watching();
  add('far', 1200); add('upstairs', 950, { hall: 'tables' }); add('offline', 950, { connected: false }); add('escorted', 940, { security: 'ejecting' });
  assert.deepEqual(run(.5), []);
});

test('remarks avoid repeating the previous line', () => {
  const line = pickRemark('greeting', () => 0);
  assert.notEqual(pickRemark('greeting', () => 0, line), line);
});
