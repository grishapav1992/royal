import assert from 'node:assert/strict';
import { DRAGON_PATH_LAYOUT as layout } from '../../src/shared/dragonPathLayout.ts';
import {
  DRAGON_PATH_FREE_MULTIPLIER, DRAGON_PATH_PAYS, DRAGON_PATH_POINT_SCALE, DRAGON_PATH_SCATTER,
  DRAGON_PATH_TRIGGER, DRAGON_PATH_WEIGHTS, DRAGON_PATH_WILD, scoreDragonPathLine,
} from '../../src/shared/dragonPathMath.ts';

function choose(n, k) {
  let result = 1n;
  for (let i = 1; i <= k; i++) result = result * BigInt(n - i + 1) / BigInt(i);
  return result;
}

export function analyzeDragonPath({ verifyRuntime = false } = {}) {
  let weightedLines = 0n;
  function enumerateLine(cells, weight) {
    if (cells.length < layout.columns) {
      DRAGON_PATH_WEIGHTS.forEach((w, symbol) => enumerateLine([...cells, symbol], weight * BigInt(w)));
      return;
    }
    const expected = Math.max(...DRAGON_PATH_PAYS.map((pays, symbol) => {
      const stop = cells.findIndex(cell => cell !== symbol && cell !== DRAGON_PATH_WILD);
      return pays[(stop === -1 ? cells.length : stop) - 3] ?? 0;
    }));
    if (verifyRuntime) assert.equal(scoreDragonPathLine(cells)?.points ?? 0, expected);
    weightedLines += weight * BigInt(expected);
  }
  enumerateLine([], 1n);
  const weightedColumns = DRAGON_PATH_WEIGHTS.reduce((sum, weight, symbol) => symbol <= DRAGON_PATH_WILD ? sum
    : sum + BigInt(weight) ** BigInt(layout.rows) * BigInt(DRAGON_PATH_PAYS[symbol][layout.rows - 3]), 0n);
  assert.equal(layout.rows, layout.columns);
  const total = BigInt(DRAGON_PATH_WEIGHTS.reduce((sum, weight) => sum + weight, 0));
  const scatter = BigInt(DRAGON_PATH_WEIGHTS[DRAGON_PATH_SCATTER]);
  const size = layout.columns * layout.rows;
  let bonusWeight = 0n;
  for (let count = DRAGON_PATH_TRIGGER; count <= size; count++) {
    bonusWeight += choose(size, count) * scatter ** BigInt(count) * (total - scatter) ** BigInt(size - count);
  }
  const boards = total ** BigInt(size);
  const baseWeight = BigInt(layout.paylines.length) * weightedLines + BigInt(layout.columns) * weightedColumns;
  const numerator = baseWeight * (boards + BigInt(DRAGON_PATH_FREE_MULTIPLIER) * bonusWeight);
  const denominator = total ** BigInt(layout.columns) * boards * BigInt(DRAGON_PATH_POINT_SCALE);
  return { numerator, denominator, value: Number(numerator) / Number(denominator), bonusProbability: Number(bonusWeight) / Number(boards) };
}
