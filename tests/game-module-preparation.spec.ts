import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createHash } from 'node:crypto';

let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
 server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['tests/fixtures/independent-games.html'] }, server: { host: '127.0.0.1', port: 0 } });
 await server.listen();
 const address = server.httpServer!.address();
 if (!address || typeof address === 'string') throw Error('Fixture did not bind');
 origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await server?.close(); });

const game = 'studio-signal-fox';
function packageFor(gameId = game, revision = 0, imageCount = 0) {
 const version = `97.0.${revision}-abcdefabcdef`, root = `/game-modules/${gameId}/versions/${version}/`;
 const entry = 'entry-1111111111111111.js', style = 'style-2222222222222222.css';
 const preload = Array.from({ length: imageCount }, (_, index) => `media/image-${index}.webp`);
 const files = Object.fromEntries([entry, style, ...preload].map(name => [name, '1'.repeat(64)]));
 const manifest = JSON.stringify({ format: 1, gameId, version, apiVersion: 1, rulesVersion: 1, progressVersion: 1,
  sourceSha256: '0'.repeat(64), entry, styles: [style], files, ...(imageCount ? { preload } : {}) });
 const pointer = { format: 1, gameId, manifest: root + 'manifest.json', sha256: createHash('sha256').update(manifest).digest('hex') };
 const code = `window.__entryEvaluations = (window.__entryEvaluations || 0) + 1;
  export const gameId = '${gameId}', apiVersion = 1, rulesVersion = 1, progressVersion = 1;
  export function mount(host) { window.__entryMounts = (window.__entryMounts || 0) + 1;
   host.innerHTML = '<div data-prepared-game="${version}">Ready</div>'; return { destroy() {} }; }`;
 return { gameId, version, root, manifest, pointer, code };
}

async function harness(page: Page) {
 const active = new Map<string, ReturnType<typeof packageFor>>(), packages = new Map<string, ReturnType<typeof packageFor>>();
 const requests: { path: string; method: string }[] = [];
 const control: { before?: (path: string) => Promise<void>; corruptManifest?: boolean; largeEntry?: boolean } = {};
 const select = (value: ReturnType<typeof packageFor>) => { active.set(value.gameId, value); packages.set(value.root, value); };
 await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
 await page.route('**/game-modules/**', async route => {
  const path = new URL(route.request().url()).pathname;
  requests.push({ path, method: route.request().method() });
  await control.before?.(path);
  if (path.endsWith('/active.json')) return route.fulfill({ json: active.get(path.split('/')[2])!.pointer });
  const value = packages.get(path.slice(0, path.lastIndexOf('/') + 1)) ?? [...packages.values()].find(value => path.startsWith(value.root));
  if (!value) return route.fulfill({ status: 404 });
  if (path.endsWith('/manifest.json')) {
   const body = control.corruptManifest ? value.manifest + ' ' : value.manifest;
   control.corruptManifest = false;
   return route.fulfill({ contentType: 'application/json', body });
  }
  await route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'image/webp',
   body: path.endsWith('.js') ? control.largeEntry ? ' '.repeat(9 * 1024 * 1024) : value.code : path.endsWith('.css') ? '[data-prepared-game]{color:white}' : 'image-bytes' }).catch(() => undefined);
 });
 await page.goto(origin + '/tests/fixtures/independent-games.html');
 await page.waitForFunction(() => Boolean((window as any).moduleHarness));
 await page.evaluate(async () => { (window as any).preparation = await import('/src/modules/GameModulePreparation.ts'); });
 const count = (suffix: string) => requests.filter(request => request.path.endsWith(suffix)).length;
 return { select, requests, control, count };
}

async function open(page: Page, version: string) {
 await page.evaluate(id => (window as any).moduleHarness.open(id), game);
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', version);
}

test('preparation caches immutable metadata and every opening checks the current pointer', async ({ page }) => {
 const h = await harness(page), original = packageFor(); h.select(original);
 expect(await page.evaluate(id => (window as any).preparation.prepareGameModule(id), game)).toBe(true);
 expect(h.count('/active.json')).toBe(1); expect(h.count('/manifest.json')).toBe(1);
 expect(await page.evaluate(() => (window as any).__entryEvaluations || 0)).toBe(0);
 await expect(page.locator('link[data-royal-game-module]')).toHaveCount(0);
 await open(page, original.version);
 await page.evaluate(() => (window as any).moduleHarness.close());
 await open(page, original.version);
 expect(h.count('/active.json')).toBe(3); expect(h.count('/manifest.json')).toBe(1);
 expect(await page.evaluate(() => ({ evaluations: (window as any).__entryEvaluations, mounts: (window as any).__entryMounts }))).toEqual({ evaluations: 1, mounts: 2 });
 const updated = packageFor(game, 1); h.select(updated);
 await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', original.version);
 await page.evaluate(() => (window as any).moduleHarness.close());
 await open(page, updated.version);
 expect(h.count('/active.json')).toBe(4); expect(h.count('/manifest.json')).toBe(2);
 expect(h.requests.every(request => request.method === 'GET')).toBe(true);
});

test('closing one consumer preserves a shared preparation request for reopening', async ({ page }) => {
 const h = await harness(page), value = packageFor(); h.select(value);
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 h.control.before = path => path.endsWith('/manifest.json') ? gate : Promise.resolve();
 try {
  await page.evaluate(id => { (window as any).warmResult = (window as any).preparation.prepareGameModule(id); }, game);
  await expect.poll(() => h.count('/manifest.json')).toBe(1);
  await page.evaluate(id => (window as any).moduleHarness.open(id), game);
  await expect.poll(() => h.count('/active.json')).toBe(2);
  await page.evaluate(() => (window as any).moduleHarness.close());
  release();
  expect(await page.evaluate(() => (window as any).warmResult)).toBe(true);
  expect(h.count('/manifest.json')).toBe(1);
  expect(await page.evaluate(() => (window as any).__entryMounts || 0)).toBe(0);
  await open(page, value.version);
  expect(h.count('/manifest.json')).toBe(1);
  expect(await page.evaluate(() => (window as any).__entryMounts)).toBe(1);
 } finally { release(); }
});

