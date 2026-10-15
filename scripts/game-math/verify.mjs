import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const base = 'artifacts/game-math';
const aggregatePath = `${base}/study-results.json`;
const reportPath = 'docs/game-math-10-iterations.md';
const read = path => readFileSync(path, 'utf8');
const data = JSON.parse(read(aggregatePath));
const audits = [];
const forbidden = String.fromCharCode(0x2014);
function audit(name, fn) { fn(); audits.push({ name, passed: true }); }

// Independent arithmetic for checking saved evidence, without importing study helpers.
function fraction(value) {
  const [n, d = '1'] = (typeof value === 'string' ? value : value.fraction).split('/');
  return [BigInt(n), BigInt(d)];
}
function product(a, b) { return [a[0] * b[0], a[1] * b[1]]; }
function plus(a, b) { return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]]; }
function same(a, b) { assert.equal(a[0] * b[1], b[0] * a[1]); }
function binomial(n, k) {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let j = 1; j <= Math.min(k, n - k); j++) result = result * BigInt(n - j + 1) / BigInt(j);
  return result;
}
function close(a, b, tolerance = 1e-11) { assert.ok(Math.abs(a - b) <= tolerance * (1 + Math.abs(b)), `${a} differs from ${b}`); }
function weightedMean(rows) {
  return rows.reduce((sum, row) => plus(sum, product(fraction(row.probability), fraction(row.multiplier ?? row.payout))), [0n, 1n]);
}
const target = [97n, 100n];

audit('Ten complete iterations, 57 successful check groups, matching individual evidence', () => {
  assert.equal(data.iterationCount, 10);
  assert.equal(data.iterations.length, 10);
  assert.equal(data.checkGroupCount, 57);
  assert.equal(data.productionEconomicsChanged, false);
  assert.equal(data.iterations.reduce((sum, i) => sum + i.checks.length, 0), 57);
  for (const [index, iteration] of data.iterations.entries()) {
    assert.equal(iteration.id, index + 1);
    assert.equal(iteration.status, 'verified');
    assert.ok(iteration.checks.length > 0 && iteration.checks.every(check => check.passed === true));
    assert.deepEqual(JSON.parse(read(`${base}/iteration-${String(iteration.id).padStart(2, '0')}.json`)), iteration);
  }
});

audit('Research and actual engine source hashes match saved evidence', () => {
  for (const source of [...data.sources, ...data.iterations[0].results.sourceHashes]) {
    assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'), source.sha256, source.path);
  }
});

audit('Iteration 1: independent current-game weighted expectation', () => {
  const r = data.iterations[0].results;
  assert.deepEqual(r.counts, { 0: 60, 1: 60, 12: 5 });
  same(fraction(r.coins.rtp), [60n + 5n * 12n, 125n]);
  same(fraction(r.rouletteColor.rtp), [18n * 2n, 37n]);
  same(fraction(r.rouletteNumber.rtp), [36n, 37n]);
});

audit('Iteration 2: exact final-unit settlement, including the large stake', () => {
  const r = data.iterations[1].results;
  for (const row of r.dice49Rounding) {
    const stake = BigInt(row.stakeUnits), payout = stake * 97n / 49n;
    assert.equal(BigInt(row.payoutUnits), payout);
    same(fraction(row.rtp), [49n * payout, 100n * stake]);
  }
  assert.equal(BigInt(r.largePayoutUnits), BigInt(r.largeStakeUnits) * 97n / 50n);
  same(fraction(r.roundedMultiplierDown), [49n * 197n, 10000n]);
  same(fraction(r.roundedMultiplierUp), [49n * 198n, 10000n]);
});

