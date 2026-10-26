// Independent finite-distribution audit. This file does not change game rules or qualification evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getLuelonSlotRules, COSMIC_MATH_PROFILE_VERSION, COSMIC_MATH_ENTRY_PER_MILLION, COSMIC_MATH_TARGET_RTP, COSMIC_MATH_RTP_TOLERANCE, LUELON_SLOT_PROFILES } from '../../src/shared/luelonSlotsModels.ts';
import { luelonSlotLineWins } from '../../src/shared/luelonSlots.ts';
import { COSMIC_ESCAPE_BET_UNITS } from '../../src/shared/cosmicEscapeBets.ts';
import { startLuelonSlotGame, moveLuelonSlotGame } from '../../server/games/luelonSlots.ts';
import { seededRandom } from '../../src/shared/draconaMath.ts';

const game = 'studio-cosmic-escape', rule = getLuelonSlotRules(game), info = rule.info;
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes('--' + key) ? args[args.indexOf('--' + key) + 1] : fallback;
const output = resolve(option('output', 'docs/game-math/cosmic-exact-audit-20261025.json'));
const sourceFiles = ['server/games/luelonSlots.ts', 'src/shared/luelonSlots.ts', 'src/shared/luelonSlotsModels.ts', 'src/shared/luelonSlotsLines.ts', 'src/shared/cosmicEscapeBets.ts', 'scripts/game-math/audit-cosmic-exact.mjs'];
const hashSources = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update((await readFile(path, 'utf8')).replaceAll('\r\n', '\n')).digest('hex')])));
const sourceHashes = await hashSources();
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
function fraction(n, d = 1n) { n = BigInt(n); d = BigInt(d); assert(d !== 0n); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a, b) => fraction(a.n * b.n, a.d * b.d);
const number = a => Number(a.n) / Number(a.d);
const exact = a => ({ numerator: String(a.n), denominator: String(a.d), value: number(a) });
const choose = (n, k) => k < 0 || k > n ? 0 : k === 0 ? 1 : choose(n - 1, k - 1) * n / k;
const zero = () => fraction(0);
const sum = values => values.reduce(add, zero());
const popcount = mask => mask.toString(2).replaceAll('0', '').length;

// A WILD prefix can win on its own, even when an ordinary symbol extends farther.
// All ordinary prefix pays are below the WILD pay for the same length.
for (const count of [3, 4, 5]) for (let symbol = 0; symbol < rule.ordinary; symbol++) assert(info.symbols[symbol].pays[count] <= info.symbols[rule.wild].pays[count]);
function score(line) {
  let wildPrefix = 0;
  while (line[wildPrefix] === rule.wild && wildPrefix < 5) wildPrefix++;
  let best = wildPrefix >= 3 ? { symbol: rule.wild, count: wildPrefix, pay: info.symbols[rule.wild].pays[wildPrefix] } : { symbol: -1, count: 0, pay: 0 };
  const ordinary = line[wildPrefix];
  if (wildPrefix < 5 && ordinary < rule.ordinary) {
    let count = wildPrefix;
    while (count < 5 && (line[count] === ordinary || line[count] === rule.wild)) count++;
    const pay = info.symbols[ordinary].pays[count] ?? 0;
    if (pay > best.pay) best = { symbol: ordinary, count, pay };
  }
  return best;
}

