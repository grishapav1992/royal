import { test, expect, type Page } from '@playwright/test';

const connected = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).royalDemo?.getNetworkState()?.status), { timeout: 30000 }).toBe('connected');
async function open(page: Page) {
  await page.locator('#pvp-button').click();
  await expect(page.locator('#pvp-dialog')).toBeVisible();
}
const sign = (page: Page, choice: string) => page.locator(`.tsu-choices [data-choice="${choice}"]`);
const score = (page: Page) => page.locator('.tsu-score>strong');

test('two real players play a recovered staked match in the host with connected chat on desktop and mobile', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [], packages: string[] = [];
  for (const page of [a, b]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().includes('/game-modules/tsu-e-fa/versions/') && response.ok()) packages.push(response.url()); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  }
  try {
    for (const [index, page] of [a, b].entries()) {
      const response = await page.context().request.post('http://127.0.0.1:5193/api/auth/login', { data: { email: `pvp-local-${index === 0 ? 'a' : 'b'}@example.test`, password: 'test-password!' } });
      expect(response.ok()).toBe(true);
      await page.goto(index === 0 ? 'http://127.0.0.1:5193/' : a.url());
      await connected(page);
    }
    await open(a);
    await a.locator('[name=game]').selectOption('tsu-e-fa');
    await a.locator('[name=stake]').fill('1.10');
    await expect(a.locator('[data-preview]')).toContainText('2,09');
    await a.locator('[data-create-button]').click();
    await expect(a.locator('[data-active]')).toContainText('Ожидает соперника');
    await open(b);
    await b.locator('[data-pvp-action=accept]').click();
    for (const page of [a, b]) {
      await expect(page.locator('[data-pvp-action=ready]')).toBeEnabled({ timeout: 45000 });
      await page.locator('[data-pvp-action=ready]').click();
    }
    for (const page of [a, b]) {
      await expect(sign(page, 'rock')).toBeEnabled();
      await expect(page.locator('#pvp-dialog .game-chat-dock')).toBeVisible();
      expect(await page.evaluate(() => (window as any).royalDemo.getState().hall)).toBe('tables');
    }
    await sign(a, 'rock').click();
    await expect(sign(a, 'paper')).toBeDisabled();
    await expect(b.locator('.tsu-sealed>span').nth(1)).toContainText('Соперник готов');
    await expect(b.locator('.tsu-result')).toHaveCount(0);
    await sign(b, 'rock').click();
    await expect(a.locator('.tsu-result')).toContainText('Ничья');
    await expect(score(a)).toHaveText('0 : 0');
    await sign(a, 'rock').click();
    await a.locator('#pvp-dialog [data-close]').click();
    await open(a);
    await expect(sign(a, 'rock')).toHaveAttribute('aria-pressed', 'true');
    await a.evaluate(async () => { const account = await fetch('/api/auth/me').then(r => r.json()); window.dispatchEvent(new CustomEvent('royal-account', { detail: account.account.id })); });
    await expect(sign(a, 'rock')).toHaveAttribute('aria-pressed', 'true');
    await a.reload(); await connected(a); await open(a);
    await expect(sign(a, 'rock')).toHaveAttribute('aria-pressed', 'true');
    await sign(b, 'scissors').click();
    await expect(score(a)).toHaveText('1 : 0');
    await expect(a.locator('#pvp-dialog')).not.toContainText('Загрузка игры…');
    await a.screenshot({ path: 'artifacts/work/tsu-e-fa-desktop.png' });
    await a.setViewportSize({ width: 390, height: 844 });
    await expect(a.locator('#pvp-dialog .game-chat-dock')).toBeVisible();
    const chat = (await a.locator('#pvp-dialog .game-chat-dock').boundingBox())!;
    for (const button of await a.locator('.tsu-choices button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(chat.y);
    }
    await a.screenshot({ path: 'artifacts/work/tsu-e-fa-mobile.png' });
    await sign(a, 'rock').click(); await sign(b, 'paper').click();
    await expect(score(a)).toHaveText('1 : 1');
    await sign(a, 'paper').click(); await sign(b, 'rock').click();
    await expect(score(a)).toHaveText('2 : 1');
    await expect(a.locator('.tsu-status')).toHaveText('Поединок твой!');
    await expect(a.locator('[data-active]')).toContainText('Начислено 2,09 USDT');
    await expect(a.locator('[data-balance]')).toContainText('200,99');
    await expect(b.locator('[data-balance]')).toContainText('198,9');
    await a.locator('#pvp-dialog [data-close]').click(); await open(a);
    await expect(score(a)).toHaveText('2 : 1');
    await expect(a.locator('.tsu-reveal')).toHaveCount(0);
    await a.locator('#pvp-dialog [data-close]').click();
    await Promise.all([a.waitForEvent('load'), a.locator('.profile select[name=language]').selectOption('en')]);
    await connected(a); await open(a);
    await expect(a.locator('.tsu-heading h2')).toHaveText('Rock Paper Scissors');
    await expect(a.locator('.tsu-status')).toHaveText('You win the duel!');
    await expect(score(a)).toHaveText('2 : 1');
    await expect(a.locator('.tsu-reveal')).toHaveCount(0);
    expect(packages.length).toBeGreaterThan(0); expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
