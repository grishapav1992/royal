import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAGON_PATH_LAYOUT as layout } from '../src/shared/dragonPathLayout.ts';
import { GAME_STAKE_CENTS } from '../src/shared/gameStakes.ts';
import { makeRoundPrecision, validRoundPrecision } from '../src/shared/roundPrecision.ts';
// @ts-expect-error Независимая модель используется также штатной программой квалификации.
import { analyzeDragonPath } from '../scripts/game-math/dragon-path-model.mjs';
import {
  DRAGON_PATH_FREE_MULTIPLIER, DRAGON_PATH_PAYS, DRAGON_PATH_POINT_SCALE, DRAGON_PATH_SCATTER,
  DRAGON_PATH_WEIGHTS, DRAGON_PATH_WILD, drawDragonPathGrid, scoreDragonPathGrid, scoreDragonPathLine, validDragonPathGrid,
} from '../src/shared/dragonPathMath.ts';
import {
  DRAGON_PATH_FREE_SPIN, DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_REWARDS, dragonPathFinalAward,
  moveDragonPath, readDragonPath, startDragonPath, validDragonPathRound,
} from '../server/games/dragonPath.ts';

const size = layout.columns * layout.rows;
const weightTotal = DRAGON_PATH_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
const noDraw = () => { throw Error('Не должно быть запроса к генератору'); };

function scriptedDraw(grid: readonly number[]) {
  let cursor = 0;
  return (maximum: number) => {
    assert.equal(maximum, weightTotal);
    assert.ok(cursor < grid.length, 'Получены только значения уже принятого вращения');
    const result = DRAGON_PATH_WEIGHTS.slice(0, grid[cursor++]).reduce((sum, weight) => sum + weight, 0);
    return result;
  };
}

function bonusStartGrid() {
  const grid = Array.from({ length: size }, (_, index) => 2 + index % 7);
  for (const position of [1, 13, 23]) grid[position] = DRAGON_PATH_SCATTER;
  return grid;
}

function winningFreeGrid() {
  const grid = Array.from({ length: size }, (_, index) => 2 + index % 7);
  for (const position of [10, 11, 12]) grid[position] = 8;
  grid[13] = 2;
  return grid;
}

test('барабаны используют заданные веса и принимают только целые билеты', () => {
  const observed = DRAGON_PATH_WEIGHTS.map(() => 0);
  for (let ticket = 0; ticket < weightTotal; ticket++) {
    const grid = drawDragonPathGrid(maximum => { assert.equal(maximum, weightTotal); return ticket; });
    assert.equal(grid.length, size);
    assert.equal(new Set(grid).size, 1);
    observed[grid[0]]++;
  }
  assert.deepEqual(observed, DRAGON_PATH_WEIGHTS);
  for (const ticket of [-1, weightTotal, 1.1]) assert.throws(() => drawDragonPathGrid(() => ticket));
  assert.equal(validDragonPathGrid(new Array(size)), false);
});

test('линия выбирает один лучший результат, вертикаль оплачивается отдельно без замены Wild', () => {
  assert.deepEqual(scoreDragonPathLine([1, 1, 2, 2, 0]), { symbol: 2, count: 4, points: DRAGON_PATH_PAYS[2][1] });
  assert.deepEqual(scoreDragonPathLine([1, 1, 1, 1, 1]), { symbol: 1, count: 5, points: DRAGON_PATH_PAYS[1][2] });
  assert.equal(scoreDragonPathLine([0, 8, 8, 8, 8]), undefined);

  const grid = Array<number>(size).fill(DRAGON_PATH_SCATTER);
  for (const position of [2, 7, 12, 17, 22, 10, 11]) grid[position] = 5;
  const result = scoreDragonPathGrid(grid);
  assert.deepEqual(result.wins.map(win => [win.kind, win.index, win.positions]), [
    ['line', 0, [10, 11, 12]], ['column', 2, [2, 7, 12, 17, 22]],
  ]);
  assert.equal(result.points, DRAGON_PATH_PAYS[5][0] + DRAGON_PATH_PAYS[5][2]);
  grid[22] = DRAGON_PATH_WILD;
  assert.ok(scoreDragonPathGrid(grid).wins.every(win => win.kind !== 'column'));
  assert.ok(scoreDragonPathGrid(Array<number>(size).fill(DRAGON_PATH_WILD)).wins.every(win => win.kind !== 'column'));
});

test('спин без бонуса завершается в первой ревизии', () => {
  const grid = bonusStartGrid();
  grid[23] = 2;
  const result = startDragonPath('15', scriptedDraw(grid));
  assert.equal(result.ended, true);
  assert.equal(result.round.revision, 1);
  assert.deepEqual(result.actions, []);
  assert.throws(() => moveDragonPath(result.round, 1, DRAGON_PATH_FREE_SPIN, undefined, noDraw));
  for (const stake of ['9', '5001', '0.10', '010']) assert.throws(() => startDragonPath(stake, noDraw));
});

