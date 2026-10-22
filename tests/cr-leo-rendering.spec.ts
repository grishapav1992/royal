import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/cr-leo-rendering.html');
  await page.waitForFunction(() => (window as any).crLeoRendering?.ready());
});

test('the ball cannot paint over an opaque boot during contact or follow-through', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { scene, render } = (window as any).crLeoRendering;
    const canvas = document.querySelector<HTMLCanvasElement>('#scene')!, ctx = canvas.getContext('2d')!;
    // A solid boot silhouette makes the overlap pixel unambiguous for both kicking feet.
    const boot = document.createElement('canvas'); boot.width = boot.height = 32;
    const c = boot.getContext('2d')!; c.fillStyle = '#ff6c18'; c.fillRect(0, 0, 32, 32);
    const results = [];
    for (const hero of ['cr', 'leo']) {
      const frames = scene.frames.get(hero), original = [...frames];
      for (let i = 0; i < 8; i++) frames[i] = { image: boot, x: 0, y: 0, width: 1, height: 1 };
      for (const risk of ['safe', 'sharp', 'extreme']) for (const t of [1.119, 1.12, 1.13, 1.16, 1.24, 1.26]) {
        const data = render({ hero, risk, t, zone: 7 });
        const x = canvas.width / 2, y = canvas.height * (risk === 'safe' ? .8 : risk === 'sharp' ? .83 : .85);
        const pixel = [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
        results.push({ hero, risk, t, layer: data.ballLayer, count: data.ballDraws, pixel });
      }
      scene.frames.set(hero, original);
    }
    return results;
  });
  for (const frame of results) {
    expect(frame.layer, JSON.stringify(frame)).toBe('behind-player');
    expect(frame.count).toBe('1');
    expect(frame.pixel[0], JSON.stringify(frame)).toBeGreaterThan(180);
    expect(frame.pixel[1]).toBeLessThan(115);
    expect(frame.pixel[2]).toBeLessThan(40);
  }
});

test('real sprites keep one ball, wall occlusion and goal occlusion across shot outcomes and viewport sizes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 860 });
    const frames = await page.evaluate(() => {
      const { render } = (window as any).crLeoRendering, results = [];
      for (const hero of ['cr', 'leo']) for (const risk of ['safe', 'sharp', 'extreme']) for (const finish of ['goal', 'save', 'post', 'wide']) {
        const end = risk === 'safe' ? 1.7 : risk === 'sharp' ? 2.12 : 2.5;
        for (const t of [1.1, 1.12, 1.16, 1.26, end - .1, end + .01]) {
          const data = render({ hero, risk, finish, t, zone: 0 });
          results.push({ hero, risk, finish, t, count: data.ballDraws, layer: data.ballLayer, radius: Number(data.ballRadius), held: data.ballHeld });
        }
      }
      return results;
    });
    for (const frame of frames) {
      expect(frame.count, JSON.stringify(frame)).toBe('1');
      expect(frame.radius).toBeGreaterThanOrEqual(5.5);
      if (frame.t <= 1.26) expect(frame.layer).toBe('behind-player');
      if (frame.risk !== 'safe' && frame.t > 1.7) expect(['behind-wall', 'behind-goal']).toContain(frame.layer);
    }
  }
  expect(errors).toEqual([]);
});

test('football has contrasting panels and remains round while spinning', async ({ page }) => {
  const rotations = await page.evaluate(() => {
    const { drawFootball } = (window as any).crLeoRendering;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 132;
    const c = canvas.getContext('2d')!, results = [];
    for (const angle of Array.from({ length: 16 }, (_, i) => i * Math.PI * 2 / 16)) {
      c.clearRect(0, 0, 132, 132); drawFootball(c, 66, 66, 60, angle);
      const pixels = c.getImageData(0, 0, 132, 132).data;
      let dark = 0, light = 0, outside = 0, green = 0, orange = 0;
      for (let y = 0; y < 132; y++) for (let x = 0; x < 132; x++) {
        const i = (y * 132 + x) * 4, distance = Math.hypot(x - 65.5, y - 65.5);
        if (distance < 55 && pixels[i + 3] > 250) {
          if (pixels[i] < 95) dark++; if (pixels[i] > 190) light++;
          if (pixels[i + 1] > 130 && pixels[i + 1] > pixels[i] * 1.12 && pixels[i + 1] > pixels[i + 2] * 1.05) green++;
          if (pixels[i] > 140 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i + 1] > pixels[i + 2] * 1.2) orange++;
        }
        if (distance > 63 && pixels[i + 3]) outside++;
      }
      results.push({ angle, dark, light, outside, green, orange });
    }
    return results;
  });
  for (const frame of rotations) {
    expect(frame.dark).toBeGreaterThan(1000); expect(frame.light).toBeGreaterThan(2500); expect(frame.outside).toBe(0);
    expect(frame.green).toBeGreaterThan(100);
  }
  expect(rotations.reduce((sum, frame) => sum + frame.orange, 0)).toBeGreaterThan(300);
});

