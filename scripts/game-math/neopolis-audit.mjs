// Read-only rules-v2 audit. No accounts, database, environment files or production access.
// Run from the repository root: node --import tsx scripts/game-math/neopolis-audit.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { HEROES, MAX_ROUND_SPINS, initialTeam, playNeopolisSpin } from '../../src/shared/neopolisMath.ts';
import { NEOPOLIS_MAX_WIN, advanceNeopolis, emptyNeopolisView } from '../../src/shared/neopolis.ts';
import { seededRandom } from '../../src/shared/draconaMath.ts';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf('--' + name);
  return index === -1 ? fallback : args[index + 1];
}
function count(name, fallback) {
  const n = Number(option(name, fallback));
  assert(Number.isSafeInteger(n) && n > 0, 'Invalid --' + name);
  return n;
}
const rounds = count('rounds', 10000), runs = count('runs', 10), players = count('players', 1000);
const playerRounds = count('player-rounds', 30), seed = count('seed', 20261023);
const output = resolve(option('output', 'artifacts/neopolis-audit/report.json'));
const maximumRtp = Number(option('max-rtp', 1));
assert(Number.isFinite(maximumRtp) && maximumRtp > 0);
const stakeUnits = 10000, initialUnits = 1000000, targetUnits = 1970000;
const quantile = (sorted, p) => sorted[Math.floor((sorted.length - 1) * p)];
const sum = values => values.reduce((total, value) => total + value, 0);
const ratio = (n, d) => d ? n / d : 0;

function playRound(team, random, verify = false) {
  let battle = null, payoutUnits = 0, bonusUnits = 0, paidUnits = 0, spins = 0, winningFree = 0;
  let replay = verify ? emptyNeopolisView(team) : undefined;
  do {
    const origin = structuredClone(team), sourceBattle = battle ? structuredClone(battle) : null;
    const draws = [];
    const result = playNeopolisSpin(origin, sourceBattle, () => {
      const value = Math.floor(random() * 4294967296);
      if (verify) draws.push(value);
      return value / 4294967296;
    });
    const raw = Number(BigInt(stakeUnits) * BigInt(result.points) / 40n);
    const amount = Math.min(raw, stakeUnits * NEOPOLIS_MAX_WIN - payoutUnits);
    payoutUnits += amount;
    if (result.free) { bonusUnits += amount; if (amount > 0) winningFree++; } else paidUnits += amount;
    team = result.team; battle = result.battle; spins++;
    assert(spins <= MAX_ROUND_SPINS && payoutUnits <= stakeUnits * NEOPOLIS_MAX_WIN);
    if (verify) {
      let cursor = 0;
      const next = advanceNeopolis(replay, String(stakeUnits), () => draws[cursor++]);
      assert.equal(cursor, draws.length);
      assert.deepEqual(next.view.history.at(-1).result, result);
      assert.equal(Number(next.view.totalPayoutUnits), payoutUnits);
      replay = next.view;
    }
    if (payoutUnits === stakeUnits * NEOPOLIS_MAX_WIN) { team = { ...team, complete: true }; break; }
  } while (battle && battle.remaining > 0);
  return { team, payoutUnits, paidUnits, bonusUnits, freeSpins: spins - 1, winningFree,
    defeated: battle?.defeated ?? 0, capped: payoutUnits === stakeUnits * NEOPOLIS_MAX_WIN };
}

