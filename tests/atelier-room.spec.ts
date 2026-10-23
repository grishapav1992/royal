import { test, expect } from '@playwright/test';
import { ATELIER } from '../src/shared/atelier';
import { HALL_WALL } from '../src/shared/clubGeometry';

test('the tall wall and recessed atelier leave the floor walkable and support direct interaction', async ({ page }) => {
  await page.goto('/?offline=1');
  await page.locator('#loading').waitFor({ state: 'detached' });
  await page.waitForFunction(() => { try { return !!(window as any).royalDemo?.getState().x; } catch { return false; } });
  const initial = await page.evaluate(() => (window as any).royalDemo.getState());
  const canvas = page.locator('#game canvas'), box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + (initial.x-initial.view.x)*initial.view.zoom, box.y + (initial.y-initial.view.y)*initial.view.zoom);
  await page.keyboard.down('w');
  try { await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().y), { timeout: 20000 }).toBeLessThan(260); }
  finally { await page.keyboard.up('w'); }
  const state = await page.evaluate(() => (window as any).royalDemo.getState());
  expect(state.view.y).toBeLessThan(0);
  expect(ATELIER.top + ATELIER.height).toBe(175);
  expect(HALL_WALL.height).toBeGreaterThan(250);
  await page.mouse.click(box.x + (ATELIER.x - state.view.x) * state.view.zoom, box.y + (ATELIER.top + 100 - state.view.y) * state.view.zoom);
  await expect(page.getByText('Войди в аккаунт, чтобы заказать образ в ателье.', { exact: true })).toBeVisible();
  await page.locator('#game').screenshot({ path: 'artifacts/skin-studio/wall-atelier/local-room.png' });
});

test('the tailor blinks, works and walks behind the counter, and respects reduced motion', async ({ page }) => {
  await page.goto('/?offline=1');
  await page.locator('#loading').waitFor({ state: 'detached' });
  const initial = await page.evaluate(() => (window as any).royalDemo.getState());
  const box = (await page.locator('#game canvas').boundingBox())!;
  await page.mouse.click(box.x+(initial.x-initial.view.x)*initial.view.zoom,box.y+(initial.y-initial.view.y)*initial.view.zoom);
  await page.keyboard.down('w');
  try { await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().y), { timeout: 20000 }).toBeLessThan(250); }
  finally { await page.keyboard.up('w'); }
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getTailor()?.blinks ?? 0), { timeout: 12000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getTailor()?.action), { timeout: 12000, intervals: [100] }).toBe('adjust');
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getTailor()?.offset ?? 0), { timeout: 12000, intervals: [100] }).toBeLessThan(-14);
  const moving = await page.evaluate(() => (window as any).royalDemo.getTailor());
  expect(moving.width).toBe(56); expect(moving.height).toBeLessThan(85);
  expect(moving.x).toBeGreaterThan(ATELIER.x-ATELIER.width/2+28);
  expect(moving.x).toBeLessThan(ATELIER.x+ATELIER.width/2-28);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getTailor()?.frozen)).toBe(true);
  const reduced = await page.evaluate(() => (window as any).royalDemo.getTailor());
  await page.waitForTimeout(400);
  const stable = await page.evaluate(() => (window as any).royalDemo.getTailor());
  expect(stable.clock).toBe(reduced.clock); expect(stable.frame).toBe(0); expect(stable.offset).toBe(0);
});
