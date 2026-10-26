import { expect, type Page } from '@playwright/test';

export async function sandboxTopUp(page: Page, amount: number) {
  const gameButton = page.locator('[data-wallet-open]:visible');
  if (await gameButton.count()) await gameButton.first().click();
  else await page.locator('#wallet-button').click();
  await expect(page.locator('#nowpayments-sandbox')).toBeVisible();
  await page.locator('#sandbox-amount').fill(String(amount));
  await page.locator('#sandbox-deposit button').click();
  await expect(page.locator('#wallet-balance')).toHaveText(amount.toLocaleString('ru-RU'), { timeout: 30000 });
  await page.locator('#wallet-close').click();
}