test('один бесплатный спин и косметический выбор сохраняются по ревизиям', () => {
  const paid = startDragonPath('10', scriptedDraw(bonusStartGrid()));
  assert.equal(paid.ended, false);
  assert.deepEqual(paid.actions, [{ move: DRAGON_PATH_FREE_SPIN, cost: 0 }]);
  assert.equal(paid.round.free, null);
  assert.equal(paid.baseCreditUnits, '0');
  assert.throws(() => dragonPathFinalAward(paid.round));
  assert.throws(() => moveDragonPath(paid.round, 0, DRAGON_PATH_FREE_SPIN, undefined, noDraw));
  assert.throws(() => moveDragonPath(paid.round, 1, DRAGON_PATH_CHOOSE_REWARD, [2], noDraw));
  assert.throws(() => moveDragonPath(paid.round, 1, DRAGON_PATH_FREE_SPIN, [], noDraw));

  const freeGrid = winningFreeGrid();
  for (const position of [0, 4, 24]) freeGrid[position] = DRAGON_PATH_SCATTER;
  const free = moveDragonPath(JSON.parse(JSON.stringify(paid.round)), 1, DRAGON_PATH_FREE_SPIN, undefined, scriptedDraw(freeGrid));
  assert.equal(free.round.revision, 2);
  assert.equal(free.round.stakeUnits, '10');
  assert.equal(free.baseCreditUnits, '0');
  assert.equal(free.points, free.base.points + free.free!.points * DRAGON_PATH_FREE_MULTIPLIER);
  assert.deepEqual(free.actions, [{ move: DRAGON_PATH_CHOOSE_REWARD, cost: 0, minPicks: 1, maxPicks: 1, choices: DRAGON_PATH_REWARDS }]);
  assert.deepEqual(readDragonPath(JSON.parse(JSON.stringify(free.round))), free);
  assert.throws(() => moveDragonPath(free.round, 2, DRAGON_PATH_FREE_SPIN, undefined, noDraw));
  for (const picks of [undefined, [], [2, 3], [1], [2.1]]) {
    assert.throws(() => moveDragonPath(free.round, 2, DRAGON_PATH_CHOOSE_REWARD, picks, noDraw));
  }
  const results = DRAGON_PATH_REWARDS.map(reward => moveDragonPath(free.round, 2, DRAGON_PATH_CHOOSE_REWARD, [reward], noDraw));
  assert.deepEqual(results.map(r => r.round.reward), DRAGON_PATH_REWARDS);
  assert.ok(results.every(r => r.ended && r.round.revision === 3 && r.actions.length === 0));
  assert.equal(results[0].baseCreditUnits, results[1].baseCreditUnits);
  assert.throws(() => moveDragonPath(results[0].round, 3, DRAGON_PATH_CHOOSE_REWARD, [3], noDraw));
  assert.equal(validDragonPathRound({ ...free.round, reward: 2 }), false);
  assert.equal(validDragonPathRound({ ...paid.round, version: 2 }), false);
  assert.equal(validDragonPathRound({ ...paid.round, free: freeGrid }), false);
});

test('полный раунд передаёт точную сумму в общий расчёт центов для всего диапазона', () => {
  for (let stake = GAME_STAKE_CENTS[0]; stake <= GAME_STAKE_CENTS.at(-1)!; stake++) {
    const base = startDragonPath(String(stake), scriptedDraw(bonusStartGrid()));
    const free = moveDragonPath(base.round, 1, DRAGON_PATH_FREE_SPIN, undefined, scriptedDraw(winningFreeGrid()));
    for (const choice of DRAGON_PATH_REWARDS) {
      const completed = moveDragonPath(free.round, 2, DRAGON_PATH_CHOOSE_REWARD, [choice], noDraw);
      const exact = dragonPathFinalAward(completed.round);
      assert.equal(exact.numerator * BigInt(DRAGON_PATH_POINT_SCALE), exact.denominator * BigInt(stake * completed.points));
      for (const ticket of new Set([0n, exact.denominator - 1n])) {
        const receipt = makeRoundPrecision(exact, completed.baseCreditUnits, maximum => {
          assert.equal(maximum, Number(exact.denominator));
          return Number(ticket);
        });
        const expected = exact.numerator / exact.denominator + (ticket < exact.numerator % exact.denominator ? 1n : 0n);
        assert.equal(receipt.creditedUnits, String(expected));
        assert.equal(validRoundPrecision(receipt, exact, String(expected)), true);
      }
    }
  }
});

test('независимый точный расчёт полного раунда входит в коридор 96 ± 0.2 п. п.', t => {
  const { numerator, denominator, value, bonusProbability } = analyzeDragonPath({ verifyRuntime: true });
  assert.ok(numerator * 1000n >= 958n * denominator && numerator * 1000n <= 962n * denominator);
  t.diagnostic(`Расчётный RTP: ${(100 * value).toFixed(8)}%; бонус: ${(100 * bonusProbability).toFixed(8)}%`);
});
