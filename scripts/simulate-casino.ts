import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { prepareGame, verifyGameRound } from '../server/games/core';
import { startStudioGame, moveStudioGame } from '../server/games/studioGames';
import { startCaramel, moveCaramel } from '../server/games/caramelCarnival';
import { startLuelonSlotGame, moveLuelonSlotGame } from '../server/games/luelonSlots';
import { CARAMEL_GAME, validCaramelSettlement, type CaramelSettings } from '../src/shared/caramelCarnival';
import { isLuelonSlotGame, validLuelonSlotSettlement, type LuelonSlotGameId, type LuelonSlotSettings } from '../src/shared/luelonSlots';
import { COSMIC_MATH_PROFILE_VERSION } from '../src/shared/luelonSlotsModels';
import type { RandomInt } from '../server/games/types';
import type { GameInput } from '../src/shared/gameCore';
import { DEMO_BETS } from '../src/shared/demoWallet';
import {
  STUDIO_INFO, STUDIO_DEFAULTS, validStudioSettlement,
  type StudioGameId, type StudioSettings,
} from '../src/shared/studioGames';
import { renderCasinoReport } from './casino-simulation-report';

// Run with: node --import tsx scripts/simulate-casino.ts --cohorts 1000
// All amounts are integer cents in a fictional offline ledger.
export function seededRandom(seed: string): RandomInt {
  const bytes = createHash('sha256').update(seed).digest();
  let a = bytes.readUInt32LE(0), b = bytes.readUInt32LE(4);
  let c = bytes.readUInt32LE(8), d = bytes.readUInt32LE(12);
  const uint32 = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
    t = (t + d) | 0; c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 20; i++) uint32();
  return max => {
    assert(Number.isSafeInteger(max) && max > 0 && max <= 2 ** 32);
    // Rejection sampling prevents modulo bias, including non-power-of-two reels.
    const limit = Math.floor(2 ** 32 / max) * max;
    let value: number;
    do { value = uint32(); } while (value >= limit);
    return value % max;
  };
}

