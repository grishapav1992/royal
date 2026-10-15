import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CryptoDisplayRates } from '../server/crypto/displayRates';
import { fiatEquivalent, validDisplayRate } from '../src/shared/cryptoDisplay';

test('display equivalents preserve tiny USDT balances and round independently of the ledger', () => {
  assert.equal(fiatEquivalent('20000000', '84.98925799'), '1699.79');
  assert.equal(fiatEquivalent('1', '84.98925799'), '0.00');
  assert.equal(fiatEquivalent('1000000', '1.005'), '1.01');
  assert.equal(fiatEquivalent('1000000000000', '453.17939555'), '453179395.55');
  assert.throws(() => fiatEquivalent('20000000', '0'));
});

test('display rate cache deduplicates requests, expires, and never substitutes USDT equals USD', async () => {
  let now = 100000, calls = 0;
  const rates = new CryptoDisplayRates(async (from, to, amount) => {
    assert.equal(from, 'usdttrc20'); assert.equal(to, 'rub'); assert.equal(amount, '1'); calls++; return '84.98925799';
  }, () => now);
  const [a, b] = await Promise.all([rates.get('RUB'), rates.get('RUB')]);
  assert.deepEqual(a, b); assert.equal(calls, 1); assert.equal(validDisplayRate(a, now), true);
  now += 60000; assert.equal(validDisplayRate(a, now), false);
  await rates.get('RUB'); assert.equal(calls, 2);
  await assert.rejects(() => rates.get('../balance')); assert.equal(calls, 2);
  const unavailable = new CryptoDisplayRates(async () => { throw new Error('provider-key-secret'); });
  await assert.rejects(() => unavailable.get('USD'), error => error instanceof Error && !error.message.includes('provider-key-secret'));
});
