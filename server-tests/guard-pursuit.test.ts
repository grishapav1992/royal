import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { Guards } from '../server/guards';
import { LobbyState, Player } from '../server/state';
import { walkable } from '../src/game/navigation';
import { GUARD_CONTACT_RADIUS } from '../src/shared/guardCollision';
import { applyMovementInput } from '../src/shared/movement';
import type { SecurityDecision } from '../src/shared/security';
import { CASINO_EXIT } from '../src/shared/street';
import { HALLS, hallLinkToward, hallObstacles } from '../src/shared/world';
import { guardPath } from '../server/guardNavigation';

type Pursuit = Parameters<Guards['pursue']>[1];
const initial = { id: 'initial', sanctionId: 'episode', until: 4_000_000_000_000, reason: 'spam' } as const satisfies Pursuit;
const repeat = { ...initial, id: 'repeat' } satisfies Pursuit;
const decision = { kind: 'ejecting', until: initial.until, reason: initial.reason } as const satisfies SecurityDecision;

function fixture(options: { marked?: (id: string) => Pursuit | undefined; capture?: () => Promise<SecurityDecision | null> } = {}) {
  const state = new LobbyState();
  const player = new Player();
  Object.assign(player, { x: 690, y: 635 });
  state.players.set('guest', player);
  const captures: { id: string; pursuit: Pursuit; distance: number; hall: string }[] = [];
  const finished: { id: string; decision: SecurityDecision }[] = [];
  const guards = new Guards(state, (id, result) => finished.push({ id, decision: result }), () => .3, () => 1, {
    marked: options.marked ?? (() => undefined),
    capture: (id, pursuit) => {
      captures.push({ id, pursuit, distance: Math.hypot(guard.x - player.x, guard.y - player.y), hall: guard.hall });
      return options.capture ? options.capture() : Promise.resolve(decision);
    },
  });
  const guard = state.guards.get('security')!;
  return { state, guards, guard, player, captures, finished };
}

function tickUntil(guards: Guards, reached: () => boolean, message: string) {
  for (let i = 0; i < 1000 && !reached(); i++) guards.tick(.05);
  assert(reached(), message);
}

test('a live pursuit allows movement before contact and confirms one capture before escort', async () => {
  let acknowledge!: (result: SecurityDecision) => void;
  const { guards, guard, player, captures, finished } = fixture({
    capture: () => new Promise(resolve => { acknowledge = resolve; }),
  });

  assert.equal(guards.pursue('guest', initial), true);
  guards.tick(.05);
  assert.equal(guard.target, 'guest');
  assert.equal(player.security, '');
  assert.equal(captures.length, 0);
  applyMovementInput(player, { seq: 1, x: 1, y: 0, ms: 50, sprint: true }, [guard]);
  assert(player.x > 690, 'movement away from the guard must work before a capture');

  tickUntil(guards, () => captures.length > 0, 'the guard must approach the current target and reach contact');
  assert.equal(captures[0].id, 'guest');
  assert.equal(captures[0].pursuit.id, initial.id);
  assert.equal(captures[0].hall, player.hall);
  assert(captures[0].distance <= GUARD_CONTACT_RADIUS, 'capture must occur at contact range');
  assert.equal(player.security, 'ejecting');
  for (let i = 0; i < 30; i++) guards.tick(.05);
  assert.equal(captures.length, 1, 'waiting for confirmation must not issue another capture');
  assert.deepEqual(finished, []);
  assert(!['carry', 'throw'].includes(guard.phase), 'escort starts after the server confirms capture');

  acknowledge(decision);
  await setImmediate();
  tickUntil(guards, () => finished.length > 0, 'the confirmed capture must complete escort');
  assert.deepEqual(finished, [{ id: 'guest', decision }]);
  assert.equal(captures.length, 1);
});

test('escorts share each real landing and throw only from the first-floor doorway', async () => {
  for (const hall of ['arcade', 'tables', 'github'] as const) {
    const { guards, guard, player, finished } = fixture();
    Object.assign(player, HALLS[hall].spawn, { hall });
    Object.assign(guard, { x: player.x + 40, y: player.y, hall });
    assert(guards.pursue('guest', initial));
    guards.tick(.05);
    await setImmediate();

    const visits = [hall as string];
    let thrown = false;
    tickUntil(guards, () => {
      if (visits.at(-1) !== player.hall) {
        const link = hallLinkToward(visits.at(-1)! as typeof hall, 'arcade')!;
        assert.equal(guard.hall, player.hall);
        assert.equal(guard.phase, 'carry');
        assert.deepEqual({ x: player.x, y: player.y }, link.arrival.entry);
        assert.equal(player.hallRevision, visits.length);
        visits.push(player.hall);
      }
      if (guard.phase === 'throw') {
        thrown = true;
        assert.equal(guard.hall, 'arcade');
        assert.deepEqual({ x: guard.x, y: guard.y }, CASINO_EXIT.arrival);
      }
      return finished.length > 0;
    }, 'the guard must reach the street door');
    assert(thrown);
    const floors = ['github', 'tables', 'arcade'];
    assert.deepEqual(visits, floors.slice(floors.indexOf(hall)));
    assert.equal(finished.length, 1);
  }
});

