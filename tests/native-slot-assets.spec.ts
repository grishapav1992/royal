import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

let server: ViteDevServer, baseURL: string;
const proof = 'artifacts/native-slot-assets';
test.beforeAll(async () => {
 server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'native-assets', configureServer(vite) {
  vite.middlewares.use('/game-modules', async (request, response) => {
   try {
    const root = resolve('module-dist'), file = resolve(root, '.' + new URL(request.url!, 'http://fixture.test').pathname);
    if (!file.startsWith(root + sep)) throw Error('Unsafe resource');
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' } as Record<string, string>)[extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); response.end(await readFile(file));
   } catch { response.statusCode = 404; response.end(); }
  });
 } }] });
 await server.listen(); const address = server.httpServer!.address();
 if (!address || typeof address === 'string') throw Error('Missing server');
 baseURL = `http://127.0.0.1:${address.port}`; await mkdir(proof, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

async function fixture(page: Page) {
 await page.addInitScript('window.__name = value => value; window.__imageDecodes = []; const decode = HTMLImageElement.prototype.decode; HTMLImageElement.prototype.decode = function(){ window.__imageDecodes.push(this.src); return decode.call(this); };');
 await page.goto(baseURL + '/tests/fixtures/independent-games.html');
 await page.waitForFunction(() => Boolean((window as any).moduleHarness));
}
async function mount(page: Page, gameId: string) {
 await page.evaluate(async gameId => {
  (window as any).__native?.destroy();
  const pointer = await (await fetch(`/game-modules/${gameId}/active.json`)).json();
  const manifest = await (await fetch(pointer.manifest)).json(), root = pointer.manifest.replace('manifest.json', '');
  if (!document.querySelector(`[data-native-style="${gameId}"]`)) {
   const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = root + manifest.styles[0]; link.dataset.nativeStyle = gameId;
   await new Promise<void>((yes, no) => { link.onload = () => yes(); link.onerror = () => no(Error('Style')); document.head.append(link); });
  }
  const module = await import(root + manifest.entry); (window as any).__native = module.mount(document.querySelector('#primary'));
 }, gameId);
}

test('GIRLHUB only waits for its visible look, cancels gallery work and reuses decoded images', async ({ page }) => {
 const errors: string[] = [], requests: string[] = [], posts: unknown[] = [];
 const profile = { version: 4, revision: 0, selectedGirl: 0, selectedLook: 0, albumUnits: 90000, pointsUnits: [400000, 100000, 300000, 200000], unlocked: [true, true, true, true], active: false, activeGirl: null };
 page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(new URL(request.url()).pathname));
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/afterglow-wardrobe')) {
   if (route.request().method() === 'POST') { const body = route.request().postDataJSON(); posts.push(body); profile.selectedGirl = body.girl; profile.selectedLook = body.look; profile.revision++; }
   return route.fulfill({ json: profile });
  }
  if (path === '/api/demo-wallet') return route.fulfill({ json: { balance: 1000, entries: [] } });
  if (path.endsWith('/expansion')) return route.fulfill({ json: { wallet: { balance: 1000, entries: [] }, sessions: [] } });
  return route.fulfill({ status: 401, json: { error: 'Fixture' } });
 });
 let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = 0;
 await page.route(/\/media\/afterglow\/v3\/base-[123]\.webp$/, async route => { held++; await gate; await route.continue().catch(() => {}); });
 await fixture(page); await page.evaluate(() => (window as any).moduleHarness.account('11111111-1111-4111-8111-111111111111'));
 await mount(page, 'studio-afterglow');
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state', 'ready');
 expect(requests.filter(path => /\/(?:base-[123]|look-[123]-user|look-0-legendary)\.webp$/.test(path))).toEqual([]);
 expect(held).toBe(0); await page.locator('[data-cc-action="enter"]').click();
 await page.locator('[data-ag-album]').click();
 await expect.poll(() => held).toBe(3); await expect(page.getByRole('heading', { name: 'Загружаем фото' })).toBeVisible();
 await page.locator('[data-cc-action="close"]').click(); release();
 await page.waitForTimeout(200); await expect(page.locator('[data-cc-spin]')).toBeEnabled();
 expect(posts).toEqual([]); await page.locator('[data-ag-album]').click();
 await expect(page.getByRole('heading', { name: 'АЛЬБОМ ГЕРОИНЬ' })).toBeVisible();
 await page.locator('[data-cc-action="look-3"]').click();
 await expect(page.locator('[data-ag-portrait] [data-girl="3"][data-look="1"]')).toHaveCount(1);
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state', 'ready');
 expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ girl: 3, look: 1 });
 const before = await page.evaluate(() => (window as any).__imageDecodes.length);
 await mount(page, 'studio-afterglow');
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state', 'ready');
 await expect(page.locator('[data-ag-portrait] [data-girl="3"][data-look="1"]')).toHaveCount(1);
 expect(await page.evaluate(() => (window as any).__imageDecodes.length)).toBe(before);
 expect(await page.evaluate(() => (window as any).moduleHarness.snapshot())).toMatchObject({ balance: 1000, pending: undefined });
 expect(errors).toEqual([]); await page.screenshot({ path: proof + '/girlhub-selected.png' });
});

