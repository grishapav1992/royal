import { test, expect, type Page } from '@playwright/test';
import type { WalletResult } from '../src/shared/demoWallet';
import type { MinesResult } from '../src/shared/minesGame';

async function loginAndFund(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`live-games-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-live-games-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
}
async function open(page: Page, game: string) {
  await page.locator('#games-tab').click();
  await page.locator(`[data-cabinet="${game}"]`).click();
  await expect(page.locator(`.original-game[data-game="${game}"]`)).toBeVisible({ timeout: 20000 });
}
const responseFor = (page: Page, path: string) => page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'POST');

test('four Originals settle real server wagers into one shared demo balance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginAndFund(page);
  let balanceUnits = 100000n;
  for (const gameId of ['royal-dice', 'royal-plinko', 'royal-limbo', 'royal-keno']) {
    await open(page, gameId);
    await page.locator('#original-bet').selectOption('10');
    const awaiting = responseFor(page, '/api/demo-wallet/operations');
    await page.locator('#original-play').click();
    const response = await awaiting;
    expect(response.ok()).toBe(true);
    const result = await response.json() as WalletResult;
    expect(response.request().postDataJSON()).toMatchObject({ kind: 'play', gameId, amount: 10, rulesVersion: 1 });
    expect(result.gameRound?.gameId).toBe(gameId);
    expect(result.gameRound?.stakeUnits).toBe('1000');
    const payout = BigInt(result.gameRound!.payoutUnits);
    balanceUnits = balanceUnits - 1000n + payout;
    expect(Math.round(result.wallet.balance * 100)).toBe(Number(balanceUnits));
    const requestId = response.request().postDataJSON().id;
    expect(result.wallet.entries.filter(entry => entry.operationId === requestId).map(entry => [entry.kind, Math.round(entry.amount * 100)]).reverse()).toEqual([['bet', -1000], ['win', Number(payout)]]);
    await expect(page.locator('#original-play')).toBeEnabled();
    await expect(page.locator('#original-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
    await expect(page.locator('#original-result')).not.toContainText('подтверждает');
    await expect(page.locator('.original-history-chip')).toHaveCount(1);
    if (gameId === 'royal-plinko') await expect(page.locator(`[data-plinko-bucket="${(result.gameRound as any).outcome.bucket}"]`)).toHaveClass(/is-hit/);
    if (gameId === 'royal-keno') await expect(page.locator('[data-keno-number].is-drawn')).toHaveCount(10);
    await page.screenshot({ path: `artifacts/${gameId}-live.png` });
    await page.locator('#mini-dialog .mini-top [data-close]').click();
  }
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await expect(page.locator('#wallet-balance')).toHaveText((Number(balanceUnits) / 100).toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('Mines real server hides mines, saves the field and settles its actual outcome once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAndFund(page); await open(page, 'royal-mines');
  await page.locator('#original-bet').selectOption('10');
  await page.locator('#original-mine-count').selectOption('1');
  await expect(page.locator('#original-play')).toBeEnabled();
  let awaiting = responseFor(page, '/api/demo-wallet/mines');
  await page.locator('#original-play').click();
  let response = await awaiting;
  expect(response.ok()).toBe(true);
  const started = await response.json() as MinesResult;
  expect(started.wallet.balance).toBe(990);
  expect(started.session?.state).toBe('active');
  expect(started.session).not.toHaveProperty('mineCells');
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await open(page, 'royal-mines');
  await expect(page.locator('#original-bet')).toHaveValue('10');
  await expect(page.locator('#original-mine-count')).toHaveValue('1');
  await expect(page.locator('[data-mine-cell="0"]')).toBeEnabled();
  awaiting = responseFor(page, '/api/demo-wallet/mines');
  await page.locator('[data-mine-cell="0"]').click();
  response = await awaiting; expect(response.ok()).toBe(true);
  let finished = await response.json() as MinesResult;
  expect(finished.session?.id).toBe(started.session?.id);
  if (finished.session?.state === 'active') {
    expect(finished.session).not.toHaveProperty('mineCells');
    expect(finished.session.revealed).toEqual([0]);
    await expect(page.locator('#original-play')).toBeEnabled();
    awaiting = responseFor(page, '/api/demo-wallet/mines');
    await page.locator('#original-play').click();
    response = await awaiting; expect(response.ok()).toBe(true);
    finished = await response.json() as MinesResult;
    expect(finished.session?.state).toBe('cashed_out');
  } else {
    expect(finished.session?.state).toBe('lost');
    expect(finished.session.mineCells).toContain(0);
  }
  expect(finished.wallet.balance).toBe(990 + finished.session!.payout);
  await expect(page.locator('#original-balance')).toHaveText(finished.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#original-play')).toBeEnabled();
  const entries = finished.wallet.entries.filter(entry => entry.operationId === started.session!.id);
  expect(entries.map(entry => entry.kind).sort()).toEqual(['bet', 'win']);
  await expect(page.locator('.original-history-chip')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/royal-mines-live.png' });
});
