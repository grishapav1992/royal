import { test, expect } from '@playwright/test';
import { verifyHallLayout } from './hall-layout-smoke';

test('casino cabinets are reachable, Luelon is on the second floor and both halls keep their activities', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`layout-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-layout-test-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await verifyHallLayout(page, 'artifacts/layout-release');
  expect(errors).toEqual([]);
});
