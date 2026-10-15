import { expect, test } from '@playwright/test';

test('every hat covers the crown of the skull across all head shapes and turns', async ({ page }) => {
  await page.goto('/artifacts/customization-rework/render-preview.html');
  const failures = await page.evaluate(async () => {
    const { drawAvatar } = await import('/src/game/avatarArt.ts');
    const { DEFAULT_APPEARANCE, SKIN_COLORS } = await import('/src/shared/appearance.ts');
    const scale = 8, canvas = document.createElement('canvas'); canvas.width = 32 * scale; canvas.height = 48 * scale;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    const failures: string[] = [];
    const skin = SKIN_COLORS[DEFAULT_APPEARANCE.skinTone].slice(1).match(/../g)!.map(value => parseInt(value, 16));
    const isSkin = (data: Uint8ClampedArray, index: number) => data[index + 3] > 250 && skin.every((value, channel) => Math.abs(data[index + channel] - value) <= 2);
    const render = (body: number, hat: number, facing: 'down' | 'right' | 'left' | 'up') => {
      c.clearRect(0, 0, canvas.width, canvas.height); c.save(); c.scale(scale, scale); c.translate(0, 8);
      drawAvatar(c, { ...DEFAULT_APPEARANCE, body, hair: 7, hat }, facing, 6); c.restore();
      return c.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    for (const body of [0, 1, 2]) for (const facing of ['down', 'right', 'left', 'up'] as const) {
      const bare = render(body, 0, facing);
      let scalpTop = canvas.height;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (isSkin(bare, (y * canvas.width + x) * 4)) scalpTop = Math.min(scalpTop, y);
      }
      for (const hat of [1, 2, 3, 4, 5, 6]) {
        const fitted = render(body, hat, facing);
        let exposed = 0;
        for (let y = scalpTop; y < scalpTop + 3 * scale; y++) for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          if (isSkin(bare, index) && isSkin(fitted, index)) exposed++;
        }
        if (exposed > 4) failures.push(`body=${body}, hat=${hat}, ${facing}: ${exposed} uncovered scalp pixels`);
      }
    }
    return failures;
  });
  expect(failures, 'A fitted hat should cover the upper scalp instead of leaving a skin crescent above it.').toEqual([]);
});

test('a drink in front of a rear-facing character stays behind the head', async ({ page }) => {
  await page.goto('/artifacts/customization-rework/render-preview.html');
  const failures = await page.evaluate(async () => {
    const { drawAvatar } = await import('/src/game/avatarArt.ts');
    const { DEFAULT_APPEARANCE, SKIN_COLORS } = await import('/src/shared/appearance.ts');
    const scale = 8, canvas = document.createElement('canvas'); canvas.width = 32 * scale; canvas.height = 48 * scale;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    const failures: string[] = [];
    const skin = SKIN_COLORS[DEFAULT_APPEARANCE.skinTone].slice(1).match(/../g)!.map(value => parseInt(value, 16));
    const isSkin = (data: Uint8ClampedArray, index: number) => data[index + 3] > 250 && skin.every((value, channel) => Math.abs(data[index + channel] - value) <= 2);
    const render = (body: number, top: number, seated: boolean, sip: number) => {
      c.clearRect(0, 0, canvas.width, canvas.height); c.save(); c.scale(scale, scale); c.translate(0, 8);
      drawAvatar(c, { ...DEFAULT_APPEARANCE, body, top, hair: 7 }, 'up', 6, seated, sip); c.restore();
      return c.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    for (const body of [0, 1, 2]) for (const top of [0, 1, 4]) for (const seated of [false, true]) {
      // Long sleeves exclude the upper arm from the skin mask used to isolate the skull.
      const bare = render(body, 1, seated, -1);
      for (const sip of [2, 3]) {
        const drinking = render(body, top, seated, sip);
        let pastedOnHead = 0;
        for (let y = 0; y < (8 + 25) * scale; y++) for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          if (isSkin(bare, index) && !isSkin(drinking, index)) pastedOnHead++;
        }
        if (pastedOnHead > 4) failures.push(`body=${body}, top=${top}, seated=${seated}, sip=${sip}: ${pastedOnHead} pixels over the rear skull`);
      }
    }
    return failures;
  });
  expect(failures, 'The cup and drinking hand should be occluded by the rear skull.').toEqual([]);
});
