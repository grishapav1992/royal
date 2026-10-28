import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { HEROES, initialTeam, playNeopolisSpin, NEOPOLIS_MATH } from '../../src/shared/neopolisMath.ts';
import { playNeopolisSpin as playV3 } from '../../src/shared/neopolisMathV3.ts';
const NEOPOLIS_BETS = [10,20,50,100,200,500], NEOPOLIS_MAX_WIN = 3000;
import { seededRandom } from '../../src/shared/draconaMath.ts';

// Candidate audit only: the current production server rejects variable stakes.
// The same draws couple stake policies; different policies are not independent samples.
const cyclesPerSeed = Number(process.env.NEOPOLIS_AUDIT_CYCLES || 10000);
const seeds = [11032791, 76320817];
const stakes = NEOPOLIS_BETS.map(value => value * 100), denominator = 40n * BigInt(NEOPOLIS_MATH.payDenominator);
const sources = ['src/shared/neopolisMath.ts', 'src/shared/neopolisMathV3.ts', 'scripts/game-math/neopolis-variable-stake-audit.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const sourceHashes = await hashes(), startedAt = new Date().toISOString();
const rows = [];
for (const hero of HEROES) {
  const a = seededRandom(91731), b = seededRandom(91731); let team = initialTeam(hero), battle = null;
  for (let i = 0; i < 200; i++) {
    if (team.complete) team = initialTeam(hero);
    const original = playV3(team, battle, a), fast = playNeopolisSpin(team, battle, b, false);
    assert.deepEqual({ ...fast, frames: original.frames }, original);
    team = original.team; battle = original.battle?.remaining ? original.battle : null;
  }
}
const moment = () => ({ cycles: 0, paidRounds: 0, freeSpins: 0, rewardUnits: 0, costUnits: 0, rewardSquared: 0, rewardCost: 0, costSquared: 0 });
function record(sum, reward, cost, paid, free) {
  sum.cycles++; sum.paidRounds += paid; sum.freeSpins += free; sum.rewardUnits += reward; sum.costUnits += cost;
  sum.rewardSquared += reward * reward; sum.rewardCost += reward * cost; sum.costSquared += cost * cost;
}
function finish(sum) {
  const rtp = sum.rewardUnits / sum.costUnits;
  const residual = Math.max(0, sum.rewardSquared - 2 * rtp * sum.rewardCost + rtp * rtp * sum.costSquared);
  const half = 1.96 * Math.sqrt(sum.cycles * residual / (sum.cycles - 1)) / sum.costUnits;
  return { ...sum, rtp, interval95: [rtp - half, rtp + half] };
}
for (const [heroIndex, hero] of HEROES.entries()) {
  const choices = [...stakes.map(stake => 'fixed-' + stake), 'raise-when-ready', 'lower-when-ready'];
  const sums = choices.map(moment);
  for (const baseSeed of seeds) {
    const random = seededRandom(baseSeed + heroIndex * 1000003);
    for (let cycle = 0; cycle < cyclesPerSeed; cycle++) {
      let team = initialTeam(hero), paid = 0, free = 0;
      const cost = choices.map(() => 0), reward = choices.map(() => 0);
      do {
        const ready = team.charges.every(charge => charge === 3);
        const selected = [...stakes, ready ? stakes.at(-1) : stakes[0], ready ? stakes[0] : stakes.at(-1)];
        const units = stakes.map(() => 0);
        let battle = null;
        do {
          const result = playNeopolisSpin(team, battle, random, false);
          team = result.team; battle = result.battle; if (result.free) free++;
          for (let i = 0; i < stakes.length; i++) units[i] = Math.min(stakes[i] * NEOPOLIS_MAX_WIN,
            units[i] + Number(BigInt(stakes[i]) * BigInt(result.points) / denominator));
          const capped = units.map((value, i) => value === stakes[i] * NEOPOLIS_MAX_WIN);
          if (capped.some(Boolean)) {
            assert(capped.every(Boolean), 'Caps diverged across stakes; audit independently');
            team = { ...team, complete: true }; break;
          }
        } while (battle?.remaining);
        for (let i = 0; i < choices.length; i++) { cost[i] += selected[i]; reward[i] += units[stakes.indexOf(selected[i])]; }
        paid++; assert(paid < 100000, 'Collection did not finish');
      } while (!team.complete);
      for (let i = 0; i < choices.length; i++) record(sums[i], reward[i], cost[i], paid, free);
      if ((cycle + 1) % 2000 === 0) console.log(JSON.stringify({ hero, seed: baseSeed, cycles: cycle + 1, raiseRtp: finish(sums.at(-2)).rtp }));
    }
  }
  rows.push(...choices.map((choice, i) => ({ hero, choice, ...finish(sums[i]) })));
}
assert.deepEqual(await hashes(), sourceHashes, 'Audit source changed while running');
const report = { kind: 'candidate-diagnostic-not-qualification', rulesVersion: 3, startedAt, completedAt: new Date().toISOString(),
  sourceHashes, cyclesPerSeed, seeds, stakes, target: .96, maxUpper95: .98,
  method: 'Independent regenerative team cycles with all paid collection costs and complete bonus continuations. Integer units, per-spin rounding and per-round cap. Candidate policies ignore only the current cross-round stake lock; hero choice, progress, payouts and entropy are unchanged. Different policies share entropy and must not be pooled.',
  rows, candidateWithinBudget: rows.every(row => row.interval95[1] <= .98 && Math.abs(row.rtp - .96) <= .01) };
const file = process.env.NEOPOLIS_AUDIT_OUTPUT || 'docs/game-math/neopolis-variable-stake-v3-audit-20261028.json';
await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: file, candidateWithinBudget: report.candidateWithinBudget, rows: rows.filter(row => !row.choice.startsWith('fixed-')).map(({ hero, choice, rtp, interval95 }) => ({ hero, choice, rtp, interval95 })) }));
