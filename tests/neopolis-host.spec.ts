import { test, expect, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';

const api = 'http://127.0.0.1:' + (process.env.NEOPOLIS_API_PORT || '2676');
const out = 'test-results/neopolis-host/review';

async function open(page: Page) {
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="studio-neopolis"]').click();
  await expect(page.locator('.royal-platform')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-platform-game="studio-neopolis"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'studio-neopolis');
  await expect(page.locator('[data-np=spin]')).toBeEnabled();
}

test('Neopolis uses the real host area, keeps controls and chat visible, and restores the paid round', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const host = await request.post('/api/auth/login', { data: { email: 'np-host-' + crypto.randomUUID() + '@example.test', password: 'Neopolis-test-123!' } });
  const cookie = host.headers()['set-cookie'].split(';')[0];
  await request.post('/api/auth/character', { data: { skin: 0 } });
  const client = new Client(api, { headers: { Cookie: cookie }, fetchFn: async (url, options) => {
    const response = await request.fetch(String(url), { method: options?.method, headers: Object.fromEntries(new Headers(options?.headers)), data: options?.body as string });
    return new Response(await response.body(), { status: response.status(), headers: response.headers() });
  } });
  const room = await client.create('lobby');
  for (const name of ['chat', 'activities', 'piano-note', 'notice', 'chat-check', 'security', 'ejected', 'pvp']) room.onMessage(name, () => {});
  try {
    await page.route('https://luelonplay.com/demo-api/**', route => route.fulfill({ json: { games: [] } }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?room=' + room.roomId);
    await page.getByLabel('Почта', { exact: true }).fill('np-player-' + crypto.randomUUID() + '@example.test');
    await page.getByLabel('Пароль', { exact: true }).fill('Neopolis-test-123!');
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.locator('#character-step')).toBeVisible();
    await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
    await expect(page.locator('#join-dialog')).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().online)).toBe(true);
    const deposit = await page.request.post('/api/demo-wallet/operations', { data: { id: crypto.randomUUID(), kind: 'deposit', amount: 10000 } });
    expect(deposit.ok()).toBe(true);
    await page.evaluate(async () => { const path = '/src/wallet/WalletClient.ts'; await (await import(/* @vite-ignore */ path)).demoWallet.refresh(); });
    await open(page);
    await page.locator('[data-hero=prism]').click();
    await expect(page.locator('[data-hero=prism]')).toHaveAttribute('aria-pressed', 'true');
    for (const [width, height] of [[1920,1080], [1440,756], [1366,768], [1024,768], [900,900], [390,844], [360,740], [844,390]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game-viewport', 'layout');
      await expect.poll(() => page.locator('.np').evaluate(root => {
        const stage = root.closest('.mini-stage')!.getBoundingClientRect(), bounds = root.getBoundingClientRect();
        return Math.max(Math.abs(bounds.width - stage.width), Math.abs(bounds.height - stage.height));
      })).toBeLessThan(2);
      const geometry = await page.locator('.np').evaluate(root => {
        const stage = root.closest('.mini-stage')!, bounds = stage.getBoundingClientRect();
        const controls = root.querySelector('.np-controls')!.getBoundingClientRect();
        return { rootOverflow: root.scrollWidth - root.clientWidth, stageOverflow: stage.scrollHeight - stage.clientHeight,
          controlsInside: controls.top >= bounds.top && controls.bottom <= bounds.bottom + 1,
          transform: getComputedStyle(root.parentElement!.parentElement!).transform,
          titleDisplay: getComputedStyle(root.querySelector('h1')!).display };
      });
      expect(geometry.rootOverflow).toBeLessThanOrEqual(1);
      expect(geometry.stageOverflow).toBeLessThanOrEqual(1);
      expect(geometry.controlsInside).toBe(true);
      expect(geometry.transform).toBe('none'); expect(geometry.titleDisplay).toBe('block');
      await expect(page.locator('[data-np=spin]')).toBeInViewport();
      await expect(page.locator('[data-np=bet]')).toBeInViewport();
      await expect(page.locator('#mini-dialog #chat-input')).toBeInViewport();
      if (width === 390) {
        await page.locator('.np-board').scrollIntoViewIfNeeded();
        const effects = await page.locator('.np-effects').evaluate(canvas => {
          const scene = canvas.parentElement!, scroll = scene.parentElement!;
          const bounds = canvas.getBoundingClientRect(), sceneBounds = scene.getBoundingClientRect();
          return { moved: scroll.scrollTop > 0, offset: Math.abs(bounds.top - sceneBounds.top),
            height: Math.abs(bounds.height - sceneBounds.height), coversScene: scene.clientHeight > scroll.clientHeight };
        });
        expect(effects.moved).toBe(true); expect(effects.offset).toBeLessThan(1);
        expect(effects.height).toBeLessThan(1); expect(effects.coversScene).toBe(true);
        await expect(page.locator('[data-np=spin]')).toBeInViewport();
      }
      await page.screenshot({ path: out + '/' + width + 'x' + height + '.png' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = page.waitForResponse(reply => reply.url().endsWith('/api/demo-wallet/expansion') && reply.request().method() === 'POST');
    await page.locator('[data-np=spin]').click(); const accepted = await response; expect(accepted.ok()).toBe(true);
    const saved = (await accepted.json()).session;
    await expect(page.locator('[data-np=spin]')).toBeEnabled();
    const before = await (await page.request.get('/api/demo-wallet')).json();
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#mini-dialog')).toBeHidden();
    await open(page);
    const restored = (await (await page.request.get('/api/demo-wallet/expansion')).json()).sessions.find((s: any) => s.gameId === 'studio-neopolis');
    expect(restored.id).toBe(saved.id); expect(restored.stakeUnits).toBe(saved.stakeUnits);
    expect((await (await page.request.get('/api/demo-wallet')).json()).balance).toBe(before.balance);
    await expect(page.locator('[data-hero=prism]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#chat-input')).toBeInViewport();
    expect(errors).toEqual([]);
  } finally { await Promise.race([room.leave(), new Promise(resolve => setTimeout(resolve, 1500))]); }
});
