import assert from 'node:assert/strict';
import { HEROES, NEOPOLIS_MATH, initialTeam, playNeopolisSpin } from '../../src/shared/neopolisMath.ts';
import { playSpin, SIZE, clusterPayout, seededRandom } from '../../src/shared/draconaMath.ts';
import { startNeopolis, moveNeopolis } from '../../server/games/neopolis.ts';
import { startDracona, moveDracona } from '../../server/games/dracona.ts';

export function summary(s) {
  const rtp = s.reward / s.cost;
  const residual = Math.max(0, s.rewardSquared - 2 * rtp * s.rewardCost + rtp * rtp * s.costSquared);
  const se = Math.sqrt(s.samples * residual / (s.samples - 1)) / s.cost;
  return { ...s, rtp, interval95: [rtp - 1.96 * se, rtp + 1.96 * se] };
}
function moment() { return { samples: 0, paidRounds: 0, reward: 0, cost: 0, rewardSquared: 0, rewardCost: 0, costSquared: 0 }; }
function add(s, reward, cost) {
  s.samples++; s.paidRounds += cost; s.reward += reward; s.cost += cost;
  s.rewardSquared += reward * reward; s.rewardCost += reward * cost; s.costSquared += cost * cost;
}
const drawFor = seed => { const random = seededRandom(seed); return max => Math.floor(random() * max); };

// Independent streams compare the fast sampler with actual start/move, including legacy progress handling.
export function preflight(game, policy) {
  let checked = 0;
  for (const choice of policy.choices) for (const stake of policy.stakes) {
    const seed = 4417 + policy.choices.indexOf(choice), actual = drawFor(seed), raw = drawFor(seed);
    let team = initialTeam(choice === 'normal' ? 'granite' : choice), previous;
    for (let round = 0; round < 64; round++) {
      if (game === 'studio-neopolis') {
        if (team.complete) team = initialTeam(choice);
        let battle = null, units = 0n;
        do {
          const result = playNeopolisSpin(team, battle, () => raw(4294967296) / 4294967296);
          team = result.team; battle = result.battle;
          units += BigInt(stake) * BigInt(result.points) / (40n * BigInt(NEOPOLIS_MATH.payDenominator));
        } while (battle && battle.remaining);
        let result = startNeopolis({ neopolis: { hero: choice } }, String(stake), previous, actual);
        while (!result.ended) result = moveNeopolis(result.view, String(stake), result.view.revision, actual);
        assert.equal(result.credit, Number(units)); assert.deepEqual(result.view.team, team);
        previous = { stakeUnits: String(stake), view: result.view };
      } else {
        let remaining = 0, issued = 0, runes = Array(SIZE).fill(1), units = 0;
        do {
          const result = playSpin({ bet: stake / 100, bonus: issued > 0, runes, bonusIssued: issued, random: () => raw(4294967296) / 4294967296 });
          units += Math.round(result.payout * 100); if (issued) remaining--;
          remaining += result.bonusAward; issued += result.bonusAward; runes = result.runes;
        } while (remaining);
        let result = startDracona({ dracona: { mode: 'normal' } }, String(stake), actual);
        while (!result.ended) result = moveDracona(result.view, String(stake), result.view.revision, actual);
        assert.equal(result.credit, units); assert.deepEqual(result.view.history.at(-1).result.runes, runes);
      }
      checked++;
    }
  }
  return checked;
}

