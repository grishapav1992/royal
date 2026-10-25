import { test, expect } from '@playwright/test';
import { SKIN_PRICE_UNITS, SKIN_THEME } from '../src/shared/skinStudio';
import sharp from 'sharp';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ids = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
test('two variants, explicit single choice, wardrobe, preview controls and mobile layout', async ({ page }) => {
  let chosen = '', state = 'ready';
  const cards = ids.slice(0, 2).map(id => ({ id, jobId, prompt: 'Космический пират', createdAt: Date.now() }));
  await page.route('**/api/skin-studio**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.includes('/assets/')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><g fill="#bc6351"><circle cx="128" cy="90" r="58"/><rect x="80" y="150" width="96" height="150"/></g></svg>' }); return;
    }
    expect(request.headers()['x-royal-account-id']).toBe(user);
    if (url.pathname.endsWith('/choose')) {
      expect(request.postDataJSON()).toEqual({ jobId, skinId: ids[1] }); chosen = ids[1]; state = 'selected';
    }
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, enabled: true, equippedId: chosen || null,
      job: { id: jobId, prompt: 'Космический пират', state, error: '', selectedId: chosen || null, createdAt: Date.now(), variants: state === 'ready' ? cards : [] }, wardrobe: chosen ? [cards[1]] : [] } });
  });
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await expect(page.locator('.skin-results .skin-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Сохранить образ' })).toBeDisabled();
  await page.getByRole('button', { name: 'Примерить вариант 2' }).click();
  await expect(page.getByRole('button', { name: 'Примерить вариант 2' })).toHaveAttribute('aria-pressed', 'true');
  const floor = page.getByLabel('Площадка для примерки скина');
  await expect(page.locator('.skin-fitting-caption')).toContainText('Вариант 2. Походи');
  await floor.focus();
  await page.keyboard.down('ArrowLeft');
  await expect(floor).toHaveAttribute('data-facing', 'left');
  await expect(floor).toHaveAttribute('data-moving', 'true');
  await page.keyboard.up('ArrowLeft');
  await expect(floor).toHaveAttribute('data-moving', 'false');
  await page.getByRole('button', { name: 'Сесть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Встать', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Встать', exact: true }).click();
  await page.screenshot({ path: 'artifacts/skin-studio/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('#skin-studio-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const box = (await floor.boundingBox())!;
  await floor.click({ position: { x: box.width - 50, y: 230 } });
  await expect(floor).toHaveAttribute('data-facing', 'right');
  await expect(floor).toHaveAttribute('data-moving', 'true');
  await expect(floor).toHaveAttribute('data-moving', 'false', { timeout: 6000 });
  await page.screenshot({ path: 'artifacts/skin-studio/mobile.png' });
  await floor.focus(); await page.keyboard.down('ArrowUp');
  await expect(floor).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: 'Закрыть ателье' }).click();
  await page.keyboard.up('ArrowUp');
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await expect(floor).toHaveAttribute('data-moving', 'false');
  await page.getByRole('button', { name: 'Идти вперёд' }).focus();
  await page.keyboard.press('Enter');
  await expect(floor).toHaveAttribute('data-facing', 'down');
  await page.getByRole('button', { name: 'Сохранить образ' }).click();
  await expect(page.locator('.skin-results')).toBeHidden(); await expect(page.locator('.skin-wardrobe .skin-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Сейчас надет' })).toBeDisabled();
});

test('lost creation response retries the same operation after reopening and account switch clears the wardrobe', async ({ page }) => {
  const sent: any[] = [];
  await page.route('**/api/skin-studio**', async route => {
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) { await route.abort('failed'); return; }
    }
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, enabled: true, job: sent.length > 1 ? { id: sent[0].id, prompt: sent[0].prompt, state: 'generating', variants: [], error: '', selectedId: null, createdAt: Date.now() } : null, wardrobe: [], equippedId: null } });
  });
  await page.goto('/tests/fixtures/skin-studio.html'); await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByLabel('Опиши новый образ').fill('Поменяй только куртку на золотую');
  await page.getByRole('button', { name: 'Создать за $10', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить отправленный запрос' })).toBeEnabled();
  await page.getByRole('button', { name: 'Закрыть ателье' }).click();
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить отправленный запрос' }).click();
  expect(sent).toHaveLength(2); expect(sent[0]).toEqual(sent[1]);
  await expect(page.locator('#skin-status')).toContainText('Рисуем два образа');
  await page.evaluate(() => (window as any).skinPreview.setAccount(null));
  await expect(page.locator('#skin-studio-dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Образы', exact: true })).toBeHidden();
});