type RoundResult = { payoutCents: number; freeSpins: number; actions: number };
type Mode = {
  key: string; gameId: string; name: string; settings: unknown;
  engine: string; rulesVersion: 1 | 2; strategy?: Record<string, number>;
  seconds: number; play(stakeCents: number, random: RandomInt, verify: boolean): RoundResult;
};
function instant(key: string, gameId: string, name: string, input: GameInput, seconds: number): Mode {
  const game = prepareGame(gameId, 1, input);
  return { key, gameId, name, settings: input, engine: 'core', rulesVersion: 1, seconds, play(stake, random, verify) {
    const result = game.play(BigInt(stake), random);
    if (verify) assert(verifyGameRound(result), key + ' round verification');
    const payoutCents = Number(result.payoutUnits);
    assert(Number.isSafeInteger(payoutCents) && payoutCents >= 0);
    return { payoutCents, freeSpins: 0, actions: 1 };
  } };
}
function caramel(key: string, seconds: number): Mode {
  const settings: CaramelSettings = { caramel: { mode: 'normal' } };
  return { key, gameId: CARAMEL_GAME, name: STUDIO_INFO[CARAMEL_GAME].name, settings,
    engine: 'caramel', rulesVersion: 2, seconds, play(stake, random, verify) {
      const units = String(stake);
      let result = startCaramel(settings, units, random), actions = 1;
      const check = () => {
        if (verify) assert(validCaramelSettlement(result.ended ? 'settled' : 'active',
          units, units, String(result.credit), result.view), 'Current Caramel settlement');
      };
      check();
      while (!result.ended) { result = moveCaramel(result.view, units, result.view.revision, random); actions++; check(); }
      return { payoutCents: result.credit, freeSpins: result.view.history.filter(spin => spin.kind === 'free').length, actions };
    } };
}
function fullSlot(key: string, gameId: LuelonSlotGameId, seconds: number): Mode {
  const settings: LuelonSlotSettings = { luelon: { mode: 'normal' } };
  return { key, gameId, name: STUDIO_INFO[gameId].name, settings, engine: 'full-slot',
    rulesVersion: 2, strategy: { mathProfileVersion: COSMIC_MATH_PROFILE_VERSION }, seconds, play(stake, random, verify) {
      const units = String(stake);
      let result = startLuelonSlotGame(gameId, settings, units, random, COSMIC_MATH_PROFILE_VERSION), actions = 1;
      const check = () => {
        if (verify) assert(validLuelonSlotSettlement(gameId, result.ended ? 'settled' : 'active',
          units, units, String(result.credit), result.luelon), 'Current full slot settlement');
      };
      check();
      while (!result.ended) {
        const action = result.actions[0];
        assert(action && action.cost === 0);
        result = moveLuelonSlotGame(result.luelon, units, result.luelon.revision,
          action.move, action.move === 'luelon-pick' ? [0] : undefined, random);
        actions++; check();
      }
      return { payoutCents: result.credit, freeSpins: result.luelon.history.filter(spin => spin.kind !== 'base').length, actions };
    } };
}
function studio(key: string, gameId: StudioGameId, seconds: number, stopAfter = 2, settings?: StudioSettings): Mode {
  // Match current DemoExpansionStore dispatch before its generic Studio branch.
  if (gameId === CARAMEL_GAME) return caramel(key, seconds);
  if (isLuelonSlotGame(gameId)) return fullSlot(key, gameId, seconds);
  const input = settings ?? STUDIO_DEFAULTS[gameId];
  return { key, gameId, name: STUDIO_INFO[gameId].name, settings: input, strategy: { stopAfter },
    engine: 'studio', rulesVersion: 1, seconds,
    play(stake, random, verify) {
      const units = String(stake);
      let result = startStudioGame(gameId, input, units, random);
      let freeSpins = 0, actions = 1;
      const check = () => {
        if (verify) assert(validStudioSettlement(gameId, result.ended ? 'settled' : 'active',
          units, units, String(result.credit), result.studio), key + ' settlement verification');
      };
      check();
      while (!result.ended) {
        let move: string, picks: number[] | undefined;
        if (result.studio.kind === 'slot') { move = 'studio-spin'; freeSpins++; }
        else if (result.studio.kind === 'mines') {
          move = result.studio.steps >= stopAfter ? 'cashout' : 'reveal';
          // Decisions use public cells only, never the private mine positions.
          if (move === 'reveal') {
            const available = result.studio.cells.flatMap((cell, i) => cell === 'hidden' ? [i] : []);
            picks = [available[random(available.length)]];
          }
        } else if (result.studio.kind === 'flight' || result.studio.kind === 'crash') {
          move = result.studio.steps >= stopAfter ? 'cashout' : 'studio-advance';
        } else throw new Error('Unexpected active studio game');
        result = moveStudioGame(gameId, result.engine, move, picks, units);
        actions++; check();
      }
      return { payoutCents: result.credit, freeSpins, actions };
    } };
}
export const MODES: Record<string, Mode> = Object.fromEntries([
  instant('fruits', 'royal-fruits', 'Royal Fruits', {}, 5),
  instant('dice50', 'royal-dice', 'Royal Dice', { gameMode: 'rollUnder', sliderValue: 50 }, 4),
  instant('dice25', 'royal-dice', 'Royal Dice', { gameMode: 'rollOver', sliderValue: 75 }, 4),
  instant('limbo2', 'royal-limbo', 'Royal Limbo', { targetMultiplier: 2 }, 5),
  instant('limbo5', 'royal-limbo', 'Royal Limbo', { targetMultiplier: 5 }, 5),
  instant('plinkoLow', 'royal-plinko', 'Royal Plinko', { rows: 12, risk: 'easy' }, 6),
  instant('plinkoHigh', 'royal-plinko', 'Royal Plinko', { rows: 12, risk: 'hard' }, 6),
  instant('keno', 'royal-keno', 'Royal Keno', { picks: [3, 9, 17], risk: 'classic' }, 8),
  studio('neon', 'studio-neon-crown', 5),
  studio('cosmic', 'studio-cosmic-escape', 5),
  studio('caramel', 'studio-caramel-carnival', 5),
  studio('ember', 'studio-ember-vault', 5),
  studio('orbit2', 'studio-orbit', 7, 2),
  studio('orbit4', 'studio-orbit', 7, 4),
  studio('mines2', 'studio-fossil-trail', 7, 2),
  studio('mines4', 'studio-fossil-trail', 7, 4),
  studio('fox', 'studio-signal-fox', 4, 2, { studio: { chance: 75, direction: 'under' } }),
  studio('wheel', 'studio-saffron-spin', 8, 2, { studio: { target: 0 } }),
].map(mode => [mode.key, mode]));