export function simulateNeopolis(policy, progress = () => {}) {
  const results = [], streams = [], denominator = 40n * BigInt(NEOPOLIS_MATH.payDenominator);
  for (const [heroIndex, hero] of HEROES.entries()) {
    const moments = policy.stakes.map(moment);
    let paidRounds = 0, freeSpins = 0, cycles = 0, bosses = 0;
    for (const seed of policy.seeds) {
      const random = seededRandom(seed + heroIndex * 1000003);
      let streamRounds = 0;
      for (let cycle = 0; cycle < policy.qualificationCyclesPerSeed; cycle++) {
        let team = initialTeam(hero), cost = 0;
        const reward = policy.stakes.map(() => 0);
        do {
          let battle = null;
          const units = policy.stakes.map(() => 0);
          do {
            const result = playNeopolisSpin(team, battle, random);
            team = result.team; battle = result.battle;
            if (result.free) freeSpins++;
            assert(Number.isSafeInteger(result.points));
            for (let i = 0; i < policy.stakes.length; i++) {
              const stake = policy.stakes[i], raw = Number(BigInt(stake) * BigInt(result.points) / denominator);
              units[i] = Math.min(stake * 3000, units[i] + raw);
            }
            const capped = units.map((n, i) => n === policy.stakes[i] * 3000);
            if (capped.some(Boolean)) {
              assert(capped.every(Boolean), 'Cross-stake cap diverged; independent stake simulation is required');
              team = { ...team, complete: true }; break;
            }
          } while (battle && battle.remaining);
          if (team.complete && battle?.won) bosses++;
          cost++; paidRounds++; streamRounds++;
          for (let i = 0; i < reward.length; i++) reward[i] += units[i] / policy.stakes[i];
          assert(cost < 100000, 'Team cycle did not finish');
        } while (!team.complete);
        for (let i = 0; i < moments.length; i++) add(moments[i], reward[i], cost);
        cycles++;
        if ((cycle + 1) % 1000 === 0) progress({ game: 'studio-neopolis', hero, seed, cycles, paidRounds, rtp: summary(moments[3]).rtp });
      }
      streams.push({ choice: hero, seed: seed + heroIndex * 1000003, paidRounds: streamRounds, cycles: policy.qualificationCyclesPerSeed });
    }
    for (let i = 0; i < moments.length; i++) results.push({ choice: hero, stakeUnits: policy.stakes[i], cycles, freeSpins, bosses, ...summary(moments[i]) });
  }
  return { method: 'regenerative team cycles; ratio-of-rewards interval at the independent cycle level', results, streams };
}

export function simulateDracona(policy, progress = () => {}) {
  const moments = policy.stakes.map(moment), streams = [];
  let freeSpins = 0, bonuses = 0;
  for (const seed of policy.seeds) {
    const random = seededRandom(seed);
    for (let round = 0; round < policy.qualificationRoundsPerSeed; round++) {
      let remaining = 0, issued = 0, runes = Array(SIZE).fill(1);
      const units = policy.stakes.map(() => 0);
      do {
        const result = playSpin({ bet: 100, bonus: issued > 0, runes, bonusIssued: issued, random });
        if (issued) { remaining--; freeSpins++; } else if (result.bonusAward) bonuses++;
        for (const step of result.steps) if (step.type === 'win') for (const cluster of step.clusters) {
          for (let i = 0; i < policy.stakes.length; i++) units[i] += Math.round(clusterPayout(cluster.symbol, cluster.cells.length, policy.stakes[i] / 100, cluster.factor) * 100);
        }
        remaining += result.bonusAward; issued += result.bonusAward; runes = result.runes;
        assert(issued <= 20);
      } while (remaining);
      for (let i = 0; i < moments.length; i++) {
        assert(Number.isSafeInteger(units[i]) && units[i] <= policy.stakes[i] * 100000);
        add(moments[i], units[i] / policy.stakes[i], 1);
      }
      if ((round + 1) % 250000 === 0) progress({ game: 'studio-dracona', seed, paidRounds: moments[0].paidRounds, rtp: summary(moments[3]).rtp });
    }
    streams.push({ choice: 'normal', seed, paidRounds: policy.qualificationRoundsPerSeed });
  }
  return { method: 'independent complete paid rounds, with all rune state and free retriggers', streams,
    results: moments.map((s, i) => ({ choice: 'normal', stakeUnits: policy.stakes[i], cycles: 0, freeSpins, bonuses, ...summary(s) })) };
}
