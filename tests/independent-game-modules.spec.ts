import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';

let server: ViteDevServer;
let baseURL: string;
const packageRoot = resolve('module-dist');
const publicOrigin = process.env.ROYAL_MODULE_PUBLIC_ORIGIN ? new URL(process.env.ROYAL_MODULE_PUBLIC_ORIGIN).origin : undefined;
const artworkTimeout = publicOrigin ? 90000 : 20000;
const publicResources = new Map<string, Promise<{ bytes: Buffer; type: string; cache: string }>>();
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

test.beforeAll(async () => {
 server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['tests/fixtures/independent-games.html'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'independent-games-fixture', configureServer(vite) {
   vite.middlewares.use('/game-modules', async (request, response) => {
    try {
     const pathname = decodeURIComponent(new URL(request.url!, 'http://fixture.test').pathname);
     if (publicOrigin) {
      if (!publicOrigin.startsWith('https://') || !pathname.startsWith('/') || pathname.split('/').some(part => part === '..')) throw Error('Unsafe public module path');
      const url = publicOrigin + '/game-modules' + pathname;
      const download = async () => {
       const upstream = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(45000) });
       if (!upstream.ok) throw Error('Missing public module resource');
       return { bytes: Buffer.from(await upstream.arrayBuffer()), type: upstream.headers.get('content-type') || 'application/octet-stream', cache: upstream.headers.get('cache-control') || 'no-store' };
      };
      let pending = pathname.endsWith('/active.json') ? undefined : publicResources.get(url);
      if (!pending) { pending = download(); if (!pathname.endsWith('/active.json')) publicResources.set(url, pending); }
      const resource = await pending;
      response.setHeader('Content-Type', resource.type); response.setHeader('Cache-Control', resource.cache);
      response.end(resource.bytes); return;
     }
     const file = resolve(packageRoot, '.' + pathname);
     if (!file.startsWith(packageRoot + sep)) throw Error('Unsafe fixture path');
     const bytes = await readFile(file);
     response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
     response.setHeader('Cache-Control', 'no-store');
     response.end(bytes);
    } catch { response.statusCode = 404; response.end('Missing fixture resource'); }
   });
  },
 }] });
 await server.listen();
 const address = server.httpServer!.address();
 if (!address || typeof address === 'string') throw Error('Fixture server did not bind');
 baseURL = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await server?.close(); });

async function fixture(page: Page) {
 page.on('console', message => { if (message.type() === 'warning' && message.text().includes('Game module did not open')) console.log(message.text()); });
 await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Изолированная проверка интерфейса' } }));
 await page.route('https://luelonplay.com/demo-api/v1/games?lang=en', route => route.fulfill({ json: { games: [{ id: 'module-provider', name: 'Provider fixture', category: 'slot', embedUrl: 'https://luelonplay.com/embed/module-fixture' }, { id: 'module-provider-second', name: 'Provider second fixture', category: 'slot', embedUrl: 'https://luelonplay.com/embed/module-fixture-second' }] } }));
 await page.route('https://luelonplay.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Provider fixture</body></html>' }));
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.goto(baseURL + '/tests/fixtures/independent-games.html');
 await page.waitForFunction(() => !!(window as any).moduleHarness);
}
async function open(page: Page, gameId: string) {
 await page.evaluate(id => (window as any).moduleHarness.open(id), gameId);
 await expect(page.locator('#primary'), `Module ${gameId} must mount`).toHaveAttribute('data-game-module-version', /\d+\.\d+\.\d+-[a-f0-9]{12}/);
}

