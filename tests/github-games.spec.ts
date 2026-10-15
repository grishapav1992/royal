import { HALL_DOORS } from '../src/shared/world';
import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import { worldPoint } from './room-ui';

async function doorway(page: Page, x: number, y: number, target: string) {
  await page.evaluate(() => { (window as any).__githubDoorView = undefined; });
  await page.waitForFunction(() => {
    const key = JSON.stringify((window as any).royalDemo.getState().view), now = performance.now(), last = (window as any).__githubDoorView;
    if (!last || last.key !== key) { (window as any).__githubDoorView = { key, at: now }; return false; }
    return now - last.at >= 150;
  });
  const point = await worldPoint(page, x, y); await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().hall), { timeout: 18000 }).toBe(target);
}
async function enterCasinoFloor(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().hall)).toBe('arcade');
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
  await expect(page.locator('h1')).toHaveText('Казино и бар 01');
}
test('all five bundled games play on the first floor on desktop and mobile, then the doors lead back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://luelonplay.com/**', route => route.fulfill({ json: { games: [] } }));
  await page.goto('/?offline=1'); await expect(page.locator('#loading')).toHaveCount(0);
  await enterCasinoFloor(page);
  await page.screenshot({ path: 'artifacts/github-room/room-03.png' });
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/') || !request.url().startsWith('http://127.0.0.1:5228')) requests.push(request.url()); });
  for (const id of ['blackjack', 'poker', 'video-poker', 'baccarat', 'craps']) {
    await page.locator('#games-tab').click();
    await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(15);
    await expect(page.locator('.shared-cards')).toBeHidden();
    await page.locator(`[data-cabinet="github-${id}"]`).click();
    await expect(page.locator('.github-game')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#mini-title')).toHaveText(/Блэкджек|Покер|Видеопокер|Баккара|Craps/);
    await page.locator('.github-game [data-action="start"]').click();
    if (id === 'video-poker') {
      const held = await page.locator('[data-hold="0"] img').getAttribute('src');
      await page.locator('[data-hold="0"]').click(); await expect(page.locator('[data-hold="0"]')).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(250); await page.locator('[data-action="draw"]').click();
      await expect(page.locator('[data-hold="0"] img')).toHaveAttribute('src', held!);
    }
    if (id === 'blackjack' && await page.locator('[data-action="stand"]').count()) { await page.waitForTimeout(250); await page.locator('[data-action="stand"]').click(); }
    if (id === 'poker') for (let street = 0; street < 4; street++) { await page.waitForTimeout(250); await page.locator('[data-action="call"]').click(); }
    if (id === 'craps') for (let roll = 0; roll < 150 && await page.locator('[data-action="roll"]').count(); roll++) { await page.waitForTimeout(230); await page.locator('[data-action="roll"]').click(); }
    await expect(page.locator('.github-history span')).toHaveCount(1);
    await expect(page.locator('.github-result')).toContainText('Начислено');
    if (id !== 'craps') await expect(page.locator('.github-card img')).not.toHaveCount(0);
    await expect.poll(() => page.locator('.github-card img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('.github-game').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `artifacts/github-room/${id}-mobile.png` });
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#mini-game')).toBeEmpty();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  expect(requests).toEqual([]);
  await doorway(page, HALL_DOORS.arcade.click.x, HALL_DOORS.arcade.click.y, 'tables');
  await doorway(page, HALL_DOORS.tables.click.x, HALL_DOORS.tables.click.y, 'arcade');
  expect(errors).toEqual([]);
});
test('online first floor authorizes the relocated casino cabinets', async ({ page, roomPath }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://luelonplay.com/**', route => route.fulfill({ json: { games: [] } }));
  await page.goto(roomPath);
  await page.getByLabel('Почта', { exact: true }).fill(`github-room-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Github-room-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().online)).toBe(true);
  await enterCasinoFloor(page);
  await page.locator('#games-tab').click(); await page.locator('[data-cabinet="github-blackjack"]').click();
  await expect(page.locator('.github-game')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().playing)).toBe(true);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await doorway(page, HALL_DOORS.arcade.click.x, HALL_DOORS.arcade.click.y, 'tables'); await doorway(page, HALL_DOORS.tables.click.x, HALL_DOORS.tables.click.y, 'arcade');
  expect(errors).toEqual([]);
});
