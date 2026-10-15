import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { validStudioSettlement, type StudioSlotView } from '../src/shared/studioGames';
import type { ExpansionSession } from '../src/shared/casinoExpansion';

const directory = 'artifacts/neon-slot-20261012';
const endpoint = '/api/demo-wallet/expansion';
const password = 'Royal-neon-isolated-browser-password!';
const game = 'studio-neon-crown';
type Reply = { session: ExpansionSession; wallet: { balance: number; entries: { operationId: string; kind: string }[] }; replayed: boolean };
let host: Room;
let room = '';

function record(account: { id: string; email: string }) {
  if (process.env.ROYAL_NEON_RECORDS) appendFileSync(process.env.ROYAL_NEON_RECORDS, JSON.stringify(account) + '\n');
}

function proof(value: unknown) {
  appendFileSync(directory + '/public-rounds.jsonl', JSON.stringify(value) + '\n');
}

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `royalneon-host-${crypto.randomUUID()}@example.test`, password } });
  expect(auth.ok()).toBe(true);
  record((await auth.json()).account);
  await request.post('/api/auth/character', { data: { skin: 0 } });
  host = await new Client(process.env.TEST_BASE_URL!, {
    headers: { Cookie: auth.headers()['set-cookie'].split(';')[0] },
    fetchFn: async (url, options) => {
      const response = await request.fetch(String(url), { method: options?.method, headers: Object.fromEntries(new Headers(options?.headers)), data: options?.body as string });
      return new globalThis.Response(await response.body(), { status: response.status(), headers: response.headers() });
    },
  }).create('lobby');
  room = host.roomId;
  for (const type of ['chat', 'activities', 'piano-note', 'notice']) host.onMessage(type, () => {});
});

test.afterAll(async () => { await host?.leave(); });

async function joined(page: Page) {
  await page.bringToFront();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 });
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
}

async function login(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?room=' + room);
  await page.getByLabel('Почта', { exact: true }).fill(`royalneon-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await joined(page);
  const account = (await (await page.request.get('/api/auth/me')).json()).account;
  record(account);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  return { account, headers: { 'X-Royal-Account-Id': account.id } };
}

async function open(page: Page) {
  if (!await page.locator('[data-studio-filter="all"]').isVisible()) await page.locator('#games-tab').click();
  await page.locator('[data-studio-filter="all"]').click();
  await page.locator(`[data-studio="${game}"]`).click();
  await expect(page.locator(`[data-studio-game="${game}"]`)).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-refresh]')).toBeEnabled();
}

async function checkResult(page: Page, value: Reply) {
  const session = value.session;
  expect(session.gameId).toBe(game);
  expect(session.state).toBe('settled');
  expect(validStudioSettlement(game, session.state, session.stakeUnits, session.spentUnits, session.returnedUnits, session.view.studio)).toBe(true);
  await expect(page.locator('[data-start]')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('.studio-error')).toBeEmpty();
  await expect(page.locator('[data-studio-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  await expect(page.locator('.studio-stage-payout strong')).toHaveText((Number(session.returnedUnits) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' монет');
  const grid = session.view.studio as StudioSlotView;
  const shown = await page.locator('[data-slot-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.slotCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.position - b.position));
  expect(shown.map(row => row.symbol)).toEqual(grid.grid);
  expect(value.wallet.entries.filter(entry => entry.operationId === session.id && entry.kind === 'bet')).toHaveLength(1);
  expect(value.wallet.entries.filter(entry => entry.operationId === session.id && entry.kind === 'win')).toHaveLength(1);
}

async function wallet(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.get('/api/demo-wallet', { headers });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function coreVisible(page: Page) {
  const visible = await page.locator('[data-neon-slot]').evaluate(root => {
    const dialog = root.closest('dialog')!;
    const bounds = dialog.getBoundingClientRect();
    const controls = ['[data-neon-reels]', '[data-stake]', '[data-start]'].map(selector => root.querySelector(selector)!.getBoundingClientRect());
    return dialog.scrollTop === 0 && controls.every(box => box.top >= bounds.top && box.bottom <= Math.min(bounds.bottom, innerHeight));
  });
  expect(visible).toBe(true);
}

test('published Neon spins through the real wallet and preserves one result across refresh and reopen', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const { account, headers } = await login(page);
  await open(page);
  await coreVisible(page);
  const calls: string[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    calls.push(route.request().postDataJSON().id);
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ response });
  });
  const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-start]')).toBeDisabled();
  await expect(page.locator('[data-stake]')).toBeDisabled();
  const firstMotion = await page.locator('[data-neon-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform));
  await page.waitForTimeout(180);
  const secondMotion = await page.locator('[data-neon-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform));
  expect(secondMotion).not.toEqual(firstMotion);
  await page.locator('[data-start]').evaluate((button: HTMLButtonElement) => button.click());
  const value = await (await response).json() as Reply;
  await checkResult(page, value);
  await coreVisible(page);
  expect(calls).toHaveLength(1);
  expect(value.wallet.balance).toBe((100000 - Number(value.session.spentUnits) + Number(value.session.returnedUnits)) / 100);
  const firstAudio = await page.evaluate(() => (window as any).royalDemo.getAudio());
  expect(firstAudio.slot.played.click).toBe(1);
  expect(firstAudio.slot.played['reel-stop']).toBe(3);
  await page.locator('[data-refresh]').click();
  await expect(page.locator('[data-refresh]')).toBeEnabled();
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await open(page);
  await checkResult(page, value);
  const current = await wallet(page.request, headers);
  expect(current.balance).toBe(value.wallet.balance);
  expect(calls).toHaveLength(1);
  const restoredAudio = await page.evaluate(() => (window as any).royalDemo.getAudio());
  expect(restoredAudio.slot.played).toEqual(firstAudio.slot.played);
  proof({ scenario: 'desktop', accountId: account.id, sessionId: value.session.id, spentUnits: value.session.spentUnits, returnedUnits: value.session.returnedUnits, grid: value.session.view.studio, balance: value.wallet.balance, postCount: calls.length, firstAudio, restoredAudio });
  await page.screenshot({ path: directory + '/public-neon-desktop.png' });
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  expect(errors).toEqual([]);
});

test('published Neon restores a lost reply on a phone and retries the original UUID once', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { account, headers } = await login(page);
  await open(page);
  await coreVisible(page);
  let committed: Reply | undefined;
  const ids: string[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().id);
    if (committed) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committed = await response.json() as Reply;
    await route.abort('failed');
  });
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-retry]')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('[data-start]')).toBeDisabled();
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await page.reload();
  await joined(page);
  await open(page);
  await expect(page.locator('[data-retry]')).toBeEnabled();
  const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-retry]').click();
  const replay = await (await response).json() as Reply;
  expect(replay.replayed).toBe(true);
  expect(replay.session).toEqual(committed!.session);
  await checkResult(page, replay);
  await coreVisible(page);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(1);
  expect((await wallet(page.request, headers)).balance).toBe(replay.wallet.balance);
  expect(await page.locator('#mini-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  proof({ scenario: 'mobile-lost-reply', accountId: account.id, sessionId: replay.session.id, spentUnits: replay.session.spentUnits, returnedUnits: replay.session.returnedUnits, grid: replay.session.view.studio, balance: replay.wallet.balance, postCount: ids.length, uniqueOperationIds: new Set(ids).size });
  await page.screenshot({ path: directory + '/public-neon-mobile.png' });
  await page.locator('#mini-dialog .mini-top [data-close]').click();
});
