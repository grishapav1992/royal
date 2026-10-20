import { expect, test, type Page } from '@playwright/test';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';
import { drunkKeyboardDirection } from '../src/shared/drunkControls';
import { findPath, walkable } from '../src/game/navigation';
import { hallObstacles, inHallDoor, type HallId } from '../src/shared/world';
import { worldPoint } from './room-ui';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const network = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());
const keys = [
  { key: 'w', arrow: 'ArrowUp', x: 0, y: -1, directions: 1 },
  { key: 'd', arrow: 'ArrowRight', x: 1, y: 0, directions: 2 },
  { key: 's', arrow: 'ArrowDown', x: 0, y: 1, directions: 4 },
  { key: 'a', arrow: 'ArrowLeft', x: -1, y: 0, directions: 8 },
] as const;

async function load(page: Page, path: string) {
  await page.goto(path);
  await page.locator('#loading').waitFor({ state: 'detached' });
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await page.locator('#game').focus();
}

async function pressAndCheck(page: Page, key: string, direction: { x: number; y: number }, online = false) {
  const before = await state(page);
  await page.keyboard.down(key);
  try { await page.waitForTimeout(220); }
  finally { await page.keyboard.up(key); }
  if (online) {
    await expect.poll(async () => (await state(page)).pendingInputs).toBe(0);
    await expect.poll(async () => {
      const current = await state(page);
      return Math.hypot(current.x - current.serverX, current.y - current.serverY);
    }).toBeLessThan(1);
  }
  const after = await state(page);
  const dx = after.x - before.x, dy = after.y - before.y;
  expect(dx * direction.x + dy * direction.y, `${key} follows its episode's assigned direction`).toBeGreaterThan(8);
  expect(Math.abs(dx * direction.y - dy * direction.x), `${key} stays near its assigned axis`).toBeLessThan(9);
  expect(after.hall).toBe(before.hall);
  expect(after.controlLayout).toBe(before.controlLayout);
}

async function checkRandomFloorTarget(page: Page) {
  const clicked = { x: 720, y: 620 }, before = await state(page);
  const pointer = await worldPoint(page, clicked.x, clicked.y);
  await page.mouse.click(pointer.x, pointer.y);
  await expect.poll(async () => (await state(page)).walkTarget).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  const accepted = await state(page), target = accepted.walkTarget as { x: number; y: number };
  expect(Math.hypot(target.x - clicked.x, target.y - clicked.y)).toBeGreaterThan(50);
  expect(walkable(target.x, target.y, hallObstacles(before.hall))).toBe(true);
  expect(inHallDoor({ ...target, hall: before.hall })).toBe(false);
  expect(findPath(before, target, hallObstacles(before.hall))).not.toHaveLength(0);
  expect(accepted.hall).toBe(before.hall);
  await expect.poll(async () => {
    const current = await state(page);
    return Math.hypot(current.x - before.x, current.y - before.y);
  }).toBeGreaterThan(5);
}

async function mira(page: Page) {
  await page.route('**/api/npc/mira', route => route.fulfill({ json: {
    turns: [{ role: 'assistant', content: 'Угощение за счёт клуба.' }], emotion: 'smile',
  } }));
}

async function whisky(page: Page) {
  const button = page.locator('[data-drink="whisky"]');
  await expect(button).toBeEnabled({ timeout: 7000 });
  await button.click();
  await expect.poll(async () => (await state(page)).action).toBe('drink');
  await expect(button).toBeDisabled();
  await expect.poll(async () => (await state(page)).action, { timeout: 7000 }).not.toBe('drink');
}