async function parallelModule(page: Page) {
 await fixture(page);
 const gameId = 'studio-signal-fox', version = '98.0.0-abcdabcdabcd';
 const root = `/game-modules/${gameId}/versions/${version}/`;
 const entry = 'entry-1111111111111111.js', style = 'style-2222222222222222.css';
 const manifest = JSON.stringify({ format: 1, gameId, version, apiVersion: 1, rulesVersion: 1, progressVersion: 1,
  sourceSha256: '0'.repeat(64), entry, styles: [style], files: { [entry]: '1'.repeat(64), [style]: '2'.repeat(64) } });
 const pointer = { format: 1, gameId, manifest: root + 'manifest.json', sha256: createHash('sha256').update(manifest).digest('hex') };
 const seen: string[] = [], release = {} as Record<'css' | 'js', () => void>;
 const gates = Object.fromEntries(['css', 'js'].map(kind => [kind, new Promise<void>(resolve => { release[kind as 'css' | 'js'] = resolve; })]));
 await page.route(`**/game-modules/${gameId}/**`, async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/active.json')) return route.fulfill({ json: pointer });
  if (path.endsWith('/manifest.json')) return route.fulfill({ contentType: 'application/json', body: manifest });
  const kind = path.endsWith('.css') ? 'css' : 'js';
  seen.push(kind); await gates[kind];
  await route.fulfill({ contentType: kind === 'css' ? 'text/css' : 'text/javascript', body: kind === 'css' ? '[data-parallel-game]{color:white}' : `
   window.__parallelEvaluated = (window.__parallelEvaluated || 0) + 1;
   export const gameId = '${gameId}', apiVersion = 1, rulesVersion = 1, progressVersion = 1;
   export function mount(host) {
    window.__parallelMounted = (window.__parallelMounted || 0) + 1;
    host.innerHTML = '<div data-parallel-game>Ready</div>';
    return { destroy() { window.__parallelDestroyed = (window.__parallelDestroyed || 0) + 1; } };
   }` }).catch(() => undefined);
 });
 await page.evaluate(id => (window as any).moduleHarness.open(id), gameId);
 return { seen, release };
}

