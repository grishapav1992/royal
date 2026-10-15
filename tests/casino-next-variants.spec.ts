import { test, expect, type Page, type Response } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { VARIANT_BASES, VARIANT_NAMES, type VariantGameId, type VariantView } from '../src/shared/casinoVariants';
import type { ExpansionSession } from '../src/shared/casinoExpansion';
import type { DemoWallet } from '../src/shared/demoWallet';

type Reply = { session: ExpansionSession; wallet: DemoWallet; sessions: ExpansionSession[]; replayed: boolean };
const games = ['variant-keno','variant-color','variant-keys','variant-fruits','variant-duel','variant-war'] as const;
type NextGame = typeof games[number];
const password = 'Next-variant-test-wallet-password!';
const endpoint = '/api/demo-wallet/expansion';
const board = '.casino-next-variants';
let host: Room, room = '';

function record(account: { id: string; email: string }) {
  if (!process.env.ROYAL_NEXT_VARIANTS_URL) return;
  const path = process.env.ROYAL_NEXT_VARIANTS_RECORDS || 'artifacts/casino-next-variants/public-test-accounts.jsonl';
  mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(account) + '\n');
}

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `nextvariant-host-${crypto.randomUUID()}@example.test`, password } });
  expect(auth.ok()).toBe(true); record((await auth.json()).account);
  await request.post('/api/auth/character', { data: { skin: 0 } });
  const cookie = auth.headers()['set-cookie'].split(';')[0];
  host = await new Client(process.env.ROYAL_NEXT_VARIANTS_URL || 'http://127.0.0.1:2600', {
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
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/?room=' + room);
  await page.getByLabel('Почта', { exact: true }).fill(`nextvariant-${crypto.randomUUID()}@example.test`);
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
async function open(page: Page, id: NextGame) {
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().playing)).toBe(false);
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(41);
  await expect(page.locator('[data-variant]:not([hidden])')).toHaveCount(18);
  await page.locator(`[data-variant="${id}"]`).click();
  await expect(page.locator(`${board}.${id}`)).toBeVisible({ timeout: 25000 });
  await expect(page.locator(`[data-casino-mode="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`${board} h3`)).toHaveText(VARIANT_NAMES[id as VariantGameId]);
}
const post = (page: Page) => page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST', { timeout: 15000 });
async function reply(response: Response): Promise<Reply> {
  expect(response.ok()).toBe(true); const value = await response.json() as Reply;
  for (const session of value.sessions) {
    expect(session).not.toHaveProperty('engine'); expect(session).not.toHaveProperty('settings');
    expect(session).not.toHaveProperty('createdAt'); expect(session.view).not.toHaveProperty('deck');
  }
  expect(value.session.view.variant).not.toHaveProperty('deck'); expect(value.session.view.variant).not.toHaveProperty('traps');
  return value;
}
const payout = (stake: bigint, multiplier: number) => Number(stake * BigInt(Math.round(multiplier * 10000)) / 10000n);
const choose = (n: number, k: number) => { let value = 1; for (let i = 1; i <= k; i++) value = value * (n + 1 - i) / i; return value; };
const rank = (card: string, highAce = false) => { const face = card.slice(0, -1); return face === 'A' ? highAce ? 14 : 1 : ({ J:11,Q:12,K:13 } as Record<string,number>)[face] ?? Number(face); };
function verifyOutcome(view: VariantView, stake: string, returned: string) {
  const units = BigInt(stake);
  switch (view.kind) {
    case 'keno': {
      expect(view.numbers).toEqual([2,5,8,11,17]); expect(view.target).toBe(3);
      expect(view.drawn).toHaveLength(5); expect(new Set(view.drawn).size).toBe(5);
      expect(view.drawn.every(n => Number.isInteger(n) && n >= 1 && n <= 20)).toBe(true);
      const hits = view.drawn.filter(n => view.numbers.includes(n)).length;
      expect(view.hits).toBe(hits); expect(view.won).toBe(hits >= 3);
      const successes = [3,4,5].reduce((sum, matches) => sum + choose(5,matches) * choose(15,5-matches), 0);
      const multiplier = Math.floor(98 * choose(20,5) * 100 / successes) / 10000;
      expect(view.multiplier).toBe(multiplier); expect(Number(returned)).toBe(view.won ? payout(units,multiplier) : 0); break;
    }
    case 'color': {
      expect(view.history).toHaveLength(1); const turn = view.history[0];
      expect(turn.prediction).toBe('black'); const color = /[♥♦]$/.test(turn.card) ? 'red' : 'black';
      expect(turn.color).toBe(color); expect(turn.won).toBe(color === 'black');
      expect(view.redRemaining).toBe(color === 'red' ? 25 : 26); expect(view.blackRemaining).toBe(color === 'black' ? 25 : 26);
      expect(view.steps).toBe(turn.won ? 1 : 0); expect(view.maxSteps).toBe(6);
      expect(view.multiplier).toBe(turn.won ? 1.96 : 0); expect(Number(returned)).toBe(turn.won ? 1960 : 0); break;
    }
    case 'keys': {
      expect(view.picks).toEqual([[0,2]]); expect(view.rows).toHaveLength(6);
      expect(view.rows.every(row => row.length === 4)).toBe(true); expect(view.maxSteps).toBe(6);
      const won = view.rows[0][0] !== 'trap' && view.rows[0][2] !== 'trap';
      expect(view.steps).toBe(won ? 1 : 0); expect(view.multiplier).toBe(won ? 1.96 : 0);
      expect(Number(returned)).toBe(won ? 1960 : 0); break;
    }
    case 'fruits': {
      expect(view.lines).toBe(2); expect(view.rows).toHaveLength(2);
      let total = 0;
      view.rows.forEach((row, index) => {
        expect(row.symbols).toHaveLength(3); expect(row.symbols.every(symbol => symbol >= 0 && symbol <= 3)).toBe(true);
        const stakeUnits = units / 2n + (BigInt(index) < units % 2n ? 1n : 0n);
        const multiplier = row.symbols.every(symbol => symbol === row.symbols[0]) ? [5,10,30,140][row.symbols[0]] : 0;
        expect(row.stakeUnits).toBe(String(stakeUnits)); expect(row.multiplier).toBe(multiplier);
        expect(Number(row.returnedUnits)).toBe(payout(stakeUnits,multiplier)); total += Number(row.returnedUnits);
      });
      expect(Number(returned)).toBe(total); break;
    }
    case 'duel': {
      expect(view.band).toBe('far'); const gap = Math.abs(rank(view.dragon) - rank(view.tiger));
      expect(view.gap).toBe(gap); expect(view.won).toBe(gap >= 8 && gap <= 12);
      let count = 0; for (let a = 1; a <= 13; a++) for (let b = 1; b <= 13; b++) if (Math.abs(a-b) >= 8) count += 16;
      const multiplier = Math.floor(98 * (52 * 51) * 100 / count) / 10000;
      expect(view.multiplier).toBe(multiplier); expect(Number(returned)).toBe(view.won ? payout(units,multiplier) : 0); break;
    }
    case 'war': {
      expect(view.mode).toBe('attack'); expect(view.fronts).toHaveLength(2); let total = 0;
      view.fronts.forEach((front, index) => {
        const result = rank(front.player,true) > rank(front.dealer,true) ? 'win' : rank(front.player,true) === rank(front.dealer,true) ? 'tie' : 'loss';
        expect(front.result).toBe(result); const stakeUnits = units / 2n + (index === 0 ? units % 2n : 0n);
        const multiplier = result === 'win' ? 2.0825 : 0;
        expect(front.stakeUnits).toBe(String(stakeUnits)); expect(front.multiplier).toBe(multiplier);
        expect(Number(front.returnedUnits)).toBe(payout(stakeUnits,multiplier)); total += Number(front.returnedUnits);
      });
      expect(Number(returned)).toBe(total); break;
    }
    default: throw new Error('Unexpected next variant: ' + view.kind);
  }
}
function verifyPrivateStart(value: Reply, game: 'variant-color' | 'variant-keys') {
  expect(value.session.state).toBe('active'); const view = value.session.view.variant!;
  expect(value.session.view.player).toEqual([]); expect(value.session.view.dealer).toEqual([]); expect(value.session.view.community).toEqual([]);
  if (game === 'variant-color') {
    expect(view.kind).toBe('color'); if (view.kind !== 'color') throw new Error('Wrong view');
    expect(Object.keys(view).sort()).toEqual(['kind','history','redRemaining','blackRemaining','steps','maxSteps','multiplier','cashoutUnits'].sort());
    expect(view.history).toEqual([]); expect(view.redRemaining).toBe(26); expect(view.blackRemaining).toBe(26);
  } else {
    expect(view.kind).toBe('keys'); if (view.kind !== 'keys') throw new Error('Wrong view');
    expect(Object.keys(view).sort()).toEqual(['kind','rows','picks','steps','maxSteps','multiplier','cashoutUnits'].sort());
    expect(view.picks).toEqual([]); expect(view.rows).toEqual(Array.from({ length:6 }, () => Array(4).fill('hidden')));
  }
  expect(view.steps).toBe(0); expect(view.multiplier).toBe(0); expect(view.cashoutUnits).toBe('0');
}
async function finishActive(page: Page, value: Reply, game: NextGame) {
  if (value.session.state !== 'active') return value;
  let waiting: Promise<Response>;
  if (game === 'variant-color') { waiting = post(page); await page.locator(`${board} [data-move="black"]`).click(); }
  else {
    await page.locator(`${board} [data-key-cell="0"]:enabled`).click();
    await expect(page.locator(`${board} [data-move="unlock"]`)).toBeDisabled();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await expect(page.locator(`${board} [data-key-cell="2"]:enabled`)).toBeFocused();
    await page.keyboard.press('Space'); await expect(page.locator(`${board} [data-move="unlock"]`)).toBeEnabled();
    waiting = post(page);
    await page.locator(`${board} [data-move="unlock"]`).click();
  }
  value = await reply(await waiting);
  if (value.session.state === 'active') {
    const view = value.session.view.variant!;
    if (view.kind === 'keys') expect(view.rows.slice(1).every(row => row.every(cell => cell === 'hidden'))).toBe(true);
    waiting = post(page); await page.locator(`${board} [data-move="cashout"]`).click(); value = await reply(await waiting);
  }
  expect(value.session.state).toBe('settled'); return value;
}
async function classicAndBack(page: Page, game: NextGame, headers: Record<string,string>, balance: number) {
  const base = VARIANT_BASES[game as VariantGameId];
  await page.locator(`[data-casino-mode="${base}"]`).click(); await expect(page.locator(board)).toHaveCount(0);
  await expect(page.locator(`[data-casino-mode="${base}"]`)).toHaveAttribute('aria-pressed','true');
  expect(Math.round((await (await page.request.get('/api/demo-wallet',{headers})).json()).balance * 100)).toBe(balance);
  await page.locator(`[data-casino-mode="${game}"]`).click(); await expect(page.locator(`${board}.${game}`)).toBeVisible();
}

test('six further variants have distinct boards, precise demo payouts and preserve their classic modes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  expect((await page.request.get(endpoint)).status()).toBe(401); const headers = await login(page);
  const forged = { id:crypto.randomUUID(),gameId:'variant-keno',action:'start',stakeUnits:'1000',settings:{variant:{numbers:[1,2,3,4,5],target:3}},payoutUnits:'999999' };
  expect((await page.request.post(endpoint,{headers,data:forged})).status()).toBe(400);
  expect((await page.request.post(endpoint,{headers,data:{...forged,payoutUnits:undefined,settings:{variant:{numbers:[1,2,3,4,5],target:4}}}})).status()).toBe(400);
  expect((await page.request.get(endpoint,{headers:{'X-Royal-Account-Id':crypto.randomUUID()}})).status()).toBe(401);
  expect((await page.request.post(endpoint,{headers:{...headers,Origin:'https://evil.example'},data:forged})).status()).toBe(403);
  let balanceUnits = 100000; const markup = new Set<string>();
  const settings: Partial<Record<NextGame,string>> = {'variant-keno':'3','variant-fruits':'2','variant-duel':'far','variant-war':'attack'};
  for (const game of games) {
    await open(page,game); await classicAndBack(page,game,headers,balanceUnits);
    await expect(page.locator(`${board} [data-start]`)).toBeEnabled();
    if (game === 'variant-keno') {
      for (const value of await page.locator(`${board} [data-number][aria-pressed="true"]`).evaluateAll(elements => elements.map(el => (el as HTMLElement).dataset.number!))) await page.locator(`${board} [data-number="${value}"]`).click();
      await expect(page.locator(`${board} [data-start]`)).toBeDisabled();
      for (const value of [2,5,8,11]) await page.locator(`${board} [data-number="${value}"]`).click();
      await expect(page.locator(`${board} [data-start]`)).toBeDisabled(); await page.locator(`${board} [data-number="17"]`).click();
      await expect(page.locator(`${board} [data-start]`)).toBeEnabled();
    }
    if (settings[game]) await page.locator(`${board} [data-setting="${settings[game]}"]`).click();
    markup.add(await page.locator(`${board} .next-stage`).innerHTML());
    const waiting = post(page); await page.locator(`${board} [data-start]`).click(); const response = await waiting; let value = await reply(response);
    expect(response.request().postDataJSON()).toMatchObject({gameId:game,stakeUnits:'1000',action:'start'});
    if (game === 'variant-color' || game === 'variant-keys') {
      verifyPrivateStart(value,game); await classicAndBack(page,game,headers,balanceUnits - 1000);
      const restored = (await (await page.request.get(endpoint,{headers})).json()).sessions.find((s: ExpansionSession) => s.id === value.session.id);
      expect(restored.view.variant).toEqual(value.session.view.variant); value = await finishActive(page,value,game);
    }
    expect(value.session.state).toBe('settled'); verifyOutcome(value.session.view.variant!,value.session.stakeUnits,value.session.returnedUnits);
    balanceUnits = balanceUnits - Number(value.session.spentUnits) + Number(value.session.returnedUnits);
    expect(Math.round(value.wallet.balance * 100)).toBe(balanceUnits);
    expect(value.wallet.entries.filter(entry => entry.operationId === value.session.id && entry.kind === 'bet')).toHaveLength(1);
    await expect(page.locator('[data-variant-balance]')).toHaveText((balanceUnits/100).toLocaleString('ru-RU'));
    await page.screenshot({path:`artifacts/casino-next-variants/${game}-desktop.png`});
    await page.setViewportSize({width:390,height:844});
    expect(await page.locator(board).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator('#mini-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({path:`artifacts/casino-next-variants/${game}-mobile.png`});
    await page.locator('#mini-dialog .mini-top [data-close]').click(); await page.setViewportSize({width:1440,height:1000});
  }
  expect(markup.size).toBe(6); const state = await (await page.request.get(endpoint,{headers})).json();
  expect(state.sessions.filter((s:ExpansionSession) => games.includes(s.gameId as NextGame)).every((s:ExpansionSession) => s.state === 'settled')).toBe(true);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await expect(page.locator('#wallet-balance')).toHaveText((balanceUnits/100).toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(6); expect(errors).toEqual([]);
});

test('lost color start restores the same committed deck, debits once and settles through the UI', async ({ page }) => {
  const headers = await login(page); await open(page,'variant-color');
  let discarded = false, actionId = '', paid: Reply | undefined;
  await page.route('**/api/demo-wallet/expansion',async route => {
    if (route.request().method() !== 'POST') return route.continue(); const operation = route.request().postDataJSON();
    if (!discarded) {
      discarded = true; actionId = operation.id; expect(operation).toMatchObject({gameId:'variant-color',action:'start',stakeUnits:'1000',settings:{variant:{}}});
      const response = await route.fetch(); expect(response.ok()).toBe(true); paid = await response.json(); await route.abort('failed');
    } else { expect(operation.id).toBe(actionId); await route.continue(); }
  });
  await page.locator(`${board} [data-start]`).click(); await expect(page.locator(`${board} [data-retry]`)).toBeEnabled();
  expect(paid!.wallet.balance).toBe(990); verifyPrivateStart(paid!,'variant-color');
  await page.reload(); await joined(page); await open(page,'variant-color');
  await expect(page.locator(`${board} [data-retry]`)).toBeEnabled();
  const waiting = post(page); await page.locator(`${board} [data-retry]`).click(); let value = await reply(await waiting);
  expect(value.replayed).toBe(true); expect(value.session.id).toBe(actionId); expect(value.wallet.balance).toBe(990);
  expect(value.session.view.variant).toEqual(paid!.session.view.variant);
  expect(value.wallet.entries.filter(entry => entry.operationId === actionId && entry.kind === 'bet')).toHaveLength(1);
  await page.unroute('**/api/demo-wallet/expansion'); await classicAndBack(page,'variant-color',headers,99000);
  await page.locator('#mini-dialog .mini-top [data-close]').click(); await open(page,'variant-color');
  await expect(page.locator(`${board} [data-move="black"]`)).toBeEnabled(); value = await finishActive(page,value,'variant-color');
  verifyOutcome(value.session.view.variant!,value.session.stakeUnits,value.session.returnedUnits);
  expect(value.wallet.balance).toBe(990 + Number(value.session.returnedUnits)/100);
  expect(value.wallet.entries.filter(entry => entry.source === 'variant-color' && entry.kind === 'bet')).toHaveLength(1);
  expect(value.wallet.entries.filter(entry => entry.source === 'variant-color' && entry.kind === 'win')).toHaveLength(1);
  await page.locator('#mini-dialog .mini-top [data-close]').click(); await open(page,'variant-color');
  await expect(page.locator(`${board} [data-start]`)).toBeEnabled();
});

test('lost two-key move replays the selected pair after reload without a second charge or redraw', async ({ page }) => {
  const headers = await login(page); await open(page,'variant-keys'); let waiting = post(page);
  await page.locator(`${board} [data-start]`).click(); const initial = await reply(await waiting); verifyPrivateStart(initial,'variant-keys');
  await page.locator(`${board} [data-key-cell="0"]:enabled`).click(); await page.locator(`${board} [data-key-cell="2"]:enabled`).click();
  let discarded = false, moveId = '', committed: Reply | undefined;
  await page.route('**/api/demo-wallet/expansion',async route => {
    if (route.request().method() !== 'POST') return route.continue(); const operation = route.request().postDataJSON();
    if (!discarded) {
      discarded = true; moveId = operation.id; expect(operation).toMatchObject({gameId:'variant-keys',action:'move',move:'unlock',sessionId:initial.session.id,picks:[0,2]});
      const response = await route.fetch(); expect(response.ok()).toBe(true); committed = await response.json(); await route.abort('failed');
    } else { expect(operation.id).toBe(moveId); expect(operation.picks).toEqual([0,2]); await route.continue(); }
  });
  await page.locator(`${board} [data-move="unlock"]`).click(); await expect(page.locator(`${board} [data-retry]`)).toBeEnabled();
  expect(committed!.wallet.balance).toBe(990); expect(committed!.session.id).toBe(initial.session.id);
  await page.reload(); await joined(page); await open(page,'variant-keys');
  await expect(page.locator(`${board} [data-retry]`)).toBeEnabled(); waiting = post(page);
  await page.locator(`${board} [data-retry]`).click(); let value = await reply(await waiting);
  expect(value.replayed).toBe(true); expect(value.session.view.variant).toEqual(committed!.session.view.variant);
  expect(value.wallet.balance).toBe(990); expect(value.wallet.entries.filter(entry => entry.source === 'variant-keys' && entry.kind === 'bet')).toHaveLength(1);
  await page.unroute('**/api/demo-wallet/expansion');
  const before = Math.round(value.wallet.balance * 100); await classicAndBack(page,'variant-keys',headers,before);
  await page.locator('#mini-dialog .mini-top [data-close]').click(); await open(page,'variant-keys');
  if (value.session.state === 'active') { waiting = post(page); await page.locator(`${board} [data-move="cashout"]`).click(); value = await reply(await waiting); }
  expect(value.session.state).toBe('settled'); verifyOutcome(value.session.view.variant!,value.session.stakeUnits,value.session.returnedUnits);
  expect(value.wallet.balance).toBe(990 + Number(value.session.returnedUnits)/100);
  expect(value.wallet.entries.filter(entry => entry.source === 'variant-keys' && entry.kind === 'win')).toHaveLength(1);
  await expect(page.locator('[data-variant-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU'));
});