test('maximum offline intoxication keeps one shuffled layout, redirects floor clicks and restores normal controls on recovery', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(maximum => {
    const realNow = Date.now.bind(Date);
    (window as any).__drunkClockOffset = 0;
    Date.now = () => realNow() + (window as any).__drunkClockOffset;
    if (!localStorage.getItem('royal-offline-sober-at')) {
      localStorage.setItem('royal-offline-sober-at', String(realNow() + maximum));
      localStorage.setItem('royal-offline-control-layout', '1');
    }
  }, MAX_SOBER_TIME_MS);
  await load(page, '/?offline=1');
  const initial = await state(page);
  expect(initial.intoxication.stage).toBe(3);
  expect(initial.controlLayout).toBe(1);
  for (const input of keys) {
    const expected = drunkKeyboardDirection(initial.soberAt, 1, input);
    expect(expected).not.toEqual({ x: input.x, y: input.y });
    await pressAndCheck(page, input.key, expected);
    await pressAndCheck(page, input.arrow, expected);
  }

  await page.reload();
  await page.locator('#loading').waitFor({ state: 'detached' });
  await page.locator('#game').focus();
  const restored = await state(page);
  expect(restored.controlLayout).toBe(1);
  expect(restored.soberAt).toBe(initial.soberAt);
  await checkRandomFloorTarget(page);
  await page.screenshot({ path: 'artifacts/drunk-controls/offline-maximum.png' });

  await page.evaluate(maximum => { (window as any).__drunkClockOffset = maximum + 1000; }, MAX_SOBER_TIME_MS);
  await expect.poll(async () => (await state(page)).intoxication.stage).toBe(0);
  await pressAndCheck(page, 'w', { x: 0, y: -1 });
  const clicked = { x: 640, y: 620 }, pointer = await worldPoint(page, clicked.x, clicked.y);
  await page.mouse.click(pointer.x, pointer.y);
  await expect.poll(async () => {
    const target = (await state(page)).walkTarget;
    return target ? Math.hypot(target.x - clicked.x, target.y - clicked.y) : Infinity;
  }).toBeLessThan(1);
  await expect.poll(async () => {
    const current = await state(page);
    return Math.hypot(current.x - clicked.x, current.y - clicked.y);
  }, { timeout: 10000 }).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('accepted server drinks shuffle both prediction and authority once per episode and preserve the layout after reload', async ({ page }) => {
  test.setTimeout(90000);
  await mira(page);
  const address = `drunk-controls-${crypto.randomUUID()}@example.test`;
  expect((await page.context().request.post('/api/auth/login', { data: { email: address, password: 'Royal-drunk-controls-123!' } })).ok()).toBe(true);
  expect((await page.context().request.post('/api/auth/character', { data: { skin: 0 } })).ok()).toBe(true);
  await load(page, '/');
  await expect.poll(async () => (await network(page))?.status).toBe('connected');
  await expect.poll(async () => (await state(page)).serverX).toBeDefined();
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Напитки', exact: true }).click();
  await whisky(page);
  expect((await state(page)).intoxication.stage).toBe(2);
  await whisky(page);
  const maximum = await state(page);
  expect(maximum.intoxication.stage).toBe(3);
  expect(maximum.controlLayout).toBeGreaterThanOrEqual(1);
  expect(maximum.controlLayout).toBeLessThanOrEqual(9);
  await whisky(page);
  expect((await state(page)).controlLayout).toBe(maximum.controlLayout);
  await page.screenshot({ path: 'artifacts/drunk-controls/server-maximum.png' });

  await page.reload();
  await page.locator('#loading').waitFor({ state: 'detached' });
  await expect.poll(async () => (await network(page))?.status).toBe('connected');
  await expect.poll(async () => (await state(page)).serverX).toBeDefined();
  await expect.poll(async () => (await state(page)).intoxication.stage).toBe(3);
  expect((await state(page)).controlLayout).toBe(maximum.controlLayout);
  await page.locator('#game').focus();
  for (const input of keys) {
    const expected = drunkKeyboardDirection(maximum.soberAt, maximum.controlLayout, input);
    await pressAndCheck(page, input.key, expected, true);
    await pressAndCheck(page, input.arrow, expected, true);
  }
  await checkRandomFloorTarget(page);
  expect((await state(page)).hall as HallId).toBe('arcade');
  await page.context().request.post('/api/auth/logout');
});