test('parallel module resources overlap and mounting waits for both', async ({ page }) => {
 const { seen, release } = await parallelModule(page);
 try {
  await expect.poll(() => [...seen].sort()).toEqual(['css', 'js']);
  release.js();
  await page.waitForFunction(() => (window as any).__parallelEvaluated === 1);
  await expect(page.locator('[data-parallel-game]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__parallelMounted || 0)).toBe(0);
  release.css();
  await expect(page.locator('[data-parallel-game]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__parallelMounted)).toBe(1);
  await page.evaluate(() => (window as any).moduleHarness.close());
  expect(await page.evaluate(() => (window as any).__parallelDestroyed)).toBe(1);
  await expect(page.locator('link[data-royal-game-module]')).toHaveCount(0);
 } finally { release.css(); release.js(); }
});

for (const held of ['css', 'js'] as const) test(`parallel module close while ${held} is pending prevents mounting`, async ({ page }) => {
 const { seen, release } = await parallelModule(page);
 try {
  await expect.poll(() => [...seen].sort()).toEqual(['css', 'js']);
  release[held === 'css' ? 'js' : 'css']();
  if (held === 'css') await page.waitForFunction(() => (window as any).__parallelEvaluated === 1);
  else await page.waitForFunction(() => Boolean(document.querySelector<HTMLLinkElement>('link[data-royal-game-module]')?.sheet));
  await page.evaluate(() => (window as any).moduleHarness.close());
  release[held]();
  await page.waitForFunction(() => (window as any).__parallelEvaluated === 1);
  expect(await page.evaluate(() => (window as any).__parallelMounted || 0)).toBe(0);
  await expect(page.locator('#primary')).toBeEmpty();
  await expect(page.locator('link[data-royal-game-module]')).toHaveCount(0);
 } finally { release.css(); release.js(); }
});

test('all defined games mount as actual independent packages and dispose their styles', async ({ page }) => {
 test.setTimeout(publicOrigin ? 600000 : 180000);
 const errors: string[] = [], failures: string[] = [], originalAssetRequests: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('response', response => { if (response.url().includes('/game-modules/') && response.status() >= 400) failures.push(response.url()); });
 page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/assets/')) originalAssetRequests.push(request.url()); });
 await fixture(page);
 const games = await page.evaluate(() => (window as any).moduleHarness.games as string[]);
 expect(games).toHaveLength(115);
 const startAt = process.env.ROYAL_MODULE_START_AT;
 if (startAt) expect(games).toContain(startAt);
 const selected = startAt ? games.slice(games.indexOf(startAt)) : games;
 const mounted: string[] = [];
 for (const game of selected) {
  await open(page, game);
  if (game !== 'casinoapipro') await expect(page.locator(`#primary > :not([role="status"])`).first()).toBeAttached();
  await expect(page.locator(`link[data-royal-game-module="${game}"]`)).toHaveCount(1);
  const assets = page.locator('#primary [data-asset-state]');
  if (await assets.count()) await expect(assets.first()).toHaveAttribute('data-asset-state', 'ready', { timeout: artworkTimeout });
  if (game === 'github-crash') await expect(page.locator('#primary canvas')).toHaveAttribute('data-assets', '16', { timeout: artworkTimeout });
  if (game === 'original-cr-vs-leo') await expect(page.locator('#primary .cr-leo')).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
  expect(await page.evaluate(() => (window as any).moduleHarness.snapshot())).toMatchObject({ sharedWallet: true, sharedExpansion: true, sharedMines: true, sharedCasino: true, sharedFlight: true, sharedNile: true, sharedUsdt: true, sharedCrypto: true, sharedDemoGames: true, locked: false });
  await page.evaluate(() => (window as any).moduleHarness.close());
  await expect(page.locator('link[data-royal-game-module]')).toHaveCount(0);
  await expect(page.locator('#primary')).not.toHaveAttribute('data-game-module-version', /.+/);
  mounted.push(game);
 }
 expect(errors).toEqual([]);
 expect(failures).toEqual([]);
 expect(originalAssetRequests).toEqual([]);
 if (process.env.ROYAL_MODULE_PROOF_DIR) {
  const directory = resolve(process.env.ROYAL_MODULE_PROOF_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `package-mounts-${startAt || 'all'}.json`), JSON.stringify({ origin: publicOrigin || 'local', catalogCount: games.length, selectedCount: selected.length, mounted, errors, failures, originalAssetRequests }, null, 2) + '\n');
 }
 console.log(`Mounted and disposed ${mounted.length} independent packages${startAt ? ` starting at ${startAt}` : ''}`);
});

test('the published external GIRLHUB package retains host API 1 compatibility', async ({ page }) => {
 test.skip(!publicOrigin, 'This assertion checks the preserved production override');
 await fixture(page);
 const metadata = await page.evaluate(async () => {
  const response = await fetch('/game-modules/studio-afterglow/active.json', { cache: 'no-store' });
  const pointer = await response.json();
  return { pointer, manifest: await (await fetch(pointer.manifest)).json() };
 });
 expect(metadata.manifest).toMatchObject({ gameId: 'studio-afterglow', apiVersion: 1, rulesVersion: 2, progressVersion: 3 });
 await open(page, 'studio-afterglow');
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', metadata.manifest.version);
 await expect(page.locator('#primary [data-afterglow-game]')).toHaveAttribute('data-asset-state', 'ready', { timeout: 45000 });
});

test('current production CR vs Leo selections and Veil of Night presentation survive packaging', async ({ page }) => {
 test.setTimeout(publicOrigin ? 180000 : 90000);
 await fixture(page);
 let posts = 0;
 page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) posts++; });
 await open(page, 'original-cr-vs-leo');
 const game = page.locator('#primary .cr-leo');
 await expect(game).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
 for (const hero of ['cr', 'leo']) for (const risk of ['safe', 'sharp', 'extreme']) {
  await game.locator(`button[data-hero="${hero}"]`).click();
  await expect(game).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
  await game.locator(`button[data-risk="${risk}"]`).click();
  await expect(game).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
  await expect(game).toHaveAttribute('data-hero', hero);
  await expect(game).toHaveAttribute('data-risk', risk);
  await expect(game.locator('[data-hero-name]')).toHaveText(hero === 'cr' ? 'CR' : 'Leo');
  await expect(game.locator('[data-shoot]')).toBeDisabled();
 }
 await open(page, 'royal-plinko');
 await expect(page.locator('#primary .volcanic-plinko')).toHaveAttribute('aria-label', 'Завеса ночи · Plinko');
 await expect(page.locator('#primary .vp-sorceress img')).toBeVisible();
 await expect.poll(() => page.locator('#primary .vp-sorceress img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: artworkTimeout }).toBe(true);
 expect(posts).toBe(0);
});

test('failed package loading can retry without creating a wallet operation', async ({ page }) => {
 await fixture(page);
 let attempts = 0, operations = 0;
 await page.route('**/game-modules/studio-signal-fox/active.json', async route => {
  attempts++;
  if (attempts === 1) await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  else await route.continue();
 });
 page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/game-wallet')) operations++; });
 await page.evaluate(() => (window as any).moduleHarness.open('studio-signal-fox'));
 await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible();
 await page.getByRole('button', { name: 'Повторить загрузку' }).click();
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', /.+/);
 await expect(page.locator('[data-dice-slot="studio-signal-fox"]')).toBeAttached();
 expect(attempts).toBe(2);
 expect(operations).toBe(0);
});

test('closing a delayed module cannot overwrite a newly opened game', async ({ page }) => {
 await fixture(page);
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let intercepted = false;
 await page.route('**/game-modules/studio-signal-fox/active.json', async route => {
  intercepted = true; await gate; await route.continue().catch(() => undefined);
 });
 await page.evaluate(() => (window as any).moduleHarness.open('studio-signal-fox'));
 await expect.poll(() => intercepted).toBe(true);
 await open(page, 'studio-saffron-spin');
 const before = await page.locator('#primary').getAttribute('data-game-module-version');
 release();
 await expect(page.locator('[data-wheel-spin-slot="studio-saffron-spin"]')).toBeAttached();
 expect(await page.locator('#primary').getAttribute('data-game-module-version')).toBe(before);
 await expect(page.locator('link[data-royal-game-module]')).toHaveCount(1);
 await expect(page.locator('link[data-royal-game-module="studio-saffron-spin"]')).toHaveCount(1);
});

for (const game of ['studio-signal-fox', 'studio-nitro-run', 'studio-afterglow', 'studio-velvet-reign', 'github-crash', 'original-cr-vs-leo']) test(`${game}: an uncertain operation keeps its identity and shared wallet lock across game modules`, async ({ page }) => {
 test.setTimeout(publicOrigin ? 90000 : 60000);
 await fixture(page);
 const sent: unknown[] = [];
 if (game === 'studio-afterglow') await page.route('**/api/game-wallet/afterglow-wardrobe', route => route.fulfill({ json: {
  version: 3, revision: 0, selectedGirl: 0, selectedLook: 0, albumUnits: 0,
  pointsUnits: [0, 0, 0, 0], unlocked: [false, false, false, false], active: false, activeGirl: null,
 } }));
 await page.route('**/api/game-wallet', route => route.fulfill({ json: { balance: 1000, entries: [] } }));
 await page.route('**/api/game-wallet/expansion', async route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { wallet: { balance: 1000, entries: [] }, sessions: [] } });
  sent.push(route.request().postDataJSON());
  await route.abort('failed');
 });
 await page.evaluate(() => (window as any).moduleHarness.account('isolated-module-account'));
 await open(page, game);
 if (game === 'studio-nitro-run' || game === 'studio-afterglow') {
  await expect(page.locator('[data-cc-action="enter"]')).toBeEnabled({ timeout: 20000 });
  await page.locator('[data-cc-action="enter"]').click();
 }
 if (game === 'studio-velvet-reign') {
  await expect(page.locator('[data-velvet-reign]')).toHaveAttribute('data-asset-state', 'ready');
  await page.locator('[data-lg-dialog-action="enter"]').click();
 }
 if (game === 'original-cr-vs-leo') await expect(page.locator('.cr-leo')).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
 const play = page.locator(game === 'studio-velvet-reign' ? '[data-lg-spin]' : game === 'studio-nitro-run' || game === 'studio-afterglow' ? '[data-cc-spin]' : game === 'github-crash' ? '[data-start]' : game === 'original-cr-vs-leo' ? '[data-shoot]' : '[data-dice-play]');
 await expect(play).toBeEnabled();
 await play.click();
 await expect.poll(() => sent.length).toBe(1);
 await expect.poll(() => page.evaluate(() => !!(window as any).moduleHarness.snapshot().pending)).toBe(true);
 const before = await page.evaluate(() => (window as any).moduleHarness.snapshot());
 expect(before).toMatchObject({ sharedWallet: true, sharedExpansion: true, balance: 1000, locked: true });
 expect(JSON.parse(before.storage)).toEqual(before.pending);
 if (game === 'studio-afterglow') {
  await page.evaluate(() => (window as any).moduleHarness.close());
  await open(page, game);
  expect(await page.evaluate(() => (window as any).moduleHarness.snapshot())).toMatchObject({
   sharedWallet: true, sharedExpansion: true, balance: 1000, locked: true, pending: before.pending, storage: before.storage,
  });
 }
 await open(page, 'studio-saffron-spin');
 const reopened = await page.evaluate(() => (window as any).moduleHarness.snapshot());
 expect(reopened.pending).toEqual(before.pending);
 expect(reopened.storage).toBe(before.storage);
 expect(reopened.locked).toBe(true);
 await page.evaluate(() => (window as any).moduleHarness.retry());
 expect(sent).toHaveLength(2);
 expect(sent[1]).toEqual(sent[0]);
 expect(await page.evaluate(() => (window as any).moduleHarness.snapshot().pending)).toEqual(before.pending);
});

