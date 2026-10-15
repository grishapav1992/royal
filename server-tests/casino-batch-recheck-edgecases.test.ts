import test from 'node:test';
import assert from 'node:assert/strict';
import { startBatchVariant, moveBatchVariant, type BatchVariantResult } from '../server/games/casinoBatchVariants';
import {
  BATCH_VARIANT_DEFAULTS, validBatchVariantSettlement,
  type BatchVariantGameId, type BatchVariantSettings, type StreakThreshold,
} from '../src/shared/casinoBatchVariants';

const stakes = [1000, 5000, 10000, 50000];
const paid = (stake: number, fixed: bigint) => Number(BigInt(stake) * fixed / 10000n);
function poolDraw(ids: number[], size: number) {
  const pool = Array.from({ length: size }, (_, index) => index), queue = [...ids];
  return (maximum: number) => {
    assert.equal(maximum, pool.length);
    const index = pool.indexOf(queue.shift()!);
    assert(index >= 0);
    pool.splice(index, 1);
    return index;
  };
}
function validates(game: BatchVariantGameId, stake: number, result: BatchVariantResult) {
  return validBatchVariantSettlement(game, result.ended ? 'settled' : 'active', String(stake), String(stake), String(result.credit), result.variant);
}

test('recheck: every immediate loss settles zero at all four allowed stakes', () => {
  const losses: { game: BatchVariantGameId; settings: BatchVariantSettings; draw: () => (maximum: number) => number }[] = [
    { game: 'variant-target-plinko', settings: { variant: { target: 'center' } }, draw: () => () => 0 },
    { game: 'variant-triple-poker', settings: { variant: { target: 'straight' } }, draw: () => poolDraw([0, 13, 26], 52) },
    { game: 'variant-blackjack-target', settings: { variant: { target: '21' } }, draw: () => poolDraw([1, 14, 27], 52) },
    { game: 'variant-gem-collection', settings: { variant: { gems: [3, 4, 5] } }, draw: () => () => 0 },
  ];
  for (const { game, settings, draw } of losses) for (const stake of stakes) {
    const result = startBatchVariant(game, settings, String(stake), draw());
    assert(result.ended);
    assert.equal(result.credit, 0);
    assert('won' in result.variant && result.variant.won === false);
    assert(validates(game, stake, result));
    assert(!validBatchVariantSettlement(game, 'settled', String(stake), String(stake), '1', result.variant));
    assert(!validBatchVariantSettlement(game, 'active', String(stake), String(stake), '0', result.variant));
  }
});

test('recheck: every first die and every threshold handles equality and losses correctly at every stake', () => {
  const quotes: Record<StreakThreshold, bigint> = { 2: 11760n, 3: 14700n, 4: 19600n };
  for (const stake of stakes) for (const threshold of [2, 3, 4] as const) for (let die = 1; die <= 6; die++) {
    const initial = startBatchVariant('variant-dice-streak', { variant: {} }, String(stake), () => die - 1);
    const result = moveBatchVariant('variant-dice-streak', initial.engine, 'roll', [threshold], String(stake));
    assert.equal(result.ended, die < threshold);
    assert(validates('variant-dice-streak', stake, result));
    if (result.variant.kind !== 'dice-streak') throw Error('Unexpected dice view');
    assert.deepEqual(result.variant.history, [{ die, threshold, won: die >= threshold }]);
    assert.equal(result.variant.cashoutUnits, String(die < threshold ? 0 : paid(stake, quotes[threshold])));
    if (die >= threshold) {
      const cashout = moveBatchVariant('variant-dice-streak', result.engine, 'cashout', undefined, String(stake));
      assert.equal(cashout.credit, paid(stake, quotes[threshold]));
      assert(validates('variant-dice-streak', stake, cashout));
    } else {
      assert.equal(result.credit, 0);
      assert.throws(() => moveBatchVariant('variant-dice-streak', result.engine, 'cashout', undefined, String(stake)), /private/);
      assert.throws(() => moveBatchVariant('variant-dice-streak', result.engine, 'roll', [2], String(stake)), /private/);
    }
  }
});

test('recheck: all first mine pairs are order-independent and settle exact loss or early cashout', () => {
  for (const stake of stakes) {
    let wins = 0, losses = 0;
    for (let first = 0; first < 15; first++) for (let second = first + 1; second < 16; second++) {
      const initial = startBatchVariant('variant-double-mines', { variant: {} }, String(stake), () => 0);
      const before = structuredClone(initial.engine);
      const forward = moveBatchVariant('variant-double-mines', initial.engine, 'reveal', [first, second], String(stake));
      const reverse = moveBatchVariant('variant-double-mines', initial.engine, 'reveal', [second, first], String(stake));
      assert.deepEqual(forward, reverse);
      assert.deepEqual(initial.engine, before);
      assert.equal(forward.ended, first < 4);
      assert(validates('variant-double-mines', stake, forward));
      if (forward.ended) {
        losses++;
        assert.equal(forward.credit, 0);
        assert.throws(() => moveBatchVariant('variant-double-mines', forward.engine, 'cashout', undefined, String(stake)), /private/);
        assert.throws(() => moveBatchVariant('variant-double-mines', forward.engine, 'reveal', [14, 15], String(stake)), /private/);
      } else {
        wins++;
        const cashout = moveBatchVariant('variant-double-mines', forward.engine, 'cashout', undefined, String(stake));
        assert.equal(cashout.credit, paid(stake, 17818n));
        assert(validates('variant-double-mines', stake, cashout));
      }
    }
    assert.equal(wins, 66);
    assert.equal(losses, 54);
  }
});

