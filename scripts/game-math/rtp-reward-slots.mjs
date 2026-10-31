import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const REWARD_SLOTS_METHOD = 'exact-paid-and-reward-slots-v1';
export const REWARD_SLOT_GAMES = ['royal-coins', 'royal-fruits'];
const paidStakes = [1000, 5000, 10000, 50000];
const rewardStakes = [10, 20, 50, 100, 200, 300, 500, 1000, 2000, 5000];
const digest = () => createHash('sha256');

// This reference does not import production symbol weights, tables, scoring or settlement helpers.
function spec(gameId) {
  assert(REWARD_SLOT_GAMES.includes(gameId));
  return gameId === 'royal-coins'
    ? { radix: 5, outcomes: 125, returnedMultipliers: 120, target: 24 / 25, numerator: 24, denominator: 25 }
    : { radix: 20, outcomes: 8000, returnedMultipliers: 7760, target: 97 / 100, numerator: 97, denominator: 100 };
}
function reference(gameId, stops) {
  const symbols = gameId === 'royal-coins' ? stops : stops.map(n => n < 8 ? 0 : n < 14 ? 1 : n < 18 ? 2 : 3);
  const multiplier = gameId === 'royal-coins'
    ? new Set(symbols).size === 1 ? 12 : new Set(symbols).size === 2 ? 1 : 0
    : symbols[0] === symbols[1] && symbols[1] === symbols[2] ? [5, 10, 30, 140][symbols[0]] : 0;
  return { symbols, multiplier };
}
function* stopTriples(radix) {
  for (let a = 0; a < radix; a++) for (let b = 0; b < radix; b++) for (let c = 0; c < radix; c++) yield [a, b, c];
}
const record = (hash, stops, symbols, multiplier, payout) => hash.update(JSON.stringify([stops, symbols, multiplier, String(payout)]) + '\n');
function stream(gameId, row, seed, rounds, visit) {
  const s = spec(gameId), hash = digest();
  let state = (seed + (row.choice === 'paid' ? 1000003 : 2000006) + row.stakeUnits) >>> 0;
  const draw = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % s.radix; };
  for (let i = 0; i < rounds; i++) {
    const stops = [draw(), draw(), draw()], { symbols, multiplier } = reference(gameId, stops);
    const payout = BigInt(row.stakeUnits) * BigInt(multiplier);
    visit?.(stops, symbols, multiplier, payout);
    record(hash, stops, symbols, multiplier, payout);
  }
  return { seed, rounds, sha256: hash.digest('hex') };
}

/** Independent v3 spin budget with the highest-return eligible choice. Skin provider costs are separate from the retail value of a generation. */
export function promotionProgramEvidence(policy) {
  assert.equal(policy.promotionProgramVersion, 'location-levels-v3');
  assert.equal(policy.maxPromotionCostBasisPoints, 400, 'The configured cumulative spin budget is 4%');
  const milestones = [], levels = [];
  let spins = 0, nominal = 0n, expectedHundredths = 0n;
  for (let level = 1; level <= 100; level++) {
    const i = BigInt(level - 1), threshold = (100000000n * i * i * i + 970298n) / 970299n;
    let reward;
    if (level % 5 === 0) {
      const count = level === 100 ? 40 : level >= 75 ? 20 : level >= 50 ? 12 : level >= 25 ? 8 : 5;
      const stakeUnits = level === 100 ? '50000000' : level >= 75 ? '20000000' : level >= 50 ? '10000000' : level >= 25 ? '5000000'
        : level === 20 ? '3000000' : level === 15 ? '2000000' : level === 10 ? '1000000' : '500000';
      const poolId = 'royal-slots-v1';
      reward = { kind: 'bundle', rewards: [{ kind: 'free_spins', poolId, count, stakeUnits },
        { kind: 'skin_generation', count: 1, theme: 'south-park', variantCount: 2 }] };
      spins += count; nominal += BigInt(count) * BigInt(stakeUnits);
      expectedHundredths += BigInt(count) * BigInt(stakeUnits) * 97n;
      const turnover = threshold * 10000n;
      assert(expectedHundredths * 10000n <= turnover * BigInt(policy.maxPromotionCostBasisPoints) * 100n,
        'Promotion prefix exceeds budget at level ' + level);
      assert.equal(expectedHundredths % 100n, 0n);
      milestones.push({ level, thresholdXp: String(threshold), qualifiedTurnoverUnits: String(turnover), reward,
        cumulativeSpins: spins, cumulativeNominalUnits: String(nominal), expectedFullRedemptionPayoutUnits: String(expectedHundredths / 100n),
        expectedPayoutFraction: { numerator: String(expectedHundredths), denominator: 100 },
        costBasisPointsFraction: { numerator: String(expectedHundredths * 100n), denominator: String(turnover) } });
    }
    levels.push({ level, xp: String(threshold), ...(reward ? { reward } : {}) });
  }
  assert.equal(spins, 260); assert.equal(nominal, 4832500000n);
  return { version: 'location-levels-v3', maxPromotionCostBasisPoints: 400,
    scope: 'Maximum expected full redemption payout over every eligible game choice, for spins only from level 1, divided by qualified turnover. Skin generation provider costs are excluded and must be measured separately. This budget is not casino profit or combined RTP.',
    definition: { version: 'location-levels-v3', coefficients: { 'paid-game': { numerator: 1, denominator: 1 }, pvp: { numerator: 1, denominator: 1 } }, levels },
    skinGenerations:20,skinGenerationRetailValueUnits:'200000000',skinGenerationProviderCostUnits:null,
    milestones, totalSpins: spins, totalNominalUnits: String(nominal), expectedFullRedemptionPayoutUnits: String(expectedHundredths / 100n) };
}
export function validatePromotionDefinition(policy, definition) {
  assert.deepEqual(definition, promotionProgramEvidence(policy).definition,
    'The default level, source or reward program differs from its independent v3 model');
}