export type Profile = {
  id: number; depositCents: number; label: string; baseStakeCents: number;
  maxRounds: number; maxSeconds: number; stopLossRatio: number;
  takeProfitRatio?: number; trail?: { armRatio: number; floorRatio: number; retainGainRatio: number };
  partial?: { atRatio: number; depositFraction: number };
  raiseAfterLoss?: boolean; leaveBalance?: boolean; modes: string[];
};
const makeProfile = (id: number, label: string, baseStake: number, maxRounds: number,
  stopLossRatio: number, modes: string[], extra: Partial<Profile> = {}): Profile => ({
  id, label, depositCents: id * 10000, baseStakeCents: baseStake * 100,
  maxRounds, maxSeconds: 60 * 60, stopLossRatio, modes, ...extra,
});
export const PROFILES: Profile[] = [
  makeProfile(1, 'Осторожный: плюс 25% или потеря 40%', 10, 100, .6, ['dice50', 'fox', 'plinkoLow'], { takeProfitRatio: 1.25 }),
  makeProfile(2, 'Короткая сессия: плюс 35% или потеря половины', 10, 160, .5, ['neon', 'dice50', 'wheel'], { takeProfitRatio: 1.35, maxSeconds: 30 * 60 }),
  makeProfile(3, 'Любитель слотов: до удвоения или потери 80%', 10, 300, .2, ['fruits', 'cosmic', 'caramel'], { takeProfitRatio: 2 }),
  makeProfile(4, 'Возвращает депозит при росте баланса в 1,5 раза', 10, 320, .35, ['ember', 'plinkoLow', 'mines2'], { partial: { atRatio: 1.5, depositFraction: 1 }, takeProfitRatio: 2 }),
  makeProfile(5, 'Высокий риск: до 2,5 депозитов или минимального остатка', 50, 250, 0, ['limbo5', 'plinkoHigh', 'orbit4'], { takeProfitRatio: 2.5 }),
  makeProfile(6, 'Фиксирует плюс 20% или потерю 30%', 10, 240, .7, ['fox', 'dice50', 'neon'], { takeProfitRatio: 1.2 }),
  makeProfile(7, 'Частичный вывод и продолжение на оставшиеся деньги', 50, 300, .25, ['keno', 'ember', 'mines2'], { partial: { atRatio: 1.35, depositFraction: .5 }, takeProfitRatio: 2.2 }),
  makeProfile(8, 'После трёх проигрышей повышает ставку на одну ступень', 50, 220, .2, ['dice25', 'limbo2', 'orbit2'], { takeProfitRatio: 1.8, raiseAfterLoss: true }),
  makeProfile(9, 'Играет до лимита, остаток оставляет на счёте', 50, 360, .4, ['caramel', 'cosmic', 'plinkoLow'], { takeProfitRatio: 1.7, leaveBalance: true }),
  makeProfile(10, 'После роста до 150% выводит при откате к 130%', 50, 480, .5, ['dice50', 'orbit2', 'mines4', 'neon'], {
    trail: { armRatio: 1.5, floorRatio: 1.3, retainGainRatio: .6 }, maxSeconds: 90 * 60,
  }),
];

