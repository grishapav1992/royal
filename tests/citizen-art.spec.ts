import { expect, test, type Page } from '@playwright/test';

async function installCitizenRenderer(page: Page) {
  await page.goto('/artifacts/character-roster-detail-v2/render-preview.html');
  await page.evaluate(async () => {
    const { drawCitizen } = await import('/src/game/characters.ts');
    const scale = 6, canvas = document.createElement('canvas');
    canvas.width = 32 * scale; canvas.height = 48 * scale;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    (window as any).citizenArtTest = {
      scale,
      render(skin: number, facing = 'down', frame = 6, seated = false, sip = -1) {
        c.clearRect(0, 0, canvas.width, canvas.height); c.save(); c.scale(scale, scale); c.translate(0, 8);
        drawCitizen(c, skin, facing, frame, seated, sip); c.restore();
        return c.getImageData(0, 0, canvas.width, canvas.height);
      },
    };
  });
}

test('Miles and Archie retain complete glasses around both eyes in every unoccluded expression', async ({ page }) => {
  await installCitizenRenderer(page);
  const failures = await page.evaluate(() => {
    const { render, scale } = (window as any).citizenArtTest;
    const failures: string[] = [];
    const glasses = [{ skin: 7, name: 'Майлз', color: [115, 80, 65] }, { skin: 8, name: 'Арчи', color: [50, 95, 120] }];
    for (const person of glasses) for (const facing of ['down', 'left', 'right']) {
      for (const frame of [6, 7, 8, 9, 23, 24, 28, 30, 34, 36, 40, 42, 45]) {
        // A losing profile raises the hand over the lens and legitimately occludes its outline.
        if (facing !== 'down' && frame >= 40) continue;
        const image = render(person.skin, facing, frame);
        const { width, data } = image;
        // Only the head region is considered; garment pockets can also have closed outlines.
        const height = Math.floor(34 * scale);
        const mask = new Uint8Array(width * height), seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
        for (let pixel = 0; pixel < mask.length; pixel++) {
          const index = pixel * 4;
          const distance = person.color.reduce((sum, value, channel) => sum + (value - data[index + channel]) ** 2, 0);
          if (data[index + 3] > 180 && distance <= 12 ** 2) mask[pixel] = 1;
        }
        let enclosedLenses = 0;
        for (let start = 0; start < mask.length; start++) {
          if (mask[start] || seen[start]) continue;
          let head = 0, tail = 1, touchesEdge = false, white = 0; queue[0] = start; seen[start] = 1;
          while (head < tail) {
            const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width), index = pixel * 4;
            if (!x || x === width - 1 || !y || y === height - 1) touchesEdge = true;
            if (data[index] > 230 && data[index + 1] > 230 && data[index + 2] > 210 && data[index + 3] > 200) white++;
            for (const next of [x ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, pixel - width, pixel + width]) {
              if (next < 0 || next >= mask.length || mask[next] || seen[next]) continue;
              seen[next] = 1; queue[tail++] = next;
            }
          }
          const openExpression = ![8, 34, 36].includes(frame);
          if (!touchesEdge && tail > 20 * scale ** 2 && (!openExpression || white > 3 * scale ** 2)) enclosedLenses++;
        }
        const expected = facing === 'down' ? 2 : 1;
        if (enclosedLenses < expected) failures.push(`${person.name}, ${facing}, frame=${frame}: ${enclosedLenses}/${expected} complete lens frames`);
      }
    }
    return failures;
  });
  expect(failures, 'Each visible lens must have an unbroken frame, including the upper arc below a hat.').toEqual([]);
});
