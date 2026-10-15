import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { validStudioSettlement, validStudioSlotPresentation, type StudioSlotView, type StudioSlotPresentation, type StudioPresentationGameId } from '../src/shared/studioGames';
import type { ExpansionSession } from '../src/shared/casinoExpansion';

const directory = 'artifacts/studio-wave2-20261012';
const endpoint = '/api/demo-wallet/expansion';
const password = 'Royal-wave2-isolated-browser-password!';
type Reply = { session: ExpansionSession; wallet: { balance: number; entries: { operationId: string; kind: string }[] }; replayed: boolean };
let host: Room, room = '';
function record(account: { id: string; email: string }) { if (process.env.ROYAL_WAVE2_RECORDS) appendFileSync(process.env.ROYAL_WAVE2_RECORDS, JSON.stringify(account) + '\n'); }
function proof(value: unknown) { mkdirSync(directory, { recursive: true }); appendFileSync(directory + '/public-rounds.jsonl', JSON.stringify(value) + '\n'); }

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `royalwave2-host-${crypto.randomUUID()}@example.test`, password } });
  expect(auth.ok()).toBe(true); record((await auth.json()).account); await request.post('/api/auth/character', { data: { skin: 0 } });
  host = await new Client(process.env.TEST_BASE_URL!, {
    headers: { Cookie: auth.headers()['set-cookie'].split(';')[0] },
    fetchFn: async (url, options) => { const response = await request.fetch(String(url), { method: options?.method, headers: Object.fromEntries(new Headers(options?.headers)), data: options?.body as string }); return new globalThis.Response(await response.body(), { status: response.status(), headers: response.headers() }); },
  }).create('lobby'); room = host.roomId;
  for (const type of ['chat', 'activities', 'piano-note', 'notice']) host.onMessage(type, () => {});
});
test.afterAll(async () => { await host?.leave(); });

async function joined(page: Page) { await page.bringToFront(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 }); if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click(); }
async function login(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/?room=' + room);
  await page.getByLabel('Почта', { exact: true }).fill(`royalwave2-${crypto.randomUUID()}@example.test`); await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#character-step')).toBeVisible(); await page.getByRole('button', { name: 'Войти в зал', exact: true }).click(); await joined(page);
  const account = (await (await page.request.get('/api/auth/me')).json()).account; record(account);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click(); await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/); await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  return { account, headers: { 'X-Royal-Account-Id': account.id as string } };
}
async function open(page: Page, game: StudioPresentationGameId) {
  if (!await page.locator('[data-studio-filter="all"]').isVisible()) await page.locator('#games-tab').click();
  await page.locator('[data-studio-filter="all"]').click(); await page.locator(`[data-studio="${game}"]`).click();
  await expect(page.locator(`[data-studio-slot="${game}"]`)).toBeVisible({ timeout: 60000 }); await expect(page.locator('[data-slot-refresh]')).toBeEnabled();
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }
async function wallet(request: APIRequestContext, headers: Record<string, string>) { const response = await request.get('/api/demo-wallet', { headers }); expect(response.ok()).toBe(true); return response.json(); }

async function coreVisible(page: Page) {
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('#mini-dialog')!, rect = dialog.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, dialog: { top: rect.top, bottom: rect.bottom, scrollTop: dialog.scrollTop }, core: ['[data-slot-reels]', '[data-slot-stake]', '[data-slot-spin]'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }) };
  });
  expect(geometry.dialog.scrollTop).toBe(0);
  for (const rect of geometry.core) { expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(geometry.width); expect(rect.top).toBeGreaterThanOrEqual(Math.max(0, geometry.dialog.top)); expect(rect.bottom).toBeLessThanOrEqual(Math.min(geometry.height, geometry.dialog.bottom)); }
  return geometry;
}

