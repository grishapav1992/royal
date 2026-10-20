import { test, expect, type Page } from '@playwright/test';
import type { DemoWallet } from '../src/shared/demoWallet';
import type { MinesOperation, MinesResult, MinesSession } from '../src/shared/minesGame';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`originals-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-originals-password!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
}
async function open(page: Page, id: string) {
  await page.locator('#games-tab').click();
  await page.locator(`[data-cabinet="${id}"]`).click();
  await expect(page.locator(`${id === 'royal-plinko' ? '.volcanic-plinko' : '.original-game'}[data-game="${id}"]`)).toBeVisible({ timeout: 20000 });
  if (id === 'royal-plinko') { await page.locator('[data-vp="enter"]').click(); await page.locator('[data-risk="medium"]').click(); await page.locator('[data-vp="plus"]').click(); }
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }

function walletFixture() {
  let wallet: DemoWallet = { balance: 1000, entries: [] }, ledgerId = 0;
  const settle = (id: string, gameId: string, amount: number, payout: number) => {
    const before = wallet.balance; wallet.balance += payout - amount;
    wallet.entries.unshift(
      { id: ++ledgerId, kind: 'bet', amount: -amount, balance: before - amount, operationId: id, createdAt: Date.now(), source: gameId },
    );
    wallet.entries.unshift(
      { id: ++ledgerId, kind: 'win', amount: payout, balance: wallet.balance, operationId: id, createdAt: Date.now(), source: gameId },
    );
    return structuredClone(wallet);
  };
  const debit = (id: string, amount: number) => {
    wallet.balance -= amount;
    wallet.entries.unshift({ id: ++ledgerId, kind: 'bet', amount: -amount, balance: wallet.balance, operationId: id, createdAt: Date.now(), source: 'royal-mines' });
  };
  const credit = (id: string, amount: number) => {
    wallet.balance += amount;
    wallet.entries.unshift({ id: ++ledgerId, kind: 'win', amount, balance: wallet.balance, operationId: id, createdAt: Date.now(), source: 'royal-mines' });
  };
  return { get: () => structuredClone(wallet), settle, debit, credit };
}
async function mockWallet(page: Page, fixture: ReturnType<typeof walletFixture>) {
  await page.route('**/api/demo-wallet', route => route.fulfill({ json: fixture.get() }));
  await page.route('**/api/demo-wallet/mines', route => route.fulfill({ json: { wallet: fixture.get(), session: null } }));
}

const games = [
  { id: 'royal-dice', outcome: { rolledValue: 12.34, won: true }, multiplier: 1.96, board: '.original-dice-display', result: /12,34/ },
  { id: 'royal-limbo', outcome: { rolledMultiplier: 4.2, won: true }, multiplier: 2, board: '.original-limbo-display', result: /4,2×/ },
  { id: 'royal-keno', outcome: { drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], hits: [1, 2, 3] }, multiplier: 10.4, board: '.original-keno-grid', result: /Совпадений: 3/ },
];

for (const game of games) {
  test(`${game.id} displays the server result, ledger history and balance in its own cabinet`, async ({ page }) => {
    const fixture = walletFixture(); await mockWallet(page, fixture);
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/demo-wallet/operations', async route => {
      const request = route.request().postDataJSON(); requests.push(request);
      const payout = request.amount * game.multiplier;
      await route.fulfill({ json: { wallet: fixture.settle(request.id, game.id, request.amount, payout), gameRound: {
        gameId: game.id, rulesVersion: 1, input: request.input, outcome: game.outcome,
        multiplier: game.multiplier, stakeUnits: String(request.amount * 100), payoutUnits: String(Math.round(payout * 100)),
      } } });
    });
    await login(page); await open(page, game.id);
    await expect(page.locator(game.board)).toBeVisible();
    await expect(page.locator('#original-play')).toBeEnabled();
    await page.locator('#original-play').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(page.locator('#original-result')).toHaveText(game.result);
    await expect(page.locator('#original-play')).toBeEnabled();
    expect(requests).toHaveLength(1); expect(requests[0].gameId).toBe(game.id);
    await expect(page.locator('#original-balance')).toHaveText(fixture.get().balance.toLocaleString('ru-RU'));
    await expect(page.locator('.original-history-chip span')).toHaveText('Ставка 100');
    await expect(page.locator('.original-history-chip')).toHaveAttribute('data-result', 'win');
    if (game.id === 'royal-keno') {
      await expect(page.locator('[data-keno-number].is-drawn')).toHaveCount(10);
      await expect(page.locator('[data-keno-number].is-hit')).toHaveCount(3);
    }
    if (game.id === 'royal-limbo') {
      await page.locator('#original-limbo-target').fill('1.13');
      await expect(page.locator('#original-odds')).toContainText('85,9649%');
      await page.locator('.original-rules summary').click();
      await expect(page.locator('#original-rtp')).toContainText('97,1404%');
      await page.locator('.original-rules summary').click();
    }
    await page.screenshot({ path: `artifacts/${game.id}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator('.original-game').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    const contentOverflow = await page.locator('.original-game').evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(contentOverflow).toBe(false);
  });
}

