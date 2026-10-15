import { test, expect, type Page, type Response } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { VARIANT_BASES, type VariantGameId } from '../src/shared/casinoVariants';
import type { ExpansionSession } from '../src/shared/casinoExpansion';
import type { DemoWallet } from '../src/shared/demoWallet';

type Reply = { session: ExpansionSession; wallet: DemoWallet; sessions: ExpansionSession[]; replayed: boolean };
type PersistentGame = 'variant-mines' | 'variant-color' | 'variant-keys';
const password = 'Casino-fault-audit-local-password!';
const endpoint = '/api/demo-wallet/expansion';
const routePattern = '**/api/demo-wallet/expansion';
const boards = '.casino-variants,.casino-next-variants';
let host: Room, room = '';

function record(account: { id: string; email: string }) {
  if (!process.env.ROYAL_AUDIT_URL) return;
  const path = process.env.ROYAL_AUDIT_RECORDS || 'artifacts/casino-audit-20261011/browser-public-accounts.jsonl';
  mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(account) + '\n');
}

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `fault-audit-host-${crypto.randomUUID()}@example.test`, password } });
  expect(auth.ok()).toBe(true); record((await auth.json()).account);
  await request.post('/api/auth/character', { data: { skin: 0 } });
  const cookie = auth.headers()['set-cookie'].split(';')[0];
  host = await new Client(process.env.ROYAL_AUDIT_URL || 'http://127.0.0.1:2602', {
    headers: { Cookie: cookie }, fetchFn: async (url, options) => {
      const response = await request.fetch(String(url), { method: options?.method, headers: Object.fromEntries(new Headers(options?.headers)), data: options?.body as string });
      return new globalThis.Response(await response.body(), { status: response.status(), headers: response.headers() });
    },
  }).create('lobby');
  room = host.roomId;
  for (const type of ['chat', 'activities', 'piano-note', 'notice']) host.onMessage(type, () => {});
});
test.afterAll(async () => { await host?.leave(); });

