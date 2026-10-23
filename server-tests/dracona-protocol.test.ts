import test from 'node:test';
import assert from 'node:assert/strict';
import { startDracona, moveDracona } from '../server/games/dracona';
import { seededRandom } from '../src/shared/draconaMath';
import { DRACONA_GAME, validDraconaView, validDraconaSession, validDraconaSettings } from '../src/shared/dracona';
import { validExpansionAction } from '../src/shared/casinoExpansion';

const random = (seed: number) => { const rng = seededRandom(seed); return (max: number) => Math.floor(rng() * max); };
const settings = { dracona: { mode: 'normal' as const } };

test('native server preserves the agreed base result and validates its complete presentation', () => {
  const result = startDracona(settings, '10000', random(5));
  assert.equal(result.credit, 11189); assert.equal(result.ended, true);
  assert.equal(result.view.history[0].result.payout, 111.89);
  assert(validDraconaView('10000', result.view));
  const session = { id: '11111111-1111-4111-8111-111111111111', gameId: DRACONA_GAME, rulesVersion: 3, state: 'settled', stakeUnits: '10000', spentUnits: '10000', returnedUnits: '11189', view: { player: [], dealer: [], community: [], actions: [], phase: 2, ended: true, message: result.message, dracona: result.view } };
  assert(validDraconaSession(session));
  assert.equal(validDraconaSession({ ...session, returnedUnits: '22600' }), false);
});

test('bonus, retriggers and persistent runes replay exactly until a single final settlement', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const draw = random(seed);
    let result = startDracona(settings, '10000', draw);
    while (!result.ended) {
      assert.equal(result.credit, 0);
      const before = result.view;
      result = moveDracona(before, '10000', before.revision, draw);
      assert.equal(before.revision + 1, result.view.revision);
      assert(before.history.at(-1)!.result.runes.every((rune, i) => result.view.history.at(-1)!.result.runes[i] >= rune));
    }
    assert.equal(result.view.remaining, 0);
    assert(result.view.revision <= 21);
    assert.equal(result.credit, result.view.history.reduce((sum, spin) => sum + Math.round(spin.result.payout * 100), 0));
    assert(validDraconaView('10000', result.view));
  }
});

test('altered payout, symbols, entropy, bonus counter and revision are rejected', () => {
  const result = startDracona(settings, '10000', random(1));
  for (const mutate of [
    (v: typeof result.view) => { v.history[0].result.payout++; },
    (v: typeof result.view) => { v.history[0].result.grid[0] = 7; },
    (v: typeof result.view) => { v.history[0].draws.push(0); },
    (v: typeof result.view) => { v.remaining++; },
    (v: typeof result.view) => { v.revision++; },
    (v: typeof result.view) => { v.totalPayoutUnits = '100'; },
  ]) { const changed = structuredClone(result.view); mutate(changed); assert.equal(validDraconaView('10000', changed), false); }
  assert.throws(() => moveDracona(result.view, '10000', result.view.revision + 1, random(2)));
});

test('only declared stakes, modes and revision-bound free moves are accepted', () => {
  assert(validDraconaSettings(settings));
  assert.equal(validDraconaSettings({ dracona: { mode: 'normal', free: true } }), false);
  for (const stake of ['0', '123', '10001', '100000000']) assert.throws(() => startDracona(settings, stake, random(1)));
  const action = { id: '11111111-1111-4111-8111-111111111111', gameId: DRACONA_GAME, action: 'move', sessionId: '22222222-2222-4222-8222-222222222222', move: 'dracona-spin', revision: 1 };
  assert(validExpansionAction(action));
  for (const changed of [{ ...action, revision: 0 }, { ...action, picks: [0] }, { ...action, move: 'studio-spin' }, { ...action, gameId: 'github-blackjack' }]) assert.equal(validExpansionAction(changed), false);
});
