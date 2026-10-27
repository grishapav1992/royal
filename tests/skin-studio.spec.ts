import { test, expect } from '@playwright/test';
import { SKIN_PRICE_UNITS, SKIN_THEME } from '../src/shared/skinStudio';
import sharp from 'sharp';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ids = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
test('Mira replaces a cached fallback portrait when the generated sheet loads, including reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const png = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: '#63b7cb' } }).png().toBuffer();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/skin-studio/assets/**', async route => { await gate; await route.fulfill({ contentType: 'image/png', body: png }); });
  await page.route('**/api/npc/mira', route => route.fulfill({ json: { turns: [], choices: [] } }));
  await page.goto('/tests/fixtures/skin-studio.html');
  try {
    const fallback = await page.evaluate(id => (window as any).skinPreview.miraPortrait(id), ids[0]);
    await expect(page.locator('.mira-player-avatar')).toHaveAttribute('src', fallback);
    release();
    await expect.poll(() => page.evaluate(() => (window as any).skinPreview.portraitLoaded())).toBe(true);
    const expected = await page.evaluate(() => (window as any).skinPreview.portraitExpected());
    expect(expected).not.toBe(fallback);
    await expect.poll(() => page.locator('.mira-player-avatar').getAttribute('src')).toBe(expected);
    expect(await page.evaluate(() => (window as any).skinPreview.portraitCached())).toBe(expected);
  } finally { release(); }
});
test('actual artwork descriptions arrive without losing the tried variant or keyboard focus', async ({ page }) => {
  let described = false, chosen = false;
  await page.route('**/api/skin-studio**', async route => {
    if (route.request().url().includes('/assets/')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><circle fill="#bc6351" cx="128" cy="90" r="58"/></svg>' }); return;
    }
    if (route.request().url().endsWith('/choose')) { expect(route.request().postDataJSON()).toEqual({ jobId, skinId: ids[1] }); chosen = true; }
    const cards = ids.slice(0, 2).map((id, i) => ({ id, jobId, prompt: 'Сумбурный исходный запрос', createdAt: 1,
      description: described ? ['Бродяга в рваном плаще', 'Одногий пират с попугаем'][i] : '', descriptionPending: !described }));
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: 2, enabled: true, equippedId: chosen ? ids[1] : null,
      job: { id: jobId, prompt: 'Сумбурный исходный запрос', variantCount: 2, state: chosen ? 'selected' : 'ready', error: '', selectedId: chosen ? ids[1] : null, createdAt: 1, variants: chosen ? [] : cards }, wardrobe: chosen ? [cards[1]] : [] } });
  });
  await page.goto('/tests/fixtures/skin-studio.html'); await page.getByRole('button', { name: 'Образы', exact: true }).click();
  const choice = page.getByRole('button', { name: 'Примерить вариант 2' });
  await choice.click(); await choice.focus(); described = true;
  await expect(page.locator('.skin-results .skin-card-description').nth(1)).toHaveText('Одногий пират с попугаем');
  await expect(choice).toBeFocused(); await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Сохранить образ' }).click();
  await expect(page.locator('.skin-wardrobe .skin-card-description')).toHaveText('Одногий пират с попугаем');
});
test('a late description refresh cannot resurrect candidates after a saved choice', async ({ page }) => {
  let reads = 0, chosen = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cards = ids.slice(0, 2).map(id => ({ id, jobId, prompt: 'Запрос', createdAt: 1, description: '', descriptionPending: true }));
  await page.route('**/api/skin-studio**', async route => {
    const request = route.request();
    if (request.url().includes('/assets/')) { await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"/>' }); return; }
    const old = request.method() === 'GET' && ++reads === 2;
    if (old) await gate;
    if (request.url().endsWith('/choose')) chosen = true;
    const selected = chosen && !old;
    await route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: 2, enabled: true, equippedId: selected ? ids[0] : null,
      job: { id: jobId, prompt: 'Запрос', variantCount: 2, state: selected ? 'selected' : 'ready', error: '', selectedId: selected ? ids[0] : null, createdAt: 1, variants: selected ? [] : cards }, wardrobe: selected ? [{ ...cards[0], descriptionPending: false }] : [] } });
  });
  try {
    await page.goto('/tests/fixtures/skin-studio.html'); await page.getByRole('button', { name: 'Образы', exact: true }).click();
    await page.getByRole('button', { name: 'Примерить вариант 1' }).click();
    await expect.poll(() => reads).toBe(2);
    await page.getByRole('button', { name: 'Сохранить образ' }).click();
    await expect(page.locator('.skin-results')).toBeHidden();
    const late = page.waitForResponse(response => new URL(response.url()).pathname === '/api/skin-studio' && response.request().method() === 'GET');
    release(); await (await late).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect.poll(() => page.locator('.skin-wardrobe .skin-card').count()).toBe(1);
    await expect(page.locator('.skin-results')).toBeHidden();
  } finally { release(); }
});

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
  const walk = await page.evaluate(() => {
    const preview = (window as any).skinPreview, animation = preview.scene.anims.get(preview.key + '-walk-down');
    return { frames: animation.frames.length, frameRate: animation.frameRate };
  });
  expect(walk).toEqual({ frames: 6, frameRate: 12 });
  expect(await page.evaluate(() => (window as any).skinPreview.prune())).toBe(false);
});