test('recheck: the fifth successful step pays once and its private state cannot be continued', () => {
  for (const stake of stakes) for (const game of ['variant-double-mines', 'variant-dice-streak'] as const) {
    let result = startBatchVariant(game, { variant: {} }, String(stake), () => game === 'variant-double-mines' ? 0 : 5);
    for (let step = 0; step < 5; step++) {
      const before = structuredClone(result.engine);
      result = moveBatchVariant(game, result.engine, game === 'variant-double-mines' ? 'reveal' : 'roll', game === 'variant-double-mines' ? [4 + 2 * step, 5 + 2 * step] : [4], String(stake));
      assert.equal(result.ended, step === 4);
      assert(validates(game, stake, result));
      if (step < 4) assert.equal(result.credit, 0);
      assert.notDeepEqual(result.engine, before);
    }
    assert.equal(result.credit, paid(stake, game === 'variant-double-mines' ? 1189066n : 313600n));
    assert.throws(() => moveBatchVariant(game, result.engine, 'cashout', undefined, String(stake)), /private/);
    assert.throws(() => moveBatchVariant(game, result.engine, game === 'variant-double-mines' ? 'reveal' : 'roll', game === 'variant-double-mines' ? [14, 15] : [4], String(stake)), /private/);
  }
});

test('recheck: card order leaves Ace totals and combination outcomes unchanged', () => {
  const hands = [
    { ids: [0, 13, 26], total: 13, pair: true, flush: false, straight: false },
    { ids: [0, 12, 25], total: 21, pair: true, flush: false, straight: false },
    { ids: [0, 13, 12], total: 12, pair: true, flush: false, straight: false },
    { ids: [0, 11, 12], total: 21, pair: false, flush: true, straight: true },
    { ids: [0, 14, 28], total: 16, pair: false, flush: false, straight: true },
    { ids: [0, 1, 12], total: 13, pair: false, flush: true, straight: false },
  ];
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const hand of hands) for (const permutation of permutations) for (const stake of stakes) {
    const ids = permutation.map(index => hand.ids[index]);
    for (const target of ['pair', 'flush', 'straight'] as const) {
      const result = startBatchVariant('variant-triple-poker', { variant: { target } }, String(stake), poolDraw(ids, 52));
      if (result.variant.kind !== 'triple-poker') throw Error('Unexpected poker view');
      assert.equal(result.variant.won, hand[target]);
      assert(validates('variant-triple-poker', stake, result));
    }
    for (const target of ['17-18', '19-20', '21'] as const) {
      const result = startBatchVariant('variant-blackjack-target', { variant: { target } }, String(stake), poolDraw(ids, 52));
      if (result.variant.kind !== 'blackjack-target') throw Error('Unexpected 21 view');
      assert.equal(result.variant.total, hand.total);
      assert.equal(result.variant.won, target === '21' ? hand.total === 21 : target === '17-18' ? hand.total >= 17 && hand.total <= 18 : hand.total >= 19 && hand.total <= 20);
      assert(validates('variant-blackjack-target', stake, result));
    }
  }
});

test('recheck: settlements reject noncanonical and disallowed money representations', () => {
  for (const game of ['variant-double-mines', 'variant-dice-streak'] as const) {
    const initial = startBatchVariant(game, BATCH_VARIANT_DEFAULTS[game], '1000', () => game === 'variant-double-mines' ? 0 : 5);
    const first = moveBatchVariant(game, initial.engine, game === 'variant-double-mines' ? 'reveal' : 'roll', game === 'variant-double-mines' ? [4, 5] : [4], '1000');
    const cashout = moveBatchVariant(game, first.engine, 'cashout', undefined, '1000');
    for (const malformed of ['', '01000', '1000.0', '+1000', '1e3', ' 1000', '-1000', '0', '1001', '9007199254740993']) {
      assert(!validBatchVariantSettlement(game, 'active', malformed, malformed, '0', first.variant));
      assert(!validBatchVariantSettlement(game, 'settled', '1000', malformed, String(cashout.credit), cashout.variant));
      assert(!validBatchVariantSettlement(game, 'settled', '1000', '1000', malformed, cashout.variant));
    }
  }
});
