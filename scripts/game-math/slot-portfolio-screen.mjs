// Screens current checked-out rules. Historical reports retain their original source hashes.
// Formal qualification is scripts/qualify-game-rtp.mjs, including all choices and stakes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { playSpin, seededRandom, SIZE } from '../../src/shared/draconaMath.ts';
import { startDracona, moveDracona } from '../../server/games/dracona.ts';
import { startNitro, moveNitro } from '../../server/games/nitroRun.ts';
import { startAfter, moveAfter } from '../../server/games/afterglow.ts';
import { startConvoy, moveConvoy } from '../../server/games/lastConvoy.ts';
import { startCaramel, moveCaramel } from '../../server/games/caramelCarnival.ts';
import { startLuelonSlotGame, moveLuelonSlotGame } from '../../server/games/luelonSlots.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes('--' + name) ? args[args.indexOf('--' + name) + 1] : fallback;
const rounds = Number(option('rounds', 10000)), runs = Number(option('runs', 3));
const draconaRounds = Number(option('dracona-rounds', 100000));
const cryptoRounds = Number(option('crypto-rounds', 10000));
assert([rounds, runs, draconaRounds, cryptoRounds].every(n => Number.isSafeInteger(n) && n > 0));
assert(rounds > 1 && draconaRounds > 1, 'At least two rounds are required for sample variance');
const output = resolve(option('output', 'artifacts/slot-portfolio-screen/report.json'));
const stake = '10000', seeds = Array.from({ length: runs }, (_, i) => (20261023 + i * 1000003) >>> 0);
const games = [
  { id: 'studio-nitro-run', alias: ['studio-meme-overload'], max: 21, start: draw => startNitro({ nitro: { mode: 'normal' } }, stake, draw), move: moveNitro },
  { id: 'studio-afterglow', max: 21, start: draw => startAfter({ afterglow: { mode: 'normal' } }, stake, 0, draw), move: moveAfter },
  { id: 'studio-last-convoy', max: 21, start: draw => startConvoy({ convoy: { mode: 'normal' } }, stake, draw), move: moveConvoy },
  { id: 'studio-caramel-carnival', max: 31, start: draw => startCaramel({ caramel: { mode: 'normal' } }, stake, draw), move: moveCaramel },
  ...['studio-cosmic-escape', 'studio-velvet-reign'].map(id => ({ id, max: 40,
    start: draw => startLuelonSlotGame(id, { luelon: { mode: 'normal' } }, stake, draw),
    move: (view, amount, revision, draw) => moveLuelonSlotGame(view, amount, revision, 'luelon-spin', undefined, draw) })),
];
const sourcePaths = ['src/shared/draconaMath.ts', 'src/shared/dracona.ts', 'server/games/dracona.ts',
  'src/shared/nitroRun.ts', 'server/games/nitroRun.ts', 'src/shared/memeOverload.ts',
  'src/shared/afterglow.ts', 'server/games/afterglow.ts', 'src/shared/lastConvoy.ts', 'server/games/lastConvoy.ts',
  'src/shared/caramelCarnival.ts', 'server/games/caramelCarnival.ts', 'src/shared/luelonSlots.ts',
  'src/shared/luelonSlotsModels.ts', 'server/games/luelonSlots.ts', 'server/games/velvetMath.ts', 'server/games/velvetReign.ts'];
