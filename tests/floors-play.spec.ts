import { test, expect, type Page } from '@playwright/test';
import { state, screenPoint, walk, overview, login } from './play-helpers';

const SHOTS = process.env.STREET_PLAY_SHOTS || '';
const doors: Record<string, { x: number; y: number }> = { tables: { x: 900, y: 107 }, github: { x: 800, y: 107 } };
async function goTo(page: Page, hall: string) {
  for (let attempt = 0; attempt < 4 && (await state(page)).hall !== hall; attempt++) {
    if (attempt % 2 === 0) { await overview(page, true); await page.locator(`[data-floor-target="${hall}"]`).click(); }
    else { await overview(page, true); const door = await screenPoint(page, doors[hall]); await page.mouse.click(door.x, door.y); }
    try { await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe(hall); } catch { /* the route stalled; try the door */ }
  }
  await expect.poll(async () => (await state(page)).hall).toBe(hall);
  await overview(page, false);
}
const emotes = async (page: Page) => (await state(page)).emotes;
async function emote(page: Page, key: string) { await page.locator('#game').focus(); await page.waitForTimeout(1300); await page.keyboard.press(key); }

test('floors: emotes for everyone, Mira and dealers wave back, applause throws confetti', async ({ page }, info) => {
  test.setTimeout(480000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'floors-play', 4);
  await overview(page, false);
  // The emote row opens from its button; key 1 waves.
  await expect(page.locator('#emote-toggle')).toBeVisible();
  await page.locator('#emote-toggle').click();
  await expect(page.locator('#emote-row')).toBeVisible();
  await page.locator('[data-emote="dance"]').click();
  await expect.poll(async () => (await emotes(page)).shown.length).toBeGreaterThan(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-floor1-dance.png` });
  // Mira answers a wave from the bar counter.
  const mira = (await emotes(page)).npcs.find((n: any) => n.id === 'mira');
  expect(mira).toBeTruthy();
  // A click by the counter may seat the player on a stool; any spot within Mira's reach will do.
  await walk(page, mira.near.x, mira.near.y, 30).catch(() => {});
  { const s = await state(page); expect(Math.hypot(s.x - mira.near.x, s.y - mira.near.y)).toBeLessThan(200); }
  await emote(page, '1');
  await expect.poll(async () => (await emotes(page)).replies).toContain('mira');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-floor1-mira.png` });
  // Floor 2: applause next to a game table.
  await goTo(page, 'tables');
  const here = await state(page);
  const table = [...(await emotes(page)).tables].sort((a: any, b: any) => Math.hypot(a.near.x - here.x, a.near.y - here.y) - Math.hypot(b.near.x - here.x, b.near.y - here.y))[0];
  await walk(page, table.near.x, table.near.y, 30).catch(() => {});
  { const s = await state(page); expect(Math.hypot(s.x - table.near.x, s.y - table.near.y)).toBeLessThan(240); }
  if ((await state(page)).seat) { await page.locator('#stand-up').click().catch(() => {}); }
  const before = (await emotes(page)).reactions;
  await emote(page, '2');
  await expect.poll(async () => (await emotes(page)).reactions).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-floor2-confetti.png` });
  // Floor 3: a dealer waves back.
  await goTo(page, 'github');
  const there = await state(page);
  const dealer = [...(await emotes(page)).npcs].sort((a: any, b: any) => Math.hypot(a.near.x - there.x, a.near.y - there.y) - Math.hypot(b.near.x - there.x, b.near.y - there.y))[0];
  await walk(page, dealer.near.x, dealer.near.y, 30).catch(() => {});
  { const s = await state(page); expect(Math.hypot(s.x - dealer.near.x, s.y - dealer.near.y)).toBeLessThan(220); }
  await emote(page, '1');
  await expect.poll(async () => (await emotes(page)).replies).toContain(dealer.id);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-floor3-dealer.png` });
  expect(errors).toEqual([]);
});
