import { test, expect, type Page } from '@playwright/test';
import { prepareGame } from '../server/games/core';
import jsQR from 'jsqr';

async function readPaymentQr(page: Page) {
  const pixels = await page.locator('#crypto-deposit-qr').evaluate(async element => {
    const image = element as HTMLImageElement; await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(image.getBoundingClientRect().width - 16);
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data), width: canvas.width, height: canvas.height };
  });
  return jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`crypto-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Crypto-test-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
}
const wallet = () => ({ state: 'enabled', provider: 'nowpayments', asset: 'USDT', scale: 6, balanceUnits: '20000000', reservedUnits: '0',
  withdrawalsEnabled: true, gamesEnabled: true, ready: true, maxStakeUnits: { 'royal-coins': '10000000', 'royal-roulette': '10000000' }, operations: [] as any[], rounds: [] as any[] });

test('disabled gateway displays the deposit form without a payable address or QR', async ({ page }) => {
  await login(page); await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-wallet-message')).toContainText('еще не подключены');
  await expect(page.locator('#crypto-wallet-content')).toBeHidden();
  await expect(page.locator('#crypto-deposit-address')).toHaveValue('');
  await expect(page.locator('#crypto-deposit-form')).toBeVisible();
  await expect(page.locator('#crypto-deposit-form button')).toBeDisabled();
  await expect(page.locator('#crypto-deposit-qr-placeholder')).toBeVisible();
  await expect(page.locator('#crypto-deposit-qr')).not.toHaveAttribute('src');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/crypto-qr/disabled-form-mobile.png' });
});
test('mobile deposit restores a lost response with the same request, displays memo and safely renders currency names', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = wallet(); let firstId = '', attempts = 0;
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [
    { code: 'xrp', name: '<img onerror=alert(1)> XRP', network: 'xrp', memo: true }, { code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }] } }));
  await page.route('**/api/crypto-wallet/deposits', async route => {
    const request = route.request().postDataJSON(); attempts++;
    if (!firstId) firstId = request.id; expect(request.id).toBe(firstId);
    const operation = { id: request.id, kind: 'deposit', state: 'waiting', amountUnits: request.amountUnits, creditedUnits: '0',
      currency: request.currency, address: 'r' + 'A'.repeat(33), memo: '1234567', payAmount: '40', txHash: '', createdAt: Date.now() };
    state.operations = [operation];
    if (attempts === 1) await route.abort('failed'); else await route.fulfill({ json: operation });
  });
  await login(page); await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-deposit-currency option')).toHaveCount(2);
  await page.locator('#crypto-deposit-currency').selectOption('xrp');
  await page.locator('#crypto-deposit-form button').click();
  await expect(page.locator('#crypto-wallet-retry')).toBeVisible();
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#crypto-wallet-button').click(); await page.locator('#crypto-wallet-retry').click();
  await expect(page.locator('#crypto-wallet-retry')).toBeHidden(); expect(attempts).toBe(2);
  await expect(page.locator('#crypto-deposit-address')).toHaveValue('r' + 'A'.repeat(33));
  await expect(page.locator('#crypto-deposit-memo-value')).toHaveValue('1234567');
  await expect(page.locator('#crypto-deposit-network')).toContainText('Сеть: XRP');
  await expect(page.locator('#crypto-deposit-qr-note')).toContainText('memo укажи отдельно');
  expect(await readPaymentQr(page)).toBe('r' + 'A'.repeat(33));
  await expect(page.locator('#crypto-payment-dialog')).toBeVisible();
  const box = (await page.locator('#crypto-payment-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.locator('#crypto-payment-dialog').evaluate(dialog => { dialog.scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/nowpayments/crypto-wallet-mobile.png' });
  await page.locator('#crypto-deposit-qr').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/crypto-qr/payment-qr-mobile.png' });
});
test('QR follows the created payment, remains bound when the form changes, and clears on expiry and account change', async ({ page }) => {
  const state = wallet();
  const bitcoin = 'bc1q' + 'a'.repeat(38), tron = 'T' + 'B'.repeat(33);
  const deposit = { id: crypto.randomUUID(), kind: 'deposit', state: 'waiting', amountUnits: '20000000', creditedUnits: '0',
    currency: 'btc', address: bitcoin, memo: '', payAmount: '0.0002', txHash: '', createdAt: Date.now() };
  state.operations = [deposit];
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [
    { code: 'btc', name: 'Bitcoin', network: 'btc', memo: false }, { code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }] } }));
  await login(page); await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-deposit-currency option')).toHaveCount(2);
  await page.locator('#crypto-deposit-continue').click();
  expect(await readPaymentQr(page)).toBe(bitcoin);
  await page.locator('#crypto-payment-close').click();
  await page.locator('#crypto-deposit-currency').selectOption('usdttrc20');
  await page.locator('#crypto-deposit-continue').click();
  expect(await readPaymentQr(page)).toBe(bitcoin);
  await expect(page.locator('#crypto-deposit-network')).toContainText('Сеть: BTC');
  state.operations = [{ ...deposit, id: crypto.randomUUID(), currency: 'usdttrc20', address: tron, payAmount: '20' }];
  await page.locator('#crypto-payment-refresh').click();
  await expect(page.locator('#crypto-deposit-address')).toHaveValue(bitcoin);
  expect(await readPaymentQr(page)).toBe(bitcoin);
  state.operations.push({ ...deposit, state: 'expired' }); await page.locator('#crypto-payment-refresh').click();
  await expect(page.locator('#crypto-deposit-details')).toBeHidden();
  await expect(page.locator('#crypto-deposit-qr')).not.toHaveAttribute('src');
  await page.locator('#crypto-payment-close').click();
  await page.locator('#crypto-deposit-continue').click();
  await expect(page.locator('#crypto-deposit-address')).toHaveValue(tron);
  expect(await readPaymentQr(page)).toBe(tron);
  await expect(page.locator('#crypto-deposit-network')).toContainText('Сеть: TRX');
  await expect(page.locator('#crypto-deposit-memo')).toBeHidden();
  state.operations[0].state = 'expired'; await page.locator('#crypto-payment-refresh').click();
  await expect(page.locator('#crypto-deposit-details')).toBeHidden();
  await expect(page.locator('#crypto-deposit-qr')).not.toHaveAttribute('src');
  state.operations[0].state = 'waiting'; await page.locator('#crypto-payment-refresh').click();
  await expect(page.locator('#crypto-deposit-address')).toHaveValue(tron);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('royal-account', { detail: null })));
  await expect(page.locator('#crypto-deposit-address')).toHaveValue('');
  await expect(page.locator('#crypto-deposit-qr')).not.toHaveAttribute('src');
});
test('withdrawal requires a server quote and explicit confirmation; changed details invalidate the quote', async ({ page }) => {
  const state = wallet(); let payouts = 0;
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [{ code: 'sol', name: 'Solana', network: 'sol', memo: false }] } }));
  await page.route('**/api/crypto-wallet/quotes', route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { ...request, estimatedAmount: '0.05', networkFee: '0.001', minimumReceive: '0.0475', expiresAt: Date.now() + 120000 } });
  });
  await page.route('**/api/crypto-wallet/withdrawals', route => {
    const request = route.request().postDataJSON(); payouts++;
    const operation = { id: request.id, kind: 'withdrawal', state: 'processing', amountUnits: '10000000', creditedUnits: '0', currency: 'sol',
      address: 'TestSolanaWalletAddress', memo: '', payAmount: '0.048', txHash: '', createdAt: Date.now() };
    state.balanceUnits = '10000000'; state.reservedUnits = '10000000'; state.operations = [operation];
    return route.fulfill({ json: operation });
  });
  await login(page); await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-withdraw-currency option')).toHaveCount(1);
  await page.locator('#crypto-withdraw-address').fill('TestSolanaWalletAddress'); await page.locator('#crypto-withdraw-form button').click();
  await expect(page.locator('#crypto-withdraw-preview')).toBeVisible(); expect(payouts).toBe(0);
  await page.locator('#crypto-withdraw-amount').fill('11'); await expect(page.locator('#crypto-withdraw-preview')).toBeHidden();
  await page.locator('#crypto-withdraw-amount').fill('10'); await page.locator('#crypto-withdraw-form button').click();
  await expect(page.locator('#crypto-withdraw-calculation')).toContainText('Минимум к отправке: 0.0475');
  await page.locator('#crypto-withdraw-confirm').click(); await expect(page.locator('#crypto-wallet-reserved')).toContainText('10 USDT');
  expect(payouts).toBe(1); await expect(page.locator('#crypto-wallet-balance')).toHaveText('10');
});
test('country currency is an estimate, checkout stays in USDT and shows confirmed credit inside the payment modal', async ({ page }) => {
  const state = wallet(); let creates = 0;
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }] } }));
  await page.route('**/api/crypto-wallet/display-rate', route => {
    const { currency } = route.request().postDataJSON(); const updatedAt = Date.now();
    return route.fulfill({ json: { currency, usdtRate: '85', updatedAt, expiresAt: updatedAt + 60000 } });
  });
  await page.route('**/api/crypto-wallet/deposits', route => {
    const request = route.request().postDataJSON(); creates++;
    expect(request.amountUnits).toBe('20000000'); expect(request.currency).toBe('usdttrc20');
    const operation = { id: request.id, kind: 'deposit', state: 'waiting', amountUnits: request.amountUnits, creditedUnits: '0',
      currency: request.currency, address: 'T' + 'C'.repeat(33), memo: '', payAmount: '20', txHash: '', createdAt: Date.now() };
    state.operations = [operation]; return route.fulfill({ json: operation });
  });
  await login(page); await expect(page.locator('#crypto-wallet-button')).toHaveText('Пополнить баланс');
  await page.locator('#crypto-wallet-button').click();
  await expect(page.locator('#crypto-display-currency')).toHaveValue('USDT');
  await page.locator('#crypto-display-currency').selectOption('RUB');
  await expect(page.locator('#crypto-wallet-balance')).toHaveText('≈ 1700.00');
  await expect(page.locator('#crypto-deposit-equivalent')).toHaveText('≈ 1700.00 RUB до комиссий');
  await expect(page.locator('#crypto-display-rate-note')).toContainText('Расчет NOWPayments');
  await page.getByRole('button', { name: 'Оплатить', exact: true }).click();
  await expect(page.locator('#crypto-payment-dialog')).toBeVisible(); expect(creates).toBe(1);
  expect(await readPaymentQr(page)).toBe('T' + 'C'.repeat(33));
  await expect(page.locator('#crypto-payment-message')).toHaveText('Ожидает перевода');
  await page.screenshot({ path: 'artifacts/balance-checkout/payment-modal.png' });
  state.operations[0].state = 'finished'; state.operations[0].creditedUnits = '19000000'; state.balanceUnits = '39000000';
  await page.locator('#crypto-payment-refresh').click();
  await expect(page.locator('#crypto-payment-result')).toHaveText('На баланс зачислено 19 USDT.');
  await expect(page.locator('#crypto-deposit-qr')).not.toHaveAttribute('src');
  await page.locator('#crypto-payment-close').click();
  await expect(page.locator('#crypto-wallet-balance')).toHaveText('≈ 3315.00');
  await expect(page.locator('#crypto-wallet-usdt')).toHaveText('Баланс в USDT: 39');
  await page.locator('#crypto-display-currency').selectOption('USDT');
  await expect(page.locator('#crypto-wallet-balance')).toHaveText('39'); expect(creates).toBe(1);
});
test('unavailable or expired display rates show USDT without blocking the payment form', async ({ page }) => {
  const state = wallet();
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await page.route('**/api/crypto-wallet/currencies', route => route.fulfill({ json: { currencies: [{ code: 'usdttrc20', name: 'USDT', network: 'trx', memo: false }] } }));
  await page.route('**/api/crypto-wallet/display-rate', route => route.fulfill({ json: { currency: 'RUB', usdtRate: '85', updatedAt: Date.now() - 120000, expiresAt: Date.now() - 60000 } }));
  await login(page); await page.locator('#crypto-wallet-button').click();
  await page.locator('#crypto-display-currency').selectOption('RUB');
  await expect(page.locator('#crypto-display-rate-note')).toContainText('Курс сейчас недоступен');
  await expect(page.locator('#crypto-wallet-balance')).toHaveText('20');
  await expect(page.locator('#crypto-wallet-balance-unit')).toHaveText('USDT доступно');
  await expect(page.locator('#crypto-deposit-equivalent')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Оплатить', exact: true })).toBeEnabled();
});
test('crypto game retry after reload keeps the original bet id and one round', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); const state = wallet(); let attempts = 0, id = '';
  await page.route('**/api/crypto-wallet', route => route.fulfill({ json: state }));
  await page.route('**/api/crypto-wallet/rounds', async route => {
    const request = route.request().postDataJSON(); attempts++;
    if (!id) {
      id = request.id;
      const round = { ...prepareGame(request.gameId, 1, request.input).play(BigInt(request.stakeUnits), () => 0), id, createdAt: Date.now() };
      state.rounds = [round]; state.balanceUnits = '31000000';
    }
    expect(request.id).toBe(id);
    if (attempts === 1) await route.abort('failed'); else await route.fulfill({ json: { wallet: state, round: state.rounds[0], replayed: true } });
  });
  await login(page); await expect(page.locator('#crypto-wallet-button')).toHaveText('Пополнить баланс');
  await page.locator('#games-tab').click(); await page.locator('[data-cabinet="royal-coins"]').click();
  await expect(page.locator('#coins-currency')).toHaveValue('crypto');
  await page.locator('#coins-spin').click(); await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await page.locator('#games-tab').click(); await page.locator('[data-cabinet="royal-coins"]').click();
  await page.locator('#coins-spin').click(); await expect(page.locator('#coins-balance')).toHaveText('31 USDT');
  expect(attempts).toBe(2); expect(state.rounds).toHaveLength(1);
});
