import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';

async function login(page: Page, path: string) {
  await page.goto(path);
  await page.getByLabel('Почта', { exact: true }).fill('wallet-' + crypto.randomUUID() + '@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('Wallet-fixture-42!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().online)).toBe(true);
}

for (const width of [1440, 390]) test('cash and Sandbox wallets remain available with Stars disabled at ' + width + 'px', async ({ page, roomPath }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, roomPath);
  await expect(page.locator('#crypto-wallet-button')).toHaveText('Денежный баланс');
  await expect(page.locator('#wallet-button')).toContainText('Sandbox');
  await expect(page.locator('#nile-wallet-button, #usdt-wallet-button')).toHaveCount(0);
  await page.locator('#wallet-button').click();
  await expect(page.locator('#wallet-title')).toHaveText('Тестовый баланс');
  await expect(page.locator('#wallet-deposit, #wallet-amount')).toHaveCount(0);
  const box = (await page.locator('#wallet-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath('sandbox-' + width + '.png') });
  await page.locator('#wallet-close').click();
  await page.screenshot({ path: info.outputPath('choices-' + width + '.png') });
  await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-wallet-title')).toHaveText('Денежный баланс');
  await expect(page.locator('#crypto-wallet-dialog')).toContainText('отдельно от тестового');
  await page.screenshot({ path: info.outputPath('live-' + width + '.png') });
  expect(errors).toEqual([]);
});

test('Sandbox recovers a lost create response after reload with one credit', async ({ page, roomPath }) => {
  test.skip(process.env.ROYAL_SANDBOX_BROWSER !== 'true', 'Requires the isolated Sandbox test server.');
  test.setTimeout(60000); await login(page, roomPath);
  let requests = 0, operation = '';
  await page.route('**/api/nowpayments-sandbox/deposits', async route => {
    const body = route.request().postDataJSON(); requests++;
    if (!operation) operation = body.id; expect(body.id).toBe(operation);
    if (requests === 1) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('failed'); }
    else await route.continue();
  });
  await page.locator('#wallet-button').click();
  await expect(page.locator('#nowpayments-sandbox')).toBeVisible();
  await page.locator('#sandbox-amount').fill('2375');
  await page.locator('#sandbox-deposit button').click();
  await expect(page.locator('#sandbox-retry')).toBeVisible();
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#wallet-button').click(); await page.locator('#sandbox-retry').click();
  await expect(page.locator('#sandbox-retry')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(/2\s375/, { timeout: 30000 });
  await expect(page.locator('#wallet-history [data-kind="deposit"]')).toHaveCount(1);
  expect(requests).toBe(2);
  await page.locator('#sandbox-refresh').click();
  await expect(page.locator('#wallet-history [data-kind="deposit"]')).toHaveCount(1);
});

test('the public wallet refuses new direct top-ups without changing the balance', async ({ page, roomPath, request }) => {
  expect((await request.get('/api/demo-wallet')).status()).toBe(401);
  await login(page, roomPath);
  const outcome = await page.evaluate(async () => {
    const { account } = await (await fetch('/api/auth/me')).json();
    const headers = { 'Content-Type': 'application/json', 'X-Royal-Account-Id': account.id };
    const before = await (await fetch('/api/demo-wallet', { headers })).json();
    const response = await fetch('/api/demo-wallet/operations', { method: 'POST', headers,
      body: JSON.stringify({ id: crypto.randomUUID(), kind: 'deposit', amount: 1000 }) });
    const after = await (await fetch('/api/demo-wallet', { headers })).json();
    return { before, after, status: response.status };
  });
  expect(outcome.status).toBe(410); expect(outcome.after).toEqual(outcome.before);
});

test('both payment modes remain clear after switching to English', async ({ page, roomPath }) => {
  await login(page, roomPath);
  await page.getByRole('combobox', { name: 'Язык', exact: true }).selectOption('en');
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#crypto-wallet-button')).toHaveText('Cash balance');
  await page.locator('#wallet-button').click();
  await expect(page.locator('#wallet-title')).toHaveText('Test balance');
  await expect(page.locator('#nowpayments-sandbox')).toBeVisible();
  await expect(page.locator('#wallet-dialog')).not.toContainText(/[А-Яа-яЁё]/);
});
