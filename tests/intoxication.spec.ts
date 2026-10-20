import { test, expect, type Page } from '@playwright/test';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';
import { CABINETS } from '../src/shared/cabinets';
import { worldPoint } from './room-ui';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const net = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());

async function miraOffer(page: Page) {
  await page.route('**/api/npc/mira', route => route.fulfill({ json: {
    turns: [{ role: 'assistant', content: 'Тебе вино? Угощаю.' }],
    drinkOffer: 'wine', emotion: 'tease',
  } }));
}

async function visitBar(page: Page) {
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
}

async function drink(page: Page, id: string) {
  const button = page.locator(`[data-drink="${id}"]`);
  await expect(button).toBeEnabled({ timeout: 8000 });
  await button.click();
  await expect.poll(async () => (await state(page)).drink).toBe(id);
  await expect(button).toBeDisabled();
}

async function actualCabinet(page: Page, id: string) {
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
  const cabinet = CABINETS.find(item => item.id === id)!;
  const point = await worldPoint(page, cabinet.x, cabinet.y - 65);
  await page.mouse.click(point.x, point.y);
}

test('drinking is explicit, has multiple stages, persists offline and never prevents a game', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await miraOffer(page);
  await page.goto('/?offline=1');
  await page.locator('#loading').waitFor({ state: 'detached' });
  await visitBar(page);
  await expect(page.locator('.mira-drink-offer')).toContainText('Вино');
  await expect(page.locator('.mira-player-avatar')).toHaveAttribute('src', /^data:image\/png/);
  expect((await state(page)).intoxication.stage).toBe(0);
  await page.locator('.mira-drink-offer button').click();
  await expect.poll(async () => (await state(page)).drink).toBe('wine');
  expect((await state(page)).intoxication.stage).toBe(1);
  const wineDeadline = (await state(page)).soberAt;
  await page.getByRole('button', { name: 'Напитки', exact: true }).click();

  await drink(page, 'lemonade');
  expect((await state(page)).soberAt).toBe(wineDeadline);
  await drink(page, 'beer');
  expect((await state(page)).intoxication.stage).toBe(2);
  await drink(page, 'whisky');
  expect((await state(page)).intoxication.stage).toBe(3);
  await drink(page, 'whisky');
  const maximum = await state(page);
  expect(maximum.intoxication.remainingMs).toBeGreaterThan(MAX_SOBER_TIME_MS - 3000);
  expect(maximum.intoxication.remainingMs).toBeLessThanOrEqual(MAX_SOBER_TIME_MS);
  await expect.poll(() => page.locator('.mira-intoxication progress').evaluate(element => (element as HTMLProgressElement).value)).toBeGreaterThan(.99);
  await expect(page.locator('.mira-player-remaining')).toContainText('До трезвости');
  await page.screenshot({ path: 'artifacts/intoxication-maximum-dialog.png' });

  await page.reload();
  await page.locator('#loading').waitFor({ state: 'detached' });
  await expect.poll(async () => (await state(page)).intoxication.stage).toBe(3);
  expect((await state(page)).soberAt).toBe(maximum.soberAt);
  expect((await state(page)).intoxication.remainingMs).toBeLessThan(maximum.intoxication.remainingMs);
  await actualCabinet(page, 'royal-fruits');
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.ez-slots-game')).toBeVisible();
  await page.getByRole('button', { name: 'Правила игры', exact: true }).click();
  await expect(page.locator('.ez-fruits-paytable')).toBeVisible();
  await page.locator('[data-window-sheet="rules"] .game-window-sheet-close').click();
  expect((await state(page)).playing).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mini-dialog')).toBeHidden();
  await actualCabinet(page, 'royal-dice');
  await expect(page.locator('.original-game[data-game="royal-dice"]')).toBeVisible({ timeout: 15000 });
  expect((await state(page)).playing).toBe(true);
  expect((await state(page)).intoxication.stage).toBe(3);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  expect(errors).toEqual([]);
});

test('the real server owns intoxication, preserves it across login and handles a skewed client clock', async ({ page }) => {
  test.setTimeout(70000);
  const address = `intoxication-${crypto.randomUUID()}@example.test`, password = 'Royal-drinking-123!';
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 15 * 60 * 1000;
    localStorage.setItem('royal-offline-sober-at', String(Date.now() + 30 * 60 * 1000));
  });
  await miraOffer(page);
  const login = await page.context().request.post('/api/auth/login', { data: { email: address, password } });
  expect(login.ok()).toBe(true);
  expect((await page.context().request.post('/api/auth/character', { data: { skin: 0 } })).ok()).toBe(true);
  await page.goto('/');
  await expect.poll(async () => (await net(page))?.status).toBe('connected');
  await expect.poll(async () => (await state(page)).intoxication.stage).toBe(0);
  await visitBar(page);
  await page.getByRole('button', { name: 'Напитки', exact: true }).click();
  await drink(page, 'whisky');
  await expect.poll(async () => (await state(page)).intoxication.stage).toBe(2);
  const consumed = await state(page);
  expect(consumed.intoxication.level).toBeGreaterThan(.36);
  expect(consumed.intoxication.level).toBeLessThanOrEqual(.38);
  await page.getByRole('button', { name: 'Уйти', exact: true }).click();
  await expect(page.locator('#bar-dialog')).toBeHidden();
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await expect.poll(async () => (await state(page)).action, { timeout: 5000 }).not.toBe('drink');
  const clearFloor = { x: 720, y: 620 };
  const floor = await worldPoint(page, clearFloor.x, clearFloor.y);
  await page.mouse.click(floor.x, floor.y);
  await expect.poll(async () => {
    const current = await state(page);
    return Math.hypot(current.x - clearFloor.x, current.y - clearFloor.y);
  }, { timeout: 15000 }).toBeLessThan(3);
  await expect.poll(async () => (await state(page)).moving).toBe(false);
  const beforeMovement = await state(page);
  await page.keyboard.down('a');
  await page.waitForTimeout(400);
  await page.keyboard.up('a');
  await expect.poll(async () => (await state(page)).pendingInputs).toBe(0);
  await expect.poll(async () => {
    const current = await state(page);
    return Math.hypot(current.x - current.serverX, current.y - current.serverY);
  }).toBeLessThan(1);
  expect((await state(page)).x).toBeLessThan(beforeMovement.x - 20);

  expect((await page.context().request.post('/api/auth/logout')).ok()).toBe(true);
  await expect.poll(async () => (await net(page))?.status).toBe('disconnected');
  expect((await page.context().request.post('/api/auth/login', { data: { email: address, password } })).ok()).toBe(true);
  await page.reload();
  await expect.poll(async () => (await net(page))?.status).toBe('connected');
  await expect.poll(async () => (await state(page)).intoxication.stage).toBe(2);
  const restored = await state(page);
  expect(restored.intoxication.remainingMs).toBeGreaterThan(consumed.intoxication.remainingMs - 30000);
  expect(restored.intoxication.remainingMs).toBeLessThanOrEqual(consumed.intoxication.remainingMs + 200);
  await page.context().request.post('/api/auth/logout');
});