let scorerChecks = 0, shorterWildPrefixWins = 0;
const scoreCache = new Uint16Array(9 ** 5), allPays = new Set([0]);
function enumerate(callback, fixedMask = 0, weights = Array(9).fill(1n)) {
  const line = Array(5).fill(0);
  function visit(col, weight, code) {
    if (col === 5) { callback(line, weight, code); return; }
    if (fixedMask & (1 << col)) { line[col] = rule.wild; visit(col + 1, weight, code * 9 + rule.wild); return; }
    for (let symbol = 0; symbol < 9; symbol++) if (weights[symbol]) { line[col] = symbol; visit(col + 1, weight * weights[symbol], code * 9 + symbol); }
  }
  visit(0, 1n, 0);
}
enumerate((line, _weight, code) => {
  const independent = score(line), grid = Array(15).fill(rule.scatter);
  line.forEach((symbol, col) => { grid[col] = symbol; });
  const actual = luelonSlotLineWins(game, grid).find(win => win.line === 0);
  assert.equal(independent.pay, actual?.payHundredths ?? 0);
  if (actual) { assert.equal(independent.symbol, actual.symbol); assert.equal(independent.count, actual.count); }
  if (independent.symbol === rule.wild && independent.count < 5 && line[independent.count] < rule.ordinary) shorterWildPrefixWins++;
  scoreCache[code] = independent.pay; allPays.add(independent.pay); scorerChecks++;
});
const settlementDivisibility = COSMIC_ESCAPE_BET_UNITS.every(stake => [...allPays].every(pay => Array.from({ length: 50 }, (_, i) => i + 1).every(multiplier => BigInt(stake) * BigInt(pay) * BigInt(multiplier) % 100n === 0n)));
assert(settlementDivisibility, 'Stake normalization needs separate flooring calculations');

// Raw free-spin line probabilities have integer weights on a common denominator.
// A scatter replaces a given line cell with probability 8/1000 * 1/3.
const freeDenominator = 262500n, freeWeights = [...Array(7).fill(36652n), 5236n, 700n];
assert.equal(freeWeights.reduce((a, b) => a + b), freeDenominator);
const freeMaskMeans = new Map(), freeMaskMoments = new Map(), momentOrder = 8;
for (let mask = 0; mask < 32; mask++) if (popcount(mask) <= 2) {
  let totalWeight = 0n, payWeight = 0n;
  const moments = Array(momentOrder + 1).fill(0n);
  enumerate((_line, weight, code) => { totalWeight += weight; const pay = BigInt(scoreCache[code]); payWeight += weight * pay; let power = 1n; for (let k = 0; k <= momentOrder; k++) { moments[k] += weight * power; power *= pay; } }, mask, freeWeights);
  const denominator = freeDenominator ** BigInt(5 - popcount(mask));
  assert.equal(totalWeight, denominator);
  freeMaskMeans.set(mask, fraction(payWeight, denominator));
  freeMaskMoments.set(mask, moments.map((n, k) => fraction(n, denominator * 100n ** BigInt(k))));
}

function beamDistribution(mode) {
  const chance = LUELON_SLOT_PROFILES.cosmicBeamPerThousand[mode], attempts = LUELON_SLOT_PROFILES.cosmicBeamAttempts[mode];
  let distribution = new Map([[0, 1n]]);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const next = new Map();
    const append = (mask, weight) => next.set(mask, (next.get(mask) ?? 0n) + weight);
    for (const [mask, weight] of distribution) {
      append(mask, weight * BigInt(5 * (1000 - chance)));
      for (let col = 0; col < 5; col++) append(mask | (1 << col), weight * BigInt(chance));
    }
    distribution = next;
  }
  const denominator = 5000n ** BigInt(attempts);
  assert.equal([...distribution.values()].reduce((a, b) => a + b), denominator);
  return [...distribution].map(([mask, weight]) => ({ mask, probability: fraction(weight, denominator) }));
}
const frameMeans = Object.fromEntries(info.modes.filter(mode => mode.bonus).map(mode => {
  const meanLineHundredths = sum(beamDistribution(mode.id).map(({ mask, probability }) => mul(freeMaskMeans.get(mask), probability)));
  return [mode.id, mul(meanLineHundredths, fraction(20, 100))];
}));

