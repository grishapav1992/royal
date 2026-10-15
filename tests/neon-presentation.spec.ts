import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startStudioGame, type StudioResult } from '../server/games/studioGames';
import { STUDIO_DEFAULTS, type StudioSlotView } from '../src/shared/studioGames';
import type { ExpansionAction, ExpansionSession } from '../src/shared/casinoExpansion';
import type { DemoWallet } from '../src/shared/demoWallet';

const game = 'studio-neon-crown' as const;
const endpoint = '/api/demo-wallet/expansion';
const directory = process.env.ROYAL_NEON_ARTIFACT_DIR || 'artifacts/neon-slot-20261012/tests';
const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';
type FixtureKind = 'loss' | 'single' | 'multi' | 'big';
const stops: Record<FixtureKind, number[]> = { loss: [1, 0, 0], single: [0, 0, 0], multi: [0, 3, 0], big: [1, 3, 5] };
type Reply = { wallet: DemoWallet; sessions: ExpansionSession[]; session?: ExpansionSession; replayed?: boolean };
type State = { wallet: DemoWallet; sessions: ExpansionSession[]; ids: Map<string, Reply> };

function result(kind: FixtureKind, stake = '1000'): StudioResult {
  const values = [...stops[kind], 0, 5];
  const r = startStudioGame(game, STUDIO_DEFAULTS[game], stake, max => { const v = values.shift()!; expect(v).toBeLessThan(max); return v; });
  expect(r.ended).toBe(true);
  return r;
}
function session(op: Extract<ExpansionAction, { action: 'start' }>, kind: FixtureKind): ExpansionSession {
  const r = result(kind, op.stakeUnits);
  return { id: op.id, gameId: game, rulesVersion: 1, state: 'settled', stakeUnits: op.stakeUnits, spentUnits: op.stakeUnits, returnedUnits: String(r.credit), view: { studio: r.studio, player: [], dealer: [], community: [], actions: [], phase: 1, ended: true, message: r.message } };
}

