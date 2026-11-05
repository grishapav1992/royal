import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const proof = 'artifacts/work/entry-modes';
test.beforeAll(async () => {
  await mkdir(proof, { recursive: true });
  await writeFile(proof + '/owner.json', JSON.stringify({ owner: 'entry-mode-design', purpose: 'Local entry, chat, mode switching and wallet verification', cleanupCondition: 'Keep final screenshots; delete transient test output after verification' }));
});
test.afterEach(async ({ page }) => { await page.request.post('/api/auth/logout').catch(() => {}); });
async function account(page: Page) {
  const response = await page.request.post('/api/auth/login', { data: { email: `entry-${crypto.randomUUID()}@example.test`, password: 'EntryLocal2026' } });
  expect(response.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character', { data: { skin: 0, name: 'Гость проверки' } })).ok()).toBe(true);
  expect((await page.request.post('/__local/entry-credit')).ok()).toBe(true);
}
async function connected(page: Page) {
  try { await expect(page.locator('#chat-input')).toBeEnabled({ timeout: 30000 }); }
  catch (error) {
    console.log('Entry diagnostic', await page.evaluate(() => ({ network: (window as any).royalDemo?.getNetworkState(), error: document.querySelector('#join-error')?.textContent, login: document.querySelector('#join-dialog')?.hasAttribute('open') })));
    throw error;
  }
}
const network = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());
async function roulette(page: Page) {
  await page.locator('#casino-catalog [data-platform-game="royal-roulette"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'royal-roulette', { timeout: 25000 });
  await expect(page.locator('[data-rr-spin]')).toBeEnabled();
}

test('entry choice remembers the mode and opens the real casino without loading the world', async ({ page }) => {
  const worldRequests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/\/game\/(?:RoomScene|ClubWorld)\./.test(request.url())) worldRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#entry-title')).toHaveText('Как будешь играть?');
  await page.screenshot({ path: proof + '/entry-desktop.png' });
  await page.locator('#remember-entry-mode').check();
  await page.locator('[data-entry-mode="casino"]').click();
  await page.locator('#email').fill(`entry-choice-${crypto.randomUUID()}@example.test`); await page.locator('#password').fill('EntryLocal2026'); await page.locator('#login-button').click();
  await connected(page);
  await expect(page.locator('.casino-panel')).toBeVisible();
  expect(await page.evaluate(() => (window as any).royalDemo.isWorldLoaded())).toBe(false);
  expect(worldRequests).toEqual([]);
  await expect(page.locator('#game canvas')).toHaveCount(0);
  const catalogue = page.locator('#casino-catalog');
  const games = catalogue.locator('[data-platform-game]');
  const gameCount = await games.count();
  const search = catalogue.getByRole('searchbox');
  await search.fill('Cosmic Escape');
  await expect(games).toHaveCount(1);
  await expect(games.first()).toHaveAttribute('data-platform-game', 'studio-cosmic-escape');
  await search.clear();
  const genre = catalogue.getByRole('combobox', { name: 'Жанр' });
  await genre.selectOption('wheel');
  await expect(catalogue.locator('[data-platform-game="royal-roulette"]')).toBeVisible();
  await expect(catalogue.locator('[data-platform-game="studio-cosmic-escape"]')).toHaveCount(0);
  await genre.selectOption('all');
  await expect(games).toHaveCount(gameCount);
  await search.blur();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: proof + '/casino-desktop.png' });
  await page.reload(); await connected(page);
  await expect(page.locator('#entry-title')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'casino');
  expect(errors).toEqual([]);
});

