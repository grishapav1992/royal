import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import { CABINETS } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { worldPoint } from './room-ui';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
async function enter(page: Page, path: string) {
  await page.route('https://luelonplay.com/**', route => route.fulfill({ json: { games: [] } }));
  await page.goto(path);
  await page.getByLabel('Почта', { exact: true }).fill(`seated-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Cabinet-test-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 });
  await expect.poll(async () => (await state(page)).online).toBe(true);
}
async function approach(page: Page, id: string) {
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
  const cabinet = CABINETS.find(c => c.id === id)!;
  const point = await worldPoint(page, cabinet.x, cabinet.y - 65);
  await page.mouse.click(point.x, point.y);
}

test('two visitors see seating and a real result, occupied cabinets reject another player and closing frees the seat', async ({ page, roomPath, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page, roomPath);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  const otherContext = await browser.newContext(), other = await otherContext.newPage();
  try {
    other.on('pageerror', error => errors.push(error.message));
    await enter(other, page.url());
    const cabinet = CABINETS.find(c => c.id === 'royal-dice')!, seat = cabinetSeat(cabinet);
    await approach(other, cabinet.id);
    await expect(other.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
    await other.locator('#mini-dialog .mini-top [data-close]').click();
    await expect.poll(async () => (await state(other)).cabinet).toBe('');
    const viewingPoint = { x: cabinet.x + 66, y: cabinet.y + 90 };
    const viewingClick = await worldPoint(other, viewingPoint.x, viewingPoint.y);
    await other.mouse.click(viewingClick.x, viewingClick.y);
    await expect.poll(async () => { const s = await state(other); return Math.hypot(s.x - viewingPoint.x, s.y - viewingPoint.y); }).toBeLessThan(8);
    await approach(page, cabinet.id);
    await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
    await expect.poll(async () => (await state(page)).seat).toBe('cabinet:' + cabinet.id);
    const seated = await state(page);
    expect(seated.action).toBe('sit'); expect(seated.x).toBeCloseTo(seat.x, 0); expect(seated.y).toBeCloseTo(seat.y, 0);
    expect(seated.stools.sort()).toEqual(CABINETS.map(c => c.id).sort());
    expect(seated.animation).toContain('-game-up');
    await expect.poll(async () => (await state(other)).remotePositions.some((p: any) => p.cabinet === cabinet.id && p.seat === 'cabinet:' + cabinet.id)).toBe(true);
    await approach(other, cabinet.id);
    await expect(other.locator('#toast')).toContainText('занято');
    await expect(other.locator('#mini-dialog')).toBeHidden();
    await expect(other.locator('#interact-label')).toHaveText('Занято');
    await expect(other.locator('#interact')).toBeDisabled();
    const reaction = page.waitForEvent('console', { predicate: message => message.text().startsWith('cabinet-reaction:'), timeout: 15000 });
    await page.evaluate(() => document.addEventListener('royal-game-reaction', event => console.log('cabinet-reaction:' + (event as CustomEvent).detail.reaction), { once: true }));
    await page.locator('#original-play').click();
    const outcome = (await reaction).text().split(':')[1];
    expect(['win', 'lose']).toContain(outcome);
    await expect.poll(async () => (await state(other)).remotePositions.find((p: any) => p.cabinet === cabinet.id)?.gameReaction).toBe(outcome);
    await other.locator('#room-overview').click();
    await other.screenshot({ path: 'artifacts/cabinet-seating/observer-reaction.png' });
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect.poll(async () => (await state(page)).seat).toBe('');
    await expect.poll(async () => (await state(other)).remotePositions.every((p: any) => p.cabinet !== cabinet.id)).toBe(true);
    await approach(other, cabinet.id);
    await expect(other.locator('#mini-dialog')).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => (await state(other)).seat).toBe('cabinet:' + cabinet.id);
    expect(errors).toEqual([]);
  } finally { await otherContext.close(); }
});

test('offline and reduced motion visitors use stools at machines and card tables', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://luelonplay.com/**', route => route.fulfill({ json: { games: [] } }));
  await page.goto('/?offline=1'); await expect(page.locator('#loading')).toHaveCount(0);
  await approach(page, 'royal-fruits');
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
  expect((await state(page)).seat).toBe('cabinet:royal-fruits');
  expect((await state(page)).frame).toBe('up-30');
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(async () => (await state(page)).seat).toBe('');
  await page.locator('[data-floor-target="tables"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('tables');
  const upstairs = await state(page); expect(upstairs.seat).toBe(''); expect(upstairs.cabinet).toBe('');
  await page.locator('[data-floor-target="github"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('github');
  const cardSeat = cabinetSeat(CABINETS.find(c => c.id === 'github-blackjack')!);
  const stoolClick = await worldPoint(page, cardSeat.x, cardSeat.y - 22);
  await page.mouse.click(stoolClick.x, stoolClick.y);
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
  expect((await state(page)).seat).toBe('cabinet:github-blackjack');
  expect((await state(page)).x).toBe(cardSeat.x);
  expect((await state(page)).y).toBe(cardSeat.y);
  await page.locator('.github-game [data-action="start"]').click();
  await page.waitForTimeout(250);
  if (await page.locator('.github-game [data-action="stand"]').count()) await page.locator('.github-game [data-action="stand"]').click();
  await expect(page.locator('.github-history span')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/cabinet-seating/card-table-reduced-motion.png' });
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(async () => (await state(page)).cabinet).toBe('');
});
