import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import type { DemoWallet } from '../src/shared/demoWallet';
import type { FlightOperation, FlightResult, FlightSession } from '../src/shared/flightGame';
import type { FlightClient } from '../src/wallet/FlightClient';
import type { WalletClient } from '../src/wallet/WalletClient';

declare global {
  interface Window {
    royalThemedSecurity: { flightClient: FlightClient; demoWallet: WalletClient };
    themedFailure?: string;
  }
}
let browserCode = '';
test.beforeAll(async () => {
  const output = await build({
    stdin: { contents: 'export { flightClient } from "./src/wallet/FlightClient.ts"; export { demoWallet } from "./src/wallet/WalletClient.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'royalThemedSecurity', platform: 'browser',
  });
  browserCode = output.outputFiles[0].text;
});

async function fixture(page: Page, mode: 'lost' | 'delayed') {
  const wallets = new Map<string, DemoWallet>([['account-a', { balance: 1000, entries: [] }], ['account-b', { balance: 321, entries: [] }]]);
  const sessions = new Map<string, FlightSession>();
  const receipts = new Map<string, FlightResult>();
  const posts: { account: string; operation: FlightOperation }[] = [];
  const unexpected: string[] = [];
  let first = true, release: (() => void) | undefined;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const account = request.headers()['x-royal-account-id'];
    if (url.pathname === '/__themed_security__') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Royal client verification</title>' }); return;
    }
    if (url.pathname === '/api/demo-wallet' && wallets.has(account)) {
      await route.fulfill({ json: wallets.get(account) }); return;
    }
    if (url.pathname === '/api/demo-wallet/flight' && wallets.has(account)) {
      if (request.method() === 'GET') {
        await route.fulfill({ json: { wallet: wallets.get(account), session: sessions.get(account) ?? null, serverNow: Date.now() } }); return;
      }
      const operation = request.postDataJSON() as FlightOperation;
      posts.push({ account, operation });
      const key = `${account}:${operation.id}`;
      if (!receipts.has(key)) {
        const wallet = wallets.get(account)!;
        if (operation.action !== 'start') throw new Error('Fixture only starts flights');
        wallet.balance -= operation.amount;
        wallet.entries.unshift({ id: 1, kind: 'bet', amount: -operation.amount, balance: wallet.balance, operationId: operation.id, createdAt: Date.now(), source: 'royal-flight' });
        const session: FlightSession = { id: operation.id, state: 'active', amount: operation.amount, autoCashout: operation.autoCashout, startedAt: Date.now(), multiplier: 1, cashoutValue: operation.amount, payout: 0, settledAt: null, reason: null };
        sessions.set(account, session);
        receipts.set(key, structuredClone({ wallet, session, serverNow: Date.now() }));
      }
      if (first) {
        first = false;
        if (mode === 'lost') { await route.abort('failed'); return; }
        await new Promise<void>(resolve => { release = resolve; });
      }
      await route.fulfill({ json: receipts.get(key) }); return;
    }
    unexpected.push(url.href); await route.abort();
  });
  await page.goto('/__themed_security__');
  await page.addScriptTag({ content: browserCode });
  await page.evaluate(async () => { const { demoWallet } = window.royalThemedSecurity; demoWallet.setAccount('account-a'); await demoWallet.refresh(); });
  await page.waitForFunction(() => window.royalThemedSecurity.flightClient.ready);
  return { wallets, sessions, posts, unexpected, release: () => release?.() };
}

test('an uncertain flight keeps one UUID after reload and cannot block another account', async ({ page }) => {
  const state = await fixture(page, 'lost');
  await page.evaluate(async () => {
    try { await window.royalThemedSecurity.flightClient.act({ action: 'start', amount: 100, autoCashout: 2 }); }
    catch (error) { window.themedFailure = String(error); }
  });
  expect(state.posts).toHaveLength(1);
  const id = state.posts[0].operation.id;
  expect(await page.evaluate(() => window.royalThemedSecurity.demoWallet.externalBusy)).toBe(true);
  await page.reload(); await page.addScriptTag({ content: browserCode });
  await page.evaluate(async () => { const { demoWallet } = window.royalThemedSecurity; demoWallet.setAccount('account-b'); await demoWallet.refresh(); });
  await page.waitForFunction(() => window.royalThemedSecurity.flightClient.ready);
  expect(await page.evaluate(() => ({ pending: !!window.royalThemedSecurity.flightClient.pending, balance: window.royalThemedSecurity.demoWallet.wallet?.balance, busy: window.royalThemedSecurity.demoWallet.externalBusy }))).toEqual({ pending: false, balance: 321, busy: false });
  await page.evaluate(() => window.royalThemedSecurity.demoWallet.setAccount('account-a'));
  await page.waitForFunction(() => window.royalThemedSecurity.flightClient.ready);
  expect(await page.evaluate(() => window.royalThemedSecurity.flightClient.pending?.id)).toBe(id);
  await page.evaluate(() => window.royalThemedSecurity.flightClient.retry());
  expect(state.posts).toHaveLength(2); expect(state.posts[1].operation.id).toBe(id);
  expect(state.wallets.get('account-a')!.balance).toBe(900);
  expect(state.wallets.get('account-a')!.entries).toHaveLength(1);
  expect(state.wallets.get('account-b')!.balance).toBe(321);
  expect(await page.evaluate(() => sessionStorage.getItem('royal-flight-operation:account-a'))).toBeNull();
  expect(state.unexpected).toEqual([]);
  await page.evaluate(() => window.royalThemedSecurity.demoWallet.setAccount(null));
});

test('a late flight response cannot change the new account wallet or result', async ({ page }) => {
  const state = await fixture(page, 'delayed');
  await page.evaluate(() => { void window.royalThemedSecurity.flightClient.act({ action: 'start', amount: 100, autoCashout: 2 }).catch(error => { window.themedFailure = String(error); }); });
  await expect.poll(() => state.posts.length).toBe(1);
  await page.evaluate(async () => { const { demoWallet } = window.royalThemedSecurity; demoWallet.setAccount('account-b'); await demoWallet.refresh(); });
  await page.waitForFunction(() => window.royalThemedSecurity.flightClient.ready);
  state.release();
  await page.waitForFunction(() => !!window.themedFailure);
  expect(await page.evaluate(() => ({ account: window.royalThemedSecurity.flightClient.accountId, session: window.royalThemedSecurity.flightClient.session, balance: window.royalThemedSecurity.demoWallet.wallet?.balance }))).toEqual({ account: 'account-b', session: null, balance: 321 });
  expect(state.wallets.get('account-b')!.entries).toEqual([]);
  expect(state.unexpected).toEqual([]);
  await page.evaluate(() => window.royalThemedSecurity.demoWallet.setAccount(null));
});

test('independent pending locks cannot unlock each other', async ({ page }) => {
  await fixture(page, 'lost');
  const locks = await page.evaluate(() => {
    const wallet = window.royalThemedSecurity.demoWallet;
    wallet.setExternalBusy('mines', true); wallet.setExternalBusy('flight', true);
    wallet.setExternalBusy('flight', false);
    const afterFlight = wallet.externalBusy;
    wallet.setExternalBusy('flight', true); wallet.setExternalBusy('mines', false);
    const afterMines = wallet.externalBusy;
    wallet.setExternalBusy('flight', false);
    return { afterFlight, afterMines, final: wallet.externalBusy };
  });
  expect(locks).toEqual({ afterFlight: true, afterMines: true, final: false });
  await page.evaluate(() => window.royalThemedSecurity.demoWallet.setAccount(null));
});
