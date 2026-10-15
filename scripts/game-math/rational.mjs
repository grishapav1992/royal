import assert from 'node:assert/strict';

export function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function q(n, d = 1n) {
  n = BigInt(n);
  d = BigInt(d);
  if (d === 0n) throw new RangeError('Zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function decimal(value) {
  const s = String(value);
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(s)) throw new RangeError('Expected plain decimal');
  const [whole, fraction = ''] = s.split('.');
  return q(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}

export const add = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a, b) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => q(a.n * b.n, a.d * b.d);
export const div = (a, b) => q(a.n * b.d, a.d * b.n);
export const cmp = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export const number = a => Number(a.n) / Number(a.d);
export const sum = values => values.reduce(add, q(0));
export const exact = a => `${a.n}/${a.d}`;
export const view = a => ({ fraction: exact(a), value: number(a) });
export function equal(a, b, message = 'Rational values differ') {
  assert.equal(cmp(a, b), 0, `${message}: ${exact(a)} vs ${exact(b)}`);
}

export function choose(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0) throw new RangeError('Invalid binomial inputs');
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let result = 1n;
  for (let i = 1; i <= k; i++) result = result * BigInt(n - k + i) / BigInt(i);
  return result;
}

export function floorPayout(stakeUnits, multiplier) {
  const stake = BigInt(stakeUnits);
  if (stake <= 0n || multiplier.n < 0n) throw new RangeError('Invalid payment inputs');
  return stake * multiplier.n / multiplier.d;
}

export function distributionStats(rows, stakeUnits) {
  equal(sum(rows.map(row => row.p)), q(1), 'Distribution mass');
  const payouts = rows.map(row => stakeUnits === undefined ? row.m : q(floorPayout(stakeUnits, row.m), BigInt(stakeUnits)));
  const mean = sum(rows.map((row, i) => mul(row.p, payouts[i])));
  const second = sum(rows.map((row, i) => mul(row.p, mul(payouts[i], payouts[i]))));
  const variance = sub(second, mul(mean, mean));
  const profit = sum(rows.filter((row, i) => cmp(payouts[i], q(1)) > 0).map(row => row.p));
  const positive = sum(rows.filter((row, i) => cmp(payouts[i], q(0)) > 0).map(row => row.p));
  const max = payouts.reduce((a, b) => cmp(a, b) > 0 ? a : b, q(0));
  return { rtp: view(mean), variance: view(variance), sd: Math.sqrt(number(variance)), profitProbability: view(profit), positivePayoutProbability: view(positive), maxMultiplier: view(max) };
}

export const target = q(97, 100);
