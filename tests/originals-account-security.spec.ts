import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DemoWalletStore } from '../server/demoWallet';
import type { OriginalGames } from '../src/ui/OriginalGames';
import type { EZSlotsGame } from '../src/ui/EZSlotsGame';
import type SlotMachine from '../src/vendor/ezslots/Slots.js';
import type { WalletClient } from '../src/wallet/WalletClient';
import type { MinesClient } from '../src/wallet/MinesClient';
import type { DemoWallet, WalletResult } from '../src/shared/demoWallet';

declare global {
  interface Window {
    royalSecurity: { OriginalGames: typeof OriginalGames; EZSlotsGame: typeof EZSlotsGame; SlotMachine: typeof SlotMachine; demoWallet: WalletClient; minesClient: MinesClient };
    securityGame?: { destroy(): void };
    auditXss?: boolean;
  }
}

let browserCode = '';
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: 'export { OriginalGames } from "./src/ui/OriginalGames.ts"; export { EZSlotsGame } from "./src/ui/EZSlotsGame.ts"; export { default as SlotMachine } from "./src/vendor/ezslots/Slots.js"; export { demoWallet } from "./src/wallet/WalletClient.ts"; export { minesClient } from "./src/wallet/MinesClient.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'royalSecurity', platform: 'browser', loader: { '.css': 'empty' },
  });
  browserCode = result.outputFiles[0].text;
});

const accountA = 'audit-account-a', accountB = 'audit-account-b';
const fixtureGames = [
  { id: 'royal-dice' as const, outcome: { rolledValue: 12.34, won: true }, multiplier: 1.96 },
  { id: 'royal-limbo' as const, outcome: { rolledMultiplier: 4.2, won: true }, multiplier: 2 },
  { id: 'royal-plinko' as const, outcome: { path: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], bucket: 2 }, multiplier: 4 },
  { id: 'royal-keno' as const, outcome: { drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], hits: [1, 2, 3] }, multiplier: 10.4 },
  { id: 'royal-fruits' as const, outcome: { symbols: [3, 3, 3] }, multiplier: 140 },
];

async function fixture(page: Page, options: { dropFirst?: boolean; delayFirst?: boolean; activeMines?: boolean; walletA?: DemoWallet } = {}) {
  const wallets = new Map<string, DemoWallet>([[accountA, options.walletA ?? { balance: 1000, entries: [] }], [accountB, { balance: 321, entries: [] }]]);
  const receipts = new Map<string, WalletResult>();
  const posts: { accountId: string; id: string }[] = [], externalRequests: string[] = [];
  let dropped = false, ledgerId = 0, releaseFirst: (() => void) | undefined;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const accountId = route.request().headers()['x-royal-account-id'] || accountA;
    const wallet = wallets.get(accountId)!;
    if (url.pathname === '/__royal_security__') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="security-stage"></div>' }); return;
    }
    if (url.pathname === '/api/demo-wallet') { await route.fulfill({ json: wallet }); return; }
    if (url.pathname === '/api/demo-wallet/mines') {
      await route.fulfill({ json: { wallet, session: options.activeMines && accountId === accountA
        ? { id: 'audit-session', state: 'active', amount: 100, mineCount: 3, revealed: [0], multiplier: 1.11, nextMultiplier: 1.27, payout: 111 } : null } }); return;
    }
    if (url.pathname === '/api/demo-wallet/operations') {
      const operation = route.request().postDataJSON(); posts.push({ accountId, id: operation.id });
      const key = `${accountId}:${operation.id}`;
      if (!receipts.has(key)) {
        const game = fixtureGames.find(item => item.id === operation.gameId)!;
        const before = wallet.balance, payout = Math.round(operation.amount * game.multiplier * 100) / 100;
        wallet.balance = before - operation.amount + payout;
        wallet.entries.unshift({ id: ++ledgerId, kind: 'bet', amount: -operation.amount, balance: before - operation.amount, operationId: operation.id, source: operation.gameId, createdAt: 1 });
        wallet.entries.unshift({ id: ++ledgerId, kind: 'win', amount: payout, balance: wallet.balance, operationId: operation.id, source: operation.gameId, createdAt: 1 });
        receipts.set(key, { wallet: structuredClone(wallet), gameRound: {
          gameId: game.id, rulesVersion: 1, input: operation.input, outcome: game.outcome,
          multiplier: game.multiplier, stakeUnits: String(operation.amount * 100), payoutUnits: String(Math.round(payout * 100)),
        } } as WalletResult);
        if (options.delayFirst) await new Promise<void>(resolve => { releaseFirst = resolve; });
        if (options.dropFirst && !dropped) { dropped = true; await route.abort('failed'); return; }
      }
      await route.fulfill({ json: receipts.get(key) }); return;
    }
    externalRequests.push(url.href); await route.abort();
  });
  await page.goto('http://127.0.0.1/__royal_security__');
  await page.addScriptTag({ content: browserCode });
  return { wallets, posts, externalRequests, release: () => releaseFirst?.(), receipts };
}

