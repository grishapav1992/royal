import { test, expect } from '@playwright/test';
import { state, walk, overview, climbToRoof, login, toStreet } from './play-helpers';
import { HAND_DRYER, TOILET_CUBICLE_SEATS, TOILET_SINKS } from '../src/shared/toiletPlay';
import { ROOF_TOILET } from '../src/shared/toilet';

const SHOTS = process.env.STREET_PLAY_SHOTS || '';
test('restroom: wash, mirror selfie, hand dryer and a lockable cubicle', async ({ page }, info) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'toilet-play', 8);
  // Main's route between floors can stall on desktop, so this check goes the outdoor way:
  // the fire escape, the roof and the service window.
  await toStreet(page);
  await climbToRoof(page, info.project.name === 'mobile');
  await walk(page, 1000, 700); await walk(page, ROOF_TOILET.arrival.x, ROOF_TOILET.arrival.y);
  await walk(page, ROOF_TOILET.entry.x, ROOF_TOILET.entry.y, 40).catch(() => {});
  await expect.poll(async () => (await state(page)).hall, { timeout: 20000 }).toBe('toilet');
  await overview(page, false);
  await expect(page.locator('#chat-input')).toBeAttached();
  // Wash at the first sink, then take a mirror selfie.
  await walk(page, TOILET_SINKS[0].x, TOILET_SINKS[0].y);
  await expect(page.locator('#toilet-wash')).toBeVisible();
  await page.locator('#toilet-wash').click();
  await expect.poll(async () => (await state(page)).toilet.play.effects).toContain('wash');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-toilet-wash.png` });
  await page.locator('#toilet-selfie-button').click();
  await expect(page.locator('#toilet-selfie')).toBeVisible();
  await expect(page.locator('#toilet-selfie img')).toHaveAttribute('src', /^blob:/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-toilet-selfie.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('#toilet-selfie')).toBeHidden();
  // Dry hands at the wall dryer.
  await walk(page, HAND_DRYER.approach.x, HAND_DRYER.approach.y);
  await page.locator('#toilet-dry').click();
  await expect.poll(async () => (await state(page)).toilet.play.effects).toContain('dry');
  // Lock the first free cubicle; its door stays shut while seated.
  const cubicle = TOILET_CUBICLE_SEATS[0];
  await walk(page, cubicle.entry.x, cubicle.entry.y);
  await page.locator('#toilet-lock').click();
  await expect.poll(async () => (await state(page)).seat, { timeout: 15000 }).toBe(cubicle.id);
  await expect.poll(async () => (await state(page)).toilet.openDoors[cubicle.cubicle]).toBe(false);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-toilet-cubicle.png` });
  await page.locator('#toilet-leave').click();
  await expect.poll(async () => (await state(page)).seat).toBe('');
  expect(errors).toEqual([]);
});
