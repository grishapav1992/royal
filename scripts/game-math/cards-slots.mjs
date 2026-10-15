// Research models only. No game, wallet, or production code imports this module.
import assert from 'node:assert/strict';
import { q, add, sub, mul, div, cmp, sum, number, view, equal, distributionStats, target } from './rational.mjs';

const CARD_WEIGHTS = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4];
const CARD_VALUES = Array.from({ length: 10 }, (_, index) => index + 1);
const CARD_PROBABILITIES = CARD_VALUES.map(value => q(CARD_WEIGHTS[value], 13));
const NATURAL_PROBABILITY = q(8, 169);
const DEALER_LABELS = ['17', '18', '19', '20', '21', 'bust'];
const emptyDistribution = () => Object.fromEntries(DEALER_LABELS.map(label => [label, q(0)]));

function seedRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleSummary(n, total, squares, expected, seed) {
  const mean = total / n;
  const variance = Math.max(0, (squares - n * mean * mean) / (n - 1));
  const standardError = Math.sqrt(variance / n);
  const z = standardError > 0 ? (mean - expected) / standardError : 0;
  assert.ok(Math.abs(z) < 4.5, `Simulation disagreement: z=${z}`);
  return {
    seed, samples: n, approximateRtp: mean, sampleVariance: variance, standardError,
    approximate95PercentInterval: [mean - 1.96 * standardError, mean + 1.96 * standardError],
    expectedRtp: expected, standardErrorsFromExpectation: z,
    interpretation: 'Approximate sampling interval for this restricted model. It is not certification of RNG or a commercial game.',
  };
}

function addCard(state, value) {
  return { hard: state.hard + value, ace: state.ace || value === 1 };
}
function score(state) {
  const soft = state.ace && state.hard + 10 <= 21;
  return { total: state.hard + (soft ? 10 : 0), soft };
}
function natural(first, second) {
  return first === 1 && second === 10 || first === 10 && second === 1;
}
function naturalGivenUpcard(upcard) {
  return upcard === 1 ? q(4, 13) : upcard === 10 ? q(1, 13) : q(0);
}

function blackjackModel(hitSoft17) {
  const dealerMemo = new Map();
  function finishDealer(state) {
    const key = `${state.hard}:${Number(state.ace)}`;
    if (dealerMemo.has(key)) return dealerMemo.get(key);
    const result = emptyDistribution();
    const { total, soft } = score(state);
    if (total > 21 || total > 17 || total === 17 && (!soft || !hitSoft17)) {
      result[total > 21 ? 'bust' : String(total)] = q(1);
    } else {
      CARD_VALUES.forEach((value, index) => {
        const child = finishDealer(addCard(state, value));
        DEALER_LABELS.forEach(label => { result[label] = add(result[label], mul(CARD_PROBABILITIES[index], child[label])); });
      });
    }
    equal(sum(Object.values(result)), q(1), 'Dealer state probability mass');
    dealerMemo.set(key, result);
    return result;
  }
  const dealers = new Map();
  CARD_VALUES.forEach(upcard => {
    const allowedHoles = CARD_VALUES.filter(hole => !natural(upcard, hole));
    const denominator = allowedHoles.reduce((total, hole) => total + CARD_WEIGHTS[hole], 0);
    const distribution = emptyDistribution();
    allowedHoles.forEach(hole => {
      const weight = q(CARD_WEIGHTS[hole], denominator);
      const child = finishDealer(addCard(addCard({ hard: 0, ace: false }, upcard), hole));
      DEALER_LABELS.forEach(label => { distribution[label] = add(distribution[label], mul(weight, child[label])); });
    });
    equal(sum(Object.values(distribution)), q(1), `Dealer distribution for upcard ${upcard}`);
    dealers.set(upcard, distribution);
  });

  const playerMemo = new Map();
  function optimalPlayer(state, upcard) {
    const key = `${state.hard}:${Number(state.ace)}:${upcard}`;
    if (playerMemo.has(key)) return playerMemo.get(key);
    const { total } = score(state);
    if (total > 21) return { expectedReturn: 0, action: 'bust', stand: 0, hit: 0 };
    const dealer = dealers.get(upcard);
    let stand = 2 * number(dealer.bust);
    for (let dealerTotal = 17; dealerTotal <= 21; dealerTotal++) {
      stand += number(dealer[String(dealerTotal)]) * (total > dealerTotal ? 2 : total === dealerTotal ? 1 : 0);
    }
    const hit = total === 21 ? 0 : CARD_VALUES.reduce((value, card, index) =>
      value + number(CARD_PROBABILITIES[index]) * optimalPlayer(addCard(state, card), upcard).expectedReturn, 0);
    const action = total === 21 || stand >= hit - 1e-14 ? 'stand' : 'hit';
    const result = { expectedReturn: action === 'stand' ? stand : hit, action, stand, hit };
    playerMemo.set(key, result);
    return result;
  }

  function expectedReturn(naturalBonus) {
    let mean = 0;
    CARD_VALUES.forEach((first, firstIndex) => CARD_VALUES.forEach((second, secondIndex) => CARD_VALUES.forEach((upcard, upIndex) => {
      const weight = number(mul(mul(CARD_PROBABILITIES[firstIndex], CARD_PROBABILITIES[secondIndex]), CARD_PROBABILITIES[upIndex]));
      const dealerNatural = number(naturalGivenUpcard(upcard));
      const value = natural(first, second)
        ? dealerNatural + (1 - dealerNatural) * (1 + naturalBonus)
        : (1 - dealerNatural) * optimalPlayer(addCard(addCard({ hard: 0, ace: false }, first), second), upcard).expectedReturn;
      mean += weight * value;
    })));
    return mean;
  }

  return { dealers, finishDealer, optimalPlayer, expectedReturn };
}

