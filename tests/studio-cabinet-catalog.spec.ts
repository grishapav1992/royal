import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import { STUDIO_GAMES, STUDIO_INFO } from '../src/shared/studioGames';
import { CABINETS } from '../src/shared/cabinets';
import { worldPoint } from './room-ui';

const artifacts = 'artifacts/studio-cabinet-catalog';
async function state(page: Page) { return page.evaluate(() => (window as any).royalDemo.getState()); }
async function enter(page: Page, path: string) {
  await page.route('https://luelonplay.com/**', route => route.fulfill({ json: { games: [] } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await page.getByLabel('Почта', { exact: true }).fill(`studio-catalog-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Studio-catalog-test-123!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 });
  await expect.poll(async () => (await state(page)).online).toBe(true);
}
async function approach(page: Page, id: string) {
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
  const cabinet = CABINETS.find(c => c.id === id)!;
  // Reach the aisle below the bar before approaching the cabinet row.
  if ((await state(page)).x < 1100) {
    const aisle = await worldPoint(page, 1100, 900);
    await page.mouse.click(aisle.x, aisle.y);
    await expect.poll(async () => { const s = await state(page); return Math.hypot(s.x - 1100, s.y - 900); }, { timeout: 20000 }).toBeLessThan(30);
  }
  const point = await worldPoint(page, cabinet.x, cabinet.y + 21);
  await page.mouse.click(point.x, point.y);
  try { await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 20000 }); }
  catch (error) { console.log('Cabinet approach state:', JSON.stringify(await state(page))); throw error; }
  await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game', CABINETS.find(c => c.id === id)!.defaultGameId!);
}
async function catalog(page: Page) {
  if (await page.locator('#studio-game-list').isVisible()) await page.locator('#studio-game-list').click();
  const menu = page.locator('#mini-game .royal-platform');
  await expect(menu).toBeVisible();
  expect(await menu.locator('[data-platform-game^="studio-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-game')).sort())).toEqual([...STUDIO_GAMES].sort());
  await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
  await expect(page.locator('#chat-input')).toBeInViewport();
  return menu;
}
async function choose(page: Page, id: string) {
  await page.locator(`#mini-game [data-platform-game="${id}"]`).click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', id, { timeout: 20000 });
  await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game', id);
  await expect(page.locator('#studio-game-list')).toBeVisible();
}

test('a cabinet offers all copied games, filters them and retains one seat, wallet and saved round across switches', async ({ page, roomPath }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page, roomPath);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  await approach(page, 'studio-cosmic-escape');
  const menu = await catalog(page);
  await menu.getByRole('searchbox').fill('несуществующая игра');
  await expect(menu.locator('[data-platform-game^="studio-"]:visible')).toHaveCount(0);
  await expect(menu.locator('.rp-empty')).toBeVisible();
  await menu.getByRole('searchbox').fill('');
  const genre = menu.getByRole('combobox', { name: 'Жанр', exact: true });
  await expect(genre).toBeVisible();
  for (const kind of new Set(STUDIO_GAMES.map(id => STUDIO_INFO[id].kind))) {
    await genre.selectOption(kind);
    const expected = STUDIO_GAMES.filter(id => STUDIO_INFO[id].kind === kind).sort();
    expect(await menu.locator('[data-platform-game^="studio-"]:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-platform-game')).sort())).toEqual(expected);
  }
  await genre.selectOption('dice');
  await menu.getByRole('searchbox').fill('orbit');
  await expect(menu.locator('[data-platform-game^="studio-"]:visible')).toHaveCount(0);
  await expect(menu.locator('.rp-empty')).toBeVisible();
  await genre.selectOption('flight');
  await expect(menu.locator('[data-platform-game^="studio-"]:visible')).toHaveCount(1);
  await menu.getByRole('searchbox').fill('');
  await genre.selectOption('all');
  await page.screenshot({ path: `${artifacts}/catalog-desktop.png` });
  await choose(page, 'studio-fossil-trail');
  await expect(page.locator('#mini-game [data-start]')).toBeEnabled();
  const response = page.waitForResponse(r => r.url().endsWith('/api/demo-wallet/expansion') && r.request().method() === 'POST');
  await page.locator('#mini-game [data-start]').click();
  const result = await response; expect(result.ok()).toBe(true);
  const headers = { 'X-Royal-Account-Id': result.request().headers()['x-royal-account-id'] };
  const saved = await result.json(); expect(saved.session.state).toBe('active');
  const wallet = await (await page.request.get('/api/demo-wallet', { headers })).json();
  await page.locator('#studio-game-list').click();
  await catalog(page);
  expect((await state(page)).cabinet).toBe('studio-cosmic-escape');
  await choose(page, 'studio-signal-fox');
  expect((await state(page)).cabinet).toBe('studio-cosmic-escape');
  await page.locator('#studio-game-list').click();
  await choose(page, 'studio-fossil-trail');
  await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();
  await expect(page.locator('#mini-game [data-start]')).toHaveCount(0);
  const restored = await (await page.request.get('/api/demo-wallet/expansion', { headers })).json();
  expect(restored.sessions.find((s: any) => s.gameId === 'studio-fossil-trail').id).toBe(saved.session.id);
  const unchanged = await (await page.request.get('/api/demo-wallet', { headers })).json();
  expect(unchanged.balance).toBe(wallet.balance);
  expect(unchanged.entries.filter((e: any) => e.operationId === saved.session.id && e.kind === 'bet')).toHaveLength(1);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(async () => (await state(page)).cabinet).toBe('');
  await approach(page, 'studio-caramel-carnival');
  await catalog(page);
  await choose(page, 'studio-fossil-trail');
  await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();
  expect((await state(page)).cabinet).toBe('studio-caramel-carnival');
  expect((await (await page.request.get('/api/demo-wallet/expansion', { headers })).json()).sessions.find((s: any) => s.gameId === 'studio-fossil-trail').id).toBe(saved.session.id);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(async () => (await state(page)).cabinet).toBe('');
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet=studio-cosmic-escape]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'studio-cosmic-escape', { timeout: 30000 });
  await catalog(page);
  await choose(page, 'studio-signal-fox');
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'studio-signal-fox', { timeout: 30000 });
  await expect.poll(async () => (await state(page)).cabinet).toMatch(/^studio-/);
  await page.locator('#studio-game-list').click();
  await catalog(page);
  expect(errors).toEqual([]);
});

