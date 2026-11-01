import assert from 'node:assert/strict';
import { HEROES, initialTeam, playNeopolisSpin, NEOPOLIS_MATH, MAX_ROUND_SPINS } from '../../src/shared/neopolisMath.ts';
import { NEOPOLIS_PAYOUT_SCALE, neopolisTeamPayout, neopolisTeamState } from '../../src/shared/neopolisStakePayouts.ts';
import { advanceNeopolis, emptyNeopolisView, NEOPOLIS_MAX_WIN } from '../../src/shared/neopolis.ts';
import { startNeopolis, moveNeopolis } from '../../server/games/neopolis.ts';
import { seededRandom } from '../../src/shared/draconaMath.ts';

const denominator = 40n * BigInt(NEOPOLIS_MATH.payDenominator) * NEOPOLIS_PAYOUT_SCALE;
const drawFor = seed => { const random = seededRandom(seed); return max => Math.floor(random() * max); };
const moment = () => ({ samples: 0, paidRounds: 0, reward: 0, cost: 0, rewardSquared: 0, rewardCost: 0, costSquared: 0 });
function add(sum, reward, cost, paidRounds = 1) {
  sum.samples++; sum.paidRounds += paidRounds; sum.reward += reward; sum.cost += cost;
  sum.rewardSquared += reward * reward; sum.rewardCost += reward * cost; sum.costSquared += cost * cost;
}
function summary(sum, z) {
  const rtp = sum.reward / sum.cost;
  const residual = Math.max(0, sum.rewardSquared - 2 * rtp * sum.rewardCost + rtp * rtp * sum.costSquared);
  const half = z * Math.sqrt(sum.samples * residual / (sum.samples - 1)) / sum.cost;
  return { ...sum, rtp, interval95: [rtp - half, rtp + half] };
}
export function qualificationTeam(hero, state) {
  const team = initialTeam(hero), others = HEROES.map((_, i) => i).filter(i => i !== HEROES.indexOf(hero));
  team.charges[others[0]] = Math.floor(state / 4); team.charges[others[1]] = state % 4;
  return team;
}
/** Sampler skips presentation frames only. Preflight replays actual server start/move. */
export function sampleNeopolisRound(origin, stakes, random) {
  const factor = neopolisTeamPayout(origin), payouts = stakes.map(() => 0);
  let team = origin, battle = null, freeSpins = 0, spins = 0, precisePoints=0;
  do {
    const result = playNeopolisSpin(team, battle, random, false);
    team = result.team; battle = result.battle; spins++; precisePoints+=result.points; if (result.free) freeSpins++;
    assert(spins <= MAX_ROUND_SPINS);
    const scaled = BigInt(result.points) * factor;
    for (let i = 0; i < stakes.length; i++) payouts[i] = Math.min(stakes[i] * NEOPOLIS_MAX_WIN,
      payouts[i] + Number(BigInt(stakes[i]) * scaled / denominator));
    const capped = payouts.map((value, i) => value === stakes[i] * NEOPOLIS_MAX_WIN);
    if (capped.some(Boolean)) {
      assert(capped.every(Boolean), 'Stake-specific cap requires independent paths');
      team = { ...team, complete: true }; break;
    }
  } while (battle?.remaining);
  return { team, payouts, freeSpins, spins, precisionValue:Math.min(NEOPOLIS_MAX_WIN,precisePoints*Number(factor)/Number(denominator)) };
}
function previousFixtures(hero) {
  const fixtures = new Map([[0, undefined]]), draw = drawFor(810911 + HEROES.indexOf(hero));
  for (let attempt = 0; fixtures.size < 16 && attempt < 100000; attempt++) {
    // A genuine settled v3 transcript proves the carried public state is reachable.
    const result = advanceNeopolis(emptyNeopolisView(initialTeam(hero), 3), '10000', draw);
    if (result.ended && !result.view.team.complete) fixtures.set(neopolisTeamState(result.view.team), { stakeUnits: '10000', view: result.view });
  }
  assert.equal(fixtures.size, 16, 'Every public team state must have a reachable fixture');
  return fixtures;
}
function preflight(policy) {
  let checked = 0;
  for (const [heroIndex, hero] of HEROES.entries()) {
    const fixtures = previousFixtures(hero);
    for (let state = 0; state < 16; state++) for (const stake of policy.stakes) {
      const origin = qualificationTeam(hero, state), actual = drawFor(139031 + heroIndex * 1000003 + state * 7919 + stake), raw = drawFor(139031 + heroIndex * 1000003 + state * 7919 + stake);
      for (let n = 0; n < 64; n++) {
        const sampled = sampleNeopolisRound(origin, [stake], () => raw(4294967296) / 4294967296);
        let result = startNeopolis({ neopolis: { hero } }, String(stake), fixtures.get(state), actual);
        while (!result.ended) result = moveNeopolis(result.view, String(stake), result.view.revision, actual);
        assert.equal(result.view.version, 4); assert.deepEqual(result.view.origin, origin);
        assert.equal(result.credit, sampled.payouts[0]); assert.deepEqual(result.view.team, sampled.team); checked++;
      }
    }
  }
  return checked;
}
export function qualifyNeopolisV4(policy, progress = () => {}) {
  assert.equal(policy.method, 'neopolis-variable-stake-conditional-v4');
  assert.deepEqual(policy.choices, [...HEROES]);
  const summarize = sum => summary(sum, policy.confidenceZ);
  const serverReplayChecks = preflight(policy);
  progress({ game: 'studio-neopolis', phase: 'conditional-server-replay', serverReplayChecks });
  const stateResults = [], precisionStateResults=[], conditionalStreams = [], stakes = policy.stakes;
  for (const [heroIndex, hero] of HEROES.entries()) for (let state = 0; state < 16; state++) {
    const origin = qualificationTeam(hero, state), sums = stakes.map(moment), preciseSum=moment();
    const rounds = state === 15 ? policy.conditionalReadyRoundsPerSeed : policy.conditionalRoundsPerSeed;
    let freeSpins = 0;
    for (const seed of policy.conditionalSeeds) {
      const actualSeed = seed + heroIndex * 1000003 + state * 7919, random = seededRandom(actualSeed);
      for (let n = 0; n < rounds; n++) {
        const result = sampleNeopolisRound(origin, stakes, random); freeSpins += result.freeSpins; add(preciseSum,result.precisionValue,1);
        for (let i = 0; i < stakes.length; i++) add(sums[i], result.payouts[i] / stakes[i], 1);
      }
      conditionalStreams.push({ hero, state, seed: actualSeed, paidRounds: rounds });
    }
    precisionStateResults.push({choice:hero,state,charges:origin.charges,...summarize(preciseSum)});
    stateResults.push(...stakes.map((stakeUnits, i) => ({ choice: hero, state, charges: origin.charges, stakeUnits, freeSpins, ...summarize(sums[i]) })));
    progress({ game: 'studio-neopolis', phase: 'public-state', hero, state, samples: sums[0].samples, rtp: summarize(sums[0]).rtp });
  }
  const results = [], stakePolicyResults = [], streams = [];
  for (const [heroIndex, hero] of HEROES.entries()) {
    const sums = stakes.map(moment), policySums = policy.stakePolicies.filter(value => value !== 'fixed').map(name => ({ name, sums: stakes.map(moment) }));
    let cycles = 0, freeSpins = 0;
    for (const seed of policy.seeds) {
      const actualSeed = seed + heroIndex * 1000003, random = seededRandom(actualSeed); let streamRounds = 0;
      for (let cycle = 0; cycle < policy.qualificationCyclesPerSeed; cycle++) {
        let team = initialTeam(hero), paid = 0;
        const rewards = stakes.map(() => 0), weighted = policySums.map(() => ({ reward: stakes.map(() => 0), cost: stakes.map(() => 0) }));
        do {
          const ready = neopolisTeamState(team) === 15;
          const result = sampleNeopolisRound(team, stakes, random);
          team = result.team; freeSpins += result.freeSpins;
          for (let i = 0; i < stakes.length; i++) {
            rewards[i] += result.payouts[i] / stakes[i];
            for (const [j, row] of policySums.entries()) {
              const selected = row.name === 'raise-when-ready' ? ready ? i : 0
                : row.name === 'lower-when-ready' ? ready ? 0 : i
                : row.name === 'alternate-extremes' ? paid % 2 ? i : 0
                : (paid + i) % stakes.length;
              // Currency-normalized weights preserve the actual variable-stake denominator.
              weighted[j].reward[i] += result.payouts[selected] / stakes[0];
              weighted[j].cost[i] += stakes[selected] / stakes[0];
            }
          }
          paid++; streamRounds++; assert(paid < 100000);
        } while (!team.complete);
        for (let i = 0; i < stakes.length; i++) {
          add(sums[i], rewards[i], paid, paid);
          for (let j = 0; j < policySums.length; j++) add(policySums[j].sums[i], weighted[j].reward[i], weighted[j].cost[i], paid);
        }
        cycles++;
        if ((cycle + 1) % 2000 === 0) progress({ game: 'studio-neopolis', phase: 'variable-stake-cycles', hero, seed, cycles, rtp: summarize(sums[3]).rtp });
      }
      streams.push({ choice: hero, seed: actualSeed, paidRounds: streamRounds, cycles: policy.qualificationCyclesPerSeed });
    }
    results.push(...stakes.map((stakeUnits, i) => ({ choice: hero, stakeUnits, cycles, freeSpins, ...summarize(sums[i]) })));
    for (const row of policySums) stakePolicyResults.push(...stakes.map((stakeUnits, i) => ({ choice: hero, stakePolicy: row.name, stakeUnits, cycles, ...summarize(row.sums[i]) })));
  }
  return { method: policy.method, serverReplayChecks, streams, results, conditionalStreams, stateResults, precisionStateResults, stakePolicyResults,
    analysis: 'Independent conditional rounds cover every public team state and every allowed stake. Complete regenerative cycles separately check fixed and adaptive stakes, all bonus continuations, exact integer settlement and the round cap. Different stakes and policies share entropy; their evidence must not be pooled. The interval95 fields use two-sided 97.5% normal intervals for a conservative two-look plan. Intervals are per case, not a simultaneous proof or exact analytical RTP.' };
}