async function mockPlinkoRounds(page: Page, fixture: ReturnType<typeof walletFixture>) {
  const ids: string[] = [];
  await page.route('**/api/demo-wallet/operations', async route => {
    const request = route.request().postDataJSON(); ids.push(request.id);
    const payout = request.amount * 4;
    await route.fulfill({ json: { wallet: fixture.settle(request.id, 'royal-plinko', request.amount, payout), gameRound: {
      gameId: 'royal-plinko', rulesVersion: 1, input: request.input,
      outcome: { path: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], bucket: 2 },
      multiplier: 4, stakeUnits: String(request.amount * 100), payoutUnits: String(payout * 100),
    } } });
  });
  return ids;
}

test('volcanic Plinko finishes the accepted result when animation frames stop', async ({ page }) => {
  const fixture = walletFixture(); await mockWallet(page, fixture); const ids = await mockPlinkoRounds(page, fixture);
  await login(page); await open(page, 'royal-plinko');
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.locator('[data-vp="drop"]').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('.volcanic-plinko')).toHaveAttribute('data-state', 'ready', { timeout: 6000 });
  await expect(page.locator('[data-vp="result-amount"]')).toHaveText('4× · 400,00');
  await expect(page.locator('[data-pocket="2"]')).toHaveClass(/vp-landed/);
  await expect(page.locator('[data-vp="balance"]')).toHaveText(/1\s300,00/);
  await expect(page.locator('[data-vp="drop"]')).toBeEnabled(); expect(ids).toHaveLength(1);
});

test('volcanic Plinko preserves the payout when drawing a frame throws', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = walletFixture(); await mockWallet(page, fixture); const ids = await mockPlinkoRounds(page, fixture);
  await login(page); await open(page, 'royal-plinko');
  await page.evaluate(() => {
    const arc = CanvasRenderingContext2D.prototype.arc; let failed = false;
    CanvasRenderingContext2D.prototype.arc = function(...args: Parameters<CanvasRenderingContext2D['arc']>) {
      if (!failed) { failed = true; throw new Error('Injected crystal frame failure'); }
      return arc.apply(this, args);
    };
  });
  await page.locator('[data-vp="drop"]').click();
  await expect(page.locator('.vp-board canvas')).toHaveAttribute('data-render-error', 'true');
  await expect(page.locator('[data-vp="result-amount"]')).toHaveText('4× · 400,00', { timeout: 6000 });
  await expect(page.locator('[data-vp="drop"]')).toBeEnabled(); expect(ids).toHaveLength(1); expect(errors).toEqual([]);
});

test('volcanic Plinko clamps an early frame timestamp and retains its paid pocket', async ({ page }) => {
  const fixture = walletFixture(); await mockWallet(page, fixture); const ids = await mockPlinkoRounds(page, fixture);
  await login(page); await open(page, 'royal-plinko');
  await page.evaluate(() => { window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now() - 100), 16); window.cancelAnimationFrame = id => clearTimeout(id); });
  await page.locator('[data-vp="drop"]').click();
  await expect(page.locator('[data-vp="result-amount"]')).toHaveText('4× · 400,00', { timeout: 6000 });
  await expect(page.locator('[data-pocket="2"]')).toHaveClass(/vp-landed/);
  await expect(page.locator('[data-vp="drop"]')).toBeEnabled(); expect(ids).toHaveLength(1);
});

