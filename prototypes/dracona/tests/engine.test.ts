import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, COLS, PORTAL, CREST, MAX_CASCADES, MAX_TRANSFERS, blockAt, exchangeBlock, clustersOf, dropSymbols, playSpin, seededRandom, type Grid } from '../src/engine.ts';

const quiet = (): Grid => Array.from({ length: SIZE }, (_, i) => (i % 5 + 1) as Grid[number]);

test('clusters join orthogonal cells and do not wrap rows or join diagonals', () => {
  const grid = quiet();
  [3, 4, 5, 6, 7].forEach(i => { grid[i] = 0; });
  assert.equal(clustersOf(grid).some(group => group.symbol === 0), false);
  const diagonal = quiet();
  [0, 6, 12, 18, 4].forEach(i => { diagonal[i] = 0; });
  assert.equal(clustersOf(diagonal).some(group => group.symbol === 0), false);
  const connected = quiet();
  [0, 1, 5, 6, 10].forEach(i => { connected[i] = 0; });
  assert.deepEqual(clustersOf(connected).find(group => group.symbol === 0)?.cells.sort((a,b) => a-b), [0, 1, 5, 6, 10]);
});

test('exchanging a block preserves all symbols and the rest of the main grid', () => {
  const grid = quiet(), reserve: Grid = [0, PORTAL, CREST, 2];
  const originalGrid = [...grid], originalReserve = [...reserve];
  const result = exchangeBlock(grid, reserve, 13);
  assert.deepEqual(result.cells, [13, 14, 18, 19]);
  assert.deepEqual(result.reserve, [grid[13], grid[14], grid[18], grid[19]]);
  assert.deepEqual(result.cells.map(i => result.grid[i]), reserve);
  assert.deepEqual([...result.grid, ...result.reserve].sort(), [...grid, ...reserve].sort());
  assert.deepEqual(grid, originalGrid); assert.deepEqual(reserve, originalReserve);
  for (let i = 0; i < SIZE; i++) if (!result.cells.includes(i)) assert.equal(result.grid[i], grid[i]);
  assert.throws(() => blockAt(4)); assert.throws(() => blockAt(15)); assert.throws(() => blockAt(-1));
});

test('gravity preserves survivor order and new symbols enter from above the board', () => {
  const grid = Array.from({ length: SIZE }, (_, i) => Math.floor(i / COLS) as Grid[number]);
  const { grid: next, movements } = dropSymbols(grid, new Set([5, 15]), () => 0.5);
  assert.equal(next[15], 2); assert.equal(next[10], 0);
  assert.ok(movements.some(move => move.from === 10 && move.to === 15));
  assert.ok(movements.some(move => move.from === 0 && move.to === 10));
  assert.ok(movements.filter(move => move.to === 0 || move.to === 5).every(move => move.from < 0));
  for (let i = 0; i < SIZE; i++) if (i % COLS !== 0) assert.equal(next[i], grid[i]);
});

test('bonus uses the largest rune in the cluster and never multiplies runes together', () => {
  const grid = quiet(); [0, 1, 5, 6, 10].forEach(i => { grid[i] = 0; });
  const runes = Array(SIZE).fill(1); runes[0] = 2; runes[1] = 3;
  const result = playSpin({ bet: 100, random: seededRandom(23), bonus: true, runes, initialGrid: grid, initialReserve: [1, 2, 3, 4] });
  const win = result.steps.find(step => step.type === 'win');
  assert.ok(win && win.type === 'win');
  assert.equal(win.clusters[0].factor, 3); assert.equal(win.clusters[0].payout, 975);
  assert.ok(result.transfers >= 1);
  assert.ok(result.runes.every((value, index) => value >= runes[index] && value <= 5));
  const base = playSpin({ bet: 100, random: seededRandom(23), runes, initialGrid: quiet() });
  assert.ok(base.runes.every(value => value === 1));
});

test('three simultaneous crests award free spins and the bonus never exceeds twenty issued spins', () => {
  const grid = quiet(); [0, 7, 19].forEach(i => { grid[i] = CREST; });
  const base = playSpin({ bet: 100, random: seededRandom(11), initialGrid: grid });
  assert.equal(base.bonusAward, 8);
  const nearLimit = playSpin({ bet: 100, random: seededRandom(11), bonus: true, bonusIssued: 19, initialGrid: grid });
  assert.equal(nearLimit.bonusAward, 1);
  const atLimit = playSpin({ bet: 100, random: seededRandom(11), bonus: true, bonusIssued: 20, initialGrid: grid });
  assert.equal(atLimit.bonusAward, 0);
});

test('seeded spins replay exactly, settle integer payouts, and stay within event limits', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const options = { bet: 100, bonus: seed % 2 === 0, random: seededRandom(seed) };
    const first = playSpin(options), replay = playSpin({ ...options, random: seededRandom(seed) });
    assert.deepEqual(first, replay);
    assert.ok(first.transfers <= MAX_TRANSFERS);
    const wins = first.steps.filter(step => step.type === 'win');
    assert.ok(wins.length <= MAX_CASCADES);
    assert.equal(first.payout, wins.reduce((sum, step) => sum + step.payout, 0));
    assert.ok(Number.isSafeInteger(first.payout) && first.payout >= 0);
    assert.equal(first.grid.length, SIZE); assert.equal(first.reserve.length, 4);
    assert.ok(first.runes.every(value => value >= 1 && value <= 5));
  }
});

test('invalid stakes and malformed rune state cannot start a spin', () => {
  for (const bet of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => playSpin({ bet, random: seededRandom(1) }));
  assert.throws(() => playSpin({ bet: 100, random: seededRandom(1), runes: [2] }));
});

test('the enchanted bonus reserve can contain four matching symbols before the exchange', () => {
  const result = playSpin({ bet: 100, random: () => 0.2, bonus: true, initialGrid: quiet() });
  const first = result.steps[0];
  assert.equal(first.type, 'initial');
  if (first.type !== 'initial') return;
  assert.equal(new Set(first.reserve).size, 1);
  assert.ok(first.reserve.every(symbol => symbol < PORTAL));
});
