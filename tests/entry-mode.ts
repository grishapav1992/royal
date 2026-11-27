import type { Page } from '@playwright/test';

export function selectEntryMode(page: Page, mode: 'club' | 'casino' = 'club') {
  return page.locator(`.entry-options [data-entry-mode="${mode}"]`).click();
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
