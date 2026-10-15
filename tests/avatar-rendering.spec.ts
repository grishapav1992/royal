import { expect, test, type Page } from '@playwright/test';
import type { Appearance } from '../src/shared/appearance';
import type { Facing } from '../src/shared/movement';

type RenderHarness = {
  appearance: Appearance;
  options: Record<keyof Omit<Appearance, 'version'>, readonly string[]>;
  render: (appearance: Appearance, facing?: Facing, frame?: number, seated?: boolean, sip?: number) => ImageData;
  crop: (pixels: ImageData, x: number, y: number, width: number, height: number) => string;
  bounds: (pixels: ImageData) => { left: number; top: number; right: number; bottom: number; count: number };
};

declare global {
  interface Window { avatarRenderTest: RenderHarness }
}

async function loadRenderer(page: Page) {
  await page.goto('/artifacts/customization-rework/render-preview.html');
  await page.evaluate(async () => {
    const { drawAvatar } = await import('/src/game/avatarArt.ts');
    const { DEFAULT_APPEARANCE, APPEARANCE_OPTIONS } = await import('/src/shared/appearance.ts');
    const scale = 4, margin = 4;
    const canvas = document.createElement('canvas');
    canvas.width = (32 + margin * 2) * scale;
    canvas.height = (48 + margin * 2) * scale;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    window.avatarRenderTest = {
      appearance: DEFAULT_APPEARANCE,
      options: APPEARANCE_OPTIONS,
      render(appearance, facing = 'down', frame = 6, seated = false, sip = -1) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save(); context.scale(scale, scale); context.translate(margin, margin + 8);
        drawAvatar(context, appearance, facing, frame, seated, sip);
        context.restore();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      },
      crop(pixels, x, y, width, height) {
        const result: number[] = [];
        for (let py = (y + margin + 8) * scale; py < (y + margin + 8 + height) * scale; py++) {
          const start = (py * pixels.width + (x + margin) * scale) * 4;
          result.push(...pixels.data.subarray(start, start + width * scale * 4));
        }
        return result.join(',');
      },
      bounds(pixels) {
        let left = pixels.width, top = pixels.height, right = -1, bottom = -1, count = 0;
        for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
          if (pixels.data[(y * pixels.width + x) * 4 + 3] < 8) continue;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
        }
        return { left: left / scale - margin, top: top / scale - margin - 8, right: (right + 1) / scale - margin, bottom: (bottom + 1) / scale - margin - 8, count };
      },
    };
  });
}

test('every catalog choice stays inside its atlas cell across builds, turns and extreme poses', async ({ page }) => {
  test.setTimeout(120_000);
  await loadRenderer(page);
  const result = await page.evaluate(() => {
    const { appearance, options, render, bounds } = window.avatarRenderTest;
    const failures: string[] = [];
    let checked = 0;
    const frames = [0, 1, 4, 6, 30, 34, 36, 40, 42, 45];
    for (const [field, choices] of Object.entries(options)) for (let value = 0; value < choices.length; value++) {
      for (const body of [0, 1, 2]) for (const facing of ['down', 'left', 'right', 'up'] as const) for (const frame of frames) {
        const pixels = render({ ...appearance, [field]: value, body }, facing, frame);
        const box = bounds(pixels); checked++;
        if (!box.count || box.left <= 0 || box.right >= 32 || box.top <= -8 || box.bottom >= 40) {
          if (failures.length < 24) failures.push(`${field}=${value}, body=${body}, ${facing}, frame=${frame}: ${JSON.stringify(box)}`);
        }
      }
    }
    return { checked, failures };
  });
  expect(result.checked).toBeGreaterThan(10_000);
  expect(result.failures, 'Visible elements need a transparent border so atlas clipping cannot cut their silhouettes.').toEqual([]);
});

test('hats cover the crown of every short hairstyle in every build and direction', async ({ page }) => {
  await loadRenderer(page);
  const failures = await page.evaluate(() => {
    const { appearance, options, render, crop } = window.avatarRenderTest;
    const failures: string[] = [];
    for (let hat = 1; hat < options.hat.length; hat++) for (const body of [0, 1, 2]) {
      for (const facing of ['down', 'left', 'right', 'up'] as const) {
        const bald = crop(render({ ...appearance, hat, body, hair: 7 }, facing), 0, -8, 32, 14);
        for (const hair of [0, 3, 4, 5, 6]) {
          const covered = crop(render({ ...appearance, hat, body, hair }, facing), 0, -8, 32, 14);
          if (covered !== bald) failures.push(`hat=${hat}, hair=${hair}, body=${body}, ${facing}`);
        }
      }
    }
    return failures;
  });
  expect(failures, 'The hat crown should not change when hidden hair is selected.').toEqual([]);
});

