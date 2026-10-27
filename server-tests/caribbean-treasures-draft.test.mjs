import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARIBBEAN_COLS, CARIBBEAN_ROWS, CARIBBEAN_LINES, CARIBBEAN_SYMBOLS,
  caribbeanBlockCells, caribbeanExpansionOptions, paintCaribbeanBlock,
  playCaribbeanFrame, scoreCaribbeanLines, settleCaribbeanFrame, validCaribbeanBlock, validCaribbeanGrid,
} from '../src/shared/caribbeanTreasuresMath.ts';
import { caribbeanDraftCases, caribbeanDraftLineMean, analyzeCaribbeanDraft } from '../scripts/game-math/caribbean-treasures-design.mjs';
import { q, sum, equal } from '../scripts/game-math/rational.mjs';

function random(seed = 129981) {
  let state = seed;
  return (maximum) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor(state / 4294967296 * maximum);
  };
}
function blank() {
  return Array.from({ length: 24 }, (_, index) => index % 6);
}
test('twenty distinct six-reel routes stay inside the four-row field', () => {
  assert.equal(CARIBBEAN_LINES.length, 20);
  assert.equal(new Set(CARIBBEAN_LINES.map(line => line.join(','))).size, 20);
  assert(CARIBBEAN_LINES.every(line => line.length === 6 && line.every(row => Number.isInteger(row) && row >= 0 && row < 4)));
  assert.equal(CARIBBEAN_SYMBOLS.reduce((value, symbol) => value + symbol.weight, 0), 100);
});
test('a line pays its longest prefix once; disconnected symbols and right-starting runs do not count', () => {
  const grid = blank();
  for (let column = 0; column < 5; column++) grid[6 + column] = 4;
  assert.deepEqual(scoreCaribbeanLines(grid, 1).map(win => [win.count, win.factor]), [[5, 100]]);
  grid[8] = 0;
  assert.deepEqual(scoreCaribbeanLines(grid, 1), []);
  for (let column = 1; column < 6; column++) grid[6 + column] = 4;
  grid[6] = 0;
  assert.deepEqual(scoreCaribbeanLines(grid, 1), []);
});
test('curved routes use their exact cell coordinates', () => {
  const grid = blank(), path = CARIBBEAN_LINES[4];
  for (let column = 0; column < 6; column++) grid[path[column] * 6 + column] = 5;
  const win = scoreCaribbeanLines(grid, 5).find(win => win.line === 4);
  assert(win);
  assert.equal(win.factor, 1000);
  assert.deepEqual(win.positions, [0, 7, 14, 15, 10, 5]);
});
test('inactive routes do not pay', () => {
  const grid = blank();
  for (let column = 0; column < 6; column++) grid[12 + column] = 5;
  assert.equal(scoreCaribbeanLines(grid, 1).length, 0);
  assert(scoreCaribbeanLines(grid, 5).some(win => win.line === 1));
});
test('giant painting preserves the input and makes every occupied cell the same symbol', () => {
  const grid = blank(), initial = [...grid], block = { x: 2, y: 1, size: 3, symbol: 5 };
  const next = paintCaribbeanBlock(grid, block), cells = caribbeanBlockCells(block);
  assert.deepEqual(grid, initial);
  assert.equal(cells.length, 9);
  assert.equal(new Set(cells).size, 9);
  for (let position = 0; position < 24; position++)
    assert.equal(next[position], cells.includes(position) ? 5 : initial[position]);
});
test('every small block can grow without leaving the board or losing its original cells', () => {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
    const small = { x, y, size: 2, symbol: 3 }, old = caribbeanBlockCells(small);
    const options = caribbeanExpansionOptions(small);
    assert(options.length >= 1 && options.length <= 4);
    for (const option of options) {
      assert(validCaribbeanBlock(option));
      assert(old.every(position => caribbeanBlockCells(option).includes(position)));
    }
  }
  assert.deepEqual(caribbeanExpansionOptions({ x: 0, y: 0, size: 3, symbol: 0 }), []);
});
test('a cannon at the bottom-right edge grows to a legal containing square', () => {
  const sequence = [...Array(24).fill(0), 200000, 4, 2, 0, 0, 0];
  const frame = playCaribbeanFrame('base', 20, maximum => {
    assert(sequence.length > 0); const value = sequence.shift(); assert(value < maximum); return value;
  });
  assert.equal(sequence.length, 0);
  assert.equal(frame.cannon, true);
  assert.deepEqual(frame.blockBefore, { x: 4, y: 2, size: 2, symbol: 0 });
  assert.deepEqual(frame.block, { x: 3, y: 1, size: 3, symbol: 0 });
});
test('ordinary frames can have no giant, with consistent snapshots and sums', () => {
  const frame = playCaribbeanFrame('base', 10, maximum => maximum - 1);
  assert.equal(frame.block, null);
  assert.equal(frame.blockBefore, null);
  assert.equal(frame.cannon, false);
  assert.deepEqual(frame.gridBefore, frame.grid);
  assert.notEqual(frame.gridBefore, frame.grid);
  assert.equal(frame.factorSum, 10 * 1000);
});
test('both bonus prototypes always contain a giant, and flagship uses 3x3', () => {
  const draw = random();
  for (const mode of ['raid', 'flagship']) for (let i = 0; i < 200; i++) {
    const frame = playCaribbeanFrame(mode, 20, draw);
    assert(frame.block);
    assert.equal(frame.blockBefore?.size, mode === 'flagship' ? 3 : 2);
    assert(caribbeanBlockCells(frame.block).every(position => frame.grid[position] === frame.block.symbol));
    assert.deepEqual(frame.wins, scoreCaribbeanLines(frame.grid, 20));
  }
});
test('reproducible draws produce reproducible frames', () => {
  const a = random(7773), b = random(7773);
  for (let i = 0; i < 100; i++) assert.deepEqual(playCaribbeanFrame('base', 5, a), playCaribbeanFrame('base', 5, b));
});
test('settlement uses exact integer money beyond Number safe-integer precision', () => {
  const result = settleCaribbeanFrame(Array(24).fill(5), 20, '999999999999999');
  const stake = 999999999999999n;
  assert.equal(result.costUnits, String(stake * 20n));
  assert.equal(result.payoutUnits, String(stake * 20n * 1000n));
  assert.equal(result.netUnits, String(stake * 20n * 999n));
  assert.equal(result.linePayoutUnits.length, 20);
});
test('a losing spin has the exact full cost as a negative net', () => {
  assert.deepEqual(settleCaribbeanFrame(blank(), 1, '100'), {
    costUnits: '100', payoutUnits: '0', netUnits: '-100', linePayoutUnits: [],
  });
});
test('invalid grids, routes, blocks, money and randomness fail closed', () => {
  assert(!validCaribbeanGrid(Array(24)));
  assert(!validCaribbeanGrid(Array(24).fill(NaN)));
  assert(!validCaribbeanBlock({ x: 4, y: 0, size: 3, symbol: 0 }));
  assert(!validCaribbeanBlock({ x: 0, y: 0, size: 2, symbol: 0, extra: true }));
  assert.throws(() => scoreCaribbeanLines(Array(24).fill(0), 2));
  for (const stake of ['0', '-1', '1.5', '01', '1000000000000000'])
    assert.throws(() => settleCaribbeanFrame(blank(), 1, stake));
  for (const draw of [() => -1, maximum => maximum, () => 0.5, () => NaN])
    assert.throws(() => playCaribbeanFrame('base', 1, draw));
});
test('analytical field distributions have exact total probability one', () => {
  for (const mode of ['base','raid','flagship']) equal(sum(caribbeanDraftCases(mode).map(row => row.probability)), q(1));
});
test('analytical expectation matches independent exhaustive field scoring', () => {
  for (const block of [null, { x: 0, y: 0, size: 3, symbol: 0 }, { x: 1, y: 1, size: 2, symbol: 0 }]) {
    const cells = block ? caribbeanBlockCells(block) : [], route = CARIBBEAN_LINES[0];
    const groups = new Map();
    for (let column = 0; column < 6; column++) {
      const position = route[column] * 6 + column, key = cells.includes(position) ? 'block' : String(position);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(position);
    }
    const assignments = [...groups.values()], grid = blank();
    let numerator = 0n;
    function visit(index, weight) {
      if (index === assignments.length) {
        const factor = scoreCaribbeanLines(grid, 1)[0]?.factor ?? 0;
        numerator += weight * BigInt(factor); return;
      }
      for (const candidate of CARIBBEAN_SYMBOLS) {
        for (const position of assignments[index]) grid[position] = candidate.id;
        visit(index + 1, weight * BigInt(candidate.weight));
      }
    }
    visit(0, 1n);
    equal(caribbeanDraftLineMean(route, block), q(numerator, 100n ** BigInt(assignments.length)));
  }
});
test('draft analysis explicitly remains unqualified and covers every line count', () => {
  const report = analyzeCaribbeanDraft();
  assert.equal(report.qualified, false);
  assert.equal(report.registeredWageredGame, false);
  for (const mode of ['base','raid','flagship']) assert.deepEqual(report.modes[mode].map(row => row.lines), [1,5,10,20]);
});
