import assert from 'node:assert/strict';
import { randomFillSync, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { plinkoEngine } from '../../server/games/originals.ts';
import { exactPayoutUnits } from '../../src/shared/originalGames.ts';
import { volcanicTable, VOLCANIC_PROFILES } from '../../src/ui/volcanicPlinkoModel.ts';

// An offline audit of the existing 12-row tables. No wallet or production writes.
const initialDollars = 100_000, betDollars = 500, plannedRounds = 1000, players = 100_000;
const quantumDollars = 50;
const startingUnits = initialDollars / quantumDollars, stakeUnits = betDollars / quantumDollars;
const directory = 'artifacts/plinko-bankroll-100000-500-1000-20261020';
mkdirSync(directory, { recursive: true });
const buckets = Uint8Array.from({ length: 4096 }, (_, value) => {
  let count = 0; for (let bit = 0; bit < 12; bit++) count += value >> bit & 1;
  return count;
});
const pool = new Uint16Array(262_144); let cursor = pool.length;
const randomBucket = () => {
  if (cursor === pool.length) { randomFillSync(pool); cursor = 0; }
  return buckets[pool[cursor++] & 4095];
};
const quantile = (sorted, fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
const percent = value => value / players * 100;

function firstPassage(distribution, rounds) {
  const maxLoss = -Math.min(...distribution.map(row => row.delta));
  // f_n(b) = probability of balance falling below the stake by round n.
  // f_n(b) = sum p(delta) f_(n-1)(b + delta). Above this finite bound
  // even a run of maximum losses cannot reach the absorbing lower barrier.
  let previous = new Float64Array(stakeUnits).fill(1);
  let expectedRounds = 0, earlyStop = 0;
  for (let n = 1; n <= rounds; n++) {
    expectedRounds += 1 - (previous[startingUnits] ?? 0);
    const current = new Float64Array(stakeUnits + n * maxLoss);
    current.fill(1, 0, stakeUnits);
    for (let balance = stakeUnits; balance < current.length; balance++) {
      let probability = 0;
      for (const { delta, probability: p } of distribution) {
        probability += p * (previous[balance + delta] ?? 0);
      }
      current[balance] = probability;
    }
    if (n === rounds - 1) earlyStop = current[startingUnits] ?? 0;
    previous = current;
  }
  return { cannotFinishAllRoundsProbability: earlyStop,
    belowStakeByFinalRoundProbability: previous[startingUnits] ?? 0, expectedRounds };
}

const report = { date: '2026-10-20', game: 'royal-plinko', rows: 12,
  initialDollars, betDollars, plannedRounds, playersPerRisk: players,
  stopRule: 'Play until 1000 rounds have completed or the next full $500 stake is unaffordable. Preserve any remaining money. No topups or changes of stake.',
  randomness: 'node:crypto.randomFillSync of uniform uint16 values; twelve low bits select one of 4096 equiprobable binary paths. This is an offline model, not actual server transactions.',
  exactMethod: 'Finite first-passage dynamic programming, evaluated with IEEE-754 doubles. Exact table probabilities, no Monte Carlo estimation of rare stop probabilities.',
  zeroBalance: 'Impossible with this fixed stake and stop rule: every accepted round has a positive payout, so the final balance stays above zero.',
  results: [] };

for (const risk of ['easy', 'medium', 'hard']) {
  const table = volcanicTable(risk), counts = new Uint16Array(13), prepared = plinkoEngine.prepare({ rows: 12, risk });
  for (let path = 0; path < 4096; path++) {
    let bit = 0; const result = prepared.draw(max => { assert.equal(max, 2); return path >> bit++ & 1; });
    assert.equal(result.multiplier, table[buckets[path]]); counts[result.outcome.bucket]++;
  }
  const payouts = table.map(multiplier => {
    const cents = exactPayoutUnits(BigInt(betDollars * 100), multiplier);
    assert.equal(cents % BigInt(quantumDollars * 100), 0n);
    return Number(cents) / 100 / quantumDollars;
  });
  assert(Math.min(...payouts) > 0);
  const grouped = new Map();
  for (let bucket = 0; bucket < 13; bucket++) {
    const delta = payouts[bucket] - stakeUnits;
    grouped.set(delta, (grouped.get(delta) ?? 0) + counts[bucket] / 4096);
  }
  const distribution = [...grouped].map(([delta, probability]) => ({ delta, probability }));
  assert.equal(distribution.reduce((total, row) => total + row.probability, 0), 1);
  const exact = firstPassage(distribution, plannedRounds);
  const expectedDelta = distribution.reduce((sum, row) => sum + row.delta * row.probability * quantumDollars, 0);
  const theoreticalMean = initialDollars + expectedDelta * exact.expectedRounds;
  // Independent minimum-loss boundary checks for the recurrence.
  const maxLoss = -Math.min(...distribution.map(row => row.delta));
  const earliestPossible = Math.floor((startingUnits - stakeUnits) / maxLoss) + 1;
  assert.equal(firstPassage(distribution, earliestPossible - 1).belowStakeByFinalRoundProbability, 0);
  const minimumProbability = distribution.find(row => row.delta === -maxLoss).probability;
  assert(firstPassage(distribution, earliestPossible).belowStakeByFinalRoundProbability >= minimumProbability ** earliestPossible * (1 - 1e-10));

  const finals = new Float64Array(players), roundsPlayed = new Uint16Array(players);
  const results = { profit: 0, even: 0, loss: 0, stoppedEarly: 0, belowStakeAtEnd: 0, zero: 0 };
  let totalBalance = 0, squaredBalance = 0, totalRounds = 0;
  const example = { balancesDollars: [initialDollars], profitRounds: 0, stakeReturnedRounds: 0, partialLossRounds: 0 };
  for (let player = 0; player < players; player++) {
    let balance = startingUnits, played = 0;
    while (played < plannedRounds && balance >= stakeUnits) {
      const paid = payouts[randomBucket()]; balance += paid - stakeUnits; played++;
      if (player === 0) {
        example.balancesDollars.push(balance * quantumDollars);
        example[paid > stakeUnits ? 'profitRounds' : paid === stakeUnits ? 'stakeReturnedRounds' : 'partialLossRounds']++;
      }
    }
    const dollars = balance * quantumDollars;
    finals[player] = dollars; roundsPlayed[player] = played;
    totalBalance += dollars; squaredBalance += dollars * dollars; totalRounds += played;
    results[balance > startingUnits ? 'profit' : balance === startingUnits ? 'even' : 'loss']++;
    if (played < plannedRounds) results.stoppedEarly++;
    if (balance < stakeUnits) results.belowStakeAtEnd++;
    if (balance === 0) results.zero++;
  }
  assert.equal(results.zero, 0);
  finals.sort();
  const mean = totalBalance / players;
  const standardError = Math.sqrt((squaredBalance / players - mean * mean) / players);
  assert(Math.abs(mean - theoreticalMean) < standardError * 6, 'Monte Carlo mean differs by more than six standard errors');
  if (exact.cannotFinishAllRoundsProbability > 0.0001) {
    const deviation = Math.sqrt(players * exact.cannotFinishAllRoundsProbability * (1 - exact.cannotFinishAllRoundsProbability));
    assert(Math.abs(results.stoppedEarly - players * exact.cannotFinishAllRoundsProbability) < 6 * deviation);
  }
  const result = { risk, name: VOLCANIC_PROFILES[risk].label,
    exact: { ...exact, cannotFinishAllRoundsPercent: exact.cannotFinishAllRoundsProbability * 100,
      belowStakeByFinalRoundPercent: exact.belowStakeByFinalRoundProbability * 100,
      rtpPercent: (1 + expectedDelta / betDollars) * 100,
      expectedFinalDollars: theoreticalMean, expectedFinalIfAllRoundsPlayedDollars: initialDollars + plannedRounds * expectedDelta,
      zeroBalanceProbability: 0 },
    observed: { counts: results, percentages: Object.fromEntries(Object.entries(results).map(([key, count]) => [key, percent(count)])),
      meanFinalDollars: mean, meanConfidence95Dollars: [mean - 1.96 * standardError, mean + 1.96 * standardError],
      medianFinalDollars: quantile(finals, .5), finalP05Dollars: quantile(finals, .05), finalP95Dollars: quantile(finals, .95),
      finalP10Dollars: quantile(finals, .1), finalP90Dollars: quantile(finals, .9), meanRounds: totalRounds / players,
      minimumObservedDollars: finals[0], maximumObservedDollars: finals.at(-1) },
    example: { ...example, rounds: roundsPlayed[0], finalDollars: example.balancesDollars.at(-1) } };
  report.results.push(result);
  console.log(JSON.stringify({ risk, exact: result.exact, observed: result.observed }));
}
report.sources = ['server/games/originals.ts', 'server/games/vfair/plinko/plinko-multipliers.ts', 'src/shared/originalGames.ts', 'scripts/game-math/plinko-bankroll-simulation.mjs'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: 'passed', report: `${directory}/report.json` }));
