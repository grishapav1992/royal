import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) test(`Stars checkout shows the fixed USDT amount and restores the same invoice at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const orders: any[] = []; let creates = 0;
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: { state: 'enabled', provider: 'nowpayments', asset: 'USDT', scale: 6,
    balanceUnits: '0', reservedUnits: '0', withdrawalsEnabled: true, gamesEnabled: false, ready: false,
    maxStakeUnits: { 'royal-coins': '0', 'royal-roulette': '0' }, operations: [], rounds: [] } }));
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [] } }));
  await page.route('**/api/crypto-wallet/stars', route => {
    if (route.request().method() === 'POST') {
      const value = route.request().postDataJSON(); creates++;
      expect(value.termsAccepted).toBe(true); expect(value.stars).toBe(500);
      const order = { ...value, amountUnits: '5000000', status: 'waiting', expiresAt: Date.now() + 1800000,
        botUrl: 'https://t.me/RoyalFixtureBot?start=pay_' + value.id };
      orders.push(order); return route.fulfill({ json: order });
    }
    return route.fulfill({ json: { enabled: true, unitsPerStar: '10000', termsUrl: 'https://royal.example/terms', operations: orders } });
  });
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`stars-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Stars-test-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#telegram-stars')).toBeVisible();
  await page.locator('#stars-amount').fill('500');
  await expect(page.locator('#stars-rate')).toHaveText('500 Stars: 5 USDT на баланс');
  await page.locator('#stars-terms').check(); await page.locator('#stars-create').click();
  await expect(page.locator('#stars-history')).toContainText('500 Stars · 5 USDT');
  await expect(page.locator('#stars-history a')).toHaveAttribute('href', orders[0].botUrl);
  const widthInDialog = await page.locator('#crypto-wallet-dialog').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(widthInDialog.scroll).toBeLessThanOrEqual(widthInDialog.client + 1);
  await page.screenshot({ path: `artifacts/work/telegram-stars-20261028/stars-${width}.png` });
  await page.locator('#crypto-wallet-close').click(); await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#stars-history a')).toHaveAttribute('href', orders[0].botUrl);
  expect(creates).toBe(1);
});
