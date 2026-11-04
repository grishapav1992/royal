import { test, expect } from '@playwright/test';

test('every walking and resting view keeps hands and shoes connected for NPCs and standard outfits', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/profile-walk.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).profileWalk?.ready);
  const failures = await page.evaluate(() => {
    const { render } = (window as any).profileWalk, failures: string[] = [];
    const samples = [
      ...Array.from({ length: 13 }, (_, skin) => ({ skin })),
      ...Array.from({ length: 3 * 6 * 3 * 3 }, (_, index) => ({ appearance: {
        body: Math.floor(index / 54), top: Math.floor(index / 9) % 6, bottom: Math.floor(index / 3) % 3, shoes: index % 3,
        hair: index % 8, hat: index % 7, tattoo: index % 6,
      } })),
    ];
    for (const [index, sample] of samples.entries()) for (const facing of ['down', 'up', 'left', 'right']) for (const frame of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 23, 24]) {
      // Mira has her own dress and working gestures, outside the ordinary visitor renderer.
      if ('skin' in sample && sample.skin === 6) continue;
      const canvas = render(sample, facing, frame), { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const solid = (i: number) => data[i * 4 + 3] > 40;
      const seen = new Uint8Array(width * height), queue = [Math.floor(height * .73) * width + width / 2]; seen[queue[0]] = 1;
      for (let at = 0; at < queue.length; at++) {
        const i = queue[at], x = i % width, y = Math.floor(i / width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !seen[next] && solid(next)) { seen[next] = 1; queue.push(next); }
        }
      }
      let detached = 0, clipped = 0;
      for (let i = width * 100; i < width * height; i++) if (solid(i)) {
        if (!seen[i]) detached++;
        if (i % width === 0 || i % width === width - 1 || i >= width * (height - 1)) clipped++;
      }
      if (detached > 4 || clipped > 0) failures.push(`${index} ${facing} ${frame}: detached=${detached} clipped=${clipped}`);
    }
    return failures;
  });
  expect(failures).toEqual([]); expect(errors).toEqual([]);
});

test('front and rear sleeves blend into the shirt without a pasted-on inner outline', async ({ page }) => {
  await page.goto('/tests/fixtures/profile-walk.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).profileWalk?.ready);
  const failures = await page.evaluate(() => {
    const { render } = (window as any).profileWalk, failures: string[] = [];
    for (const facing of ['down', 'up']) for (const kind of ['npc', 'avatar']) {
      const sample = kind === 'npc' ? { skin: 0 } : { appearance: { top: 2, topColor: 0, hair: 7, hat: 0 } };
      const c = render(sample, facing, 6).getContext('2d'), pixels = c.getImageData(0, 0, 96, 144).data;
      const rgb = kind === 'npc' ? [233, 75, 56] : [217, 84, 68];
      const project = (value: number, pivot: number) => (kind === 'avatar' ? pivot + (value - pivot) * .94 : value) * 1.5;
      let tested = 0, shirt = 0;
      // The covered shoulder lies outside face, hood, buttons and pockets.
      for (let y = Math.ceil(project(57, 76) + 24); y < project(60, 76) + 24; y++) {
        for (let x = Math.ceil(project(16, 32)); x < project(22, 32); x++) {
          const index = (y * 96 + x) * 4; tested++;
          if (pixels[index + 3] > 250 && rgb.every((channel, i) => Math.abs(pixels[index + i] - channel) <= 3)) shirt++;
        }
      }
      if (shirt / tested < .97) failures.push(`${kind} ${facing}: ${shirt}/${tested} shirt pixels at sleeve join`);
    }
    return failures;
  });
  expect(failures).toEqual([]);
});