async function joined(page: Page) {
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
}
async function login(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?room=' + room);
  await page.getByLabel('Почта', { exact: true }).fill(`fault-audit-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  const auth = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); record((await (await auth).json()).account);
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await joined(page);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  const account = (await (await page.request.get('/api/auth/me')).json()).account;
  return { 'X-Royal-Account-Id': account.id as string };
}
async function open(page: Page, game: VariantGameId) {
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().playing)).toBe(false);
  await page.locator('#games-tab').click();
  await page.locator(`[data-variant="${game}"]`).click();
  await expect(page.locator(`.${game}`)).toBeVisible({ timeout: 25000 });
  await expect(page.locator(`[data-casino-mode="${game}"]`)).toHaveAttribute('aria-pressed', 'true');
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }
const post = (page: Page) => page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
async function reply(response: Response): Promise<Reply> { expect(response.ok()).toBe(true); return response.json(); }
async function start(page: Page) {
  await expect(page.locator('[data-start]')).toBeEnabled();
  const waiting = post(page); await page.locator('[data-start]').click(); return reply(await waiting);
}
async function oneMove(page: Page, game: PersistentGame) {
  if (game === 'variant-keys') {
    await page.locator('[data-key-cell="0"]:enabled').click();
    await page.locator('[data-key-cell="2"]:enabled').click();
  }
  const waiting = post(page);
  await page.locator(game === 'variant-mines' ? '[data-cell="0"]' : game === 'variant-color' ? '[data-move="red"]' : '[data-move="unlock"]').click();
  return reply(await waiting);
}
async function reachCashout(page: Page, game: PersistentGame) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const initial = await start(page); expect(initial.session.state).toBe('active');
    const value = await oneMove(page, game);
    if (value.session.state === 'active') return value;
    expect(value.session.returnedUnits).toBe('0');
  }
  throw new Error('No first-step success in 24 independent rounds');
}
async function checkWallet(page: Page, headers: Record<string,string>, expected: Reply) {
  const wallet = await (await page.request.get('/api/demo-wallet', { headers })).json() as DemoWallet;
  expect(wallet.balance).toBe(expected.wallet.balance);
  expect(wallet.entries).toEqual(expected.wallet.entries);
  await expect(page.locator('[data-variant-balance]')).toHaveText(wallet.balance.toLocaleString('ru-RU'));
}

for (const game of ['variant-mines','variant-color','variant-keys'] as const) {
  test(`lost successful ${game} cashout survives mode switches and reload with one payout`, async ({ page }) => {
    const headers = await login(page); await open(page, game);
    const active = await reachCashout(page, game);
    expect(Number((active.session.view.variant as {cashoutUnits:string}).cashoutUnits)).toBeGreaterThan(0);
    let committed: Reply | undefined, operationId = '', calls = 0;
    await page.route(routePattern, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const operation = route.request().postDataJSON(); calls++;
      expect(operation).toMatchObject({ gameId: game, action: 'move', move: 'cashout', sessionId: active.session.id });
      if (!committed) {
        operationId = operation.id;
        const response = await route.fetch(); expect(response.ok()).toBe(true);
        committed = await response.json(); await route.abort('failed');
      } else { expect(operation.id).toBe(operationId); await route.continue(); }
    });
    await page.locator(game === 'variant-mines' ? '[data-cashout]' : '[data-move="cashout"]').click();
    await expect(page.locator('[data-retry]')).toBeEnabled();
    expect(committed!.session.state).toBe('settled');
    expect(committed!.wallet.balance).toBe(active.wallet.balance + Number(committed!.session.returnedUnits) / 100);
    await page.locator(`[data-casino-mode="${VARIANT_BASES[game]}"]`).click();
    await expect(page.locator(boards)).toHaveCount(0);
    await close(page);
    const otherGame = game === 'variant-mines' ? 'variant-war' : 'variant-dice';
    await open(page, otherGame);
    await expect(page.locator('[data-start]')).toBeDisabled();
    await expect(page.locator('[data-retry]')).toBeEnabled();
    expect(calls).toBe(1);
    const waiting = post(page); await page.locator('[data-retry]').click(); const restored = await reply(await waiting);
    expect(restored.replayed).toBe(true); expect(calls).toBe(2);
    expect(restored.session).toEqual(committed!.session);
    expect(restored.wallet.entries.filter(entry => entry.operationId === operationId && entry.kind === 'win')).toHaveLength(1);
    await expect(page.locator('[data-start]')).toBeEnabled();
    await checkWallet(page, headers, restored);
    await page.unroute(routePattern);
    await page.reload(); await joined(page); await open(page, game);
    await expect(page.locator('[data-retry]')).toHaveCount(0);
    await expect(page.locator('[data-start]')).toBeEnabled();
    const state = await (await page.request.get(endpoint, { headers })).json();
    expect(state.sessions.find((session:ExpansionSession) => session.id === active.session.id)).toEqual(restored.session);
    await expect(page.locator(game === 'variant-mines' ? '.variant-return' : '.next-return')).toContainText((Number(restored.session.returnedUnits) / 100).toLocaleString('ru-RU'));
    await checkWallet(page, headers, restored);
    await page.screenshot({ path: `artifacts/casino-audit-20261011/browser-${game}-cashout-restored.png` });
  });
}

test('rapid start clicks debit once and completed-round parameters restore after preview and reload', async ({ page }) => {
  const headers = await login(page);
  for (const game of ['variant-dice','variant-war'] as const) {
    await open(page, game);
    const firstSetting = game === 'variant-dice' ? '30' : 'attack', nextSetting = game === 'variant-dice' ? '70' : 'shield';
    await page.locator('[data-stake]').selectOption('5000');
    await page.locator(`[data-setting="${firstSetting}"]`).click();
    let calls = 0;
    await page.route(routePattern, async route => {
      if (route.request().method() === 'POST') calls++;
      await route.continue();
    });
    const waiting = post(page);
    await page.locator('[data-start]').evaluate(element => { const button = element as HTMLButtonElement; button.click(); button.click(); });
    const paid = await reply(await waiting);
    expect(paid.session.state).toBe('settled'); expect(paid.session.stakeUnits).toBe('5000');
    expect(calls).toBe(1);
    expect(paid.wallet.entries.filter(entry => entry.operationId === paid.session.id && entry.kind === 'bet')).toHaveLength(1);
    await checkWallet(page, headers, paid);
    await page.locator('[data-stake]').selectOption('10000');
    await page.locator(`[data-setting="${nextSetting}"]`).click();
    await expect(page.locator('[data-stake]')).toHaveValue('10000');
    await expect(page.locator(`[data-setting="${nextSetting}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.variant-result,.next-result')).toHaveCount(0);
    const read = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'GET');
    await page.locator('[data-refresh]').click(); await read;
    await expect(page.locator('[data-stake]')).toBeEnabled();
    await expect(page.locator('[data-stake]')).toHaveValue('10000');
    await expect(page.locator(`[data-setting="${nextSetting}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.variant-result,.next-result')).toHaveCount(0);
    expect(calls).toBe(1); await page.unroute(routePattern);
    await page.reload(); await joined(page); await open(page, game);
    await expect(page.locator('[data-stake]')).toHaveValue('5000');
    await expect(page.locator(`[data-setting="${firstSetting}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.variant-result,.next-result')).toHaveCount(1);
    await checkWallet(page, headers, paid);
    await close(page);
  }
});

test('a delayed older refresh cannot replace the newer round or wallet', async ({ page }) => {
  const headers = await login(page); await open(page, 'variant-dice');
  await expect(page.locator('[data-start]')).toBeEnabled();
  let releaseRead!: () => void, readReady!: () => void;
  const paused = new Promise<void>(resolve => { releaseRead = resolve; });
  const fetched = new Promise<void>(resolve => { readReady = resolve; });
  let captured = false;
  await page.route(routePattern, async route => {
    if (route.request().method() !== 'GET' || captured) return route.continue();
    captured = true; const response = await route.fetch(); expect(response.ok()).toBe(true);
    readReady(); await paused; await route.fulfill({ response });
  });
  await page.locator('[data-setting="30"]').click();
  await page.locator('[data-refresh]').click(); await fetched;
  const waiting = post(page);
  await page.locator('[data-start]').click();
  const paid = await reply(await waiting);
  const staleRead = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'GET');
  releaseRead(); await (await staleRead).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[data-setting="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.variant-result')).toHaveCount(1);
  await checkWallet(page, headers, paid);
  if (!process.env.ROYAL_AUDIT_URL) {
    const client = await page.evaluate(async () => {
      const { expansionClient } = await import('/src/wallet/ExpansionClient.ts');
      return { session: expansionClient.sessions.find(session => session.gameId === 'variant-dice'), wallet: expansionClient.wallet, loading: expansionClient.loading };
    });
    expect(client.session).toEqual(paid.session); expect(client.wallet).toEqual(paid.wallet); expect(client.loading).toBe(false);
  }
  await page.unroute(routePattern);
});

test('an inconsistent successful response keeps one saved operation until valid replay', async ({ page }) => {
  const headers = await login(page); await open(page, 'variant-dice');
  let committed: Reply | undefined, operationId = '', calls = 0;
  await page.route(routePattern, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const operation = route.request().postDataJSON(); calls++;
    if (!committed) {
      operationId = operation.id; const response = await route.fetch(); expect(response.ok()).toBe(true);
      committed = await response.json(); const corrupted = structuredClone(committed!);
      if (corrupted.session.view.variant?.kind !== 'dice') throw new Error('Wrong variant in fixture');
      corrupted.session.view.variant.multiplier += 1;
      await route.fulfill({ response, json: corrupted });
    } else { expect(operation.id).toBe(operationId); await route.continue(); }
  });
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-retry]')).toBeEnabled();
  await expect(page.locator('[data-start]')).toBeDisabled();
  await expect(page.locator('.variant-error')).toHaveText('Ход не подтверждён. Проверь ту же операцию.');
  const waiting = post(page); await page.locator('[data-retry]').click(); const restored = await reply(await waiting);
  expect(calls).toBe(2); expect(restored.replayed).toBe(true); expect(restored.session).toEqual(committed!.session);
  expect(restored.wallet.entries.filter(entry => entry.operationId === operationId && entry.kind === 'bet')).toHaveLength(1);
  await expect(page.locator('[data-retry]')).toHaveCount(0); await expect(page.locator('[data-start]')).toBeEnabled();
  await checkWallet(page, headers, restored); await page.unroute(routePattern);
});

