import type { Page } from '@playwright/test';

export function selectEntryMode(page: Page, mode: 'club' | 'casino' = 'club') {
  return page.locator(`.entry-options [data-entry-mode="${mode}"]`).click();
}
