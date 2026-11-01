import { test, expect, type Page } from '@playwright/test';
import { STREET } from '../src/shared/street';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
async function worldPoint(page: Page, x: number, y: number) {
  await page.bringToFront();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!;
  const { view } = await state(page);
  return { x: box.x + (x - view.x) * view.zoom * box.width / view.width, y: box.y + (y - view.y) * view.zoom * box.height / view.height };
}
async function overview(page: Page, on: boolean) {
  const button = page.locator('#room-overview');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(on);
}
async function walk(page: Page, x: number, y: number) {
  const point = await worldPoint(page, x, y);
  const tolerance = Math.max(5, 2 / (await state(page)).view.zoom);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => { const p = await state(page); return Math.hypot(p.x - x, p.y - y); }, { timeout: 20000 }).toBeLessThan(tolerance);
  await expect.poll(async () => { const p = await state(page); return Math.hypot(p.serverX - p.x, p.serverY - p.y); }).toBeLessThan(3);
}

test('walk outside, circle the casino, reconnect and return through the same entrance with chat', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`street-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Street-browser-test!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible({timeout:15000});
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect.poll(async () => (await state(page)).online).toBe(true);
  await expect(page.locator('#chat-panel')).toBeVisible();
  await expect(page.locator('#chat-input')).toBeEnabled();
  const balance = await page.locator('#wallet-balance').textContent();
  const network = await page.evaluate(() => (window as any).royalDemo.getNetworkState());
  expect(network.roomId).toBeTruthy();
  await overview(page,true);
  await page.screenshot({path:`../street-${info.project.name}-first-floor.png`});
  await page.locator('[data-floor-target="street"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('street');
  await overview(page, false);
  await expect(page.locator('h1')).toContainText('Улица казино');
  await expect(page.locator('#chat-input')).toBeEnabled();
  const streetBefore=(await state(page)).street;
  expect(streetBefore.pedestrians).toHaveLength(5);
  await expect.poll(async () => (await state(page)).street.pedestrians[0].x).not.toBe(streetBefore.pedestrians[0].x);
  await expect.poll(async () => (await state(page)).street.cars[0].x).not.toBe(streetBefore.cars[0].x);
  await expect.poll(async () => (await state(page)).street.sign.sheen,{timeout:10000}).toBeGreaterThan(0);
  await page.screenshot({ path: `../street-${info.project.name}-entrance.png` });
  await overview(page, true);
  await page.screenshot({ path: `../street-${info.project.name}-overview.png` });
  for (const p of STREET.loop) await walk(page, p.x, p.y);
  await walk(page, 1300, 360);
  await overview(page, false);
  await page.screenshot({ path: `../street-${info.project.name}-rear.png` });
  // Reload while outdoors must recover the room and location, rather than spawning indoors.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await expect(page.locator('#chat-input')).toBeEnabled();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('street');
  const recovered = await page.evaluate(() => (window as any).royalDemo.getNetworkState());
  expect(recovered.roomId).toBe(network.roomId);
  await expect.poll(async () => (await state(page)).street.motion).toBe(false);
  const frozen=(await state(page)).street;
  await page.waitForTimeout(400);
  const still=(await state(page)).street;
  expect(still.time).toBe(frozen.time);
  expect(still.cars).toEqual(frozen.cars);
  expect(still.pedestrians.every((p:any)=>!p.moving)).toBe(true);
  expect(still.sign.sheen).toBe(0);
  expect(still.sign.sparkle).toBe(0);
  await page.locator('[data-floor-target="arcade"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('arcade');
  await expect(page.locator('#chat-input')).toBeEnabled();
  expect(await page.locator('#wallet-balance').textContent()).toBe(balance);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
