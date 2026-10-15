import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { validStudioSettlement, validStudioSlotPresentation, type StudioSlotView, type StudioSlotPresentation, type StudioCascadePresentationGameId } from '../src/shared/studioGames';
import type { ExpansionSession } from '../src/shared/casinoExpansion';

const directory = 'artifacts/studio-wave3-20261012';
const endpoint = '/api/demo-wallet/expansion';
const password = 'Royal-wave3-isolated-browser-password!';
type Reply = { session: ExpansionSession; wallet: { balance: number; entries: { operationId: string; kind: string }[] }; replayed: boolean };
let host: Room, room = '';
function record(account: { id: string; email: string }) { if (process.env.ROYAL_WAVE3_RECORDS) appendFileSync(process.env.ROYAL_WAVE3_RECORDS, JSON.stringify(account) + '\n'); }
function proof(value: unknown) { mkdirSync(directory, { recursive: true }); appendFileSync(directory + '/public-rounds.jsonl', JSON.stringify(value) + '\n'); }

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `royalwave3-host-${crypto.randomUUID()}@example.test`, password } });
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
  await page.getByLabel('Почта', { exact: true }).fill(`royalwave3-${crypto.randomUUID()}@example.test`); await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#character-step')).toBeVisible(); await page.getByRole('button', { name: 'Войти в зал', exact: true }).click(); await joined(page);
  const account = (await (await page.request.get('/api/auth/me')).json()).account; record(account);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click(); await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/); await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  return { account, headers: { 'X-Royal-Account-Id': account.id as string } };
}
async function open(page: Page, game: StudioCascadePresentationGameId) {
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

async function checkStage(page: Page, value: Reply, game: StudioCascadePresentationGameId) {
  const s = value.session, view = s.view.studio as StudioSlotView;
  expect(s.gameId).toBe(game); expect(validStudioSettlement(game, s.state, s.stakeUnits, s.spentUnits, s.returnedUnits, view)).toBe(true);
  await expect(page.locator('[data-slot-spin]')).toBeEnabled({ timeout: 20000 }); await expect(page.locator('.studio-error')).toBeEmpty();
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id', s.id); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step', String(view.step));
  await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units', view.totalPayoutUnits); await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-target-units', view.totalPayoutUnits);
  await expect(page.locator('.studio-stage-payout strong')).toHaveText((Number(view.totalPayoutUnits) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' монет');
  await expect(page.locator('[data-studio-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cells = await page.locator('[data-slot-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.slotCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.position - b.position));
  expect(cells.map(cell => cell.symbol)).toEqual(view.grid); expect(cells.length).toBe(30);
  expect(value.wallet.entries.filter(entry => entry.operationId === s.id && entry.kind === 'bet')).toHaveLength(1);
  if (s.state === 'active') { expect(s.returnedUnits).toBe('0'); await expect(page.locator('[data-move="studio-spin"]')).toBeEnabled(); }
  else { expect(s.returnedUnits).toBe(view.totalPayoutUnits); expect(value.wallet.entries.filter(entry => entry.kind === 'win')).toHaveLength(1); }
  await expect(page.locator('[data-cascade-group-button]')).toHaveCount(view.wins.length);
  await expect(page.locator('[data-slot-lines]')).toHaveCount(0);
  return view;
}

function checkMetadata(metadata: StudioSlotPresentation, session: ExpansionSession, game: StudioCascadePresentationGameId) {
  const view = session.view.studio as StudioSlotView, frame = view.history[view.step], previous = view.step ? view.history[view.step - 1] : undefined;
  expect(validStudioSlotPresentation(metadata, game, session.id, session.view.phase, view)).toBe(true);
  const trace = metadata.cascade!; expect(trace).toBeDefined(); expect(metadata.afterGrid).toEqual(frame.grid); expect(metadata.beforeGrid).toEqual(previous?.grid ?? frame.grid);
  expect(trace.groups).toEqual(frame.wins.map((win, winIndex) => ({ winIndex, symbol: win.symbol, count: win.count, positions: win.positions })));
  expect(trace.fromStep).toBe(previous ? view.step - 1 : null);
  const removed = previous ? [...new Set(previous.wins.flatMap(win => win.positions))].sort((a, b) => a - b) : [];
  expect(trace.removedPositions).toEqual(removed); const drops: { from: number; to: number; symbol: number }[] = [], refills: { position: number; symbol: number }[] = [];
  if (previous) for (let column = 0; column < 6; column++) {
    const survivors = Array.from({ length: 5 }, (_, row) => row * 6 + column).filter(position => !removed.includes(position)), fill = 5 - survivors.length;
    survivors.forEach((from, index) => drops.push({ from, to: (fill + index) * 6 + column, symbol: previous.grid[from] }));
    for (let row = 0; row < fill; row++) { const position = row * 6 + column; refills.push({ position, symbol: frame.grid[position] }); }
  }
  expect(trace.drops).toEqual(drops); expect(trace.refills).toEqual(refills);
  if (previous) { expect([...drops.map(drop => drop.to), ...refills.map(refill => refill.position)].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, index) => index)); expect(refills).toHaveLength(removed.length); }
  const orbs = game === 'studio-starfall-oracle' ? frame.grid.flatMap((symbol, position) => symbol === 5 ? [position] : []) : [];
  const beforeOrbs = game === 'studio-starfall-oracle' ? metadata.beforeGrid.filter(symbol => symbol === 5).length : 0;
  expect(trace.orbPositions).toEqual(orbs); expect(trace.orbFactor).toBe(1 + orbs.length); expect(trace.orbFactorBefore).toBe(1 + beforeOrbs);
  expect(trace.addedOrbPositions).toEqual(game === 'studio-starfall-oracle' ? refills.filter(refill => refill.symbol === 5).map(refill => refill.position) : []);
  if (game === 'studio-starfall-oracle') { expect(trace.orbFactor).toBeGreaterThanOrEqual(trace.orbFactorBefore); expect(removed.every(position => metadata.beforeGrid[position] !== 5)).toBe(true); }
  expect(Object.keys(metadata)).not.toContain('seeds'); expect(Object.keys(metadata)).not.toContain('stops');
}