audit('Iteration 3: Dice sample formulas and full threshold coverage', () => {
  const i = data.iterations[2];
  assert.equal(i.checks[0].count, 9999);
  assert.deepEqual(i.results.allowedThresholds, [97, 9500]);
  for (const row of i.results.samples) {
    same(fraction(row.probability), [BigInt(row.threshold), 10000n]);
    same(fraction(row.multiplier), [9700n, BigInt(row.threshold)]);
    same(product(fraction(row.probability), fraction(row.multiplier)), target);
  }
});

audit('Iteration 4: Plinko path probabilities, exact means, and one-unit flooring', () => {
  const t = data.iterations[3].tables;
  assert.equal(t.boardStudies.reduce((sum, board) => sum + board.enumeratedPaths, 0), 130816);
  for (const table of t.paytables) {
    for (const row of table.bucketTable) same(fraction(row.probability), [binomial(8, row.bucket), 256n]);
    same(weightedMean(table.bucketTable), target);
    const floored = table.bucketTable.reduce((sum, row) => {
      const m = fraction(row.multiplier);
      return plus(sum, product(fraction(row.probability), [m[0] / m[1], 1n]));
    }, [0n, 1n]);
    same(fraction(table.rounding.find(row => row.stakeMinimalUnits === 1).stats.rtp), floored);
  }
  const variances = t.paytables.map(table => table.stats.variance.value);
  assert.ok(variances[0] < variances[1] && variances[1] < variances[2]);
});

audit('Iteration 5: all Mines states and the clipping counterexample', () => {
  const t = data.iterations[4].tables;
  assert.equal(t.allStates.length, 300);
  for (const row of t.allStates) {
    same(fraction(row.probability), [binomial(25 - row.mines, row.safePicks), binomial(25, row.safePicks)]);
    same(product(fraction(row.probability), fraction(row.multiplier)), target);
  }
  assert.equal(Math.max(...t.fullClear.map(row => row.multiplier.value)), 5044291);
  same(fraction(t.clippingExample.clippedRtp), [1000n, binomial(25, 5)]);
});

audit('Iteration 6: all Keno probabilities and both original paytables', () => {
  const t = data.iterations[5].tables;
  assert.equal(t.distributions.reduce((sum, row) => sum + row.hits.length, 0), 65);
  for (const dist of t.distributions) for (const row of dist.hits) {
    same(fraction(row.probability), [binomial(dist.selectedNumbers, row.hits) * binomial(40 - dist.selectedNumbers, 20 - row.hits), binomial(40, 20)]);
  }
  for (const table of t.paytables) same(weightedMean(table.payouts), target);
});