test('a delayed classic Hi-Lo response cannot overwrite the selected color variant', async ({ page }) => {
  const headers = await login(page); await open(page, 'variant-color');
  await page.locator('[data-casino-mode="github-hilo"]').click();
  await expect(page.locator('.casino-session [data-start]')).toBeEnabled();
  let releaseReply!: () => void, replyReady!: () => void;
  const paused = new Promise<void>(resolve => { releaseReply = resolve; });
  const fetched = new Promise<void>(resolve => { replyReady = resolve; });
  await page.route('**/api/demo-wallet/casino-sessions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    replyReady(); await paused; await route.fulfill({ response });
  });
  await page.locator('.casino-session [data-start]').click(); await fetched;
  await page.locator('[data-casino-mode="variant-color"]').click();
  await expect(page.locator('.variant-color')).toBeVisible();
  const waiting = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/casino-sessions') && response.request().method() === 'POST');
  releaseReply(); await waiting;
  await expect(page.locator('.variant-color [data-start]')).toBeEnabled();
  await expect(page.locator('[data-casino-mode="variant-color"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.casino-session')).toHaveCount(0);
  await page.unroute('**/api/demo-wallet/casino-sessions');
  // Finish the isolated classic party so public verification leaves no held stake.
  const state = await (await page.request.get('/api/demo-wallet/casino-sessions', { headers })).json();
  const session = state.sessions.find((value: {gameId:string}) => value.gameId === 'github-hilo');
  if (session?.state === 'active') {
    const direction = session.next?.higher ? 'higher' : 'lower';
    const moved = await page.request.post('/api/demo-wallet/casino-sessions', { headers, data: { id: crypto.randomUUID(), gameId: 'github-hilo', action: 'pick', sessionId: session.id, choice: direction } });
    expect(moved.ok()).toBe(true); const value = await moved.json();
    if (value.session.state === 'active') {
      const cashout = await page.request.post('/api/demo-wallet/casino-sessions', { headers, data: { id: crypto.randomUUID(), gameId: 'github-hilo', action: 'cashout', sessionId: session.id } });
      expect(cashout.ok()).toBe(true); expect((await cashout.json()).session.state).toBe('cashed_out');
    }
  }
});
