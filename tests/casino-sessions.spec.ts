import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';

async function login(page: Page, path: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await page.getByLabel('Почта', { exact: true }).fill(`removed-tower-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Removed-tower-browser-42!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().online)).toBe(true);
}

test('removed Dragon Tower has no catalogue entry and rejected actions preserve the demo wallet', async ({ page, roomPath }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, roomPath);
  await expect(page.locator('[data-cabinet="github-tower"]')).toHaveCount(0);
  if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
  await page.locator('#games-tab').click();
  const cabinet = page.locator('[data-cabinet-collection="royal"] [data-cabinet]').first();
  await expect(cabinet).toBeVisible();
  await cabinet.click();
  const catalogue = page.locator('#mini-game .royal-platform');
  await expect(catalogue).toBeVisible({ timeout: 30000 });
  await expect.poll(() => catalogue.locator('[data-platform-game]').count()).toBeGreaterThan(0);
  await expect(catalogue.locator('[data-platform-game="github-tower"]')).toHaveCount(0);
  await expect(catalogue).not.toContainText('Dragon Tower');
  await expect(page.locator('#chat-input')).toBeInViewport();

  const me = await page.request.get('/api/auth/me');
  expect(me.ok()).toBe(true);
  const { account } = await me.json();
  const headers = { 'X-Royal-Account-Id': account.id };
  const beforeReply = await page.request.get('/api/demo-wallet', { headers });
  expect(beforeReply.ok()).toBe(true);
  const before = await beforeReply.json();
  const sessionId = crypto.randomUUID();
  const operations = [
    { id: crypto.randomUUID(), gameId: 'github-tower', action: 'start', stakeUnits: '1000', settings: { difficulty: 'easy' } },
    { id: crypto.randomUUID(), gameId: 'github-tower', action: 'pick', sessionId, choice: 0 },
    { id: crypto.randomUUID(), gameId: 'github-tower', action: 'cashout', sessionId },
  ];
  for (const data of operations) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await page.request.post('/api/demo-wallet/casino-sessions', { headers, data });
      expect(response.status()).toBe(400);
      const afterReply = await page.request.get('/api/demo-wallet', { headers });
      expect(afterReply.ok()).toBe(true);
      expect(await afterReply.json()).toEqual(before);
    }
  }
  const savedReply = await page.request.get('/api/demo-wallet/casino-sessions', { headers });
  expect(savedReply.ok()).toBe(true);
  const saved = await savedReply.json();
  expect(saved.sessions.every((session: { gameId: string }) => session.gameId !== 'github-tower')).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(catalogue).toBeVisible();
  await expect(catalogue.locator('[data-platform-game="github-tower"]')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toBeInViewport();
  expect(errors).toEqual([]);
});
