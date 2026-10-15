import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prepareGame, verifyGameRound } from '../../server/games/core.ts';
import { q, decimal, mul, sub, div, cmp, number, view, equal, distributionStats, floorPayout, target } from './rational.mjs';

export function runBasic() {
  const files = ['server/games/core.ts', 'server/games/coins.ts', 'server/games/roulette.ts', 'src/shared/gameCore.ts'];
  const sourceHashes = files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
  const coins = prepareGame('royal-coins', 1, {});
  const counts = new Map();
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 5; c++) {
    const symbols = [a, b, c];
    let next = 0;
    const round = coins.play(1n, max => { assert.equal(max, 5); return symbols[next++]; });
    const expected = a === b && b === c ? 12 : a === b || a === c || b === c ? 1 : 0;
    assert.equal(round.multiplier, expected);
    assert.equal(verifyGameRound(round), true);
    counts.set(expected, (counts.get(expected) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { 0: 60, 1: 60, 12: 5 });
  const coinsRows = [...counts].map(([m, n]) => ({ p: q(n, 125), m: q(m) }));
  const coinsStats = distributionStats(coinsRows);
  assert.equal(coinsStats.rtp.fraction, '24/25');
  const expectedRed = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const inputs = [{ bet: 'red' }, { bet: 'black' }, { bet: 'even' }, { bet: 'odd' }, ...Array.from({ length: 37 }, (_, i) => ({ bet: 'number', number: i }))];
  let rouletteOutcomes = 0;
  for (const input of inputs) {
    const game = prepareGame('royal-roulette', 1, input);
    let payout = 0;
    for (let n = 0; n < 37; n++) {
      const round = game.play(1n, max => { assert.equal(max, 37); return n; });
      const won = input.bet === 'number' ? n === input.number : n !== 0 && (
        input.bet === 'red' ? expectedRed.has(n) : input.bet === 'black' ? !expectedRed.has(n) : input.bet === 'even' ? n % 2 === 0 : n % 2 === 1);
      assert.equal(round.multiplier, won ? input.bet === 'number' ? 36 : 2 : 0);
      assert.equal(verifyGameRound(round), true);
      payout += round.multiplier;
      rouletteOutcomes++;
    }
    assert.equal(payout, 36);
  }
  const rouletteColor = distributionStats([{ p: q(18, 37), m: q(2) }, { p: q(19, 37), m: q(0) }]);
  const rouletteNumber = distributionStats([{ p: q(1, 37), m: q(36) }, { p: q(36, 37), m: q(0) }]);
  const iteration1 = {
    id: 1, title: 'Текущие Coins и рулетка',
    question: 'Соответствуют ли текущие движки заявленному RTP и как отличаются распределения выплат?',
    method: 'Независимые ожидаемые исходы сравниваются с реальным серверным движком по полному перебору.',
    findings: ['Coins: RTP 96%, положительная выплата 52%, чистый выигрыш 4%.', 'У рулетки одинаковый RTP для поддержанных ставок, но риск ставки на число значительно выше риска цвета.'],
    checks: [{ name: 'Coins: все 125 исходов и проверка сохранённого результата', count: 125, passed: true }, { name: 'Рулетка: 41 ставка на каждом из 37 исходов', count: rouletteOutcomes, passed: true }, { name: 'Точные суммы вероятностей и RTP', count: 3, passed: true }],
    results: { coins: coinsStats, rouletteColor, rouletteNumber, counts: Object.fromEntries(counts), sourceHashes },
    next: 'Денежный контракт должен передавать полный возврат отдельно от прибыли и поддерживать точные дроби.',
  };

  const stakeExamples = [1n, 10n, 100n, 1000n, 1_000_000n];
  const multiplier = q(97, 49);
  const dice49 = [{ p: q(49, 100), m: multiplier }, { p: q(51, 100), m: q(0) }];
  const exactRtp = distributionStats(dice49);
  assert.equal(exactRtp.rtp.fraction, '97/100');
  const precisionRows = stakeExamples.map(stake => {
    const stats = distributionStats(dice49, stake);
    const loss = sub(target, q(stats.rtp.fraction.split('/')[0], stats.rtp.fraction.split('/')[1]));
    assert.ok(cmp(loss, q(0)) >= 0 && cmp(loss, q(1, stake)) < 0);
    return { stakeUnits: stake.toString(), payoutUnits: floorPayout(stake, multiplier).toString(), rtp: stats.rtp, roundingLoss: view(loss) };
  });
  const down = mul(q(49, 100), decimal('1.97'));
  const up = mul(q(49, 100), decimal('1.98'));
  equal(down, decimal('0.9653'));
  equal(up, decimal('0.9702'));
  assert.equal(Math.floor(1.15 * 100), 114);
  assert.equal(floorPayout(100n, decimal('1.15')), 115n);
  const stakeLarge = 9007199254740993n;
  const exactLarge = floorPayout(stakeLarge, decimal('1.94'));
  assert.ok(exactLarge > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(exactLarge, 17473966554197526n);
  const halfUpPayout = (stake, m) => (2n * stake * m.n + m.d) / (2n * m.d);
  assert.equal(halfUpPayout(1n, decimal('1.94')), 2n);
  const halfUpRtp = q(halfUpPayout(1n, decimal('1.94')), 2n);
  equal(halfUpRtp, q(1));
  const iteration2 = {
    id: 2, title: 'Денежные единицы и округление',
    question: 'Может ли правильная формула RTP превратиться в неверные выплаты?',
    method: 'Рациональные BigInt-расчёты сравниваются с округлением множителя и итоговой выплаты.',
    findings: ['Округление коэффициента Dice при шансе 49% до 1,97 снижает RTP до 96,53%; до 1,98 повышает до 97,02%.', 'Округление вниз итоговой выплаты теряет менее одной минимальной единицы на исход; относительный эффект зависит от размера ставки.', 'Обычные двоичные дроби могут терять минимальную денежную единицу: floor(1.15*100)=114 вместо 115.', 'Округление к ближайшему может поднять RTP: при ставке в одну минимальную единицу Dice с шансом 50% и ×1,94 даёт 100%.'],
    checks: [{ name: 'Граница потери от округления на пяти размерах ставки', count: precisionRows.length, passed: true }, { name: 'Независимый пример ошибки двоичной дроби', count: 1, passed: true }, { name: 'Пример повышения RTP при округлении к ближайшему', count: 1, passed: true }, { name: 'Выплата выше безопасного диапазона Number сохраняется точно', count: 1, passed: true }],
    results: { exactRtp, dice49Rounding: precisionRows, roundedMultiplierDown: view(down), roundedMultiplierUp: view(up), nearestAtOneUnitRtp: view(halfUpRtp), largeStakeUnits: stakeLarge.toString(), largePayoutUnits: exactLarge.toString() },
    next: 'Хранить точный коэффициент дробью, округлять только конечную сумму и проверять минимальные ставки.',
  };

  const diceSamples = [97, 100, 1000, 4900, 5000, 9500, 9700].map(t => {
    const p = q(t, 10000), m = q(9700, t);
    return { threshold: t, probability: view(p), multiplier: view(m), stats: distributionStats([{ p, m }, { p: sub(q(1), p), m: q(0) }]), actualAt1000Units: distributionStats([{ p, m }, { p: sub(q(1), p), m: q(0) }], 1000n).rtp };
  });
  let minimumRtpAt1000 = q(1), minimumThreshold = 0;
  let thresholdChecks = 0;
  const allowedMin = 97, allowedMax = 9500;
  for (let t = 1; t < 10000; t++) {
    const p = q(t, 10000), m = q(9700, t);
    equal(mul(p, m), target);
    const payout = floorPayout(1000n, m);
    const rtp = q(BigInt(t) * payout, 10000n * 1000n);
    assert.ok(cmp(rtp, target) <= 0 && cmp(sub(target, rtp), q(1, 1000)) < 0);
    if (t >= allowedMin && t <= allowedMax) {
      assert.ok(cmp(m, q(100)) <= 0 && cmp(m, q(1)) > 0);
      if (cmp(rtp, minimumRtpAt1000) < 0) { minimumRtpAt1000 = rtp; minimumThreshold = t; }
    }
    thresholdChecks++;
  }
  for (const t of [97, 100, 1000, 4900, 5000, 9500]) {
    let lowerWins = 0, upperWins = 0;
    for (let r = 0; r < 10000; r++) {
      if (r < t) lowerWins++;
      if (r >= 10000 - t) upperWins++;
    }
    assert.equal(lowerWins, t);
    assert.equal(upperWins, t);
  }
  const nonProfit = [9700, 9800, 9900, 9999].map(t => ({ threshold: t, m: view(q(9700, t)) }));
  assert.ok(nonProfit.every(row => row.m.value <= 1));
  const iteration3 = {
    id: 3, title: 'Полная дискретная модель Dice',
    question: 'Какие пороги сохраняют заданный RTP и допускают реальный выигрыш при ограничении ×100?',
    method: 'Проверка всех 9999 непустых порогов и полный перебор результата для шести граничных вариантов.',
    findings: ['При сетке 0..9999 точный коэффициент равен 9700/T, где T число выигрышных исходов.', 'Для максимума ×100 требуется T >= 97. При T >= 9700 выигрышный исход уже не даёт прибыли сверх ставки.', 'Предлагаемый исследовательский диапазон 0,97%..95% имеет точный теоретический RTP 97%; фактический возврат зависит от минимальной ставки.'],
    checks: [{ name: 'Точное математическое ожидание на всех порогах', count: thresholdChecks, passed: true }, { name: 'Граница округления на всех порогах', count: thresholdChecks, passed: true }, { name: 'Симметрия меньше/больше без ошибки граничного числа', count: 120000, passed: true }, { name: 'Лимит коэффициента и наличие чистой прибыли', count: allowedMax - allowedMin + 1, passed: true }],
    results: { samples: diceSamples, allowedThresholds: [allowedMin, allowedMax], minRtpAt1000Units: view(minimumRtpAt1000), minimumThreshold, targetsWithoutProfit: nonProfit },
    next: 'Утвердить сетку, диапазон и минимальную ставку до разработки интерфейса.',
  };
  return { iterations: [iteration1, iteration2, iteration3], distributions: { coins: coinsRows, rouletteColor: [{ p: q(18, 37), m: q(2) }, { p: q(19, 37), m: q(0) }] } };
}
