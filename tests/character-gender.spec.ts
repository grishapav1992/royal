import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  // Keep pixel comparisons on one rasterizer instead of Chrome switching after canvas reads.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: object) {
      return Reflect.apply(original, this, [contextId, contextId === '2d' ? { ...options, willReadFrequently: true } : options]);
    } as typeof original;
  });
});

test('gender preserves the same body and face in every build and direction', async ({ page }) => {
  await page.goto('/artifacts/customization/editor-preview.html');
  await page.getByRole('tab', { name: 'Аксессуары', exact: true }).click();
  await page.getByRole('button', { name: 'Головной убор: Дуршлаг', exact: true }).click();
  await page.getByRole('button', { name: 'Очки: Солнечные', exact: true }).click();
  await page.getByRole('tab', { name: 'Волосы', exact: true }).click();
  await page.getByRole('button', { name: 'Цвет волос: Синий', exact: true }).click();
  await page.getByRole('tab', { name: 'Основа', exact: true }).click();
  const canvas = page.locator('.character-stage canvas');
  for (const body of ['Стандартный', 'Толстый', 'Длинный']) {
    await page.getByRole('button', { name: `Телосложение: ${body}`, exact: true }).click();
    for (const direction of ['Спереди', 'Слева', 'Сзади', 'Справа']) {
      await page.getByRole('button', { name: direction, exact: true }).click();
      await page.getByRole('button', { name: 'Пол: Мужской', exact: true }).click();
      const before = await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL());
      await page.getByRole('button', { name: 'Пол: Женский', exact: true }).click();
      const after = await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL());
      expect(after, `${body}, ${direction}: gender must preserve the drawing`).toBe(before);
      await expect(page.getByRole('button', { name: `Телосложение: ${body}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
  }
  await page.getByRole('tab', { name: 'Аксессуары', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Головной убор: Дуршлаг', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Очки: Солнечные', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Волосы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Цвет волос: Синий', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('makeup changes the face independently of gender and preserves the body', async ({ page }) => {
  await page.goto('/artifacts/customization/editor-preview.html');
  const canvas = page.locator('.character-stage canvas');
  const crop = (body: boolean) => canvas.evaluate((node, isBody) => {
    const source = node as HTMLCanvasElement;
    const view = JSON.parse(source.dataset.previewView!) as [number, number, number, number];
    const scale = Math.min(source.width / view[2], source.height / view[3]);
    const split = Math.floor((source.height - view[3] * scale) / 2 + (26 - view[1]) * scale);
    const y = isBody ? split : 0, height = isBody ? source.height - split : split;
    const image = document.createElement('canvas'); image.width = source.width; image.height = height;
    image.getContext('2d')!.drawImage(source, 0, y, source.width, height, 0, 0, source.width, height);
    return image.toDataURL();
  }, body);
  const face = () => crop(false), body = () => crop(true);
  for (const direction of ['Спереди', 'Слева', 'Справа']) {
    await page.getByRole('button', { name: direction, exact: true }).click();
    await page.getByRole('tab', { name: 'Лицо', exact: true }).click();
    await page.getByRole('button', { name: 'Макияж: Нет', exact: true }).click();
    const bareFace = await face(), unchangedBody = await body();
    for (const makeup of ['Ресницы', 'Помада', 'Румяна', 'Ресницы и помада', 'Полный']) {
      await page.getByRole('button', { name: `Макияж: ${makeup}`, exact: true }).click();
      expect(await face(), `${makeup} must be visible from ${direction}`).not.toEqual(bareFace);
      expect(await body()).toEqual(unchangedBody);
    }
    const pink = await face();
    await page.getByRole('button', { name: 'Цвет макияжа: Красный', exact: true }).click();
    expect(await face()).not.toEqual(pink);
    const male = await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL());
    await page.getByRole('tab', { name: 'Основа', exact: true }).click();
    await page.getByRole('button', { name: 'Пол: Женский', exact: true }).click();
    expect(await canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(male);
    await page.getByRole('button', { name: 'Пол: Мужской', exact: true }).click();
    await page.getByRole('tab', { name: 'Лицо', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Макияж: Полный', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Цвет макияжа: Красный', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Цвет макияжа: Розовый', exact: true }).click();
  }
});
