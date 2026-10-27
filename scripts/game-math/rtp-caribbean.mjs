import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { q, add, sub, mul, div, sum, view, cmp } from './rational.mjs';
import {
  CARIBBEAN_LINES, CARIBBEAN_SYMBOLS, CARIBBEAN_LINE_COUNTS, CARIBBEAN_LINE_STAKES,
  CARIBBEAN_PROFILE, CARIBBEAN_BONUS_SPINS,
} from '../../src/shared/caribbeanTreasuresMath.ts';
import { validCaribbeanView } from '../../src/shared/caribbeanTreasures.ts';
import { startCaribbean, moveCaribbean } from '../../server/games/caribbeanTreasures.ts';

export const CARIBBEAN_QUALIFICATION_METHOD = 'exact-caribbean-giant-round-v1';
// Freeze the reviewed implementation. Changing a source requires reviewing this model.
// Forest Heart integration adds an independent game branch and trailing capability flag.
// Caribbean settings, costs, entropy, settlement and its existing flag position are preserved.
export const CARIBBEAN_REVIEWED_SOURCES = {
  'src/shared/caribbeanTreasuresMath.ts': 'b86e71675dfd0179da8d8c43c7a62f8da41303d5e6bc59f07b81d4497b64647b',
  'src/shared/caribbeanTreasures.ts': '5590af9897cfb32dbf8fd7d9c0608ad52184051ddee7ca70cd309267a4311aee',
  'server/games/caribbeanTreasures.ts': 'bdb0aa8eecef1093f876dd3c467ff1b43d8a7b1606a63a56aa46430964556e99',
  'src/shared/caribbeanTransport.ts': 'c4a590c6778048f9ecd37852549762adde064f90dca072316ee215ba8ac89c78',
  'src/shared/casinoExpansion.ts': '38aa6f8f7290092b5ff9b043093815e64be9acc548df2c0c4ce2b63d950dc842',
  'server/demoExpansion.ts': 'b7fd90dbea937f9d793c309650958f08d2460656a3a30c1f607a2e20425f9a69',
  'server/finance/nile-game-runtime.ts': 'fe4198914916183094e8b51458ba53053bf0145f73b3e860bfdc2c2558fe38a2',
};
const WEIGHTS = [30,24,18,13,9,6];
const PAYS = [[2,6,20,60],[4,10,30,100],[6,16,40,150],[8,24,60,200],[10,30,100,400],[16,50,200,1000]];
const PROFILES = {
  1: { baseLargePerMillion: 23055, raidCannonPerMillion: 273067, bonusEntryPerMillion: 10589, bonusCostPerMillion: 25574653 },
  5: { baseLargePerMillion: 56752, raidCannonPerMillion: 261127, bonusEntryPerMillion: 13766, bonusCostPerMillion: 19673213 },
  10: { baseLargePerMillion: 75399, raidCannonPerMillion: 253158, bonusEntryPerMillion: 15476, bonusCostPerMillion: 17499269 },
  20: { baseLargePerMillion: 73134, raidCannonPerMillion: 256339, bonusEntryPerMillion: 15212, bonusCostPerMillion: 17803460 },
};
export const CARIBBEAN_CHOICES = [1,5,10,20].flatMap(lines =>
  ['normal-raid','normal-flagship','buy-raid','buy-flagship'].map(mode => 'lines-' + lines + '-' + mode));