test('a published pointer change affects the next opening while the current game keeps its version', async ({ page }) => {
 await fixture(page);
 const game = 'studio-signal-fox';
 const pointer = JSON.parse(await readFile(resolve(packageRoot, game, 'active.json'), 'utf8'));
 const oldVersion = pointer.manifest.split('/')[4];
 const newVersion = '99.0.0-abcdef123456';
 const oldRoot = `/game-modules/${game}/versions/${oldVersion}/`, newRoot = `/game-modules/${game}/versions/${newVersion}/`;
 const originalManifest = JSON.parse(await readFile(resolve(packageRoot, game, 'versions', oldVersion, 'manifest.json'), 'utf8'));
 const newManifest = JSON.stringify({ ...originalManifest, version: newVersion });
 const newPointer = { ...pointer, manifest: newRoot + 'manifest.json', sha256: createHash('sha256').update(newManifest).digest('hex') };
 let updated = false, pointerReads = 0;
 await page.route(`**/game-modules/${game}/**`, async route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith('/active.json')) { pointerReads++; return route.fulfill({ json: updated ? newPointer : pointer }); }
  if (pathname === newRoot + 'manifest.json') return route.fulfill({ contentType: 'application/json', body: newManifest });
  if (pathname.startsWith(newRoot)) {
   const response = await route.fetch({ url: route.request().url().replace(newRoot, oldRoot) });
   return route.fulfill({ response });
  }
  await route.continue();
 });
 await open(page, game);
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', oldVersion);
 updated = true;
 expect(pointerReads).toBe(1);
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', oldVersion);
 await open(page, game);
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', newVersion);
 expect(pointerReads).toBe(2);
});

