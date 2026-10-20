import { expect } from '@playwright/test';
import { test } from './themed-room';

test('six upstream game cabinets open and fully custom games are absent', async ({ page, roomPath }) => {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Cabinet browser error:', error.message); });
  await page.goto(roomPath);
  await page.getByLabel('Почта', { exact: true }).fill(`cabinets-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-cabinet-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  await page.locator('#room-overview').click();
  await page.screenshot({ path: 'artifacts/own-cabinets-hall.png' });
  const games = [
    ['royal-fruits', 'Royal Fruits'],
    ['royal-dice', 'Royal Dice'],
    ['royal-limbo', 'Royal Limbo'],
    ['royal-mines', 'Royal Mines'],
    ['royal-plinko', 'Завеса ночи · Plinko'],
    ['royal-keno', 'Royal Keno'],
  ];
  for (const [id, name] of games) {
    await page.locator('#games-tab').click();
    await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(15);
    await expect(page.locator('[data-cabinet="royal-coins"], [data-cabinet="royal-flight"], [data-cabinet="royal-wheel"]')).toHaveCount(0);
    await page.locator(`[data-cabinet="${id}"]`).click();
    try { await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 20000 }); }
    catch (error) {
      console.error('Cabinet diagnostics:', JSON.stringify(await page.evaluate(() => ({ game: document.querySelector('#mini-dialog')?.getAttribute('data-game'), state: (window as any).royalDemo?.getState(), network: (window as any).royalDemo?.getNetworkState() }))), errors);
      throw error;
    }
    await expect(page.locator('#mini-title')).toHaveText(name);
    await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game', id);
    await expect(page.locator('#mini-message')).toBeHidden();
    await expect(page.locator('#mini-game')).not.toBeEmpty();
    await expect(page.locator('#coins-game')).toHaveCount(0);
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#mini-dialog')).toBeHidden();
    await expect(page.locator('#mini-game')).toBeEmpty();
  }
  expect(errors).toEqual([]);
});
