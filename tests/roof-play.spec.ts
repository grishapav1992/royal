import { test, expect, type Page } from '@playwright/test';
import { projectStreetPoint, StreetView } from '../src/game/streetView';
import { ROOF_STAIR_ROUTE, STREET_ROOF_STAIRS } from '../src/shared/rooftop';
import { ROOF_FIREWORKS, ROOF_SNOW_DRIFTS } from '../src/shared/streetPlay';

const SHOTS = process.env.STREET_PLAY_SHOTS || '';
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo?.getState?.() ?? {});
async function screenPoint(page: Page, point: { x: number; y: number }) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!, { view } = await state(page);
  return { box, x: box.x + (point.x - view.x) * view.zoom * box.width / view.width, y: box.y + (point.y - view.y) * view.zoom * box.height / view.height };
}
async function tap(page: Page, x: number, y: number) { if (page.viewportSize()!.width < 600) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
async function walk(page: Page, x: number, y: number, tolerance = 10) {
  for (let i = 0; i < 10; i++) {
    const current = await state(page), projected = current.hall === 'street' ? projectStreetPoint({ x, y }, current.street.view.orientation) : { x, y };
    const p = await screenPoint(page, projected), box = p.box;
    const inside = p.x > box.x + 20 && p.x < box.x + box.width - 20 && p.y > box.y + 20 && p.y < box.y + box.height - 20;
    if (inside) await tap(page, p.x, p.y);
    else {
      // Off-screen targets: a short step from the player toward them, clear of benches and buttons.
      const me = await screenPoint(page, current.hall === 'street' ? projectStreetPoint(current, current.street.view.orientation) : current);
      const dx = p.x - me.x, dy = p.y - me.y, d = Math.hypot(dx, dy) || 1, step = Math.min(150, d);
      await tap(page, me.x + dx / d * step, me.y + dy / d * step);
    }
    if (!inside) await page.waitForTimeout(500);
    try { await expect.poll(async () => { const s = await state(page); return inside ? Math.hypot(s.x - x, s.y - y) : (s.moving ? 1e9 : 0); }, { timeout: 12000 }).toBeLessThan(inside ? tolerance : 1); if (inside) return; } catch { /* hop again */ }
  }
  { const s = await state(page); throw new Error(`could not reach ${x},${y} from ${Math.round(s.x)},${Math.round(s.y)} overview=${s.view?.overview} locked=${s.locked} switching=${s.switching} hall=${s.hall} online=${s.online} seat=${s.seat} path=${s.stairNavigation?.path?.length}`); }
}
async function overview(page: Page, on: boolean) {
  const button = page.locator('#room-overview');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(on);
}
async function climbToRoof(page: Page, mobile: boolean) {
  await walk(page, 480, 1050); await walk(page, 480, 360);
  await walk(page, STREET_ROOF_STAIRS.foot.x - 54, STREET_ROOF_STAIRS.foot.y - 20);
  for (let i = 0; i < 40 && (await state(page)).hall !== 'roof'; i++) {
    const before = await state(page), step = before.stairStep;
    if (mobile) {
      const view = new StreetView(); view.side = before.street.view.side; view.overview = before.view.overview;
      const target = ROOF_STAIR_ROUTE[Math.min(step, ROOF_STAIR_ROUTE.length - 1)];
      const a = view.point(before, step > 0), b = view.point(target, true), p = await screenPoint(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - (step ? 8 : 80) });
      await tap(page, p.x, p.y);
    } else await page.keyboard.down('ArrowUp');
    try { await expect.poll(async () => { const s = await state(page); return s.hall === 'roof' || s.stairStep > step; }, { timeout: 10000 }).toBe(true); }
    catch { /* try the next press */ } finally { if (!mobile) await page.keyboard.up('ArrowUp'); }
  }
  await expect.poll(async () => (await state(page)).hall, { timeout: 15000 }).toBe('roof');
}

test('roof: snowballs at a parapet drift, a bench and shared fireworks', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const login = await page.request.post('/api/auth/login', { data: { email: `roof-play-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(login.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character', { data: { skin: 5 } })).ok()).toBe(true);
  await page.goto('/?lang=ru');
  await page.locator('.entry-options [data-entry-mode="club"]').click();
  await expect.poll(async () => (await state(page)).online, { timeout: 30000 }).toBe(true);
  await overview(page, true);
  await page.locator('[data-floor-target="street"]').click();
  for (let i = 0; i < 16 && (await state(page)).hall !== 'street'; i++) {
    await page.waitForTimeout(2500);
    if ((await state(page)).hall !== 'street' && i % 2 === 1) { const p = await screenPoint(page, i % 4 === 1 ? { x: 180, y: 1285 } : { x: 300, y: 1150 }); await page.mouse.click(p.x, p.y); }
  }
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('street');
  await overview(page, false);
  await expect(page.locator('.local-label')).toHaveAttribute('data-status', 'connected', { timeout: 25000 });
  await climbToRoof(page, info.project.name === 'mobile');
  await expect(page.locator('#roof-snow-fight')).toBeVisible();
  const drift = ROOF_SNOW_DRIFTS[1];
  await walk(page, drift.x, drift.y - 40);
  await page.locator('#roof-snow-pick').click();
  await expect.poll(async () => (await state(page)).roof.play.self.snowballs).toBe(1);
  await page.locator('#roof-snow-throw').click();
  const aim = await screenPoint(page, { x: drift.x + 200, y: drift.y - 120 });
  await page.mouse.click(aim.x, aim.y);
  await expect.poll(async () => (await state(page)).roof.play.self.snowballs).toBe(0);
  // Sit on the left roof bench and stand up again.
  await walk(page, 895, 1022);
  const bench = await screenPoint(page, { x: 895, y: 950 });
  await tap(page, bench.x, bench.y);
  await expect.poll(async () => (await state(page)).seat, { timeout: 15000 }).toMatch(/^roof-bench-0-/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-roof-bench.png` });
  await page.locator('#roof-stand').click();
  await expect.poll(async () => (await state(page)).seat).toBe('');
  // Launch a rocket from the crate.
  // Through the gap between the two vents.
  for (const [x, y] of [[895, 1060], [1315, 1060], [1315, 700]] as const) await walk(page, x, y);
  await walk(page, ROOF_FIREWORKS.approach.x, ROOF_FIREWORKS.approach.y);
  await expect(page.locator('#roof-firework')).toBeVisible();
  await page.locator('#roof-firework').click();
  await expect.poll(async () => (await state(page)).roof.fireworks.launched).toBe(1);
  await page.waitForTimeout(1300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-roof-fireworks.png` });
  expect(errors).toEqual([]);
});