function policyChecks(gameId, policy) {
  const s = spec(gameId);
  assert.equal(policy.method, REWARD_SLOTS_METHOD); assert.equal(policy.rulesVersion, 1); assert.equal(policy.progressVersion, 1);
  assert.equal(policy.target, s.target); assert.equal(policy.tolerance, 1e-12);
  assert.deepEqual(policy.paidStakes, paidStakes); assert.deepEqual(policy.rewardStakes, rewardStakes);
  assert.deepEqual(policy.stakes, [...rewardStakes, ...paidStakes]); assert.deepEqual(policy.choices, ['paid', 'reward']);
  assert.equal(policy.rewardPlayerCostUnits, '0'); assert.equal(policy.rewardReturnBasis, 'nominal-not-player-cost');
  assert.equal(policy.serverReplayRoundsPerSeed, 64);
  assert.equal(policy.seeds.length, 2); assert.equal(new Set(policy.seeds).size, 2);
  assert(policy.seeds.every(seed => Number.isSafeInteger(seed) && seed > 0));
  return s;
}
export function rewardSlotEvidence(gameId, policy) {
  const s = policyChecks(gameId, policy), results = [];
  for (const choice of policy.choices) for (const stakeUnits of choice === 'paid' ? policy.paidStakes : policy.rewardStakes) {
    const hash = digest(), stake = BigInt(stakeUnits);
    let returned = 0n, wins = 0;
    for (const stops of stopTriples(s.radix)) {
      const { symbols, multiplier } = reference(gameId, stops), payout = stake * BigInt(multiplier);
      if (multiplier) wins++; returned += payout; record(hash, stops, symbols, multiplier, payout);
    }
    assert.equal(returned, BigInt(s.returnedMultipliers) * stake);
    results.push({ choice, stakeUnits, outcomes: s.outcomes, wins,
      totalNominalUnits: String(BigInt(s.outcomes) * stake),
      totalPlayerCostUnits: choice === 'paid' ? String(BigInt(s.outcomes) * stake) : '0',
      totalReturnedUnits: String(returned), nominalReturn: s.target,
      nominalReturnFraction: { numerator: s.numerator, denominator: s.denominator },
      rtp: choice === 'paid' ? s.target : null,
      rtpBounds: choice === 'paid' ? [s.target, s.target] : null,
      expectedPromotionalPayoutUnits: choice === 'reward' ? { numerator: String(stake * BigInt(s.numerator)), denominator: s.denominator } : null,
      sha256: hash.digest('hex') });
  }
  const boundary = [1n, 9007199254740993123456789n].map(stake => {
    const hash = digest();
    for (const stops of stopTriples(s.radix)) {
      const { symbols, multiplier } = reference(gameId, stops);
      record(hash, stops, symbols, multiplier, stake * BigInt(multiplier));
    }
    return { stakeUnits: String(stake), outcomes: s.outcomes, sha256: hash.digest('hex') };
  });
  return { method: REWARD_SLOTS_METHOD, analysis: {
    model: gameId === 'royal-coins' ? 'Three independent uniform symbols from five; triples pay 12 and exactly one pair pays 1.'
      : 'Three independent uniform stops from twenty; symbol weights 8,6,4,2 and matching triples pay 5,10,30,140.',
    outcomes: s.outcomes, equalProbability: '1/' + s.outcomes,
    fullRound: 'One draw with three stops and one integer settlement. These rules have no bonus continuations or paid choices.',
    exactReturnNumerator: s.numerator, exactReturnDenominator: s.denominator,
    arbitraryIntegerStake: 'Every multiplier is a nonnegative integer independent of stake. For every positive integer s, each payout is s times that multiplier, without rounding loss.',
    promotionalFunding: 'A reward spin charges the player zero. Its expected payout is measured against the fixed nominal, not against zero player cost. Promotional RTP is undefined.',
    confidence: 'Exhaustive exact results, not a sampled RTP estimate or a sampling confidence interval.',
    runtimeScope: 'Every model outcome is compared with the unchanged server engine. Common-wallet ownership, concurrency, rollback and payout tests are separate release checks.',
  }, results, integerBoundaries: boundary, program: promotionProgramEvidence(policy) };
}
export async function qualifyRewardSlots(gameId, policy) {
  const evidence = rewardSlotEvidence(gameId, policy), s = spec(gameId);
  const { prepareGame, verifyGameRound } = await import('../../server/games/core.ts');
  const { DEMO_BETS } = await import('../../src/shared/demoWallet.ts');
  const { DEFAULT_PROGRESSION_POLICY, rewardLeaves, rewardGames, REWARD_SPIN_POOLS } = await import('../../src/shared/progression.ts');
  validatePromotionDefinition(policy, DEFAULT_PROGRESSION_POLICY);
  assert.deepEqual(REWARD_SPIN_POOLS, {'royal-slots-v1':[{gameId:'royal-coins',rulesVersion:1},{gameId:'royal-fruits',rulesVersion:1}]}, 'Every eligible pool choice needs independent qualification');
  assert.deepEqual(DEMO_BETS.map(amount => amount * 100), policy.paidStakes, 'Every allowed paid wallet stake must be qualified');
  for (const level of DEFAULT_PROGRESSION_POLICY.levels) for(const reward of level.reward?rewardLeaves(level.reward):[]) if (reward.kind==='free_spins' && rewardGames(reward).includes(gameId)) {
    const micro = BigInt(reward.stakeUnits);
    assert.equal(micro % 10000n, 0n); assert(policy.rewardStakes.includes(Number(micro / 10000n)), 'Every configured reward nominal must be qualified');
  }
  const game = prepareGame(gameId, 1, {}), serverReplay = [];
  let serverReplayChecks = 0;
  function check(stake, stops, symbols, multiplier, payout) {
    let calls = 0;
    const round = game.play(stake, max => { assert.equal(max, s.radix); return stops[calls++]; });
    assert.equal(calls, 3); assert(verifyGameRound(round));
    assert.deepEqual(round.outcome.symbols, symbols); assert.equal(round.multiplier, multiplier);
    assert.equal(round.gameId, gameId); assert.equal(round.rulesVersion, 1); assert.deepEqual(round.input, {});
    assert.equal(round.stakeUnits, String(stake)); assert.equal(round.payoutUnits, String(payout));
    serverReplayChecks++;
    return round;
  }
  for (const row of evidence.results) {
    const hash = digest(), stake = BigInt(row.stakeUnits);
    for (const stops of stopTriples(s.radix)) {
      const { symbols, multiplier } = reference(gameId, stops), payout = stake * BigInt(multiplier);
      const round = check(stake, stops, symbols, multiplier, payout);
      record(hash, stops, round.outcome.symbols, round.multiplier, round.payoutUnits);
    }
    assert.equal(hash.digest('hex'), row.sha256);
    const streams = policy.seeds.map(seed => stream(gameId, row, seed, policy.serverReplayRoundsPerSeed,
      (stops, symbols, multiplier, payout) => check(stake, stops, symbols, multiplier, payout)));
    serverReplay.push({ choice: row.choice, stakeUnits: row.stakeUnits, exhaustiveOutcomes: s.outcomes, sha256: row.sha256, streams });
  }
  for (const boundary of evidence.integerBoundaries) {
    const hash = digest(), stake = BigInt(boundary.stakeUnits);
    for (const stops of stopTriples(s.radix)) {
      const { symbols, multiplier } = reference(gameId, stops), payout = stake * BigInt(multiplier);
      const round = check(stake, stops, symbols, multiplier, payout);
      record(hash, stops, round.outcome.symbols, round.multiplier, round.payoutUnits);
    }
    assert.equal(hash.digest('hex'), boundary.sha256);
  }
  return { ...evidence, serverReplay, serverReplayChecks };
}
export function validateRewardSlotsProof(gameId, policy, proof) {
  const expected = rewardSlotEvidence(gameId, policy), s = spec(gameId);
  assert.equal(proof.method, REWARD_SLOTS_METHOD);
  assert.deepEqual(proof.analysis, expected.analysis); assert.deepEqual(proof.results, expected.results);
  assert.deepEqual(proof.integerBoundaries, expected.integerBoundaries);
  assert.deepEqual(proof.program, expected.program, 'The complete promotion program or its cumulative cost budget changed');
  assert.equal(proof.serverReplay.length, expected.results.length);
  let checks = expected.integerBoundaries.length * s.outcomes;
  for (const [i, row] of proof.serverReplay.entries()) {
    const result = expected.results[i];
    assert.equal(row.choice, result.choice); assert.equal(row.stakeUnits, result.stakeUnits);
    assert.equal(row.exhaustiveOutcomes, s.outcomes); assert.equal(row.sha256, result.sha256);
    assert.deepEqual(row.streams, policy.seeds.map(seed => stream(gameId, result, seed, policy.serverReplayRoundsPerSeed)));
    checks += row.exhaustiveOutcomes + policy.seeds.length * policy.serverReplayRoundsPerSeed;
  }
  assert.equal(proof.serverReplayChecks, checks);
  return true;
}