test('Phaser replaces the fallback atlas after download and renders distinct turns, walking and sitting frames', async ({ page }) => {
  const shapes = Array.from({ length: 16 }, (_, i) => `<g transform="translate(${i % 4 * 256},${Math.floor(i / 4) * 384})" fill="${['#dd4433', '#33bb66', '#3344dd', '#ddaa33'][Math.floor(i / 4)]}"><circle cx="128" cy="110" r="60"/><rect x="75" y="170" width="106" height="${i % 4 === 3 ? 80 : 160}"/><rect x="${90 + i % 4 * 8}" y="330" width="30" height="20"/></g>`).join('');
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">${shapes}</svg>`)).png().toBuffer();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/skin-studio/assets/**', async route => { await gate; await route.fulfill({ contentType: 'image/png', body: png }); });
  await page.goto('/tests/fixtures/skin-studio.html');
  const key = await page.evaluate(id => (window as any).skinPreview.render(id), ids[0]);
  expect(key).toBe('avatar-generated-' + ids[0]);
  const before = await page.evaluate(() => (window as any).skinPreview.pixels('down-6'));
  release();
  await expect.poll(async () => JSON.stringify(await page.evaluate(() => (window as any).skinPreview.pixels('down-6'))) === JSON.stringify(before)).toBe(false);
  const poses = await page.evaluate(() => ['down-6', 'left-6', 'down-1', 'down-4', 'down-10', 'down-13'].map(frame => JSON.stringify((window as any).skinPreview.pixels(frame))));
  expect(new Set(poses).size).toBe(6);
  // Even deliberately inconsistent model-drawn step cells cannot turn or resize the head.
  const heads = await page.evaluate(() => ['down', 'left', 'right', 'up'].map(direction =>
    Array.from({ length: 6 }, (_, frame) => JSON.stringify((window as any).skinPreview.pixels(`${direction}-${frame}`).slice(0, 96 * 96 * 4)))));
  for (const direction of heads) expect(new Set(direction).size).toBe(1);
  expect(await page.evaluate(() => (window as any).skinPreview.prune())).toBe(false);
});

test('a previously paid three-option order still shows all candidates on desktop and mobile', async ({ page }) => {
  await page.route('**/api/skin-studio**', async route => {
    if (route.request().url().includes('/assets/')) { await route.abort(); return; }
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: 2, enabled: true, equippedId: null, wardrobe: [],
      job: { id: jobId, prompt: 'Старый заказ', variantCount: 3, state: 'ready', error: '', selectedId: null, createdAt: Date.now(),
        variants: ids.map(id => ({ id, jobId, prompt: 'Старый заказ', createdAt: Date.now() })) } } });
  });
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await expect(page.locator('.skin-results .skin-card')).toHaveCount(3);
  await expect(page.locator('.skin-offer')).toHaveText('3 варианта · 1 навсегда');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.skin-results .skin-card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
});

test('new orders send only a fresh brief, even with a generated pirate equipped', async ({ page }) => {
  let sent: any, artworkRequests = 0;
  await page.route('**/api/skin-studio**', async route => {
    if (route.request().url().includes('/assets/')) { artworkRequests++; await route.abort(); return; }
    if (route.request().method() === 'POST') sent = route.request().postDataJSON();
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: 2, enabled: true, wardrobe: [], equippedId: ids[0],
      character: { skin: 0, appearance: { version: 2, skinId: ids[0], theme: SKIN_THEME.id } },
      job: sent ? { id: sent.id, state: 'reserving', variantCount: 2, variants: [], error: '' } : null } });
  });
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByLabel('Опиши новый образ').fill('Новый взрослый учёный в белом халате');
  await page.getByRole('button', { name: 'Создать за $10', exact: true }).click();
  await expect.poll(() => !!sent).toBe(true);
  expect(Object.keys(sent).sort()).toEqual(['id', 'prompt']);
  expect(sent.prompt).toBe('Новый взрослый учёный в белом халате');
  expect(artworkRequests).toBe(0);
  await expect(page.locator('.skin-offer')).toHaveText('2 варианта · 1 навсегда');
});