test('the real mobile host keeps the catalogue, selected game and connected chat usable', async ({ page, roomPath }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page, roomPath);
  await approach(page, 'studio-velvet-reign');
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = await catalog(page);
  const genre = menu.getByRole('combobox', { name: 'Жанр', exact: true });
  await expect(genre).toBeInViewport();
  await genre.selectOption('flight');
  await expect(menu.locator('[data-platform-game^="studio-"]:visible')).toHaveCount(1);
  await menu.getByRole('searchbox').fill('orbit');
  await page.screenshot({ path: `${artifacts}/catalog-mobile.png` });
  await choose(page, 'studio-orbit');
  await expect(page.locator('#chat-input')).toBeInViewport();
  await page.locator('#chat-input').fill('Каталог работает на телефоне');
  await page.locator('#send-chat').click();
  await expect(page.locator('#chat-log')).toContainText('Каталог работает на телефоне');
  await expect(page.locator('#studio-game-list')).toBeInViewport();
  await page.screenshot({ path: `${artifacts}/game-mobile-chat.png` });
  await page.locator('#studio-game-list').click();
  await catalog(page);
  await menu.getByRole('searchbox').fill('Cosmic');
  await choose(page, 'studio-cosmic-escape');
  expect((await state(page)).cabinet).toBe('studio-velvet-reign');
  await expect(page.locator('[data-cosmic-escape]')).toHaveAttribute('data-asset-state', 'ready', { timeout: 30000 });
  await page.locator('[data-lg-dialog-action=enter]').click();
  await expect(page.locator('#chat-input')).toBeInViewport();
  await expect(page.locator('#studio-game-list')).toBeInViewport();
  await page.screenshot({ path: `${artifacts}/native-slot-mobile-chat.png` });
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(async () => (await state(page)).cabinet).toBe('');
  expect(errors).toEqual([]);
});
