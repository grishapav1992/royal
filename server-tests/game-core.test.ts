import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_CATALOG, coinsMultiplier, isValidCoinsOutcome, type RouletteInput } from '../src/shared/gameCore';
import { playRoyalCoins, prepareGame, verifyGameRound } from '../server/games/core';
import { ORIGINAL_DEFAULT_INPUTS } from '../src/shared/originalGames';

test('Royal Coins exhaustively returns 96% with five triples, sixty pairs and sixty losses', () => {
  const game = prepareGame('royal-coins', 1, {});
  const counts = new Map<number, number>();
  let totalPayout = 0n;
  for (let first = 0; first < 5; first++) {
    for (let second = 0; second < 5; second++) {
      for (let third = 0; third < 5; third++) {
        const draws = [first, second, third];
        let reel = 0;
        const round = game.play(1n, max => {
          assert.equal(max, 5);
          return draws[reel++];
        });
        assert.equal(reel, 3);
        assert.equal(round.gameId, 'royal-coins');
        assert.deepEqual(round.outcome, { symbols: draws });
        const expected = first === second && second === third ? 12
          : first === second || first === third || second === third ? 1 : 0;
        assert.equal(round.multiplier, expected);
        assert.equal(round.payoutUnits, String(expected));
        assert.equal(round.stakeUnits, '1');
        assert.deepEqual(round.input, {});
        assert.equal(verifyGameRound(round), true);
        counts.set(expected, (counts.get(expected) ?? 0) + 1);
        totalPayout += BigInt(round.payoutUnits);
      }
    }
  }
  assert.equal(counts.get(12), 5);
  assert.equal(counts.get(1), 60);
  assert.equal(counts.get(0), 60);
  assert.equal(totalPayout, 120n);
  const rules = GAME_CATALOG.find(game => game.id === 'royal-coins')!;
  assert.equal(totalPayout * BigInt(rules.rtp.denominator), 125n * BigInt(rules.rtp.numerator));
});

test('every roulette bet has exact 36/37 RTP with the documented European wheel', () => {
  // Independent expected sets guard against a mistaken production colour table.
  const expectedRed = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const expectedBlack = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];
  const inputs: RouletteInput[] = [
    { bet: 'red' }, { bet: 'black' }, { bet: 'even' }, { bet: 'odd' },
    ...Array.from({ length: 37 }, (_, number) => ({ bet: 'number', number } as const)),
  ];
  for (const input of inputs) {
    const game = prepareGame('royal-roulette', 1, input);
    assert.equal(game.maxMultiplier, input.bet === 'number' ? 36 : 2);
    let totalPayout = 0n;
    let wins = 0;
    for (let outcome = 0; outcome <= 36; outcome++) {
      let calls = 0;
      const round = game.play(100n, max => {
        calls++;
        assert.equal(max, 37);
        return outcome;
      });
      assert.equal(calls, 1);
      const won = input.bet === 'number' ? outcome === input.number
        : input.bet === 'red' ? expectedRed.includes(outcome)
          : input.bet === 'black' ? expectedBlack.includes(outcome)
            : input.bet === 'even' ? outcome > 0 && outcome % 2 === 0 : outcome % 2 === 1;
      const expectedMultiplier = won ? (input.bet === 'number' ? 36 : 2) : 0;
      assert.equal(round.gameId, 'royal-roulette');
      assert.deepEqual(round.outcome, { number: outcome });
      assert.equal(round.multiplier, expectedMultiplier, `${JSON.stringify(input)} at ${outcome}`);
      assert.equal(round.payoutUnits, String(expectedMultiplier * 100));
      assert.deepEqual(round.input, input);
      assert.equal(verifyGameRound(round), true);
      totalPayout += BigInt(round.payoutUnits);
      if (won) wins++;
    }
    assert.equal(wins, input.bet === 'number' ? 1 : 18);
    assert.equal(totalPayout, 3600n);
    const rules = GAME_CATALOG.find(game => game.id === 'royal-roulette')!;
    assert.equal(totalPayout * BigInt(rules.rtp.denominator), 3700n * BigInt(rules.rtp.numerator));
  }
});

