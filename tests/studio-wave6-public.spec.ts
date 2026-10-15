import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { validStudioSettlement, validStudioSlotPresentation, studioScore, studioPayFrame, type StudioSlotView, type StudioSlotPresentation, type StudioJourneyPresentationGameId } from '../artifacts/studio-wave6-20261012/qa-stage/src/shared/studioGames';
import type { ExpansionSession } from '../artifacts/studio-wave6-20261012/qa-stage/src/shared/casinoExpansion';

const directory = 'artifacts/studio-wave6-20261012';
const endpoint = '/api/demo-wallet/expansion';
const password = 'Royal-wave6-isolated-browser-password!';
type Reply = { session: ExpansionSession; wallet: { balance: number; entries: { operationId: string; kind: string }[] }; replayed: boolean };
let host: Room, room = '';
function record(account: { id: string; email: string }) { expect(account.email).toMatch(/^royalwave6-(?:host-)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@example\.test$/i); if (process.env.ROYAL_WAVE6_RECORDS) appendFileSync(process.env.ROYAL_WAVE6_RECORDS, JSON.stringify(account) + '\n'); }
function proof(value: unknown) { mkdirSync(directory, { recursive: true }); appendFileSync(directory + '/public-rounds.jsonl', JSON.stringify(value) + '\n'); }