test('hockey uses server updates and keyboard paddles, then releases its lifecycle on close', async ({ page }) => {
 await fixture(page);
 await open(page, 'hockey');
 await expect(page.locator('#shared-dialog[data-game="hockey"]')).toBeVisible();
 await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.messages().some((message: any) => message.type === 'join' && message.id === 'hockey'))).toBe(true);
 await page.evaluate(() => (window as any).moduleHarness.clearMessages());
 await page.keyboard.down('ArrowRight');
 await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.messages().some((message: any) => message.type === 'paddle' && message.x > 100))).toBe(true);
 await page.keyboard.up('ArrowRight');
 await page.evaluate(() => {
  const harness = (window as any).moduleHarness, state = harness.activityState();
  state.tables[0] = { ...state.tables[0], score: [3, 1] };
  harness.updateActivity(state);
 });
 await expect(page.locator('.table-match-score')).toHaveText('3 : 1');
 await page.evaluate(() => { (window as any).moduleHarness.close(); (window as any).moduleHarness.clearMessages(); });
 await page.keyboard.press('ArrowRight');
 await page.keyboard.press('a');
 await page.evaluate(async () => { for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame); });
 expect(await page.evaluate(() => (window as any).moduleHarness.messages())).toEqual([]);
 await expect(page.locator('#shared-dialog')).toHaveCount(0);
});

