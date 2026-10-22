import { test, expect, request as apiRequest, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { mkdir } from 'node:fs/promises';
import { validNeopolisSession } from '../src/shared/neopolis';

const entry = '/tests/fixtures/neopolis-preview.html';
const state = (page: Page) => page.evaluate(() => (window as any).neopolisPreview.state());
const session = (page: Page) => page.evaluate(() => (window as any).neopolisPreview.client.sessions.find((value: any) => value.gameId === 'studio-neopolis'));
async function ready(page: Page, lang = 'en') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(entry + '?lang=' + lang);
  await expect(page.locator('#preview')).toHaveAttribute('data-game-module-id', 'studio-neopolis');
  await expect(page.locator('[data-np=spin]')).toBeEnabled();
}
async function spin(page: Page) {
  const before = await session(page), marker = before?.id + ':' + before?.view.neopolis.revision;
  await expect(page.locator('[data-np=spin]')).toBeEnabled(); await page.locator('[data-np=spin]').click();
  await page.waitForFunction(old => {
    const harness = (window as any).neopolisPreview, s = harness.client.sessions.find((value: any) => value.gameId === 'studio-neopolis');
    return s && s.id + ':' + s.view.neopolis.revision !== old && !harness.client.busy && !harness.state().busy && !harness.client.pending;
  }, marker);
  const result = await session(page); expect(validNeopolisSession(result)).toBe(true); return result;
}
async function closeNotice(page: Page) { if (await page.locator('[data-np=dialog]').isVisible()) await page.locator('[data-np=close]').click(); }

test('Russian and English modules fit desktop and phone, with localized rules and hero selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results/neopolis/review', { recursive: true });
  for (const lang of ['ru','en']) {
    await ready(page, lang);
    await expect(page.locator('.np h1')).toHaveText(lang === 'en' ? 'Guardians of Neopolis' : 'Стражи Неополиса');
    await page.locator('[data-hero=prism]').click(); expect((await state(page)).selected).toBe('prism');
    await expect(page.locator('[data-hero=prism]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-np=rules]').click();
    await expect(page.locator('.np-dialog h2')).toHaveText(lang === 'en' ? 'Game rules' : 'Правила игры');
    await expect(page.locator('.np-dialog tbody tr')).toHaveCount(6);
    if (lang === 'en') expect(await page.locator('.np').innerText()).not.toMatch(/[А-Яа-яЁё]/);
    await page.locator('[data-np=close]').click();
    for (const [width, height] of [[1920,1080],[1366,768],[900,900],[390,844],[360,740]]) {
      await page.setViewportSize({ width, height });
      const geometry = await page.locator('.np').evaluate(root => ({ width: root.clientWidth, scroll: root.scrollWidth, cells: root.querySelectorAll('[role=gridcell]').length }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1); expect(geometry.cells).toBe(20);
      const cards = await page.locator('.np-hero').evaluateAll(cards => cards.map(card => { const rect = card.getBoundingClientRect(); return { x:rect.x, y:rect.y }; }));
      if (width < 760) { expect(new Set(cards.map(card => card.y)).size).toBe(1); expect(cards[0].x).toBeLessThan(cards[1].x); expect(cards[1].x).toBeLessThan(cards[2].x); }
      await page.locator('[data-np=spin]').scrollIntoViewIfNeeded(); await expect(page.locator('[data-np=spin]')).toBeInViewport();
      await page.locator('.np').evaluate(root => { root.scrollTop = 0; });
      await page.screenshot({ path: 'test-results/neopolis/review/' + lang + '-' + width + '.png', fullPage: true });
    }
    await page.setViewportSize({ width:1440, height:1000 });
  }
  expect(errors).toEqual([]);
});

