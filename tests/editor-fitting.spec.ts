import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: object) {
      return Reflect.apply(original, this, [contextId, contextId === '2d' ? { ...options, willReadFrequently: true } : options]);
    } as typeof original;
  });
  await page.goto('/artifacts/customization-rework/render-preview.html');
});

test('the preview keeps the same camera, proportions and foot anchor when changing builds and poses', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { CharacterEditor } = await import('/src/ui/CharacterEditor.ts');
    const { DEFAULT_APPEARANCE } = await import('/src/shared/appearance.ts');
    const editor = new CharacterEditor('fitting-camera');
    document.body.append(editor.element);
    const canvas = editor.element.querySelector<HTMLCanvasElement>('.character-stage canvas')!;
    const pose = editor.element.querySelector<HTMLSelectElement>('.preview-pose')!;
    const views = new Set<string>(), dimensions = new Set<string>();
    const failures: string[] = [];
    const footRow = () => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let y = canvas.height - 1; y >= 0; y--) {
        for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] >= 64) return y;
      }
      return -1;
    };
    for (const body of [0, 1, 2]) {
      let ground = -1;
      for (const action of ['idle', 'walk', 'sit', 'drink', 'game', 'win', 'lose']) {
        editor.value = { ...DEFAULT_APPEARANCE, body, hat: 1, gender: 0 };
        pose.value = action;
        pose.dispatchEvent(new Event('change'));
        const before = canvas.toDataURL(), row = footRow();
        if (ground < 0) ground = row;
        if (Math.abs(row - ground) > 1) failures.push(`body=${body}, ${action}: foot anchor moved from ${ground} to ${row}`);
        views.add(canvas.dataset.previewView!);
        dimensions.add(`${canvas.width}x${canvas.height}`);
        editor.value = { ...editor.value, gender: 1 };
        if (canvas.toDataURL() !== before) failures.push(`body=${body}, ${action}: gender changed proportions`);
      }
    }
    return { views: [...views], dimensions: [...dimensions], failures };
  });
  expect(result.views, 'Changing the outfit or pose must not resize the camera.').toHaveLength(1);
  expect(result.dimensions).toEqual(['640x800']);
  expect(result.failures).toEqual([]);
});

test('choice cards show each item with the hats, hair and clothing actually worn', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { CharacterEditor } = await import('/src/ui/CharacterEditor.ts');
    const { DEFAULT_APPEARANCE } = await import('/src/shared/appearance.ts');
    const { drawAvatar } = await import('/src/game/avatarArt.ts');
    const editor = new CharacterEditor('fitting-outfit');
    document.body.append(editor.element);
    const appearance = { ...DEFAULT_APPEARANCE, body: 2, hair: 2, hat: 4, glasses: 3, facialHair: 2, earrings: 3, top: 4, scarf: 1, necklace: 3, tattoo: 3 };
    editor.value = appearance;
    const reference = (card: HTMLCanvasElement, sample: typeof appearance) => {
      const [x, y, width, height] = JSON.parse(card.dataset.previewView!) as [number, number, number, number];
      const canvas = document.createElement('canvas');
      canvas.width = card.width; canvas.height = card.height;
      const context = canvas.getContext('2d')!;
      const scale = Math.min(canvas.width / width, canvas.height / height);
      context.setTransform(scale, 0, 0, scale, (canvas.width - width * scale) / 2 - x * scale, (canvas.height - height * scale) / 2 - y * scale);
      if (sample.body === 2) { context.translate(0, 39.5); context.scale(1, 1.12); context.translate(0, -39.5); }
      drawAvatar(context, sample, 'down', 6);
      return canvas.toDataURL();
    };
    const tabs = [...editor.element.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    const cases = [
      ['Волосы', 'hair', [0, 2, 5]],
      ['Аксессуары', 'glasses', [0, 1, 4]],
      ['Аксессуары', 'earrings', [0, 3]],
      ['Аксессуары', 'necklace', [0, 2]],
      ['Одежда', 'top', [0, 1, 4]],
      ['Одежда', 'bottom', [0, 1, 2]],
      ['Тату', 'tattoo', [3, 4]],
    ] as const;
    const failures: string[] = [];
    let checked = 0;
    for (const [category, field, values] of cases) {
      tabs.find(tab => tab.textContent === category)!.click();
      for (const value of values) {
        const card = editor.element.querySelector<HTMLCanvasElement>(`[data-field="${field}"] button[data-value="${value}"] canvas`)!;
        if (card.toDataURL() !== reference(card, { ...appearance, [field]: value })) failures.push(`${field}=${value}: another worn item was changed`);
        checked++;
      }
    }
    tabs.find(tab => tab.textContent === 'Аксессуары')!.click();
    const glasses = editor.element.querySelector<HTMLCanvasElement>('[data-field="glasses"] button[data-value="4"] canvas')!;
    const hatIsVisible = reference(glasses, { ...appearance, glasses: 4 }) !== reference(glasses, { ...appearance, glasses: 4, hat: 0 });
    editor.element.querySelector<HTMLButtonElement>('[data-field="glasses"] button[data-value="4"]')!.click();
    const selected = editor.value;
    return { checked, failures, hatIsVisible, selected, expected: { ...appearance, glasses: 4 } };
  });
  expect(result.checked).toBe(18);
  expect(result.hatIsVisible, 'The fixture must expose the hat overlap in the glasses card.').toBe(true);
  expect(result.failures).toEqual([]);
  expect(result.selected).toEqual(result.expected);
});