export type Withdrawal = { round: number; second: number; amountCents: number; reason: string; status: 'paid' };
export type GameStats = {
  gameId: string; name: string; rounds: number; stakesCents: number; payoutsCents: number;
  freeSpins: number; netWinningRounds: number; positivePayoutRounds: number;
};
export type Trace = {
  round: number; second: number; mode: string; stakeCents: number; payoutCents: number;
  balanceCents: number; wealthCents: number; withdrawnCents: number; freeSpins: number; actions: number;
};
export type PlayerResult = {
  profile: Profile; rounds: number; seconds: number; stakesCents: number; payoutsCents: number;
  balanceCents: number; withdrawnCents: number; profitCents: number;
  peakWealthCents: number; peakRound: number; maxStakeCents: number; freeSpins: number;
  stopReason: string; trailingArmed: boolean; partialPaid: boolean; switches: number;
  games: GameStats[]; withdrawals: Withdrawal[]; trace: Trace[];
};
export function exitReason(profile: Profile, wealth: number, peak: number): string | undefined {
  if (profile.trail && peak >= Math.ceil(profile.depositCents * profile.trail.armRatio)) {
    const floor = Math.max(Math.ceil(profile.depositCents * profile.trail.floorRatio),
      profile.depositCents + Math.ceil((peak - profile.depositCents) * profile.trail.retainGainRatio));
    if (wealth <= floor) return 'Вывод после отката от достигнутого пика';
  }
  if (profile.takeProfitRatio && wealth >= Math.ceil(profile.depositCents * profile.takeProfitRatio)) return 'Достигнута цель выигрыша';
  if (wealth <= Math.floor(profile.depositCents * profile.stopLossRatio)) return 'Достигнут лимит проигрыша';
  return undefined;
}
const stakeOptions = DEMO_BETS.map(bet => bet * 100);
export function simulatePlayer(profile: Profile, seed: string, detailed = false): PlayerResult {
  const gameRandom = seededRandom(seed + ':outcomes');
  const behaviorRandom = seededRandom(seed + ':behavior');
  let balance = profile.depositCents, withdrawn = 0, rounds = 0, seconds = 0;
  let stakes = 0, payouts = 0, peak = balance, peakRound = 0, freeSpins = 0, maxStake = 0;
  let losses = 0, partialPaid = false, switches = 0, currentMode = -1, remainingBlock = 0;
  let stopReason = 'Достигнут лимит раундов';
  const withdrawals: Withdrawal[] = [], trace: Trace[] = [];
  const games = new Map<string, GameStats>();
  const withdraw = (amount: number, reason: string) => {
    assert(Number.isSafeInteger(amount) && amount > 0 && amount <= balance);
    balance -= amount; withdrawn += amount;
    withdrawals.push({ round: rounds, second: seconds, amountCents: amount, reason, status: 'paid' });
  };
  while (rounds < profile.maxRounds) {
    if (seconds >= profile.maxSeconds) { stopReason = 'Достигнут лимит условного времени'; break; }
    const affordable = stakeOptions.filter(stake => stake <= balance);
    if (!affordable.length) { stopReason = balance === 0 ? 'Баланс проигран полностью' : 'Остаток меньше минимальной ставки'; break; }
    const desired = profile.raiseAfterLoss && losses >= 3 ? profile.baseStakeCents * 2 : profile.baseStakeCents;
    const withinPlan = affordable.filter(stake => stake <= desired);
    const stake = withinPlan.length ? withinPlan[withinPlan.length - 1] : affordable[0];
    if (remainingBlock === 0) {
      const previous = currentMode;
      // Cycle through the playlist. Block lengths and pacing vary independently of outcomes.
      currentMode = (currentMode + 1) % profile.modes.length;
      if (previous >= 0 && currentMode !== previous) {
        const pause = 15 + behaviorRandom(31);
        if (seconds + pause >= profile.maxSeconds) {
          seconds = profile.maxSeconds; stopReason = 'Достигнут лимит условного времени'; break;
        }
        switches++; seconds += pause;
      }
      remainingBlock = 5 + behaviorRandom(11);
    }
    const mode = MODES[profile.modes[currentMode]];
    assert(mode, 'Unknown simulation mode');
    if (seconds + mode.seconds + 4 > profile.maxSeconds) { stopReason = 'Достигнут лимит условного времени'; break; }
    balance -= stake;
    const result = mode.play(stake, gameRandom, detailed);
    balance += result.payoutCents;
    rounds++; remainingBlock--; stakes += stake; payouts += result.payoutCents;
    freeSpins += result.freeSpins; maxStake = Math.max(maxStake, stake);
    seconds += mode.seconds + behaviorRandom(5) + result.freeSpins * 4 + Math.max(0, result.actions - result.freeSpins - 1) * 3;
    losses = result.payoutCents < stake ? losses + 1 : 0;
    const wealth = balance + withdrawn;
    if (wealth > peak) { peak = wealth; peakRound = rounds; }
    const stats = games.get(mode.gameId) ?? { gameId: mode.gameId, name: mode.name, rounds: 0,
      stakesCents: 0, payoutsCents: 0, freeSpins: 0, netWinningRounds: 0, positivePayoutRounds: 0 };
    stats.rounds++; stats.stakesCents += stake; stats.payoutsCents += result.payoutCents;
    stats.freeSpins += result.freeSpins;
    stats.netWinningRounds += Number(result.payoutCents > stake);
    stats.positivePayoutRounds += Number(result.payoutCents > 0);
    games.set(mode.gameId, stats);
    if (profile.partial && !partialPaid && wealth >= Math.ceil(profile.depositCents * profile.partial.atRatio)) {
      withdraw(Math.min(balance, Math.floor(profile.depositCents * profile.partial.depositFraction)), 'Частичный вывод, игра продолжается');
      partialPaid = true;
    }
    if (detailed) trace.push({ round: rounds, second: seconds, mode: mode.key, stakeCents: stake,
      payoutCents: result.payoutCents, balanceCents: balance, wealthCents: balance + withdrawn,
      withdrawnCents: withdrawn, freeSpins: result.freeSpins, actions: result.actions });
    if (balance === 0) {
      stopReason = withdrawn ? 'Оставшийся игровой баланс проигран' : 'Баланс проигран полностью'; break;
    }
    const exit = exitReason(profile, balance + withdrawn, peak);
    if (exit) { stopReason = exit; break; }
  }
  if (!profile.leaveBalance && balance > 0) withdraw(balance, stopReason);
  const profitCents = balance + withdrawn - profile.depositCents;
  assert.equal(profitCents, payouts - stakes, 'Player ledger must conserve all money');
  assert.equal(withdrawals.reduce((sum, row) => sum + row.amountCents, 0), withdrawn);
  assert(balance >= 0 && Number.isSafeInteger(balance));
  return { profile, rounds, seconds, stakesCents: stakes, payoutsCents: payouts,
    balanceCents: balance, withdrawnCents: withdrawn, profitCents, peakWealthCents: peak,
    peakRound, maxStakeCents: maxStake, freeSpins, stopReason,
    trailingArmed: !!profile.trail && peak >= profile.depositCents * profile.trail.armRatio,
    partialPaid, switches, games: [...games.values()], withdrawals, trace };
}
export type Cohort = {
  seed: string; players: PlayerResult[]; depositsCents: number; withdrawalsCents: number;
  retainedBalanceCents: number; ggrCents: number; cashInMinusOutCents: number;
  stakesCents: number; payoutsCents: number; observedRtp: number; rounds: number; freeSpins: number;
  winners: number; losers: number; even: number; withdrawalCount: number; withdrawingPlayers: number;
  aggregateSeconds: number; parallelElapsedSeconds: number; exhaustedPlayers: number; games: GameStats[];
};
export function simulateCohort(seed: string, detailed = false): Cohort {
  const players = PROFILES.map(profile => simulatePlayer(profile, seed + ':player:' + profile.id, detailed));
  const sum = (read: (player: PlayerResult) => number) => players.reduce((total, player) => total + read(player), 0);
  const depositsCents = sum(player => player.profile.depositCents);
  const withdrawalsCents = sum(player => player.withdrawnCents), retainedBalanceCents = sum(player => player.balanceCents);
  const stakesCents = sum(player => player.stakesCents), payoutsCents = sum(player => player.payoutsCents);
  const ggrCents = stakesCents - payoutsCents;
  assert.equal(ggrCents, depositsCents - withdrawalsCents - retainedBalanceCents, 'Casino reconciliation');
  assert.equal(ggrCents, -sum(player => player.profitCents));
  const games = new Map<string, GameStats>();
  for (const player of players) for (const row of player.games) {
    const total = games.get(row.gameId) ?? { ...row, rounds: 0, stakesCents: 0, payoutsCents: 0,
      freeSpins: 0, netWinningRounds: 0, positivePayoutRounds: 0 };
    for (const key of ['rounds', 'stakesCents', 'payoutsCents', 'freeSpins', 'netWinningRounds', 'positivePayoutRounds'] as const) total[key] += row[key];
    games.set(row.gameId, total);
  }
  return { seed, players, depositsCents, withdrawalsCents, retainedBalanceCents, ggrCents,
    cashInMinusOutCents: depositsCents - withdrawalsCents, stakesCents, payoutsCents,
    observedRtp: stakesCents ? payoutsCents / stakesCents : 0,
    rounds: sum(player => player.rounds), freeSpins: sum(player => player.freeSpins),
    winners: players.filter(player => player.profitCents > 0).length,
    losers: players.filter(player => player.profitCents < 0).length,
    even: players.filter(player => player.profitCents === 0).length,
    withdrawalCount: sum(player => player.withdrawals.length),
    withdrawingPlayers: players.filter(player => player.withdrawals.length > 0).length,
    aggregateSeconds: sum(player => player.seconds), parallelElapsedSeconds: Math.max(...players.map(player => player.seconds)),
    exhaustedPlayers: players.filter(player => player.profitCents === -player.profile.depositCents).length,
    games: [...games.values()] };
}
export function quantile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p, lower = Math.floor(at);
  return sorted[lower] + (sorted[Math.ceil(at)] - sorted[lower]) * (at - lower);
}
export function sampleStats(values: number[]) {
  assert(values.length >= 2);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stddev = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  const error = 1.96 * stddev / Math.sqrt(values.length);
  return { mean, stddev, meanCi95: [mean - error, mean + error], min: sorted[0],
    p05: quantile(sorted, .05), median: quantile(sorted, .5), p95: quantile(sorted, .95), max: sorted.at(-1)! };
}
export type Ensemble = ReturnType<typeof simulateEnsemble>;
export function simulateEnsemble(seed: string, cohorts: number, progress?: (done: number) => void) {
  assert(Number.isSafeInteger(cohorts) && cohorts >= 2);
  const ggr: number[] = [], rounds: number[] = [], withdrawals: number[] = [], elapsed: number[] = [];
  let winners = 0, losers = 0, even = 0, withdrawalCount = 0, totalStakes = 0, totalPayouts = 0;
  let losingCohorts = 0, profitableCohorts = 0, partialCashouts = 0, trailingCashouts = 0;
  const playerTotals = PROFILES.map(profile => ({ id: profile.id, profit: 0, rounds: 0, winners: 0, withdrawals: 0 }));
  const gameTotals = new Map<string, GameStats>();
  for (let i = 0; i < cohorts; i++) {
    // The detailed example is independent from the ensemble and is never selected for its result.
    const cohort = simulateCohort(seed + ':ensemble:' + i);
    ggr.push(cohort.ggrCents); rounds.push(cohort.rounds); withdrawals.push(cohort.withdrawalsCents);
    elapsed.push(cohort.parallelElapsedSeconds); winners += cohort.winners; losers += cohort.losers; even += cohort.even;
    withdrawalCount += cohort.withdrawalCount; totalStakes += cohort.stakesCents; totalPayouts += cohort.payoutsCents;
    losingCohorts += Number(cohort.ggrCents < 0); profitableCohorts += Number(cohort.ggrCents > 0);
    cohort.players.forEach((player, index) => {
      const row = playerTotals[index]; row.profit += player.profitCents; row.rounds += player.rounds;
      row.winners += Number(player.profitCents > 0); row.withdrawals += player.withdrawals.length;
      partialCashouts += Number(player.partialPaid);
      trailingCashouts += Number(player.stopReason === 'Вывод после отката от достигнутого пика');
    });
    for (const row of cohort.games) {
      const total = gameTotals.get(row.gameId) ?? { ...row, rounds: 0, stakesCents: 0, payoutsCents: 0,
        freeSpins: 0, netWinningRounds: 0, positivePayoutRounds: 0 };
      for (const key of ['rounds', 'stakesCents', 'payoutsCents', 'freeSpins', 'netWinningRounds', 'positivePayoutRounds'] as const) total[key] += row[key];
      gameTotals.set(row.gameId, total);
    }
    if ((i + 1) % 100 === 0) progress?.(i + 1);
  }
  return { cohorts, simulatedPlayers: cohorts * PROFILES.length, ggrCents: sampleStats(ggr),
    rounds: sampleStats(rounds), withdrawalsCents: sampleStats(withdrawals), parallelElapsedSeconds: sampleStats(elapsed),
    casinoLossProbability: losingCohorts / cohorts, casinoProfitProbability: profitableCohorts / cohorts,
    averageWinners: winners / cohorts, averageLosers: losers / cohorts, averageEven: even / cohorts,
    averageWithdrawalCount: withdrawalCount / cohorts, weightedRtp: totalPayouts / totalStakes,
    totalStakesCents: totalStakes, totalPayoutsCents: totalPayouts,
    partialCashouts, trailingCashouts, games: [...gameTotals.values()],
    players: playerTotals.map(row => ({ id: row.id, meanProfitCents: row.profit / cohorts,
      meanRounds: row.rounds / cohorts, winProbability: row.winners / cohorts, meanWithdrawalCount: row.withdrawals / cohorts })),
    ggrSamplesCents: ggr };
}