test('real API retries a lost result once, restores collection and bonus, and settles the free series', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  let original: any;
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST' || original) { await route.continue(); return; }
    original = await (await route.fetch()).json(); await route.abort('failed');
  });
  await page.locator('[data-np=spin]').click();
  await page.waitForFunction(() => !!(window as any).neopolisPreview.client.pending && !(window as any).neopolisPreview.state().busy);
  const pendingId = await page.evaluate(() => (window as any).neopolisPreview.client.pending.id);
  await expect(page.locator('[data-np=spin]')).toHaveText(/Check move/);
  await page.unroute('**/api/demo-wallet/expansion');
  const replay = await spin(page); expect(replay.id).toBe(pendingId); expect(replay).toEqual(original.session);
  const collected = (await state(page)).team;
  await page.getByRole('button', { name: 'Reopen game' }).click();
  await expect(page.locator('[data-np=spin]')).toBeEnabled(); expect((await state(page)).team).toEqual(collected);
  await expect(page.locator('[data-np=bet]')).toBeDisabled();
  let current = await session(page);
  for (let attempt = 0; current.state !== 'active' && attempt < 75; attempt++) current = await spin(page);
  expect(current.state).toBe('active'); expect(current.view.neopolis.battle.remaining).toBe(10);
  await page.screenshot({ path: 'test-results/neopolis/review/bonus-start-en.png', fullPage: true });
  await closeNotice(page);
  const battleId = current.id;
  const balanceBefore = await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance);
  current = await spin(page); expect(current.id).toBe(battleId); expect(current.spentUnits).toBe('10000');
  expect(await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance)).toBe(balanceBefore);
  const revision = current.view.neopolis.revision;
  await page.reload(); await expect(page.locator('[data-np=spin]')).toBeEnabled();
  expect((await state(page)).revision).toBe(revision);
  expect((await session(page)).id).toBe(battleId);
  while (current.state === 'active') { await closeNotice(page); current = await spin(page); }
  expect(current.view.neopolis.team.complete).toBe(true); expect(current.view.neopolis.revision).toBeLessThanOrEqual(14);
  const finalBalance = await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance);
  expect(finalBalance).toBeCloseTo(balanceBefore + Number(current.returnedUnits) / 100, 2);
  await closeNotice(page); await expect(page.locator('[data-np=bet]')).toBeEnabled();
  await page.locator('[data-hero=prism]').click(); expect((await state(page)).selected).toBe('prism');
  await page.screenshot({ path: 'test-results/neopolis/review/bonus-finished-en.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('real host opens the cabinet with connected chat on desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const hostApi = await apiRequest.newContext({ baseURL:'http://127.0.0.1:5216' });
  const auth = await hostApi.post('/api/auth/login', { data:{email:'neopolis-room-' + crypto.randomUUID() + '@example.test',password:'Neopolis-room-review-42!'} });
  expect(auth.ok()).toBe(true); await hostApi.post('/api/auth/character', {data:{skin:0}});
  const peer = await new Client('http://127.0.0.1:2616', { headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]}, fetchFn:async (url, options) => {
    const response = await hostApi.fetch(String(url), {method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
    return new globalThis.Response(await response.body(), {status:response.status(),headers:response.headers()});
  } }).create('lobby');
  for (const type of ['chat','activities','piano-note','notice']) peer.onMessage(type, () => {});
  try {
    await ready(page); expect((await page.request.post('/api/auth/character', {data:{skin:0}})).ok()).toBe(true);
    await page.goto('/?lang=en&room=' + peer.roomId);
    await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});
    await page.waitForFunction(() => (window as any).royalDemo?.getState().online === true);
    await page.locator('#games-tab').click(); await page.locator('[data-studio=studio-neopolis]').click();
    await expect(page.locator('#mini-dialog[open] .np')).toBeVisible({timeout:45000});
    await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
    await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
    await expect(page.locator('.np [data-np=spin]')).toBeEnabled();
    const first = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/expansion') && response.request().method() === 'POST');
    await page.locator('.np [data-np=spin]').click(); expect((await first).ok()).toBe(true);
    await page.waitForFunction(() => (window as any).royalDemo.getMiniState()?.busy === false);
    await closeNotice(page);
    for (const [width,height] of [[1440,1000],[390,844]]) {
      await page.setViewportSize({width,height});
      await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();
      const windowLayout = await page.locator('#mini-dialog').evaluate(root => ({width:root.clientWidth,scroll:root.scrollWidth}));
      expect(windowLayout.scroll).toBeLessThanOrEqual(windowLayout.width + 1);
      const layout = await page.locator('.np').evaluate(root => ({width:root.clientWidth,scroll:root.scrollWidth}));
      expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
      await page.locator('.np [data-np=spin]').scrollIntoViewIfNeeded();
      await expect(page.locator('.np [data-np=spin]')).toBeInViewport();
      await page.screenshot({path:'test-results/neopolis/review/host-' + width + '-en.png'});
    }
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#mini-dialog')).toBeHidden();
    await expect(page.locator('#club-chat-dock')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await peer.leave(); await hostApi.dispose(); }
});