function contract(policy) {
  assert.equal(policy.method, CARIBBEAN_QUALIFICATION_METHOD);
  assert.equal(policy.target, .96); assert.equal(policy.tolerance, .0005);
  assert.equal(policy.rulesVersion, 1); assert.equal(policy.progressVersion, 1);
  assert.deepEqual(policy.choices, CARIBBEAN_CHOICES);
  assert.deepEqual(policy.stakes, [100,200,500,1000]);
  assert.deepEqual(policy.seeds, [700131,929827]);
  assert.equal(policy.serverReplayRoundsPerSeed, 32);
  assert.deepEqual(CARIBBEAN_LINE_COUNTS, [1,5,10,20]);
  assert.deepEqual(CARIBBEAN_LINE_STAKES, ['100','200','500','1000']);
  assert.deepEqual(CARIBBEAN_SYMBOLS.map(symbol => symbol.weight), WEIGHTS);
  assert.deepEqual(CARIBBEAN_SYMBOLS.map(symbol => symbol.pays), PAYS);
  assert.deepEqual(CARIBBEAN_PROFILE, PROFILES);
  assert.deepEqual(CARIBBEAN_BONUS_SPINS, { raid: 14, flagship: 6 });
}
function parse(choice) {
  const match = /^lines-(1|5|10|20)-(normal|buy)-(raid|flagship)$/.exec(choice);
  assert(match); return { lines: Number(match[1]), bought: match[2] === 'buy', tactic: match[3] };
}
/** Independent geometry enumeration; does not call runtime expansion or painting helpers. */
function cases(mode, lines) {
  const profile = PROFILES[lines], result = [];
  const large = q(profile.baseLargePerMillion, 1000000);
  if (mode === 'base') result.push({ block: null, probability: sub(q(7,10),large) });
  if (mode !== 'raid') for (let y = 0; y <= 1; y++) for (let x = 0; x <= 3; x++)
    result.push({ block: { x,y,size:3 }, probability: div(mode === 'base' ? large : q(1),q(8)) });
  if (mode !== 'flagship') for (let y = 0; y <= 2; y++) for (let x = 0; x <= 4; x++) {
    const block = { x,y,size:2 }, base = div(mode === 'base' ? q(3,10) : q(1),q(15));
    const cannon = mode === 'base' ? q(1,8) : q(profile.raidCannonPerMillion,1000000);
    result.push({ block, probability: mul(base,sub(q(1),cannon)) });
    const expansions = [];
    for (let yy = 0; yy <= 1; yy++) for (let xx = 0; xx <= 3; xx++)
      if (xx <= x && xx + 3 >= x + 2 && yy <= y && yy + 3 >= y + 2) expansions.push({ x:xx,y:yy,size:3 });
    assert(expansions.length > 0);
    for (const expanded of expansions) result.push({ block:expanded, probability: div(mul(base,cannon),q(expansions.length)) });
  }
  assert.equal(cmp(sum(result.map(row => row.probability)),q(1)),0);
  return result;
}
function group(line, column, block) {
  return block && column >= block.x && column < block.x + block.size
    && line[column] >= block.y && line[column] < block.y + block.size ? -1 : column;
}
function lineMean(line, block) {
  let result = q(0);
  for (let symbol = 0; symbol < 6; symbol++) {
    const probability = q(WEIGHTS[symbol],100);
    for (let count = 3; count <= 6; count++) {
      const prefix = new Set(Array.from({ length:count },(_,column) => group(line,column,block)));
      let mass = q(1);
      for (const _ of prefix) mass = mul(mass,probability);
      if (count < 6) mass = prefix.has(group(line,count,block)) ? q(0) : mul(mass,sub(q(1),probability));
      result = add(result,mul(mass,q(PAYS[symbol][count - 3])));
    }
  }
  return result;
}
function spinMean(mode, lines) {
  return div(sum(cases(mode,lines).map(row => mul(row.probability,
    sum(CARIBBEAN_LINES.slice(0,lines).map(line => lineMean(line,row.block)))))),q(lines));
}
function cost(lines, stake, bought) {
  const base = BigInt(lines) * BigInt(stake);
  return bought ? (base * BigInt(PROFILES[lines].bonusCostPerMillion) + 999999n) / 1000000n : base;
}
export function caribbeanQualificationEvidence(policy) {
  contract(policy);
  const spins = Object.fromEntries([1,5,10,20].map(lines => [lines,
    Object.fromEntries(['base','raid','flagship'].map(mode => [mode,spinMean(mode,lines)]))]));
  const results = [];
  for (const choice of policy.choices) for (const stakeUnits of policy.stakes) {
    const { lines,bought,tactic } = parse(choice), base = BigInt(lines) * BigInt(stakeUnits);
    const bonus = mul(spins[lines][tactic],q(tactic === 'raid' ? 14 : 6));
    const paidCost = cost(lines,stakeUnits,bought);
    const expected = mul(q(base),bought ? bonus : add(spins[lines].base,
      mul(q(PROFILES[lines].bonusEntryPerMillion,1000000),bonus)));
    const rtp = div(expected,q(paidCost));
    assert(cmp(rtp,q(9595,10000)) >= 0 && cmp(rtp,q(9605,10000)) <= 0,'Caribbean expected return outside policy');
    const maximumSpins = (tactic === 'raid' ? 14 : 6) + (bought ? 0 : 1);
    results.push({ choice,stakeUnits,costUnits:String(paidCost),expectedPayoutUnits:view(expected),
      rtp:view(rtp),maximumSpins,maximumPayoutUnits:String(base * 1000n * BigInt(maximumSpins)) });
  }
  return {
    method:CARIBBEAN_QUALIFICATION_METHOD,
    analysis:{
      baseStake:'lineStakeUnits * activeLines',
      formula:'Normal: E[base] + P[entry] * E[chosen complete bonus]. Purchase: E[complete bonus] / actual rounded purchase price.',
      jointSymbolModel:'Distinct ordinary cells are independent. Every cell of a giant block shares one symbol draw. Only the longest left-starting run pays on each line.',
      positions:'Every legal initial square and every uniformly selected containing cannon expansion is enumerated.',
      money:'Integer line factors and integer line stakes make line and round payouts exact. Purchase prices round upward once, and are evaluated separately for all stakes.',
      choice:'Future bonus draws are independent of the known base field. Both pure tactics are covered; any randomized or state-dependent choice mixes their conditional expectations.',
      bounds:'The longest round contains 15 spin fields, each at most 1000 base stakes. No truncating cap or retrigger is present.',
      limitations:['This proves expected return for the reviewed source and declared choices. It does not measure the full payout distribution or player enjoyment.',
        'Server replay checks mathematical state transitions and integer settlement. Shared-wallet database atomicity and host integration require their own tests.'],
      spinMeans:Object.fromEntries(Object.entries(spins).map(([lines,modes]) => [lines,
        Object.fromEntries(Object.entries(modes).map(([mode,mean]) => [mode,view(mean)]))])),
    },results,
  };
}
function seeded(seed) {
  let counter = 0;
  return maximum => {
    const ceiling = Math.floor(4294967296 / maximum) * maximum;
    let value;
    do { value = createHash('sha256').update(String(seed) + ':' + counter++).digest().readUInt32BE(0); } while (value >= ceiling);
    return value % maximum;
  };
}
function checkSpin(spin, lines, stake) {
  const { frame } = spin, wins = [];
  for (let index = 0; index < lines; index++) {
    const line = CARIBBEAN_LINES[index], positions = line.map((row,column) => row * 6 + column);
    const symbol = frame.grid[positions[0]];
    let count = 0;
    for (const position of positions) { if (frame.grid[position] !== symbol) break; count++; }
    if (count >= 3) wins.push({ line:index,symbol,count,positions:positions.slice(0,count),factor:PAYS[symbol][count - 3] });
  }
  assert.deepEqual(frame.wins,wins);
  const factor = wins.reduce((total,win) => total + win.factor,0);
  assert.equal(frame.factorSum,factor);
  assert.equal(spin.payoutUnits,String(BigInt(stake) * BigInt(factor)));
  for (let position = 0; position < 24; position++) {
    const block = frame.block, x = position % 6, y = Math.floor(position / 6);
    const inside = block && x >= block.x && x < block.x + block.size && y >= block.y && y < block.y + block.size;
    assert.equal(frame.grid[position],inside ? block.symbol : frame.gridBefore[position]);
  }
}
export async function qualifyCaribbean(policy, progress = () => {}) {
  const evidence = caribbeanQualificationEvidence(policy), coverage = [];
  let serverReplayChecks = 0, cannons = 0, naturalEntries = 0;
  for (const choice of policy.choices) for (const stake of policy.stakes) {
    const { lines,bought,tactic } = parse(choice), hash = createHash('sha256');
    let paidRounds = 0, spins = 0;
    for (const seed of policy.seeds) for (let round = 0; round < policy.serverReplayRoundsPerSeed; round++) {
      const rng = round === 0 ? () => 0 : seeded(seed + round * 1009 + lines * 100003);
      let outcome = startCaribbean({ lines,mode:bought ? 'buy-' + tactic : 'normal' },String(stake),rng);
      const acceptedCost = String(cost(lines,stake,bought));
      assert.equal(outcome.costUnits,acceptedCost);
      if (outcome.view.phase === 'choice') naturalEntries++;
      while (!outcome.ended) {
        assert.equal(outcome.creditUnits,'0');
        const current = JSON.parse(JSON.stringify(outcome.view));
        assert(validCaribbeanView(current));
        outcome = moveCaribbean(current,current.revision,current.phase === 'choice' ? 'choose-' + tactic : 'spin',rng);
        assert.equal(outcome.costUnits,acceptedCost);
      }
      assert(validCaribbeanView(outcome.view));
      for (const spin of outcome.view.spins) { checkSpin(spin,lines,stake); cannons += Number(spin.frame.cannon); }
      const actual = outcome.view.spins.reduce((total,spin) => total + BigInt(spin.payoutUnits),0n);
      assert.equal(outcome.creditUnits,String(actual));
      assert.equal(outcome.view.remaining,0);
      assert(outcome.view.spins.length <= (tactic === 'raid' ? 14 : 6) + (bought ? 0 : 1));
      hash.update(JSON.stringify(outcome) + '\n');
      paidRounds++; spins += outcome.view.spins.length; serverReplayChecks++;
    }
    coverage.push({ choice,stakeUnits:stake,paidRounds,spins,sha256:hash.digest('hex') });
    progress({ gameId:'studio-caribbean-treasures',phase:'server-replay',completed:coverage.length,total:policy.choices.length * policy.stakes.length });
  }
  assert(cannons > 0 && naturalEntries > 0);
  return { ...evidence,serverReplayChecks,
    serverReplay:{ seeds:[...policy.seeds],coverage,cannons,naturalEntries } };
}
