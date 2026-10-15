import { test, expect, type Page, type Request } from '@playwright/test';
import {
  FRUITS_PAYTABLE,
  FRUITS_REEL_COUNT,
  FRUITS_SYMBOL_COUNT,
  type GamePlayRequest,
} from '../src/shared/gameCore';
import type { WalletResult } from '../src/shared/demoWallet';
import { NILE_PLAY_SCOPE } from '../src/shared/nilePlay';
import { USDT_SCOPE, validUsdtWallet } from '../src/shared/usdtWallet';

const FRUIT_SYMBOLS = ['🍒', '🍋', '🍇', '7'] as const;
const EXPECTED_TRIPLE_RETURNS = [5, 10, 30, 140] as const;

async function loginAndFund(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`fruits-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-fruits-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await expect(page.locator('#wallet-balance')).toHaveText('0');
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
}

async function openGames(page: Page) {
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="royal-coins"]').click();
  await expect(page.locator('#coins-spin')).toBeEnabled({ timeout: 15000 });
}

async function selectFruits(page: Page) {
  await page.locator('#coins-game').selectOption('royal-fruits');
  await expect(page.locator('.royal-coins')).toHaveAttribute('data-game', 'royal-fruits');
  await expect(page.locator('.coins-marquee h3')).toHaveText('Royal Fruits');
  await expect(page.locator('.coins-reels')).toBeVisible();
  await expect(page.locator('#coins-theme-control')).toBeHidden();
  await expect(page.locator('.fruits-paytable')).toBeVisible();
  await expect(page.locator('.coins-rtp')).toContainText('97%');
}

const operationResponse = (page: Page) => page.waitForResponse(response =>
  response.url().endsWith('/api/demo-wallet/operations') && response.request().method() === 'POST');

function expectFruitOperation(operation: unknown, amount: number) {
  expect(operation).toEqual({
    id: expect.any(String), kind: 'play', gameId: 'royal-fruits', rulesVersion: 1, input: {}, amount,
  });
  expect((operation as GamePlayRequest).id).toMatch(/^[a-f0-9-]{36}$/);
}

function expectFruitSettlement(result: WalletResult, amount: number) {
  const round = result.gameRound;
  expect(round?.gameId).toBe('royal-fruits');
  if (round?.gameId !== 'royal-fruits') throw new Error('Expected a Royal Fruits game round');
  expect(round.rulesVersion).toBe(1);
  expect(round.input).toEqual({});
  expect(round.outcome.symbols).toHaveLength(FRUITS_REEL_COUNT);
  for (const symbol of round.outcome.symbols) {
    expect(Number.isInteger(symbol)).toBe(true);
    expect(symbol).toBeGreaterThanOrEqual(0);
    expect(symbol).toBeLessThan(FRUITS_SYMBOL_COUNT);
  }
  const [first, second, third] = round.outcome.symbols;
  const multiplier = first === second && second === third ? EXPECTED_TRIPLE_RETURNS[first] : 0;
  const stakeUnits = BigInt(amount) * 100n;
  const payoutUnits = stakeUnits * BigInt(multiplier);
  expect(round.multiplier).toBe(multiplier);
  expect(round.stakeUnits).toBe(String(stakeUnits));
  expect(round.payoutUnits).toBe(String(payoutUnits));
  expect(result.wallet.balance).toBe(1000 - amount + Number(payoutUnits) / 100);
  expect(result).not.toHaveProperty('round');
  return round;
}

async function expectSettledInterface(page: Page, result: WalletResult, amount: number) {
  const round = expectFruitSettlement(result, amount);
  await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  await expect(page.locator('.coins-reels span')).toHaveText(round.outcome.symbols.map(symbol => FRUIT_SYMBOLS[symbol]));
  await expect(page.locator('.coins-reels')).toHaveAttribute('aria-label', `Символы: ${round.outcome.symbols.map(symbol => FRUITS_PAYTABLE[symbol].label).join(' ')}`);
  await expect(page.locator('#coins-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#coins-result')).not.toContainText('Ответ не получен');
  await expect(page.locator('.royal-coins')).not.toHaveClass(/spinning/);
}

test('Royal Fruits displays its fixed paytable and settles one exact demo wager', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(FRUITS_REEL_COUNT).toBe(3);
  expect(FRUITS_SYMBOL_COUNT).toBe(4);
  expect(FRUITS_PAYTABLE.map(row => ({ symbol: row.symbol, weight: row.weight, multiplier: row.multiplier }))).toEqual([
    { symbol: 0, weight: 8, multiplier: 5 },
    { symbol: 1, weight: 6, multiplier: 10 },
    { symbol: 2, weight: 4, multiplier: 30 },
    { symbol: 3, weight: 2, multiplier: 140 },
  ]);
  await loginAndFund(page);
  await openGames(page);
  await selectFruits(page);
  await expect(page.locator('.fruits-paytable caption')).toHaveText('Три одинаковых на центральной линии');
  const paytableRows = page.locator('.fruits-paytable tbody tr');
  await expect(paytableRows).toHaveCount(4);
  for (let symbol = 0; symbol < FRUIT_SYMBOLS.length; symbol++) {
    await expect(paytableRows.nth(symbol).locator('th')).toContainText(FRUIT_SYMBOLS[symbol]);
    await expect(paytableRows.nth(symbol).locator('td').last()).toContainText(`×${EXPECTED_TRIPLE_RETURNS[symbol]}`);
  }
  await page.locator('#coins-bet').selectOption('100');
  const operations: Request[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/demo-wallet/operations') && request.method() === 'POST') operations.push(request);
  });
  const pendingResponse = operationResponse(page);
  await page.locator('#coins-spin').click();
  const response = await pendingResponse;
  expect(response.ok()).toBe(true);
  expectFruitOperation(response.request().postDataJSON(), 100);
  const result = await response.json() as WalletResult;
  await expectSettledInterface(page, result, 100);
  expect(operations).toHaveLength(1);
  await expect(page.locator('.fruits-paytable')).toBeVisible();
  const box = (await page.locator('.royal-coins').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.royal-coins').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/royal-fruits-mobile.png' });
  await page.locator('#coins-wallet').click();
  await expect(page.locator('#wallet-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="win"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="bet"] span')).toContainText('Royal Fruits');
});

test('a lost Royal Fruits response reloads and retries the identical operation without a second wager', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAndFund(page);
  await openGames(page);
  await selectFruits(page);
  await page.locator('#coins-bet').selectOption('50');
  let original: GamePlayRequest | undefined;
  let retried: GamePlayRequest | undefined;
  let settled: WalletResult | undefined;
  let posts = 0;
  await page.route('**/api/demo-wallet/operations', async route => {
    posts++;
    const operation = route.request().postDataJSON() as GamePlayRequest;
    if (!original) {
      original = operation;
      expectFruitOperation(original, 50);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      settled = await response.json() as WalletResult;
      expectFruitSettlement(settled, 50);
      await route.abort('failed');
    } else {
      retried = operation;
      await route.continue();
    }
  });
  await page.locator('#coins-spin').click();
  await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  for (const selector of ['#coins-game', '#coins-currency', '#coins-bet']) await expect(page.locator(selector)).toBeDisabled();
  await page.reload();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await openGames(page);
  await expect(page.locator('#coins-game')).toHaveValue('royal-fruits');
  await expect(page.locator('#coins-currency')).toHaveValue('demo');
  await expect(page.locator('#coins-bet')).toHaveValue('50');
  await expect(page.locator('.fruits-paytable')).toBeVisible();
  await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  for (const selector of ['#coins-game', '#coins-currency', '#coins-bet']) await expect(page.locator(selector)).toBeDisabled();
  const pendingResponse = operationResponse(page);
  await page.locator('#coins-spin').click();
  const response = await pendingResponse;
  expect(response.ok()).toBe(true);
  const replay = await response.json() as WalletResult;
  expect(retried).toEqual(original);
  expect(replay.gameRound).toEqual(settled!.gameRound);
  expect(replay.wallet.balance).toBe(settled!.wallet.balance);
  const operationEntries = replay.wallet.entries.filter(entry => entry.operationId === original!.id);
  expect(operationEntries).toHaveLength(2);
  expect(operationEntries.map(entry => entry.kind).sort()).toEqual(['bet', 'win']);
  expect(posts).toBe(2);
  await expectSettledInterface(page, replay, 50);
  await expect(page.locator('#coins-game')).toBeEnabled();
  await expect(page.locator('#coins-currency')).toBeEnabled();
  await page.locator('#coins-wallet').click();
  await expect(page.locator('#wallet-balance')).toHaveText(settled!.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="deposit"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="win"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="bet"] span')).toContainText('Royal Fruits');
  await expect(page.locator('#wallet-retry')).toBeHidden();
});

test('Nile and USDT hide Royal Fruits and switch back to Coins without sending a wager', async ({ page }) => {
  const readOnlyUsdtFixture = {
    ...USDT_SCOPE,
    state: 'assigned', address: `T${'1'.repeat(33)}`, senderAddress: `T${'2'.repeat(33)}`,
    balanceUnits: '0', ready: false, updatedAt: 1,
    maxStakeUnits: { 'royal-coins': '0', 'royal-roulette': '0' }, deposits: [], rounds: [],
  };
  expect(validUsdtWallet(readOnlyUsdtFixture)).toBe(true);
  await page.route('**/api/usdt-wallet', route => route.fulfill({ json: readOnlyUsdtFixture }));
  await page.route('**/api/nile-play/wallet', route => route.fulfill({ json: { ...NILE_PLAY_SCOPE, state: 'unassigned' } }));
  await loginAndFund(page);
  await openGames(page);
  await selectFruits(page);
  const wagers: Request[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/(?:demo-wallet\/operations|nile-play\/rounds|usdt-wallet\/rounds)$/.test(new URL(request.url()).pathname)) wagers.push(request);
  });
  const fruitsOption = page.locator('#coins-game option[value="royal-fruits"]');
  for (const currency of ['nile', 'usdt']) {
    const refresh = page.waitForResponse(response => response.request().method() === 'GET' &&
      response.url().endsWith(currency === 'nile' ? '/api/nile-play/wallet' : '/api/usdt-wallet'));
    await page.locator('#coins-currency').selectOption(currency);
    await refresh;
    await expect(page.locator('#coins-game')).toHaveValue('royal-coins');
    await expect(page.locator('.royal-coins')).toHaveAttribute('data-game', 'royal-coins');
    await expect(fruitsOption).toHaveJSProperty('disabled', true);
    await expect(fruitsOption).toHaveJSProperty('hidden', true);
    await expect(page.locator('.fruits-paytable')).toBeHidden();
    await expect(page.locator('#coins-spin')).toBeDisabled();
    expect(wagers).toHaveLength(0);
    await page.locator('#coins-currency').selectOption('demo');
    await expect(fruitsOption).toHaveJSProperty('disabled', false);
    await expect(fruitsOption).toHaveJSProperty('hidden', false);
    await expect(page.locator('#coins-balance')).toHaveText((1000).toLocaleString('ru-RU'));
    await selectFruits(page);
    await expect(page.locator('#coins-spin')).toBeEnabled();
  }
  expect(wagers).toHaveLength(0);
});