test('generated walking moves the drawn hands and feet without separating their silhouette in any direction', async ({ page }) => {
  const figures = Array.from({ length: 16 }, (_, cell) => {
    const pose = cell % 4, handY = [216, 182, 244, 205][pose], footX = [88, 78, 98, 88][pose];
    return `<g transform="translate(${pose * 256},${Math.floor(cell / 4) * 384})" fill="#6752a3">
      <circle cx="128" cy="90" r="60"/><rect x="83" y="145" width="90" height="145"/>
      <rect x="62" y="175" width="30" height="105"/><rect x="165" y="175" width="30" height="105"/>
      <rect x="${footX}" y="278" width="38" height="70"/><rect x="132" y="278" width="38" height="70"/>
      <rect fill="#ff33aa" x="62" y="${handY}" width="24" height="22"/>
      <rect fill="#00eeff" x="${footX}" y="328" width="38" height="20"/>
      <rect fill="#ffee00" x="108" y="65" width="40" height="22"/>
    </g>`;
  }).join('');
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">${figures}</svg>`)).png().toBuffer();
  await page.route('**/api/skin-studio/assets/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.evaluate(id => (window as any).skinPreview.render(id), ids[0]);
  await expect.poll(() => page.evaluate(() => (window as any).skinPreview.key && (window as any).skinPreview.pixels('down-6').some((value: number, i: number) => i % 4 === 0 && value === 103))).toBe(true);
  const result = await page.evaluate(() => {
    const preview = (window as any).skinPreview, width = 96, height = 144;
    const center = (pixels: number[], color: number[]) => {
      let x = 0, y = 0, count = 0;
      for (let at = 0; at < width * height; at++) if (pixels[at * 4 + 3] > 240 && color.every((v, c) => Math.abs(pixels[at * 4 + c] - v) < 5)) {
        x += at % width; y += Math.floor(at / width); count++;
      }
      if (!count) throw Error('Missing movement marker'); return { x: x / count, y: y / count };
    };
    const hands: number[] = [], feet: number[] = [], detached: string[] = [];
    for (const direction of ['down', 'left', 'right', 'up']) for (let frame = 0; frame < 6; frame++) {
      const pixels = preview.pixels(direction + '-' + frame), head = center(pixels, [255, 238, 0]);
      if (direction === 'down') { hands.push(center(pixels, [255, 51, 170]).y - head.y); feet.push(center(pixels, [0, 238, 255]).x - head.x); }
      const seen = new Uint8Array(width * height), queue = new Int32Array(seen.length); let total = 0, largest = 0;
      for (let start = 0; start < seen.length; start++) {
        if (seen[start] || pixels[start * 4 + 3] < 128) continue;
        let front = 0, tail = 1; queue[0] = start; seen[start] = 1;
        while (front < tail) {
          const at = queue[front++], x = at % width;
          for (const next of [x ? at - 1 : -1, x + 1 < width ? at + 1 : -1, at - width, at + width]) {
            if (next < 0 || next >= seen.length || seen[next] || pixels[next * 4 + 3] < 128) continue;
            seen[next] = 1; queue[tail++] = next;
          }
        }
        total += tail; largest = Math.max(largest, tail);
      }
      if (total - largest > 5) detached.push(direction + '-' + frame + ': ' + (total - largest));
    }
    return { hands, feet, detached };
  });
  expect(Math.max(...result.hands) - Math.min(...result.hands), 'The hand must swing relative to the head.').toBeGreaterThan(5);
  expect(Math.max(...result.feet) - Math.min(...result.feet), 'The feet must alternate steps.').toBeGreaterThan(2);
  expect(result.detached, 'The neck, arms and hips must stay connected in every walking frame.').toEqual([]);
});

test('fitting room uses the live game walking cadence', async ({ page }) => {
  const png = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: '#6752a3' } }).png().toBuffer();
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    (window as any).fittingSamples = [];
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (this.canvas.closest('.skin-fitting-room') && args.length === 9 && args[0].naturalWidth === 1024) {
        (window as any).fittingSamples.push({ time: performance.now(), pose: args[1] / 256 });
      }
      return (draw as any).apply(this, args);
    } as typeof draw;
  });
  await page.route('**/api/skin-studio**', route => route.request().url().includes('/assets/')
    ? route.fulfill({ contentType: 'image/png', body: png })
    : route.fulfill({ json: { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, enabled: true, equippedId: null, wardrobe: [],
      job: { id: jobId, prompt: 'Проверка походки', state: 'ready', variantCount: 2, createdAt: 1, variants: ids.slice(0, 2).map(id => ({ id, jobId, prompt: '', createdAt: 1 })) } } }));
  await page.goto('/tests/fixtures/skin-studio.html');
  await page.evaluate(id => (window as any).skinPreview.render(id), ids[0]);
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByRole('button', { name: 'Примерить вариант 1' }).click();
  await expect(page.locator('.skin-fitting-caption')).toContainText('Походи');
  const fps = await page.evaluate(() => { const p = (window as any).skinPreview; return p.scene.anims.get(p.key + '-walk-right').frameRate; });
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.getByLabel('Площадка для примерки скина').focus(); await page.keyboard.down('ArrowRight');
  await page.evaluate(() => { (window as any).fittingSamples = []; });
  await page.clock.runFor(1200); await page.keyboard.up('ArrowRight');
  const cycles = await page.evaluate(() => {
    const samples = (window as any).fittingSamples as { time: number; pose: number }[];
    const starts = samples.filter((v, i) => v.pose === 1 && samples[i - 1]?.pose !== 1).map(v => v.time);
    return starts.slice(1).map((v, i) => v - starts[i]);
  });
  expect(cycles.length).toBeGreaterThanOrEqual(2);
  for (const cycle of cycles) expect(Math.abs(cycle - 6 / fps * 1000)).toBeLessThan(35);
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
