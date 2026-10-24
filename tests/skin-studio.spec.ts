import { test, expect } from '@playwright/test';
import { SKIN_PRICE_UNITS, SKIN_THEME } from '../src/shared/skinStudio';
import sharp from 'sharp';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ids = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
test('three variants, explicit single choice, wardrobe, preview controls and mobile layout', async ({ page }) => {
  let chosen = '', state = 'ready';
  const cards = ids.map(id => ({ id, jobId, prompt: 'Космический пират', createdAt: Date.now() }));
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
  await expect(page.locator('.skin-results .skin-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Сохранить образ' })).toBeDisabled();
  await page.getByLabel('Поворот: Вариант 2').selectOption('3');
  await page.getByLabel('Поза: Вариант 2').selectOption('3');
  await page.getByRole('button', { name: 'Выбрать вариант 2' }).click();
  await expect(page.getByRole('button', { name: 'Выбрать вариант 2' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'artifacts/skin-studio/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('#skin-studio-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/skin-studio/mobile.png' });
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
  await page.getByLabel('Опиши образ').fill('Поменяй только куртку на золотую');
  await page.getByRole('button', { name: 'Создать за $10', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить отправленный запрос' })).toBeEnabled();
  await page.getByRole('button', { name: 'Закрыть ателье' }).click();
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить отправленный запрос' }).click();
  expect(sent).toHaveLength(2); expect(sent[0]).toEqual(sent[1]);
  await expect(page.locator('#skin-status')).toContainText('Рисуем три образа');
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
  expect(await page.evaluate(() => (window as any).skinPreview.prune())).toBe(false);
});

test('clothing-only requests use the current server-equipped character even when another tab changed it', async ({ page }) => {
  const png = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: '#a23d58' } }).png().toBuffer();
  let sent: any;
  await page.route('**/api/skin-studio**', async route => {
    if (route.request().url().includes('/assets/')) { await route.fulfill({ contentType: 'image/png', body: png }); return; }
    if (route.request().method() === 'POST') sent = route.request().postDataJSON();
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, enabled: true, wardrobe: [], equippedId: ids[0],
      character: { skin: 0, appearance: { version: 2, skinId: ids[0], theme: SKIN_THEME.id } },
      job: sent ? { id: sent.id, state: 'reserving', variants: [], error: '' } : null } });
  });
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByLabel('Опиши образ').fill('Поменяй только одежду');
  await page.getByRole('button', { name: 'Создать за $10', exact: true }).click();
  await expect.poll(() => !!sent).toBe(true);
  const reference = await page.evaluate(async id => {
    // @ts-expect-error Vite serves this source import to the test browser.
    const { createCharacterPortrait } = await import('/src/game/characters.ts');
    return createCharacterPortrait(0, JSON.stringify({ version: 2, skinId: id, theme: 'south-park' }), 6).toDataURL();
  }, ids[0]);
  expect(sent.reference).toBe(reference);
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
