import assert from 'node:assert/strict';
import {
  q, decimal, add, sub, mul, div, cmp, number, sum, view, equal,
  floorPayout, distributionStats, target,
} from './rational.mjs';

const ONE = q(1);
const HUNDRED = q(100);
const Q32 = 2n ** 32n;

function floorPositive(value) {
  assert.ok(value.n >= 0n);
  return value.n / value.d;
}

function cents(value) {
  return q(floorPositive(mul(value, HUNDRED)), 100);
}

function pow(value, exponent) {
  let result = ONE;
  for (let i = 0; i < exponent; i++) result = mul(result, value);
  return result;
}

export function crashOutcome(u, size = Q32, limit = q(1000)) {
  u = BigInt(u);
  size = BigInt(size);
  if (size <= 0n || u < 1n || u > size || cmp(limit, ONE) <= 0) {
    throw new RangeError('Invalid crash model parameters');
  }
  const raw = div(mul(target, q(size)), q(u));
  const instantLoss = cmp(raw, ONE) < 0;
  const capped = cmp(raw, limit) > 0 ? limit : raw;
  return { raw, instantLoss, capped, displayed: instantLoss ? ONE : cents(capped) };
}

export function crashTailCount(cashout, size = Q32, strict = false) {
  size = BigInt(size);
  if (size <= 0n || cmp(cashout, ONE) < 0) throw new RangeError('Invalid tail inputs');
  const boundary = div(mul(target, q(size)), cashout);
  // For positive n/d, integers u < n/d are counted by floor((n - 1) / d).
  const count = strict ? (boundary.n - 1n) / boundary.d : boundary.n / boundary.d;
  return count < 0n ? 0n : count > size ? size : count;
}

export function validCrashTarget(cashout, limit = q(1000)) {
  return cmp(cashout, ONE) > 0 && cmp(cashout, limit) <= 0 && equalGrid(cashout);
}

function equalGrid(cashout) {
  return (cashout.n * 100n) % cashout.d === 0n;
}

function targetRow(label, size = Q32) {
  const x = decimal(label);
  const count = crashTailCount(x, size);
  const p = q(count, size);
  const rtp = mul(x, p);
  const deficit = sub(target, rtp);
  assert.ok(cmp(deficit, q(0)) >= 0, 'Discrete RTP exceeds intended target');
  assert.ok(cmp(deficit, div(x, q(size))) < 0, 'Discrete loss bound');
  return {
    target: label,
    winningInputs: String(count),
    probability: view(p),
    rtp: view(rtp),
    rtpDeficit: view(deficit),
    rtpDeficitUpperBoundExclusive: view(div(x, q(size))),
  };
}

