import assert from 'node:assert/strict';
import { randomInt, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { plinkoEngine } from '../../server/games/originals.ts';
import { exactPayoutUnits } from '../../src/shared/originalGames.ts';
import { volcanicTable, VOLCANIC_PROFILES, validVolcanicRound } from '../../src/ui/volcanicPlinkoModel.ts';

// Audit only. It does not modify game rules, balances, environment settings or production.
const directory = 'artifacts/plinko-player-audit-20261020';
mkdirSync(directory, { recursive: true });
const risks = ['easy', 'medium', 'hard'];
const bets = [10, 50, 100, 500];
const sampleRounds = 1_000_000;
const players = 100_000;
const plannedRounds = 100;
const initialCoins = 1000;
const bucketByCode = Array.from({ length: 4096 }, (_, code) => {
  let count = 0; for (let index = 0; index < 12; index++) count += code >> index & 1;
  return count;
});
const category = (paid, stake) => paid > stake ? 'profit' : paid === stake ? 'stakeReturned' : paid > 0 ? 'partialReturnLoss' : 'totalLoss';
const empty = () => ({ profit: 0, stakeReturned: 0, partialReturnLoss: 0, totalLoss: 0 });
const percent = (n, d) => n / d * 100;
const quantile = (sorted, fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    let x = state += 0x6d2b79f5;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return (x ^ x >>> 14) >>> 0;
  };
}
const report = { date: '2026-10-20', game: 'Veil of Night / royal-plinko', definitions: {
  profit: 'Payout exceeds the full stake.', stakeReturned: 'Payout equals the full stake, zero net result.',
  partialReturnLoss: 'Positive payout below the full stake, a net loss.', totalLoss: 'Zero payout.',
  earlyStop: 'Balance cannot cover the next fixed stake before completing the planned 100 rounds. It can remain positive.',
}, exact: [], randomSamples: [], playerSessions: [] };