test.beforeAll(async ({ request }) => {
  expect(process.env.ROYAL_WAVE6_RECORDS, 'Own-account append-only record path must be configured before account creation').toBeTruthy();
  appendFileSync(process.env.ROYAL_WAVE6_RECORDS!, '');
  const response = await request.post('/api/auth/login', { data: { email: `royalwave6-host-${crypto.randomUUID()}@example.test`, password } });
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
  await page.getByLabel('Почта', { exact: true }).fill(`royalwave6-${crypto.randomUUID()}@example.test`); await page.getByLabel('Пароль', { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); const created = await loginResponse; expect(created.ok()).toBe(true); const createdAccount = (await created.json()).account; record(createdAccount);
  await expect(page.locator('#character-step')).toBeVisible(); await page.getByRole('button', { name: 'Войти в зал', exact: true }).click(); await joined(page);
  const account = (await (await page.request.get('/api/auth/me')).json()).account; expect(account.id).toBe(createdAccount.id); expect(account.email).toBe(createdAccount.email);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click(); await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click(); await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/); await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  return { account, headers: { 'X-Royal-Account-Id': account.id as string } };
}
async function open(page: Page, game: StudioJourneyPresentationGameId) {
  if (!await page.locator('[data-studio-filter="all"]').isVisible()) await page.locator('#games-tab').click();
  await page.locator('[data-studio-filter="all"]').click(); await page.locator(`[data-studio="${game}"]`).click();
  await expect(page.locator(`[data-journey-slot="${game}"]`)).toBeVisible({ timeout: 60000 }); await expect(page.locator('[data-journey-refresh]')).toBeEnabled();
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }
async function wallet(request: APIRequestContext, headers: Record<string, string>) { const response = await request.get('/api/demo-wallet', { headers }); expect(response.ok()).toBe(true); return response.json(); }
async function core(page: Page) {
  const geometry = await page.evaluate(() => { const dialog = document.querySelector<HTMLElement>('#mini-dialog')!, rect = dialog.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, scrollTop: dialog.scrollTop, top: rect.top, bottom: rect.bottom, controls: ['[data-journey-reels]', '[data-journey-stake]', '[data-journey-spin]'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }) }; });
  expect(geometry.scrollTop).toBe(0);
  for (const r of geometry.controls) { expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(geometry.width); expect(r.top).toBeGreaterThanOrEqual(Math.max(0, geometry.top)); expect(r.bottom).toBeLessThanOrEqual(Math.min(geometry.height, geometry.bottom)); }
  return geometry;
}
async function stage(page: Page, reply: Reply, game: StudioJourneyPresentationGameId) {
  const session = reply.session, view = session.view.studio as StudioSlotView;
  expect(session.gameId).toBe(game); expect(validStudioSettlement(game, session.state, session.stakeUnits, session.spentUnits, session.returnedUnits, view)).toBe(true);
  await expect(page.locator('[data-journey-spin]')).toBeEnabled({ timeout: 30000 }); await expect(page.locator('.studio-error')).toBeEmpty();
  await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-session-id', session.id); await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-step', String(view.step));
  await expect(page.locator('[data-journey-payout]')).toHaveAttribute('data-units', view.totalPayoutUnits); await expect(page.locator('[data-journey-payout]')).toHaveAttribute('data-target-units', view.totalPayoutUnits);
  await expect(page.locator('[data-journey-balance]')).toHaveText(reply.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cells = await page.locator('[data-journey-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.journeyCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.position - b.position)); expect(cells.map(cell => cell.symbol)).toEqual(view.grid); expect(cells.length).toBe(game === 'studio-jade-koi' ? 9 : 15);
  await expect(page.locator('[data-journey-line-button]')).toHaveCount(view.wins.length);
  const pins = await page.locator('[data-journey-pin].held').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.journeyPin), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a,b) => a.position-b.position)); expect(pins).toEqual(view.held.map(position => ({ position, symbol: view.grid[position] })));
  if (game === 'studio-jade-koi') expect(pins.every(pin => pin.symbol < 3)).toBe(true);
  expect(reply.wallet.entries.filter(entry => entry.operationId === session.id && entry.kind === 'bet')).toHaveLength(1);
  if (session.state === 'active') { expect(session.returnedUnits).toBe('0'); await expect(page.locator('[data-journey-bigwin]')).toBeHidden(); }
  else expect(session.returnedUnits).toBe(view.totalPayoutUnits);
}
function metadataFacts(value: StudioSlotPresentation, session: ExpansionSession, game: StudioJourneyPresentationGameId) {
  const view = session.view.studio as StudioSlotView, previous = view.step ? view.history[view.step - 1] : undefined;
  expect(validStudioSlotPresentation(value, game, session.id, session.view.phase, view)).toBe(true);
  expect(value.afterGrid).toEqual(view.grid); expect(value.heldBefore).toEqual(previous?.held ?? []); expect(value.heldAfter).toEqual(view.held);
  for (const key of ['seeds', 'stops', 'engine', 'cluster', 'cascade', 'chosen']) expect(Object.keys(value)).not.toContain(key);
  const expected = [...value.beforeGrid];
  if (game === 'studio-copperline-express') {
    for (const position of value.heldBefore) expected[position] = 3;
    const held = expected.flatMap((symbol, position) => symbol === 3 ? [position] : []), added = held.filter(position => !value.heldBefore.includes(position));
    expect(value.heldAfter).toEqual(held); expect(value.events).toEqual(added.length ? [{ kind: 'sticky-wild', positions: added }] : []);
    expect(value.multipliers).toEqual(view.wins.flatMap((win, winIndex) => { const positions = win.positions.filter(position => expected[position] === 3); return positions.length ? [{ winIndex, line: win.line, factor: 1 + Math.min(3, positions.length), positions }] : []; }));
    expect(value.walking).toBeUndefined(); expect(value.wish).toBeUndefined();
  } else if (game === 'studio-pulse-district') {
    const column = view.step ? 5 - view.step : null, positions = column === null ? [] : [column, column + 5, column + 10];
    expect(value.walking).toEqual({ forcedColumn: column, positions, previousForcedColumn: view.step > 1 ? 6 - view.step : null });
    for (const position of positions) expected[position] = 3;
    expect(value.heldBefore).toEqual([]); expect(value.heldAfter).toEqual([]); expect(value.events).toEqual([]); expect(value.multipliers).toEqual([]); expect(value.wish).toBeUndefined();
    if (view.step === 2) for (const position of [4, 9, 14]) expect(expected[position]).toBe(value.beforeGrid[position]);
  } else {
    for (const position of value.heldBefore) { expect(previous!.grid[position]).toBeLessThan(3); expected[position] = previous!.grid[position]; }
    const symbol = expected[0] < 3 ? expected[0] : null;
    const held = [...new Set([...value.heldBefore, ...expected.flatMap((entry, position) => entry === symbol ? [position] : [])])].sort((a, b) => a - b);
    const pinsBefore = value.heldBefore.map(position => ({ position, symbol: previous!.grid[position] })), pinsAfter = held.map(position => ({ position, symbol: expected[position] }));
    expect(value.heldAfter).toEqual(held); expect(value.wish).toEqual({ symbol, pinsBefore, pinsAfter, newPins: pinsAfter.filter(pin => !value.heldBefore.includes(pin.position)), completed: expected.every(entry => entry === symbol) });
    expect(value.wish!.completed, 'A full nine-cell wish is unreachable in the current rules').toBe(false);
    expect(pinsAfter.every(pin => pin.symbol < 3)).toBe(true); expect(value.events).toEqual([]); expect(value.multipliers).toEqual([]); expect(value.walking).toBeUndefined();
  }
  expect(value.afterGrid).toEqual(expected);
  const wins = studioScore(game, expected, view.step), rawFrame = { stage: view.stage, grid: expected, wins, raw: wins.reduce((sum, win) => sum + win.raw, 0), held: view.held };
  expect(studioPayFrame(game, rawFrame, session.stakeUnits)).toEqual(view.history[view.step]);
  expect(view.totalPayoutUnits).toBe(view.history.reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n).toString());
}

