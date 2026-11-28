import { test, expect } from '@playwright/test';
import { ROOF_FIREWORKS, ROOF_SNOW_DRIFTS } from '../src/shared/streetPlay';
import { state, screenPoint, tap, walk, climbToRoof, login, toStreet } from './play-helpers';

const SHOTS = process.env.STREET_PLAY_SHOTS || '';
test('roof: snowballs at a parapet drift, a bench and shared fireworks', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'roof-play', 5);
  await toStreet(page);
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
