import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES, PROFILES, seededRandom, simulateCohort, simulateEnsemble,
  exitReason, sampleStats,
} from '../scripts/simulate-casino';
import { DEMO_BETS } from '../src/shared/demoWallet';
import { validExpansionAction, expansionRulesVersion, type ExpansionGameId } from '../src/shared/casinoExpansion';
import { randomUUID } from 'node:crypto';

test('seeded simulation replays identical money, behavior and timelines', () => {
  const first = simulateCohort('test-replay', true);
  assert.deepEqual(simulateCohort('test-replay', true), first);
  assert.notDeepEqual(simulateCohort('test-different', true).players, first.players);
  for (const max of [1, 2, 6, 37, 10000, 2 ** 32]) {
    const random = seededRandom('rng-range:' + max);
    for (let i = 0; i < 2000; i++) {
      const value = random(max);
      assert(Number.isSafeInteger(value) && value >= 0 && value < max);
    }
  }
});

test('every simulated mode settles through the real engine at every supported stake', () => {
  for (const [key, mode] of Object.entries(MODES)) for (const bet of DEMO_BETS) {
    for (let i = 0; i < 4; i++) {
      const result = mode.play(bet * 100, seededRandom('engine:' + key + ':' + bet + ':' + i), true);
      assert(Number.isSafeInteger(result.payoutCents) && result.payoutCents >= 0);
      assert(result.actions >= 1 && result.freeSpins >= 0);
    }
  }
});

test('selected slot versions and settings agree with current server dispatch rather than historical Studio versions', () => {
  assert.equal(MODES.caramel.engine, 'caramel'); assert.equal(MODES.caramel.rulesVersion, 2);
  assert.equal(MODES.cosmic.engine, 'full-slot'); assert.equal(MODES.cosmic.rulesVersion, 2);
  assert.equal(MODES.cosmic.strategy?.mathProfileVersion, 3);
  for (const mode of Object.values(MODES).filter(mode => mode.engine !== 'core')) {
    assert.equal(mode.rulesVersion, expansionRulesVersion(mode.gameId as ExpansionGameId));
    assert(validExpansionAction({ id: randomUUID(), action: 'start', gameId: mode.gameId,
      stakeUnits: '1000', settings: mode.settings }), mode.key + ' current request shape');
  }
});

test('each cohort reconciles deposits, all game payouts, paid withdrawals and retained obligations', () => {
  let partials = 0, retained = 0, switches = 0, freeSpins = 0;
  for (let i = 0; i < 25; i++) {
    const cohort = simulateCohort('reconcile:' + i, true);
    assert.equal(cohort.depositsCents, 550000);
    assert.equal(cohort.players.length, 10);
    assert.equal(cohort.ggrCents, cohort.stakesCents - cohort.payoutsCents);
    assert.equal(cohort.ggrCents, cohort.depositsCents - cohort.withdrawalsCents - cohort.retainedBalanceCents);
    assert.equal(cohort.winners + cohort.losers + cohort.even, 10);
    assert.equal(cohort.rounds, cohort.games.reduce((sum, game) => sum + game.rounds, 0));
    assert.equal(cohort.stakesCents, cohort.games.reduce((sum, game) => sum + game.stakesCents, 0));
    assert.equal(cohort.payoutsCents, cohort.games.reduce((sum, game) => sum + game.payoutsCents, 0));
    for (const player of cohort.players) {
      assert.equal(player.profitCents, player.withdrawnCents + player.balanceCents - player.profile.depositCents);
      assert.equal(player.profitCents, player.payoutsCents - player.stakesCents);
      assert.equal(player.withdrawnCents, player.withdrawals.reduce((sum, row) => sum + row.amountCents, 0));
      assert.equal(player.trace.length, player.rounds);
      assert(player.rounds <= player.profile.maxRounds);
      const last = player.trace.at(-1);
      assert(player.seconds <= player.profile.maxSeconds + (last?.freeSpins ?? 0) * 4 + (last?.actions ?? 0) * 3);
      if (!player.profile.leaveBalance) assert.equal(player.balanceCents, 0);
      for (const row of player.trace) {
        assert(DEMO_BETS.some(bet => bet * 100 === row.stakeCents));
        assert(row.balanceCents >= 0);
        assert.equal(row.wealthCents, row.balanceCents + row.withdrawnCents);
      }
      if (player.partialPaid) {
        const partial = player.withdrawals.find(row => row.reason === 'Частичный вывод, игра продолжается')!;
        assert(partial);
        if (player.rounds > partial.round) partials++;
      }
      retained += player.balanceCents; switches += player.switches; freeSpins += player.freeSpins;
    }
  }
  assert(partials > 0, 'Coverage includes partial withdrawals followed by more rounds');
  assert(retained > 0, 'Coverage includes money owed to players left on their accounts');
  assert(switches > 0 && freeSpins > 0);
});

test('trailing withdrawal arms only after the peak, supports overshoot and never requires a fabricated win', () => {
  const profile = PROFILES.find(row => row.id === 10)!;
  assert.equal(exitReason(profile, 130000, 149999), undefined);
  assert.equal(exitReason(profile, 150000, 150000), undefined);
  assert.equal(exitReason(profile, 130001, 150000), undefined);
  assert.equal(exitReason(profile, 130000, 150000), 'Вывод после отката от достигнутого пика');
  assert.equal(exitReason(profile, 125000, 150000), 'Вывод после отката от достигнутого пика');
  assert.equal(exitReason(profile, 160000, 200000), 'Вывод после отката от достигнутого пика');
  assert.equal(exitReason(profile, 50000, 100000), 'Достигнут лимит проигрыша');
});

test('sampling describes new independent cohorts and correctly separates mean uncertainty from outcome spread', () => {
  const stats = sampleStats([0, 100, 200, 300, 400]);
  assert.equal(stats.mean, 200); assert.equal(stats.median, 200);
  assert.equal(stats.p05, 20); assert.equal(stats.p95, 380);
  assert(stats.meanCi95[0] < stats.mean && stats.meanCi95[1] > stats.mean);
  const result = simulateEnsemble('ensemble-test', 5);
  const explicit = Array.from({ length: 5 }, (_, i) => simulateCohort('ensemble-test:ensemble:' + i));
  assert.deepEqual(result.ggrSamplesCents, explicit.map(row => row.ggrCents));
  assert.equal(result.ggrCents.mean, explicit.reduce((sum, row) => sum + row.ggrCents, 0) / 5);
  assert.equal(result.casinoLossProbability, explicit.filter(row => row.ggrCents < 0).length / 5);
  assert.equal(result.simulatedPlayers, 50);
});
