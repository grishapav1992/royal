import { test, expect, type Page } from '@playwright/test';
import { CABINETS } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { worldPoint } from './room-ui';
const wallet = { balance: 1390.81, entries: [] };
const artifacts = process.env.ROYAL_GAME_WINDOW_ARTIFACTS || 'artifacts/game-window-redesign-20261014';
async function preview(page: Page, game: string) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/demo-wallet' ? wallet : { wallet, sessions: [], session: null } });
  });
  await page.goto('/tests/fixtures/game-window.html?game=' + game);
  await expect(page.locator('#mini-dialog')).toBeVisible();
  await page.waitForFunction(() => (window as any).windowPreview);
}
async function fits(page: Page) {
  const issues = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('#mini-dialog')!, bounds = dialog.getBoundingClientRect();
    const failures: string[] = [];
    for (const el of [dialog, document.querySelector<HTMLElement>('#mini-game')!]) {
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) failures.push(`overflow:${el.id}:${el.scrollWidth}x${el.scrollHeight}/${el.clientWidth}x${el.clientHeight}`);
    }
    const nodes = document.querySelectorAll<HTMLElement>('#mini-game button,#mini-game input,#mini-game select,#card-dealer-stage canvas');
    for (const el of Array.from(nodes)) {
      if (el.closest('.game-window-sheet')) continue;
      const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (rect.top < bounds.top - 1 || rect.left < bounds.left - 1 || rect.bottom > bounds.bottom + 1 || rect.right > bounds.right + 1) failures.push('outside:' + (el.id || el.className));
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (hit !== el && !el.contains(hit)) failures.push('covered:' + (el.id || el.className));
    }
    return failures;
  });
  expect(issues).toEqual([]);
}
test('all game renderers fit desktop and portrait phone with visible controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await preview(page, 'variant-target-plinko');
  const ids: string[] = await page.evaluate(() => (window as any).windowPreview.games);
  expect(ids.length).toBeGreaterThan(80);
  for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    for (const id of ids) {
      await test.step(`${id} ${viewport.width}x${viewport.height}`, async () => {
        await page.evaluate(id => (window as any).windowPreview.mount(id), id);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await fits(page);
      });
    }
  }
  expect(errors).toEqual([]);
});
test('settings and history retain live controls after rendering, Escape returns to the game', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await preview(page, 'royal-plinko');
  await page.locator('[data-vp="rules"]').click();
  await expect(page.locator('.vp-modal')).toBeVisible();
  await expect(page.locator('.vp-modal table tbody tr')).toHaveCount(13);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mini-dialog')).toBeVisible();
  await expect(page.locator('.vp-modal')).toBeHidden();
  await page.locator('[data-risk="hard"]').click();
  await expect(page.locator('[data-risk="hard"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-pocket]')).toHaveCount(13);
  await fits(page);
  await page.evaluate(() => (window as any).windowPreview.mount('github-blackjack'));
  await page.locator('[data-action=start]').click();
  await page.waitForTimeout(240);
  if (await page.locator('[data-action=stand]').count()) await page.locator('[data-action=stand]').click();
  await page.getByRole('button', { name: 'История игры', exact: true }).click();
  await expect(page.locator('[data-window-sheet=history]')).toBeVisible();
  await expect(page.locator('.github-history span')).toHaveCount(1);
  await page.getByRole('button', { name: 'Вернуться к игре', exact: true }).filter({ visible: true }).click();
  await fits(page);
});
test('hall opens the compact window, switches a variant and seats a card player', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://luelonplay.com/**', route => route.fulfill({ json: { games: [] } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?offline=1'); await expect(page.locator('#loading')).toHaveCount(0);
  await page.locator('#room-overview').click();
  const cabinet = CABINETS.find(c => c.id === 'royal-plinko')!;
  const click = await worldPoint(page, cabinet.x, cabinet.y - 65); await page.mouse.click(click.x, click.y);
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: 'Варианты игры', exact: true }).click();
  await page.locator('[data-casino-mode=variant-target-plinko]').click();
  await expect(page.locator('#mini-title')).toHaveText('Плинко: мишень');
  await expect(page.locator('[data-window-sheet=variants]')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 }); await fits(page);
  await page.screenshot({ path: `${artifacts}/plinko-mobile.png` });
  await page.locator('.mini-top [data-close]').click();
  const state = () => page.evaluate(() => (window as any).royalDemo.getState());
  for (const floor of ['tables', 'github']) {
    await page.locator(`[data-floor-target=${floor}]`).click();
    await expect.poll(async () => (await state()).hall, { timeout: 30000 }).toBe(floor);
  }
  const seat = cabinetSeat(CABINETS.find(c => c.id === 'github-blackjack')!);
  const cardClick = await worldPoint(page, seat.x, seat.y - 22); await page.mouse.click(cardClick.x, cardClick.y);
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('.card-dealer-hands')).toBeVisible(); await fits(page);
  await page.locator('[data-action=start]').click(); await page.waitForTimeout(240);
  if (await page.locator('[data-action=stand]').count()) await page.locator('[data-action=stand]').click();
  await page.screenshot({ path: `${artifacts}/blackjack-mobile.png` });
  expect((await state()).cabinet).toBe('github-blackjack');
  await page.locator('.mini-top [data-close]').click();
  await expect.poll(async () => (await state()).cabinet).toBe('');
  expect(errors).toEqual([]);
});
test('a real saved game result stays on screen and its rules remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const response = await page.request.post('/api/auth/login', { data: { email: `window-${crypto.randomUUID()}@example.test`, password: 'Window-layout-isolated-password!' } });
  expect(response.ok()).toBe(true); const { account } = await response.json();
  expect((await page.request.post('/api/auth/character', { data: { skin: 0 } })).ok()).toBe(true);
  const headers = { 'X-Royal-Account-Id': account.id };
  expect((await page.request.post('/api/demo-wallet/operations', { headers, data: { id: crypto.randomUUID(), kind: 'deposit', amount: 1000 } })).ok()).toBe(true);
  await page.goto(`/tests/fixtures/game-window.html?game=variant-target-plinko&account=${account.id}`);
  await expect(page.locator('[data-start]')).toBeEnabled();
  await page.locator('[data-setting=edges]').click();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/demo-wallet/expansion') && r.request().method() === 'POST');
  await page.locator('[data-start]').click(); const result = await saved; expect(result.ok()).toBe(true);
  const settled = await result.json(); expect(settled.session.state).toBe('settled');
  await expect(page.locator('[data-start]')).toBeEnabled(); await fits(page);
  const current = await (await page.request.get('/api/demo-wallet', { headers })).json();
  expect(current.balance).toBe(settled.wallet.balance);
  expect(current.entries.filter((entry: any) => entry.operationId === settled.session.id && entry.kind === 'bet')).toHaveLength(1);
  await page.getByRole('button', { name: 'Правила игры', exact: true }).click();
  await expect(page.locator('[data-window-sheet=rules]')).toBeVisible();
  await expect(page.locator('[data-window-sheet=rules] details')).toContainText('ставк');
  await page.keyboard.press('Escape'); await fits(page);
  await page.screenshot({ path: `${artifacts}/plinko-result-mobile.png` });
});
