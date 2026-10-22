import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const catImages: Record<string, string> = JSON.parse(readFileSync('src/game/catImages.json', 'utf8'));

// Inspect the existing diagnostics closure without adding a production mutation API.
async function captureRoom(page: Page) {
 const debuggerSession = await page.context().newCDPSession(page);
 try {
  const name = await page.evaluate(() => (window as any).royalDemo.getState.toString().match(/=>\s*([\w$]+)\.getState\(/)?.[1]);
  const method = await debuggerSession.send('Runtime.evaluate', { expression: 'window.royalDemo.getState' });
  const properties = await debuggerSession.send('Runtime.getProperties', { objectId: method.result.objectId! });
  const scopes = properties.internalProperties?.find(property => property.name === '[[Scopes]]')?.value?.objectId;
  if (!scopes || !name) throw Error('Hall diagnostics closure was not found');
  const scopeList = await debuggerSession.send('Runtime.getProperties', { objectId: scopes });
  for (const scope of scopeList.result) {
   if (!scope.value?.objectId) continue;
   const variables = await debuggerSession.send('Runtime.getProperties', { objectId: scope.value.objectId });
   const room = variables.result.find(variable => variable.name === name)?.value?.objectId;
   if (!room) continue;
   await debuggerSession.send('Runtime.callFunctionOn', { objectId: room, functionDeclaration: 'function(){ window.__startupRoom = this; }' });
   return;
  }
  throw Error('Existing hall scene was not found');
 } finally { await debuggerSession.detach(); }
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
 test(`hall and chat become usable before cat artwork at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [], requests: string[] = [], writes: string[] = [];
  const catPaths = Object.values(catImages).filter(path => path !== catImages.portrait);
  let releaseCats!: () => void;
  const catsGate = new Promise<void>(resolve => { releaseCats = resolve; });
  let heldCats = 0;
  page.on('pageerror', error => errors.push(error.message));
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === origin) requests.push(url.pathname); });
  await page.route('**/api/**', route => {
   if (!['GET', 'HEAD'].includes(route.request().method())) writes.push(route.request().url());
   if (new URL(route.request().url()).pathname === '/api/auth/me') return route.fulfill({ json: { account: null } });
   return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
  });
  await page.route('**/assets/cat/optimized/**', async route => {
   if (catPaths.includes(new URL(route.request().url()).pathname)) { heldCats++; await catsGate; }
   await route.continue().catch(() => undefined);
  });
  try {
   await page.goto('/', { waitUntil: 'domcontentloaded' });
   await expect(page.locator('#loading')).toHaveCount(0);
   await expect(page.locator('#join-dialog')).toBeVisible();
   await expect(page.locator('#login-step')).toBeVisible();
   await expect(page.locator('#chat-panel')).toBeAttached();
   await expect(page.locator('.workspace')).toHaveClass(/with-chat/);
   expect(heldCats).toBe(0);
   await captureRoom(page);
   const initial = await page.evaluate(() => {
    const room = (window as any).__startupRoom;
    (window as any).__startupPlayer = room.player.sprite;
    const latest = { ...room.getState().cat, hall: 'arcade', x: 740, y: 540, mood: 'scratching', moving: false, surfaceId: '', carriedBy: '' };
    room.catRoutine.snapshot = () => latest;
    room.syncCat(latest);
    document.querySelector<HTMLDialogElement>('#join-dialog')!.close();
    return { catPresent: Boolean(room.catRenderer) };
   });
   expect(initial).toEqual({ catPresent: false });
   await expect.poll(() => heldCats).toBe(1);
   const cancelled = page.waitForEvent('requestfailed', request => catPaths.includes(new URL(request.url()).pathname));
   await page.evaluate(() => (window as any).__startupRoom.deferDecorations(700));
   await cancelled;
   await page.waitForTimeout(350);
   expect(heldCats).toBe(1);
   const initialMedia = requests.filter(path => /\.(?:webp|png|jpe?g|svg)$/.test(path));
   expect(initialMedia.filter(path => path.startsWith('/assets/') && !path.startsWith('/assets/startup-previews/') && !path.startsWith('/assets/cat/optimized/'))).toEqual([]);
   expect(requests).not.toContain('/assets/mira/animation-atlas.png');
   expect(requests).not.toContain('/assets/mira/portrait-haughty.jpg');
   releaseCats();
   await page.waitForFunction(() => Boolean((window as any).__startupRoom.catRenderer));
   const loaded = await page.evaluate(() => {
    const room = (window as any).__startupRoom, cat = room.children.getByName('cat');
    return {
     samePlayer: room.player.sprite === (window as any).__startupPlayer,
     cat: { texture: cat.texture.key, frame: cat.frame.name, x: cat.x },
     frames: ['zverochka', 'zverochka-habits', 'zverochka-climb', 'zverochka-scratch', 'zverochka-walk-v3']
      .map(key => room.textures.get(key).getFrameNames().length),
    };
   });
   expect(loaded).toEqual({ samePlayer: true, cat: { texture: 'zverochka-scratch', frame: '0', x: 740 }, frames: [20, 12, 4, 4, 32] });
   await expect(page.locator('#join-dialog')).toHaveCount(1);
   await expect(page.locator('.chat-dock')).toHaveCount(1);
   if (viewport.width === 1440) {
    const portrait = await page.evaluate(async () => {
     const original = new Image(), portrait = document.querySelector<HTMLImageElement>('.cat-profile img')!;
     original.src = '/assets/cat/zverochka-atlas.png';
     await original.decode(); await portrait.decode();
     const source = document.createElement('canvas'), target = document.createElement('canvas');
     source.width = target.width = 209; source.height = target.height = 290;
     const a = source.getContext('2d')!, b = target.getContext('2d')!;
     a.fillStyle = b.fillStyle = '#342f2a'; a.fillRect(0, 0, 209, 290); b.fillRect(0, 0, 209, 290);
     a.drawImage(original, 342, 1066, 209, 290, 0, 0, 209, 290); b.drawImage(portrait, 0, 0);
     const x = a.getImageData(0, 0, 209, 290).data, y = b.getImageData(0, 0, 209, 290).data;
     const differences = Array.from(x, (value, index) => Math.abs(value - y[index]));
     return { width: portrait.naturalWidth, height: portrait.naturalHeight, identical: x.every((value, index) => value === y[index]),
      mismatched: differences.filter(value => value !== 0).length, maximumDifference: differences.reduce((maximum, value) => Math.max(maximum, value), 0), alphaDifferences: differences.filter((value, index) => index % 4 === 3 && value !== 0).length };
    });
    console.log('Portrait browser comparison', portrait);
    expect(portrait).toMatchObject({ width: 209, height: 290, alphaDifferences: 0 });
    expect(portrait.maximumDifference).toBeLessThanOrEqual(1);
   }
   await page.evaluate(() => { const dialog = document.querySelector<HTMLDialogElement>('#join-dialog')!; if (dialog.open) dialog.close(); });
   await page.locator('#visit-bar').click();
   await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 20000 });
   await expect.poll(() => requests.filter(path => path === '/assets/mira/animation-atlas.png').length).toBe(1);
   await expect.poll(() => requests.filter(path => path === '/assets/mira/portrait-haughty.jpg').length).toBe(1);
   await page.locator('#bar-dialog .mira-leave').click();
   await page.locator('#visit-bar').click();
   await expect(page.locator('#bar-dialog')).toBeVisible();
   expect(requests.filter(path => path === '/assets/mira/animation-atlas.png')).toHaveLength(1);
   expect(requests.filter(path => path === '/assets/mira/portrait-haughty.jpg')).toHaveLength(1);
   expect(writes).toEqual([]);
   expect(errors).toEqual([]);
   await page.screenshot({ path: `artifacts/fast-entry-proof/startup-${viewport.width}.png` });
  } finally { releaseCats(); }
 });
}