async function routeMetadata(page: Page) {
  const metadata: StudioSlotPresentation[] = [];
  await page.route('**/api/demo-wallet/expansion/presentation?*', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); metadata.push(await response.json()); await route.fulfill({ response }); });
  return metadata;
}
async function confirmLive(page: Page, value: Reply, game: StudioCascadePresentationGameId, metadata: StudioSlotPresentation[]) {
  await checkStage(page, value, game); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'available');
  const view = value.session.view.studio as StudioSlotView, payload = metadata.findLast(item => item.sessionId === value.session.id && item.step === view.step);
  expect(payload).toBeDefined(); checkMetadata(payload!, value.session, game);
  await expect(page.locator('[data-cascade-factor]')).toHaveText('×' + payload!.cascade!.orbFactor);
  expect(await page.locator('[data-cascade-overlay]').evaluate(element => element.childElementCount)).toBe(0);
}
async function advance(page: Page, value: Reply, game: StudioCascadePresentationGameId, metadata: StudioSlotPresentation[]) {
  const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-move="studio-spin"]').click(); const replyResponse = await response, next = await replyResponse.json() as Reply;
  expect(next.session.id).toBe(value.session.id); expect(next.session.spentUnits).toBe(value.session.spentUnits); expect((next.session.view.studio as StudioSlotView).step).toBe((value.session.view.studio as StudioSlotView).step + 1);
  await confirmLive(page, next, game, metadata); return { value: next, operationId: replyResponse.request().postDataJSON().id as string };
}
async function storedProof(page: Page, headers: Record<string, string>, value: Reply, creditedOperation: string) {
  const stored = await wallet(page.request, headers); expect(stored.balance).toBe(value.wallet.balance);
  expect(stored.balance).toBe((100000 - Number(value.session.spentUnits) + Number(value.session.returnedUnits)) / 100);
  expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'bet')).toHaveLength(1);
  expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'win')).toHaveLength(1);
  expect(stored.entries.find((entry: { kind: string }) => entry.kind === 'win').operationId).toBe(creditedOperation); return stored;
}