test('Dice slider changes odds and an uncertain round survives reload with the same request ID', async ({ page }) => {
  const fixture = walletFixture(); await mockWallet(page, fixture);
  const ids: string[] = []; let completed: unknown;
  await page.route('**/api/demo-wallet/operations', async route => {
    const request = route.request().postDataJSON(); ids.push(request.id);
    if (!completed) {
      completed = { wallet: fixture.settle(request.id, 'royal-dice', request.amount, 0), gameRound: { gameId: 'royal-dice', rulesVersion: 1, input: request.input, outcome: { rolledValue: 92.56, won: false }, multiplier: 0, stakeUnits: '10000', payoutUnits: '0' } };
      await route.abort('failed'); return;
    }
    await route.fulfill({ json: completed });
  });
  await login(page); await open(page, 'royal-dice');
  await page.locator('#original-dice-slider').evaluate(input => { (input as HTMLInputElement).value = '25'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#original-dice-target')).toHaveValue('25');
  await expect(page.locator('#original-odds')).toContainText('3,92×');
  await page.locator('#original-play').click();
  await expect(page.locator('#original-play')).toHaveText('Проверить результат');
  await expect(page.locator('#original-dice-target')).toBeDisabled();
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 });
  await open(page, 'royal-dice');
  await expect(page.locator('#original-dice-target')).toHaveValue('25');
  await expect(page.locator('#original-play')).toHaveText('Проверить результат');
  await page.locator('#original-play').click();
  await expect(page.locator('#original-result')).toContainText('92,56');
  await expect(page.locator('#original-balance')).toHaveText('900');
  expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(1);
  await expect(page.locator('.original-history-chip')).toHaveCount(1);
  await expect(page.locator('.original-history-chip')).toHaveAttribute('data-result', 'loss');
});

