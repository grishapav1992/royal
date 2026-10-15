import assert from 'node:assert/strict';
import { prepareGame } from '../../server/games/core.ts';
import { q, mul, sub, number, view, equal, choose, target, distributionStats } from './rational.mjs';

function sessionCoins(rounds) {
  let dist = new Float64Array(1);
  dist[0] = 1;
  for (let i = 0; i < rounds; i++) {
    const next = new Float64Array(dist.length + 12);
    for (let total = 0; total < dist.length; total++) {
      next[total] += dist[total] * 0.48;
      next[total + 1] += dist[total] * 0.48;
      next[total + 12] += dist[total] * 0.04;
    }
    dist = next;
  }
  let mass = 0, mean = 0, second = 0, profit = 0, loss = 0;
  for (let total = 0; total < dist.length; total++) {
    mass += dist[total]; mean += total * dist[total]; second += total * total * dist[total];
    if (total > rounds) profit += dist[total];
    if (total < rounds) loss += dist[total];
  }
  assert.ok(Math.abs(mass - 1) < 1e-10);
  assert.ok(Math.abs(mean - rounds * 0.96) < 1e-7);
  assert.ok(Math.abs(second - mean * mean - rounds * 5.3184) < 1e-5);
  return { rounds, probabilityPlayerProfit: profit, probabilityPlayerLoss: loss, probabilityBreakEven: Math.max(0, 1 - profit - loss), expectedPlayerNet: mean - rounds, netSd: Math.sqrt(second - mean * mean), probabilitySumError: Math.abs(mass - 1) };
}

function uniformGenerator(seed) {
  let state = seed >>> 0;
  return max => {
    const limit = Math.floor(4294967296 / max) * max;
    while (true) {
      state += 0x6d2b79f5;
      let v = Math.imul(state ^ state >>> 15, 1 | state);
      v ^= v + Math.imul(v ^ v >>> 7, 61 | v);
      v = (v ^ v >>> 14) >>> 0;
      if (v < limit) return v % max;
    }
  };
}

function exactSessionCoins(rounds) {
  const denominator = 100n ** BigInt(rounds);
  let profit = 0n, loss = 0n, even = 0n, categories = 0;
  for (let triples = 0; triples <= rounds; triples++) {
    const factor = choose(rounds, triples) * 4n ** BigInt(triples) * 48n ** BigInt(rounds - triples);
    for (let pairs = 0; pairs <= rounds - triples; pairs++) {
      const weight = factor * choose(rounds - triples, pairs);
      const payout = 12 * triples + pairs;
      if (payout > rounds) profit += weight;
      else if (payout < rounds) loss += weight;
      else even += weight;
      categories++;
    }
  }
  assert.equal(profit + loss + even, denominator);
  return { rounds, enumeratedCategoryConfigurations: categories, profit: view(q(profit, denominator)), loss: view(q(loss, denominator)), breakEven: view(q(even, denominator)) };
}