function simulateBlackjack(model, hitSoft17, naturalBonus, samples, seed) {
  const random = seedRandom(seed);
  const draw = () => { const rank = Math.floor(random() * 13) + 1; return rank > 9 ? 10 : rank; };
  let total = 0, squares = 0, naturals = 0;
  for (let round = 0; round < samples; round++) {
    const first = draw(), upcard = draw(), second = draw(), hole = draw();
    const playerNatural = natural(first, second), dealerNatural = natural(upcard, hole);
    if (playerNatural) naturals++;
    let payout;
    if (dealerNatural) payout = playerNatural ? 1 : 0;
    else if (playerNatural) payout = 1 + naturalBonus;
    else {
      let player = addCard(addCard({ hard: 0, ace: false }, first), second);
      while (score(player).total < 21 && model.optimalPlayer(player, upcard).action === 'hit') player = addCard(player, draw());
      if (score(player).total > 21) payout = 0;
      else {
        let dealer = addCard(addCard({ hard: 0, ace: false }, upcard), hole);
        while (true) {
          const { total: dealerTotal, soft } = score(dealer);
          if (dealerTotal > 17 || dealerTotal === 17 && (!soft || !hitSoft17)) break;
          dealer = addCard(dealer, draw());
        }
        const playerTotal = score(player).total, dealerTotal = score(dealer).total;
        payout = dealerTotal > 21 || playerTotal > dealerTotal ? 2 : playerTotal === dealerTotal ? 1 : 0;
      }
    }
    total += payout; squares += payout * payout;
  }
  const expectedNatural = number(NATURAL_PROBABILITY), naturalSe = Math.sqrt(expectedNatural * (1 - expectedNatural) / samples);
  assert.ok(Math.abs(naturals / samples - expectedNatural) < 4.5 * naturalSe, 'Simulated natural probability');
  return { ...sampleSummary(samples, total, squares, model.expectedReturn(naturalBonus), seed), naturalRate: naturals / samples };
}