audit('Iteration 7: exact discrete Crash tails, equality, cap, and rejection mapping', () => {
  const i = data.iterations[6], domain = BigInt(i.model.q);
  for (const row of i.checks[0].table) {
    const [whole, cents = '0'] = row.target.split('.');
    const multiplier = [BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0')), 100n];
    const wins = 97n * domain * multiplier[1] / (100n * multiplier[0]);
    assert.equal(BigInt(row.winningInputs), wins);
    same(fraction(row.probability), [wins, domain]);
    same(fraction(row.rtp), product(multiplier, [wins, domain]));
    assert.ok(row.rtp.value <= 0.97 && 0.97 - row.rtp.value < Number(multiplier[0]) / Number(multiplier[1]) / Number(domain));
  }
  assert.equal(i.checks[1].detail.cap100.cashoutFirstWins, 97);
  assert.equal(i.checks[1].detail.cap100.crashFirstWins, 0);
  const tie = i.checks[2].detail.exactTie;
  assert.equal(BigInt(tie.inclusiveWins) - BigInt(tie.strictWins), 1n);
  assert.ok(i.checks[4].detail.correction.counts.every(count => count === 6));
});

audit('Iteration 8: natural probability and independent payout-rule difference', () => {
  const r = data.iterations[7].results;
  same(fraction(r.naturalProbability), [8n, 169n]);
  const drop = [3n * 8n * 161n, 10n * 169n * 169n];
  same(fraction(r.naturalPayoutReduction), drop);
  for (const dealer of ['S17', 'H17']) {
    const high = r.rules.find(row => row.dealer === dealer && row.naturalPayout === '3:2');
    const low = r.rules.find(row => row.dealer === dealer && row.naturalPayout === '6:5');
    close(high.expectedTotalReturn - low.expectedTotalReturn, Number(drop[0]) / Number(drop[1]));
  }
});

audit('Iteration 9: original slot mean, branching mean, and capped maximum', () => {
  const r = data.iterations[8].results;
  same(weightedMean(r.finiteBaseline.exactHistogram), target);
  same(fraction(r.finiteBaseline.immediateReturn), [776n, 1000n]);
  same(fraction(r.sameTableWithUncappedRetriggers.rtp), [776n * 4n, 1000n * 3n]);
  same(fraction(r.recalibratedUncappedRetriggers.rtp), target);
  assert.equal(r.cappedRetriggers.maxFreeSpins, 25);
  same(fraction(r.cappedRetriggers.rtpAfterRecalibration), target);
  same(fraction(r.cappedRetriggers.maximum), product([21n, 1n], fraction(r.cappedRetriggers.topPayoutAfterRecalibration)));
  assert.ok(r.cappedRetriggers.topTableRoundedToTwoDecimals[0].rtp.value < 0.97);
  assert.ok(r.cappedRetriggers.topTableRoundedToTwoDecimals[1].rtp.value > 0.97);
});

audit('Iteration 10: correlated risk, session expectation, and sample-size planning', () => {
  const r = data.iterations[9].results;
  close(r.crashExposure.twentyAt100.sharedVariance.value / r.crashExposure.twentyAt100.independentVariance.value, 20);
  assert.equal(r.crashExposure.twentyAt100.extraReserve, 2000 - 20);
  assert.equal(r.roulettePortfolio.independentSpins.twoNumbers.maxPayout, 72);
  for (const row of r.sessions) {
    close(row.probabilityPlayerProfit + row.probabilityPlayerLoss + row.probabilityBreakEven, 1);
    close(row.expectedPlayerNet, -0.04 * row.rounds);
    close(row.netSd, Math.sqrt(5.3184 * row.rounds));
  }
  for (const row of r.samplePlanning) {
    assert.equal(row.approximate95NormalSamples, Math.ceil((1.96 * row.sd / 0.001) ** 2));
    assert.equal(row.conservativeBernsteinSamples, Math.ceil(Math.log(40) * (2 * row.variance + 2 / 3 * row.max * 0.001) / 0.001 ** 2));
  }
});

audit('Report contains ten ordered iterations; generated text satisfies punctuation constraint', () => {
  const report = read(reportPath);
  assert.deepEqual([...report.matchAll(/^## Итерация (\d+)\./gm)].map(match => Number(match[1])), Array.from({ length: 10 }, (_, i) => i + 1));
  const paths = [aggregatePath, reportPath, 'docs/game-math-source-notes.md', 'scripts/game-math/verify.mjs', ...data.sources.map(source => source.path), ...data.iterations.map(i => `${base}/iteration-${String(i.id).padStart(2, '0')}.json`)];
  for (const path of paths) assert.ok(!read(path).includes(forbidden), path);
});

const evidence = {
  verifiedAt: new Date().toISOString(), iterationCount: 10, calculationCheckGroups: 57,
  auditCheckGroups: audits.length, audits,
  aggregateSha256: createHash('sha256').update(read(aggregatePath)).digest('hex'),
  reportSha256: createHash('sha256').update(read(reportPath)).digest('hex'),
  verifierSha256: createHash('sha256').update(read('scripts/game-math/verify.mjs')).digest('hex'),
};
writeFileSync(`${base}/verification.json`, JSON.stringify(evidence, null, 2) + '\n');
console.log(`Verified 10 iterations, 57 calculation check groups, and ${audits.length} evidence audit groups.`);