test('zero loses all outside bets and pays a straight bet on zero', () => {
  for (const bet of ['red', 'black', 'even', 'odd']) {
    assert.equal(prepareGame('royal-roulette', 1, { bet }).play(1n, () => 0).payoutUnits, '0');
  }
  assert.equal(prepareGame('royal-roulette', 1, { bet: 'number', number: 0 }).play(1n, () => 0).payoutUnits, '36');
});

test('only registered games, exact rules versions and valid inputs are accepted', () => {
  for (const id of [undefined, null, 1, {}, '__proto__', 'toString', 'unknown']) {
    assert.throws(() => prepareGame(id, 1, {}));
  }
  for (const version of [undefined, null, '1', 0, 2, NaN, Infinity, 1.5]) {
    assert.throws(() => prepareGame('royal-coins', version, {}));
  }
  for (const input of [undefined, null, [], '', 1, { rtp: 100 }, { multiplier: 12 }, { symbols: [0, 0, 0] }, new Date(), Object.create({ hidden: 1 })]) {
    assert.throws(() => prepareGame('royal-coins', 1, input));
  }
  for (const input of [undefined, null, [], {}, { bet: 'green' }, { bet: 'number' }, { bet: 'number', number: -1 },
    { bet: 'number', number: 37 }, { bet: 'number', number: 0.5 }, { bet: 'number', number: NaN },
    { bet: 'number', number: '1' }, { bet: 'red', number: 1 }, { bet: 'red', outcome: 1 },
    { bet: 'number', number: 1, payout: 1000 }, { bet: 'odd', number: undefined }]) {
    assert.throws(() => prepareGame('royal-roulette', 1, input));
  }
  assert.throws(() => prepareGame('royal-coins', 1, { [Symbol('hidden')]: 1 }));
  assert.throws(() => prepareGame('royal-coins', 1, Object.defineProperty({}, 'hidden', { value: 1 })));
  for (const game of GAME_CATALOG) {
    if (game.kind === 'session') { assert.throws(() => prepareGame(game.id, game.rulesVersion, {})); continue; }
    const input = game.id === 'royal-roulette' ? { bet: 'number', number: 0 }
      : game.id === 'royal-wheel' ? { risk: 'medium' }
      : game.id in ORIGINAL_DEFAULT_INPUTS ? ORIGINAL_DEFAULT_INPUTS[game.id as keyof typeof ORIGINAL_DEFAULT_INPUTS] : {};
    const prepared = prepareGame(game.id, game.rulesVersion, input);
    assert.equal(prepared.gameId, game.id);
    assert.equal(prepared.rulesVersion, game.rulesVersion);
    assert.ok(prepared.maxMultiplier <= game.maxMultiplier);
    assert.equal(prepared.play(1n, () => 0).rulesVersion, game.rulesVersion);
    assert.equal(verifyGameRound(prepared.play(1n)), true);
  }
});

test('RNG bounds and positive bigint stakes are enforced for both engines', () => {
  const games = [prepareGame('royal-coins', 1, {}), prepareGame('royal-roulette', 1, { bet: 'red' })];
  for (const game of games) {
    for (const invalid of [-1, 0.1, NaN, Infinity, -Infinity, '1', null, undefined]) {
      assert.throws(() => game.play(1n, () => invalid as number));
    }
    assert.throws(() => game.play(1n, max => max));
    for (const stake of [0n, -1n, 1, 1.5, NaN, '1', null, undefined]) {
      let draws = 0;
      assert.throws(() => game.play(stake as bigint, () => { draws++; return 0; }));
      assert.equal(draws, 0);
    }
  }
});