function blackjackIteration() {
  equal(sum(CARD_PROBABILITIES), q(1), 'Card mass');
  const enumeratedNaturals = sum(CARD_VALUES.flatMap((first, i) => CARD_VALUES.map((second, j) =>
    natural(first, second) ? mul(CARD_PROBABILITIES[i], CARD_PROBABILITIES[j]) : q(0))));
  equal(enumeratedNaturals, NATURAL_PROBABILITY, 'Initial natural probability');
  assert.deepEqual(score(addCard(addCard({ hard: 0, ace: false }, 1), 6)), { total: 17, soft: true });
  assert.deepEqual(score(addCard(addCard(addCard({ hard: 0, ace: false }, 1), 6), 10)), { total: 17, soft: false });
  assert.deepEqual(score(addCard(addCard(addCard({ hard: 0, ace: false }, 1), 6), 1)), { total: 18, soft: true });
  assert.deepEqual(score({ hard: 22, ace: true }), { total: 22, soft: false });
  const s17 = blackjackModel(false), h17 = blackjackModel(true);
  assert.equal(number(s17.finishDealer({ hard: 7, ace: true })['17']), 1);
  assert.ok(number(h17.finishDealer({ hard: 7, ace: true })['17']) < 1);
  for (const model of [s17, h17]) {
    CARD_VALUES.forEach(upcard => {
      assert.equal(model.optimalPlayer({ hard: 17, ace: false }, upcard).action, 'stand');
      assert.equal(model.optimalPlayer({ hard: 21, ace: false }, upcard).action, 'stand');
      assert.ok(Math.abs(model.optimalPlayer({ hard: 21, ace: false }, upcard).expectedReturn - (2 - number(model.dealers.get(upcard)['21']))) < 1e-12);
    });
    assert.equal(model.optimalPlayer({ hard: 16, ace: false }, 10).action, 'hit');
    assert.equal(model.optimalPlayer({ hard: 12, ace: false }, 6).action, 'stand');
  }
  const naturalReduction = mul(q(3, 10), mul(NATURAL_PROBABILITY, sub(q(1), NATURAL_PROBABILITY)));
  const rules = [
    { dealer: 'S17', naturalPayout: '3:2', naturalBonus: 1.5, model: s17, hitSoft17: false, seed: 800301 },
    { dealer: 'H17', naturalPayout: '3:2', naturalBonus: 1.5, model: h17, hitSoft17: true, seed: 800302 },
    { dealer: 'S17', naturalPayout: '6:5', naturalBonus: 1.2, model: s17, hitSoft17: false, seed: 800305 },
    { dealer: 'H17', naturalPayout: '6:5', naturalBonus: 1.2, model: h17, hitSoft17: true, seed: 800306 },
  ].map(rule => {
    const expectedTotalReturn = rule.model.expectedReturn(rule.naturalBonus);
    return { dealer: rule.dealer, naturalPayout: rule.naturalPayout, expectedTotalReturn, houseEdge: 1 - expectedTotalReturn,
      simulation: simulateBlackjack(rule.model, rule.hitSoft17, rule.naturalBonus, 100000, rule.seed) };
  });
  assert.ok(Math.abs(rules[0].expectedTotalReturn - rules[2].expectedTotalReturn - number(naturalReduction)) < 1e-12);
  assert.ok(Math.abs(rules[1].expectedTotalReturn - rules[3].expectedTotalReturn - number(naturalReduction)) < 1e-12);
  assert.ok(rules[0].expectedTotalReturn > rules[1].expectedTotalReturn);
  const distributions = [s17, h17].flatMap((model, index) => CARD_VALUES.map(upcard => ({
    dealer: index ? 'H17' : 'S17', upcard: upcard === 1 ? 'A' : String(upcard),
    dealerNaturalBeforePeek: view(naturalGivenUpcard(upcard)),
    conditionedOnNoNatural: Object.fromEntries(Object.entries(model.dealers.get(upcard)).map(([key, value]) => [key, view(value)])),
    probabilityMass: view(sum(Object.values(model.dealers.get(upcard)))),
  })));
  return {
    id: 8, title: 'Blackjack: explicit rules and optimal restricted strategy',
    question: 'How do S17/H17 and 3:2/6:5 natural payouts change expected return when only hit and stand are permitted?',
    model: {
      shoe: 'Infinite independent cards with replacement; A and 2..9 each 1/13, ten-valued cards 4/13',
      peek: 'US hole-card model. Dealer natural is checked before player actions; player natural pushes against dealer natural. Remaining dealer distribution conditions on no natural.',
      player: 'One hand, optimal hit/stand only. No double, split, surrender, insurance, or extra-card bonus.',
      payout: 'Total return: loss 0, push 1, ordinary win 2, natural 2.5 or 2.2.',
      method: 'Exact rational dealer probabilities, finite dynamic programming in double precision for optimal hit/stand return, independent seeded deal simulation.',
    },
    results: { rules, naturalProbability: view(NATURAL_PROBABILITY), bothNaturals: view(mul(NATURAL_PROBABILITY, NATURAL_PROBABILITY)),
      naturalPayoutReduction: view(naturalReduction), dealerDistributions: distributions },
    checks: [
      { name: 'Card probabilities and all dealer continuation states have exact mass one', passed: true },
      { name: 'Every upcard distribution under S17 and H17 has exact mass one', count: 20, passed: true },
      { name: 'Initial natural enumeration agrees with 8/169', passed: true },
      { name: 'Hard and soft ace transitions, S17/H17 terminal rules, and hand strategy sanity', passed: true },
      { name: '3:2 to 6:5 difference agrees with independent natural-event formula', passed: true },
      { name: 'Four independent seeded simulations, return and natural rate within 4.5 standard errors', count: 4, passed: true },
    ],
    findings: [
      'House edge is a consequence of the specified rules and allowed strategy, not a universal property of Blackjack.',
      'Changing natural payout affects both dealer rules by exactly 0.3 * P(player natural and no dealer natural).',
      'The reported returns belong to this deliberately restricted model. Excluding double and split prevents comparison with complete commercial Blackjack RTP.',
    ],
    next: 'Specify deck count, S17/H17, peek, double, split, surrender, and natural payout before implementing a persistent Blackjack state machine and calculating full-game strategy.',
    limitations: ['Infinite shoe has no finite-deck card-removal effects.', 'Optimal actions include only hit and stand.', 'Simulation intervals are approximate and do not certify fairness.'],
  };
}