function exhaustiveSmallDomain() {
  const size = 10000n;
  const labels = ['1', '1.01', '1.94', '2', '2.009', '10', '99', '100', '1000'];
  const targets = labels.map(decimal);
  const counts = labels.map(() => ({ rawInclusive: 0, rawStrict: 0, centsInclusive: 0, centsStrict: 0 }));
  let instantLosses = 0;
  let naiveCollapsedWinsAtOne = 0;
  let cappedCashoutFirstWins = 0;
  let cappedCrashFirstWins = 0;
  let capInputs = 0;
  for (let u = 1n; u <= size; u++) {
    // Independent enumeration uses exact cross-products rather than tail counts.
    const rawNumerator = 97n * size;
    const rawDenominator = 100n * u;
    const instantLoss = rawNumerator < rawDenominator;
    const crashCents = rawNumerator * 100n / rawDenominator;
    const collapsedCents = crashCents < 100n ? 100n : crashCents;
    if (collapsedCents >= 100n) naiveCollapsedWinsAtOne++;
    if (instantLoss) { instantLosses++; continue; }
    for (let j = 0; j < targets.length; j++) {
      const x = targets[j];
      const lhs = rawNumerator * x.d;
      const rhs = x.n * rawDenominator;
      if (lhs >= rhs) counts[j].rawInclusive++;
      if (lhs > rhs) counts[j].rawStrict++;
      const centsLeft = crashCents * x.d;
      const centsRight = x.n * 100n;
      if (centsLeft >= centsRight) counts[j].centsInclusive++;
      if (centsLeft > centsRight) counts[j].centsStrict++;
    }
    // Cap C at 100x. All original inputs at or above the cap stop at exactly 100x.
    const isAtCap = rawNumerator >= 100n * rawDenominator;
    if (isAtCap) capInputs++;
    const cappedNumerator = isAtCap ? 100n : rawNumerator;
    const cappedDenominator = isAtCap ? 1n : rawDenominator;
    if (cappedNumerator >= 100n * cappedDenominator) cappedCashoutFirstWins++;
    if (cappedNumerator > 100n * cappedDenominator) cappedCrashFirstWins++;
  }
  const rows = labels.map((label, i) => {
    const x = targets[i];
    assert.equal(BigInt(counts[i].rawInclusive), crashTailCount(x, size));
    assert.equal(BigInt(counts[i].rawStrict), crashTailCount(x, size, true));
    if (equalGrid(x)) assert.equal(counts[i].centsInclusive, counts[i].rawInclusive);
    return { target: label, ...counts[i], rawRtp: view(mul(x, q(counts[i].rawInclusive, size))) };
  });
  assert.equal(instantLosses, 300);
  assert.equal(naiveCollapsedWinsAtOne, 10000);
  assert.equal(cappedCashoutFirstWins, 97);
  assert.equal(cappedCrashFirstWins, 0);
  assert.equal(capInputs, 97);
  return {
    domainSize: Number(size),
    method: 'Перебор всех U=1..10000 с независимым сравнением целых перекрестных произведений.',
    rows,
    instantLosses,
    naiveCollapsedWinsAtOne,
    cap100: {
      capInputs, cashoutFirstWins: cappedCashoutFirstWins, crashFirstWins: cappedCrashFirstWins,
      cashoutFirstRtp: view(q(cappedCashoutFirstWins * 100, size)),
      crashFirstRtp: view(q(0)),
    },
  };
}

