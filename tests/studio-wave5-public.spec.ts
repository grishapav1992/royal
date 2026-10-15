import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { validStudioSettlement, validStudioSlotPresentation, type StudioSlotView, type StudioSlotPresentation, type StudioElementPresentationGameId } from '../src/shared/studioGames';
import type { ExpansionSession } from '../src/shared/casinoExpansion';

const directory = 'artifacts/studio-wave5-20261012';
const endpoint = '/api/demo-wallet/expansion';
const password = 'Royal-wave5-isolated-browser-password!';
type Reply = { session: ExpansionSession; wallet: { balance: number; entries: { operationId: string; kind: string }[] }; replayed: boolean };
let host: Room, room = '';
function record(account: { id: string; email: string }) { if (process.env.ROYAL_WAVE5_RECORDS) appendFileSync(process.env.ROYAL_WAVE5_RECORDS, JSON.stringify(account) + '\n'); }
function proof(value: unknown) { mkdirSync(directory, { recursive: true }); appendFileSync(directory + '/public-rounds.jsonl', JSON.stringify(value) + '\n'); }

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/login', { data: { email: `royalwave5-host-${crypto.randomUUID()}@example.test`, password } });
  expect(response.ok()).toBe(true); record((await response.json()).account);
  await request.post('/api/auth/character', { data: { skin: 0 } });
  host = await new Client(process.env.TEST_BASE_URL!, {
    headers: { Cookie: response.headers()['set-cookie'].split(';')[0] },
    fetchFn: async (url, options) => { const response = await request.fetch(String(url), { method: options?.method, headers: Object.fromEntries(new Headers(options?.headers)), data: options?.body as string }); return new globalThis.Response(await response.body(), { status: response.status(), headers: response.headers() }); },
  }).create('lobby'); room = host.roomId;
  for (const type of ['chat', 'activities', 'piano-note', 'notice']) host.onMessage(type, () => {});
});
test.afterAll(async () => { await host?.leave(); });