test('payout units remain exact beyond the JavaScript safe integer range', () => {
  const stake = 9007199254740993123456789n;
  const coins = playRoyalCoins(stake, () => 4);
  assert.equal(coins.stakeUnits, '9007199254740993123456789');
  assert.equal(coins.payoutUnits, '108086391056891917481481468');
  assert.deepEqual(coins.outcome.symbols, [4, 4, 4]);
  const roulette = prepareGame('royal-roulette', 1, { bet: 'number', number: 36 }).play(stake, () => 36);
  assert.equal(roulette.payoutUnits, '324259173170675752444444404');
  assert.doesNotThrow(() => JSON.stringify({ coins, roulette }));
});

test('preparation snapshots input so later caller changes cannot alter a wager', () => {
  const input = { bet: 'number', number: 3 };
  const game = prepareGame('royal-roulette', 1, input);
  input.number = 5;
  assert.deepEqual(game.input, { bet: 'number', number: 3 });
  assert.equal(game.play(1n, () => 3).payoutUnits, '36');
  assert.equal(game.play(1n, () => 5).payoutUnits, '0');
  assert.equal(Object.isFrozen(game), true);
  assert.equal(Object.isFrozen(game.input), true);
});

test('shared outcome validation rejects malformed and inconsistent symbols', () => {
  assert.equal(coinsMultiplier([0, 0, 0]), 12);
  assert.equal(coinsMultiplier([4, 1, 4]), 1);
  assert.equal(coinsMultiplier([0, 1, 2]), 0);
  for (const symbols of [null, undefined, {}, [], [0, 0], [0, 0, 0, 0], [0, -1, 0], [0, 5, 0],
    [0, 0.5, 0], [0, NaN, 0], [0, '0', 0], new Array(3)]) {
    assert.equal(isValidCoinsOutcome(symbols, 12), false);
    assert.throws(() => coinsMultiplier(symbols as number[]));
  }
  assert.equal(isValidCoinsOutcome([0, 0, 0], 12), true);
  assert.equal(isValidCoinsOutcome([0, 0, 0], 1), false);
  assert.equal(isValidCoinsOutcome([0, 0, 0], '12'), false);
});

test('round verification rejects changed rules, invalid outcomes and inconsistent accounting', () => {
  const coins = playRoyalCoins(101n, () => 2);
  const roulette = prepareGame('royal-roulette', 1, { bet: 'number', number: 0 }).play(101n, () => 0);
  for (const round of [coins, roulette]) {
    assert.equal(verifyGameRound(JSON.parse(JSON.stringify(round))), true);
    for (const changed of [
      { ...round, gameId: 'unknown' }, { ...round, rulesVersion: 2 }, { ...round, rulesVersion: '1' },
      { ...round, input: { ...round.input, rtp: 1 } }, { ...round, outcome: {} },
      { ...round, outcome: { ...round.outcome, extra: 0 } }, { ...round, payoutUnits: '9999' },
      { ...round, payoutUnits: Number(round.payoutUnits) }, { ...round, stakeUnits: '0' },
      { ...round, stakeUnits: '0101' }, { ...round, stakeUnits: '101.0' }, { ...round, payoutUnits: '-1' },
      { ...round, multiplier: round.multiplier + 1 }, { ...round, multiplier: '12' },
      { ...round, multiplier: -1 }, { ...round, multiplier: NaN }, { ...round, extra: true },
    ]) assert.equal(verifyGameRound(changed), false);
  }
  for (const value of [undefined, null, [], {}, { ...coins, outcome: { symbols: [5, 5, 5] } },
    { ...roulette, outcome: { number: -1 } }, { ...roulette, outcome: { number: 37 } },
    { ...roulette, outcome: { number: 0.5 } }, { ...roulette, input: { bet: 'red' } }]) {
    assert.equal(verifyGameRound(value), false);
  }
  assert.equal(verifyGameRound(prepareGame('royal-roulette', 1, { bet: 'red' }).play(1n, () => 0)), true);
});