test('activity state and players arriving during package loading are applied after mounting', async ({ page }) => {
 await fixture(page);
 let release!: () => void, intercepted = false;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await page.route('**/game-modules/hockey/active.json', async route => { intercepted = true; await gate; await route.continue(); });
 await page.evaluate(() => (window as any).moduleHarness.open('hockey'));
 await expect.poll(() => intercepted).toBe(true);
 await page.evaluate(() => {
  const harness = (window as any).moduleHarness, state = harness.activityState();
  state.tables[0] = { ...state.tables[0], score: [6, 2] };
  harness.updateActivity(state);
  harness.updatePlayers([{ id: 'module-self', name: 'Обновлённый игрок' }, { id: 'module-peer', name: 'Другой участник' }]);
 });
 release();
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-id', 'hockey');
 await expect(page.locator('.table-match-score')).toHaveText('6 : 2');
 await expect(page.locator('.table-player strong').first()).toHaveText('Обновлённый игрок');
});

test('piano releases held notes on module destruction and reopens without duplicate key handlers', async ({ page }) => {
 await fixture(page);
 await open(page, 'piano');
 await page.evaluate(() => (window as any).moduleHarness.clearMessages());
 await page.keyboard.down('a');
 await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.messages().filter((message: any) => message.type === 'note' && message.note === 60 && message.down).length)).toBe(1);
 await page.evaluate(() => (window as any).moduleHarness.close());
 expect(await page.evaluate(() => (window as any).moduleHarness.messages().filter((message: any) => message.type === 'note' && message.note === 60 && !message.down))).toHaveLength(1);
 await page.keyboard.up('a');
 await open(page, 'piano');
 await page.evaluate(() => (window as any).moduleHarness.clearMessages());
 await page.keyboard.press('a');
 const notes = await page.evaluate(() => (window as any).moduleHarness.messages().filter((message: any) => message.type === 'note' && message.note === 60));
 expect(notes).toEqual([{ type: 'note', note: 60, down: true }, { type: 'note', note: 60, down: false }]);
});

test('pool and chess preserve network action contracts inside their independent views', async ({ page }) => {
 await fixture(page);
 await open(page, 'pool');
 await page.evaluate(() => (window as any).moduleHarness.clearMessages());
 await expect(page.locator('#pool-shoot')).toBeEnabled();
 await page.locator('#pool-shoot').click();
 const shots = await page.evaluate(() => (window as any).moduleHarness.messages().filter((message: any) => message.type === 'shot'));
 expect(shots).toHaveLength(1);
 expect(shots[0]).toMatchObject({ type: 'shot', angle: 0, power: 550, pocket: -1 });
 await page.evaluate(() => {
  const harness = (window as any).moduleHarness, state = harness.activityState();
  state.tables[1] = { ...state.tables[1], moving: true };
  harness.updateActivity(state);
 });
 await expect(page.locator('#pool-shoot')).toBeDisabled();
 await open(page, 'chess');
 await page.evaluate(() => (window as any).moduleHarness.clearMessages());
 await page.locator('[data-square="e2"]').click();
 await page.locator('[data-square="e4"]').click();
 expect(await page.evaluate(() => (window as any).moduleHarness.messages())).toContainEqual({ type: 'chess-move', from: 'e2', to: 'e4' });
 await page.evaluate(() => {
  const harness = (window as any).moduleHarness, state = harness.activityState();
  state.chess = { ...state.chess, revision: 2, turn: 'b', last: { from: 'e2', to: 'e4' }, moves: [], board: state.chess.board.map((piece: any) => piece.square === 'e2' ? { ...piece, square: 'e4' } : piece) };
  harness.updateActivity(state);
 });
 await expect(page.locator('[data-square="e4"]')).toHaveClass(/piece-w.*last-move|last-move.*piece-w/);
 await expect(page.locator('[data-square="e4"]')).toBeDisabled();
});

