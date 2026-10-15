import { test, expect, type Page } from '@playwright/test';
import { FRUITS_PAYTABLE, type FruitsRound, type GamePlayRequest } from '../src/shared/gameCore';
import type { WalletResult } from '../src/shared/demoWallet';

const symbols = ['🍒', '🍋', '🍇', '7'];

async function loginAndFund(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`ezslots-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-ezslots-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
}

async function openFruits(page: Page) {
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="royal-fruits"]').click();
  await expect(page.locator('.ez-slots-game')).toHaveAttribute('data-library', 'EZSlotsJS');
  await expect(page.locator('#ez-fruits-spin')).toBeEnabled({ timeout: 15000 });
}

function expectOperation(operation: unknown, amount: number) {
  expect(operation).toEqual({ id: expect.any(String), kind: 'play', gameId: 'royal-fruits', rulesVersion: 1, input: {}, amount });
}

function expectedRound(result: WalletResult, amount: number): FruitsRound {
  const round = result.gameRound;
  if (round?.gameId !== 'royal-fruits') throw new Error('Expected Royal Fruits server round');
  expect(round.outcome.symbols).toHaveLength(3);
  expect(round.stakeUnits).toBe(String(BigInt(amount) * 100n));
  const [a, b, c] = round.outcome.symbols;
  const multiplier = a === b && b === c ? FRUITS_PAYTABLE[a].multiplier : 0;
  expect(round.multiplier).toBe(multiplier);
  expect(round.payoutUnits).toBe(String(BigInt(amount) * 100n * BigInt(multiplier)));
  expect(result.wallet.balance).toBe(1000 - amount + amount * multiplier);
  return round;
}

async function expectSettled(page: Page, result: WalletResult, amount: number) {
  const round = expectedRound(result, amount);
  await expect(page.locator('#ez-fruits-spin')).toHaveText('Крутить', { timeout: 10000 });
  await expect(page.locator('#ez-fruits-bet')).toBeEnabled();
  await expect(page.locator('.ezslots-symbol[data-row="1"]')).toHaveText(round.outcome.symbols.map(symbol => symbols[symbol]));
  await expect(page.locator('.ezslots-symbol[data-row="1"]')).toHaveCount(3);
  await expect(page.locator('.ezslots-symbol[data-row="0"]')).toHaveCount(3);
  await expect(page.locator('.ezslots-symbol[data-row="2"]')).toHaveCount(3);
  await expect(page.locator('.ez-fruits-outcome')).toHaveAttribute('aria-label', `Центральная линия: ${round.outcome.symbols.map(symbol => FRUITS_PAYTABLE[symbol].label).join(', ')}`);
  await expect(page.locator('#ez-fruits-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('.ez-slots-game')).not.toHaveClass(/spinning/);
}

test('EZSlotsJS animates a server result in one separate mobile cabinet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginAndFund(page);
  await openFruits(page);
  await expect(page.locator('.ez-slots-game select')).toHaveCount(1);
  await expect(page.locator('.ez-fruits-stage')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.ez-fruits-line-label')).toContainText('только центральная линия');
  await expect(page.locator('.ez-fruits-rules')).toContainText('97%');
  await expect(page.locator('.ez-fruits-paytable tbody tr')).toHaveCount(4);
  for (const row of FRUITS_PAYTABLE) {
    await expect(page.locator('.ez-fruits-paytable tbody tr').nth(row.symbol).locator('th')).toContainText(symbols[row.symbol]);
    await expect(page.locator('.ez-fruits-paytable tbody tr').nth(row.symbol).locator('td')).toHaveText(`×${row.multiplier}`);
  }
  await page.locator('#ez-fruits-bet').selectOption('100');
  const posts: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/demo-wallet/operations') && request.method() === 'POST') posts.push(request.postDataJSON());
  });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/operations') && response.request().method() === 'POST');
  await page.locator('#ez-fruits-spin').click();
  await expect(page.locator('#ez-fruits-bet')).toBeDisabled();
  await expect(page.locator('#ez-fruits-spin')).toBeDisabled();
  await page.locator('#ez-fruits-spin').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expectOperation(response.request().postDataJSON(), 100);
  const result = await response.json() as WalletResult;
  await expect(page.locator('.ezslots-reel.spinning')).toHaveCount(3);
  await expect(page.locator('.ezslots-symbol.spinning-symbol')).toHaveCount(60);
  await expectSettled(page, result, 100);
  expect(posts).toHaveLength(1);
  const bounds = (await page.locator('.ez-slots-game').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.ez-slots-game').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ezslots-fruits-mobile.png' });
  await page.locator('#ez-fruits-wallet').click();
  await expect(page.locator('#wallet-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="win"]')).toHaveCount(1);
});

test('EZSlotsJS reload retries the saved operation with the same ID and no second debit', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAndFund(page);
  await openFruits(page);
  await page.locator('#ez-fruits-bet').selectOption('50');
  let original: GamePlayRequest | undefined;
  let settled: WalletResult | undefined;
  let posts = 0;
  await page.route('**/api/demo-wallet/operations', async route => {
    posts++;
    const operation = route.request().postDataJSON() as GamePlayRequest;
    if (!original) {
      original = operation;
      expectOperation(operation, 50);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      settled = await response.json() as WalletResult;
      await route.abort('failed');
    } else {
      expect(operation).toEqual(original);
      await route.continue();
    }
  });
  await page.locator('#ez-fruits-spin').click();
  await expect(page.locator('#ez-fruits-spin')).toHaveText('Проверить результат');
  await expect(page.locator('#ez-fruits-bet')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await openFruits(page);
  await expect(page.locator('#ez-fruits-spin')).toHaveText('Проверить результат');
  await expect(page.locator('#ez-fruits-bet')).toHaveValue('50');
  await expect(page.locator('#ez-fruits-bet')).toBeDisabled();
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/operations') && response.request().method() === 'POST');
  await page.locator('#ez-fruits-spin').click();
  const response = await responsePromise;
  const replay = await response.json() as WalletResult;
  expect(replay.gameRound).toEqual(settled!.gameRound);
  expect(replay.wallet.balance).toBe(settled!.wallet.balance);
  expect(replay.wallet.entries.filter(entry => entry.operationId === original!.id).map(entry => entry.kind).sort()).toEqual(['bet', 'win']);
  expect(posts).toBe(2);
  await expectSettled(page, replay, 50);
  await expect(page.locator('.ezslots-symbol.spinning-symbol')).toHaveCount(0);
});

test('EZSlotsJS blocks an unrelated pending round and recovers only its own settlement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAndFund(page);
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="royal-dice"]').click();
  await expect(page.locator('#original-play')).toBeEnabled({ timeout: 15000 });
  await page.route('**/api/demo-wallet/operations', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  }, { times: 1 });
  await page.locator('#original-play').click();
  await expect(page.locator('#original-play')).toHaveText('Проверить результат');
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="royal-fruits"]').click();
  await expect(page.locator('.ez-slots-game')).toBeVisible();
  await expect(page.locator('#ez-fruits-spin')).toBeDisabled();
  await expect(page.locator('#ez-fruits-bet')).toBeDisabled();
  await expect(page.locator('#ez-fruits-result')).toContainText('другой игры');
  const fruitsPosts: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/demo-wallet/operations') && request.method() === 'POST' && request.postDataJSON().gameId === 'royal-fruits') fruitsPosts.push(request.postDataJSON());
  });
  await page.locator('#ez-fruits-spin').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.locator('#ez-fruits-wallet').click();
  await page.locator('#wallet-retry').click();
  await expect(page.locator('#wallet-retry')).toBeHidden();
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  await expect(page.locator('#ez-fruits-spin')).toBeEnabled();
  await expect(page.locator('.ez-fruits-outcome')).toHaveAttribute('aria-label', 'Результат ещё не получен');
  expect(fruitsPosts).toHaveLength(0);
});
