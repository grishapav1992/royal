import { test, expect } from '@playwright/test';

test('retired Nile and direct TRON URLs cannot allocate an address or accept a payment', async ({ request }) => {
  for (const path of ['/api/nile-wallet', '/api/nile-play/deposit', '/api/nile-play/claim', '/api/game-wallet/deposit', '/api/usdt-wallet/deposit']) {
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(410);
    expect((await response.json()).code).toBe('PAYMENT_METHOD_RETIRED');
  }
  const methods = await (await request.get('/api/payment-methods')).json();
  expect(methods.methods.map((method: any) => method.id)).toEqual(['nowpayments', 'nowpayments-sandbox']);
});
