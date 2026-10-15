import { test, expect, type Page } from '@playwright/test';
import { NILE_WALLET_SCOPE } from '../src/shared/nileWallet';
const address = 'TQXj2m3KDSCbLXZHyQs1YFtmnjGQntfWi7';
const assigned = () => ({ ...NILE_WALLET_SCOPE, state: 'assigned', address, balanceUnits: '1000000000', updatedAt: Date.now(), ledgerHeight: 71593249,
  deposits: [{ txId: '050266479a54e3d114763f0f78fafa6acaff782c2b315cd299e372eac79f16d4', logIndex: 0, height: 71593249, amountUnits: '1000000000' }] });
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`nile-ui-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Nile-UI-test-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
}
test('test wallet shows the fixed Nile address, exact amount, history and stays inside a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/nile-wallet', route => route.fulfill({ json: assigned() }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.getByRole('button', { name: 'Открыть тестовый кошелёк Nile' }).click();
  await expect(page.locator('#nile-wallet-balance')).toHaveText(/1\s000/);
  await expect(page.locator('#nile-wallet-address')).toHaveValue(address);
  await expect(page.locator('#nile-wallet-history li')).toHaveCount(1);
  await expect(page.locator('#nile-wallet-dialog')).toContainText('Ставки, переводы и вывод этого баланса пока недоступны.');
  const box = (await page.locator('#nile-wallet-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Закрыть тестовый кошелёк' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/nile-wallet-mobile.png' });
  await page.getByRole('button', { name: 'Закрыть тестовый кошелёк' }).click();
  await expect(page.locator('#nile-wallet-dialog')).toBeHidden(); expect(errors).toEqual([]);
});
test('an unavailable refresh removes the old balance and address, then allows recovery', async ({ page }) => {
  let failure = false;
  await page.route('**/api/nile-wallet', route => route.fulfill(failure ? { status: 503, json: { error: 'Не удалось подтвердить актуальный тестовый баланс.' } } : { json: assigned() }));
  await login(page); await page.locator('#nile-wallet-button').click();
  await expect(page.locator('#nile-wallet-balance')).toHaveText(/1\s000/);
  failure = true; await page.locator('#nile-wallet-refresh').click();
  await expect(page.locator('#nile-wallet-message')).toContainText('Не удалось подтвердить');
  await expect(page.locator('#nile-wallet-content')).toBeHidden(); await expect(page.locator('#nile-wallet-address')).toHaveValue('');
  failure = false; await page.locator('#nile-wallet-refresh').click(); await expect(page.locator('#nile-wallet-balance')).toHaveText(/1\s000/);
});
test('switching accounts discards an in-flight wallet response and displays an unassigned account', async ({ page }) => {
  let release!: () => void, intercepted!: () => void;
  const started = new Promise<void>(resolve => { intercepted = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; }); let requests = 0;
  await page.route('**/api/nile-wallet', async route => {
    if (++requests === 1) { intercepted(); await hold; await route.fulfill({ json: assigned() }); }
    else await route.fulfill({ json: { ...NILE_WALLET_SCOPE, state: 'unassigned' } });
  });
  await login(page); await page.locator('#nile-wallet-button').click(); await started;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('royal-account', { detail: crypto.randomUUID() })));
  release(); await expect(page.locator('#nile-wallet-dialog')).toBeHidden();
  await page.locator('#nile-wallet-button').click(); await expect(page.locator('#nile-wallet-message')).toContainText('ещё не привязан');
  await expect(page.locator('#nile-wallet-content')).toBeHidden(); await expect(page.locator('#nile-wallet-address')).toHaveValue('');
});
test('the real endpoint denies anonymous access, lookup parameters and mutations', async ({ page, request }) => {
  expect((await request.get('/api/nile-wallet')).status()).toBe(401);
  await login(page);
  expect((await page.request.get('/api/nile-wallet?userId=nile_deposit_001')).status()).toBe(400);
  expect((await page.request.post('/api/nile-wallet', { data: { userId: 'nile_deposit_001', amountUnits: '1000000000' } })).status()).toBe(405);
  const response = await page.request.get('/api/nile-wallet'); expect(response.status()).toBe(200);
  const wallet = await response.json();
  expect(['disabled', 'unassigned']).toContain(wallet.state); expect(wallet.spendable).toBe(false); expect(wallet.address).toBeUndefined();
});
