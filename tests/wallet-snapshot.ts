import { expect, type Page } from '@playwright/test';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

export async function walletHeaders(page: Page) {
  const reply = await page.request.get('/api/auth/me'); expect(reply.ok(), await reply.text()).toBe(true);
  const identity = await reply.json(); expect(typeof identity.account?.id).toBe('string');
  return { [WALLET_ACCOUNT_HEADER]: identity.account.id as string };
}
export async function walletSnapshot(page: Page) {
  const reply = await page.request.get('/api/demo-wallet', { headers: await walletHeaders(page) });
  expect(reply.ok(), await reply.text()).toBe(true);
  const snapshot = await reply.json(); expect(Array.isArray(snapshot.entries)).toBe(true);
  expect(typeof snapshot.balance).toBe('number'); return snapshot;
}