// All operations in the upper moment bound round outward to the next positive float.
// The exact rational input is compared with the float's exact binary fraction.
const floatBuffer = new ArrayBuffer(8), floatView = new DataView(floatBuffer);
function nextUp(value) { if (value === 0) return Number.MIN_VALUE; assert(value > 0 && Number.isFinite(value)); floatView.setFloat64(0, value); floatView.setBigUint64(0, floatView.getBigUint64(0) + 1n); return floatView.getFloat64(0); }
function nextDown(value) { if (!value) return -Number.MIN_VALUE; assert(value > 0 && Number.isFinite(value)); floatView.setFloat64(0, value); floatView.setBigUint64(0, floatView.getBigUint64(0) - 1n); return floatView.getFloat64(0); }
function floatFraction(value) { if (!value) return fraction(0); floatView.setFloat64(0, value); const bits = floatView.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n) - 1023 - 52, mantissa = (bits & ((1n << 52n) - 1n)) + (1n << 52n); return exponent >= 0 ? fraction(mantissa << BigInt(exponent)) : fraction(mantissa, 1n << BigInt(-exponent)); }
function upper(a) { let value = number(a); while (true) { const represented = floatFraction(value); if (represented.n * a.d >= a.n * represented.d) return value; value = nextUp(value); } }
function lower(a) { let value = number(a); while (true) { const represented = floatFraction(value); if (represented.n * a.d <= a.n * represented.d) return value; value = nextDown(value); } }
const plus = (a, b) => a === 0 ? b : b === 0 ? a : nextUp(a + b);
const times = (a, b) => a === 0 || b === 0 ? 0 : nextUp(a * b);
const powerUpper = (a, k) => { let value = 1; for (let i = 0; i < k; i++) value = times(value, a); return value; };
const boardMomentBounds = Object.fromEntries(info.modes.filter(mode => mode.bonus).map(mode => {
  const distribution = beamDistribution(mode.id);
  const moments = Array.from({ length: momentOrder + 1 }, (_, k) => sum(distribution.map(({ mask, probability }) => mul(freeMaskMoments.get(mask)[k], probability))));
  // Convexity: (X1+...+X20)^k <=20^(k-1)*(X1^k+...+X20^k).
  return [mode.id, moments.map((moment, k) => upper(mul(moment, fraction(20n ** BigInt(k)))))];
}));

// Exact distribution of persistent capped energy after every first free-spin frame.
const transitions = [[0, 3000], [1, 800], [2, 100], [3, 50], [5, 30], [10, 15], [25, 4], [50, 1]];
assert.equal(transitions.reduce((s, row) => s + row[1], 0), 4000);
function energy(start, spins) {
  let counts = Array(51).fill(0n); counts[start] = 1n;
  let denominator = 1n;
  const means = [], atLimit = [];
  for (let spin = 1; spin <= spins; spin++) {
    const next = Array(51).fill(0n);
    for (let multiplier = 1; multiplier <= 50; multiplier++) if (counts[multiplier]) for (const [increment, weight] of transitions) next[Math.min(50, multiplier + increment)] += counts[multiplier] * BigInt(weight);
    counts = next; denominator *= 4000n;
    assert.equal(counts.reduce((a, b) => a + b), denominator);
    means.push(fraction(counts.reduce((s, count, multiplier) => s + count * BigInt(multiplier), 0n), denominator));
    atLimit.push(fraction(counts[50], denominator));
  }
  return { means, atLimit, total: sum(means) };
}
function campaign(mode, spins, start) {
  const chain = energy(start, spins), echo = fraction(100 + LUELON_SLOT_PROFILES.cosmicEchoPerHundred[mode], 100);
  return { mean: mul(mul(frameMeans[mode], echo), chain.total), chain };
}