function roundingAndTies() {
  const x = decimal('1.94');
  const exactBoundaryU = Q32 / 2n;
  equal(crashOutcome(exactBoundaryU).raw, x, 'Exact 1.94x tie');
  const inclusive = crashTailCount(x);
  const strict = crashTailCount(x, Q32, true);
  assert.equal(inclusive, exactBoundaryU);
  assert.equal(inclusive - strict, 1n);
  const arbitraryTarget = decimal('2.009');
  const priorNormalizedTarget = cents(arbitraryTarget);
  equal(priorNormalizedTarget, q(2));
  const stake = 100n;
  const payout = floorPayout(stake, arbitraryTarget);
  assert.equal(payout, 200n);
  const normalizedCount = crashTailCount(priorNormalizedTarget);
  const rawCount = crashTailCount(arbitraryTarget);
  const displayThreshold = decimal('2.01');
  const floorCrashCount = crashTailCount(displayThreshold);
  assert.ok(normalizedCount > rawCount && rawCount > floorCrashCount);
  assert.ok(validCrashTarget(decimal('1.01')));
  assert.ok(validCrashTarget(q(1000)));
  assert.ok(!validCrashTarget(ONE));
  assert.ok(!validCrashTarget(arbitraryTarget));
  assert.ok(!validCrashTarget(q(1001)));
  const activeAtOne = q(crashTailCount(ONE), Q32);
  const monetaryRounding = [1n, 2n, 10n, 100n, 101n].map(stakeUnits => {
    const cashout = decimal('1.01');
    const payoutUnits = floorPayout(stakeUnits, cashout);
    const paidMultiplier = q(payoutUnits, stakeUnits);
    const probability = q(crashTailCount(cashout), Q32);
    const rtp = mul(paidMultiplier, probability);
    assert.ok(cmp(paidMultiplier, cashout) <= 0);
    assert.ok(cmp(rtp, target) <= 0);
    return { stakeUnits: String(stakeUnits), cashout: '1.01', payoutUnits: String(payoutUnits), paidMultiplier: view(paidMultiplier), rtp: view(rtp) };
  });
  assert.equal(monetaryRounding[0].payoutUnits, '1');
  assert.equal(monetaryRounding[3].payoutUnits, '101');
  return {
    exactTie: {
      target: '1.94', u: String(exactBoundaryU),
      inclusiveWins: String(inclusive), strictWins: String(strict),
      inclusiveRtp: view(mul(x, q(inclusive, Q32))),
      strictRtp: view(mul(x, q(strict, Q32))),
      tieRtpDifference: view(div(x, q(Q32))),
    },
    instantLoss: {
      exactProbability: view(sub(ONE, activeAtOne)),
      naiveCollapseAndCompareAtOneRtp: view(ONE),
      correctSeparateInstantFlagAtOneRtp: view(activeAtOne),
      policy: 'raw < 1 должен оставаться явным instantLoss. Отображение 1.00x не делает этот исход выигрышем.',
    },
    arbitraryDecimals: {
      requestedTarget: '2.009', stakeUnits: String(stake), payoutUnits: String(payout),
      normalizeCashoutBeforeComparison: {
        comparedTarget: '2.00', wins: String(normalizedCount),
        rtp: view(mul(q(payout, stake), q(normalizedCount, Q32))),
      },
      compareRawThenFloorMoney: {
        comparedTarget: '2.009', wins: String(rawCount),
        rtp: view(mul(q(payout, stake), q(rawCount, Q32))),
      },
      floorCrashThenCompare: {
        requiredRawTarget: '2.01', wins: String(floorCrashCount),
        rtp: view(mul(q(payout, stake), q(floorCrashCount, Q32))),
      },
    },
    monetaryRounding,
    capPolicy: {
      limit: '1000', naturalMaximumRaw: view(mul(target, q(Q32))),
      atLimitInclusiveWins: String(crashTailCount(q(1000))),
      atLimitCrashFirstWins: '0',
      aboveLimitTarget: '1001', accepted: validCrashTarget(q(1001)),
      reason: 'При C=min(C_raw,L) цель выше L имеет нулевую вероятность; цель ровно L получает сохраненный хвост только если cashout при равенстве обрабатывается до остановки.',
    },
    recommendedContract: [
      'Принимать только явно заданную сетку целей 1.01..L с шагом 0.01; отвергать лишние десятичные знаки.',
      'Для целей в сотых сравнение floor(100*C_raw)/100 >= x равносильно C_raw >= x. Строгое > меняет границу.',
      'Равенство cashout и crash, включая L, урегулировать явно. Здесь модель платит при равенстве и обрабатывает auto-cashout до остановки.',
      'Округлять итоговую денежную выплату один раз в минимальные единицы; учитывать эффект для малой ставки.',
    ],
  };
}

