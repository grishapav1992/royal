import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoConfig } from '../server/crypto/config';
import { NowPayments } from '../server/crypto/nowpayments';

const catalog = { currencies: [
  { code: 'USDTTRC20', name: 'Tether', network: 'trx', enable: true },
  { code: 'BTC', name: 'Bitcoin', network: 'btc', enable: true },
  { code: 'XRP', name: 'XRP', network: 'xrp', enable: true, extra_id_exists: true },
  { code: 'ETH', name: 'Ethereum', network: 'eth', enable: true },
  { code: 'LTC', name: 'Litecoin', network: 'ltc', enable: false },
] };

function provider(merchant: unknown, calls: string[]) {
  return new NowPayments(cryptoConfig({}), async input => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    return Response.json(path.endsWith('/full-currencies') ? catalog : merchant);
  });
}

test('NOWPayments selectedCurrencies response limits the catalog to enabled merchant routes', async () => {
  const calls: string[] = [];
  const client = provider({ selectedCurrencies: ['USDTTRC20', 'XRP', 'LTC'] }, calls);
  assert.deepEqual(await client.currencies(), [
    { code: 'usdttrc20', name: 'Tether', network: 'trx', memo: false },
    { code: 'xrp', name: 'XRP', network: 'xrp', memo: true },
  ]);
  await client.currencies();
  assert.deepEqual(calls.sort(), ['/v1/full-currencies', '/v1/merchant/coins']);
});

test('unrecognized merchant currency data cannot enable the full catalog', async () => {
  for (const response of [{}, { currencies: ['BTC'] }, { selectedCurrencies: null }, { selectedCurrencies: [{ code: 'BTC' }] }]) {
    await assert.rejects(() => provider(response, []).currencies(), /Invalid provider currencies/);
  }
  assert.deepEqual(await provider({ selectedCurrencies: [] }, []).currencies(), []);
});
