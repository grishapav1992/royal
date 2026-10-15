import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import type { WalletResult } from '../src/shared/demoWallet';
import type { FlightResult } from '../src/shared/flightGame';

async function login(page: Page, roomPath: string) {
  await page.goto(roomPath);
  await page.getByLabel('Почта', { exact: true }).fill(`themed-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-themed-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click();
  await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
}
async function open(page: Page, id: 'royal-flight' | 'royal-wheel') {
  await page.locator('#games-tab').click();
  await page.locator(`[data-cabinet="${id}"]`).click();
  await expect(page.locator(`.themed-game[data-game="${id}"]`)).toBeVisible({ timeout: 20000 });
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }
async function checkMobile(page: Page, id: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('.themed-game').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.themed-game').evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  await page.locator('#themed-play').scrollIntoViewIfNeeded();
  await expect(page.locator('#themed-play')).toBeVisible();
  await page.screenshot({ path: `artifacts/themed-games/${id}-mobile.png` });
}

test('Royal Fortune uses the real server outcome and ledger for every risk', async ({ page, baseURL, roomPath }) => {
  const errors: string[] = [], rounds: WalletResult[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== new URL(baseURL!).origin) external.push(url.href);
  });
  page.on('response', async response => {
    if (response.url().endsWith('/api/demo-wallet/operations') && response.request().postDataJSON()?.gameId === 'royal-wheel' && response.ok()) rounds.push(await response.json());
  });
  await login(page, roomPath); await open(page, 'royal-wheel');
  await expect(page.locator('#mini-title')).toHaveText('Royal Fortune');
  let balance = 1000;
  for (const risk of ['low', 'medium', 'high']) {
    await page.locator('#themed-risk').selectOption(risk);
    await expect(page.locator('#themed-play')).toBeEnabled();
    await page.locator('#themed-play').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => rounds.length).toBe(['low', 'medium', 'high'].indexOf(risk) + 1);
    await expect(page.locator('#themed-result')).toContainText(/Сектор \d+ из 50/);
    await expect(page.locator('#themed-play')).toBeEnabled();
    const result = rounds.at(-1)!;
    expect(result.gameRound!.gameId).toBe('royal-wheel');
    if (result.gameRound!.gameId !== 'royal-wheel') throw new Error('Wrong round');
    expect(result.gameRound!.input.risk).toBe(risk);
    await expect(page.locator('#themed-canvas')).toHaveAttribute('data-segment', String(result.gameRound!.outcome.segment));
    const rotation = Number(await page.locator('#themed-canvas').getAttribute('data-rotation'));
    const pointerSegment = ((Math.round(-rotation / (Math.PI * 2 / 50)) % 50) + 50) % 50;
    expect(pointerSegment).toBe(result.gameRound!.outcome.segment);
    const payout = Number(result.gameRound!.payoutUnits) / 100;
    balance += payout - 100;
    expect(result.wallet.balance).toBe(balance);
    await expect(page.locator('#themed-balance')).toHaveText(balance.toLocaleString('ru-RU'));
    const newestBet = result.wallet.entries.find(entry => entry.source === 'royal-wheel' && entry.kind === 'bet')!;
    expect(result.wallet.entries.filter(entry => entry.operationId === newestBet.operationId && entry.kind === 'bet')).toHaveLength(1);
    expect(result.wallet.entries.filter(entry => entry.operationId === newestBet.operationId && entry.kind === 'win')).toHaveLength(1);
    if (risk === 'high') await expect(page.locator('#themed-paytable')).toContainText('49,00×');
  }
  await page.screenshot({ path: 'artifacts/themed-games/royal-wheel-desktop.png' });
  await checkMobile(page, 'royal-wheel');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('Royal Orbit settles an automatic target after closing and reloading', async ({ page, roomPath }) => {
  const errors: string[] = [], starts: FlightResult[] = [];
  let account = '';
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/api/demo-wallet/flight')) account = request.headers()['x-royal-account-id'] || account; });
  page.on('response', async response => {
    if (response.url().endsWith('/api/demo-wallet/flight') && response.request().method() === 'POST' && response.ok()) starts.push(await response.json());
  });
  await login(page, roomPath); await open(page, 'royal-flight');
  await expect(page.locator('#mini-title')).toHaveText('Royal Orbit');
  await expect(page.locator('#themed-play')).toBeEnabled();
  await page.locator('#themed-target').fill('0.9'); await expect(page.locator('#themed-play')).toBeDisabled();
  await page.locator('#themed-target').fill('1.10'); await expect(page.locator('#themed-play')).toBeEnabled();
  await page.locator('#themed-play').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => starts.length).toBe(1);
  const id = starts[0].session!.id;
  expect(Object.keys(starts[0].session!)).not.toContain('crash_cents');
  await close(page); await page.reload();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await open(page, 'royal-flight');
  await expect(page.locator('#themed-result')).toContainText(/Начислено|Без выплаты/);
  const result = await page.evaluate(async accountId => {
    const response = await fetch('/api/demo-wallet/flight', { headers: { 'x-royal-account-id': accountId } });
    if (!response.ok) throw new Error(`Flight HTTP ${response.status}`);
    return response.json();
  }, account) as FlightResult;
  expect(result.session!.id).toBe(id); expect(result.session!.state).not.toBe('active');
  expect(result.session!.reason).toBe(result.session!.state === 'lost' ? 'crash' : 'auto');
  expect(result.session!.payout).toBe(result.session!.state === 'lost' ? 0 : 110);
  expect(result.wallet.balance).toBe(900 + result.session!.payout);
  const entries = result.wallet.entries.filter(entry => entry.operationId === id);
  expect(entries.filter(entry => entry.kind === 'bet')).toHaveLength(1);
  expect(entries.filter(entry => entry.kind === 'win')).toHaveLength(1);
  await page.screenshot({ path: 'artifacts/themed-games/royal-flight-desktop.png' });
  await checkMobile(page, 'royal-flight');
  expect(starts).toHaveLength(1); expect(errors).toEqual([]);
});