async function createGame(page: Page, gameId: string, accountId = accountA) {
  await page.evaluate(async ({ gameId, accountId }) => {
    window.royalSecurity.demoWallet.setAccount(accountId);
    await window.royalSecurity.demoWallet.refresh();
    window.securityGame = gameId === 'royal-fruits'
      ? new window.royalSecurity.EZSlotsGame(document.querySelector('#security-stage')!)
      : new window.royalSecurity.OriginalGames(document.querySelector('#security-stage')!, gameId as ConstructorParameters<typeof OriginalGames>[1]);
  }, { gameId, accountId });
}
async function switchAccount(page: Page, accountId = accountB) {
  await page.evaluate(async accountId => { window.royalSecurity.demoWallet.setAccount(accountId); await window.royalSecurity.demoWallet.refresh(); }, accountId);
}
async function expectCleanResult(page: Page, gameId: string) {
  if (gameId === 'royal-fruits') {
    await expect(page.locator('.ez-fruits-outcome')).toHaveAttribute('aria-label', 'Результат ещё не получен');
    await expect(page.locator('#ez-fruits-result')).toHaveText('Выбери ставку и запусти барабаны.');
    expect(await page.locator('.ezslots-symbol[data-row="1"]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.symbol))).toEqual(['cherry', 'lemon', 'grape']);
    await expect(page.locator('.ez-slots-game')).not.toHaveAttribute('data-result', /win|loss/);
    return;
  }
  await expect(page.locator('.original-game')).toHaveAttribute('data-result', 'idle');
  await expect(page.locator('#original-result')).toHaveText('Выбери ставку и начинай.');
  if (gameId === 'royal-dice') {
    await expect(page.locator('#original-dice-value')).toHaveText('00,00');
    await expect(page.locator('#original-dice-marker')).toHaveJSProperty('hidden', true);
  } else if (gameId === 'royal-limbo') await expect(page.locator('#original-limbo-value')).toHaveText('1,00×');
  else if (gameId === 'royal-plinko') {
    await expect(page.locator('#original-plinko-ball')).toHaveAttribute('hidden', '');
    await expect(page.locator('[data-plinko-bucket].is-hit')).toHaveCount(0);
  } else if (gameId === 'royal-keno') {
    await expect(page.locator('[data-keno-number].is-drawn')).toHaveCount(0);
    await expect(page.locator('[data-keno-number].is-hit')).toHaveCount(0);
  }
}

for (const game of fixtureGames) {
  test(`${game.id} cancels the previous account animation and clears its result`, async ({ page }) => {
    const api = await fixture(page); await createGame(page, game.id);
    const fruits = game.id === 'royal-fruits';
    await page.locator(fruits ? '#ez-fruits-spin' : '#original-play').click();
    await page.waitForFunction(() => !window.royalSecurity.demoWallet.pending && !window.royalSecurity.demoWallet.busy && window.royalSecurity.demoWallet.wallet!.balance !== 1000);
    await switchAccount(page); await expectCleanResult(page, game.id);
    await page.waitForTimeout(fruits ? 3500 : 1400);
    await expectCleanResult(page, game.id);
    await expect(page.locator(fruits ? '#ez-fruits-balance' : '#original-balance')).toHaveText('321');
    await expect(page.locator(fruits ? '#ez-fruits-spin' : '#original-play')).toBeEnabled();
    expect(api.posts).toHaveLength(1); expect(api.posts[0].accountId).toBe(accountA);
    expect(api.wallets.get(accountB)!.balance).toBe(321);
  });
  test(`${game.id} clears a completed result before showing the next account`, async ({ page }) => {
    const api = await fixture(page); await createGame(page, game.id);
    const fruits = game.id === 'royal-fruits';
    await page.locator(fruits ? '#ez-fruits-spin' : '#original-play').click();
    await expect(page.locator(fruits ? '.ez-slots-game' : '.original-game')).toHaveAttribute('data-result', 'win');
    if (fruits) await expect(page.locator('[class$="-win-line"]')).toHaveCount(1);
    await switchAccount(page); await expectCleanResult(page, game.id);
    if (fruits) await expect(page.locator('[class$="-win-line"]')).toHaveCount(0);
    await expect(page.locator(fruits ? '#ez-fruits-balance' : '#original-balance')).toHaveText('321');
    expect(api.wallets.get(accountB)!.balance).toBe(321);
  });
}

test('a delayed result and error from account A cannot overwrite account B', async ({ page }) => {
  const api = await fixture(page, { delayFirst: true }); await createGame(page, 'royal-dice');
  await page.locator('#original-play').click();
  await expect.poll(() => api.posts.length).toBe(1);
  await switchAccount(page); await expectCleanResult(page, 'royal-dice');
  api.release();
  await page.waitForTimeout(700);
  await expectCleanResult(page, 'royal-dice');
  await expect(page.locator('#original-balance')).toHaveText('321');
  await expect(page.locator('#original-play')).toBeEnabled();
  expect(api.wallets.get(accountB)!.balance).toBe(321);
});

test('an uncertain round survives reload only for its original account and retries the same ID', async ({ page }) => {
  const api = await fixture(page, { dropFirst: true }); await createGame(page, 'royal-dice');
  await page.locator('#original-play').click();
  await expect(page.locator('#original-play')).toHaveText('Проверить результат');
  const id = api.posts[0].id, firstBalance = api.wallets.get(accountA)!.balance;
  await switchAccount(page); await expectCleanResult(page, 'royal-dice');
  expect(await page.evaluate(() => window.royalSecurity.demoWallet.pending)).toBeUndefined();
  await page.reload(); await page.addScriptTag({ content: browserCode });
  await createGame(page, 'royal-dice', accountB); await expect(page.locator('#original-play')).toBeEnabled();
  expect(await page.evaluate(() => window.royalSecurity.demoWallet.pending)).toBeUndefined();
  await switchAccount(page, accountA);
  await expect(page.locator('#original-play')).toHaveText('Проверить результат');
  await page.locator('#original-play').click();
  await expect(page.locator('#original-result')).toContainText('12,34');
  expect(api.posts.map(operation => operation.id)).toEqual([id, id]);
  expect(api.posts.every(operation => operation.accountId === accountA)).toBe(true);
  expect(api.wallets.get(accountA)!.balance).toBe(firstBalance);
  expect(api.wallets.get(accountB)!.balance).toBe(321);
});

test('Mines active field belongs to its account and disappears on account change', async ({ page }) => {
  await fixture(page, { activeMines: true }); await createGame(page, 'royal-mines');
  await expect(page.locator('[data-mine-cell="0"]')).toHaveClass(/is-gem/);
  await switchAccount(page);
  await expect(page.locator('[data-mine-cell].is-gem')).toHaveCount(0);
  await expect(page.locator('[data-mine-cell].is-mine')).toHaveCount(0);
  await expect(page.locator('#original-mines-gems')).toHaveText('0');
  await expect(page.locator('#original-balance')).toHaveText('321');
  expect(await page.evaluate(() => window.royalSecurity.minesClient.session)).toBeNull();
});

test('a Mines loss stays unclassified when its stake has left the fifty-entry wallet snapshot', async ({ page }) => {
  const db = new DatabaseSync(':memory:');
  let wallet: DemoWallet;
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('audit-account-a');");
    const store = new DemoWalletStore(db, () => 0);
    store.operate(accountA, { id: randomUUID(), kind: 'deposit', amount: 1000 });
    const sessionId = randomUUID();
    store.mines.operate(accountA, { id: sessionId, action: 'start', amount: 100, mineCount: 3 });
    for (let i = 0; i < 25; i++) store.operate(accountA, {
      id: randomUUID(), kind: 'play', gameId: 'royal-dice', rulesVersion: 1,
      amount: 10, input: { gameMode: 'rollUnder', sliderValue: 50 },
    });
    const result = store.mines.operate(accountA, { id: randomUUID(), action: 'reveal', sessionId, cell: 0 });
    expect(result.session?.state).toBe('lost');
    wallet = result.wallet;
    expect(wallet.entries).toHaveLength(50);
    expect(wallet.entries.filter(entry => entry.source === 'royal-mines').map(entry => entry.kind)).toEqual(['win']);
  } finally { db.close(); }
  await fixture(page, { walletA: wallet }); await createGame(page, 'royal-mines');
  await expect(page.locator('.original-history-chip')).toHaveCount(1);
  await expect(page.locator('.original-history-chip span')).toHaveText('Ставка вне текущей истории');
  await expect(page.locator('.original-history-chip strong')).toHaveText('0 монет');
  await expect(page.locator('.original-history-chip')).not.toHaveAttribute('data-result', /win|loss/);
});

test('Dice RTP changes with the selected stake and includes its settlement rounding', async ({ page }) => {
  await fixture(page); await createGame(page, 'royal-dice');
  await page.locator('#original-dice-target').fill('96.94');
  await page.locator('#original-bet').selectOption('10');
  await expect(page.locator('#original-rtp')).toContainText('Теоретический RTP 97,9094%');
  await expect(page.locator('#original-rtp')).toContainText('RTP для ставки 10 монет');
  await page.locator('#original-bet').selectOption('50');
  await expect(page.locator('#original-rtp')).toContainText('Теоретический RTP 97,987%');
  await expect(page.locator('#original-rtp')).toContainText('RTP для ставки 50 монет');
  for (const amount of ['100', '500']) {
    await page.locator('#original-bet').selectOption(amount);
    await expect(page.locator('#original-rtp')).toContainText('Теоретический RTP 97,9966%');
    await expect(page.locator('#original-rtp')).toContainText(`RTP для ставки ${amount} монет`);
  }
});

test('the Royal reel renderer treats HTML and image URLs as inert text', async ({ page }) => {
  const api = await fixture(page);
  const value = '<img src="https://example.invalid/collect" onerror="window.auditXss=true">';
  await page.evaluate(value => {
    window.auditXss = false;
    new window.royalSecurity.SlotMachine(document.querySelector('#security-stage')!, { reelCount: 3, symbols: { text: value }, reducedMotion: true });
  }, value);
  await expect(page.locator('#security-stage img')).toHaveCount(0);
  await expect(page.locator('.ezslots-symbol').first()).toHaveText(value);
  expect(await page.evaluate(() => window.auditXss)).toBe(false);
  expect(api.externalRequests).toEqual([]);
});