const probe = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>#host{width:min(100%,660px);margin:auto}#qa-unlock{position:fixed;bottom:8px;right:8px;z-index:100000;padding:6px}</style></head><body><dialog id="mini-dialog" class="mini-dialog originals-mode wallet-game-mode" aria-labelledby="mini-title"><div class="mini-top"><div><span class="eyebrow">НОВЫЕ МИРЫ / ЭТАЖ 1</span><h2 id="mini-title">Неоновый трон</h2></div><button class="icon-button" aria-label="Вернуться в зал">×</button></div><div class="mini-stage"><div id="mini-game"><div id="host"></div></div></div><div class="mini-bottom"><span>Общий тестовый кошелёк клуба</span><button class="text-button">Вернуться в зал <kbd>Esc</kbd></button></div><button id="qa-unlock">Проверка звука</button></dialog><script type="module">
import {StudioGamesUI} from '/src/ui/StudioGamesUI.ts';
import {expansionClient as client} from '/src/wallet/ExpansionClient.ts';
import {demoWallet} from '/src/wallet/WalletClient.ts';
import {gameAudio} from '/src/game/GameAudio.ts';
import '/src/wallet.css';
import '/src/style.css';
import '/src/paper-theme.css';
import '/src/own-cabinets.css';
let ui,hidden=false;
Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
gameAudio.install();gameAudio.setGame('studio-neon-crown');
document.getElementById('qa-unlock').onclick=()=>gameAudio.unlock();
const p={client,demoWallet,audio:gameAudio,events:[],mount(){ui?.destroy();ui=new StudioGamesUI(document.getElementById('host'),'studio-neon-crown');},close(){ui?.destroy();ui=undefined;},visibility(value){hidden=value;document.dispatchEvent(new Event('visibilitychange'));},switchAccount(id){demoWallet.setAccount(id);},capture(){const root=document.querySelector('[data-neon-slot]');if(!root)return;const pay=root.querySelector('[data-neon-payout]');p.events.push({at:performance.now(),phase:root.dataset.phase,token:root.dataset.animationToken,session:root.dataset.sessionId,reels:[...root.querySelectorAll('[data-neon-reel]')].map(reel=>reel.dataset.state),payout:Number(pay?.dataset.units||0),target:Number(pay?.dataset.targetUnits||0)});},resetEvents(){p.events=[];p.capture();},state(){return{client:{account:client.accountId,busy:client.busy,pending:client.pending,error:client.error,sessions:client.sessions,wallet:client.wallet},audio:gameAudio.getState(),events:p.events};}};
new MutationObserver(()=>p.capture()).observe(document.getElementById('host'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase','data-state','data-units','data-target-units','data-session-id','data-animation-token']});
window.neonProbe=p;document.getElementById('mini-dialog').showModal();demoWallet.setAccount('${accountA}');
</script></body></html>`;

class MockCasino {
  states = new Map<string, State>([[accountA, { wallet: { balance: 1000, entries: [] }, sessions: [], ids: new Map() }], [accountB, { wallet: { balance: 2000, entries: [] }, sessions: [], ids: new Map() }]]);
  posts: { operation: ExpansionAction; account: string; at: number }[] = [];
  gets = 0;
  kind: FixtureKind = 'multi';
  handler?: (route: Route, reply: Reply, index: number) => Promise<void>;
  constructor(private page: Page) { }
  async install() {
    await this.page.route('**/api/demo-wallet', route => { const account = route.request().headers()['x-royal-account-id']; const s = this.states.get(account)!; return route.fulfill({ status: 200, json: s.wallet }); });
    await this.page.route('**/api/demo-wallet/expansion', async route => {
      const account = route.request().headers()['x-royal-account-id'];
      const s = this.states.get(account); expect(s, 'request must bind a known mock account').toBeDefined();
      if (route.request().method() === 'GET') { this.gets++; return route.fulfill({ status: 200, json: { wallet: s!.wallet, sessions: s!.sessions } }); }
      const op = route.request().postDataJSON() as ExpansionAction;
      expect(op.action).toBe('start'); expect(op.gameId).toBe(game); expect(op.id).toMatch(/^[a-f0-9-]{36}$/i);
      this.posts.push({ operation: op, account, at: Date.now() });
      let reply = s!.ids.get(op.id);
      if (reply) reply = { ...structuredClone(reply), replayed: true };
      else {
        const next = session(op as Extract<ExpansionAction, { action: 'start' }>, this.kind), paid = Number(next.returnedUnits) / 100, stake = Number(next.stakeUnits) / 100, before = s!.wallet.balance;
        const newest = s!.wallet.entries.reduce((n, entry) => Math.max(n, entry.id), 0);
        s!.wallet = { balance: before - stake + paid, entries: [...s!.wallet.entries, { id: newest + 1, kind: 'bet', amount: -stake, balance: before - stake, operationId: op.id, createdAt: newest + 1 }, { id: newest + 2, kind: 'win', amount: paid, balance: before - stake + paid, operationId: op.id, createdAt: newest + 2 }] };
        s!.sessions = [next]; reply = { wallet: structuredClone(s!.wallet), sessions: [structuredClone(next)], session: structuredClone(next), replayed: false }; s!.ids.set(op.id, reply);
      }
      if (this.handler) return this.handler(route, reply, this.posts.length);
      return route.fulfill({ status: 200, json: reply });
    });
  }
  hold() {
    let release!: () => void;
    const wait = new Promise<void>(yes => release = yes);
    this.handler = async (route, reply) => { await wait; await route.fulfill({ status: 200, json: reply }); };
    return release;
  }
}

async function ready(page: Page, options: { mobile?: boolean; reduced?: boolean; saved?: FixtureKind; muted?: boolean } = {}) {
  mkdirSync(directory, { recursive: true });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const casino = new MockCasino(page); await casino.install();
  if (options.saved) { const op = { id: '33333333-3333-4333-8333-333333333333', gameId: game, action: 'start' as const, stakeUnits: '1000', settings: STUDIO_DEFAULTS[game] }; casino.states.get(accountA)!.sessions = [session(op, options.saved)]; }
  if (options.mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(muted => { localStorage.setItem('royal-muted', muted ? '1' : '0'); localStorage.setItem('royal-volume', '0.12'); localStorage.setItem('royal-casino-ambience', '0'); }, !!options.muted);
  await page.route('**/neon-presentation-probe', route => route.fulfill({ status: 200, contentType: 'text/html', body: probe }));
  await page.goto('/neon-presentation-probe');
  await page.waitForFunction(() => { const p = (window as any).neonProbe; return p && !p.client.loading && p.demoWallet.wallet; });
  await page.evaluate(() => (window as any).neonProbe.mount());
  await expect(page.locator('[data-neon-slot]')).toBeVisible(); await expect(page.locator('[data-neon-spin]')).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#qa-unlock').click(); await expect.poll(() => page.evaluate(() => (window as any).neonProbe.audio.getState().context)).toBe('running');
  await page.locator('#qa-unlock').evaluate(button => button.remove());
  return { casino, errors };
}
async function audio(page: Page) { return page.evaluate(() => (window as any).neonProbe.audio.getState().slot); }
async function events(page: Page) { return page.evaluate(() => (window as any).neonProbe.events as { at: number; phase: string; token: string; session: string; reels: string[]; payout: number; target: number }[]); }
async function resetEvents(page: Page) { await page.evaluate(() => (window as any).neonProbe.resetEvents()); }
async function coreVisible(page: Page, label: string) {
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>('#mini-dialog')!, bounds = dialog.getBoundingClientRect();
    return { viewport: { width: innerWidth, height: innerHeight }, dialog: { top: bounds.top, bottom: bounds.bottom, scrollTop: dialog.scrollTop }, core: ['[data-neon-reels]', '[data-neon-stake]', '[data-neon-spin]'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }) };
  });
  writeFileSync(directory + '/' + label.replace(/[^a-z0-9]+/gi, '-') + '-geometry.json', JSON.stringify(geometry, null, 2));
  expect(geometry.dialog.scrollTop, label + ': opening and result must not require automatic scrolling').toBe(0);
  for (const rect of geometry.core) {
    expect(rect.left, label + ': ' + rect.selector).toBeGreaterThanOrEqual(0);
    expect(rect.right, label + ': ' + rect.selector).toBeLessThanOrEqual(geometry.viewport.width);
    expect(rect.top, label + ': ' + rect.selector).toBeGreaterThanOrEqual(Math.max(0, geometry.dialog.top));
    expect(rect.bottom, label + ': ' + rect.selector).toBeLessThanOrEqual(Math.min(geometry.viewport.height, geometry.dialog.bottom));
  }
  return geometry;
}
async function final(page: Page, casino: MockCasino, account = accountA) {
  const s = casino.states.get(account)!, saved = s.sessions[0], slot = saved.view.studio as StudioSlotView;
  await expect(page.locator('[data-neon-slot]')).toHaveAttribute('data-session-id', saved.id);
  await expect(page.locator('[data-neon-payout]')).toHaveAttribute('data-units', saved.returnedUnits);
  await expect(page.locator('[data-neon-payout]')).toHaveAttribute('data-target-units', saved.returnedUnits);
  await expect(page.locator('[data-neon-balance]')).toHaveText(s.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  await expect(page.locator('[data-neon-cell]')).toHaveCount(9);
  const symbols = await page.locator('[data-neon-cell]').evaluateAll(elements => elements.toSorted((a, b) => Number((a as HTMLElement).dataset.neonCell) - Number((b as HTMLElement).dataset.neonCell)).map(element => Number((element as HTMLElement).dataset.symbol)));
  expect(symbols).toEqual(slot.grid);
  await expect(page.locator('[data-neon-reel][data-state="stopped"]')).toHaveCount(3);
  await expect(page.locator('[data-neon-spin]')).toBeEnabled();
  return saved;
}

test('desktop shows moving reel tracks, sequential stops, server lines and integer payout count', async ({ page }) => {
  const { casino, errors } = await ready(page); casino.kind = 'multi'; const release = casino.hold(); await resetEvents(page);
  const initialGeometry = await coreVisible(page, 'desktop initial');
  await page.evaluate(() => { (window as any).neonOriginalRoot = document.querySelector('[data-neon-slot]'); });
  await page.locator('[data-neon-spin]').click(); await expect.poll(() => casino.posts.length).toBe(1);
  await expect(page.locator('[data-neon-slot]')).toHaveAttribute('data-phase', /accelerating|spinning/);
  const positions = await page.locator('[data-neon-track]').evaluateAll(async elements => { const first = elements.map(e => getComputedStyle(e).transform); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return { first, second: elements.map(e => getComputedStyle(e).transform) }; });
  expect(positions.first).not.toEqual(positions.second);
  await expect(page.locator('[data-neon-reel][data-state="stopped"]')).toHaveCount(0);
  await expect(page.locator('[data-neon-spin]')).toBeDisabled(); await expect(page.locator('[data-neon-stake]')).toBeDisabled();
  release(); const saved = await final(page, casino), stream = await events(page), stopping: { reel: number; at: number }[] = [];
  const seen = new Set<number>();
  for (const e of stream) for (let reel = 0; reel < 3; reel++) if (e.reels[reel] === 'stopped' && !seen.has(reel) && e.token) { seen.add(reel); stopping.push({ reel, at: e.at }); }
  expect(stopping.map(e => e.reel)).toEqual([0, 1, 2]); expect(stopping[1].at - stopping[0].at).toBeGreaterThan(100); expect(stopping[2].at - stopping[1].at).toBeGreaterThan(100);
  const revealed = stream.find(e => e.session === saved.id);
  expect(revealed).toBeDefined(); expect(revealed!.at).toBeGreaterThanOrEqual(stopping[2].at);
  expect(new Set(stream.filter(e => e.token).map(e => e.token)).size).toBe(1);
  expect(await page.evaluate(() => document.querySelector('[data-neon-slot]') === (window as any).neonOriginalRoot)).toBe(true);
  const target = Number(saved.returnedUnits), counts = stream.filter(e => e.phase === 'result').map(e => e.payout);
  expect(counts.some(v => v > 0 && v < target)).toBe(true); expect(counts.every(v => Number.isInteger(v) && v >= 0 && v <= target)).toBe(true);
  await expect(page.locator('[data-neon-lines] polyline')).toHaveCount(3);
  await expect(page.locator('[data-neon-line-button]')).toHaveCount(3);
  const cues = await audio(page); expect(cues.played.click).toBe(1); expect(cues.played['reel-stop']).toBe(3); expect(cues.played.line).toBe(3); expect(cues.played.bigwin).toBe(1);
  expect(casino.states.get(accountA)!.wallet.entries.filter(e => e.kind === 'bet')).toHaveLength(1);
  expect(casino.posts[0].operation).toMatchObject({ action: 'start', gameId: game, stakeUnits: '1000', settings: { studio: {} } });
  const finalGeometry = await coreVisible(page, 'desktop result');
  await page.screenshot({ path: directory + '/desktop-multiline.png', fullPage: true }); writeFileSync(directory + '/desktop-motion-proof.json', JSON.stringify({ initialGeometry, finalGeometry, stopping, counts, saved, cues }, null, 2)); expect(errors).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await coreVisible(page, 'desktop laptop result');
  await page.screenshot({ path: directory + '/desktop-laptop-multiline.png', fullPage: true });
});

test('an earlier RAF timestamp cannot show negative payout or move the counter backwards', async ({ page }) => {
  const { casino, errors } = await ready(page); casino.kind = 'multi'; await resetEvents(page);
  await page.evaluate(() => {
    const original = requestAnimationFrame.bind(window); (window as any).earlyPayoutFrame = false;
    window.requestAnimationFrame = callback => original(timestamp => {
      const root = document.querySelector<HTMLElement>('[data-neon-slot]');
      if (!(window as any).earlyPayoutFrame && root?.dataset.phase === 'result' && root.dataset.animationToken) {
        (window as any).earlyPayoutFrame = true; callback(timestamp - 80);
      } else callback(timestamp);
    });
  });
  await page.locator('[data-neon-spin]').click(); const saved = await final(page, casino), target = Number(saved.returnedUnits), stream = await events(page);
  expect(await page.evaluate(() => (window as any).earlyPayoutFrame)).toBe(true);
  const counts = stream.filter(event => event.phase === 'result' && event.token).map(event => event.payout);
  expect(counts.length).toBeGreaterThan(2); expect(counts.every(value => Number.isInteger(value) && value >= 0 && value <= target)).toBe(true);
  expect(counts.every((value,index) => index === 0 || value >= counts[index - 1])).toBe(true);
  writeFileSync(directory + '/early-raf-counter-proof.json', JSON.stringify({ saved, counts, stream }, null, 2)); expect(errors).toEqual([]);
});

test('phone verifies actual loss, single win and maximum big win without overflow', async ({ page }) => {
  for (const kind of ['loss', 'single', 'big'] as const) {
    const { casino, errors } = await ready(page, { mobile: true }); casino.kind = kind; const initialGeometry = await coreVisible(page, 'phone ' + kind + ' initial'); await page.locator('[data-neon-spin]').click(); const saved = await final(page, casino);
    const cues = await audio(page), payout = Number(saved.returnedUnits);
    expect(cues.played.click).toBe(1); expect(cues.played['reel-stop']).toBe(3);
    if (kind === 'loss') { expect(payout).toBe(0); expect(cues.played.loss).toBe(1); expect(cues.played.line ?? 0).toBe(0); }
    if (kind === 'single') { expect(payout).toBe(1263); expect(cues.played.win).toBe(1); }
    if (kind === 'big') { expect(payout).toBe(6949); expect(cues.played.bigwin).toBe(1); await expect(page.locator('[data-neon-bigwin]')).toBeVisible(); }
    expect(await page.locator('[data-neon-slot]').evaluate(e => e.scrollWidth <= e.clientWidth + 2)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
    const finalGeometry = await coreVisible(page, 'phone ' + kind + ' result');
    await page.screenshot({ path: directory + '/mobile-' + kind + '.png', fullPage: true }); writeFileSync(directory + '/mobile-' + kind + '-geometry.json', JSON.stringify({ initialGeometry, finalGeometry, saved, cues }, null, 2)); expect(errors).toEqual([]);
  }
});

test('saved result, refresh, line inspection and reopening stay static and silent', async ({ page }) => {
  const { casino, errors } = await ready(page, { saved: 'multi' }); await final(page, casino);
  expect(casino.posts).toHaveLength(0); const initialAudio = await audio(page); expect(initialAudio.played).toEqual({}); await resetEvents(page);
  await page.locator('[data-neon-refresh]').click(); await expect.poll(() => casino.gets).toBeGreaterThan(1); await final(page, casino);
  const inspect = page.locator('[data-neon-line-button]'); await expect(inspect).toHaveCount(3); await inspect.first().click(); await expect(inspect.first()).toHaveAttribute('aria-pressed', 'true'); await final(page, casino);
  await page.evaluate(() => (window as any).neonProbe.close()); await expect.poll(async () => (await audio(page)).owners).toBe(0);
  await page.evaluate(() => (window as any).neonProbe.mount()); await final(page, casino);
  expect((await audio(page)).played).toEqual(initialAudio.played); expect((await events(page)).filter(e => ['accelerating', 'spinning', 'stopping'].includes(e.phase))).toEqual([]);
  expect(casino.posts).toHaveLength(0); expect(errors).toEqual([]);
});

test('slow lost reply preserves one UUID and one bet through double click and static retry', async ({ page }) => {
  const { casino, errors } = await ready(page, { saved: 'single' }); await page.locator('[data-neon-stake]').selectOption('5000'); casino.kind = 'big'; let lose!: () => void; const wait = new Promise<void>(yes => lose = yes);
  casino.handler = async (route, reply, index) => { if (index === 1) { await wait; await route.abort('failed'); } else await route.fulfill({ status: 200, json: reply }); };
  await page.locator('[data-neon-spin]').dblclick({ force: true }); await expect.poll(() => casino.posts.length).toBe(1);
  await expect(page.locator('[data-neon-slot]')).toHaveAttribute('data-phase', 'spinning'); await expect(page.locator('[data-neon-reel][data-state="stopped"]')).toHaveCount(0);
  const id = casino.posts[0].operation.id; expect(casino.posts[0].operation).toMatchObject({ stakeUnits: '5000' }); expect(await page.evaluate(account => JSON.parse(sessionStorage.getItem('royal-expansion:' + account)!).id, accountA)).toBe(id);
  lose(); await expect(page.locator('[data-neon-retry]')).toBeEnabled(); await expect.poll(async () => (await audio(page)).loopOwners).toBe(0);
  await expect(page.locator('[data-neon-stake]')).toHaveValue('5000');
  const played = (await audio(page)).played; await resetEvents(page); await page.locator('[data-neon-retry]').click(); await final(page, casino);
  expect(casino.posts).toHaveLength(2); expect(casino.posts[1].operation.id).toBe(id); expect((await audio(page)).played).toEqual(played);
  expect((await events(page)).filter(e => ['accelerating', 'spinning', 'stopping'].includes(e.phase))).toEqual([]);
  const entries = casino.states.get(accountA)!.wallet.entries; expect(entries.filter(e => e.kind === 'bet')).toHaveLength(1); expect(entries.filter(e => e.kind === 'win')).toHaveLength(1);
  expect(await page.evaluate(account => sessionStorage.getItem('royal-expansion:' + account), accountA)).toBeNull(); expect(errors).toEqual([]);
});

test('reduced motion and global mute reveal the server result with no slot audio', async ({ page }) => {
  const { casino, errors } = await ready(page, { mobile: true, reduced: true, muted: true }); casino.kind = 'big'; await resetEvents(page);
  await page.locator('[data-neon-spin]').click(); await final(page, casino);
  const cues = await audio(page); expect(cues.played).toEqual({}); expect(cues.loopOwners).toBe(0); expect(cues.activeSources).toBe(0);
  expect((await events(page)).filter(e => ['accelerating', 'stopping'].includes(e.phase))).toEqual([]);
  expect(await page.evaluate(() => (window as any).neonProbe.audio.getState().muted)).toBe(true);
  await page.screenshot({ path: directory + '/mobile-reduced-muted.png' }); expect(errors).toEqual([]);
});

test('volume zero and mute cancel live cues, preferences persist after reopening', async ({ page }) => {
  const { casino, errors } = await ready(page); const release = casino.hold(); await page.locator('[data-neon-spin]').click(); await expect.poll(async () => (await audio(page)).loopOwners).toBe(1);
  await page.locator('[data-neon-volume]').focus(); await page.keyboard.press('Home'); await expect(page.locator('[data-neon-volume]')).toHaveValue('0');
  await expect.poll(async () => (await audio(page)).loopOwners).toBe(0); await expect.poll(async () => (await audio(page)).activeSources).toBe(0);
  const played = (await audio(page)).played; release(); await final(page, casino); expect((await audio(page)).played).toEqual(played);
  await page.locator('[data-neon-mute]').click(); expect(await page.evaluate(() => (window as any).neonProbe.audio.getState().muted)).toBe(true);
  await page.evaluate(() => { (window as any).neonProbe.close(); (window as any).neonProbe.mount(); }); await final(page, casino);
  await expect(page.locator('[data-neon-volume]')).toHaveValue('0'); expect(await page.evaluate(() => localStorage.getItem('royal-muted'))).toBe('1'); expect(await page.evaluate(() => localStorage.getItem('royal-volume'))).toBe('0'); expect(errors).toEqual([]);
});

test('hidden and closed views stop live audio without replaying a committed result', async ({ page }) => {
  for (const reason of ['hidden', 'close'] as const) {
    const { casino, errors } = await ready(page); casino.kind = 'big'; const release = casino.hold(); await page.locator('[data-neon-spin]').click(); await expect.poll(async () => (await audio(page)).loopOwners).toBe(1);
    await page.evaluate(reason => { const p = (window as any).neonProbe; if (reason === 'hidden') p.visibility(true); else p.close(); }, reason);
    await expect.poll(async () => (await audio(page)).loopOwners).toBe(0); await expect.poll(async () => (await audio(page)).activeSources).toBe(0); const played = (await audio(page)).played;
    release(); await page.waitForFunction(() => !(window as any).neonProbe.client.busy);
    await page.evaluate(reason => { const p = (window as any).neonProbe; if (reason === 'hidden') p.visibility(false); else p.mount(); }, reason);
    await final(page, casino); expect((await audio(page)).played).toEqual(played); expect(casino.posts).toHaveLength(1); expect(errors).toEqual([]);
  }
});

test('switching accounts drops a late result and restores the old pending UUID safely', async ({ page }) => {
  const { casino, errors } = await ready(page); casino.kind = 'big'; const release = casino.hold(); await page.locator('[data-neon-spin]').click(); await expect.poll(() => casino.posts.length).toBe(1); const id = casino.posts[0].operation.id;
  await page.evaluate(id => (window as any).neonProbe.switchAccount(id), accountB); await expect(page.locator('[data-neon-balance]')).toHaveText('2 000,00'); await expect.poll(async () => (await audio(page)).loopOwners).toBe(0); const played = (await audio(page)).played;
  release(); await page.waitForFunction(() => (window as any).neonProbe.client.accountId === '22222222-2222-4222-8222-222222222222' && !(window as any).neonProbe.client.loading);
  expect(await page.evaluate(() => (window as any).neonProbe.client.sessions)).toEqual([]); await expect(page.locator('[data-neon-balance]')).toHaveText('2 000,00'); expect((await audio(page)).played).toEqual(played);
  expect(await page.evaluate(account => JSON.parse(sessionStorage.getItem('royal-expansion:' + account)!).id, accountA)).toBe(id);
  await page.evaluate(id => (window as any).neonProbe.switchAccount(id), accountA); await expect(page.locator('[data-neon-retry]')).toBeEnabled(); casino.handler = undefined; await page.locator('[data-neon-retry]').click(); await final(page, casino);
  expect(casino.posts).toHaveLength(2); expect(casino.posts[1].operation.id).toBe(id); expect(casino.posts[1].account).toBe(accountA); expect(casino.states.get(accountA)!.wallet.entries.filter(e => e.kind === 'bet')).toHaveLength(1); expect((await audio(page)).played).toEqual(played); expect(errors).toEqual([]);
});

test('a definitive rejected stake stops an empty view without creating a round or changing balance', async ({ page }) => {
  const { casino, errors } = await ready(page), rejected: ExpansionAction[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().headers()['x-royal-account-id']).toBe(accountA);
    const operation = route.request().postDataJSON() as ExpansionAction;
    expect(operation).toMatchObject({ action: 'start', gameId: game, stakeUnits: '1000' });
    rejected.push(operation);
    return route.fulfill({ status: 400, json: { error: 'Ставка отклонена. Баланс не изменён.' } });
  });
  await page.locator('[data-neon-spin]').click(); await expect.poll(() => rejected.length).toBe(1);
  await expect(page.locator('[data-neon-error]')).toHaveText('Ставка отклонена. Баланс не изменён.');
  await expect(page.locator('[data-neon-spin]')).toBeEnabled(); await expect(page.locator('[data-neon-stake]')).toBeEnabled();
  await expect(page.locator('[data-neon-retry]')).toBeHidden();
  await expect(page.locator('[data-neon-slot]')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('[data-neon-slot]')).toHaveAttribute('data-session-id', '');
  await expect(page.locator('[data-neon-reel][data-state="stopped"]')).toHaveCount(3);
  await expect(page.locator('[data-neon-payout]')).toHaveAttribute('data-units', '0');
  await expect(page.locator('[data-neon-balance]')).toHaveText('1 000,00');
  await expect.poll(async () => (await audio(page)).activeSources).toBe(0);
  expect((await audio(page)).loopOwners).toBe(0);
  expect(await page.evaluate(() => { const p = (window as any).neonProbe; return { pending: !!p.client.pending, busy: p.client.busy, sessions: p.client.sessions, stored: sessionStorage.getItem('royal-expansion:' + p.client.accountId) }; })).toEqual({ pending: false, busy: false, sessions: [], stored: null });
  expect(casino.states.get(accountA)!.wallet).toEqual({ balance: 1000, entries: [] });
  expect(casino.posts).toHaveLength(0); expect(errors).toEqual([]);
});
