import assert from 'node:assert/strict';
import {
  q, decimal, add, sub, mul, div, cmp, sum, equal, choose, view,
  floorPayout, distributionStats, target,
} from './rational.mjs';

const zero = q(0);
const one = q(1);
const roundingStakes = [1, 10, 100, 1000, 1000000];

function popcount(value) {
  let count = 0;
  while (value) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

function maximum(values) {
  return values.reduce((best, value) => cmp(value, best) > 0 ? value : best, zero);
}

function roundedMean(rows, stake) {
  return sum(rows.map(row => mul(row.p, q(floorPayout(stake, row.m), BigInt(stake)))));
}

function roundingStudy(rows) {
  const ideal = sum(rows.map(row => mul(row.p, row.m)));
  return roundingStakes.map(stake => {
    const actual = roundedMean(rows, stake);
    assert.ok(cmp(actual, ideal) <= 0, 'Flooring cannot increase mean payout');
    assert.ok(cmp(actual, sub(ideal, q(1, stake))) > 0, 'Flooring loss is less than one unit per stake');
    return {
      stakeMinimalUnits: stake,
      stats: distributionStats(rows, stake),
      rtpLostToFlooring: view(sub(ideal, actual)),
    };
  });
}

function runPlinko() {
  const boardStudies = [];
  let enumeratedPaths = 0;
  let independentlyComparedProbabilities = 0;
  for (let n = 8; n <= 16; n++) {
    const totalPaths = 2 ** n;
    const counts = Array(n + 1).fill(0);
    for (let path = 0; path < totalPaths; path++) counts[popcount(path)]++;
    enumeratedPaths += totalPaths;
    const probabilities = counts.map((count, j) => {
      assert.equal(BigInt(count), choose(n, j), 'Enumerated paths agree with binomial coefficient');
      independentlyComparedProbabilities++;
      return q(count, totalPaths);
    });
    equal(sum(probabilities), one, 'Plinko total mass');
    equal(sum(probabilities.map((p, j) => mul(p, q(j)))), q(n, 2), 'Expected number of right turns');
    for (let j = 0; j <= n; j++) equal(probabilities[j], probabilities[n - j], 'Plinko symmetry');
    boardStudies.push({
      rows: n,
      enumeratedPaths: totalPaths,
      coefficients: counts,
      probabilities: probabilities.map(view),
      totalMass: view(sum(probabilities)),
      expectedRightTurns: view(q(n, 2)),
      extremeBucketProbability: view(probabilities[0]),
      bothExtremeBucketsProbability: view(add(probabilities[0], probabilities[n])),
    });
  }

  const samples = [
    { name: 'low', values: ['7.56', '1.8', '1.1', '0.9', '0.6', '0.9', '1.1', '1.8', '7.56'] },
    { name: 'medium', values: ['31.56', '3', '1.2', '0.5', '0.2', '0.5', '1.2', '3', '31.56'] },
    { name: 'high', values: ['94.56', '3', '0.2', '0', '0', '0', '0.2', '3', '94.56'] },
  ];
  const paytables = samples.map(sample => {
    const rows = sample.values.map((value, j) => ({ p: q(choose(8, j), 256), m: decimal(value) }));
    const mean = sum(rows.map(row => mul(row.p, row.m)));
    equal(mean, target, 'Own Plinko sample RTP');
    equal(sum(rows.map((row, j) => mul(q(choose(8, j)), row.m))), q(24832, 100), 'Weighted payout numerator');
    rows.forEach((row, j) => equal(row.m, rows[8 - j].m, 'Symmetric Plinko sample'));
    const rounding = roundingStudy(rows);
    rounding.filter(row => row.stakeMinimalUnits >= 100).forEach(row => {
      equal(roundedMean(rows, row.stakeMinimalUnits), target, 'Two-decimal payouts exact at multiples of 100 units');
      assert.equal(row.rtpLostToFlooring.fraction, '0/1');
    });
    return {
      name: sample.name,
      rows: 8,
      multipliers: sample.values,
      stats: distributionStats(rows),
      weightedPayoutSum: view(q(24832, 100)),
      bucketTable: rows.map((row, j) => ({ bucket: j, paths: Number(choose(8, j)), probability: view(row.p), multiplier: view(row.m) })),
      rounding,
    };
  });
  assert.ok(paytables[0].stats.variance.value < paytables[1].stats.variance.value);
  assert.ok(paytables[1].stats.variance.value < paytables[2].stats.variance.value);
  assert.equal(paytables[1].rounding[0].stats.rtp.fraction, '83/128');
  return {
    id: 4,
    game: 'Plinko',
    question: 'Can original paytables have the same exact RTP while differing in variance, and what do row count and settlement rounding change?',
    findings: [
      'Three original eight-row tables each have exact RTP 97%, with strictly increasing variance from low to medium to high.',
      'The distribution is binomial only when every left/right step is independent and unbiased. Eight through sixteen rows were verified by enumerating every binary path.',
      'At one minimal unit, the medium sample returns 83/128 = 64.84375%, because floor settlement removes fractional payouts. All three two-decimal tables recover exact 97% at stakes divisible by 100 minimal units.',
      'Positive payout and profit are separate probabilities; an x0.2 payout is positive but loses 80% of the stake.',
    ],
    checks: [
      { name: 'Independent path enumeration versus binomial formula', method: 'Enumerate binary masks and count set bits without using binomial coefficients', cases: independentlyComparedProbabilities, enumeratedOutcomes: enumeratedPaths, passed: true },
      { name: 'Mass, mean and symmetry for row counts 8 through 16', cases: 9, passed: true },
      { name: 'Original paytable exact 97% weighted mean and symmetry', cases: 3, evidence: 'Each weighted sum is 248.32 over 256 paths', passed: true },
      { name: 'Variance ordering low < medium < high', cases: 2, passed: true },
      { name: 'Floor payout bound and realized statistics', cases: 15, stakesMinimalUnits: roundingStakes, passed: true },
      { name: 'No floor loss at 100, 1000 and 1000000 units', cases: 9, passed: true },
      { name: 'Independent expected one-unit medium RTP', cases: 1, evidence: '83/128', passed: true },
    ],
    tables: { boardStudies, paytables },
    limitations: [
      'Only eight-row sample paytables were designed. Other row counts have verified distributions but need their own calibrated paytables.',
      'Visual physics must render the previously determined random path or bucket consistently. Unmeasured collision physics cannot be assumed to produce this distribution.',
      'These are research examples, not selected production economics. Stake limits, balance precision and randomness implementation remain separate decisions.',
    ],
  };
}

function minesProbability(n, mines, safePicks) {
  return q(choose(n - mines, safePicks), choose(n, safePicks));
}

function mineLayouts(n, mines) {
  const layouts = [];
  for (let mask = 0; mask < 2 ** n; mask++) if (popcount(mask) === mines) layouts.push(mask);
  return layouts;
}

function optimalMinesByLayouts(n, mines, stake) {
  const layouts = mineLayouts(n, mines);
  const memo = new Map();
  let candidateActions = 0;
  let nonNeutralContinuationComparisons = 0;
  function visit(safeMask) {
    if (memo.has(safeMask)) return memo.get(safeMask);
    const k = popcount(safeMask);
    const possible = layouts.filter(layout => (layout & safeMask) === 0);
    assert.ok(possible.length > 0);
    const multiplier = div(target, minesProbability(n, mines, k));
    const cashout = k === 0 ? zero : stake === undefined ? multiplier : q(floorPayout(stake, multiplier), BigInt(stake));
    let best = cashout;
    if (k < n - mines) {
      for (let cell = 0; cell < n; cell++) {
        const bit = 1 << cell;
        if (safeMask & bit) continue;
        candidateActions++;
        const surviving = possible.filter(layout => (layout & bit) === 0).length;
        const continuation = surviving ? mul(q(surviving, possible.length), visit(safeMask | bit)) : zero;
        if (stake === undefined) equal(continuation, k === 0 ? target : cashout, 'Ideal cashout equals conditional continuation');
        else if (k > 0 && cmp(continuation, cashout) !== 0) nonNeutralContinuationComparisons++;
        if (cmp(continuation, best) > 0) best = continuation;
      }
    }
    memo.set(safeMask, best);
    return best;
  }
  const expectedPayout = visit(0);
  const fixedStageReturns = [];
  for (let k = 1; k <= n - mines; k++) {
    const probability = minesProbability(n, mines, k);
    const multiplier = div(target, probability);
    const payout = stake === undefined ? multiplier : q(floorPayout(stake, multiplier), BigInt(stake));
    fixedStageReturns.push(mul(probability, payout));
  }
  equal(expectedPayout, maximum(fixedStageReturns), 'Adaptive optimum agrees with independently computed best fixed stage');
  assert.ok(cmp(expectedPayout, target) <= 0, 'Floor policy cannot exceed ideal RTP');
  return {
    n, mines,
    stakeMinimalUnits: stake ?? 'unrounded',
    expectedPayout: view(expectedPayout),
    fixedStageReturns: fixedStageReturns.map((rtp, index) => ({ safePicks: index + 1, rtp: view(rtp) })),
    memoizedPosteriorStates: memo.size,
    candidateActions,
    nonNeutralContinuationComparisons,
  };
}

function runMines() {
  const states = [];
  const fullClear = [];
  let adjacentContinuationChecks = 0;
  for (let mines = 1; mines <= 24; mines++) {
    let sequentialProbability = one;
    for (let k = 1; k <= 25 - mines; k++) {
      sequentialProbability = mul(sequentialProbability, q(25 - mines - (k - 1), 25 - (k - 1)));
      const probability = minesProbability(25, mines, k);
      equal(probability, sequentialProbability, 'Combination probability equals sequential conditional product');
      const multiplier = div(target, probability);
      equal(mul(probability, multiplier), target, 'Mines fixed-stage RTP');
      if (k < 25 - mines) {
        const nextProbability = minesProbability(25, mines, k + 1);
        const nextMultiplier = div(target, nextProbability);
        equal(mul(q(25 - mines - k, 25 - k), nextMultiplier), multiplier, 'Mines conditional cashout neutrality');
        adjacentContinuationChecks++;
      }
      states.push({ mines, safePicks: k, probability, multiplier });
    }
    const probability = minesProbability(25, mines, 25 - mines);
    equal(probability, q(1, choose(25, mines)), 'Full-clear probability');
    fullClear.push({ mines, safePicks: 25 - mines, probability: view(probability), multiplier: view(div(target, probability)) });
  }
  for (let mines = 1; mines <= 24; mines++) equal(q(choose(25, mines)), q(choose(25, 25 - mines)), 'Full-clear coefficient symmetry');
  assert.equal(fullClear[11].multiplier.fraction, '5044291/1');
  assert.equal(fullClear[12].multiplier.fraction, '5044291/1');
  equal(maximum(Array.from({ length: 24 }, (_, index) => mul(target, q(choose(25, index + 1))))), q(5044291), 'Global maximum full-clear multiplier');

  let layoutCount = 0;
  let smallBoardCases = 0;
  const smallBoards = [];
  for (let n = 4; n <= 9; n++) {
    for (let mines = 1; mines < n; mines++) {
      const layouts = mineLayouts(n, mines);
      layoutCount += layouts.length;
      assert.equal(BigInt(layouts.length), choose(n, mines));
      for (let k = 1; k <= n - mines; k++) {
        const selectedMask = (1 << k) - 1;
        const survivors = layouts.filter(layout => (layout & selectedMask) === 0).length;
        const enumerated = q(survivors, layouts.length);
        equal(enumerated, minesProbability(n, mines, k), 'Independent layout enumeration probability');
        smallBoardCases++;
        smallBoards.push({ n, mines, safePicks: k, layouts: layouts.length, survivingLayouts: survivors, probability: view(enumerated) });
      }
    }
  }

  const boundedStageCaps = [];
  let retainedStageChecks = 0;
  for (const cap of [10, 100, 1000]) {
    for (let mines = 1; mines <= 24; mines++) {
      const matching = states.filter(state => state.mines === mines);
      const allowed = matching.filter(state => cmp(state.multiplier, q(cap)) <= 0);
      for (const state of allowed) {
        equal(mul(state.probability, state.multiplier), target, 'Bounded-stage cap preserves RTP');
        retainedStageChecks++;
      }
      const next = matching[allowed.length];
      if (next) assert.ok(cmp(next.multiplier, q(cap)) > 0, 'Next stage exceeds configured cap');
      boundedStageCaps.push({ mines, maximumMultiplierCap: cap, maximumSafePicks: allowed.length, rejectModeIfNoLegalFirstPick: allowed.length === 0 });
    }
  }
  const clearFive = states.find(state => state.mines === 5 && state.safePicks === 20);
  const clippedRtp = mul(clearFive.probability, q(1000));
  equal(clippedRtp, q(1000, 53130), 'Clipped full-clear RTP');
  assert.ok(cmp(clippedRtp, target) < 0);

  const adaptive = [];
  for (let n = 6; n <= 8; n++) {
    for (let mines = 1; mines < n; mines++) {
      for (const stake of [undefined, 1, 10, 100]) {
        const result = optimalMinesByLayouts(n, mines, stake);
        if (stake === undefined) assert.equal(result.expectedPayout.fraction, '97/100');
        adaptive.push(result);
      }
    }
  }
  const nonNeutralComparisons = adaptive.reduce((count, row) => count + row.nonNeutralContinuationComparisons, 0);
  assert.ok(nonNeutralComparisons > 0, 'Flooring changes at least one continuation decision');
  const fiveMineStages = [1, 3, 5, 10, 15, 20].map(k => {
    const state = states.find(candidate => candidate.mines === 5 && candidate.safePicks === k);
    return {
      safePicks: k,
      probability: view(state.probability),
      multiplier: view(state.multiplier),
      fixedStageRtp: view(target),
      rounding: roundingStakes.map(stake => ({
        stakeMinimalUnits: stake,
        payoutMinimalUnits: floorPayout(stake, state.multiplier).toString(),
        fixedStageRtp: view(mul(state.probability, q(floorPayout(stake, state.multiplier), BigInt(stake)))),
      })),
    };
  });
  return {
    id: 5,
    game: 'Mines',
    question: 'Does the inverse-survival payout remain correct for every mine count and adaptive cashout, and how do payout caps and flooring change it?',
    findings: [
      'For all 300 valid (mine count, safe-pick count) states of a 25-cell board, P = C(25-m,k)/C(25,k) and M = 0.97/P give exact fixed-stage RTP 97%.',
      'Exact payouts are neutral between cashout and continuation after any safe pick. Independent posterior-layout recursion verifies this for adaptive selection and stopping on small boards.',
      'The maximum full-clear multiplier is x5044291 with 12 or 13 mines. Five mines allow x51536.1. Reserve and mode limits must cover every permitted future stage.',
      'Clipping the five-mine full-clear payout to x1000 reduces that strategy RTP to 1000/53130, approximately 1.882176%. Restricting permitted stages before the cap preserves the original formula.',
      'Floor settlement breaks cashout neutrality. Optimal adaptive expected payout matches the best fixed-stage expected payout in the enumerated uniform boards and remains no greater than 97%.',
      'The recursive active wager requires at least one opening. An unopened cancellation may refund the full stake; it should be excluded from played-wager turnover.',
    ],
    checks: [
      { name: 'Combination probability versus sequential conditional product and exact RTP', cases: states.length, passed: true },
      { name: 'Adjacent-stage conditional cashout neutrality', cases: adjacentContinuationChecks, passed: true },
      { name: 'Full-clear probabilities, reciprocal binomial multiplier and symmetry', cases: 24, passed: true },
      { name: 'Independent small-board layout enumeration', cases: smallBoardCases, enumeratedLayouts: layoutCount, boardSizes: [4, 5, 6, 7, 8, 9], passed: true },
      { name: 'Posterior-layout optimal adaptive stopping versus best fixed stage', cases: adaptive.length, posteriorStates: adaptive.reduce((count, row) => count + row.memoizedPosteriorStates, 0), candidateActions: adaptive.reduce((count, row) => count + row.candidateActions, 0), changedComparisonsWithFlooring: nonNeutralComparisons, passed: true },
      { name: 'Cap by rejecting inaccessible stages rather than clipping payouts', cases: boundedStageCaps.length, exactRtpRetainedStages: retainedStageChecks, passed: true },
      { name: 'Explicit counterexample to silently clipping payouts', cases: 1, evidence: view(clippedRtp), passed: true },
    ],
    tables: {
      allStates: states.map(state => ({ mines: state.mines, safePicks: state.safePicks, probability: view(state.probability), multiplier: view(state.multiplier), rtp: view(target) })),
      fiveMineStages,
      fullClear,
      boundedStageCaps,
      clippingExample: { mines: 5, safePicks: 20, originalMultiplier: view(clearFive.multiplier), cap: 1000, originalRtp: view(target), clippedRtp: view(clippedRtp) },
      smallBoardEnumeration: smallBoards,
      adaptiveStopping: adaptive,
    },
    limitations: [
      'The 25-cell formulas are verified exactly, but exhaustive adaptive trees are restricted to boards with six through eight cells to keep the research reproducible and bounded.',
      'Neutrality assumes uniform hidden layouts, no information leaks, and selection only among unopened cells. It does not justify client-controlled randomness or settlement.',
      'A maximum stage is a disclosed rule of the mode. Retroactively refusing a previously promised stage is not the studied cap policy.',
    ],
  };
}

function kenoProbability(n, drawn, selected, hits) {
  return q(choose(selected, hits) * choose(n - selected, drawn - hits), choose(n, drawn));
}

function runKeno() {
  const distributions = [];
  let probabilityChecks = 0;
  for (let selected = 1; selected <= 10; selected++) {
    const probabilities = Array.from({ length: selected + 1 }, (_, hits) => {
      const probability = kenoProbability(40, 20, selected, hits);
      const alternative = q(choose(20, hits) * choose(20, selected - hits), choose(40, selected));
      equal(probability, alternative, 'Drawing twenty versus selecting from fixed twenty');
      probabilityChecks++;
      return probability;
    });
    equal(sum(probabilities), one, 'Keno mass');
    equal(sum(probabilities.map((p, hits) => mul(p, q(hits)))), q(selected, 2), 'Keno expected matches');
    probabilities.forEach((p, hits) => equal(p, probabilities[selected - hits], 'Keno half-field symmetry'));
    distributions.push({
      fieldSize: 40,
      drawnNumbers: 20,
      selectedNumbers: selected,
      expectedHits: view(q(selected, 2)),
      allSelectedHitProbability: view(probabilities[selected]),
      hits: probabilities.map((p, hits) => ({ hits, probability: view(p) })),
    });
  }

  let enumeratedDrawSets = 0;
  let matchObservations = 0;
  let smallProbabilityChecks = 0;
  const smallBoards = [];
  for (const n of [6, 8, 10]) {
    const byDrawn = Array.from({ length: n + 1 }, () => []);
    for (let mask = 1; mask < (2 ** n) - 1; mask++) byDrawn[popcount(mask)].push(mask);
    for (let drawn = 1; drawn < n; drawn++) {
      const draws = byDrawn[drawn];
      enumeratedDrawSets += draws.length;
      for (let selected = 1; selected <= 5; selected++) {
        const selectedMask = (1 << selected) - 1;
        const counts = Array(selected + 1).fill(0);
        for (const mask of draws) {
          counts[popcount(mask & selectedMask)]++;
          matchObservations++;
        }
        const probabilities = counts.map((count, hits) => {
          const p = q(count, draws.length);
          equal(p, kenoProbability(n, drawn, selected, hits), 'Independent Keno subset enumeration');
          smallProbabilityChecks++;
          return p;
        });
        equal(sum(probabilities), one, 'Small Keno mass');
        equal(sum(probabilities.map((p, hits) => mul(p, q(hits)))), q(selected * drawn, n), 'Small Keno expected hits');
        smallBoards.push({ n, drawn, selected, drawSets: draws.length, hitCounts: counts, probabilities: probabilities.map(view) });
      }
    }
  }

  const selected = 3;
  const ownSamples = [
    { name: 'moderate', values: ['0', '0', '1.01', '5.04'] },
    { name: 'higher_variance', values: ['0', '0', '0.2', '7.74'] },
  ];
  const paytables = ownSamples.map(sample => {
    const rows = sample.values.map((value, hits) => ({ p: kenoProbability(40, 20, selected, hits), m: decimal(value) }));
    equal(sum(rows.map(row => mul(row.p, row.m))), target, 'Own Keno sample exact RTP');
    equal(add(mul(q(10), rows[2].m), mul(q(3), rows[3].m)), decimal('25.22'), 'Own three-number Keno payout equation');
    const rounding = roundingStudy(rows);
    rounding.filter(row => row.stakeMinimalUnits >= 100).forEach(row => assert.equal(row.rtpLostToFlooring.fraction, '0/1'));
    return {
      name: sample.name,
      fieldSize: 40,
      drawnNumbers: 20,
      selectedNumbers: selected,
      multipliersByHits: sample.values,
      stats: distributionStats(rows),
      payouts: rows.map((row, hits) => ({ hits, probability: view(row.p), multiplier: view(row.m) })),
      calibrationEquation: '10*M(2) + 3*M(3) = 25.22; divide by 26 for RTP 0.97',
      rounding,
    };
  });
  assert.ok(paytables[1].stats.variance.value > paytables[0].stats.variance.value);
  assert.ok(paytables[1].stats.profitProbability.value < paytables[0].stats.profitProbability.value);
  return {
    id: 6,
    game: 'Keno',
    question: 'How can a 40-number, 20-draw Keno mode be calibrated exactly for each selection count and its own risk table?',
    findings: [
      'For selections of one through ten numbers, the exact hypergeometric distribution sums to one and has expected matches s/2.',
      'RTP is the weighted sum of all payout bins. It cannot be inferred from expected hits or assigned independently to each winning bin.',
      'Two original three-number sample tables use the exact equation 10*M(2) + 3*M(3) = 25.22 and both return 97% before rounding.',
      'The higher-variance sample has a larger maximum payout and a lower profit probability while keeping the same RTP. Both have a 50% positive-payout probability.',
      'Every production pair of selection count and risk table needs its own calibration and rounding study. The supplied samples cover only three selected numbers.',
    ],
    checks: [
      { name: 'Equivalent draw-first and selection-first hypergeometric formulas', cases: probabilityChecks, passed: true },
      { name: 'Mass, expectation and half-field symmetry for selections 1 through 10', cases: 10, passed: true },
      { name: 'Independent small-field draw-subset enumeration', cases: smallProbabilityChecks, distributions: smallBoards.length, enumeratedDrawSets, matchObservations, fieldSizes: [6, 8, 10], passed: true },
      { name: 'Original three-number paytables exact 97% and calibration equation', cases: 2, passed: true },
      { name: 'Sample risk ordering by variance and profit probability', cases: 2, passed: true },
      { name: 'Floor settlement RTP bound at five stake sizes', cases: 10, stakesMinimalUnits: roundingStakes, passed: true },
      { name: 'Exact payout settlement at multiples of 100 units', cases: 6, passed: true },
    ],
    tables: { distributions, paytables, smallBoardEnumeration: smallBoards },
    limitations: [
      'Draws are distinct numbers sampled uniformly without replacement. Independent repeated draws would produce a different distribution.',
      'The study designs two original sample tables, not a complete set of production modes or a copy of another operator payout schedule.',
      'RNG uniformity, settlement transactions, and visual number reveal remain implementation requirements outside this mathematical module.',
    ],
  };
}

export function runCombinatorics() {
  return { iterations: [runPlinko(), runMines(), runKeno()] };
}