test('provider packages preserve iframe launching and host callbacks without a local provider engine', async ({ page }) => {
 await fixture(page);
 await open(page, 'luelon');
 await expect(page.locator('#primary iframe')).toHaveAttribute('src', 'https://luelonplay.com/embed/module-fixture');
 await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.snapshot().title)).toBe('Provider fixture');
 await page.locator('#all-demo-games').click();
 await page.getByRole('button', { name: 'Играть в Provider second fixture', exact: true }).click();
 await expect(page.locator('#primary iframe')).toHaveAttribute('src', 'https://luelonplay.com/embed/module-fixture-second');
 expect(await page.evaluate(async () => (await (window as any).moduleHarness.selectedDemo()).id)).toBe('module-provider-second');
 await page.evaluate(() => (window as any).moduleHarness.close());
 await expect(page.locator('iframe')).toHaveCount(0);
 await page.route('**/api/game-wallet', route => route.fulfill({ json: { balance: 1000, entries: [] } }));
 await page.route('**/api/casinoapipro/status', route => route.fulfill({ json: { configured: true, walletConnected: true, currency: 'DEMO', playerId: 'provider-fixture', balance: '1000.00' } }));
 await page.route('**/api/casinoapipro/games', route => route.fulfill({ json: { games: [{ id: 'fixture-slot', slug: 'fixture-slot', name: 'Connected fixture', category: 'SLOTS', minBet: '1', maxBet: '100' }] } }));
 let launches = 0;
 await page.route('**/api/casinoapipro/sessions', route => { launches++; return route.fulfill({ json: { launchUrl: 'https://games.casinoapipro.com/play?session=module-fixture' } }); });
 await page.route('https://games.casinoapipro.com/play?session=module-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Connected provider fixture</body></html>' }));
 await page.evaluate(() => { (window as any).moduleHarness.account('provider-module-account'); (window as any).moduleHarness.clearMessages(); });
 await open(page, 'casinoapipro');
 await page.getByRole('button', { name: 'Тестовая игра Connected fixture' }).click();
 await expect(page.locator('#casinoapipro-dialog iframe')).toHaveAttribute('src', 'https://games.casinoapipro.com/play?session=module-fixture');
 expect(launches).toBe(1);
 await page.locator('#capro-close').click();
 await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.messages().some((message: any) => message.type === 'provider-closed'))).toBe(true);
 const callbacks = await page.evaluate(() => (window as any).moduleHarness.messages());
 expect(callbacks).toContainEqual({ type: 'provider-playing', value: false });
 expect(callbacks.filter((message: any) => message.type === 'provider-closed')).toHaveLength(1);
 await expect(page.locator('iframe')).toHaveCount(0);
 await page.evaluate(() => (window as any).moduleHarness.close());
 await expect(page.locator('#casinoapipro-dialog')).toHaveCount(0);
});