async function checkStage(page: Page, value: Reply, game: StudioPresentationGameId) {
  const s = value.session, view = s.view.studio as StudioSlotView;
  expect(s.gameId).toBe(game); expect(validStudioSettlement(game, s.state, s.stakeUnits, s.spentUnits, s.returnedUnits, view)).toBe(true);
  await expect(page.locator('[data-slot-spin]')).toBeEnabled({ timeout: 20000 }); await expect(page.locator('.studio-error')).toBeEmpty();
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id', s.id); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step', String(view.step));
  await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units', view.totalPayoutUnits); await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-target-units', view.totalPayoutUnits);
  await expect(page.locator('.studio-stage-payout strong')).toHaveText((Number(view.totalPayoutUnits) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' монет');
  await expect(page.locator('[data-studio-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cells = await page.locator('[data-slot-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.slotCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.position - b.position));
  expect(cells.map(cell => cell.symbol)).toEqual(view.grid); expect(cells.length).toBe(game === 'studio-cosmic-escape' ? 15 : 20);
  const pins = await page.locator('[data-slot-pin]').evaluateAll(elements => elements.map(element => Number((element as HTMLElement).dataset.slotPin)).sort((a, b) => a - b));
  expect(pins).toEqual(view.held);
  expect(value.wallet.entries.filter(entry => entry.operationId === s.id && entry.kind === 'bet')).toHaveLength(1);
  if (s.state === 'active') { expect(s.returnedUnits).toBe('0'); await expect(page.locator('[data-move="studio-spin"]')).toBeEnabled(); }
  else { expect(s.returnedUnits).toBe(view.totalPayoutUnits); expect(value.wallet.entries.filter(entry => entry.kind === 'win')).toHaveLength(1); }
  return view;
}

async function completeFreeStages(page: Page, value: Reply, game: StudioPresentationGameId) {
  const stages: Reply[] = [value]; let creditedOperation = value.session.id; await checkStage(page, value, game);
  if (game === 'studio-cosmic-escape') await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'available');
  while (value.session.state === 'active') {
    const previous = value.session.view.studio as StudioSlotView, sessionId = value.session.id;
    const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await page.locator('[data-move="studio-spin"]').click(); const settledResponse = await response; creditedOperation = settledResponse.request().postDataJSON().id; value = await settledResponse.json() as Reply;
    expect(value.session.id).toBe(sessionId); expect(value.session.spentUnits).toBe(stages[0].session.spentUnits); expect((value.session.view.studio as StudioSlotView).step).toBe(previous.step + 1);
    await checkStage(page, value, game);
    if (game === 'studio-cosmic-escape') await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'available');
    stages.push(value); expect(stages.length).toBeLessThanOrEqual(3);
  }
  expect(value.wallet.entries.filter(entry => entry.kind === 'bet')).toHaveLength(1);
  expect(value.wallet.entries.filter(entry => entry.kind === 'win' && entry.operationId === creditedOperation)).toHaveLength(1);
  return { value, stages };
}

test('published Cosmic moves five reels, applies validated expansion and completes one paid round', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page);
  const operations: { id: string; action: string; sessionId?: string }[] = [], metadata: StudioSlotPresentation[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue(); operations.push(route.request().postDataJSON()); const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 400)); await route.fulfill({ response });
  });
  await page.route('**/api/demo-wallet/expansion/presentation?*', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); metadata.push(await response.json()); await route.fulfill({ response }); });
  await open(page, 'studio-cosmic-escape'); const initialGeometry = await coreVisible(page);
  const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-slot-spin]').click(); await expect(page.locator('[data-slot-spin]')).toBeDisabled(); await expect(page.locator('[data-slot-stake]')).toBeDisabled();
  const first = await page.locator('[data-slot-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform)); await page.waitForTimeout(180);
  expect(await page.locator('[data-slot-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform))).not.toEqual(first);
  await page.locator('[data-slot-spin]').evaluate((button: HTMLButtonElement) => button.click());
  const completed = await completeFreeStages(page, await (await response).json(), 'studio-cosmic-escape'), value = completed.value;
  expect(operations.filter(operation => operation.action === 'start')).toHaveLength(1); expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length);
  expect(metadata).toHaveLength(completed.stages.length);
  metadata.forEach((payload, index) => { const s = completed.stages[index].session; expect(validStudioSlotPresentation(payload, 'studio-cosmic-escape', s.id, s.view.phase, s.view.studio as StudioSlotView)).toBe(true); });
  const finalGeometry = await coreVisible(page), played = await page.evaluate(() => (window as any).royalDemo.getAudio().slot.byGame['studio-cosmic-escape']);
  expect(played.played.click).toBe(completed.stages.length); expect(played.played['reel-stop']).toBe(5 * completed.stages.length);
  const beforeGetCount = metadata.length; await page.locator('[data-slot-refresh]').click(); await expect(page.locator('[data-slot-refresh]')).toBeEnabled(); await close(page); await open(page, 'studio-cosmic-escape');
  await checkStage(page, value, 'studio-cosmic-escape'); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static'); expect(metadata).toHaveLength(beforeGetCount);
  expect(await page.evaluate(() => (window as any).royalDemo.getAudio().slot.byGame['studio-cosmic-escape'].played)).toEqual(played.played);
  const stored = await wallet(page.request, headers); expect(stored.balance).toBe(value.wallet.balance); expect(stored.balance).toBe((100000 - Number(value.session.spentUnits) + Number(value.session.returnedUnits)) / 100);
  await page.setViewportSize({ width: 1280, height: 720 }); const laptopGeometry = await coreVisible(page);
  proof({ scenario: 'cosmic-desktop', accountId: account.id, sessionId: value.session.id, operations, metadata, stages: completed.stages.map(stage => stage.session), balance: value.wallet.balance, initialGeometry, finalGeometry, laptopGeometry, played });
  await page.screenshot({ path: directory + '/public-cosmic-desktop.png' }); await close(page); expect(errors).toEqual([]);
});

