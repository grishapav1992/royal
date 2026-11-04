import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {GAME_MODULES} from '../src/modules/GameModuleCatalog.ts';
import {stakeAdmissionRuntime, validateStakeAdmission} from '../scripts/game-math/game-stakes-admission.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(await readFile(new URL('../scripts/game-math/rtp-policy.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(await readFile(new URL('../scripts/game-math/rtp-legacy-baseline.json', import.meta.url), 'utf8'));
const runtime = await stakeAdmissionRuntime(root);
const id = 'future-qualified-slot';
function futureGame() {
  return {
    catalog: [{gameId: id, rulesVersion: 1, progressVersion: 1}],
    registry: {profiles: {[id]: {target: .96}}, nonWagered: {}, stakePolicies: {[id]: structuredClone(registry.stakePolicies['royal-roulette'])}},
    runtime: {...runtime, ROYAL_PLATFORM_GAMES: [], usesGameStakes: value => value === id},
  };
}
const check = fixture => validateStakeAdmission(fixture.catalog, [], fixture.registry, fixture.runtime);

test('all playable games use the actual common runtime and qualified stake denominations', () => {
  assert.equal(validateStakeAdmission(GAME_MODULES, baseline.games, registry, runtime), new Set([...runtime.ROYAL_PLATFORM_GAMES,'tsu-e-fa']).size);
  const missing = structuredClone(registry);
  delete missing.stakePolicies['royal-roulette'];
  assert.throws(() => validateStakeAdmission(GAME_MODULES, baseline.games, missing, runtime), /common ten-cent stake policy/);
});

test('a new game cannot pass admission with only a base RTP policy or a qualified flag', () => {
  const fixture = futureGame();
  fixture.registry.profiles[id].qualified = true;
  delete fixture.registry.stakePolicies[id];
  assert.throws(() => check(fixture), /common ten-cent stake policy/);
});

test('new games inherit the whole-round default and must bind the common money sources', () => {
  assert.equal(check(futureGame()), 1);
  for (const mutate of [
    f => { f.registry.stakePolicies[id].stakes = [100, 200, 500]; },
    f => { f.registry.stakePolicies[id].ordinaryStakeBasis = 'per-line'; },
    f => { f.registry.stakePolicies[id].sources = ['src/shared/gameStakes.ts']; },
    f => { f.registry.stakePolicies[id].stakePolicyVersion = 0; },
    f => { f.registry.stakePolicies[id].method = 'unqualified-rounding'; },
    f => { delete f.registry.stakePolicies[id].manualStakeRange; },
    f => { f.registry.stakePolicies[id].manualStakeRange.stepCents = 10; },
    f => { f.runtime.usesGameStakes = () => false; },
    f => { f.runtime.DEFAULT_GAME_STAKE = '100'; },
    f => { f.runtime.DEFAULT_GAME_BET = 1; },
    f => { f.runtime.GAME_STAKE_CENTS = [100, 200, 500]; },
  ]) {
    const fixture = futureGame();
    mutate(fixture);
    assert.throws(() => check(fixture));
  }
});

test('a non-wagered label cannot waive the common policy of a game with a wagered profile', () => {
  const fixture = futureGame();
  fixture.registry.nonWagered[id] = 'A long classification label does not remove this game paid-round profile.';
  delete fixture.registry.stakePolicies[id];
  assert.throws(() => check(fixture), /common ten-cent stake policy/);
});

test('documented genuinely free games require no stake or debit', () => {
  const fixture = futureGame();
  delete fixture.registry.profiles[id];
  delete fixture.registry.stakePolicies[id];
  fixture.registry.nonWagered[id] = 'Free puzzle with no wager, paid cost, wallet conversion or payout.';
  assert.equal(check(fixture), 0);
  fixture.registry.nonWagered[id] = 'free';
  assert.throws(() => check(fixture), /common ten-cent stake policy/);
});

test('historical definitions cannot regain playable Royal access with separate stakes', () => {
  for (const gameId of ['royal-dice', 'mortal-kombat', 'tsu-e-fa', 'studio-wild-nudge', 'flag-tote']) {
    const catalog = [{gameId}], historical = ['royal-dice'];
    const old = {profiles: {[gameId]: {method: 'historical-qualified-rules'}}, stakePolicies: {}, nonWagered: {}};
    assert.equal(validateStakeAdmission(catalog, historical, old, {...runtime, ROYAL_PLATFORM_GAMES: []}), 0);
    assert.throws(() => validateStakeAdmission(catalog, historical, old, {...runtime, ROYAL_PLATFORM_GAMES: [gameId]}), /common ten-cent stake policy/);
  }
});
