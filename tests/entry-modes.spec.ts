import { selectEntryMode } from './entry-mode';
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

test('mode selection precedes sign-in and opens the real casino without loading the world', async ({ page }) => {
  const worldRequests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/\/game\/(?:RoomScene|ClubWorld)\./.test(request.url())) worldRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const sessionChecks: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/me') sessionChecks.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#entry-title')).toHaveText('Как будешь играть?');
  await expect(page.locator('#login-form')).toHaveCount(0);
  await expect.poll(() => page.locator('.entry-art img').evaluateAll(images =>
    images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  expect(sessionChecks).toHaveLength(0);
  await page.screenshot({ path: proof + '/entry-desktop.png' });
  await expect(page.getByRole('button', { name: 'В клуб с персонажем', exact: true })).toBeVisible();
  await expect(page.getByText('Открыть казино', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Войти в клуб', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сразу к играм', exact: true }).press('Enter');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#join-dialog a[href*="offline=1"]')).toHaveCount(0);
  expect(sessionChecks).toHaveLength(1);
  const email = `entry-choice-${crypto.randomUUID()}@example.test`;
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('EntryLocal2026');
  await page.locator('#login-button').click();
  await connected(page);
  await expect(page.locator('.casino-panel')).toBeVisible();
  await expect(page.locator('dialog#join-dialog a[href*="offline=1"]')).toHaveCount(0);
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
  await page.reload();
  await expect(page.locator('#entry-title')).toBeVisible();
  await expect(page.locator('#login-form')).toHaveCount(0);
  await selectEntryMode(page, 'casino');
  await connected(page);
  await expect(page.locator('.entry-login #login-form')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'casino');
  await page.locator('.profile-toggle').click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.locator('#entry-title')).toBeVisible();
  await expect(page.locator('#login-form')).toHaveCount(0);
  await selectEntryMode(page, 'casino');
  await expect(page.locator('.entry-login #login-form')).toBeVisible();
  await expect(page.locator('#casino-catalog')).toHaveCount(0);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('WrongLocal2026');
  await page.locator('#login-button').click();
  await expect(page.locator('#join-error')).toHaveText('Неверная почта или пароль.');
  await expect(page.locator('[data-entry-mode]')).toHaveCount(0);
  await page.locator('#password').fill('EntryLocal2026');
  await page.locator('#login-button').click();
  await connected(page);
  await expect(page.locator('body')).toHaveAttribute('data-entry-mode', 'casino');
  expect(errors).toEqual([]);
});

test('mode switching keeps the same session and chat draft, with live chat across the two modes', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await account(page); await page.goto('/?mode=casino'); await selectEntryMode(page, 'casino'); await connected(page);
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
    await account(friend); await friend.goto(`/?mode=club&room=${initial.roomId}`); await selectEntryMode(friend, 'club'); await connected(friend);
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
  await account(page); await page.goto('/?mode=casino'); await selectEntryMode(page, 'casino'); await connected(page); await roulette(page);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await account(page);
  await page.goto('/');
  await expect(page.locator('#entry-title')).toBeVisible();
  await page.screenshot({ path: proof + '/entry-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectEntryMode(page, 'casino'); await connected(page);
  await expect(page.locator('.entry-login #login-form')).toHaveCount(0);
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

test('phone chooses before login even with a mode link and a saved preference from an earlier version', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('royal-entry-mode', 'club'));
  await page.goto('/?mode=casino');
  await expect(page.locator('#entry-title')).toBeVisible();
  await expect(page.locator('.entry-casino .entry-mode-hint')).toHaveText('Режим из ссылки');
  await expect(page.locator('#login-form')).toHaveCount(0);
  await selectEntryMode(page, 'club');
  await expect(page.locator('#login-form')).toBeVisible();
  await page.getByRole('button', { name: 'К выбору режима' }).click();
  await expect(page.locator('.entry-club')).toBeFocused();
  await selectEntryMode(page, 'casino');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#casino-catalog')).toHaveCount(0);
  await page.locator('#email').fill(`new-entry-${crypto.randomUUID()}@example.test`);
  await page.locator('#password').fill('EntryLocal2026'); await page.locator('#login-button').click();
  await connected(page);
  await expect(page.locator('#join-dialog')).toBeHidden();
  const identity = await (await page.request.get('/api/auth/me')).json(); expect(identity.account.skin).toBe(0);
  await page.goto('/');
  await expect(page.locator('#entry-title')).toBeVisible();
  await page.getByRole('combobox', { name: 'Язык' }).selectOption('en');
  await expect(page.locator('#entry-title')).toHaveText('How would you like to play?');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  await page.getByRole('button', { name: 'Straight to the games', exact: true }).click();
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

test('a failed session check offers retry before asking for credentials', async ({ page }) => {
  await account(page);
  await page.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { error: 'Сеть недоступна.' } }), { times: 1 });
  await page.goto('/');
  await selectEntryMode(page, 'casino');
  await expect(page.getByRole('alert')).toHaveText('Сеть недоступна.');
  await expect(page.locator('#login-form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await connected(page);
  await expect(page.locator('.entry-login #login-form')).toHaveCount(0);
});

test('club video loops and the flag preview starts another demo round after one winner', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const gameplayRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') || path.startsWith('/game-modules/')) gameplayRequests.push(path);
  });
  await page.goto('/');
  const club = page.locator('.entry-club video');
  const flags = page.locator('.entry-casino canvas');
  const clipState = () => club.evaluate((video: HTMLVideoElement) => ({ paused: video.paused, ended: video.ended,
    loop: video.loop, time: video.currentTime, source: video.getAttribute('src') }));
  expect(await clipState()).toEqual({ paused: true, ended: false, loop: true, time: 0, source: null });
  expect(await flags.getAttribute('data-round')).toBeNull();

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => { const clip = await clipState(); return !clip.paused && clip.time > 0; }).toBe(true);
  await expect(page.getByRole('button', { name: 'Приостановить анимацию' })).toHaveCount(0);
  await club.evaluate((video: HTMLVideoElement) => { video.currentTime = video.duration - .25; });
  await expect.poll(async () => { const clip = await clipState(); return clip.loop && !clip.ended && !clip.paused && clip.time < 1; }).toBe(true);
  await expect(flags).toHaveAttribute('data-phase', 'winner', { timeout: 12000 });
  await expect(flags).toHaveAttribute('data-remaining', '1');
  await expect(flags).toHaveAttribute('data-round', '2');
  await expect(flags).toHaveAttribute('data-remaining', '12');
  expect(gameplayRequests).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(club).toBeHidden();
  await expect(flags).toBeHidden();
  await selectEntryMode(page, 'casino');
  await expect(page.locator('#login-form')).toBeVisible();
});

test('mobile entry only loads a clip when its card is in view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const casino = page.locator('.entry-casino canvas');
  const club = page.locator('.entry-club video');
  await expect(casino).toHaveAttribute('data-has-frame', '');
  expect(await club.getAttribute('src')).toBeNull();
  await club.scrollIntoViewIfNeeded();
  await expect.poll(() => club.evaluate(clip => (clip as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
});
