import { test, expect, type Page, type Route } from '@playwright/test';
const wallet = () => ({ state: 'enabled', provider: 'nowpayments', asset: 'USDT', scale: 6, balanceUnits: '20000000', reservedUnits: '0', withdrawalsEnabled: false, gamesEnabled: false, ready: false, maxStakeUnits: { 'royal-coins': '0', 'royal-roulette': '0' }, operations: [] as any[], rounds: [] });
const operation = (id: string, currency: string, address: string) => ({ id, kind: 'deposit', state: 'waiting', amountUnits: '20000000', creditedUnits: '0', currency, address, memo: '', payAmount: currency === 'btc' ? '0.0002' : '20', txHash: '', createdAt: Date.now() });
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`review-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Review-test-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-deposit-currency option')).toHaveCount(2);
}
async function coins(page: Page) {
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [{ code: 'btc', name: 'Bitcoin', network: 'btc', memo: false }, { code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }] } }));
}
for (const priorPayment of [false, true]) {
  test(`new payment preserves its own address while snapshot is delayed (prior payment: ${priorPayment})`, async ({ page }) => {
    const state = wallet();
    if (priorPayment) state.operations = [operation(crypto.randomUUID(), 'btc', 'bc1q' + 'a'.repeat(38))];
    let created = false;
    const held: Route[] = [];
    await page.route('**/api/crypto-wallet', route => created ? void held.push(route) : route.fulfill({ json: state }));
    await coins(page);
    const newAddress = 'T' + 'C'.repeat(33);
    await page.route('**/api/crypto-wallet/deposits', route => {
      const request = route.request().postDataJSON();
      state.operations.unshift(operation(request.id, request.currency, newAddress));
      created = true;
      return route.fulfill({ json: state.operations[0] });
    });
    await login(page);
    await page.getByRole('button', { name: 'Оплатить', exact: true }).click();
    await expect(page.locator('#crypto-payment-dialog')).toBeVisible();
    try {
      await expect(page.locator('#crypto-deposit-address')).toHaveValue(newAddress);
      await expect(page.locator('#crypto-deposit-details')).toBeVisible();
      await expect(page.locator('#crypto-deposit-network')).toContainText('Сеть: TRX');
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await page.locator('#crypto-payment-close').click();
      await page.locator('#crypto-deposit-continue').click();
      await expect(page.locator('#crypto-deposit-address')).toHaveValue(newAddress);
    } finally {
      for (const route of held) await route.fulfill({ json: state });
    }
  });
}

for (const field of ['address', 'memo'] as const) {
  for (const denied of [false, true]) {
    test('copy ' + field + ' feedback is visible inside checkout (denied: ' + denied + ')', async ({ page }) => {
      const state = wallet(); state.operations = [{ ...operation(crypto.randomUUID(), 'usdttrc20', 'T' + 'C'.repeat(33)), memo: '1234567' }];
      await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
      await coins(page); await login(page);
      await page.locator('#crypto-deposit-continue').click();
      await page.evaluate(denied => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { if (denied) throw new Error('Clipboard denied'); } }, configurable: true }), denied);
      await page.locator(field === 'address' ? '#crypto-deposit-copy' : '#crypto-deposit-memo-copy').click();
      const expected = field === 'address' ? (denied ? 'Скопируй адрес из поля вручную.' : 'Адрес скопирован.') : (denied ? 'Скопируй memo из поля вручную.' : 'Memo скопирован.');
      await expect(page.locator('#crypto-payment-feedback')).toContainText(expected);
      await expect(page.locator('#crypto-payment-feedback')).toBeVisible();
      await expect(page.locator('#crypto-payment-message')).toHaveText('Ожидает перевода');
      await page.locator('#crypto-payment-refresh').click();
      await expect(page.locator('#crypto-payment-feedback')).toContainText(expected);
    });
  }
}
test('late clipboard result cannot reappear after an account change', async ({ page }) => {
  const state = wallet(); state.operations = [operation(crypto.randomUUID(), 'usdttrc20', 'T' + 'C'.repeat(33))];
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await coins(page); await login(page); await page.locator('#crypto-deposit-continue').click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => new Promise<void>(resolve => { (window as any).finishCopy = resolve; }) }, configurable: true }));
  await page.locator('#crypto-deposit-copy').click();
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('royal-account', { detail: null })); (window as any).finishCopy(); });
  await expect(page.locator('#crypto-payment-dialog')).toBeHidden();
  await expect(page.locator('#crypto-payment-feedback')).toHaveText('');
  await expect(page.locator('#crypto-deposit-address')).toHaveValue('');
});