test('a fresh GIRLHUB entry prepares the saved second look without loading the other photos', async ({ page }) => {
 const requests: string[] = [];
 page.on('request', request => requests.push(new URL(request.url()).pathname));
 await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/afterglow-wardrobe')) return route.fulfill({ json: { version: 4, revision: 4, selectedGirl: 3, selectedLook: 1, albumUnits: 90000, pointsUnits: [400000, 100000, 300000, 200000], unlocked: [true, true, true, true], active: false, activeGirl: null } });
  if (path === '/api/demo-wallet') return route.fulfill({ json: { balance: 1000, entries: [] } });
  if (path.endsWith('/expansion')) return route.fulfill({ json: { wallet: { balance: 1000, entries: [] }, sessions: [] } });
  return route.fulfill({ status: 401, json: { error: 'Fixture' } });
 });
 await fixture(page); await page.evaluate(() => (window as any).moduleHarness.account('11111111-1111-4111-8111-111111111111'));
 await mount(page, 'studio-afterglow');
 await expect(page.locator('[data-ag-portrait] [data-girl="3"][data-look="1"]')).toHaveCount(1);
 await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state', 'ready');
 const photos = [...new Set(requests.filter(path => /\/(?:base-|look-)/.test(path)))];
 expect(photos).toHaveLength(2); expect(photos.some(path => path.endsWith('/base-0.webp'))).toBe(true); expect(photos.some(path => path.endsWith('/look-3-user.webp'))).toBe(true);
});

test('Velvet portraits retain detail at the largest held-column display', async ({ page }) => {
 await page.setViewportSize({ width: 1440, height: 1000 });
 await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Fixture' } }));
 await fixture(page); await mount(page, 'studio-velvet-reign');
 await expect(page.locator('[data-velvet-reign]')).toHaveAttribute('data-asset-state', 'ready');
 const report = await page.evaluate(async () => {
  ((window as any).__native.child??(window as any).__native).closeDialog(); ((window as any).__native.child??(window as any).__native).board.stars([0, 1, 2, 3, 4].map(column => ({ column, factor: 2 })));
  const names = ['evelyn', 'celeste', 'mei', 'viola', 'amira'], result = [];
  for (const element of document.querySelectorAll<SVGImageElement>('.vr-held-star [data-velvet-portrait]')) {
   const index = Number(element.dataset.velvetPortrait), bounds = element.getBoundingClientRect();
   const images = await Promise.all([`/assets/velvet-rebuild/v2/${names[index]}.webp`, element.getAttribute('href')!].map(async url => { const image = new Image(); image.src = url; await image.decode(); return image; }));
   const pixels = images.map(image => { const canvas = document.createElement('canvas'); canvas.width = Math.round(bounds.width * 2); canvas.height = Math.round(bounds.height * 2); const context = canvas.getContext('2d')!; context.fillStyle = '#12212a'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); return context.getImageData(0, 0, canvas.width, canvas.height).data; });
   let difference = 0; for (let i = 0; i < pixels[0].length; i++) if (i % 4 !== 3) difference += Math.abs(pixels[0][i] - pixels[1][i]);
   result.push({ name: names[index], width: bounds.width, height: bounds.height, meanDifference: difference / (pixels[0].length * .75), original: images[0].src, optimized: images[1].src });
  }
  return result;
 });
 expect(report).toHaveLength(5); for (const image of report) { expect(image.height).toBeGreaterThan(100); expect(image.meanDifference).toBeLessThan(4); }
 await page.locator('[data-velvet-reign]').screenshot({ path: proof + '/velvet-optimized.png' });
 await page.evaluate(async report => { const images = [...document.querySelectorAll<SVGImageElement>('.vr-held-star [data-velvet-portrait]')]; images.forEach((image, index) => image.setAttribute('href', report[index].original)); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }, report);
 await page.locator('[data-velvet-reign]').screenshot({ path: proof + '/velvet-original.png' });
 await writeFile(proof + '/velvet-comparison.json', JSON.stringify(report, null, 2));
});