test('the atelier refreshes the same shared wallet as the games after a temporary outage', async ({ page }) => {
  let synchronized = true, walletCalls = 0;
  const wallet = { balance: 40, entries: [] };
  await page.route('**/api/demo-wallet', async route => {
    walletCalls++; await route.fulfill(synchronized ? { json: wallet } : { status: 503, json: { error: 'Баланс обновляется.' } });
  });
  await page.route('**/api/skin-studio', async route => {
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, enabled: true, wardrobe: [], equippedId: null,
      job: { id: jobId, state: 'ready', variants: [], error: '' } } });
  });
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.evaluate(async id => {
    // @ts-expect-error Vite serves this source import to the test browser.
    const { demoWallet } = await import('/src/wallet/WalletClient.ts'); demoWallet.setAccount(id); (window as any).testWallet = demoWallet;
  }, user);
  await expect.poll(() => page.evaluate(() => !!(window as any).testWallet.wallet)).toBe(true);
  synchronized = false;
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).testWallet.error)).toBe(true);
  const failedCalls = walletCalls; synchronized = true;
  await expect.poll(() => page.evaluate(() => !!(window as any).testWallet.error), { timeout: 15000 }).toBe(false);
  expect(walletCalls).toBeGreaterThan(failedCalls);
  await expect(page.locator('.skin-balance')).toContainText('$40.00');
});

test('touch taps move the preview and closing stops a held input', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.route('**/api/skin-studio**', async route => {
      if (route.request().url().includes('/assets/')) {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect x="80" y="60" width="100" height="280" fill="#bb7755"/></svg>' }); return;
      }
      await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: 2, enabled: true, equippedId: null, wardrobe: [],
        job: { id: jobId, state: 'ready', variantCount: 2, variants: ids.slice(0, 2).map(id => ({ id, jobId, prompt: 'Примерка', createdAt: 1 })) } } });
    });
    await page.goto('/tests/fixtures/skin-studio.html');
    await page.getByRole('button', { name: 'Образы', exact: true }).tap();
    await page.getByRole('button', { name: 'Примерить вариант 1' }).tap();
    const floor = page.getByLabel('Площадка для примерки скина');
    await expect(page.locator('.skin-fitting-caption')).toContainText('Походи');
    await page.getByRole('button', { name: 'Идти вправо', exact: true }).tap();
    await expect(floor).toHaveAttribute('data-facing', 'right');
    await expect(floor).toHaveAttribute('data-moving', 'true');
    await expect(floor).toHaveAttribute('data-moving', 'false');
    await floor.focus(); await page.keyboard.down('KeyA');
    await expect(floor).toHaveAttribute('data-moving', 'true');
    await page.getByRole('button', { name: 'Закрыть ателье' }).tap();
    await page.keyboard.up('KeyA');
    await page.getByRole('button', { name: 'Образы', exact: true }).tap();
    await expect(floor).toHaveAttribute('data-moving', 'false');
    await page.evaluate(() => (window as any).skinPreview.setAccount(null));
    await expect(page.locator('#skin-studio-dialog')).toBeHidden();
  } finally { await context.close(); }
});

test('a new ready order replaces the wardrobe preview while polling keeps the chosen candidate', async ({ page }) => {
  let ready = false;
  const card = (id: string) => ({ id, jobId, prompt: 'Примерка', createdAt: 1 });
  await page.route('**/api/skin-studio**', async route => {
    if (route.request().url().includes('/assets/')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect x="80" y="60" width="100" height="280" fill="#5577bb"/></svg>' }); return;
    }
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: 2, enabled: true, equippedId: ids[0], wardrobe: [card(ids[0])],
      job: ready ? { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', state: 'ready', variantCount: 2, variants: ids.slice(1).map(card) }
        : { id: jobId, state: 'selected', selectedId: ids[0], variants: [] } } });
  });
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByRole('button', { name: 'Примерить', exact: true }).click();
  await expect(page.locator('.skin-fitting-caption')).toContainText('Образ из гардероба.');
  ready = true;
  await page.evaluate(() => (window as any).skinPreview.studio.open());
  await expect(page.locator('.skin-fitting-caption')).toContainText('Вариант 1. Походи');
  await expect(page.getByRole('button', { name: 'Сохранить образ' })).toBeDisabled();
  await page.getByRole('button', { name: 'Примерить вариант 2' }).click();
  await page.evaluate(() => (window as any).skinPreview.studio.open());
  await expect(page.locator('.skin-fitting-caption')).toContainText('Вариант 2. Походи');
  await expect(page.getByRole('button', { name: 'Примерить вариант 2' })).toHaveAttribute('aria-pressed', 'true');
});