test('mode switching keeps the same session and chat draft, with live chat across the two modes', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await account(page); await page.goto('/?mode=casino'); await connected(page);
  const initial = await network(page);
  await page.locator('#chat-input').fill('Сохрани мой черновик');
  await page.locator('[data-view-mode="club"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'club', { timeout: 40000 });
  await expect(page.locator('#game canvas')).toBeVisible();
  expect((await network(page)).selfId).toBe(initial.selfId);
  expect((await network(page)).roomId).toBe(initial.roomId);
  await expect(page.locator('#chat-input')).toHaveValue('Сохрани мой черновик');
  await page.screenshot({ path: proof + '/club-desktop.png' });
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game', 'royal-catalog', { timeout: 30000 });
  await page.locator('#mini-dialog [data-platform-game="royal-roulette"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'royal-roulette', { timeout: 25000 });
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().cabinet)).toBe('');
  await page.locator('[data-view-mode="casino"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'casino');
  await expect(page.locator('#chat-input')).toHaveValue('Сохрани мой черновик');
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  const friend = await context.newPage();
  try {
    await account(friend); await friend.goto(`/?mode=club&room=${initial.roomId}`); await connected(friend);
    await page.locator('#chat-input').fill('Привет из каталога'); await page.locator('#send-chat').click();
    await expect(friend.locator('#chat-log')).toContainText('Привет из каталога', { timeout: 20000 });
    await friend.locator('#chat-input').fill('Привет из клуба'); await friend.locator('#send-chat').click();
    await expect(page.locator('#chat-log')).toContainText('Привет из клуба', { timeout: 20000 });
    expect((await network(page)).selfId).toBe(initial.selfId);
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});

test('casino games use the common wallet and recover a lost response without a second debit', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await account(page); await page.goto('/?mode=casino'); await connected(page); await roulette(page);
  await expect(page.locator('#mini-dialog #chat-input')).toBeInViewport();
  let original: any, accepted: any, writes = 0;
  await page.route('**/api/demo-wallet/operations', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    writes++; original = route.request().postDataJSON();
    const response = await route.fetch(); accepted = await response.json(); await route.abort('failed');
  });
  await page.locator('[data-rr-bet="red"]').click(); await page.locator('[data-rr-spin]').click();
  await expect.poll(() => Boolean(accepted)).toBe(true);
  expect(accepted.gameRound.stakeUnits).toBe('10');
  await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат', { timeout: 20000 });
  await page.locator('#mini-dialog .mini-top [data-close]').click(); await roulette(page);
  await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат');
  await page.unroute('**/api/demo-wallet/operations');
  const retried = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/operations') && response.request().method() === 'POST');
  await page.locator('[data-rr-spin]').click();
  const response = await retried; expect(response.request().postDataJSON()).toEqual(original);
  const recovered = await response.json(); expect(recovered.wallet.balance).toBe(accepted.wallet.balance); expect(writes).toBe(1);
  await expect(page.locator('[data-rr-number]')).toHaveText(String(accepted.gameRound.outcome.number));
  await expect(page.locator('.rr-root')).toHaveAttribute('data-busy', 'false');
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect(page.locator('.casino-panel')).toBeVisible();
  expect(await page.evaluate(() => (window as any).royalDemo.isWorldLoaded())).toBe(false);
  expect(errors).toEqual([]);
});

test('phone catalogue and chat stay usable in both orientations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.screenshot({ path: proof + '/entry-mobile.png' });
  await account(page); await page.goto('/?mode=casino'); await connected(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.casino-chat-toggle')).toBeVisible(); await page.locator('.casino-chat-toggle').click();
    await expect(page.locator('#chat-input')).toBeInViewport();
    await page.locator('#chat-input').fill('Мобильный черновик'); await page.locator('.casino-chat-close').click();
    await expect(page.locator('#casino-catalog')).toBeVisible();
    await page.screenshot({ path: `${proof}/casino-${viewport.width}.png` });
  }
  await roulette(page);
  await expect(page.locator('[data-rr-spin]')).toBeInViewport();
  const chat = page.locator('#mini-dialog .game-chat-toggle'); await chat.click();
  await expect(page.locator('#chat-input')).toBeInViewport();
  await expect(page.locator('#chat-input')).toHaveValue('Мобильный черновик');
  await page.screenshot({ path: proof + '/game-mobile-chat.png' });
});

test('new casino player skips the character editor and can change entry preference in settings', async ({ page }) => {
  await page.goto('/?mode=casino');
  await page.locator('#email').fill(`new-entry-${crypto.randomUUID()}@example.test`);
  await page.locator('#password').fill('EntryLocal2026'); await page.locator('#login-button').click();
  await connected(page);
  await expect(page.locator('#join-dialog')).toBeHidden();
  const identity = await (await page.request.get('/api/auth/me')).json(); expect(identity.account.skin).toBe(0);
  await page.locator('.profile-toggle').click();
  await page.getByRole('button', { name: 'Настройки игрока', exact: true }).click();
  const preference = page.getByLabel('Запоминать режим входа'); await preference.check();
  await page.locator('#cancel-name').click(); await page.reload(); await connected(page);
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'casino');
  await page.locator('.profile-toggle').click();
  await page.getByRole('button', { name: 'Настройки игрока', exact: true }).click(); await preference.uncheck();
  await page.locator('#cancel-name').click(); await page.reload();
  // The explicit URL mode remains usable; without it, the chooser returns.
  await page.goto('/'); await expect(page.locator('#entry-title')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: 'Язык' }).selectOption('en');
  await expect(page.locator('#entry-title')).toHaveText('How would you like to play?');
  await expect(page.getByRole('checkbox', { name: 'Open this mode next time' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  await page.getByRole('button', { name: /Open the casino/ }).click();
  await connected(page);
  await expect(page.getByRole('heading', { name: 'Royal games' })).toBeVisible();
  await expect(page.locator('#casino-catalog [data-platform-wallet]')).toHaveText(/USDT · Demo/);
  await expect(page.getByRole('searchbox', { name: 'Find a game' })).toBeVisible();
  const englishGenre = page.getByRole('combobox', { name: 'Genre' });
  await expect(englishGenre.locator('option:checked')).toHaveText('All genres');
  await page.getByRole('button', { name: 'Club', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'club', { timeout: 40000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