const SLOT_TICKETS = { zero: 70, stakeReturn: 20, top: 5, bonus: 5 };
const FREE_SPINS = 5;
const P_BONUS = q(1, 20), CHILD_MEAN = q(1, 4);
function slotDirectMean(top) { return add(q(1, 5), mul(q(1, 20), top)); }
function slotDirectSecond(top) { return add(q(1, 5), mul(q(1, 20), mul(top, top))); }

function convolutionHistogram(spins, topCents) {
  let histogram = new Map([[0, 1n]]);
  for (let spin = 0; spin < spins; spin++) {
    const next = new Map();
    for (const [payout, count] of histogram) for (const [extra, weight] of [[0, 75n], [100, 20n], [topCents, 5n]]) {
      next.set(payout + extra, (next.get(payout + extra) ?? 0n) + count * weight);
    }
    histogram = next;
  }
  return histogram;
}
function enumerateBonusHistogram(spins, topCents) {
  const histogram = new Map();
  let leaves = 0;
  function visit(left, payout, count) {
    if (!left) { leaves++; histogram.set(payout, (histogram.get(payout) ?? 0n) + count); return; }
    for (const [extra, weight] of [[0, 75n], [100, 20n], [topCents, 5n]]) visit(left - 1, payout + extra, count * weight);
  }
  visit(spins, 0, 1n);
  return { histogram, leaves };
}
function finiteSlotDistribution(topCents) {
  const bonusHistogram = convolutionHistogram(FREE_SPINS, topCents);
  const rows = new Map([[0, q(70, 100)], [100, q(20, 100)], [topCents, q(5, 100)]]);
  for (const [payout, count] of bonusHistogram) rows.set(payout, add(rows.get(payout) ?? q(0), mul(P_BONUS, q(count, 100n ** BigInt(FREE_SPINS)))));
  return { rows: [...rows].sort((a, b) => a[0] - b[0]).map(([payout, p]) => ({ p, m: q(payout, 100) })), bonusHistogram };
}

