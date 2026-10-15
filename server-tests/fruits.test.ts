import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRUITS_MAX_MULTIPLIER, FRUITS_PAYTABLE, FRUITS_REEL_COUNT, FRUITS_REEL_SIZE, FRUITS_SYMBOL_COUNT,
  GAME_CATALOG, fruitsMultiplier, fruitsSymbolForStop, isValidFruitsOutcome,
} from '../src/shared/gameCore';
import { prepareGame, verifyGameRound } from '../server/games/core';

function expectedSymbol(stop: number): number {
  return stop < 8 ? 0 : stop < 14 ? 1 : stop < 18 ? 2 : 3;
}

test('Royal Fruits exhaustively returns 97% over all 8000 uniform reel-stop combinations', () => {
  const game = prepareGame('royal-fruits', 1, {});
  const counts = new Map<number, number>();
  let payoutSum = 0n;
  let squareSum = 0n;
  for (let first = 0; first < 20; first++) for (let second = 0; second < 20; second++) for (let third = 0; third < 20; third++) {
    const stops = [first, second, third];
    const expectedSymbols = stops.map(expectedSymbol);
    const expectedMultiplier = expectedSymbols[0] === expectedSymbols[1] && expectedSymbols[1] === expectedSymbols[2]
      ? [5, 10, 30, 140][expectedSymbols[0]] : 0;
    let calls = 0;
    const round = game.play(1n, max => { assert.equal(max, 20); return stops[calls++]; });
    assert.equal(calls, 3);
    assert.equal(round.gameId, 'royal-fruits');
    assert.equal(round.rulesVersion, 1);
    assert.deepEqual(round.input, {});
    assert.deepEqual(round.outcome, { symbols: expectedSymbols });
    assert.equal(round.multiplier, expectedMultiplier);
    assert.equal(round.stakeUnits, '1');
    assert.equal(round.payoutUnits, String(expectedMultiplier));
    assert.equal(verifyGameRound(round), true);
    counts.set(expectedMultiplier, (counts.get(expectedMultiplier) ?? 0) + 1);
    payoutSum += BigInt(round.payoutUnits);
    squareSum += BigInt(round.payoutUnits) ** 2n;
  }
  assert.deepEqual(Object.fromEntries(counts), { 0: 7200, 5: 512, 10: 216, 30: 64, 140: 8 });
  assert.equal(payoutSum, 7760n);
  assert.equal(squareSum, 248800n);
  assert.equal([...counts].filter(([multiplier]) => multiplier > 0).reduce((total, [, count]) => total + count, 0), 800);
  const rules = GAME_CATALOG.find(entry => entry.id === 'royal-fruits')!;
  assert.equal(payoutSum * BigInt(rules.rtp.denominator), 8000n * BigInt(rules.rtp.numerator));
  assert.equal(game.maxMultiplier, 140);
});

test('public Royal Fruits v1 rules are immutable and preserve the independent weighted reel table', () => {
  assert.equal(FRUITS_REEL_COUNT, 3);
  assert.equal(FRUITS_REEL_SIZE, 20);
  assert.equal(FRUITS_SYMBOL_COUNT, 4);
  assert.equal(FRUITS_MAX_MULTIPLIER, 140);
  assert.deepEqual(FRUITS_PAYTABLE.map(entry => [entry.symbol, entry.key, entry.weight, entry.multiplier]), [
    [0, 'cherry', 8, 5], [1, 'lemon', 6, 10], [2, 'grape', 4, 30], [3, 'seven', 2, 140],
  ]);
  assert.equal(Object.isFrozen(FRUITS_PAYTABLE), true);
  for (const entry of FRUITS_PAYTABLE) assert.equal(Object.isFrozen(entry), true);
  const counts = [0, 0, 0, 0];
  for (let stop = 0; stop < 20; stop++) {
    const symbol = fruitsSymbolForStop(stop);
    assert.equal(symbol, expectedSymbol(stop));
    counts[symbol]++;
  }
  assert.deepEqual(counts, [8, 6, 4, 2]);
  assert.deepEqual(GAME_CATALOG.find(entry => entry.id === 'royal-fruits'), {
    id: 'royal-fruits', name: 'Royal Fruits', engineId: 'weighted-three-reel-slot', rulesVersion: 1,
    rtp: { numerator: 97, denominator: 100 }, maxMultiplier: 140, kind: 'instant',
  });
});

