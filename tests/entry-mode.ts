import type { Page } from '@playwright/test';

export function selectEntryMode(page: Page, mode: 'club' | 'casino' = 'club') {
  return page.locator(`.entry-options [data-entry-mode="${mode}"]`).click();
}

/** Reads the room test hook without failing while the club bundle is still loading after the entry choice. */
export function roomState(page: Page) {
  return page.evaluate(() => (window as any).royalDemo?.getState() ?? null);
}

/** Network state through the same hook; null until the club bundle has loaded. */
export function roomNetwork(page: Page) {
  return page.evaluate(() => (window as any).royalDemo?.getNetworkState() ?? null);
}

/** The bar button walks the player to Mira only once the room world exists; wait for it instead of clicking into a no-op. */
export async function openBar(page: Page) {
  const dialog = page.locator('#bar-dialog');
  await page.waitForFunction(() => Boolean((window as any).royalDemo?.isWorldLoaded?.()), undefined, { timeout: 30000 });
  for (let attempt = 0; attempt < 6 && !(await dialog.isVisible()); attempt++) {
    await page.locator('#visit-bar').click();
    await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }
  await dialog.waitFor({ state: 'visible', timeout: 1000 });
}

/** Opens the player menu in the header, where account, outfit, settings and sign-out live. */
export async function openPlayerMenu(page: Page) {
  const menu = page.locator('#profile-menu');
  if (!(await menu.count())) return;
  if (!(await menu.evaluate(element => element.matches(':popover-open')))) await page.locator('.profile-toggle').click();
}

/** On phones the wallets and room tools sit in the player menu; open it when the item is not in the header row. */
export async function revealHeaderItem(page: Page, selector: string) {
  if (!(await page.locator(selector).isVisible())) await openPlayerMenu(page);
}