export type SimulationReport = {
  version: 1; createdAt: string; seed: string; wallSeconds: number;
  assumptions: string[]; modes: Omit<Mode, 'play'>[]; example: Cohort; ensemble: Ensemble;
  sources: { path: string; sha256: string }[];
};
const root = fileURLToPath(new URL('../', import.meta.url));
async function sourceManifest() {
  const result = await build({ absWorkingDir: root, entryPoints: ['scripts/simulate-casino.ts'],
    bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, metafile: true, logLevel: 'silent' });
  return Promise.all([...new Set([...Object.keys(result.metafile!.inputs), 'server/demoExpansion.ts'])].sort().map(async path => ({
    path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'),
  })));
}
async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  if (args.includes('--help')) {
    console.log('node --import tsx scripts/simulate-casino.ts [--seed 20261022] [--cohorts 1000] [--output artifacts/work/casino-simulation-20261022]');
    return;
  }
  for (let i = 0; i < args.length; i += 2) {
    assert(['--seed', '--cohorts', '--output'].includes(args[i]) && args[i + 1], 'Invalid command line option');
    options[args[i]] = args[i + 1];
  }
  const seed = options['--seed'] ?? '20261022', cohorts = Number(options['--cohorts'] ?? 1000);
  assert(Number.isSafeInteger(cohorts) && cohorts >= 2 && cohorts <= 100000);
  const output = resolve(root, options['--output'] ?? 'artifacts/work/casino-simulation-20261022');
  assert(relative(resolve(root, 'artifacts/work'), output).split('/')[0] !== '..', 'Output must be task-owned under artifacts/work');
  await mkdir(output, { recursive: true });
  try { await readFile(resolve(output, 'metadata.json')); } catch {
    await writeFile(resolve(output, 'metadata.json'), JSON.stringify({ owner: 'casino simulation CLI',
      purpose: 'Offline fictional player simulation', cleanupCondition: 'Keep final report and results; delete obsolete intermediate runs.' }, null, 2) + '\n');
  }
  const sources = await sourceManifest(), started = performance.now();
  const example = simulateCohort(seed + ':example', true);
  console.log(JSON.stringify({ stage: 'example', ggrDollars: example.ggrCents / 100, rounds: example.rounds }));
  const ensemble = simulateEnsemble(seed, cohorts, done => console.log(JSON.stringify({ stage: 'ensemble', done, cohorts })));
  assert.deepEqual(await sourceManifest(), sources, 'Source files changed during the run; rerun before interpreting results');
  const report: SimulationReport = { version: 1, createdAt: new Date().toISOString(), seed,
    wallSeconds: (performance.now() - started) / 1000, sources, modes: Object.values(MODES).map(({ play, ...mode }) => mode),
    assumptions: [
      '10 fictional players deposit $100, $200, ... $1000 once, for $5500 total. One demo coin is treated as $1 solely for this model.',
      'Existing local server engines and their integer-cent payouts are used directly. No game math is altered. This is an offline model, not an API, database, payment or production integration test.',
      'The displayed example is the first run for its fixed seed. No seed or outcome is selected to obtain a desired winner, loser or casino profit.',
      'SFC32 uses independent SHA-256-derived outcome and behavior streams for each player and cohort. Bounded integers use rejection sampling. It is a simulation PRNG, not the production cryptographic RNG.',
      'The experiment uses the common supported stake subset $10, $50, $100 and $500. Current Cosmic and Caramel also support other stakes, unused here. Players step down to an affordable supported stake. A balance below $10 is not automatically a zero balance.',
      'All withdrawal requests are assumed accepted and immediately paid in full with zero fees. Partial withdrawals do not count as player losses and do not reset the lifetime wealth peak.',
      'Wealth and win/loss classifications equal paid withdrawals plus remaining balance, compared with the original deposit. Game payouts include the returned stake.',
      'GGR equals stakes minus game payouts and also equals deposits minus withdrawals minus remaining player balances. It is before fees, bonuses, taxes and operating costs.',
      'Players start simultaneously. Modeled elapsed time is the longest player session; aggregate time is the sum of player sessions. Pacing, thinking and game switching times are assumptions, not measured human behavior or withdrawal settlement times.',
      'One paid round includes completion of all free bonus frames and any in-game cashout. In-game cashout is not a wallet withdrawal. Bonus spins are reported separately.',
      'Current server dispatch is followed: Caramel rules v2 and Cosmic full-slot rules v2 with math profile 3; generic Studio v1 only where it remains the current route. A paid round and its bonus finish even if they cross the modeled time limit.',
      'The $1000 trailing player arms at wealth $1500, then exits at or below max($1300, $1000 + 60% of the peak gain). A discrete result may cross the threshold. The path is not forced.',
      'Strategies and their equal weights are hypothetical. Ensemble percentiles describe these same ten profiles under new random outcomes, not a forecast of real customer mix or a guarantee of profit.',
      'The example and ensemble cover selected local games. External providers, unselected games and optimal/adversarial strategies are outside this run.',
    ], example, ensemble };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(output, 'report.html'), renderCasinoReport(report));
  await writeFile(resolve(output, 'source-manifest.json'), JSON.stringify(sources, null, 2) + '\n');
  console.log(JSON.stringify({ stage: 'complete', output, wallSeconds: report.wallSeconds,
    example: { ggrDollars: example.ggrCents / 100, withdrawalsDollars: example.withdrawalsCents / 100,
      remainingDollars: example.retainedBalanceCents / 100, winners: example.winners, losers: example.losers,
      rounds: example.rounds, seconds: example.parallelElapsedSeconds },
    ensemble: { meanGgrDollars: ensemble.ggrCents.mean / 100, casinoLossProbability: ensemble.casinoLossProbability } }, null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
