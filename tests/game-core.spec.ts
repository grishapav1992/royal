import { test, expect, type Page } from '@playwright/test';
import { COINS_THEMES } from '../src/shared/gameThemes';

async function loginAndFund(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`game-core-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Game-core-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
}
async function openGames(page: Page) {
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="royal-coins"]').click();
  await expect(page.locator('#coins-spin')).toBeEnabled({ timeout: 15000 });
}
const operationResponse = (page: Page) => page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/operations') && response.request().method() === 'POST');

test('changing a slot theme preserves symbol identities, the settled balance and the rules', async ({ page }) => {
  await loginAndFund(page); await openGames(page);
  await expect(page.locator('.coins-rtp')).toContainText('96%');
  await page.locator('#coins-theme').selectOption('cosmic');
  await expect(page.locator('.royal-coins')).toHaveAttribute('data-theme', 'cosmic');
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/demo-wallet/operations') && request.method() === 'POST') requests++; });
  const response = operationResponse(page); await page.locator('#coins-spin').click();
  const reply = await response, sent = reply.request().postDataJSON(), result = await reply.json();
  expect(sent.kind).toBe('spin'); expect(sent).not.toHaveProperty('theme'); expect(sent).not.toHaveProperty('themeId');
  await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  const symbolIds = result.gameRound.outcome.symbols as number[];
  await expect(page.locator('.coins-reels span')).toHaveText(symbolIds.map(id => COINS_THEMES[1].symbols[id]));
  await page.locator('#coins-theme').selectOption('classic');
  await expect(page.locator('.coins-reels span')).toHaveText(symbolIds.map(id => COINS_THEMES[0].symbols[id]));
  await expect(page.locator('#coins-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('.coins-rules')).toContainText('Оформление не меняет правила и выплаты');
  expect(requests).toBe(1);
});

test('roulette settles a selected number on the shared wallet and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAndFund(page); await openGames(page);
  await page.locator('#coins-game').selectOption('royal-roulette');
  await expect(page.locator('.coins-reels')).toBeHidden();
  await expect(page.locator('#coins-theme')).toBeHidden();
  await expect(page.locator('.coins-rtp')).toContainText('97,3%');
  await expect(page.locator('.coins-rules')).toContainText('Ноль проигрывает всем ставкам, кроме ставки на число 0');
  await page.locator('#roulette-bet').selectOption('number');
  await page.locator('#roulette-number').selectOption('0');
  await page.locator('#coins-bet').selectOption('50');
  const response = operationResponse(page); await page.locator('#coins-spin').click();
  const reply = await response, result = await reply.json();
  expect(reply.request().postDataJSON()).toMatchObject({ kind: 'play', gameId: 'royal-roulette', rulesVersion: 1, input: { bet: 'number', number: 0 }, amount: 50 });
  expect(result.gameRound.stakeUnits).toBe('5000');
  expect(result.gameRound.payoutUnits).toBe(result.gameRound.outcome.number === 0 ? '180000' : '0');
  expect(result.wallet.balance).toBe(950 + Number(result.gameRound.payoutUnits) / 100);
  await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  await expect(page.locator('.roulette-number')).toHaveText(String(result.gameRound.outcome.number));
  await expect(page.locator('#coins-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  const box = (await page.locator('.royal-coins').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.royal-coins').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator('.roulette-wheel')).toBeVisible();
  await page.locator('#coins-currency').selectOption('nile');
  await expect(page.locator('#coins-game')).toHaveValue('royal-coins');
  await expect(page.locator('#coins-game option[value="royal-roulette"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#coins-game option[value="royal-roulette"]')).toHaveJSProperty('hidden', true);
});

test('a lost roulette response restores the exact wager after reload and retries it once', async ({ page }) => {
  await loginAndFund(page); await openGames(page);
  await page.locator('#coins-game').selectOption('royal-roulette');
  await page.locator('#roulette-bet').selectOption('number');
  await page.locator('#roulette-number').selectOption('17');
  await page.locator('#coins-bet').selectOption('50');
  let original: any, settled: any, recovered: any;
  await page.route('**/api/demo-wallet/operations', async route => {
    if (!original) {
      original = route.request().postDataJSON();
      const response = await route.fetch(); expect(response.ok()).toBe(true); settled = await response.json();
      await route.abort('failed');
    } else { recovered = route.request().postDataJSON(); await route.continue(); }
  });
  await page.locator('#coins-spin').click();
  await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  await expect(page.locator('#coins-game')).toBeDisabled();
  await expect(page.locator('#coins-currency')).toBeDisabled();
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await openGames(page);
  await expect(page.locator('#coins-game')).toHaveValue('royal-roulette');
  await expect(page.locator('#roulette-bet')).toHaveValue('number');
  await expect(page.locator('#roulette-number')).toHaveValue('17');
  await expect(page.locator('#coins-bet')).toHaveValue('50');
  for (const selector of ['#coins-game', '#coins-currency', '#coins-bet', '#roulette-bet', '#roulette-number']) await expect(page.locator(selector)).toBeDisabled();
  const response = operationResponse(page); await page.locator('#coins-spin').click(); const replay = await (await response).json();
  expect(recovered).toEqual(original); expect(replay.gameRound).toEqual(settled.gameRound); expect(replay.wallet.balance).toBe(settled.wallet.balance);
  await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  await expect(page.locator('#coins-game')).toBeEnabled();
  await expect(page.locator('#coins-balance')).toHaveText(settled.wallet.balance.toLocaleString('ru-RU'));
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="win"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="bet"] span')).toContainText('Roulette');
  await expect(page.locator('#wallet-retry')).toBeHidden();
});

test('wallet recovery also replays the whole game request without losing its input', async ({ page }) => {
  await loginAndFund(page); await openGames(page);
  await page.locator('#coins-game').selectOption('royal-roulette');
  await page.locator('#roulette-bet').selectOption('black');
  let original: any, recovered: any;
  await page.route('**/api/demo-wallet/operations', async route => {
    if (!original) { original = route.request().postDataJSON(); await route.fetch(); await route.abort('failed'); }
    else { recovered = route.request().postDataJSON(); await route.continue(); }
  });
  await page.locator('#coins-spin').click(); await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  await page.locator('#coins-wallet').click();
  await expect(page.locator('#wallet-retry')).toBeEnabled();
  const response = operationResponse(page); await page.locator('#wallet-retry').click(); const result = await (await response).json();
  expect(recovered).toEqual(original); expect(recovered.input).toEqual({ bet: 'black' });
  await expect(page.locator('#wallet-retry')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  await expect(page.locator('.roulette-number')).toHaveText(String(result.gameRound.outcome.number));
  await expect(page.locator('#coins-result')).toContainText(`Выпало ${result.gameRound.outcome.number},`);
  await expect(page.locator('#coins-result')).not.toContainText('Ответ не получен');
  await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  await expect(page.locator('.royal-coins')).not.toHaveClass(/spinning/);
});