export function runRisk() {
  const sessions = [10, 100, 1000].map(sessionCoins);
  const exactSessions = [10, 100].map(exactSessionCoins);
  for (const exact of exactSessions) {
    const numeric = sessions.find(s => s.rounds === exact.rounds);
    assert.ok(Math.abs(exact.profit.value - numeric.probabilityPlayerProfit) < 1e-10);
    assert.ok(Math.abs(exact.loss.value - numeric.probabilityPlayerLoss) < 1e-10);
    assert.ok(Math.abs(exact.breakEven.value - numeric.probabilityBreakEven) < 1e-10);
  }
  const red = prepareGame('royal-roulette', 1, { bet: 'red' });
  const black = prepareGame('royal-roulette', 1, { bet: 'black' });
  const zero = prepareGame('royal-roulette', 1, { bet: 'number', number: 0 });
  const one = prepareGame('royal-roulette', 1, { bet: 'number', number: 1 });
  const combined = Array.from({ length: 37 }, (_, n) => ({
    outcome: n,
    redBlackPayout: Number(red.play(1n, () => n).payoutUnits) + Number(black.play(1n, () => n).payoutUnits),
    twoNumbersPayout: Number(zero.play(1n, () => n).payoutUnits) + Number(one.play(1n, () => n).payoutUnits),
  }));
  const redBlackMax = Math.max(...combined.map(x => x.redBlackPayout));
  const twoNumbersMax = Math.max(...combined.map(x => x.twoNumbersPayout));
  assert.equal(redBlackMax, 2);
  assert.equal(twoNumbersMax, 36);
  const independentRedBlackMax = Number(red.play(1n, () => 1).payoutUnits) + Number(black.play(1n, () => 2).payoutUnits);
  const independentNumbersMax = Number(zero.play(1n, () => 0).payoutUnits) + Number(one.play(1n, () => 1).payoutUnits);
  assert.equal(independentRedBlackMax, 4);
  assert.equal(independentNumbersMax, 72);
  const roulettePortfolio = {
    assumption: 'Обе ставки относятся к одному и тому же номеру общего вращения. Это исследовательский портфель, а не доказательство взаимозачёта независимых текущих операций play.',
    totalStake: 2,
    redBlack: { maxPayout: redBlackMax, extraReserve: redBlackMax - 2, sumOfSeparateReserves: 2 },
    twoDifferentNumbers: { maxPayout: twoNumbersMax, extraReserve: twoNumbersMax - 2, sumOfSeparateReserves: 70 },
    independentSpins: { redBlack: { maxPayout: independentRedBlackMax, extraReserve: independentRedBlackMax - 2 }, twoNumbers: { maxPayout: independentNumbersMax, extraReserve: independentNumbersMax - 2 } },
  };

  let firstSum = 0, secondSum = 0, productSum = 0, aggregateSquareSum = 0, aggregateSum = 0;
  for (let u = 1; u <= 10000; u++) {
    const a = u * 2 <= 9700 ? 2 : 0;
    const b = u * 10 <= 9700 ? 10 : 0;
    const twenty = u * 100 <= 9700 ? 2000 : 0;
    firstSum += a; secondSum += b; productSum += a * b;
    aggregateSum += twenty; aggregateSquareSum += twenty * twenty;
  }
  equal(q(firstSum, 10000), target);
  equal(q(secondSum, 10000), target);
  const covariance = sub(q(productSum, 10000), mul(target, target));
  equal(covariance, q(9991, 10000));
  const singleCrashVariance = sub(mul(target, q(100)), mul(target, target));
  const sharedVariance = sub(q(aggregateSquareSum, 10000), mul(q(aggregateSum, 10000), q(aggregateSum, 10000)));
  equal(sharedVariance, mul(singleCrashVariance, q(400)));
  const independentVariance = mul(singleCrashVariance, q(20));
  const crashExposure = { cashout2And10Covariance: view(covariance), twentyAt100: { totalStake: 20, maxPayout: 2000, extraReserve: 1980, sharedVariance: view(sharedVariance), independentVariance: view(independentVariance), sharedSd: Math.sqrt(number(sharedVariance)), independentSd: Math.sqrt(number(independentVariance)) } };

  let minimumCash = Infinity;
  function walk(outcomes, cash) {
    if (outcomes.length === 5) { assert.ok(cash >= 0); minimumCash = Math.min(minimumCash, cash); return 1; }
    let count = 0;
    for (const payout of [0, 1, 12]) count += walk([...outcomes, payout], cash - payout);
    return count;
  }
  const portfolioStates = walk([], 5 + 55);
  assert.equal(portfolioStates, 243);
  assert.equal(minimumCash, 0);
  const withoutFullReserve = 5 + 54 - 5 * 12;
  assert.equal(withoutFullReserve, -1);

  const reference = distributionStats([{ p: q(60, 125), m: q(0) }, { p: q(60, 125), m: q(1) }, { p: q(5, 125), m: q(12) }]);
  const rngSeed = 0x726f7961;
  const draw = uniformGenerator(rngSeed);
  const trials = 1_000_000;
  const observed = { zero: 0, pair: 0, triple: 0 };
  let payoutTotal = 0;
  for (let i = 0; i < trials; i++) {
    const a = draw(5), b = draw(5), c = draw(5);
    const payout = a === b && b === c ? 12 : a === b || a === c || b === c ? 1 : 0;
    payoutTotal += payout;
    observed[payout === 12 ? 'triple' : payout === 1 ? 'pair' : 'zero']++;
  }
  const simulatedRtp = payoutTotal / trials;
  const standardError = reference.sd / Math.sqrt(trials);
  const zScore = (simulatedRtp - 0.96) / standardError;
  assert.ok(Math.abs(zScore) < 6, `Seeded simulation discrepancy ${zScore}`);
  const simulation = { generator: 'Mulberry32 with rejection mapping, study only', seed: rngSeed, trials, observed, payoutTotal, rtp: simulatedRtp, standardError, approximate95Range: [simulatedRtp - 1.96 * standardError, simulatedRtp + 1.96 * standardError], zScore };

  const epsilon = 0.001;
  const samplePlanning = [
    { name: 'Coins', sd: reference.sd, variance: reference.variance.value, max: 12 },
    { name: 'Dice 50%', sd: 0.97, variance: 0.9409, max: 1.94 },
    { name: 'Crash target 100', sd: Math.sqrt(number(singleCrashVariance)), variance: number(singleCrashVariance), max: 100 },
  ].map(row => ({
    ...row, precisionPercentagePoints: epsilon * 100,
    approximate95NormalSamples: Math.ceil((1.96 * row.sd / epsilon) ** 2),
    conservativeBernsteinSamples: Math.ceil(Math.log(40) * (2 * row.variance + (2 / 3) * row.max * epsilon) / epsilon ** 2),
  }));
  return { iterations: [{
    id: 10, title: 'Совокупный резерв и неопределённость проверки',
    question: 'Достаточно ли положительного преимущества казино для покрытия выигрышей и сколько раундов нужно для проверки RTP?',
    method: 'Полный перебор общих исходов, динамическое распределение сессий, точные ковариации и воспроизводимая симуляция.',
    findings: ['Ставки одного общего раунда коррелируют: для 20 одинаковых ставок Crash дисперсия в 20 раз выше, чем при независимых раундах.', 'В рулетке портфель ставок одного общего вращения считается по максимуму выплаты на 37 исходах. Для независимых вращений требуется сумма отдельных максимумов.', 'Положительное математическое преимущество не гарантирует прибыль в короткой сессии.', 'Нужная длина симуляции растёт с дисперсией и квадратом требуемой точности. Нормальная оценка приблизительна; для ограниченных выплат дополнительно вычислена консервативная граница Бернштейна.'],
    checks: [{ name: 'Сессии 10/100/1000 раундов: масса, среднее, дисперсия', count: 9, passed: true }, { name: 'Точный независимый мультиномиальный перебор сессий 10 и 100', count: 6, enumeratedCategoryConfigurations: exactSessions.reduce((n, s) => n + s.enumeratedCategoryConfigurations, 0), passed: true }, { name: 'Два портфеля общего вращения реальной рулетки на всех 37 исходах', count: 74, passed: true }, { name: 'Независимые вращения требуют суммы отдельных максимумов', count: 2, passed: true }, { name: 'Ковариация общих исходов Crash по 10000 значениям', count: 10000, passed: true }, { name: 'Покрытие всех 243 совместных исходов пяти Coins', count: portfolioStates, passed: true }, { name: 'Контрпример при резерве на единицу ниже требуемого', count: 1, passed: true }, { name: 'Воспроизводимая симуляция миллиона Coins против точной модели', count: trials, passed: true }],
    results: { sessions, exactSessions, roulettePortfolio, crashExposure, finiteCoinsPortfolio: { stakes: 5, reserve: 55, checkedStates: portfolioStates, minRemainingCash: minimumCash }, simulation, samplePlanning },
    limitations: ['Симуляционный генератор не используется для ставок и не доказывает качества производственного RNG.', 'Расчёты сессии предполагают независимые раунды и одинаковую ставку; для 10 и 100 раундов есть точные дроби, для 1000 раундов используется численная Float64-свёртка.', 'Значения нормальной оценки точности являются планированием, а не сертификатом. Граница Бернштейна предполагает независимые ограниченные исходы с указанной дисперсией.'],
    next: 'Резервировать максимум обязательств до принятия ставок; контролировать RTP вместе с дисперсией, размером выборки и версиями правил.',
  }] };
}
