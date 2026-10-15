import {worldPoint,selectHall} from './room-ui';
import { test, expect, type Page } from '@playwright/test';
import { diagonalTrace } from './diagonal';
import { FURNITURE, furnitureBounds } from '../src/shared/furniture';
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const miniState = (page: Page) => page.evaluate(() => (window as any).royalDemo.getMiniState());
async function ready(page: Page) {
  await page.goto('/?offline=1');
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#game canvas')).toBeVisible();
}

test('movement, collisions, pointer route, help and cabinet lifecycle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await selectHall(page,'tables');const poolStart=await worldPoint(page,540,590);await page.mouse.click(poolStart.x,poolStart.y);await expect.poll(async()=>Math.abs((await state(page)).x-540)+Math.abs((await state(page)).y-590),{timeout:12000}).toBeLessThan(4);
  const start = await state(page);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(400); await page.keyboard.up('ArrowRight');
  expect((await state(page)).x).toBeGreaterThan(start.x + 30);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1600); await page.keyboard.up('ArrowUp');
  const collision = await state(page);
  const pool = furnitureBounds(FURNITURE.pool);
  expect(collision.y).toBeGreaterThanOrEqual(pool.y+pool.h+12);
  expect(collision.y).toBeLessThan(510);
  const point = await worldPoint(page,740,560);
  await page.mouse.click(point.x,point.y);
  await expect.poll(async () => (await state(page)).x).toBeGreaterThan(730);
  await page.getByRole('button', { name: 'Как играть', exact: true }).click();
  expect((await state(page)).locked).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await selectHall(page,'arcade');await page.locator('#games-tab').click();
  await page.getByRole('button', { name: 'Подойти к автомату Space Orbit', exact: true }).click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#mini-title')).toHaveText('Space Orbit');
  await page.keyboard.press('Escape');
  await page.locator('#games-tab').click();
  await page.getByRole('button', { name: 'Подойти к автомату Neon Breaker', exact: true }).click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole('button', { name: 'Начать игру', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click();
  await expect.poll(async () => (await miniState(page))?.score).toBeGreaterThan(0);
  expect((await miniState(page)).blocks).toBeLessThan(36);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mini-game canvas')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await page.keyboard.press('e');
  await expect(page.locator('#mini-dialog')).toBeVisible();
  await expect(page.locator('#mini-game canvas')).toHaveCount(1);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('lives, game over and restart', async ({ page }) => {
  await ready(page);
  await page.locator('#games-tab').click();
  await page.getByRole('button', { name: 'Подойти к автомату Neon Breaker', exact: true }).click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#mini-game canvas')).toBeVisible();
  for (let life = 3; life > 0; life--) {
    await page.locator('#start-game').click();
    const canvas = await page.locator('#mini-game canvas').boundingBox();
    // Keep the paddle away from the ball to exercise actual life loss.
    for (let step = 0; step < 140; step++) {
      const s = await miniState(page);
      if (s.phase !== 'playing') break;
      const target = s.ball.x > 320 ? 65 : 575;
      await page.mouse.move(canvas!.x + canvas!.width * target / 640, canvas!.y + canvas!.height * 400 / 450);
      await page.waitForTimeout(65);
    }
    expect((await miniState(page)).lives).toBe(life - 1);
  }
  await expect(page.getByRole('heading', { name: 'Ещё один раунд?' })).toBeVisible();
  await page.getByRole('button', { name: 'Сыграть ещё', exact: true }).click();
  await expect.poll(async () => (await miniState(page))?.lives).toBe(3);
  expect((await miniState(page)).score).toBe(0);
  expect((await miniState(page)).blocks).toBe(36);
});

test('mobile touch navigation and mini-game fit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const before = await state(page);
  const point = await worldPoint(page,730,570);
  await page.touchscreen.tap(point.x,point.y);
  await expect.poll(async () => (await state(page)).x).toBeGreaterThan(before.x + 100);
  await page.locator('#games-tab').click();
  await page.getByRole('button', { name: 'Подойти к автомату Neon Breaker', exact: true }).tap();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 12000 });
  const dialog = await page.locator('#mini-dialog').boundingBox();
  expect(dialog!.width).toBeLessThan(390);
  await page.getByRole('button', { name: 'Начать игру', exact: true }).tap();
  await expect.poll(async () => (await miniState(page))?.phase).toBe('playing');
  await page.getByRole('button', { name: 'Вернуться в зал', exact: true }).tap();
  await expect(page.locator('#mini-dialog')).not.toBeVisible();
  await context.close();
});

test('directional walking returns to idle without sliding', async ({ page }) => {
  await ready(page);
  for (const [key, facing] of [['ArrowRight', 'right'], ['ArrowLeft', 'left'], ['ArrowDown', 'down'], ['ArrowUp', 'up']]) {
    await page.keyboard.down(key!);
    await expect.poll(async () => (await state(page)).facing).toBe(facing);
    await expect.poll(async () => (await state(page)).animation).toBe(`citizen-0-walk-${facing}`);
    const first = (await state(page)).frame;
    await expect.poll(async () => (await state(page)).frame).not.toBe(first);
    await page.keyboard.up(key!);
    await expect.poll(async () => (await state(page)).animation).toBe(`citizen-0-idle-${facing}`);
    const stopped = await state(page);
    await page.waitForTimeout(180);
    expect((await state(page)).x).toBeCloseTo(stopped.x, 1);
    expect((await state(page)).y).toBeCloseTo(stopped.y, 1);
  }
});

test('reduced motion keeps idle characters still while allowing movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect.poll(async () => (await state(page)).reducedMotion).toBe(true);
  const idle = await state(page);
  await page.waitForTimeout(1300);
  expect((await state(page)).frame).toBe(idle.frame);
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await state(page)).moving).toBe(true);
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => (await state(page)).frame).toBe('right-6');
});

test('all WASD diagonals keep a stable facing and advance walk frames', async ({ page }) => {
  await ready(page);
  await page.keyboard.down('a'); await page.waitForTimeout(1000); await page.keyboard.up('a');
  for (const keys of [['s','d'], ['w','a'], ['s','a'], ['w','d']]) {
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(80);
    const trace = await diagonalTrace(page);
    for (const key of keys) await page.keyboard.up(key);
    expect(new Set(trace.map(s => s.facing)).size).toBe(1);
    expect(new Set(trace.map(s => s.frame)).size).toBeGreaterThanOrEqual(2);
    const first = trace[0], last = trace.at(-1)!;
    expect(Math.abs(last.x-first.x)).toBeGreaterThan(15);
    expect(Math.abs(last.y-first.y)).toBeGreaterThan(15);
  }
  await expect.poll(async () => (await state(page)).moving).toBe(false);
});

test('Shift accelerates and pointer and button routes sprint by default offline', async ({page}) => {
  const {verifySprint} = await import('./sprint');
  await ready(page);
  await verifySprint(page);
});
