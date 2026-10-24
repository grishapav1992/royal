import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, simulateCohort, type SimulationReport, type Cohort } from './simulate-casino';

const input = resolve(fileURLToPath(new URL('../', import.meta.url)),
  process.argv[2] ?? 'artifacts/work/casino-simulation-20261022/results.json');
const report: SimulationReport = JSON.parse(await readFile(input, 'utf8'));
async function verifySources() {
  for (const source of report.sources) assert.equal(
    createHash('sha256').update(await readFile(source.path)).digest('hex'), source.sha256,
    source.path + ' changed since the original run',
  );
}
await verifySources();
type Risk = {
  gameId: string; name: string; rounds: number; stakesCents: number; payoutsCents: number;
  totalGgrCents: number; groupsPlayed: number; losingGroups: number;
  negativeGgrSumCents: number; positiveGgrSumCents: number; ggrInLosingCasinoGroupsCents: number;
  worst: { cohortIndex: number; seed: string; gameGgrCents: number; casinoGgrCents: number };
};
const games = new Map<string, Risk>();
let losses = 0, lossSum = 0, profitSum = 0, worstIndex = -1;
let worstCohort: Cohort | undefined;
for (let i = 0; i < report.ensemble.cohorts; i++) {
  const seed = report.seed + ':ensemble:' + i, cohort = simulateCohort(seed);
  assert.equal(cohort.ggrCents, report.ensemble.ggrSamplesCents[i], 'Original cohort replay');
  if (cohort.ggrCents < 0) { losses++; lossSum += cohort.ggrCents; } else profitSum += cohort.ggrCents;
  if (!worstCohort || cohort.ggrCents < worstCohort.ggrCents) { worstCohort = cohort; worstIndex = i; }
  let sum = 0;
  for (const game of cohort.games) {
    const ggr = game.stakesCents - game.payoutsCents;
    const row = games.get(game.gameId) ?? {
      gameId: game.gameId, name: game.name, rounds: 0, stakesCents: 0, payoutsCents: 0,
      totalGgrCents: 0, groupsPlayed: 0, losingGroups: 0, negativeGgrSumCents: 0,
      positiveGgrSumCents: 0, ggrInLosingCasinoGroupsCents: 0,
      worst: { cohortIndex: i, seed, gameGgrCents: ggr, casinoGgrCents: cohort.ggrCents },
    };
    row.rounds += game.rounds; row.stakesCents += game.stakesCents; row.payoutsCents += game.payoutsCents;
    row.totalGgrCents += ggr; row.groupsPlayed++; row.losingGroups += Number(ggr < 0);
    if (ggr < 0) row.negativeGgrSumCents += ggr; else row.positiveGgrSumCents += ggr;
    if (cohort.ggrCents < 0) row.ggrInLosingCasinoGroupsCents += ggr;
    if (ggr < row.worst.gameGgrCents) row.worst = { cohortIndex: i, seed, gameGgrCents: ggr, casinoGgrCents: cohort.ggrCents };
    games.set(game.gameId, row); sum += ggr;
  }
  assert.equal(sum, cohort.ggrCents);
  if ((i + 1) % 500 === 0) console.log(JSON.stringify({ stage: 'risk-replay', done: i + 1, cohorts: report.ensemble.cohorts }));
}
assert(worstCohort);
const rows = [...games.values()].map(row => ({ ...row,
  margin: row.totalGgrCents / row.stakesCents, lossRateWhenPlayed: row.losingGroups / row.groupsPlayed,
})).sort((a, b) => b.totalGgrCents - a.totalGgrCents);
for (const game of rows) {
  const original = report.ensemble.games.find(row => row.gameId === game.gameId)!;
  assert.equal(game.stakesCents, original.stakesCents); assert.equal(game.payoutsCents, original.payoutsCents);
  assert.equal(game.rounds, original.rounds);
  assert.equal(game.negativeGgrSumCents + game.positiveGgrSumCents, game.totalGgrCents);
}
assert.equal(losses / report.ensemble.cohorts, report.ensemble.casinoLossProbability);
assert.equal(rows.reduce((sum, row) => sum + row.ggrInLosingCasinoGroupsCents, 0), lossSum);
assert.equal(lossSum + profitSum, report.ensemble.ggrSamplesCents.reduce((a, b) => a + b, 0));
const detailed = simulateCohort(worstCohort.seed, true);
assert.equal(detailed.ggrCents, worstCohort.ggrCents);
await verifySources();
const analysis = {
  createdAt: new Date().toISOString(), seed: report.seed, cohorts: report.ensemble.cohorts,
  sourceResultsSha256: createHash('sha256').update(await readFile(input)).digest('hex'),
  allOriginalCohortsReplayedExactly: true, sourcesUnchanged: true,
  losingCasinoGroups: losses, casinoLossRate: losses / report.ensemble.cohorts,
  losingCasinoGroupsGgrSumCents: lossSum, profitableCasinoGroupsGgrSumCents: profitSum,
  meanLossCents: lossSum / losses, meanProfitCents: profitSum / (report.ensemble.cohorts - losses),
  overallMeanGgrCents: report.ensemble.ggrCents.mean, ggrStandardDeviationCents: report.ensemble.ggrCents.stddev,
  overallMargin: 1 - report.ensemble.weightedRtp,
  averageStakesPerGroupCents: report.ensemble.totalStakesCents / report.ensemble.cohorts,
  games: rows,
  worstCasinoGroup: { cohortIndex: worstIndex, seed: detailed.seed, ggrCents: detailed.ggrCents,
    depositsCents: detailed.depositsCents, withdrawalsCents: detailed.withdrawalsCents,
    retainedBalanceCents: detailed.retainedBalanceCents, rounds: detailed.rounds,
    games: detailed.games.map(row => ({ gameId: row.gameId, name: row.name,
      stakesCents: row.stakesCents, payoutsCents: row.payoutsCents, ggrCents: row.stakesCents - row.payoutsCents }))
      .sort((a, b) => a.ggrCents - b.ggrCents),
    largestPayouts: detailed.players.flatMap(player => player.trace.map(row => ({
      player: player.profile.id, gameId: MODES[row.mode].gameId, name: MODES[row.mode].name,
      round: row.round, stakeCents: row.stakeCents, payoutCents: row.payoutCents,
      casinoGgrCents: row.stakeCents - row.payoutCents, multiplier: row.payoutCents / row.stakeCents,
    }))).sort((a, b) => b.payoutCents - a.payoutCents).slice(0, 10),
  },
  notes: [
    'All amounts are fictional integer cents. GGR is stakes minus payouts, before operating costs.',
    'Games have different turnover and strategies. The rankings do not compare equal wagering volumes.',
    'Worst loss is a game total within one group of ten players, not one spin.',
    'Game loss rates are conditional on the game having been played in the group.',
    'Totals within casino-losing groups are descriptive conditional associations, not unconditional game expectations.',
    'The same 5000 original seeds and unchanged sources are replayed. No new scenarios enter the original ensemble.',
  ],
};
await writeFile(resolve(dirname(input), 'game-risk-analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
console.log(JSON.stringify({ stage: 'complete', losses,
  meanLossDollars: analysis.meanLossCents / 100, meanProfitDollars: analysis.meanProfitCents / 100,
  worstGroup: analysis.worstCasinoGroup,
  games: rows.map(game => ({ game: game.name, totalGgrDollars: game.totalGgrCents / 100,
    margin: game.margin, lossRate: game.lossRateWhenPlayed, worstGroupDollars: game.worst.gameGgrCents / 100,
    ggrInLosingGroupsDollars: game.ggrInLosingCasinoGroupsCents / 100 })) }, null, 2));