function sharedRoundRisk() {
  const a = q(2);
  const b = q(10);
  const pA = q(crashTailCount(a), Q32);
  const pB = q(crashTailCount(b), Q32);
  const stake = 100n;
  const payoutA = q(floorPayout(stake, a));
  const payoutB = q(floorPayout(stake, b));
  const meanA = mul(payoutA, pA);
  const meanB = mul(payoutB, pB);
  const varianceA = sub(mul(mul(payoutA, payoutA), pA), mul(meanA, meanA));
  const varianceB = sub(mul(mul(payoutB, payoutB), pB), mul(meanB, meanB));
  const joint = mul(mul(payoutA, payoutB), pB);
  const covariance = sub(joint, mul(meanA, meanB));
  const variance = add(add(varianceA, varianceB), mul(q(2), covariance));
  assert.ok(cmp(covariance, q(0)) > 0);
  const totalStake = 2n * stake;
  const maxPayout = floorPayout(stake, a) + floorPayout(stake, b);
  const rows = [
    { p: sub(ONE, pA), m: q(0) },
    { p: sub(pA, pB), m: q(floorPayout(stake, a), totalStake) },
    { p: pB, m: q(maxPayout, totalStake) },
  ];
  const summary = distributionStats(rows);
  const mean = add(meanA, meanB);
  equal(mean, mul(sum(rows.map(row => mul(row.p, row.m))), q(totalStake)));
  const measuredSecond = sum(rows.map(row => mul(row.p, mul(mul(row.m, q(totalStake)), mul(row.m, q(totalStake))))));
  equal(variance, sub(measuredSecond, mul(mean, mean)), 'Joint three-outcome variance');
  const n = 20;
  const cashout = q(100);
  const p = q(crashTailCount(cashout), Q32);
  const perBetPayout = q(floorPayout(stake, cashout));
  const perBetVariance = mul(mul(perBetPayout, perBetPayout), mul(p, sub(ONE, p)));
  const independentVariance = mul(q(n), perBetVariance);
  const sharedVariance = mul(q(n * n), perBetVariance);
  equal(div(sharedVariance, independentVariance), q(n), 'Shared variance multiplier');
  const groupMax = BigInt(n) * floorPayout(stake, cashout);
  return {
    assumptions: 'Суммы в минимальных денежных единицах; 100 единиц = одна условная денежная единица. Выплаты включают возврат ставки.',
    covarianceFormula: 'При a <= b, X_a=s_a*a*I(C>=a), X_b=s_b*b*I(C>=b): Cov(X_a,X_b)=s_a*s_b*a*b*(p_b-p_a*p_b). Для округленных выплат вместо s*x использовать фактическую выплату.',
    twoTargets: {
      targets: ['2', '10'], stakeEachUnits: String(stake), totalStakeUnits: String(totalStake),
      pA: view(pA), pB: view(pB), covarianceUnitsSquared: view(covariance),
      meanPayoutUnits: view(mean), expectedHouseProfitUnits: view(sub(q(totalStake), mean)),
      sharedPayoutVarianceUnitsSquared: view(variance), payoutSdUnits: Math.sqrt(number(variance)),
      independentPayoutVarianceUnitsSquared: view(add(varianceA, varianceB)),
      maxGrossPayoutUnits: String(maxPayout), additionalCapitalAfterCollectedStakeUnits: String(maxPayout - totalStake),
      distribution: rows.map(row => ({ probability: view(row.p), payoutUnits: view(mul(row.m, q(totalStake))) })),
      aggregateStatsPerTotalStake: summary,
    },
    twentyTarget100: {
      bets: n, target: '100', stakeEachUnits: String(stake), winProbability: view(p),
      sharedAnyWinProbability: view(p),
      independentAnyWinProbability: view(sub(ONE, pow(sub(ONE, p), n))),
      meanPayoutUnits: view(mul(q(n), mul(perBetPayout, p))),
      sharedPayoutVarianceUnitsSquared: view(sharedVariance),
      independentPayoutVarianceUnitsSquared: view(independentVariance),
      sharedPayoutSdUnits: Math.sqrt(number(sharedVariance)),
      independentPayoutSdUnits: Math.sqrt(number(independentVariance)),
      varianceRatio: view(div(sharedVariance, independentVariance)),
      maxGrossPayoutUnits: String(groupMax),
      additionalCapitalAfterCollectedStakeUnits: String(groupMax - BigInt(n) * stake),
      note: 'В одном общем раунде все 20 целей 100x либо выигрывают вместе, либо проигрывают вместе. Резерв общего раунда нельзя рассчитывать как для независимых исходов.',
    },
  };
}

function moduloBias() {
  const naiveCounts = new Array(37).fill(0);
  const correctedCounts = new Array(37).fill(0);
  let rejected = 0;
  for (let byte = 0; byte < 256; byte++) {
    naiveCounts[byte % 37]++;
    if (byte >= 222) rejected++;
    else correctedCounts[byte % 37]++;
  }
  assert.ok(naiveCounts.slice(0, 34).every(count => count === 7));
  assert.ok(naiveCounts.slice(34).every(count => count === 6));
  assert.ok(correctedCounts.every(count => count === 6));
  assert.equal(rejected, 34);
  return {
    domain: 256, outcomes: 37, naiveCounts,
    naiveProbabilities: { residues0Through33: view(q(7, 256)), residues34Through36: view(q(6, 256)) },
    naiveRouletteStraightBetRtp: { residues0Through33: view(q(7 * 36, 256)), residues34Through36: view(q(6 * 36, 256)) },
    uniformRouletteStraightBetRtp: view(q(36, 37)),
    correction: {
      acceptByteBelow: 222, rejectedInputs: rejected, rejectionProbability: view(q(rejected, 256)),
      counts: correctedCounts, conditionalProbabilityEach: view(q(1, 37)), expectedDraws: view(q(256, 222)),
    },
    note: 'Байт % 37 дает смещенные вероятности. Rejection sampling оставляет 222 входа, по 6 на карман. Криптографический источник сам по себе не исправляет смещенное отображение.',
  };
}

