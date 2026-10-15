import { test, expect, type Page, type Response } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BASE_VARIANT_GAMES, VARIANT_GAMES, VARIANT_BASES, VARIANT_NAMES, VARIANT_GEMS, type VariantGameId, type VariantView,
} from '../src/shared/casinoVariants';
import type { ExpansionSession } from '../src/shared/casinoExpansion';
import type { DemoWallet } from '../src/shared/demoWallet';

type Reply = { session: ExpansionSession; wallet: DemoWallet; sessions: ExpansionSession[]; replayed: boolean };
const password = 'Variant-test-wallet-password!';
const endpoint = '/api/demo-wallet/expansion';
let host: Room, room = '';

function record(account: { id: string; email: string }) {
  if (!process.env.ROYAL_VARIANTS_URL) return;
  const path = process.env.ROYAL_VARIANTS_RECORDS || 'artifacts/casino-variants/public-test-accounts.jsonl';
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(account) + '\n');
}

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `variant-host-${crypto.randomUUID()}@example.test`, password } });
  expect(auth.ok()).toBe(true); record((await auth.json()).account);
  await request.post('/api/auth/character', { data: { skin: 0 } });
  const cookie = auth.headers()['set-cookie'].split(';')[0];
  host = await new Client(process.env.ROYAL_VARIANTS_URL || 'http://127.0.0.1:2599', {
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
  await page.getByLabel('Почта', { exact: true }).fill(`variant-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  const auth = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); record((await (await auth).json()).account);
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click(); await joined(page);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  const account = (await (await page.request.get('/api/auth/me')).json()).account;
  return { 'X-Royal-Account-Id': account.id as string };
}
async function open(page: Page, id: VariantGameId) {
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().playing)).toBe(false);
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(41);
  await expect(page.locator('[data-variant]:not([hidden])')).toHaveCount(VARIANT_GAMES.length);
  await page.locator(`[data-variant="${id}"]`).click();
  await expect(page.locator(`.casino-variants.${id}`)).toBeVisible({ timeout: 25000 });
  await expect(page.locator(`[data-casino-mode="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.casino-variants h3')).toHaveText(VARIANT_NAMES[id]);
}
const post = (page: Page) => page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST', { timeout: 15000 });
async function reply(response: Response): Promise<Reply> {
  expect(response.ok()).toBe(true);
  const value = await response.json() as Reply;
  expect(value.session).not.toHaveProperty('engine');
  expect(value.session).not.toHaveProperty('settings');
  expect(value.session.view).not.toHaveProperty('mines');
  return value;
}
const payout = (stake: bigint, multiplier: number) => Number(stake * BigInt(Math.round(multiplier * 10000)) / 10000n);
function verifyOutcome(view: VariantView, stake: string, returned: string) {
  const units = BigInt(stake);
  switch (view.kind) {
    case 'dice':
      expect(view.width).toBe(30); expect(view.low).toBe(35); expect(view.high).toBe(65);
      expect(view.roll).toBeGreaterThanOrEqual(0); expect(view.roll).toBeLessThan(100);
      expect(view.won).toBe(view.roll >= view.low && view.roll < view.high);
      expect(Number(returned)).toBe(view.won ? payout(units, view.multiplier) : 0); break;
    case 'plinko':
      expect(view.risk).toBe('high'); expect(view.rows).toBe(12); expect(view.balls).toHaveLength(2);
      for (const ball of view.balls) {
        expect(ball.path).toHaveLength(12); expect(ball.path.every(p => p === 0 || p === 1)).toBe(true);
        expect(ball.bucket).toBe(ball.path.reduce((a, b) => a + b, 0)); expect(ball.multiplier).toBe(view.table[ball.bucket]);
      }
      expect(Number(returned)).toBe(view.balls.reduce((sum, ball) => sum + payout(units / 2n, ball.multiplier), 0)); break;
    case 'limbo':
      expect(view.target).toBe(10); expect(view.tickets.map(ticket => ticket.target)).toEqual([1.5, 10]);
      for (const ticket of view.tickets) {
        expect(ticket.won).toBe(view.rolled >= ticket.target);
        expect(Number(ticket.returnedUnits)).toBe(ticket.won ? payout(units / 2n, ticket.target) : 0);
      }
      expect(Number(returned)).toBe(view.tickets.reduce((sum, ticket) => sum + Number(ticket.returnedUnits), 0)); break;
    case 'sic-bo':
      expect(view.sum).toBe(11); expect(view.dice).toHaveLength(3);
      expect(view.dice.every(die => Number.isInteger(die) && die >= 1 && die <= 6)).toBe(true);
      expect(view.total).toBe(view.dice.reduce((a, b) => a + b, 0)); expect(view.won).toBe(view.total === 11);
      expect(Number(returned)).toBe(view.won ? payout(units, view.multiplier) : 0); break;
    case 'diamonds':
      expect(view.gem).toBe(1); expect(view.hand).toHaveLength(5);
      expect(view.matches).toBe(view.hand.filter(gem => gem === VARIANT_GEMS[1]).length); expect(view.won).toBe(view.matches >= 2);
      expect(Number(returned)).toBe(view.won ? payout(units, view.multiplier) : 0); break;
    case 'mines':
      expect(view.cells).toHaveLength(16); expect(view.cells.filter(cell => cell === 'mine')).toHaveLength(3);
      expect(view.opened).toHaveLength(view.multiplier === 0 ? 0 : 1);
      expect(Number(returned)).toBe(Number(view.cashoutUnits)); break;
  }
}
async function finishVault(page: Page, value: Reply) {
  let waiting = post(page); await page.locator('.casino-variants [data-cell="0"]').click(); value = await reply(await waiting);
  if (value.session.state === 'active') {
    const view = value.session.view.variant;
    expect(view?.kind).toBe('mines');
    if (view?.kind === 'mines') { expect(view.opened).toEqual([0]); expect(view.cells[0]).toBe('safe'); expect(view.cells.slice(1).every(cell => cell === 'hidden')).toBe(true); }
    await expect.poll(() => page.locator('.casino-variants').evaluate(el => !!document.activeElement && el.contains(document.activeElement) && document.activeElement.matches('[data-cell]:not(:disabled),[data-cashout]:not(:disabled)'))).toBe(true);
    waiting = post(page); await page.locator('.casino-variants [data-cashout]').click(); value = await reply(await waiting);
  }
  expect(value.session.state).toBe('settled'); return value;
}

test('six distinct variants preserve classics and settle exact shared-wallet payouts on desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  expect((await page.request.get(endpoint)).status()).toBe(401);
  const headers = await login(page);
  const forged = { id: crypto.randomUUID(), gameId: 'variant-dice', action: 'start', stakeUnits: '1000', settings: { variant: { width: 30 } }, payoutUnits: '999999' };
  expect((await page.request.post(endpoint, { headers, data: forged })).status()).toBe(400);
  expect((await page.request.post(endpoint, { headers, data: { ...forged, payoutUnits: undefined, settings: { variant: { width: 51 } } } })).status()).toBe(400);
  expect((await page.request.get(endpoint, { headers: { 'X-Royal-Account-Id': crypto.randomUUID() } })).status()).toBe(401);
  expect((await page.request.post(endpoint, { headers: { ...headers, Origin: 'https://evil.example' }, data: forged })).status()).toBe(403);
  let balanceUnits = 100000;
  const settings: Partial<Record<VariantGameId, string>> = { 'variant-dice': '30', 'variant-plinko': 'high', 'variant-limbo': '10', 'variant-sic-bo': '11', 'variant-diamonds': '1' };
  for (const id of BASE_VARIANT_GAMES) {
    await open(page, id);
    await page.locator(`[data-casino-mode="${VARIANT_BASES[id]}"]`).click();
    await expect(page.locator('.casino-variants')).toHaveCount(0);
    await expect(page.locator(`[data-casino-mode="${VARIANT_BASES[id]}"]`)).toHaveAttribute('aria-pressed', 'true');
    expect(Math.round((await (await page.request.get('/api/demo-wallet', { headers })).json()).balance * 100)).toBe(balanceUnits);
    await page.locator(`[data-casino-mode="${id}"]`).click();
    await expect(page.locator('.casino-variants [data-start]')).toBeEnabled();
    if (settings[id]) {
      await page.locator(`.casino-variants [data-setting="${settings[id]}"]`).click();
      await expect(page.locator(`.casino-variants [data-setting="${settings[id]}"]`)).toBeFocused();
    }
    const waiting = post(page); await page.locator('.casino-variants [data-start]').click();
    const response = await waiting; let value = await reply(response);
    expect(response.request().postDataJSON()).toMatchObject({ gameId: id, stakeUnits: '1000', action: 'start' });
    if (id === 'variant-mines') {
      expect(value.session.state).toBe('active');
      const view = value.session.view.variant; expect(view?.kind).toBe('mines');
      if (view?.kind === 'mines') { expect(view.opened).toEqual([]); expect(view.cells.every(cell => cell === 'hidden')).toBe(true); }
      value = await finishVault(page, value);
    }
    expect(value.session.state).toBe('settled'); verifyOutcome(value.session.view.variant!, value.session.stakeUnits, value.session.returnedUnits);
    balanceUnits = balanceUnits - Number(value.session.spentUnits) + Number(value.session.returnedUnits);
    expect(Math.round(value.wallet.balance * 100)).toBe(balanceUnits);
    expect(value.wallet.entries.filter(entry => entry.operationId === value.session.id && entry.kind === 'bet')).toHaveLength(1);
    await expect(page.locator('[data-variant-balance]')).toHaveText((balanceUnits / 100).toLocaleString('ru-RU'));
    await page.screenshot({ path: `artifacts/casino-variants/${id}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('.casino-variants').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator('#mini-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `artifacts/casino-variants/${id}-mobile.png` });
    await page.locator('#mini-dialog .mini-top [data-close]').click(); await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const wallet = await (await page.request.get('/api/demo-wallet', { headers })).json(); expect(Math.round(wallet.balance * 100)).toBe(balanceUnits);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await expect(page.locator('#wallet-balance')).toHaveText((balanceUnits / 100).toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(6); expect(errors).toEqual([]);
});

test('lost vault start replays one paid session and restores its hidden field after reload', async ({ page }) => {
  console.log('Vault recovery: login');
  const headers = await login(page); console.log('Vault recovery: open'); await open(page, 'variant-mines');
  let discarded = false, actionId = '', paid: Reply | undefined;
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const op = route.request().postDataJSON();
    if (!discarded) {
      discarded = true; actionId = op.id; expect(op).toMatchObject({ gameId: 'variant-mines', action: 'start', stakeUnits: '1000', settings: { variant: {} } });
      const response = await route.fetch(); expect(response.ok()).toBe(true); paid = await response.json(); await route.abort('failed');
    } else { expect(op.id).toBe(actionId); await route.continue(); }
  });
  console.log('Vault recovery: lose start reply');
  await page.locator('.casino-variants [data-start]').click(); await expect(page.locator('.casino-variants [data-retry]')).toBeEnabled();
  expect(paid!.wallet.balance).toBe(990); expect(paid!.session.id).toBe(actionId);
  console.log('Vault recovery: reload');
  await page.reload(); await joined(page); console.log('Vault recovery: reopen'); await open(page, 'variant-mines');
  await expect(page.locator('.casino-variants [data-retry]')).toBeEnabled();
  console.log('Vault recovery: replay');
  let waiting = post(page); await page.locator('.casino-variants [data-retry]').click(); let value = await reply(await waiting);
  expect(value.replayed).toBe(true); expect(value.session.id).toBe(actionId); expect(value.wallet.balance).toBe(990);
  expect(value.session.view.variant).toEqual(paid!.session.view.variant);
  expect(value.wallet.entries.filter(entry => entry.operationId === actionId && entry.kind === 'bet')).toHaveLength(1);
  await page.unroute('**/api/demo-wallet/expansion'); console.log('Vault recovery: switch classic');
  await page.locator(`[data-casino-mode="royal-mines"]`).click();
  expect((await (await page.request.get('/api/demo-wallet', { headers })).json()).balance).toBe(990);
  await page.locator(`[data-casino-mode="variant-mines"]`).click();
  await expect(page.locator('.casino-variants [data-cell="0"]')).toBeEnabled();
  await page.locator('#mini-dialog .mini-top [data-close]').click(); await open(page, 'variant-mines');
  await expect(page.locator('.casino-variants [data-cell="0"]')).toBeEnabled();
  console.log('Vault recovery: finish'); value = await finishVault(page, value); expect(value.session.id).toBe(actionId);
  expect(value.wallet.balance).toBe(990 + Number(value.session.returnedUnits) / 100);
  expect(value.wallet.entries.filter(entry => entry.source === 'variant-mines' && entry.kind === 'bet')).toHaveLength(1);
  expect(value.wallet.entries.filter(entry => entry.source === 'variant-mines' && entry.kind === 'win')).toHaveLength(1);
  await page.locator('#mini-dialog .mini-top [data-close]').click(); await open(page, 'variant-mines');
  await expect(page.locator('.casino-variants [data-start]')).toBeEnabled();
  await expect(page.locator('[data-variant-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU'));
});