// Conditional base boards have K distinct scatter columns and one random row in each.
// For a fixed set of q scatter line cells, this is its exact joint probability.
const baseMeanByCount = [];
for (let count = 0; count <= 5; count++) {
  const denominator = 7000n ** 5n * BigInt(choose(5, count)) * 3n ** BigInt(count);
  let totalWeight = 0n, payWeight = 0n;
  enumerate((line, _weight, code) => {
    const q = line.filter(symbol => symbol === rule.scatter).length;
    if (q > count) return;
    let weight = 7000n ** BigInt(q) * BigInt(choose(5 - q, count - q)) * 2n ** BigInt(count - q);
    for (const symbol of line) if (symbol !== rule.scatter) weight *= symbol === rule.wild ? 21n : 997n;
    totalWeight += weight; payWeight += weight * BigInt(scoreCache[code]);
  });
  assert.equal(totalWeight, denominator);
  baseMeanByCount.push(mul(fraction(payWeight, denominator), fraction(20, 100)));
}
const entry = fraction(COSMIC_MATH_ENTRY_PER_MILLION[COSMIC_MATH_PROFILE_VERSION], 1000000);
const nonEntry = fraction(entry.d - entry.n, entry.d);
const countWeights = [mul(nonEntry, fraction(1, 3)), mul(nonEntry, fraction(1, 3)), mul(nonEntry, fraction(1, 3)), mul(entry, fraction(80, 100)), mul(entry, fraction(15, 100)), mul(entry, fraction(5, 100))];
const countMass = sum(countWeights); assert.equal(countMass.n, countMass.d);
const baseContribution = sum(baseMeanByCount.map((mean, count) => mul(mean, countWeights[count])));
const naturalCampaigns = [10, 12, 15].map(spins => ({ spins, ...campaign('cosmic-chaos', spins, 1) }));
const naturalBonusConditional = sum(naturalCampaigns.map((row, index) => mul(row.mean, [fraction(80, 100), fraction(15, 100), fraction(5, 100)][index])));
const naturalBonusContribution = mul(entry, naturalBonusConditional);
const modes = info.modes.map(mode => {
  const bonus = mode.bonus ? campaign(mode.id, mode.spins, mode.startMultiplier) : null;
  const expectation = bonus ? bonus.mean : add(baseContribution, naturalBonusContribution);
  const rtp = mul(expectation, fraction(1, mode.cost));
  return { id: mode.id, costInStakes: mode.cost, spins: mode.spins, startMultiplier: mode.startMultiplier, uncappedExpectedPayoutInStakes: exact(expectation), uncappedRtp: exact(rtp), uncappedRtpOutward: [lower(rtp), upper(rtp)], deviationFromTarget: number(rtp) - COSMIC_MATH_TARGET_RTP,
    energyMeanBySpin: bonus?.chain.means.map(exact), energyAt50BySpin: bonus?.chain.atLimit.map(exact) };
});

function capLossBound(mode, spins, start, cap = 10000) {
  const board = boardMomentBounds[mode], echoNumerator = LUELON_SLOT_PROFILES.cosmicEchoPerHundred[mode];
  const echo = upper(fraction(echoNumerator, 100)), noEcho = upper(fraction(100 - echoNumerator, 100));
  const spinMoments = Array.from({ length: 51 }, (_, multiplier) => Array.from({ length: momentOrder + 1 }, (_, k) => {
    if (!k) return 1;
    let twoFrames = 0;
    for (let j = 0; j <= k; j++) twoFrames = plus(twoFrames, times(choose(k, j), times(board[j], board[k - j])));
    return times(powerUpper(multiplier, k), plus(times(noEcho, board[k]), times(echo, twoFrames)));
  }));
  let moments = Array.from({ length: 51 }, () => Array(momentOrder + 1).fill(0)); moments[start][0] = 1;
  for (let spin = 0; spin < spins; spin++) {
    const next = Array.from({ length: 51 }, () => Array(momentOrder + 1).fill(0));
    for (let before = 1; before <= 50; before++) if (moments[before][0]) for (const [increment, weight] of transitions) {
      const after = Math.min(50, before + increment), probability = upper(fraction(weight, 4000));
      for (let k = 0; k <= momentOrder; k++) {
        let sum = 0;
        for (let j = 0; j <= k; j++) sum = plus(sum, times(choose(k, j), times(moments[before][k - j], spinMoments[after][j])));
        next[after][k] = plus(next[after][k], times(probability, sum));
      }
    }
    moments = next;
  }
  const raw = Array.from({ length: momentOrder + 1 }, (_, k) => moments.reduce((value, state) => plus(value, state[k]), 0));
  const bounds = raw.slice(2).map((value, index) => {
    const k = index + 2;
    // For x>=0: (x-C)+ <= ((k-1)^(k-1)/(k^k*C^(k-1)))*x^k.
    const coefficient = upper(fraction(BigInt(k - 1) ** BigInt(k - 1), BigInt(k) ** BigInt(k) * BigInt(cap) ** BigInt(k - 1)));
    return { momentOrder: k, rawMomentUpper: value, capLossUpperInStakes: times(value, coefficient) };
  });
  return { mode, spins, start, cap, method: 'Exact single-line moments, convexity bound for correlated paylines, independent fresh boards and echo conditional on the exact capped energy Markov chain, polynomial stop-loss inequality. Every positive floating operation rounds outward.', bounds, bestUpperInStakes: Math.min(...bounds.map(row => row.capLossUpperInStakes)) };
}
const capBounds = info.modes.filter(mode => mode.bonus).map(mode => capLossBound(mode.id, mode.spins, mode.startMultiplier));
const naturalBounds = [10, 12, 15].map(spins => capLossBound('cosmic-chaos', spins, 1, 9200));
const naturalLossUpper = times(upper(entry), naturalBounds.reduce((value, bound, index) => plus(value, times(upper([fraction(80, 100), fraction(15, 100), fraction(5, 100)][index]), bound.bestUpperInStakes)), 0));
for (const mode of modes) {
  const loss = mode.id === 'normal' ? naturalLossUpper : capBounds.find(row => row.mode === mode.id).bestUpperInStakes;
  const lossRtpUpper = times(loss, upper(fraction(1, mode.costInStakes)));
  const conservativeLower = nextDown(mode.uncappedRtpOutward[0] - lossRtpUpper);
  mode.capLossUpperInStakes = loss;
  mode.cappedRtpBound = [conservativeLower, mode.uncappedRtpOutward[1]];
}