test('sub-frame rotation changes the surface smoothly without changing fade opacity', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { drawFootball, render } = (window as any).crLeoRendering;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!, hashes = [], alpha = [];
    for (const rotation of [0, .03, .06, .09]) {
      c.clearRect(0, 0, 128, 128); drawFootball(c, 64, 64, 60, rotation, .5);
      const pixels = c.getImageData(0, 0, 128, 128).data;
      let hash = 0; for (const byte of pixels) hash = (hash * 31 + byte) | 0;
      hashes.push(hash); alpha.push(pixels[(64 * 128 + 64) * 4 + 3]);
    }
    return { hashes, alpha, before: render({ hero: 'cr', risk: 'safe', t: 1.1 }).ballRotation,
      right: render({ hero: 'cr', risk: 'safe', t: 1.3 }).ballRotation,
      left: render({ hero: 'leo', risk: 'safe', t: 1.3 }).ballRotation };
  });
  expect(new Set(result.hashes).size).toBe(4);
  expect(result.alpha.every(value => value >= 127 && value <= 129)).toBe(true);
  expect(Number(result.before)).toBe(0); expect(Number(result.right)).toBeGreaterThan(0);
  expect(Number(result.left)).toBe(-Number(result.right));
});

test('the built game loads through the shared host and reopens with both heroes and all shot types', async ({ page }) => {
  const errors: string[] = [], failures: string[] = [], ballRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = resolve('module-dist');
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
  await page.route('**/game-modules/**', async route => {
    const pathname = new URL(route.request().url()).pathname.replace('/game-modules/', '');
    const file = resolve(root, pathname);
    if (!file.startsWith(root + sep)) throw Error('Unexpected module path');
    await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] });
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Isolated visual check' } }));
  page.on('response', response => { if (response.url().includes('/game-modules/') && !response.ok()) failures.push(response.url()); });
  page.on('request', request => { if (request.url().includes('/game-modules/') && request.url().includes('ball-ordem-v-atlas')) ballRequests.push(request.url()); });
  await page.goto('/tests/fixtures/independent-games.html');
  await page.waitForFunction(() => !!(window as any).moduleHarness);
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 860 });
    await page.evaluate(() => (window as any).moduleHarness.open('original-cr-vs-leo'));
    const game = page.locator('#primary .cr-leo');
    await expect(game).toHaveAttribute('data-loading', 'false');
    await expect(game.locator('canvas')).toHaveAttribute('data-assets', '10');
    await expect(game.locator('canvas')).toHaveAttribute('data-sprite-frames', '72');
    await expect(page.locator('#primary')).toHaveAttribute('data-game-module-version', /1\.0\.0-[a-f0-9]{12}/);
    for (const hero of ['cr', 'leo']) for (const risk of ['safe', 'sharp', 'extreme']) {
      await game.locator(`button[data-hero="${hero}"]`).click();
      await game.locator(`button[data-risk="${risk}"]`).click();
      await expect(game.locator('canvas')).toHaveAttribute('data-hero', hero);
      await expect(game.locator('canvas')).toHaveAttribute('data-ball-layer', 'behind-player');
      await expect(game.locator('canvas')).toHaveAttribute('data-ball-draws', '1');
    }
    expect(await page.evaluate(() => (window as any).moduleHarness.snapshot())).toMatchObject({ sharedWallet: true, sharedExpansion: true, locked: false });
    await page.evaluate(() => (window as any).moduleHarness.close());
    await expect(page.locator('#primary')).toBeEmpty();
    await expect(page.locator('link[data-royal-game-module]')).toHaveCount(0);
  }
  expect(errors).toEqual([]); expect(failures).toEqual([]); expect(ballRequests).toHaveLength(1);
});