for (const risk of risks) {
  const prepared = plinkoEngine.prepare({ rows: 12, risk });
  const table = volcanicTable(risk), multiplicities = Array(13).fill(0), counts = empty();
  const returnUnits = Object.fromEntries(bets.map(bet => [bet, 0n]));
  for (let code = 0; code < 4096; code++) {
    let index = 0;
    const result = prepared.draw(max => { assert.equal(max, 2); return code >> index++ & 1; });
    assert.equal(index, 12); assert.equal(result.outcome.bucket, bucketByCode[code]);
    assert(prepared.verifyOutcome(result.outcome, result.multiplier));
    assert.equal(result.multiplier, table[result.outcome.bucket]);
    multiplicities[result.outcome.bucket]++;
    counts[category(Math.round(result.multiplier * 100), 100)]++;
    for (const bet of bets) {
      const stake = BigInt(bet * 100), payout = exactPayoutUnits(stake, result.multiplier);
      assert(validVolcanicRound({ ...result, rulesVersion: 1, stakeUnits: String(stake), payoutUnits: String(payout) }));
      returnUnits[bet] += payout;
    }
  }
  const rtpByBet = Object.fromEntries(bets.map(bet => [bet, Number(returnUnits[bet]) / (bet * 100 * 4096) * 100]));
  assert(Object.values(rtpByBet).every(value => value === rtpByBet[10]));
  report.exact.push({ risk, name: VOLCANIC_PROFILES[risk].label, paths: 4096, counts,
    percent: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, percent(count, 4096)])),
    expectedPer1000: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count / 4096 * 1000])),
    rtpPercent: rtpByBet[10], rtpByBet, maximumMultiplier: Math.max(...table), minimumMultiplier: Math.min(...table),
    maxWinProbabilityPercent: percent(multiplicities.filter((_, i) => table[i] === Math.max(...table)).reduce((a, b) => a + b, 0), 4096),
    distribution: table.map((multiplier, bucket) => ({ bucket, multiplier, paths: multiplicities[bucket], probabilityPercent: percent(multiplicities[bucket], 4096), category: category(Math.round(multiplier * 100), 100) })),
  });
  const sampleCounts = empty(); let sum = 0, squareSum = 0;
  const cents = table.map(value => Math.round(value * 100));
  for (let round = 0; round < sampleRounds; round++) {
    const value = cents[bucketByCode[randomInt(4096)]];
    sum += value; squareSum += value * value; sampleCounts[category(value, 100)]++;
  }
  const rtpPercent = sum / sampleRounds;
  const standardError = Math.sqrt((squareSum / sampleRounds - rtpPercent ** 2) / sampleRounds);
  const exactRtp = report.exact.at(-1).rtpPercent;
  assert(Math.abs(rtpPercent - exactRtp) <= standardError * 6, 'CSPRNG sample is more than six standard errors from the exact return');
  report.randomSamples.push({ risk, rounds: sampleRounds, rng: 'node:crypto.randomInt(4096), a uniform block of twelve binary choices', counts: sampleCounts,
    rtpPercent, confidence95Percent: [rtpPercent - 1.96 * standardError, rtpPercent + 1.96 * standardError], standardErrorsFromExact: (rtpPercent - exactRtp) / standardError });
  console.log(JSON.stringify({ stage: 'exact-and-million-rounds', risk, exact: report.exact.at(-1).percent, sampleCounts, rtpPercent }));

  for (const bet of bets) {
    const seed = (0xa71c2026 ^ Math.imul(risks.indexOf(risk) + 1, 0x9e3779b9) ^ Math.imul(bet, 0x85ebca6b)) >>> 0;
    const next = seeded(seed), payouts = cents.map(value => value * bet), stakeUnits = bet * 100;
    const finals = [], streaks = [], roundCounts = [], endResults = { profit: 0, even: 0, loss: 0, stoppedEarly: 0, unableNext: 0 };
    let totalRounds = 0, totalBalance = 0; const example = { balancesCoins: [initialCoins], outcomes: empty(), multipliers: [] };
    for (let player = 0; player < players; player++) {
      let balance = initialCoins * 100, played = 0, streak = 0, longest = 0;
      while (played < plannedRounds && balance >= stakeUnits) {
        const bucket = bucketByCode[next() & 4095], paid = payouts[bucket];
        balance += paid - stakeUnits; played++;
        streak = paid < stakeUnits ? streak + 1 : 0; longest = Math.max(longest, streak);
        if (player === 0) { example.balancesCoins.push(balance / 100); example.multipliers.push(table[bucket]); example.outcomes[category(paid, stakeUnits)]++; }
      }
      finals.push(balance / 100); streaks.push(longest); roundCounts.push(played);
      totalRounds += played; totalBalance += balance;
      endResults[balance > initialCoins * 100 ? 'profit' : balance === initialCoins * 100 ? 'even' : 'loss']++;
      if (played < plannedRounds) endResults.stoppedEarly++;
      if (balance < stakeUnits) endResults.unableNext++;
    }
    finals.sort((a, b) => a - b); streaks.sort((a, b) => a - b); roundCounts.sort((a, b) => a - b);
    report.playerSessions.push({ risk, betCoins: bet, initialCoins, plannedRounds, players, seed, rng: 'Mulberry32; reproducible statistical model only, not production RNG',
      endResults, endPercent: Object.fromEntries(Object.entries(endResults).map(([key, count]) => [key, percent(count, players)])),
      meanFinalCoins: totalBalance / players / 100, medianFinalCoins: quantile(finals, .5), finalP10Coins: quantile(finals, .1), finalP90Coins: quantile(finals, .9),
      meanRounds: totalRounds / players, medianRounds: quantile(roundCounts, .5), medianLongestLossStreak: quantile(streaks, .5), p95LongestLossStreak: quantile(streaks, .95),
      example: { ...example, rounds: example.multipliers.length, finalCoins: example.balancesCoins.at(-1) },
    });
  }
}
report.methodology = { exactPathsPerRisk: 4096, exactStakeChecks: 4096 * risks.length * bets.length,
  cryptoSamplesPerRisk: sampleRounds, sessionsPerRiskAndBet: players, totalModelSessions: report.playerSessions.length * players,
  noBankrollTopups: true, noStrategyChanges: true, sessionRules: 'Stake stays fixed. Stop at 100 rounds or when the next full stake is unaffordable. No deposits during a session.',
  warning: 'Exact probabilities are not guaranteed frequencies in any individual session. RTP is an average of total payouts divided by total stakes, not a probability of profit.' };
report.sources = ['server/games/originals.ts', 'server/games/vfair/plinko/plinko-multipliers.ts', 'src/shared/originalGames.ts', 'src/ui/volcanicPlinkoModel.ts'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ stage: 'complete', report: `${directory}/report.json`, sessions: report.methodology.totalModelSessions,
  defaultBet50: report.playerSessions.filter(row => row.betCoins === 50).map(({ risk, endPercent, medianFinalCoins, meanFinalCoins, meanRounds, p95LongestLossStreak }) => ({ risk, endPercent, medianFinalCoins, meanFinalCoins, meanRounds, p95LongestLossStreak })) }));