test('a failed integrity check is evicted so the next opening can retry', async ({ page }) => {
 const h = await harness(page), value = packageFor(); h.select(value); h.control.corruptManifest = true;
 expect(await page.evaluate(id => (window as any).preparation.prepareGameModule(id), game)).toBe(false);
 expect(await page.evaluate(() => (window as any).__entryEvaluations || 0)).toBe(0);
 await open(page, value.version);
 expect(h.count('/manifest.json')).toBe(2);
 expect(h.count('/active.json')).toBe(2);
});

test('verified manifest caching evicts the least recently used version after sixteen entries', async ({ page }) => {
 const h = await harness(page);
 for (let index = 0; index < 17; index++) {
  h.select(packageFor(game, index));
  await page.evaluate(id => (window as any).preparation.loadGameModule(id, new AbortController().signal), game);
 }
 expect(h.count('/manifest.json')).toBe(17);
 h.select(packageFor(game, 16));
 await page.evaluate(id => (window as any).preparation.loadGameModule(id, new AbortController().signal), game);
 expect(h.count('/manifest.json')).toBe(17);
 h.select(packageFor(game, 0));
 await page.evaluate(id => (window as any).preparation.loadGameModule(id, new AbortController().signal), game);
 expect(h.count('/manifest.json')).toBe(18);
});

test('preparation bounds resource workers and the number of hinted images', async ({ page }) => {
 const h = await harness(page); h.select(packageFor(game, 0, 16));
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let resources = 0;
 h.control.before = async path => { if (!path.endsWith('.json')) { resources++; await gate; } };
 try {
  await page.evaluate(id => { (window as any).firstWarm = (window as any).preparation.prepareGameModule(id); }, game);
  await expect.poll(() => resources).toBe(2);
  expect(h.count('/active.json')).toBe(1);
  release();
  expect(await page.evaluate(() => (window as any).firstWarm)).toBe(true);
  expect(h.requests.filter(request => request.path.startsWith(`/game-modules/${game}/`) && !request.path.endsWith('.json'))).toHaveLength(16);
  expect(await page.evaluate(() => (window as any).__entryEvaluations || 0)).toBe(0);
 } finally { release(); }
});

test('a newer intent cancels older static requests and immediately prepares the latest game', async ({ page }) => {
 const h = await harness(page), value = packageFor(game, 0, 16); h.select(value);
 h.select(packageFor('studio-saffron-spin')); h.select(packageFor('studio-beacon-bay'));
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let held = 0;
 h.control.before = async path => { if (path.startsWith(value.root) && !path.endsWith('.json')) { held++; await gate; } };
 try {
  await page.evaluate(id => { (window as any).firstWarm = (window as any).preparation.prepareGameModule(id); }, game);
  await expect.poll(() => held).toBe(2);
  await page.evaluate(() => {
   (window as any).discardedWarm = (window as any).preparation.prepareGameModule('studio-saffron-spin');
   (window as any).latestWarm = (window as any).preparation.prepareGameModule('studio-beacon-bay');
  });
  expect(await page.evaluate(() => (window as any).firstWarm)).toBe(false);
  expect(await page.evaluate(() => (window as any).discardedWarm)).toBe(false);
  expect(await page.evaluate(() => (window as any).latestWarm)).toBe(true);
  expect(held).toBe(2);
  expect(h.requests.some(request => request.path.includes('/studio-saffron-spin/'))).toBe(false);
  expect(h.count('/active.json')).toBe(2);
  expect(await page.evaluate(() => (window as any).__entryEvaluations || 0)).toBe(0);
 } finally { release(); }
});

test('switching background intent does not cancel the game already opening', async ({ page }) => {
 const h = await harness(page), value = packageFor(); h.select(value); h.select(packageFor('studio-saffron-spin'));
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 h.control.before = path => path.startsWith(value.root) && path.endsWith('.js') ? gate : Promise.resolve();
 try {
  await page.evaluate(id => { (window as any).firstWarm = (window as any).preparation.prepareGameModule(id); }, game);
  await expect.poll(() => h.requests.filter(request => request.path.startsWith(value.root) && request.path.endsWith('.js')).length).toBe(1);
  await page.evaluate(id => (window as any).moduleHarness.open(id), game);
  await expect.poll(() => h.requests.filter(request => request.path.startsWith(value.root) && request.path.endsWith('.js')).length).toBe(2);
  expect(await page.evaluate(() => (window as any).preparation.prepareGameModule('studio-saffron-spin'))).toBe(true);
  expect(await page.evaluate(() => (window as any).firstWarm)).toBe(false);
  release();
  await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', value.version);
  expect(await page.evaluate(() => (window as any).__entryMounts)).toBe(1);
 } finally { release(); }
});

test('preparation stops when a resource exceeds the byte budget', async ({ page }) => {
 const h = await harness(page); h.select(packageFor()); h.control.largeEntry = true;
 expect(await page.evaluate(id => (window as any).preparation.prepareGameModule(id), game)).toBe(false);
 expect(await page.evaluate(() => (window as any).__entryEvaluations || 0)).toBe(0);
});