test('Mines restores an active field and uncertain start, then settles cashout exactly once', async ({ page }) => {
  const fixture = walletFixture(); await mockWallet(page, fixture);
  await page.unroute('**/api/demo-wallet/mines');
  let session: MinesSession | null = null, loseStartResponse = true;
  const requests: MinesOperation[] = [], receipts = new Map<string, MinesResult>();
  await page.route('**/api/demo-wallet/mines', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { wallet: fixture.get(), session: session?.state === 'active' ? session : null } }); return; }
    const operation = route.request().postDataJSON() as MinesOperation; requests.push(operation);
    if (receipts.has(operation.id)) { await route.fulfill({ json: receipts.get(operation.id) }); return; }
    if (operation.action === 'start') {
      fixture.debit(operation.id, operation.amount);
      session = { id: operation.id, state: 'active', amount: operation.amount, mineCount: operation.mineCount, revealed: [], multiplier: 1, nextMultiplier: 1.11, payout: operation.amount };
    } else if (operation.action === 'reveal') {
      session = { ...session!, revealed: [...session!.revealed, operation.cell], multiplier: 1.11, nextMultiplier: 1.27, payout: 111 };
    } else {
      session = { ...session!, state: 'cashed_out', nextMultiplier: null, mineCells: [22, 23, 24], payout: 111 };
      fixture.credit(session.id, session.payout);
    }
    const result = { wallet: fixture.get(), session: structuredClone(session) }; receipts.set(operation.id, result);
    if (operation.action === 'start' && loseStartResponse) { loseStartResponse = false; await route.abort('failed'); return; }
    await route.fulfill({ json: result });
  });
  await login(page); await open(page, 'royal-mines');
  await expect(page.locator('#original-play')).toHaveText('Начать партию');
  await expect(page.locator('#original-play')).toBeEnabled();
  await page.locator('#original-play').click();
  await expect(page.locator('#original-play')).toHaveText('Проверить ход');
  await close(page); await page.reload();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 15000 }); await open(page, 'royal-mines');
  await expect(page.locator('#original-play')).toHaveText('Проверить ход');
  await expect(page.locator('[data-mine-cell]')).toHaveCount(25);
  await expect(page.locator('[data-mine-cell].is-mine')).toHaveCount(0);
  await page.locator('#original-play').click();
  expect(requests[0].id).toBe(requests[1].id);
  await expect(page.locator('#original-balance')).toHaveText('900');
  await expect(page.locator('[data-mine-cell="0"]')).toBeEnabled();
  await page.locator('[data-mine-cell="0"]').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('[data-mine-cell="0"]')).toHaveClass(/is-gem/);
  await expect(page.locator('#original-play')).toHaveText('Забрать 111 монет');
  await close(page); await open(page, 'royal-mines');
  await expect(page.locator('[data-mine-cell="0"]')).toHaveClass(/is-gem/);
  await expect(page.locator('#original-result')).toContainText('Партия восстановлена');
  await expect(page.locator('[data-mine-cell].is-mine')).toHaveCount(0);
  await expect(page.locator('#original-mine-count')).toBeDisabled();
  await page.screenshot({ path: 'artifacts/royal-mines-active-desktop.png' });
  await page.locator('#original-play').click();
  await expect(page.locator('#original-result')).toContainText('Начислено 111 монет');
  await expect(page.locator('#original-balance')).toHaveText(/1\s011/);
  await expect(page.locator('[data-mine-cell].is-mine')).toHaveCount(3);
  expect(requests.filter(operation => operation.action === 'reveal')).toHaveLength(1);
  expect(requests.filter(operation => operation.action === 'cashout')).toHaveLength(1);
  await expect(page.locator('.original-history-chip')).toHaveCount(1);
  await expect(page.locator('.original-history-chip span')).toHaveText('Ставка 100');
});

test('Keno limits picks to ten and empty selection cannot be wagered', async ({ page }) => {
  await mockWallet(page, walletFixture()); await login(page); await open(page, 'royal-keno');
  await page.locator('#original-keno-clear').click();
  await expect(page.locator('#original-play')).toBeDisabled();
  for (let value = 1; value <= 10; value++) await page.locator(`[data-keno-number="${value}"]`).click();
  await expect(page.locator('#original-keno-count')).toHaveText('10 / 10');
  await expect(page.locator('[data-keno-number="11"]')).toBeDisabled();
  await page.locator('[data-keno-number="10"]').click();
  await expect(page.locator('[data-keno-number="11"]')).toBeEnabled();
  await expect(page.locator('#original-play')).toBeEnabled();
});

test('Mines refreshes a field changed in another tab after a conflict response', async ({ page }) => {
  const fixture = walletFixture(); await mockWallet(page, fixture);
  await page.unroute('**/api/demo-wallet/mines');
  let current: MinesSession | null = { id: 'shared-session', state: 'active', amount: 100, mineCount: 3, revealed: [], multiplier: 1, nextMultiplier: 1.11, payout: 100 };
  let reads = 0, commands = 0;
  await page.route('**/api/demo-wallet/mines', async route => {
    if (route.request().method() === 'GET') {
      reads++; await route.fulfill({ json: { wallet: fixture.get(), session: current } }); return;
    }
    commands++; current = null;
    await route.fulfill({ status: 409, json: { error: 'Партия уже завершена в другой вкладке.' } });
  });
  await login(page); await open(page, 'royal-mines');
  await expect(page.locator('[data-mine-cell="0"]')).toBeEnabled();
  const before = reads;
  await page.locator('[data-mine-cell="0"]').click();
  await expect(page.locator('#original-play')).toHaveText('Начать партию');
  await expect(page.locator('#original-play')).toBeEnabled();
  await expect(page.locator('[data-mine-cell="0"]')).toBeDisabled();
  await expect(page.locator('#original-mine-count')).toBeEnabled();
  expect(reads).toBeGreaterThan(before); expect(commands).toBe(1);
});