const hashes = Object.fromEntries(await Promise.all(sourcePaths.map(async file =>
  [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const report = { generatedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  stakeCoins: 100, mode: 'normal', draconaRulesVersion: 3, seeds, sourceHashes: hashes,
  method: 'Seeded screening of complete paid rounds with all free continuations. Dracona uses the unchanged pure engine and exact server rounding, cross-checked against full server start/move on the first 100 rounds of every seed. Other games use full server start/move and validators on every round. Approximate 95% intervals use sample variance across independent paid rounds. No correction for multiple comparisons; this is screening, not certification. Bonus purchases, alternate modes and strategies are outside scope.',
  results: [] };

function stats() { return { n: 0, sum: 0, squares: 0, positive: 0, profit: 0, bonuses: 0, freeSpins: 0, max: 0, paidContribution: 0, freeContribution: 0 }; }
function add(s, total, paid, free) {
  const value = total / Number(stake);
  s.n++; s.sum += value; s.squares += value * value; s.positive += Number(total > 0); s.profit += Number(total > Number(stake));
  s.bonuses += Number(free > 0); s.freeSpins += free; s.max = Math.max(s.max, value);
  s.paidContribution += paid / Number(stake); s.freeContribution += (total - paid) / Number(stake);
}
function finish(s) {
  const rtp = s.sum / s.n, se = Math.sqrt(Math.max(0, (s.squares - s.sum * s.sum / s.n) / (s.n - 1) / s.n));
  const interval95 = [rtp - 1.96 * se, rtp + 1.96 * se];
  return { ...s, rtp, interval95, positiveRate: s.positive / s.n, profitRate: s.profit / s.n,
    bonusRate: s.bonuses / s.n, paidRtp: s.paidContribution / s.n, bonusRtp: s.freeContribution / s.n,
    flag: interval95[0] > 1 ? 'return_above_100_percent' : 'not_flagged_by_screening' };
}
const allDracona = stats(), draconaSeeds = [];
for (const seed of seeds) {
  const random = seededRandom(seed), draw = max => Math.floor(random() * max), s = stats();
  const referenceRandom = seededRandom(seed), referenceDraw = max => Math.floor(referenceRandom() * max);
  for (let round = 0; round < draconaRounds; round++) {
    let remaining = 0, issued = 0, runes = Array(SIZE).fill(1), total = 0, paid = 0, free = 0;
    do {
      const result = playSpin({ bet: 100, bonus: free > 0 || issued > 0, runes, bonusIssued: issued,
        random: () => draw(4294967296) / 4294967296 });
      if (issued > 0) { remaining--; free++; } else paid = Math.round(result.payout * 100);
      total += Math.round(result.payout * 100); remaining += result.bonusAward; issued += result.bonusAward; runes = result.runes;
      assert(free <= 20 && issued <= 20 && total <= Number(stake) * 100000);
    } while (remaining > 0);
    if (round < 100) {
      let reference = startDracona({ dracona: { mode: 'normal' } }, stake, referenceDraw);
      while (!reference.ended) reference = moveDracona(reference.view, stake, reference.view.revision, referenceDraw);
      assert.equal(reference.credit, total);
      assert.equal(reference.view.freePlayed, free);
      assert.deepEqual(reference.view.history.at(-1).result.runes, runes);
    }
    add(s, total, paid, free); add(allDracona, total, paid, free);
  }
  draconaSeeds.push({ seed, ...finish(s) });
  console.log(JSON.stringify({ game: 'studio-dracona', seed, ...finish(s) }));
}
report.results.push({ game: 'studio-dracona', ...finish(allDracona), seeds: draconaSeeds, serverCrossCheckedRounds: Math.min(100, draconaRounds) * runs });
const native = stats();
for (let round = 0; round < cryptoRounds; round++) {
  let result = startDracona({ dracona: { mode: 'normal' } }, stake), free = 0;
  const paid = Number(result.view.totalPayoutUnits);
  while (!result.ended) {
    assert(free < 20);
    result = moveDracona(result.view, stake, result.view.revision); free++;
  }
  add(native, result.credit, paid, free);
}
report.cryptoDracona = { rng: 'node:crypto.randomInt', paidStakeCoins: 100, ...finish(native) };
console.log(JSON.stringify({ game: 'studio-dracona', rng: 'node:crypto.randomInt', ...finish(native) }));
for (const game of games) {
  const aggregate = stats(), samples = [];
  for (const seed of seeds) {
    const random = seededRandom(seed), draw = max => Math.floor(random() * max), s = stats();
    for (let round = 0; round < rounds; round++) {
      let result = game.start(draw), free = 0;
      const first = result.view ?? result.luelon;
      const paid = Number(first.totalPayoutUnits);
      while (!result.ended) {
        assert(free + 1 < game.max, game.id + ' exceeded its spin bound');
        const view = result.view ?? result.luelon;
        result = game.move(view, stake, view.revision, draw); free++;
      }
      const view = result.view ?? result.luelon;
      assert.equal(result.credit, Number(view.totalPayoutUnits));
      add(s, result.credit, paid, free); add(aggregate, result.credit, paid, free);
    }
    samples.push({ seed, ...finish(s) }); console.log(JSON.stringify({ game: game.id, seed, ...finish(s) }));
  }
  report.results.push({ game: game.id, aliases: game.alias ?? [], ...finish(aggregate), seeds: samples });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, flagged: report.results.filter(r => r.flag === 'return_above_100_percent').map(r => r.game) }));
if (report.results.some(r => r.flag === 'return_above_100_percent')) process.exitCode = 2;