test('the guard routes around a seated guest and waits if the door itself is blocked', async () => {
  const { state, guards, guard, captures, finished } = fixture();
  assert(guards.pursue('guest', initial));
  tickUntil(guards, () => captures.length > 0, 'the guard must reach contact before the escort');
  await setImmediate();

  const start = { x: guard.x, y: guard.y };
  const path = guardPath(start, CASINO_EXIT.arrival, hallObstacles(guard.hall));
  const position = path.find(point => Math.hypot(point.x - start.x, point.y - start.y) > 110);
  assert(position);
  const seated = new Player(), doorway = new Player();
  Object.assign(seated, position, { seat: 'bar-0' });
  Object.assign(doorway, CASINO_EXIT.arrival, { seat: 'arcade-lounge' });
  state.players.set('seated', seated);

  tickUntil(guards, () => {
    assert(Math.hypot(guard.x - seated.x, guard.y - seated.y) >= GUARD_CONTACT_RADIUS);
    return Math.hypot(guard.x - start.x, guard.y - start.y) > 230;
  }, 'the guard must walk around the seated guest');

  state.players.set('doorway', doorway);
  for (let i = 0; i < 200; i++) {
    guards.tick(.05);
    assert.notEqual(guard.phase, 'throw');
  }
  assert.equal(guard.phase, 'carry');
  assert.deepEqual(finished, []);
  state.players.delete('doorway');
  tickUntil(guards, () => finished.length > 0, 'the escort must finish after the doorway clears');
  assert.deepEqual(finished, [{ id: 'guest', decision }]);
  assert.equal(captures.length, 1);
  assert.deepEqual({ x: seated.x, y: seated.y }, position);
});

test('patrol notices a marked player in front, while furniture and direction protect hidden players', () => {
  for (const { name, origin, target, visible } of [
    { name: 'in front', origin: [585, 635], target: [690, 635], visible: true },
    { name: 'behind', origin: [585, 635], target: [480, 635], visible: false },
    { name: 'out of range', origin: [585, 635], target: [900, 635], visible: false },
    { name: 'behind furniture', origin: [160, 700], target: [265, 700], visible: false },
  ]) {
    let marked = false;
    const { guards, guard, player, captures } = fixture({ marked: id => marked && id === 'guest' ? repeat : undefined });
    tickUntil(guards, () => guard.phase === 'chat', 'the guard must reach the first patrol stop');
    Object.assign(guard, { x: origin[0], y: origin[1], facing: 'right' });
    Object.assign(player, { x: target[0], y: target[1] });
    const obstacles = hallObstacles('arcade');
    assert(walkable(guard.x, guard.y, obstacles), name);
    assert(walkable(player.x, player.y, obstacles), name);
    marked = true;
    guards.tick(.05);
    assert.equal(guard.target, visible ? 'guest' : '', name);
    assert.equal(player.security, '', name);
    assert.equal(captures.length, 0, name);
  }
});

test('a short distance across furniture does not qualify as contact', () => {
  const { guards, guard, player, captures } = fixture();
  Object.assign(guard, { x: 188.9, y: 682.3 });
  Object.assign(player, { x: 213.3, y: 657.9 });
  const obstacles = hallObstacles('arcade');
  assert(walkable(guard.x, guard.y, obstacles));
  assert(walkable(player.x, player.y, obstacles));
  assert(Math.hypot(guard.x - player.x, guard.y - player.y) < GUARD_CONTACT_RADIUS);

  assert.equal(guards.pursue('guest', initial), true);
  guards.tick(.0001);
  assert.equal(captures.length, 0);
  assert.equal(player.security, '');
});

test('leaving a pursuit for the restroom, street or another floor drops the original target', () => {
  for (const hall of ['toilet', 'street', 'tables'] as const) {
    const { guards, guard, player, captures, finished } = fixture();
    assert.equal(guards.pursue('guest', initial), true);
    guards.tick(.05);
    assert.equal(guard.target, 'guest');
    player.hall = hall;
    guards.tick(.05);
    assert.equal(guard.target, '', hall);
    assert.equal(player.security, '', hall);
    assert.deepEqual(captures, [], hall);
    assert.deepEqual(finished, [], hall);
    if (hall !== 'tables') assert.equal(guards.pursue('guest', repeat), false, hall);

    player.hall = 'arcade';
    assert.equal(guards.pursue('guest', repeat), true, 'a fresh pursuit can follow a new sighting');
    tickUntil(guards, () => captures.length > 0, 'the fresh pursuit can reach contact');
    assert.equal(captures[0].pursuit.id, repeat.id);
  }
});

test('a player out of sight on the same floor escapes without a capture', () => {
  const { guards, guard, player, captures, finished } = fixture();
  assert.equal(guards.pursue('guest', initial), true);
  guards.tick(.05);
  assert.equal(guard.target, 'guest');
  player.x = 1100;
  assert(walkable(player.x, player.y, hallObstacles(player.hall)));

  tickUntil(guards, () => !guard.target, 'the guard must stop after losing sight of the player');
  assert.equal(player.security, '');
  assert.deepEqual(captures, []);
  assert.deepEqual(finished, []);
});

test('a stale capture unlocks the player and drops the pursuit without an escort', async () => {
  let acknowledge!: (result: null) => void;
  const { guards, guard, player, captures, finished } = fixture({
    capture: () => new Promise(resolve => { acknowledge = resolve; }),
  });
  assert.equal(guards.pursue('guest', initial), true);
  tickUntil(guards, () => captures.length > 0, 'the guard must reach contact');
  assert.equal(player.security, 'ejecting');
  acknowledge(null);
  await setImmediate();

  assert.equal(player.security, '');
  assert.equal(guard.target, '');
  assert.deepEqual(finished, []);
  assert.equal(guards.pursue('guest', repeat), true);
});
