import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

test.use({ serviceWorkers: 'block' });

async function open(page: Page, id: string) {
  await page.locator('#games-tab').click();
  await page.locator(`[data-cabinet="${id}"]`).click();
  await expect(page.locator(`section[data-game="${id}"]`)).toBeVisible({ timeout: 20000 });
}

test('all six cabinets keep their complete game traffic on the Royal origin', async ({ page, context, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ownHost = new URL(baseURL!).host;
  const externalAttempts: string[] = [];
  const networkPaths = new Set<string>();
  const failedRequests: { path: string; reason: string | null }[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText ?? null }));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.host !== ownHost) {
      externalAttempts.push(`${url.protocol}//${url.host}`);
      await route.abort('blockedbyclient');
    } else {
      networkPaths.add(url.pathname);
      await route.continue();
    }
  });
  page.on('websocket', socket => {
    const url = new URL(socket.url());
    if (url.host !== ownHost) externalAttempts.push(`${url.protocol}//${url.host}`);
    else networkPaths.add(url.pathname);
  });

  const password = 'Security-only-local-test-password!';
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`egress-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  try {
    await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  } catch (error) {
    console.log(JSON.stringify({ externalAttempts, browserErrors, failedRequests, royalPaths: [...networkPaths] }));
    throw error;
  }
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();

  const checked = ['royal-fruits', 'royal-dice', 'royal-limbo', 'royal-mines', 'royal-plinko', 'royal-keno'];
  for (const gameId of checked) {
    await open(page, gameId);
    if (gameId === 'royal-fruits') {
      await page.locator('#ez-fruits-bet').selectOption('10');
      await page.locator('#ez-fruits-spin').click();
      await expect(page.locator('#ez-fruits-result')).toHaveText(/Начислено|Без выигрыша/);
      await expect(page.locator('#ez-fruits-spin')).toBeEnabled();
    } else {
      await page.locator('#original-bet').selectOption('10');
      if (gameId === 'royal-mines') {
        await page.locator('#original-mine-count').selectOption('1');
        const startResponse = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/mines') && response.request().method() === 'POST');
        await page.locator('#original-play').click();
        const result = await (await startResponse).json();
        expect(result.session.state).toBe('active');
        expect(JSON.stringify(result)).not.toMatch(/mineCells|mine_cells|reserved_units|serverSeed/);
        await expect(page.locator('[data-mine-cell="0"]')).toBeEnabled();
        const revealResponse = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/mines') && response.request().method() === 'POST');
        await page.locator('[data-mine-cell="0"]').click();
        const revealed = await (await revealResponse).json();
        if (revealed.session.state === 'active') {
          expect(revealed.session).not.toHaveProperty('mineCells');
          await expect(page.locator('#original-play')).toBeEnabled();
          await page.locator('#original-play').click();
          await expect(page.locator('#original-result')).toContainText('Партия завершена');
        } else expect(revealed.session.state).toBe('lost');
      } else {
        await page.locator('#original-play').click();
        await expect(page.locator('#original-result')).toHaveText(/Начислено|Без выплаты|Совпадений/);
        await expect(page.locator('#original-play')).toBeEnabled();
      }
    }
    await page.locator('#mini-dialog .mini-top [data-close]').click();
  }
  const browserStorage = await page.evaluate(() => ({
    cookies: document.cookie,
    values: [...Object.values(localStorage), ...Object.values(sessionStorage)],
  }));
  expect(browserStorage.cookies).not.toContain('royal_session');
  expect(JSON.stringify(browserStorage.values)).not.toContain(password);
  expect(JSON.stringify(browserStorage.values)).not.toMatch(/mineCells|mine_cells|serverSeed|CODEX_SALE_API_KEY/);
  expect(externalAttempts).toEqual([]);
  expect(browserErrors).toEqual([]);
  mkdirSync('artifacts/game-security', { recursive: true });
  writeFileSync('artifacts/game-security/network.json', JSON.stringify({
    checkedAt: new Date().toISOString(), checkedGames: checked,
    externalAttemptCount: externalAttempts.length,
    royalRequestPaths: [...networkPaths].sort(),
    serviceWorkersBlockedForTest: true,
    authCookieHiddenFromJavaScript: true,
    passwordAndHiddenGameStateAbsentFromBrowserStorage: true,
  }, null, 2) + '\n');
});