test('Royal Fruits rejects altered rules, caller-controlled outcomes and invalid randomness before payout', () => {
  for (const version of [undefined, null, '1', 0, 2, NaN, Infinity, 1.5]) {
    assert.throws(() => prepareGame('royal-fruits', version, {}));
  }
  for (const input of [undefined, null, [], '', 1, { rtp: 100 }, { multiplier: 140 }, { symbols: [3, 3, 3] },
    new Date(), Object.create({ hidden: 1 }), { [Symbol('hidden')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })]) {
    assert.throws(() => prepareGame('royal-fruits', 1, input));
  }
  const game = prepareGame('royal-fruits', 1, {});
  assert.equal(Object.isFrozen(game), true);
  assert.equal(Object.isFrozen(game.input), true);
  assert.deepEqual(prepareGame('royal-fruits', 1, Object.create(null)).input, {});
  for (const value of [-1, 20, 0.1, NaN, Infinity, -Infinity, '1', null, undefined]) {
    assert.throws(() => game.play(1n, () => value as number));
    assert.throws(() => fruitsSymbolForStop(value as number));
  }
  for (const stake of [0n, -1n, 1, 1.5, NaN, '1', null, undefined]) {
    let draws = 0;
    assert.throws(() => game.play(stake as bigint, () => { draws++; return 0; }));
    assert.equal(draws, 0);
  }
});

test('Royal Fruits validates exact symbols and pays only triples', () => {
  for (let first = 0; first < 4; first++) for (let second = 0; second < 4; second++) for (let third = 0; third < 4; third++) {
    const symbols = [first, second, third];
    const expected = first === second && second === third ? [5, 10, 30, 140][first] : 0;
    assert.equal(fruitsMultiplier(symbols), expected);
    assert.equal(isValidFruitsOutcome(symbols, expected), true);
    assert.equal(isValidFruitsOutcome(symbols, expected + 1), false);
  }
  const hidden = Object.defineProperty([3, 3, 3], 'extra', { value: true });
  const symbolic = Object.assign([3, 3, 3], { [Symbol('extra')]: true });
  for (const symbols of [null, undefined, {}, [], [0, 0], [0, 0, 0, 0], [0, -1, 0], [0, 4, 0],
    [0, 0.5, 0], [0, NaN, 0], [0, '0', 0], new Array(3), hidden, symbolic]) {
    assert.equal(isValidFruitsOutcome(symbols, 140), false);
    assert.throws(() => fruitsMultiplier(symbols as number[]));
  }
  for (const multiplier of ['140', 139, NaN, Infinity, -1, 140.5]) assert.equal(isValidFruitsOutcome([3, 3, 3], multiplier), false);
});

test('Royal Fruits round verification rejects malformed outcomes and inconsistent exact accounting', () => {
  const game = prepareGame('royal-fruits', 1, {});
  const round = game.play(101n, () => 19);
  assert.equal(round.payoutUnits, '14140');
  assert.equal(verifyGameRound(JSON.parse(JSON.stringify(round))), true);
  for (const changed of [
    { ...round, gameId: 'unknown' }, { ...round, rulesVersion: 2 }, { ...round, rulesVersion: '1' },
    { ...round, input: { multiplier: 140 } }, { ...round, outcome: {} },
    { ...round, outcome: { symbols: [3, 3, 3], extra: 0 } }, { ...round, outcome: { symbols: [4, 4, 4] } },
    { ...round, outcome: { symbols: [3, 3] } }, { ...round, outcome: { symbols: [3, 3, 2] } },
    { ...round, outcome: { symbols: [3, 3, 3], [Symbol('hidden')]: 1 } },
    { ...round, payoutUnits: '14141' }, { ...round, payoutUnits: 14140 }, { ...round, payoutUnits: '-1' },
    { ...round, stakeUnits: '0' }, { ...round, stakeUnits: '0101' }, { ...round, stakeUnits: '101.0' },
    { ...round, multiplier: 139 }, { ...round, multiplier: '140' }, { ...round, multiplier: NaN },
    { ...round, extra: true },
  ]) assert.equal(verifyGameRound(changed), false);
  const losing = game.play(1n, (() => { let draw = 0; return () => [0, 8, 14][draw++]; })());
  assert.equal(losing.multiplier, 0);
  assert.equal(losing.payoutUnits, '0');
  assert.equal(verifyGameRound(losing), true);
});

test('Royal Fruits integer multipliers preserve exact payout units beyond the Number safe range', () => {
  const stake = 9007199254740993123456789n;
  const round = prepareGame('royal-fruits', 1, {}).play(stake, () => 19);
  assert.equal(round.payoutUnits, '1261007895663739037283950460');
  assert.equal(verifyGameRound(round), true);
  assert.doesNotThrow(() => JSON.stringify(round));
});
