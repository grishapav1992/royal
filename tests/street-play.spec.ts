import { test, expect, type Page } from '@playwright/test';
import { projectStreetPoint } from '../src/game/streetView';
import { SNOW_DRIFTS, STREET_KIOSK } from '../src/shared/streetPlay';

const SHOTS = process.env.STREET_PLAY_SHOTS || '';
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo?.getState?.() ?? {});
async function worldPoint(page: Page, x: number, y: number) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!;
  const current = await state(page), { view } = current;
  const point = current.hall === 'street' ? projectStreetPoint({ x, y }, current.street.view.orientation) : { x, y };
  return { x: box.x + (point.x - view.x) * view.zoom * box.width / view.width, y: box.y + (point.y - view.y) * view.zoom * box.height / view.height };
}
async function overview(page: Page, on: boolean) {
  const button = page.locator('#room-overview');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(on);
}
async function walk(page: Page, x: number, y: number, tolerance = 10) {
  for (let i = 0; i < 8; i++) {
    // Off-screen targets are reached in hops toward them, as a player would tap.
    const box = (await page.locator('#game canvas').boundingBox())!, point = await worldPoint(page, x, y);
    const inside = point.x > box.x + 20 && point.x < box.x + box.width - 20 && point.y > box.y + 20 && point.y < box.y + box.height - 20;
    // Hops stay in the middle of the view, away from the minimap and overlay buttons.
    const cx = Math.min(box.x + box.width * .8, Math.max(box.x + box.width * .2, point.x)), cy = Math.min(box.y + box.height * .8, Math.max(box.y + box.height * .25, point.y));
    await page.mouse.click(cx, cy); if (!inside) await page.waitForTimeout(500);
    try { await expect.poll(async () => { const p = await state(page); return inside ? Math.hypot(p.x - x, p.y - y) : (p.moving ? 1e9 : 0); }, { timeout: 9000 }).toBeLessThan(inside ? tolerance : 1); if (inside) return; } catch { /* retry */ }
  }
  throw new Error(`could not reach ${x},${y}`);
}
async function shot(page: Page, name: string, project: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${project}-${name}.png` }); }
async function enterStreet(page: Page, query = '') {
  const login = await page.request.post('/api/auth/login', { data: { email: `street-play-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(login.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character', { data: { skin: 3 } })).ok()).toBe(true);
  await page.goto('/?lang=ru' + query);
  await page.locator('.entry-options [data-entry-mode="club"]').click();
  await expect.poll(async () => (await state(page)).online, { timeout: 30000 }).toBe(true);
  await overview(page, true);
  await page.locator('[data-floor-target="street"]').click();
  // The exit route can stall in a crowded hall; clicking the doorway itself finishes the walk.
  for (let i = 0; i < 16 && (await state(page)).hall !== 'street'; i++) {
    await page.waitForTimeout(2500);
    if ((await state(page)).hall !== 'street' && i % 2 === 1) { const p = await worldPoint(page, i % 4 === 1 ? 180 : 300, i % 4 === 1 ? 1285 : 1150); await page.mouse.click(p.x, p.y); }
  }
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('street');
  await overview(page, false);
  await expect(page.locator('#street-play-bar')).toBeVisible();
}

test('snowballs, a snowman, a bench and the kiosk on the street with chat', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterStreet(page, '&street-time=day');
  await expect(page.locator('#chat-input')).toBeAttached();
  // Opt in to snowball fights; the choice reaches the server.
  const fight = page.locator('#street-snow-fight');
  await expect(fight).toHaveAttribute('aria-pressed', 'false');
  await fight.click();
  await expect(fight).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).street.play.self.snowFight).toBe(true);
  // Make two snowballs at a drift and throw one by aiming, one with F.
  const drift = SNOW_DRIFTS[1];
  // Stand beside the drift: clicking the drift itself walks there and makes a snowball.
  await walk(page, drift.x, drift.y - 40);
  await expect(page.locator('#street-snow-pick')).toBeVisible();
  await page.locator('#street-snow-pick').click();
  await expect.poll(async () => (await state(page)).street.play.self.snowballs).toBe(1);
  await page.waitForTimeout(700); await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).street.play.self.snowballs).toBe(2);
  await shot(page, 'snowballs', info.project.name);
  await page.locator('#street-snow-throw').click();
  await expect.poll(async () => (await state(page)).street.play.aiming).toBe(true);
  // Aim over the bench: the throw wins over the bench's own click.
  const aim = await worldPoint(page, 1180, 1100);
  await page.mouse.click(aim.x, aim.y);
  await page.waitForTimeout(900);
  await expect.poll(async () => (await state(page)).street.play.self.snowballs).toBe(1);
  expect(Math.hypot((await state(page)).x - drift.x, (await state(page)).y - drift.y + 40)).toBeLessThan(12);
  await page.waitForTimeout(800);
  await page.locator('#game').focus(); await page.keyboard.press('f');
  await expect.poll(async () => (await state(page)).street.play.self.snowballs).toBe(0);
  // Roll a ball over the snow and set it down as a snowman base.
  await page.locator('#street-snow-roll').click();
  await expect.poll(async () => (await state(page)).street.play.self.snowRoll).toBeGreaterThan(0);
  // Each device sets its snowman in its own spot: both runs share one room.
  const spot = info.project.name === 'mobile' ? 1800 : 1450;
  for (const [x, y] of [[1350, 1160], [1700, 1160], [1350, 1160], [1700, 1160], [spot, 1150]] as const) await walk(page, x, y, 14);
  const before = (await state(page)).street.play.snowmen.length;
  await expect.poll(async () => (await state(page)).street.play.self.snowRoll).toBeGreaterThanOrEqual(20);
  await shot(page, 'rolling', info.project.name);
  await page.locator('#street-snow-roll').click();
  await expect.poll(async () => (await state(page)).street.play.snowmen.length).toBe(before + 1);
  expect((await state(page)).street.play.self.snowRoll).toBe(0);
  // Sit on a bench and stand up again.
  // Middle seat of the right front bench (street-bench-1-1).
  const seat = { x: 1890, y: 1124, entry: { x: 1890, y: 1170 } };
  await walk(page, seat.entry.x, seat.entry.y);
  const bench = await worldPoint(page, seat.x, seat.y - 14);
  await page.mouse.click(bench.x, bench.y);
  await expect.poll(async () => (await state(page)).seat, { timeout: 15000 }).toMatch(/^street-bench-1-/);
  await shot(page, 'bench', info.project.name);
  await page.locator('#street-stand').click();
  await expect.poll(async () => (await state(page)).seat).toBe('');
  // Order cocoa at the kiosk.
  await walk(page, STREET_KIOSK.approach.x, STREET_KIOSK.approach.y);
  await page.locator('#game').focus(); await page.keyboard.press('e');
  await expect(page.locator('#street-kiosk')).toBeVisible();
  await shot(page, 'kiosk', info.project.name);
  await page.locator('[data-kiosk-drink="cocoa"]').click();
  await expect.poll(async () => (await state(page)).drink).toBe('cocoa');
  await expect(page.locator('#street-kiosk')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Lyonya takes a postcard without name labels and the evening lights the street', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterStreet(page, '&street-time=evening');
  await expect.poll(async () => (await state(page)).street.atmosphere.evening).toBe(1);
  await shot(page, 'evening', info.project.name);
  await overview(page, true);
  const tourist = (await state(page)).street.residents.people.find((p: any) => p.id === 'tourist');
  const hit = await worldPoint(page, tourist.x, tourist.y - 35);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(async () => (await state(page)).street.residents.conversation, { timeout: 30000 }).toBe('tourist');
  await overview(page, false);
  await page.locator('#street-photo-request').click();
  await expect(page.locator('#street-postcard')).toBeVisible();
  await expect.poll(async () => (await state(page)).street.photo.hasImage).toBe(true);
  await expect(page.locator('#street-postcard img')).toHaveAttribute('src', /^blob:/);
  await shot(page, 'postcard', info.project.name);
  await page.keyboard.press('Escape');
  await expect(page.locator('#street-postcard')).toBeHidden();
  expect((await state(page)).labelVisible).toBe(true);
  expect(errors).toEqual([]);
});