test('published Caramel completes one paid round with exact free cascades and silent history', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1440, height: 900 }); const game = 'studio-caramel-carnival';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page), metadata = await routeMetadata(page);
  const operations: { id: string; action: string; sessionId?: string }[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => { if (route.request().method() !== 'POST') return route.continue(); operations.push(route.request().postDataJSON()); const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 350)); await route.fulfill({ response }); });
  await open(page, game); const initialGeometry = await coreVisible(page), response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-slot-spin]').click(); await expect(page.locator('[data-slot-spin]')).toBeDisabled(); await expect(page.locator('[data-slot-stake]')).toBeDisabled();
  const firstMotion = await page.locator('[data-cascade-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform)); await page.waitForTimeout(160);
  expect(await page.locator('[data-cascade-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform))).not.toEqual(firstMotion);
  await page.locator('[data-slot-spin]').evaluate((button: HTMLButtonElement) => button.click());
  let value = await (await response).json() as Reply, creditedOperation = value.session.id; const stages: ExpansionSession[] = [value.session];
  await confirmLive(page, value, game, metadata); expect(value.session.state).toBe('active');
  while (value.session.state === 'active') { const next = await advance(page, value, game, metadata); value = next.value; creditedOperation = next.operationId; stages.push(value.session); expect(stages.length).toBeLessThanOrEqual(3); }
  expect(operations.filter(operation => operation.action === 'start')).toHaveLength(1); expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length);
  const stored = await storedProof(page, headers, value, creditedOperation), finalGeometry = await coreVisible(page), played = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game);
  expect(played.click).toBe(1); expect(played['reel-stop']).toBe(6); expect(played.collapse).toBe(stages.length - 1); expect(played.drop).toBe(stages.length - 1); expect(played.refill).toBe(stages.length - 1);
  const beforeMetadataCount = metadata.length; await page.locator('[data-slot-refresh]').click(); await expect(page.locator('[data-slot-refresh]')).toBeEnabled(); await close(page); await open(page, game);
  await checkStage(page, value, game); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  for (let index = 0; index < stages.length; index++) {
    await page.locator(`[data-slot-frame="${index}"]`).evaluate((button: HTMLButtonElement) => button.click()); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-frame-index', String(index));
    const shown = await page.locator('[data-slot-cell]').evaluateAll(elements => elements.map(element => ({ index: Number((element as HTMLElement).dataset.slotCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.index - b.index));
    expect(shown.map(cell => cell.symbol)).toEqual((value.session.view.studio as StudioSlotView).history[index].grid);
  }
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(played); expect(metadata).toHaveLength(beforeMetadataCount);
  await close(page); await open(page, game); await checkStage(page, value, game); await page.setViewportSize({ width: 1280, height: 720 }); const laptopGeometry = await coreVisible(page);
  proof({ scenario: 'caramel-desktop', accountId: account.id, sessionId: value.session.id, operations, metadata, stages, stored, initialGeometry, finalGeometry, laptopGeometry, played });
  await page.screenshot({ path: directory + '/public-caramel-desktop.png' }); await close(page); expect(errors).toEqual([]);
});

test('published Starfall restores a lost committed free cascade without a second stake', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 390, height: 844 }); const game = 'studio-starfall-oracle';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page), metadata = await routeMetadata(page);
  let committed: Reply | undefined, lostId = ''; const operations: { id: string; action: string; sessionId?: string }[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue(); const operation = route.request().postDataJSON(); operations.push(operation);
    if (operation.action !== 'move' || committed) return route.continue(); const response = await route.fetch(); expect(response.ok()).toBe(true); lostId = operation.id; committed = await response.json(); await route.abort('failed');
  });
  await open(page, game); const initialGeometry = await coreVisible(page), startResponse = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-slot-spin]').click(); const base = await (await startResponse).json() as Reply; await confirmLive(page, base, game, metadata); expect(base.session.state).toBe('active');
  await page.locator('[data-move="studio-spin"]').click(); await expect(page.locator('[data-slot-retry]')).toBeEnabled({ timeout: 20000 }); expect(committed).toBeDefined(); expect((committed!.session.view.studio as StudioSlotView).step).toBe(1);
  await close(page); await page.reload(); await joined(page); await open(page, game); await expect(page.locator('[data-slot-retry]')).toBeEnabled();
  const beforeReplayAudio = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game), retryResponse = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-slot-retry]').click(); const replay = await (await retryResponse).json() as Reply; expect(replay.replayed).toBe(true); expect(replay.session).toEqual(committed!.session);
  expect(operations.filter(operation => operation.id === lostId)).toHaveLength(2); await checkStage(page, replay, game); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(beforeReplayAudio);
  const beforeRead = await wallet(page.request, headers), readResponse = await page.request.get(endpoint + '/presentation', { headers, params: { sessionId: replay.session.id, phase: String(replay.session.view.phase), step: '1' } });
  expect(readResponse.status()).toBe(200); const restoredMetadata = await readResponse.json() as StudioSlotPresentation; checkMetadata(restoredMetadata, replay.session, game);
  const afterRead = await wallet(page.request, headers); expect(afterRead.balance).toBe(beforeRead.balance); expect(afterRead.entries).toEqual(beforeRead.entries);
  let value = replay, creditedOperation = lostId; const stages: ExpansionSession[] = [base.session, replay.session];
  while (value.session.state === 'active') { const next = await advance(page, value, game, metadata); value = next.value; creditedOperation = next.operationId; stages.push(value.session); expect(stages.length).toBeLessThanOrEqual(3); }
  expect(operations.filter(operation => operation.action === 'start')).toHaveLength(1); expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length - 1);
  const stored = await storedProof(page, headers, value, creditedOperation), finalGeometry = await coreVisible(page), factor = 1 + (value.session.view.studio as StudioSlotView).grid.filter(symbol => symbol === 5).length;
  await expect(page.locator('[data-cascade-factor]')).toHaveText('×' + factor);
  if (Number(value.session.returnedUnits) < Number(value.session.stakeUnits)) await expect(page.locator('[data-slot-bigwin]')).toBeHidden();
  const played = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game); await close(page); await open(page, game); await checkStage(page, value, game);
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(played); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  proof({ scenario: 'starfall-mobile-lost-cascade', accountId: account.id, sessionId: value.session.id, lostId, operations, metadata, restoredMetadata, presentationReadOnly: { before: beforeRead, after: afterRead }, stages, stored, finalFactor: factor, initialGeometry, finalGeometry, played });
  await page.screenshot({ path: directory + '/public-starfall-mobile.png' }); await close(page); expect(errors).toEqual([]);
});