test('published Velvet restores a committed lost reply and confirms its original operation once on a phone', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 390, height: 844 }); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { account, headers } = await login(page); let committed: Reply | undefined; const ids: string[] = [], operations: { id: string; action: string; sessionId?: string }[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue(); const operation = route.request().postDataJSON(); ids.push(operation.id); operations.push(operation);
    if (committed) return route.continue(); const response = await route.fetch(); expect(response.ok()).toBe(true); committed = await response.json(); await route.abort('failed');
  });
  await open(page, 'studio-velvet-reign'); const initialGeometry = await coreVisible(page); await page.locator('[data-slot-spin]').click(); await expect(page.locator('[data-slot-retry]')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('[data-slot-spin]')).toBeDisabled(); await close(page); await page.reload(); await joined(page); await open(page, 'studio-velvet-reign'); await expect(page.locator('[data-slot-retry]')).toBeEnabled();
  const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST'); await page.locator('[data-slot-retry]').click(); const replay = await (await response).json() as Reply;
  expect(replay.replayed).toBe(true); expect(replay.session).toEqual(committed!.session); expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(1);
  await checkStage(page, replay, 'studio-velvet-reign'); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  const completed = await completeFreeStages(page, replay, 'studio-velvet-reign'), value = completed.value, finalGeometry = await coreVisible(page);
  expect(operations.filter(operation => operation.action === 'start')).toHaveLength(2); expect(new Set(operations.filter(operation => operation.action === 'start').map(operation => operation.id)).size).toBe(1);
  const stored = await wallet(page.request, headers); expect(stored.balance).toBe(value.wallet.balance); expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'bet')).toHaveLength(1);
  const presentationResponse = await page.request.get(endpoint + '/presentation', { headers, params: { sessionId: value.session.id, phase: String(value.session.view.phase), step: String((value.session.view.studio as StudioSlotView).step) } });
  expect(presentationResponse.status()).toBe(200); const finalPresentation = await presentationResponse.json() as StudioSlotPresentation;
  expect(validStudioSlotPresentation(finalPresentation, 'studio-velvet-reign', value.session.id, value.session.view.phase, value.session.view.studio as StudioSlotView)).toBe(true);
  const afterPresentation = await wallet(page.request, headers); expect(afterPresentation.balance).toBe(stored.balance); expect(afterPresentation.entries).toEqual(stored.entries);
  const played = await page.evaluate(() => (window as any).royalDemo.getAudio().slot.byGame['studio-velvet-reign']); await close(page); await open(page, 'studio-velvet-reign'); await checkStage(page, value, 'studio-velvet-reign');
  expect(await page.evaluate(() => (window as any).royalDemo.getAudio().slot.byGame['studio-velvet-reign'].played)).toEqual(played?.played ?? {}); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  expect(await page.locator('#mini-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  proof({ scenario: 'velvet-mobile-lost-reply', accountId: account.id, sessionId: value.session.id, operations, stages: completed.stages.map(stage => stage.session), balance: value.wallet.balance, finalPresentation, presentationReadOnly: { before: stored, after: afterPresentation }, initialGeometry, finalGeometry, played });
  await page.screenshot({ path: directory + '/public-velvet-mobile.png' }); await close(page); expect(errors).toEqual([]);
});
