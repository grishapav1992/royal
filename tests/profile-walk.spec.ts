import { test, expect } from '@playwright/test';

test('every profile pose keeps hands and shoes connected for NPCs and standard outfits', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/profile-walk.html');
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
    for (const [index, sample] of samples.entries()) for (const facing of ['left', 'right']) for (let frame = 0; frame <= 6; frame++) {
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
