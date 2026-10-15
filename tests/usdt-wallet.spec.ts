import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MainnetLedger } from '../server/finance/mainnet-ledger';
import { nileHex } from '../server/finance/nile-address';

async function login(page: Page) {
  const meta = JSON.parse(readFileSync('/tmp/royal-mainnet-ui-fixture.json', 'utf8'));
  await page.goto('/'); await page.getByLabel('Почта', { exact: true }).fill(meta.email); await page.getByLabel('Пароль', { exact: true }).fill(meta.password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#login-step')).toBeHidden();
  if(await page.locator('#character-step').isVisible()){await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();}
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#usdt-wallet-button')).toBeVisible(); return meta;
}
async function coins(page: Page) { await page.locator('#games-tab').click(); await page.locator('[data-cabinet="royal-coins"]').click(); await expect(page.locator('#coins-currency')).toBeVisible(); }
test('deposit, lost winning response, retry, roulette and reload keep one exact USDT balance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); const meta = await login(page);
  await page.locator('#usdt-wallet-button').click(); await expect(page.locator('#usdt-wallet-balance')).toHaveText('0');
  await expect(page.locator('#usdt-wallet-address')).toHaveValue(meta.config.serviceAddress);
  await expect(page.locator('#usdt-wallet-sender')).toHaveValue(meta.config.playerAddress);
  const ledger = new MainnetLedger(meta.dbFile, meta.config);
  try {
    const txId = 'b'.repeat(64); ledger.ingest({ height: 101, hash: 101..toString(16).padStart(16, '0') + 'a'.repeat(48), parentHash: meta.config.anchorHash, timestamp: Date.now(), txIds: [txId], outcomes: [{ txId, status: 'SUCCESS' }],
      transfers: [{ txId, logIndex: 0, contract: meta.config.token, from: nileHex(meta.config.playerAddress), to: nileHex(meta.config.serviceAddress), amountUnits: '10000000' }] });
  } finally { ledger.close(); }
  await expect.poll(async()=>{const r=await page.request.get('/api/usdt-wallet',{headers:{'X-Royal-Account-Id':meta.config.accountId}});return (await r.json()).ready;}).toBe(true);
  await page.locator('#usdt-wallet-refresh').click(); await expect(page.locator('#usdt-wallet-balance')).toHaveText('10');
  await page.screenshot({ path: 'artifacts/usdt-wallet-mobile.png' }); await page.locator('#usdt-wallet-close').click(); await coins(page);
  await expect(page.locator('#coins-currency')).toHaveValue('usdt'); await expect(page.locator('#coins-spin')).toBeEnabled();
  let discarded = false, id = '';
  await page.route('**/api/usdt-wallet/rounds', async route => { const operation = route.request().postDataJSON(); if (!discarded) { discarded = true; id = operation.id; const reply = await route.fetch(); expect(reply.ok()).toBe(true); await route.abort('failed'); } else { expect(operation.id).toBe(id); await route.continue(); } });
  await page.locator('#coins-spin').click(); await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});await coins(page);await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');
  await page.locator('#coins-spin').click(); await expect(page.locator('#coins-balance')).toHaveText('21 USDT');
  await expect(page.locator('#coins-result')).toContainText('Начислено 12 USDT'); await page.unroute('**/api/usdt-wallet/rounds');
  await page.locator('#coins-game').selectOption('royal-roulette'); await page.locator('#roulette-bet').selectOption('number'); await page.locator('#roulette-number').selectOption('0');
  await page.locator('#coins-spin').click(); await expect(page.locator('#coins-balance')).toHaveText('56 USDT'); await expect(page.locator('#coins-result')).toContainText('Выпало 0. Начислено 36 USDT');
  await page.screenshot({ path: 'artifacts/usdt-roulette-mobile.png' });
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 }); await page.locator('#usdt-wallet-button').click();
  await expect(page.locator('#usdt-wallet-balance')).toHaveText('56'); await expect(page.locator('#usdt-wallet-history li')).toHaveCount(1); await expect(page.locator('#usdt-wallet-rounds li')).toHaveCount(2);
});
test('API rejects unauthenticated callers, forged ownership, external origins and client credits', async ({ page, request }) => {
  expect((await request.get('/api/usdt-wallet')).status()).toBe(401); const meta = await login(page);
  const headers = { 'X-Royal-Account-Id': meta.config.accountId };
  expect((await page.request.get('/api/usdt-wallet?accountId=other', { headers })).status()).toBe(400);
  expect((await page.request.get('/api/usdt-wallet', { headers: { 'X-Royal-Account-Id': crypto.randomUUID() } })).status()).toBe(401);
  expect((await page.request.post('/api/usdt-wallet/deposit', { headers, data: { amountUnits: '1000000000' } })).status()).toBe(400);
  const data = { id: crypto.randomUUID(), gameId: 'royal-coins', input: {}, stakeUnits: '1000000' };
  expect((await page.request.post('/api/usdt-wallet/rounds', { headers, data: { ...data, payoutUnits: '999999999' } })).status()).toBe(400);
  expect((await page.request.post('/api/usdt-wallet/rounds', { headers: { ...headers, Origin: 'https://evil.example' }, data })).status()).toBe(403);
});
test('unconfirmed USDT hides addresses and balances and blocks fresh wagers', async ({ page }) => {
  const meta = await login(page);
  const wallet=await(await page.request.get('/api/usdt-wallet',{headers:{'X-Royal-Account-Id':meta.config.accountId}})).json();
  await page.route('**/api/usdt-wallet', route => route.fulfill({ json: { ...wallet, ready: false } }));
  await page.locator('#usdt-wallet-button').click(); await expect(page.locator('#usdt-wallet-content')).toBeHidden();
  await expect(page.locator('#usdt-wallet-address')).toHaveValue(''); await expect(page.locator('#usdt-wallet-message')).toContainText('временно недоступно');
  await page.locator('#usdt-wallet-close').click(); await coins(page); await page.locator('#coins-currency').selectOption('usdt');
  await expect(page.locator('#coins-spin')).toBeDisabled(); await expect(page.locator('#coins-balance')).toHaveText('…'); expect(meta.config.network).toBe('tron-mainnet');
});