test('rear views hide front face features, makeup, glasses and cheek tattoos', async ({ page }) => {
  await loadRenderer(page);
  const failures = await page.evaluate(() => {
    const { appearance, options, render, crop } = window.avatarRenderTest;
    const fields = ['eyes', 'eyebrows', 'mouth', 'facialHair', 'makeup', 'makeupColor'] as const;
    const failures: string[] = [];
    for (const body of [0, 1, 2]) for (const frame of [6, 8, 23, 30, 36, 42]) {
      const base = { ...appearance, body, hair: 7 };
      const reference = crop(render(base, 'up', frame), 0, -8, 32, 48);
      for (const field of fields) for (let value = 0; value < options[field].length; value++) {
        if (crop(render({ ...base, [field]: value }, 'up', frame), 0, -8, 32, 48) !== reference) failures.push(`${field}=${value}, body=${body}, frame=${frame}`);
      }
      const head = crop(render(base, 'up', frame), 10, -8, 12, 25);
      for (let glasses = 1; glasses < options.glasses.length; glasses++) {
        if (crop(render({ ...base, glasses }, 'up', frame), 10, -8, 12, 25) !== head) failures.push(`Rear lenses: glasses=${glasses}, body=${body}, frame=${frame}`);
      }
      for (const tattoo of [1, 2, 5]) {
        if (crop(render({ ...base, tattoo }, 'up', frame), 0, -8, 32, 48) !== reference) failures.push(`tattoo=${tattoo}, body=${body}, frame=${frame}`);
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('makeup changes exposed faces while preserving clothing and the foot anchor', async ({ page }) => {
  await loadRenderer(page);
  const failures = await page.evaluate(() => {
    const { appearance, options, render, crop, bounds } = window.avatarRenderTest;
    const failures: string[] = [];
    for (const body of [0, 1, 2]) for (const facing of ['down', 'left', 'right'] as const) {
      const base = { ...appearance, body, hair: 7, makeup: 0 };
      const bare = render(base, facing);
      const bareFace = crop(bare, 0, -8, 32, 34);
      const clothing = crop(bare, 0, 26, 32, 14);
      const ground = bounds(bare).bottom;
      for (let makeup = 1; makeup < options.makeup.length; makeup++) {
        const painted = render({ ...base, makeup }, facing);
        if (crop(painted, 0, -8, 32, 34) === bareFace) failures.push(`Invisible makeup=${makeup}, body=${body}, ${facing}`);
        if (crop(painted, 0, 26, 32, 14) !== clothing) failures.push(`Makeup changes clothing: makeup=${makeup}, body=${body}, ${facing}`);
        if (bounds(painted).bottom !== ground) failures.push(`Makeup changes the foot anchor: makeup=${makeup}, body=${body}, ${facing}`);
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('head, clothing and feet remain connected in seated and game poses', async ({ page }) => {
  test.setTimeout(90_000);
  await loadRenderer(page);
  const failures = await page.evaluate(() => {
    const { appearance, render } = window.avatarRenderTest;
    const failures: string[] = [];
    for (const body of [0, 1, 2]) for (const facing of ['down', 'left', 'right', 'up'] as const) {
      for (const top of [0, 1, 2, 3, 4, 5]) for (const bottom of [0, 1, 2]) {
        for (const [frame, seated, sip] of [[6, true, -1], [6, false, 2], [30, true, -1], [36, true, -1], [42, true, -1]] as const) {
          const pixels = render({ ...appearance, body, top, bottom, hair: 0, hat: 0 }, facing, frame, seated, sip);
          const { width, height, data } = pixels;
          const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
          let fullTop = height, fullBottom = -1, largest = { count: 0, top: height, bottom: -1 };
          for (let start = 0; start < seen.length; start++) {
            if (seen[start] || data[start * 4 + 3] < 64) continue;
            let head = 0, tail = 1, minY = height, maxY = -1; queue[0] = start; seen[start] = 1;
            while (head < tail) {
              const at = queue[head++], x = at % width, y = Math.floor(at / width);
              minY = Math.min(minY, y); maxY = Math.max(maxY, y);
              for (const next of [x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1, at - width, at + width]) {
                if (next < 0 || next >= seen.length || seen[next] || data[next * 4 + 3] < 64) continue;
                seen[next] = 1; queue[tail++] = next;
              }
            }
            fullTop = Math.min(fullTop, minY); fullBottom = Math.max(fullBottom, maxY);
            if (tail > largest.count) largest = { count: tail, top: minY, bottom: maxY };
          }
          if (largest.top > fullTop + 1 || largest.bottom < fullBottom - 1) {
            if (failures.length < 20) failures.push(`body=${body}, top=${top}, bottom=${bottom}, ${facing}, frame=${frame}, sip=${sip}: detached silhouette`);
          }
        }
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('the full preview keeps tall hats inside the canvas when celebrating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/artifacts/customization/editor-preview.html');
  await page.getByRole('button', { name: 'Телосложение: Длинный', exact: true }).click();
  await page.getByRole('tab', { name: 'Аксессуары', exact: true }).click();
  await page.getByRole('button', { name: 'Головной убор: Шапка с помпоном', exact: true }).click();
  for (const pose of ['idle', 'walk', 'win', 'lose']) {
    await page.getByLabel('Поза персонажа', { exact: true }).selectOption(pose);
    for (const direction of ['Спереди', 'Слева', 'Сзади', 'Справа']) {
      await page.getByRole('button', { name: direction, exact: true }).click();
      const touchesEdge = await page.locator('.character-stage canvas').evaluate(node => {
        const canvas = node as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if ((x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) && data[(y * canvas.width + x) * 4 + 3]) return true;
        }
        return false;
      });
      expect(touchesEdge, `${pose}, ${direction}: preview clips the outfit`).toBe(false);
    }
  }
});