test('the provider host can cancel a pending package and reopen repeatedly without a stale modal', async ({ page }) => {
 await fixture(page);
 let release!: () => void, intercepted = false;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await page.route('**/game-modules/casinoapipro/active.json', async route => { intercepted = true; await gate; await route.continue().catch(() => undefined); });
 await page.evaluate(() => (window as any).moduleHarness.providerOpen());
 await expect.poll(() => intercepted).toBe(true);
 await page.locator('#provider-module-loading button').click();
 release();
 await page.unroute('**/game-modules/casinoapipro/active.json');
 await expect(page.locator('#provider-module-loading')).toHaveCount(0);
 await expect(page.locator('#casinoapipro-dialog')).toHaveCount(0);
 for (let attempt = 0; attempt < 2; attempt++) {
  await page.evaluate(() => (window as any).moduleHarness.providerOpen());
  await expect(page.locator('#casinoapipro-dialog')).toBeVisible();
  await expect(page.locator('#provider-module-loading')).toHaveCount(1);
  await page.locator('#capro-close').click();
  await expect(page.locator('#casinoapipro-dialog')).toHaveCount(0);
  await expect(page.locator('#provider-module-loading')).toHaveCount(0);
  await expect(page.locator('link[data-royal-game-module="casinoapipro"]')).toHaveCount(0);
 }
 expect(await page.evaluate(() => (window as any).moduleHarness.snapshot().lockedScene)).toBe(false);
 await page.evaluate(() => (window as any).moduleHarness.providerDestroy());
});

test('legacy arcade packages forward status, start, pause and disposal to the host', async ({ page }) => {
 await fixture(page);
 for (const game of ['breaker', 'orbit', 'drift', 'pixel']) {
  await page.evaluate(() => (window as any).moduleHarness.clearStatuses());
  await open(page, game);
  await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.statuses().some((status: any) => status.phase === 'ready'))).toBe(true);
  await page.evaluate(() => (window as any).moduleHarness.start());
  await expect.poll(() => page.evaluate(() => (window as any).moduleHarness.currentState()?.phase)).toBe('playing');
  await page.evaluate(() => (window as any).moduleHarness.pause());
  const paused = await page.evaluate(() => (window as any).moduleHarness.currentState());
  await page.evaluate(async () => { for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame); });
  expect(await page.evaluate(() => (window as any).moduleHarness.currentState())).toEqual(paused);
  await page.evaluate(() => (window as any).moduleHarness.resume());
  expect(await page.evaluate(() => (window as any).moduleHarness.statuses())).toContainEqual(expect.objectContaining({ phase: 'playing' }));
  await page.evaluate(() => (window as any).moduleHarness.close());
  await expect(page.locator('#primary canvas')).toHaveCount(0);
  const count = await page.evaluate(() => (window as any).moduleHarness.statuses().length);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as any).moduleHarness.statuses().length)).toBe(count);
 }
});

test('representative native and generic modules retain desktop and mobile presentation', async ({ page }) => {
 test.setTimeout(publicOrigin ? 180000 : 90000);
 const directory = resolve(process.env.ROYAL_MODULE_PROOF_DIR || 'artifacts/independent-game-modules/proof');
 await mkdir(directory, { recursive: true });
 await fixture(page);
 for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  await page.setViewportSize({ width, height });
  for (const game of ['studio-nitro-run', 'studio-ember-vault', 'github-crash', 'hockey', 'pool', 'chess', 'piano', 'original-cr-vs-leo', 'royal-plinko']) {
   await open(page, game);
   if (game === 'studio-nitro-run') {
    await expect(page.locator('[data-cc-action="enter"]')).toBeEnabled({ timeout: 20000 });
    await page.locator('[data-cc-action="enter"]').click();
   }
   if (game === 'github-crash') await expect(page.locator('#primary canvas')).toHaveAttribute('data-assets', '16', { timeout: artworkTimeout });
   if (game === 'original-cr-vs-leo') await expect(page.locator('#primary .cr-leo')).toHaveAttribute('data-loading', 'false', { timeout: 60000 });
   if (game === 'royal-plinko') await page.locator('[data-vp="enter"]').click();
   await page.screenshot({ path: resolve(directory, `${game}-${name}.png`), fullPage: true });
  }
 }
});