const files = ['src/shared/neopolisMath.ts', 'src/shared/neopolis.ts', 'src/shared/draconaMath.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file =>
  [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const report = {
  generatedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  rulesVersion: 2, sourceHashes, configuration: { roundsPerRun: rounds, runsPerHero: runs, seed, playersPerHero: players,
    playerPaidRounds: playerRounds, stakeCoins: stakeUnits / 100, initialCoins: initialUnits / 100, targetCoins: targetUnits / 100, maximumRtp },
  method: 'Seeded Monte Carlo using the unchanged production spin engine, integer settlement formula and per-round cap. Team progress persists between paid rounds. Every triggered bonus is completed. First paid round of every seed is cross-checked with advanceNeopolis. Paid stakes form the RTP denominator. Seed ranges are descriptive, not confidence intervals or certified theoretical RTP.',
  heroes: [], acceptance: { payoutBounds: true, roundBounds: true, settlementSpotChecks: true, rtpBelowMaximum: true },
};

for (const [heroIndex, hero] of HEROES.entries()) {
  const payouts = [], seedResults = [];
  let paid = 0, bonus = 0, free = 0, freeWins = 0, triggers = 0, fullLength = 0, caps = 0;
  const outcomes = { noPayout: 0, partialReturn: 0, stakeReturned: 0, profit: 0, big10x: 0, epic25x: 0 };
  const bossesDefeated = [0, 0, 0, 0];
  for (let run = 0; run < runs; run++) {
    const runSeed = (seed + heroIndex * 1000003 + run * 7919) >>> 0;
    const random = seededRandom(runSeed);
    let team = initialTeam(hero), total = 0;
    for (let round = 0; round < rounds; round++) {
      if (team.complete) team = initialTeam(hero);
      const result = playRound(team, random, round === 0);
      team = result.team; total += result.payoutUnits; payouts.push(result.payoutUnits / stakeUnits);
      paid += result.paidUnits; bonus += result.bonusUnits; free += result.freeSpins; freeWins += result.winningFree;
      if (result.freeSpins) { triggers++; bossesDefeated[result.defeated]++; }
      if (result.freeSpins === MAX_ROUND_SPINS - 1) fullLength++;
      if (result.capped) caps++;
      if (result.payoutUnits === 0) outcomes.noPayout++;
      else if (result.payoutUnits < stakeUnits) outcomes.partialReturn++;
      else if (result.payoutUnits === stakeUnits) outcomes.stakeReturned++;
      else outcomes.profit++;
      if (result.payoutUnits >= stakeUnits * 10) outcomes.big10x++;
      if (result.payoutUnits >= stakeUnits * 25) outcomes.epic25x++;
    }
    seedResults.push({ seed: runSeed, paidRounds: rounds, rtp: total / (rounds * stakeUnits) });
    console.log(JSON.stringify({ phase: 'sample', hero, completedRuns: run + 1, runs, rtp: seedResults.at(-1).rtp }));
  }
  const balances = [], sample = [];
  let reachedTarget = 0, finishAboveStart = 0, insufficient = 0;
  for (let player = 0; player < players; player++) {
    const playerSeed = (seed + 0x40000000 + heroIndex * 1000003 + player * 7919) >>> 0;
    const random = seededRandom(playerSeed);
    let team = initialTeam(hero), balance = initialUnits, maximum = balance, completed = 0;
    const history = [];
    for (; completed < playerRounds; completed++) {
      if (balance < stakeUnits) { insufficient++; break; }
      if (team.complete) team = initialTeam(hero);
      const result = playRound(team, random);
      team = result.team; balance += result.payoutUnits - stakeUnits; maximum = Math.max(maximum, balance);
      if (player === 0) history.push({ paidRound: completed + 1, payoutCoins: result.payoutUnits / 100,
        freeSpins: result.freeSpins, bossesDefeated: result.defeated, balanceCoins: balance / 100 });
    }
    if (maximum >= targetUnits) reachedTarget++;
    if (balance > initialUnits) finishAboveStart++;
    balances.push(balance / 100);
    if (player === 0) sample.push({ seed: playerSeed, completedPaidRounds: completed, history });
  }
  payouts.sort((a, b) => a - b); balances.sort((a, b) => a - b);
  const n = rounds * runs, rtp = (paid + bonus) / (n * stakeUnits);
  report.heroes.push({ hero, paidRounds: n, totalSpins: n + free, rtp, paidSpinContribution: paid / (n * stakeUnits),
    bonusContribution: bonus / (n * stakeUnits), seedRtpRange: [Math.min(...seedResults.map(r => r.rtp)), Math.max(...seedResults.map(r => r.rtp))],
    outcomes, profitRate: outcomes.profit / n, positivePayoutRate: 1 - outcomes.noPayout / n,
    bonus: { triggers, triggerRate: triggers / n, freeSpins: free, positiveFreeSpinRate: ratio(freeWins, free),
      meanFreeSpins: ratio(free, triggers), fullLength45Rate: ratio(fullLength, triggers), bossesDefeated, caps,
      meanPayoutInStakes: ratio(bonus, triggers * stakeUnits) },
    roundPayoutInStakes: { median: quantile(payouts, .5), p90: quantile(payouts, .9), p99: quantile(payouts, .99), max: payouts.at(-1) },
    playerCohort: { players, paidRounds: playerRounds, finishAboveStartRate: finishAboveStart / players,
      reached19700Rate: reachedTarget / players, insufficient, meanFinalCoins: sum(balances) / players,
      finalCoins: { min: balances[0], p10: quantile(balances, .1), median: quantile(balances, .5), p90: quantile(balances, .9), max: balances.at(-1) }, sample },
    seeds: seedResults });
  if (rtp > maximumRtp) report.acceptance.rtpBelowMaximum = false;
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, acceptance: report.acceptance, results: report.heroes.map(({ hero, rtp, bonus, playerCohort }) =>
  ({ hero, rtp, meanFreeSpins: bonus.meanFreeSpins, reached19700Rate: playerCohort.reached19700Rate })) }));
// Exit 2 is an observed payout-budget failure, distinct from an engine invariant failure.
if (!report.acceptance.rtpBelowMaximum) process.exitCode = 2;