function branchingMoments(top) {
  const direct = slotDirectMean(top), directSecond = slotDirectSecond(top);
  const mean = div(direct, sub(q(1), CHILD_MEAN));
  const second = div(add(directSecond, mul(mul(P_BONUS, q(FREE_SPINS * (FREE_SPINS - 1))), mul(mean, mean))), sub(q(1), CHILD_MEAN));
  return { mean, second, variance: sub(second, mul(mean, mean)) };
}

function cappedExpectedSpins(maxTotalSpins) {
  const memo = new Map();
  function visit(queue, issued) {
    if (!queue) return q(0);
    const key = `${queue}:${issued}`;
    if (memo.has(key)) return memo.get(key);
    const awarded = Math.min(FREE_SPINS, maxTotalSpins - issued);
    const result = add(q(1), add(mul(q(19, 20), visit(queue - 1, issued)), mul(P_BONUS, visit(queue - 1 + awarded, issued + awarded))));
    memo.set(key, result); return result;
  }
  return visit(1, 1);
}
function cappedMoments(top, maxTotalSpins) {
  const memo = new Map();
  function visit(queue, issued) {
    if (!queue) return { mean: q(0), second: q(0), maximum: q(0) };
    const key = `${queue}:${issued}`;
    if (memo.has(key)) return memo.get(key);
    const awarded = Math.min(FREE_SPINS, maxTotalSpins - issued);
    const normal = visit(queue - 1, issued), trigger = visit(queue - 1 + awarded, issued + awarded);
    const mean = add(slotDirectMean(top), add(mul(q(19, 20), normal.mean), mul(P_BONUS, trigger.mean)));
    const second = add(add(slotDirectSecond(top), mul(mul(q(2), slotDirectMean(top)), normal.mean)),
      add(mul(q(19, 20), normal.second), mul(P_BONUS, trigger.second)));
    const paidMaximum = add(top, normal.maximum);
    const maximum = cmp(paidMaximum, trigger.maximum) >= 0 ? paidMaximum : trigger.maximum;
    const result = { mean, second, maximum }; memo.set(key, result); return result;
  }
  const root = visit(1, 1), bonus = visit(FREE_SPINS, 1 + FREE_SPINS);
  return { ...root, variance: sub(root.second, mul(root.mean, root.mean)), bonus };
}

function simulateSlot(topFraction, samples, seed, retrigger, maxTotalSpins = Infinity) {
  const top = number(topFraction);
  const random = seedRandom(seed);
  let total = 0, squares = 0, bonuses = 0, totalSpins = 0, maximumObserved = 0;
  for (let round = 0; round < samples; round++) {
    let queue = 1, issued = 1, paid = 0, isPaidSpin = true;
    while (queue > 0) {
      queue--; totalSpins++;
      const ticket = Math.floor(random() * 100);
      if (ticket >= 70 && ticket < 90) paid += 1;
      else if (ticket >= 90 && ticket < 95) paid += top;
      else if (ticket >= 95 && (isPaidSpin || retrigger)) {
        if (isPaidSpin) bonuses++;
        const extra = Math.min(FREE_SPINS, maxTotalSpins - issued);
        queue += extra; issued += extra;
      }
      isPaidSpin = false;
    }
    total += paid; squares += paid * paid; maximumObserved = Math.max(maximumObserved, paid);
  }
  const expected = retrigger
    ? Number.isFinite(maxTotalSpins) ? number(cappedMoments(topFraction, maxTotalSpins).mean) : number(branchingMoments(topFraction).mean)
    : number(mul(slotDirectMean(topFraction), add(q(1), mul(q(FREE_SPINS), P_BONUS))));
  return { ...sampleSummary(samples, total, squares, expected, seed), bonusRate: bonuses / samples,
    meanSpinCount: totalSpins / samples, maximumObserved };
}