function drawStream(seed, forcedCount) {
  const random = seededRandom(seed); let calls = 0;
  return max => {
    let value = Math.floor(random() * max);
    if (forcedCount !== undefined && calls === 30) { assert.equal(max, 1000000); value = forcedCount ? 0 : 999999; }
    if (forcedCount && calls === 31) { assert.equal(max, 100); value = forcedCount === 5 ? 0 : forcedCount === 4 ? 10 : 99; }
    calls++; return value;
  };
}
function shadowRound(mode, stake, draw) {
  const cap = BigInt(stake) * 10000n, spins = [];
  let multiplier = mode.startMultiplier, total = 0n, remaining = mode.spins;
  function board(free) {
    const grid = Array.from({ length: 15 }, () => draw(7));
    for (let cell = 0; cell < 15; cell++) if (draw(1000) < (free ? 20 : 3)) grid[cell] = 7;
    if (free) { for (let col = 0; col < 5; col++) if (draw(1000) < 8) grid[draw(3) * 5 + col] = 8; }
    else {
      const trigger = draw(1000000) < COSMIC_MATH_ENTRY_PER_MILLION[COSMIC_MATH_PROFILE_VERSION], roll = trigger ? draw(100) : 0;
      const count = trigger ? roll < 5 ? 5 : roll < 20 ? 4 : 3 : draw(3), pool = [0, 1, 2, 3, 4];
      for (let n = 0; n < count; n++) { const col = pool.splice(draw(pool.length), 1)[0]; grid[draw(3) * 5 + col] = 8; }
    }
    return grid;
  }
  function frame(raw, free, id, echo) {
    const grid = [...raw], beamColumns = [];
    if (free) {
      if (!echo && draw(100) < 25) {
        const roll = draw(1000), increment = roll < 800 ? 1 : roll < 900 ? 2 : roll < 950 ? 3 : roll < 980 ? 5 : roll < 995 ? 10 : roll < 999 ? 25 : 50;
        multiplier = Math.min(50, multiplier + increment);
      }
      for (let attempt = 0; attempt < LUELON_SLOT_PROFILES.cosmicBeamAttempts[id]; attempt++) if (draw(1000) < LUELON_SLOT_PROFILES.cosmicBeamPerThousand[id]) {
        const col = draw(5); if (beamColumns.includes(col)) continue;
        beamColumns.push(col); for (let row = 0; row < 3; row++) grid[row * 5 + col] = 7;
      }
    }
    const wins = [];
    let rawUnits = 0n;
    for (let line = 0; line < info.paylines.length; line++) {
      const result = score(info.paylines[line].map((row, col) => grid[row * 5 + col]));
      if (!result.pay) continue;
      const factor = free ? multiplier : 1, units = BigInt(stake) * BigInt(result.pay) * BigInt(factor) / 100n;
      rawUnits += units; wins.push({ line, symbol: result.symbol, count: result.count, payHundredths: result.pay, factor, uncappedPayoutUnits: String(units) });
    }
    const paid = rawUnits < cap - total ? rawUnits : cap - total; total += paid;
    return { raw, grid, beamColumns, wins, rawUnits: String(rawUnits), paid: String(paid), multiplier };
  }
  let free = !!mode.bonus;
  do {
    const before = multiplier, raw = board(free), id = mode.bonus ?? 'cosmic-chaos';
    const frames = [frame(raw, free, id, false)];
    if (free && total < cap && draw(100) < LUELON_SLOT_PROFILES.cosmicEchoPerHundred[id]) frames.push(frame(board(true), true, id, true));
    let grant = 0;
    if (!free && total < cap) { const count = raw.filter(symbol => symbol === 8).length; if (count >= 3) { grant = count >= 5 ? 15 : count === 4 ? 12 : 10; remaining = grant; } }
    if (free) remaining--;
    spins.push({ before, after: multiplier, frames, grant, total: String(total) });
    free = true;
  } while (remaining > 0 && total < cap);
  return { spins, credit: Number(total), capped: total === cap };
}
function serverChecks() {
  const configurations = [], seen = { echoes: 0, energyEvents: 0, beams: 0, naturalAwards: {} };
  for (const mode of info.modes) for (const stake of COSMIC_ESCAPE_BET_UNITS) {
    const cases = mode.bonus ? [undefined, undefined] : [0, 3, 4, 5];
    for (const [caseIndex, forcedCount] of cases.entries()) {
      const seed = 2026102501 + caseIndex * 7919 + info.modes.indexOf(mode) * 1000003;
      const expected = shadowRound(mode, stake, drawStream(seed, forcedCount));
      const actualDraw = drawStream(seed, forcedCount);
      let actual = startLuelonSlotGame(game, { luelon: { mode: mode.id } }, stake, actualDraw), index = 0;
      function check() {
        const spin = actual.luelon.history[index], shadow = expected.spins[index];
        assert(spin && shadow); assert.equal(spin.featuresBefore.multiplier, shadow.before); assert.equal(spin.featuresAfter.multiplier, shadow.after);
        assert.equal(spin.triggerAwards, shadow.grant); assert.equal(actual.luelon.totalPayoutUnits, shadow.total);
        assert.equal(spin.frames.length, shadow.frames.length);
        for (let frameIndex = 0; frameIndex < spin.frames.length; frameIndex++) {
          const frame = spin.frames[frameIndex], expectedFrame = shadow.frames[frameIndex];
          assert.deepEqual(frame.gridBefore, expectedFrame.raw); assert.deepEqual(frame.gridAfter, expectedFrame.grid);
          assert.equal(frame.payoutUnits, expectedFrame.paid); assert.equal(frame.uncappedPayoutUnits, expectedFrame.rawUnits);
          assert.deepEqual(frame.wins.map(({ line, symbol, count, payHundredths, factor, uncappedPayoutUnits }) => ({ line, symbol, count, payHundredths, factor, uncappedPayoutUnits })), expectedFrame.wins);
          assert.deepEqual(frame.events.filter(event => event.kind === 'expand').map(event => event.positions[0] % 5), expectedFrame.beamColumns);
          seen.echoes += frame.events.filter(event => event.kind === 'echo').length; seen.energyEvents += frame.events.filter(event => event.kind === 'energy').length; seen.beams += expectedFrame.beamColumns.length;
        }
        if (shadow.grant) seen.naturalAwards[shadow.grant] = (seen.naturalAwards[shadow.grant] ?? 0) + 1;
        index++;
      }
      if (actual.luelon.history.length) check();
      while (!actual.ended) {
        actual = moveLuelonSlotGame(JSON.parse(JSON.stringify(actual.luelon)), stake, actual.luelon.revision, 'luelon-spin', undefined, actualDraw);
        check();
      }
      assert.equal(index, expected.spins.length); assert.equal(actual.credit, expected.credit); assert.equal(actual.luelon.capped, expected.capped);
      configurations.push({ mode: mode.id, stakeUnits: stake, seed, forcedNaturalScatterCount: forcedCount, spins: index, finalPayoutUnits: String(actual.credit) });
    }
  }
  assert(seen.echoes > 0 && seen.energyEvents > 0 && seen.beams > 0);
  assert.deepEqual(Object.keys(seen.naturalAwards).sort(), ['10', '12', '15']);
  return { configurations, counters: seen, method: 'Independent board, energy, beam and echo implementation and prefix scorer compared with real start/move after serializing each saved continuation. All 26 stakes and all 4 modes; natural 3/4/5-scatter branches forced independently of future seed draws.' };
}
const replay = serverChecks();

