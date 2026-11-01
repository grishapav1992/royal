import { test, expect, type Page } from '@playwright/test';
import type { HallId } from '../src/shared/world';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const feedback = (page: Page) => page.evaluate(() => (window as any).royalDemo.getElevator());
async function worldPoint(page: Page, x: number, y: number) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!, { view } = await state(page);
  return { x: box.x + (x - view.x) * view.zoom * box.width / view.width, y: box.y + (y - view.y) * view.zoom * box.height / view.height };
}
async function loaded(page: Page, path = '/?offline=1') {
  await page.goto(path);await expect(page.locator('#loading')).toHaveCount(0, { timeout: 30000 });
}
async function call(page: Page) {
  await page.bringToFront();
  await page.locator('#elevator-shortcut').click();
  await expect(page.locator('#elevator-dialog')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#elevator-dialog')).toHaveAttribute('data-phase', 'choose');
}
async function travel(page: Page, target: HallId) {
  await page.bringToFront();
  await page.locator(`[data-elevator-floor="${target}"]`).click();
  await expect(page.locator('#elevator-dialog')).toHaveAttribute('data-phase', 'closing');
  await expect.poll(async () => (await state(page)).hall).toBe(target);
  await expect(page.locator('#elevator-dialog')).toBeHidden();
  const s = await state(page), { dock } = await feedback(page);
  expect(Math.hypot(s.x - dock.arrival.x, s.y - dock.arrival.y)).toBeLessThan(3);
  await expect.poll(async () => (await state(page)).locked).toBe(false);
}

test('desktop cabin travels directly across all floors, returns control and leaves stairs usable', async ({ page }) => {
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));
  await loaded(page);await call(page);
  expect(await page.locator('[data-elevator-floor]').count()).toBe((await feedback(page)).floors.length);
  await expect(page.locator('[data-elevator-floor="arcade"]')).toBeDisabled();
  await page.screenshot({ path: 'artifacts/work/hall-elevator/panel-desktop.png' });
  await travel(page, 'github');
  await call(page);await travel(page, 'tables');
  await call(page);await travel(page, 'arcade');
  await expect.poll(async () => (await feedback(page)).audio.active).toBe(0);
  expect((await feedback(page)).audio.played.arrive).toBe(3);
  // E at the dock opens the same picker, Escape restores walking without travelling.
  await page.locator('#elevator-shortcut').click();await expect(page.locator('#elevator-dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#elevator-dialog')).toBeHidden();
  await page.locator('#game').focus();await page.keyboard.press('e');await expect(page.locator('#elevator-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-floor-target="tables"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 20000 }).toBe('tables');
  await call(page);
  // The click would otherwise start travel after the closing phase. Hiding cancels it.
  await page.locator('[data-elevator-floor="github"]').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#elevator-dialog')).toBeHidden();
  await page.evaluate(() => {
    delete (document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await state(page)).hall).toBe('tables');
  await expect.poll(async () => (await feedback(page)).audio.active).toBe(0);
  expect(errors).toEqual([]);
});

test('mobile picker fits, respects mute/reduced motion and can be reached through the world entrance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { localStorage.setItem('royal-muted', '1'); });
  await loaded(page);await call(page);
  await page.screenshot({ path: 'artifacts/work/hall-elevator/panel-mobile.png' });
  const box = (await page.locator('#elevator-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);expect(box.y + box.height).toBeLessThanOrEqual(844);
  await travel(page, 'github');
  expect((await feedback(page)).audio.played).toEqual({});
  await page.locator('#room-overview').click();
  const { dock } = await feedback(page), point = await worldPoint(page, dock.entry.x, dock.entry.y);
  await page.mouse.click(point.x, point.y);await expect(page.locator('#elevator-dialog')).toBeVisible();
  await travel(page, 'arcade');
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
});

test('English names and cabin labels follow the current hall registry', async ({ page }) => {
  await loaded(page, '/?offline=1&lang=en');await call(page);
  await expect(page.locator('#elevator-title')).toHaveText('Elevator');
  await expect(page.locator('.elevator-status')).toHaveText('Go directly to any floor');
  await expect(page.locator('[data-elevator-floor="github"]')).toContainText('Card lounge');
  await travel(page, 'github');
});

test('cancelling the motor preserves the current envelope without an amplitude spike', async ({ page }) => {
  await loaded(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/game/ElevatorAudio.ts';
    const { ElevatorAudio } = await import(modulePath);
    const c = new OfflineAudioContext(1, 48000, 48000);
    // Offline rendering is scheduled while suspended; emulate the live context gate only.
    const context = new Proxy(c, { get(target, key) {
      if (key === 'state') return 'running';
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const audio = new ElevatorAudio({ context, output: c.destination,
      getPreferences: () => ({ muted: false, volume: 1, casinoEnabled: false }), onPreferences: () => () => {} });
    audio.play('ride');
    const paused = c.suspend(.34), complete = c.startRendering();await paused;
    const at = c.currentTime;audio.cancel();await c.resume();
    const data = (await complete).getChannelData(0), center = Math.round(at * c.sampleRate);
    let before = 0, after = 0;
    for (let i = center - 480; i < center; i++) before = Math.max(before, Math.abs(data[i]));
    for (let i = center; i < center + 480; i++) after = Math.max(after, Math.abs(data[i]));
    const jump = Math.abs(data[center] - data[center - 1]);audio.dispose();
    return { before, after, jump };
  });
  expect(result.before).toBeGreaterThan(.001);
  expect(result.after).toBeLessThan(result.before * 1.2);
  expect(result.jump).toBeLessThan(.001);
});

test('two online visitors use independent cabins and receive authoritative arrivals', async ({ page, browser }) => {
  async function join(visitor: Page) {
    await loaded(visitor, '/');
    await visitor.getByLabel('Почта', { exact: true }).fill(`elevator-${crypto.randomUUID()}@example.test`);
    await visitor.getByLabel('Пароль', { exact: true }).fill('Elevator-browser-password!');
    await visitor.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(visitor.locator('#character-step')).toBeVisible();
    await visitor.getByRole('button', { name: 'Войти в зал', exact: true }).click();
    await expect.poll(async () => (await state(visitor)).online, { timeout: 15000 }).toBe(true);
    await expect(visitor.locator('#join-dialog')).toBeHidden();
  }
  await join(page);
  const secondContext = await browser.newContext(), other = await secondContext.newPage();
  try {
    await join(other);
    expect(await page.evaluate(() => (window as any).royalDemo.getNetworkState().roomId))
      .toBe(await other.evaluate(() => (window as any).royalDemo.getNetworkState().roomId));
    await call(page);await call(other);
    await travel(page, 'github');
    expect((await state(other)).hall).toBe('arcade');await expect(other.locator('#elevator-dialog')).toBeVisible();
    await travel(other, 'tables');
    expect((await state(page)).hall).toBe('github');
    await call(page);
    await page.locator('[data-elevator-floor="arcade"]').click();
    await page.context().setOffline(true);
    await expect(page.locator('#elevator-dialog')).toBeHidden({ timeout: 12000 });
    await expect.poll(async () => (await feedback(page)).audio.active).toBe(0);
    await page.context().setOffline(false);
  } finally { await secondContext.close(); }
});