export function runCrashStudy() {
  const analyticTargets = ['1.01', '2', '10', '100', '1000'].map(label => targetRow(label));
  const exhaustive = exhaustiveSmallDomain();
  const rounding = roundingAndTies();
  const risk = sharedRoundRisk();
  const rng = moduloBias();
  const instantCount = Q32 - crashTailCount(ONE);
  assert.ok(instantCount > 0n);
  const result = {
    iterations: [{
      id: 7,
      title: 'Crash / Limbo: дискретный хвост, границы выплат и общий риск',
      hypothesis: 'Для U равномерного на 1..2^32, C_raw=(97/100)*Q/U и отдельного instantLoss при C_raw<1 цели x>1 имеют P=floor((97/100)*Q/x)/Q и RTP не выше 97%.',
      model: {
        q: String(Q32), intendedRtp: view(target), instantLossInputs: String(instantCount),
        formula: 'P(C_raw >= x)=floor(R*Q/x)/Q; 0 <= R - x*P < x/Q.',
        cap: '1000', grid: '0.01', ties: 'cashout получает выплату при равенстве, включая cap',
        validationTargets: ['1.01', '2', '10', '100', '1000'],
      },
      checks: [
        { name: 'Точные дискретные вероятности при Q=2^32', passed: true, table: analyticTargets },
        { name: 'Независимый исчерпывающий перебор Q=10000', passed: true, detail: exhaustive },
        { name: 'Instantloss, точное равенство и две схемы округления', passed: true, detail: rounding },
        { name: 'Ковариация выплат общих раундов и максимальное обязательство', passed: true, detail: risk },
        { name: 'Смещение modulo и исправление rejection sampling', passed: true, detail: rng },
      ],
      findings: [
        '97% здесь целевой верхний предел: целочисленное RNG и денежное округление дают небольшое отклонение вниз, зависящее от цели и ставки.',
        'На Q=10000 цель 1000x имеет 9 выигрышей и RTP 90%; маленькое пространство RNG недостаточно для редких больших целей.',
        'Если все raw<1 свернуть в отображение 1.00 и разрешить cashout 1x без instantLoss, RTP становится 100%.',
        'Если остановка на cap обрабатывается раньше cashout, все ставки ровно на cap проиграют. При cap=100 и Q=10000 RTP этой цели падает с 97% до 0%.',
        'Для произвольной цели 2.009 сравнение raw, округление cashout и округление crash дают разные результаты. Нужен единый явно зафиксированный контракт.',
        'Общие раунды создают положительную ковариацию. Для 20 одинаковых ставок variance общего исхода в 20 раз больше независимой модели.',
        'Равномерность источника и отображение его значений должны проверяться отдельно: byte % 37 смещает рулетку, rejection sampling исправляет отображение.',
      ],
      limitations: [
        'Это исследование предложенной независимой модели, не точная математика Aviator или другого поставщика.',
        'Доказательства относятся к указанным формулам и перечисленным исчерпывающим проверкам; криптографическая стойкость, провайдерская сертификация и корректность будущего игрового сервера ими не подтверждаются.',
        'Аналитические хвосты Q=2^32 проверены точной рациональной арифметикой; полный перебор 2^32 входов не выполнялся.',
      ],
      sources: [
        { title: 'Node.js crypto.randomInt: границы диапазона и отсутствие modulo bias', url: 'https://github.com/nodejs/node/blob/main/doc/api/crypto.md#cryptorandomintmin-max-callback' },
        { title: 'NIST SP 800-90A Rev. 1: механизмы генерации случайных битов', url: 'https://csrc.nist.gov/pubs/sp/800/90/a/r1/final' },
      ],
    }],
    exposure: risk,
  };
  JSON.stringify(result);
  return result;
}
