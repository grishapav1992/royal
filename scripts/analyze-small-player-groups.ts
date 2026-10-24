import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, simulatePlayer, sampleStats, type SimulationReport } from './simulate-casino';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = resolve(root, process.argv[2] ?? 'artifacts/work/casino-simulation-20261022/results.json');
const original: SimulationReport = JSON.parse(await readFile(input, 'utf8'));
const runs = 10000;
async function verifySources() {
  for (const source of original.sources) assert.equal(
    createHash('sha256').update(await readFile(resolve(root, source.path))).digest('hex'),
    source.sha256, source.path + ' changed since the baseline',
  );
}
await verifySources();
const comparisons = [];
for (const groupSize of [1, 2]) {
  const ggr: number[] = [], cashShortfalls: number[] = [], obligationShortfalls: number[] = [];
  const onePlayerPeakReserve: number[] = [];
  let lossGroups = 0, cashShortfallGroups = 0, totalDeposits = 0;
  let worst = { runIndex: -1, ggrCents: 0, depositsCents: 0, withdrawalsCents: 0,
    retainedBalanceCents: 0, players: [] as { profile: number; depositCents: number; profitCents: number; peakGainCents: number }[] };
  for (let i = 0; i < runs; i++) {
    // Equal weights for all ten profiles; all 100 ordered profile pairs occur equally often.
    // Two independent players can have the same profile.
    const selected = groupSize === 1 ? [i % PROFILES.length]
      : [i % PROFILES.length, Math.floor(i / PROFILES.length) % PROFILES.length];
    const players = selected.map((profile, slot) => simulatePlayer(PROFILES[profile],
      original.seed + ':small-groups:' + groupSize + ':run:' + i + ':slot:' + slot));
    const sum = (read: (player: typeof players[number]) => number) => players.reduce((total, p) => total + read(p), 0);
    const depositsCents = sum(p => p.profile.depositCents), withdrawalsCents = sum(p => p.withdrawnCents);
    const retainedBalanceCents = sum(p => p.balanceCents), ggrCents = -sum(p => p.profitCents);
    assert.equal(ggrCents, depositsCents - withdrawalsCents - retainedBalanceCents);
    assert.equal(ggrCents, sum(p => p.stakesCents - p.payoutsCents));
    const obligationShortfall = Math.max(0, -ggrCents);
    const cashShortfall = Math.max(0, withdrawalsCents - depositsCents);
    assert(cashShortfall <= obligationShortfall);
    ggr.push(ggrCents); obligationShortfalls.push(obligationShortfall); cashShortfalls.push(cashShortfall);
    if (groupSize === 1) onePlayerPeakReserve.push(Math.max(0, players[0].peakWealthCents - players[0].profile.depositCents));
    lossGroups += Number(ggrCents < 0); cashShortfallGroups += Number(cashShortfall > 0); totalDeposits += depositsCents;
    if (ggrCents < worst.ggrCents) worst = { runIndex: i, ggrCents, depositsCents, withdrawalsCents, retainedBalanceCents,
      players: players.map(p => ({ profile: p.profile.id, depositCents: p.profile.depositCents,
        profitCents: p.profitCents, peakGainCents: p.peakWealthCents - p.profile.depositCents })) };
    if ((i + 1) % 2500 === 0) console.log(JSON.stringify({ groupSize, done: i + 1, runs }));
  }
  comparisons.push({ groupSize, runs, simulatedSessions: groupSize * runs, lossGroups,
    lossProbability: lossGroups / runs, actualRequestedCashShortfallGroups: cashShortfallGroups,
    actualRequestedCashShortfallProbability: cashShortfallGroups / runs,
    meanDepositCents: totalDeposits / runs, ggrCents: sampleStats(ggr),
    closingObligationShortfallCents: sampleStats(obligationShortfalls),
    actualRequestedCashShortfallCents: sampleStats(cashShortfalls),
    singlePlayerPeakReserveCents: groupSize === 1 ? sampleStats(onePlayerPeakReserve) : null, worst });
}
await verifySources();
const report = {
  createdAt: new Date().toISOString(), seed: original.seed, runsPerGroupSize: runs,
  baselineSha256: createHash('sha256').update(await readFile(input)).digest('hex'),
  sourceFilesUnchanged: true, comparisons,
  baselineTenPlayers: { runs: original.ensemble.cohorts, lossProbability: original.ensemble.casinoLossProbability,
    meanDepositCents: original.example.depositsCents, meanGgrCents: original.ensemble.ggrCents.mean },
  notes: [
    'Fictional cents, no fees or operating costs. These are new independent simulation runs, separate from the original 5000 groups.',
    'Ten original player profiles have equal weights. For pairs, both profiles are independently selected with replacement; all 100 ordered pairs have equal weights.',
    'A negative GGR is a loss after paying all withdrawals and honoring all remaining wallet balances, whether requested for withdrawal or not.',
    'Actual requested cash shortfall considers only withdrawals in the simulated behavior. It excludes balances still owed on accounts.',
    'Casino funding is unlimited in the underlying simulation. No house-capital or bankruptcy constraint prevents a bet or settlement.',
    'Observed maxima and percentiles are sample results, not payout ceilings or guaranteed sufficient reserves.',
    'Single-player peak reserve is the largest gain above the original deposit during the session, including prior withdrawals.',
  ],
};
await writeFile(resolve(dirname(input), 'small-player-groups.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