async function joined(page: Page) { await page.bringToFront(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 }); if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click(); }
async function login(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/?room=' + room);
  await page.getByLabel('Почта', { exact: true }).fill(`royalwave5-${crypto.randomUUID()}@example.test`); await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#character-step')).toBeVisible(); await page.getByRole('button', { name: 'Войти в зал', exact: true }).click(); await joined(page);
  const account = (await (await page.request.get('/api/auth/me')).json()).account; record(account);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click(); await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click(); await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/); await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  return { account, headers: { 'X-Royal-Account-Id': account.id as string } };
}
async function open(page: Page, game: StudioElementPresentationGameId) {
  if (!await page.locator('[data-studio-filter="all"]').isVisible()) await page.locator('#games-tab').click();
  await page.locator('[data-studio-filter="all"]').click(); await page.locator(`[data-studio="${game}"]`).click();
  await expect(page.locator(`[data-element-slot="${game}"]`)).toBeVisible({ timeout: 60000 }); await expect(page.locator('[data-element-refresh]')).toBeEnabled();
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }
async function wallet(request: APIRequestContext, headers: Record<string, string>) { const response = await request.get('/api/demo-wallet', { headers }); expect(response.ok()).toBe(true); return response.json(); }
async function core(page: Page) {
  const geometry = await page.evaluate(() => { const dialog = document.querySelector<HTMLElement>('#mini-dialog')!, rect = dialog.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, scrollTop: dialog.scrollTop, top: rect.top, bottom: rect.bottom, controls: ['[data-element-reels]', '[data-element-stake]', '[data-element-spin]'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }) }; });
  expect(geometry.scrollTop).toBe(0);
  for (const r of geometry.controls) { expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(geometry.width); expect(r.top).toBeGreaterThanOrEqual(Math.max(0, geometry.top)); expect(r.bottom).toBeLessThanOrEqual(Math.min(geometry.height, geometry.bottom)); }
  return geometry;
}
async function stage(page: Page, reply: Reply, game: StudioElementPresentationGameId) {
  const session = reply.session, view = session.view.studio as StudioSlotView;
  expect(session.gameId).toBe(game); expect(validStudioSettlement(game, session.state, session.stakeUnits, session.spentUnits, session.returnedUnits, view)).toBe(true);
  await expect(page.locator('[data-element-spin]')).toBeEnabled({ timeout: 30000 }); await expect(page.locator('.studio-error')).toBeEmpty();
  await expect(page.locator('[data-element-slot]')).toHaveAttribute('data-session-id', session.id); await expect(page.locator('[data-element-slot]')).toHaveAttribute('data-step', String(view.step));
  await expect(page.locator('[data-element-payout]')).toHaveAttribute('data-units', view.totalPayoutUnits); await expect(page.locator('[data-element-payout]')).toHaveAttribute('data-target-units', view.totalPayoutUnits);
  await expect(page.locator('[data-element-balance]')).toHaveText(reply.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cells = await page.locator('[data-element-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.elementCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.position - b.position)); expect(cells.map(cell => cell.symbol)).toEqual(view.grid); expect(cells.length).toBe(15);
  await expect(page.locator('[data-element-line-button]')).toHaveCount(view.wins.length);
  expect(reply.wallet.entries.filter(entry => entry.operationId === session.id && entry.kind === 'bet')).toHaveLength(1);
  if (session.state === 'active') { expect(session.returnedUnits).toBe('0'); await expect(page.locator('[data-element-bigwin]')).toBeHidden(); }
  else expect(session.returnedUnits).toBe(view.totalPayoutUnits);
}
function metadataFacts(value: StudioSlotPresentation, session: ExpansionSession, game: StudioElementPresentationGameId) {
  const view = session.view.studio as StudioSlotView; expect(validStudioSlotPresentation(value, game, session.id, session.view.phase, view)).toBe(true);
  expect(value.afterGrid).toEqual(view.grid); expect(value.heldBefore).toEqual([]); expect(value.heldAfter).toEqual([]); expect(value.cluster).toBeUndefined(); expect(value.cascade).toBeUndefined();
  expect(Object.keys(value)).not.toContain('seeds'); expect(Object.keys(value)).not.toContain('stops');
  for (const event of value.events) {
    expect(event.kind).not.toBe('sticky-wild'); if (event.kind === 'sticky-wild') continue;
    expect(event.positions).toEqual([event.column, event.column + 5, event.column + 10]); expect(event.positions.every(p => value.afterGrid[p] === 3)).toBe(true);
    if (game === 'studio-beacon-bay') { expect(event.kind).toBe('beam-wild'); expect(event.sourcePositions).toEqual([event.column + 5]); expect(value.beforeGrid[event.column + 5]).toBe(3); }
    else if (game === 'studio-stormforge-duel') { expect(event.kind).toBe('expand-wild'); expect(event.sourcePositions).toEqual(event.positions.filter(p => value.beforeGrid[p] === 3)); }
    else { expect(event.kind).toBe('chosen-wild'); expect(event.sourcePositions).toEqual(event.positions.filter(p => value.beforeGrid[p] === value.chosen!.symbol)); }
  }
  if (game === 'studio-saffron-cipher') {
    const symbol = value.beforeGrid[0] < 3 ? value.beforeGrid[0] : 0, columns = [0, 1, 2, 3, 4].filter(column => [value.beforeGrid[column], value.beforeGrid[column + 5], value.beforeGrid[column + 10]].includes(symbol));
    expect(value.chosen).toEqual({ symbol, sourcePosition: 0, sourceSymbol: value.beforeGrid[0], matchingColumns: columns, active: columns.length >= 3 }); expect(value.events.length).toBe(columns.length >= 3 ? columns.length : 0);
  } else expect(value.chosen).toBeUndefined();
  expect(value.multipliers).toEqual(game === 'studio-stormforge-duel' ? view.wins.flatMap((win, winIndex) => { const positions = win.positions.filter(position => view.grid[position] === 3); return positions.length ? [{ winIndex, line: win.line, factor: 1 + Math.min(3, positions.length), positions }] : []; }) : []);
}

for (const game of ['studio-stormforge-duel', 'studio-saffron-cipher', 'studio-beacon-bay'] as const) test(`published ${game} settles one test-wallet round and restores static history`, async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize(game === 'studio-saffron-cipher' ? { width: 390, height: 844 } : game === 'studio-beacon-bay' ? { width: 375, height: 667 } : { width: 1280, height: 720 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page);
  const operations: { id: string; action: string; sessionId?: string }[] = [], reads: { payload: StudioSlotPresentation; before: unknown; after: unknown; status: number }[] = [];
  let lost: Reply | undefined, lostId = '';
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue(); const op = route.request().postDataJSON(); operations.push(op); const response = await route.fetch(); expect(response.ok()).toBe(true);
    if (game === 'studio-saffron-cipher' && !lost) { lost = await response.json(); lostId = op.id; await new Promise(resolve => setTimeout(resolve, 500)); await route.abort('failed'); return; }
    await new Promise(resolve => setTimeout(resolve, 350)); await route.fulfill({ response });
  });
  await page.route('**/api/demo-wallet/expansion/presentation?*', async route => {
    expect(route.request().headers()['x-royal-account-id']).toBe(account.id); const before = await wallet(page.request, headers), response = await route.fetch(); expect(response.status()).toBe(200); const payload = await response.json(), after = await wallet(page.request, headers); expect(after).toEqual(before); reads.push({ payload, before, after, status: response.status() }); await route.fulfill({ response });
  });
  await open(page, game); const initialGeometry = await core(page);
  const startResponse = game === 'studio-saffron-cipher' ? undefined : page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-element-spin]').click(); await expect(page.locator('[data-element-spin]')).toBeDisabled(); const before = await page.locator('[data-element-track]').evaluateAll(items => items.map(item => (item as HTMLElement).style.transform)); await page.waitForTimeout(160); expect(await page.locator('[data-element-track]').evaluateAll(items => items.map(item => (item as HTMLElement).style.transform))).not.toEqual(before);
  await page.locator('[data-element-spin]').evaluate((button: HTMLButtonElement) => button.click());
  let value: Reply, replayAudio: unknown;
  if (game === 'studio-saffron-cipher') {
    await expect(page.locator('[data-element-retry]')).toBeEnabled({ timeout: 20000 }); expect(lost).toBeDefined(); await close(page); await page.reload(); await joined(page); await open(page, game);
    replayAudio = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game); const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await page.locator('[data-element-retry]').click(); value = await (await response).json(); expect(value.replayed).toBe(true); expect(value.session).toEqual(lost!.session); await expect(page.locator('[data-element-slot]')).toHaveAttribute('data-presentation', 'static');
    expect(operations.filter(op => op.id === lostId)).toHaveLength(2);
  } else value = await (await startResponse!).json();
  const stages = [value.session], replies = [value]; let creditedOperation = value.session.id;
  await stage(page, value, game);
  if (lostId) expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(replayAudio);
  else { await expect(page.locator('[data-element-slot]')).toHaveAttribute('data-presentation', 'available'); expect(reads.some(read => read.payload.sessionId === value.session.id && read.payload.step === 0)).toBe(true); }
  while (value.session.state === 'active') {
    const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST'); await page.locator('[data-element-spin]').click(); const next = await response, reply = await next.json() as Reply; creditedOperation = next.request().postDataJSON().id;
    expect(reply.session.id).toBe(value.session.id); expect(reply.session.spentUnits).toBe(value.session.spentUnits); expect((reply.session.view.studio as StudioSlotView).step).toBe((value.session.view.studio as StudioSlotView).step + 1); value = reply; stages.push(value.session); replies.push(value); await stage(page, value, game); expect(stages.length).toBeLessThanOrEqual(3); await expect(page.locator('[data-element-slot]')).toHaveAttribute('data-presentation', 'available'); expect(reads.some(read => read.payload.sessionId === value.session.id && read.payload.step === (value.session.view.studio as StudioSlotView).step)).toBe(true);
  }
  expect(stages.length).toBe((stages[0].view.studio as StudioSlotView).remaining ? 3 : 1);
  expect(reads).toHaveLength(stages.length - (lostId ? 1 : 0));
  for (const read of reads) { const session = stages.find(session => (session.view.studio as StudioSlotView).step === read.payload.step)!; metadataFacts(read.payload, session, game); }
  const readBefore = await wallet(page.request, headers), response = await page.request.get(endpoint + '/presentation', { headers, params: { sessionId: value.session.id, phase: String(value.session.view.phase), step: String((value.session.view.studio as StudioSlotView).step) } }); expect(response.status()).toBe(200); const currentMetadata = await response.json(); metadataFacts(currentMetadata, value.session, game); const stored = await wallet(page.request, headers); expect(stored).toEqual(readBefore);
  expect(operations.filter(op => op.action === 'start' && op.id !== lostId).length + (lostId ? 1 : 0)).toBe(1);
  expect(new Set(operations.map(op => op.id)).size).toBe(operations.length - (lostId ? 1 : 0));
  expect(stored.balance).toBe((100000 - Number(value.session.spentUnits) + Number(value.session.returnedUnits)) / 100); expect(stored.entries.filter((e: { kind: string }) => e.kind === 'bet')).toHaveLength(1); expect(stored.entries.filter((e: { kind: string }) => e.kind === 'win')).toHaveLength(1); expect(stored.entries.find((e: { kind: string }) => e.kind === 'win').operationId).toBe(creditedOperation);
  const played = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game); await page.locator('[data-element-refresh]').click(); await expect(page.locator('[data-element-refresh]')).toBeEnabled(); await close(page); await open(page, game); await stage(page, value, game); await expect(page.locator('[data-element-slot]')).toHaveAttribute('data-presentation', 'static');
  for (let index = 0; stages.length > 1 && index < stages.length; index++) { await page.locator(`[data-element-frame="${index}"]`).evaluate((button: HTMLButtonElement) => button.click()); const cells = await page.locator('[data-element-cell]').evaluateAll(elements => elements.map(element => ({ p: Number((element as HTMLElement).dataset.elementCell), s: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.p - b.p)); expect(cells.map(cell => cell.s)).toEqual((value.session.view.studio as StudioSlotView).history[index].grid); }
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(played); await close(page); await open(page, game); await stage(page, value, game); const finalGeometry = await core(page);
  proof({ game, accountId: account.id, sessionId: value.session.id, stages, replies, operations, lostId, lost, reads, currentMetadata, stored, initialGeometry, finalGeometry, played });
  await page.screenshot({ path: directory + `/public-${game}.png` }); await close(page); expect(errors).toEqual([]);
});