function slotIteration() {
  const finiteTop = q(288, 25); // 11.52, derived for this original study table.
  const finite = finiteSlotDistribution(1152);
  const enumeration = enumerateBonusHistogram(FREE_SPINS, 1152);
  assert.equal(enumeration.leaves, 3 ** FREE_SPINS);
  assert.deepEqual([...finite.bonusHistogram].sort((a, b) => a[0] - b[0]), [...enumeration.histogram].sort((a, b) => a[0] - b[0]));
  equal(sum([...finite.bonusHistogram.values()].map(count => q(count, 100n ** BigInt(FREE_SPINS)))), q(1), 'Bonus histogram mass');
  const finiteStats = distributionStats(finite.rows);
  equal(q(finiteStats.rtp.fraction.split('/')[0], finiteStats.rtp.fraction.split('/')[1]), target, 'Finite slot RTP');
  const direct = slotDirectMean(finiteTop), directSecond = slotDirectSecond(finiteTop);
  const bonusMean = mul(q(FREE_SPINS), direct);
  const bonusVariance = mul(q(FREE_SPINS), sub(directSecond, mul(direct, direct)));
  const paidMean = add(direct, mul(P_BONUS, bonusMean));
  const paidSecond = add(directSecond, mul(P_BONUS, add(bonusVariance, mul(bonusMean, bonusMean))));
  equal(paidMean, target, 'Closed-form finite slot mean');
  const exactStatsVariance = q(finiteStats.variance.fraction.split('/')[0], finiteStats.variance.fraction.split('/')[1]);
  equal(sub(paidSecond, mul(paidMean, paidMean)), exactStatsVariance, 'Enumerated and closed-form variance');
  equal(q(finiteStats.maxMultiplier.fraction.split('/')[0], finiteStats.maxMultiplier.fraction.split('/')[1]), q(288, 5), 'Finite slot maximum');
  const uncalibratedBranch = branchingMoments(finiteTop);
  equal(uncalibratedBranch.mean, q(388, 375), 'Enabling retriggers changes the expected return');
  const branchTop = q(211, 20); // 10.55 after calibration for unlimited retriggers.
  const branch = branchingMoments(branchTop);
  equal(branch.mean, target, 'Subcritical branching RTP');
  assert.ok(number(CHILD_MEAN) < 1);
  const maxTotalSpins = 26;
  const cappedSpins = cappedExpectedSpins(maxTotalSpins);
  const cappedUncalibrated = cappedMoments(branchTop, maxTotalSpins);
  equal(cappedUncalibrated.mean, mul(slotDirectMean(branchTop), cappedSpins), 'Independent capped spin-count expectation');
  assert.ok(number(cappedUncalibrated.mean) < number(target));
  const cappedTop = div(sub(div(target, cappedSpins), q(1, 5)), q(1, 20));
  const capped = cappedMoments(cappedTop, maxTotalSpins);
  equal(capped.mean, target, 'Capped and recalibrated slot RTP');
  equal(capped.maximum, mul(q(21), cappedTop), 'Cap bounds maximum paying leaves');
  const finiteSimulation = simulateSlot(finiteTop, 2000000, 900971, false);
  const branchSimulation = simulateSlot(branchTop, 2000000, 900972, true);
  const capSimulation = simulateSlot(cappedTop, 2000000, 900973, true, maxTotalSpins);
  assert.ok(capSimulation.maximumObserved <= number(capped.maximum) + 1e-9);
  return {
    id: 9, title: 'Original slot: free-spin expectation, variance, retriggers, and payout caps',
    question: 'Can an original base-plus-bonus slot reach exact 97% RTP, and what changes when free spins retrigger or are capped?',
    model: {
      ownership: 'Original explicit probability model for research; it is not a copy of provider reel strips or a visual-slot implementation.',
      paidSpinTickets: SLOT_TICKETS,
      baseline: '100 equally likely tickets. 70 pay 0, 20 return 1 stake, 5 pay 11.52 stakes, 5 award 5 free spins and pay no immediate amount.',
      freeSpins: 'Baseline free spins use 75 zero tickets, 20 stake-return tickets, 5 top-payout tickets; no retrigger. Stakes are not charged on free spins.',
      payouts: 'Every payout includes the returned stake where applicable and is measured per original paid stake. No rounding is applied in these ideal mathematical tables.',
      retrigger: 'Experimental alternative: each bonus ticket awards 5 children, including during free spins. Mean child count is 0.25, so the process is subcritical.',
      cappedAlternative: 'At most 25 free spins may be granted per paid round. Retriggers award min(5, remaining grant allowance). All granted spins are executed. Cap includes one paid spin plus at most 25 free spins.',
    },
    results: {
      finiteBaseline: { topPayout: view(finiteTop), stats: finiteStats, bonusProbability: view(P_BONUS),
        immediateReturn: view(direct), expectedBonusReturnConditionalOnTrigger: view(bonusMean), bonusVarianceConditionalOnTrigger: view(bonusVariance),
        bonusContributionToPaidRtp: view(mul(P_BONUS, bonusMean)), exactHistogram: finite.rows.map(row => ({ probability: view(row.p), payout: view(row.m) })),
        enumeratedSequences: enumeration.leaves, simulation: finiteSimulation },
      sameTableWithUncappedRetriggers: { rtp: view(uncalibratedBranch.mean), houseEdge: view(sub(q(1), uncalibratedBranch.mean)), maximum: 'unbounded' },
      recalibratedUncappedRetriggers: { topPayout: view(branchTop), rtp: view(branch.mean), variance: view(branch.variance),
        meanSpinCount: view(div(q(1), sub(q(1), CHILD_MEAN))), expectedBonusReturnConditionalOnTrigger: view(mul(q(FREE_SPINS), branch.mean)),
        bonusVarianceConditionalOnTrigger: view(mul(q(FREE_SPINS), branch.variance)), maximum: 'unbounded', simulation: branchSimulation },
      cappedRetriggers: { maxTotalSpins, maxFreeSpins: maxTotalSpins - 1, meanSpinCount: view(cappedSpins),
        rtpBeforeRecalibration: view(cappedUncalibrated.mean), topPayoutAfterRecalibration: view(cappedTop),
        rtpAfterRecalibration: view(capped.mean), variance: view(capped.variance), maximum: view(capped.maximum),
        topTableRoundedToTwoDecimals: [q(264, 25), q(1057, 100)].map(top => ({ topPayout: view(top), rtp: view(mul(slotDirectMean(top), cappedSpins)) })),
        expectedBonusReturnConditionalOnTrigger: view(capped.bonus.mean), simulation: capSimulation },
    },
    checks: [
      { name: 'Independent 3^5 bonus sequence enumeration equals histogram convolution', count: enumeration.leaves, passed: true },
      { name: 'Finite baseline probability mass one, exact 97/100 mean, exact variance, and maximum 57.6', passed: true },
      { name: 'Subcritical branching moment formulas and calibrated exact 97/100 mean', passed: true },
      { name: 'Capped mean agrees with independent expected spin-count DP', passed: true },
      { name: 'Capped payout recalibration is exact and finite maximum equals 21 top-paying leaves', passed: true },
      { name: 'Three independent seeded simulations within 4.5 standard errors', count: 3, passed: true },
    ],
    findings: [
      'The original finite table reaches 97% exactly: 77.6% immediate return plus 19.4% expected free-spin return.',
      'Enabling unlimited retriggers without changing this table raises return to 103.4666666667%, producing negative expected house edge.',
      'Recalibrating top payout to 10.55 restores 97% with unlimited retriggers; finite moments do not imply a finite maximum payout.',
      'A total free-spin grant cap creates a finite payout obligation but reduces expected return. The capped table must be recalibrated separately.',
    ],
    next: 'Choose a finite bonus policy and maximum payout before implementing server RNG, persistent bonus state, rounding, and a house reservation. Recompute exact RTP after every cap or payout-table change.',
    limitations: ['This ticket model is an original probability study, not a reel-strip or paylines model.', 'Exact results assume rational payouts without wallet rounding. The recalibrated capped top payout has a long rational denominator, so a fixed-decimal payout table needs separate recalculation.', 'Uncapped retriggers cannot be covered by a finite maximum-payout reserve.', 'Simulation intervals are approximate and do not certify fairness.'],
  };
}

export function runCardsSlots() {
  return { iterations: [blackjackIteration(), slotIteration()] };
}