assert.deepEqual(await hashSources(), sourceHashes, 'Audited sources changed during the run');
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), gameId: game, mathProfileVersion: COSMIC_MATH_PROFILE_VERSION, targetRtp: COSMIC_MATH_TARGET_RTP, tolerance: COSMIC_MATH_RTP_TOLERANCE, sourceHashes,
  method: 'Finite enumeration of all 9^5 line strings, exact rational joint base scatter probabilities and beam masks, exact rational 50-state energy chain, linearity across 20 paylines and echo. No Monte Carlo enters the uncapped expectations.',
  scorerChecks: { strings: scorerChecks, shorterWildPrefixWins, matchesActualHelper: true },
  stakeChecks: { stakeUnits: COSMIC_ESCAPE_BET_UNITS, payHundredths: [...allPays].sort((a, b) => a - b), multipliers: [1, 50], integerSettlementForEveryCombination: settlementDivisibility, normalizedOutcomesIdentical: true },
  freeFrameMeanAtMultiplier1: Object.fromEntries(Object.entries(frameMeans).map(([mode, mean]) => [mode, exact(mean)])),
  base: { entryProbability: exact(entry), meanByScatterCount: baseMeanByCount.map(exact), scatterCountWeights: countWeights.map(exact), contribution: exact(baseContribution), bonusConditionalMean: exact(naturalBonusConditional), bonusContribution: exact(naturalBonusContribution), campaigns: naturalCampaigns.map(row => ({ spins: row.spins, expectedPayoutInStakes: exact(row.mean) })) },
  capBounds, naturalCapBounds: naturalBounds, modes, serverReplay: replay,
  cappedCoupling: { capInStakes: 10000, proof: 'Sample latent independent future boards, beam attempts, energy and echo coins through the declared spin budget even after the actual engine would stop. Every awarded line amount is nonnegative. Sequential per-line capping and termination pay exactly min(latent uncapped complete-round payout, 10000 stakes). Skipping an echo draw or future spins after reaching the cap cannot alter this identity. Base payout is at most 800 stakes, so normal bonus suppression at the cap never occurs on its initial spin.', uncappedExpectationIsUpperBound: true, noProfitableExpectation: modes.every(mode => mode.uncappedRtpOutward[1] < 1) },
  limitations: ['Uncapped expectation is exact rational arithmetic for the current model. Capped RTP is bounded using a conservative stop-loss moment inequality, rather than computed exactly.', 'The conservative lower bounds do not certify 95.8% minimum RTP. All upper bounds are below 100%, which excludes a positive mathematical expectation in these current modes.', 'All paylines share board cells. Marginal line enumeration suffices for expectation, but does not give the complete board or round distribution.', 'Integer settlement and normalized cap thresholds coincide at every current allowed stake.', 'Server replay covers current accepted initial states and free continuations, not adversarially forged persisted state or database wallet atomicity.']
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, scorerChecks: report.scorerChecks, baseContribution: number(baseContribution), naturalBonusConditional: number(naturalBonusConditional), modes: modes.map(({ id, costInStakes, uncappedExpectedPayoutInStakes, uncappedRtp, deviationFromTarget, capLossUpperInStakes, cappedRtpBound }) => ({ id, costInStakes, payout: uncappedExpectedPayoutInStakes.value, rtp: uncappedRtp.value, deviationFromTarget, capLossUpperInStakes, cappedRtpBound })) }));