type Trace = { at: number; token: string; phase: string; reels: string[]; tracks: string[]; activeColumn: string; newPins: string; reveal: number[]; pins: { position: number; symbol: number }[]; multiplier: string; winIndex: string; activeLine: string };
type ReadProof = { source: 'live' | 'manual-final'; payload: StudioSlotPresentation; before: unknown; after: unknown; status: number; cacheControl: string; accountId: string; accountHeader: { name: string; value: string }; query: { sessionId: string; phase: string; step: string } };
async function observe(page: Page) {
  await page.addInitScript(() => {
    const state = window as any; state.__royalWave6Events = []; let prior = '';
    new MutationObserver(() => {
      const root = document.querySelector<HTMLElement>('[data-journey-slot]'); if (!root?.dataset.animationToken) return;
      const value = { token: root.dataset.animationToken, phase: root.dataset.phase, reels: [...root.querySelectorAll<HTMLElement>('[data-journey-reel]')].map(reel => reel.dataset.state), tracks: [...root.querySelectorAll<HTMLElement>('[data-journey-track]')].map(track => track.style.transform), activeColumn: root.dataset.activeColumn ?? '', newPins: root.dataset.newPins ?? '', reveal: [...root.querySelectorAll<HTMLElement>('[data-journey-cell].pin-reveal')].map(cell => Number(cell.dataset.journeyCell)).sort((a,b) => a-b), pins: [...root.querySelectorAll<HTMLElement>('[data-journey-pin].held')].map(pin => ({ position: Number(pin.dataset.journeyPin), symbol: Number(pin.dataset.symbol) })).sort((a,b) => a.position-b.position), multiplier: root.dataset.multiplierFactor ?? '', winIndex: root.dataset.multiplierWinIndex ?? '', activeLine: root.dataset.activeLine ?? '' };
      const serialized = JSON.stringify(value); if (serialized !== prior) { state.__royalWave6Events.push({ at: performance.now(), ...value }); prior = serialized; }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
}
async function audio(page: Page, game: StudioJourneyPresentationGameId): Promise<Record<string, number>> { return page.evaluate(game => ({ ...(window as any).royalDemo.getAudio().slot.byGame[game]?.played }), game); }
function assertLiveTrace(events: Trace[], token: string, metadata: StudioSlotPresentation, session: ExpansionSession, game: StudioJourneyPresentationGameId) {
  const trace = events.filter(event => event.token === token), columns = game === 'studio-jade-koi' ? 3 : 5;
  expect(token).not.toBe(''); expect(trace.length).toBeGreaterThan(2);
  const moving = trace.filter(event => event.reels.every(state => state === 'moving')); expect(moving.length).toBeGreaterThan(1); expect(new Set(moving.map(event => JSON.stringify(event.tracks))).size).toBeGreaterThan(1);
  const order: number[] = [], seen = new Set<number>();
  for (const event of trace) event.reels.forEach((state, column) => { if (state === 'stopped' && !seen.has(column)) { seen.add(column); order.push(column); } });
  expect(order).toEqual(Array.from({ length: columns }, (_, column) => column));
  const view = session.view.studio as StudioSlotView, previous = view.step ? view.history[view.step - 1] : undefined;
  expect(moving.every(event => JSON.stringify(event.pins) === JSON.stringify((previous?.held ?? []).map(position => ({ position, symbol: previous!.grid[position] }))))).toBe(true);
  const newPins = game === 'studio-jade-koi' ? metadata.wish!.newPins.map(pin => pin.position) : metadata.events.flatMap(event => event.kind === 'sticky-wild' ? event.positions : []);
  if (newPins.length) expect(trace.some(event => event.newPins === JSON.stringify(newPins) && JSON.stringify(event.reveal) === JSON.stringify(newPins))).toBe(true);
  else expect(trace.every(event => !event.newPins)).toBe(true);
  if (game === 'studio-pulse-district' && view.step) expect(trace.some(event => event.activeColumn === String(metadata.walking!.forcedColumn))).toBe(true);
  else expect(trace.every(event => !event.activeColumn)).toBe(true);
  for (const factor of metadata.multipliers) expect(trace.some(event => event.multiplier === String(factor.factor) && event.winIndex === String(factor.winIndex) && event.activeLine === String(factor.line))).toBe(true);
}
function assertAudio(played: Record<string, number>, sessions: ExpansionSession[], reads: ReadProof[], game: StudioJourneyPresentationGameId) {
  const expected: Record<string, number> = { click: sessions.some(session => (session.view.studio as StudioSlotView).step === 0) ? 1 : 0, 'reel-stop': sessions.length * (game === 'studio-jade-koi' ? 3 : 5), line: 0, 'free-stage': 0, sticky: 0, 'wish-pin': 0, walking: 0, multiplier: 0, loss: 0, return: 0, win: 0, bigwin: 0 };
  for (const session of sessions) {
    const view = session.view.studio as StudioSlotView, metadata = reads.find(read => read.source === 'live' && read.payload.step === view.step)!.payload;
    expected.line += view.wins.length; expected['free-stage'] += view.step ? 1 : 0; expected.sticky += game === 'studio-copperline-express' && metadata.events.length ? 1 : 0; expected['wish-pin'] += game === 'studio-jade-koi' && metadata.wish!.newPins.length ? 1 : 0; expected.walking += game === 'studio-pulse-district' && view.step ? 1 : 0; expected.multiplier += metadata.multipliers.length;
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits), outcome = session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss'; expected[outcome]++;
  }
  for (const [key, count] of Object.entries(expected)) expect(played[key] ?? 0, `Actual confirmed ${game} cue ${key}`).toBe(count);
  for (const key of ['expand', 'chosen', 'beam', 'collect', 'cell-values', 'collapse', 'drop', 'refill', 'orb', 'group']) expect(played[key] ?? 0).toBe(0);
}

for (const game of ['studio-copperline-express', 'studio-pulse-district', 'studio-jade-koi'] as const) test(`published ${game} settles one test-wallet round and restores static history`, async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize(game === 'studio-pulse-district' ? { width: 390, height: 844 } : game === 'studio-jade-koi' ? { width: 375, height: 667 } : { width: 1280, height: 720 }); await observe(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page);
  const operations: { id: string; action: string; sessionId?: string }[] = [], reads: ReadProof[] = [], tokens: Record<number, string> = {}, traces: Trace[] = [], audioByStage: { step: number; played: Record<string, number> }[] = [];
  let lost: Reply | undefined, lostId = '';
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue(); expect(route.request().headers()['x-royal-account-id']).toBe(account.id); const op = route.request().postDataJSON(); operations.push(op); const response = await route.fetch(); expect(response.ok()).toBe(true);
    if (game === 'studio-pulse-district' && !lost) { expect(op.action).toBe('start'); lost = await response.json(); lostId = op.id; await new Promise(resolve => setTimeout(resolve, 500)); await route.abort('failed'); return; }
    await new Promise(resolve => setTimeout(resolve, 350)); await route.fulfill({ response });
  });
  await page.route('**/api/demo-wallet/expansion/presentation?*', async route => {
    const accountHeader = route.request().headers()['x-royal-account-id']; expect(accountHeader).toBe(account.id); const url = new URL(route.request().url()); expect([...url.searchParams.keys()].sort()).toEqual(['phase', 'sessionId', 'step']);
    const query = { sessionId: url.searchParams.get('sessionId')!, phase: url.searchParams.get('phase')!, step: url.searchParams.get('step')! };
    const before = await wallet(page.request, headers), response = await route.fetch(); expect(response.status()).toBe(200); const payload = await response.json(), after = await wallet(page.request, headers); expect(after).toEqual(before);
    expect(payload.sessionId).toBe(query.sessionId); expect(String(payload.phase)).toBe(query.phase); expect(String(payload.step)).toBe(query.step);
    reads.push({ source: 'live', payload, before, after, status: response.status(), cacheControl: response.headers()['cache-control'] ?? '', accountId: account.id, accountHeader: { name: 'X-Royal-Account-Id', value: accountHeader }, query }); await route.fulfill({ response });
  });
  await open(page, game); const initialGeometry = await core(page);
  const startResponse = game === 'studio-pulse-district' ? undefined : page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-journey-spin]').click(); await expect(page.locator('[data-journey-spin]')).toBeDisabled(); tokens[0] = await page.locator('[data-journey-slot]').getAttribute('data-animation-token') ?? '';
  const beforeTracks = await page.locator('[data-journey-track]').evaluateAll(items => items.map(item => (item as HTMLElement).style.transform)); await page.waitForTimeout(160); expect(await page.locator('[data-journey-track]').evaluateAll(items => items.map(item => (item as HTMLElement).style.transform))).not.toEqual(beforeTracks);
  await page.locator('[data-journey-spin]').evaluate((button: HTMLButtonElement) => button.click());
  let value: Reply, replayAudio: Record<string, number> | undefined;
  if (game === 'studio-pulse-district') {
    await expect(page.locator('[data-journey-retry]')).toBeEnabled({ timeout: 20000 }); expect(lost).toBeDefined(); traces.push(...await page.evaluate(() => (window as any).__royalWave6Events)); await close(page); await page.reload(); await joined(page); await open(page, game);
    replayAudio = await audio(page, game); const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await page.locator('[data-journey-retry]').click(); value = await (await response).json(); expect(value.replayed).toBe(true); expect(value.session).toEqual(lost!.session); await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-presentation', 'static'); expect(operations.filter(op => op.id === lostId)).toHaveLength(2);
  } else value = await (await startResponse!).json();
  const stages = [value.session], replies = [value]; let creditedOperation = value.session.id;
  await stage(page, value, game); audioByStage.push({ step: 0, played: await audio(page, game) });
  if (lostId) expect(await audio(page, game)).toEqual(replayAudio);
  else { await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-presentation', 'available'); expect(reads.some(read => read.payload.sessionId === value.session.id && read.payload.step === 0)).toBe(true); }
  while (value.session.state === 'active') {
    expect(stages.length).toBeLessThan(3); const step = (value.session.view.studio as StudioSlotView).step + 1;
    const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST'); await page.locator('[data-journey-spin]').click(); tokens[step] = await page.locator('[data-journey-slot]').getAttribute('data-animation-token') ?? '';
    const next = await response, reply = await next.json() as Reply; creditedOperation = next.request().postDataJSON().id;
    expect(reply.session.id).toBe(value.session.id); expect(reply.session.spentUnits).toBe(value.session.spentUnits); expect((reply.session.view.studio as StudioSlotView).step).toBe(step); value = reply; stages.push(value.session); replies.push(value); await stage(page, value, game); audioByStage.push({ step, played: await audio(page, game) });
    await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-presentation', 'available'); expect(reads.some(read => read.payload.sessionId === value.session.id && read.payload.step === step)).toBe(true);
  }
  expect(stages.length).toBe((stages[0].view.studio as StudioSlotView).remaining ? 3 : 1); expect(reads).toHaveLength(stages.length - (lostId ? 1 : 0));
  traces.push(...await page.evaluate(() => (window as any).__royalWave6Events));
  for (const read of reads) { const session = stages.find(session => (session.view.studio as StudioSlotView).step === read.payload.step)!; metadataFacts(read.payload, session, game); assertLiveTrace(traces, tokens[read.payload.step], read.payload, session, game); }
  const query = { sessionId: value.session.id, phase: String(value.session.view.phase), step: String((value.session.view.studio as StudioSlotView).step) }, readBefore = await wallet(page.request, headers);
  const response = await page.request.get(endpoint + '/presentation', { headers, params: query }); expect(response.status()).toBe(200); const currentMetadata = await response.json(); metadataFacts(currentMetadata, value.session, game); const stored = await wallet(page.request, headers); expect(stored).toEqual(readBefore);
  reads.push({ source: 'manual-final', payload: currentMetadata, before: readBefore, after: stored, status: response.status(), cacheControl: response.headers()['cache-control'] ?? '', accountId: account.id, accountHeader: { name: 'X-Royal-Account-Id', value: account.id }, query });
  expect(operations.filter(op => op.action === 'start' && op.id !== lostId).length + (lostId ? 1 : 0)).toBe(1); expect(new Set(operations.map(op => op.id)).size).toBe(operations.length - (lostId ? 1 : 0)); for (const operation of operations) expect(operation.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(stored.balance).toBe((100000 - Number(value.session.spentUnits) + Number(value.session.returnedUnits)) / 100); expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'bet')).toHaveLength(1); expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'win')).toHaveLength(1); expect(stored.entries.find((entry: { kind: string }) => entry.kind === 'win').operationId).toBe(creditedOperation);
  const played = await audio(page, game); assertAudio(played, stages.filter(session => !lostId || (session.view.studio as StudioSlotView).step !== 0), reads, game);
  await page.locator('[data-journey-refresh]').click(); await expect(page.locator('[data-journey-refresh]')).toBeEnabled(); expect(await audio(page, game)).toEqual(played); await close(page); await open(page, game); await stage(page, value, game); await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-presentation', 'static'); expect(await audio(page, game)).toEqual(played); await close(page); await page.reload(); await joined(page); await open(page, game); await stage(page, value, game); await expect(page.locator('[data-journey-slot]')).toHaveAttribute('data-presentation', 'static');
  const restoredAudio = await audio(page, game); expect(restoredAudio).toEqual({});
  for (let index = 0; stages.length > 1 && index < stages.length; index++) {
    await page.locator(`[data-journey-frame="${index}"]`).evaluate((button: HTMLButtonElement) => button.click()); const frame = (value.session.view.studio as StudioSlotView).history[index];
    const cells = await page.locator('[data-journey-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.journeyCell), symbol: Number((element as HTMLElement).dataset.symbol), held: (element as HTMLElement).dataset.held === 'true' })).sort((a,b) => a.position-b.position));
    expect(cells.map(cell => cell.symbol)).toEqual(frame.grid); expect(cells.filter(cell => cell.held).map(cell => cell.position)).toEqual(frame.held);
    const pins = await page.locator('[data-journey-pin].held').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.journeyPin), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a,b) => a.position-b.position)); expect(pins).toEqual(frame.held.map(position => ({ position, symbol: frame.grid[position] })));
    if (game === 'studio-jade-koi') expect(pins.every(pin => pin.symbol < 3)).toBe(true);
  }
  expect(await audio(page, game)).toEqual(restoredAudio); await close(page); await open(page, game); await stage(page, value, game); expect(await audio(page, game)).toEqual(restoredAudio); const finalGeometry = await core(page);
  expect(reads.filter(read => read.source === 'live')).toHaveLength(stages.length - (lostId ? 1 : 0)); expect(operations.length).toBe(stages.length + (lostId ? 1 : 0));
  proof({ game, accountId: account.id, sessionId: value.session.id, stages, replies, operations, lostId, lost, reads, currentMetadata, stored, initialGeometry, finalGeometry, played, audioByStage, tokens, traces, restoredAudio });
  await page.screenshot({ path: directory + `/public-${game}.png` }); await close(page); expect(errors).toEqual([]);
});
