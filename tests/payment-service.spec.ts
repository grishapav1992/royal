import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill('separate-payment-' + crypto.randomUUID() + '@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('Separate-payment-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти в зал', exact: true })).toBeVisible();
  if (await page.locator('#character-grid button').count()) await page.locator('#character-grid button').first().click();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-deposit-currency option')).toHaveCount(1);
}
test('browser, game and separate gateway credit only the settled USDT and retain it through reload', async ({ page }) => {
  await login(page); await expect(page.locator('#crypto-wallet-balance')).toHaveText('0');
  await page.getByRole('button', { name: 'Оплатить', exact: true }).click();
  await expect(page.locator('#crypto-payment-dialog')).toBeVisible();
  await expect(page.locator('#crypto-deposit-address')).toHaveValue('T' + 'A'.repeat(33));
  expect((await page.request.post('http://127.0.0.1:2591/test/settle')).ok()).toBe(true);
  await page.locator('#crypto-payment-refresh').click();
  await expect(page.locator('#crypto-payment-result')).toHaveText('На баланс зачислено 19 USDT.');
  await page.locator('#crypto-payment-close').click(); await expect(page.locator('#crypto-wallet-balance')).toHaveText('19');
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#crypto-wallet-button').click(); await expect(page.locator('#crypto-wallet-balance')).toHaveText('19');
  expect((await page.request.post('http://127.0.0.1:2591/test/settle')).ok()).toBe(true);
  await page.locator('#crypto-wallet-refresh').click(); await expect(page.locator('#crypto-wallet-balance')).toHaveText('19');
});
test('a lost game response retries the original request without creating another provider payment', async ({ page }) => {
  const before = await (await page.request.get('http://127.0.0.1:2591/test/stats')).json();
  let first = true;
  await page.route('**/api/crypto-wallet/deposits', async route => {
    const response = await route.fetch();
    if (first) { first = false; await route.abort('failed'); } else await route.fulfill({ response });
  });
  await login(page); await page.getByRole('button', { name: 'Оплатить', exact: true }).click();
  await expect(page.locator('#crypto-wallet-retry')).toBeVisible();
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#crypto-wallet-button').click(); await page.locator('#crypto-wallet-retry').click();
  await expect(page.locator('#crypto-payment-dialog')).toBeVisible();
  const after = await (await page.request.get('http://127.0.0.1:2591/test/stats')).json();
  expect(after.creates - before.creates).toBe(1);
});
test('a signed-in browser cannot manufacture a credit through the service endpoint', async ({ page }) => {
  await login(page);
  const response = await page.request.post('http://127.0.0.1:2590/internal/payments/events', { data: { user_id: crypto.randomUUID(), deposit_amount: '1000000' } });
  expect(response.status()).toBe(401);
  await page.locator('#crypto-wallet-refresh').click(); await expect(page.locator('#crypto-wallet-balance')).toHaveText('0');
});
