import { expect, test, type Locator, type Page } from '@playwright/test';
import { startDragonPath, moveDragonPath, dragonPathFinalAward } from '../server/games/dragonPath';
import { DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_FREE_SPIN } from '../src/shared/dragonPathProtocol';
import { dragonPathExpansionView } from '../src/shared/dragonPathTransport';
import { makeRoundPrecision } from '../src/shared/roundPrecision';
import { selectEntryMode } from './entry-mode';

const gameId = 'panda-dragon-preview';

test.use({ screenshot: 'only-on-failure' });

async function enterRoyal(page: Page, language = 'ru', credit = true) {
  const login = await page.request.post('/api/auth/login', { data: { email: `dragon-${crypto.randomUUID()}@example.test`, password: 'DragonLocal2026!' } });
  expect(login.ok()).toBe(true);
  const { account } = await login.json();
  expect((await page.request.post('/api/auth/character', { data: { skin: 0, name: 'Гость проверки' } })).ok()).toBe(true);
  if (credit) expect((await page.request.post('/__local/entry-credit')).ok()).toBe(true);
  await page.goto(`/?lang=${language}`);
  await selectEntryMode(page, 'casino');
  await expect(page.locator('#chat-input')).toBeEnabled({ timeout: 30_000 });
  return { 'X-Royal-Account-Id': account.id, 'X-Royal-Dragon-Path': '1' };
}

async function openDragonPath(page: Page, catalogue = page.locator('#casino-catalog')) {
  await catalogue.getByRole('combobox', { name: 'Жанр' }).selectOption('slot');
  await catalogue.getByRole('searchbox').fill('Путь дракона');
  const card = catalogue.locator(`[data-platform-game="${gameId}"]`);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Виртуальные ставки');
  await expect.poll(() => card.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await card.click();
  const mini = page.locator('#mini-dialog');
  await expect(mini.locator('#mini-game')).toHaveAttribute('data-game-module-id', gameId);
  await expect(mini.locator('#mini-title')).toHaveText('Путь дракона');
  await expect(mini.locator('.game-mode-badge')).toHaveText('Виртуальные ставки');
  await expect(mini.getByRole('heading', { name: 'Путь дракона', exact: true, level: 1 })).toBeVisible();
  return mini;
}

test('Royal: десять сотых, потеря ответа, восстановление и общий чат', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errorMessages: string[] = [], ids: string[] = [], externalMedia: string[] = [];
  page.on('pageerror', error => errorMessages.push(error.message));
  page.on('request', request => { if (request.url().includes('lovable.app')) externalMedia.push(request.url()); });
  const headers = await enterRoyal(page);
  const mini = await openDragonPath(page);
  await expect(mini.locator('#chat-input')).toBeVisible();
  await mini.locator('#chat-input').fill('Проверка чата рядом с «Путём дракона»');
  await mini.locator('#send-chat').click();
  await expect(mini.locator('#chat-log')).toContainText('Проверка чата рядом с «Путём дракона»');
  await mini.getByRole('button', { name: 'Об игре' }).click();
  await expect(mini.getByRole('dialog', { name: 'Об игре' })).toContainText('Реальных денег и вывода нет.');
  await page.keyboard.press('Escape');
  await mini.getByRole('button', { name: 'Выключить звук' }).click();
  await expect(mini.getByRole('button', { name: 'Включить звук' })).toBeVisible();
  const spin = mini.getByRole('button', { name: 'Вращать' });
  const stake = mini.getByRole('textbox', { name: 'Ставка' });
  const presets = mini.getByRole('combobox', { name: 'Быстрый выбор ставки' });
  await expect(stake).toHaveValue('0.10');
  await expect(presets.locator('option:not(:disabled)')).toHaveCount(9);
  const playBar = mini.locator('.panda-bar');
  const playBarHeight = (await playBar.boundingBox())!.height;
  await stake.fill('100,00');
  await expect(stake).toHaveAttribute('aria-invalid', 'false');
  await stake.fill('100,01');
  await expect(stake).toHaveAttribute('aria-invalid', 'true');
  await stake.fill('0,101');
  await expect(stake).toHaveAccessibleDescription('0,10–100,00, шаг 0,01');
  await expect(spin).toBeDisabled();
  expect((await playBar.boundingBox())!.height).toBe(playBarHeight);
  await stake.press('Enter');
  await stake.fill('0,10');
  await expect(stake).toHaveAttribute('aria-invalid', 'false');
  await expect(spin).toBeEnabled();
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const operation = route.request().postDataJSON();
    if (operation.gameId !== gameId || operation.action !== 'start') return route.continue();
    ids.push(operation.id);
    if (ids.length !== 1) return route.continue();
    const accepted = await route.fetch();
    expect(accepted.status()).toBe(200);
    expect((await accepted.json()).session.spentUnits).toBe('10');
    await route.abort('failed');
  });
  const autoDialog = await prepareAutoplay(mini);
  await autoDialog.getByRole('button', { name: 'Запустить автоигру' }).click();
  await expect(mini.getByRole('button', { name: 'Проверить', exact: true })).toBeEnabled();
  await expect(mini.getByRole('button', { name: /^Стоп/ })).toHaveCount(0);
  await mini.locator('.mini-top [data-close]').click();
  await expect(mini).toBeHidden();
  await openDragonPath(page);
  await mini.getByRole('button', { name: 'Проверить', exact: true }).click();
  const bonus = mini.getByRole('button', { name: 'Фриспин', exact: true });
  await expect(spin.or(bonus)).toBeEnabled();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  if (await bonus.isVisible()) {
    await bonus.click();
    await mini.getByRole('button', { name: 'Персик Мудрости' }).click();
    await expect(mini.getByRole('dialog', { name: 'Итог бонуса' })).toContainText('Персик Мудрости');
    await mini.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(spin).toBeEnabled();
  }
  const reply = await page.request.get('/api/demo-wallet/expansion', { headers });
  expect(reply.ok()).toBe(true);
  const { wallet, sessions } = await reply.json();
  const result = sessions.find((s: { gameId: string }) => s.gameId === gameId);
  expect(result).toMatchObject({ id: ids[0], spentUnits: '10', state: 'settled' });
  expect(Math.round(wallet.balance * 100)).toBe(5000 - 10 + Number(result.returnedUnits));
  expect(wallet.entries.filter((row: { kind: string; source: string }) => row.source === gameId).map((row: { kind: string }) => row.kind).sort()).toEqual(['bet', 'win']);
  await expect.poll(() => mini.locator('.panda-cell img').evaluateAll(images => images.length === 25 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await mini.getByRole('button', { name: 'Текущий раунд' }).click();
  await expect(mini.getByRole('dialog', { name: 'Текущий раунд' }).locator('.panda-round-totals dd').first()).toHaveText('0.10');
  expect(errorMessages).toEqual([]);
  expect(externalMedia).toEqual([]);
});

for (const width of [390, 320]) {
  test(`узкое окно ${width} пикселей: ставка и мобильный чат`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterRoyal(page);
    const mini = await openDragonPath(page);
    const plus = mini.getByRole('button', { name: 'Увеличить ставку' });
    await expect(plus).toBeInViewport();
    await expect(mini.getByRole('combobox', { name: 'Быстрый выбор ставки' })).toBeEnabled();
    await expect(mini.locator('.panda-valley-motion')).toHaveCount(0);
    for (const control of [plus, mini.getByRole('combobox', { name: 'Быстрый выбор ставки' }), mini.getByRole('button', { name: 'Вращать' })]) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await plus.press('Tab');
    await expect(mini.getByRole('button', { name: 'Вращать' })).toBeFocused();
    await plus.click();
    await expect(mini.getByRole('textbox', { name: 'Ставка' })).toHaveValue('0.20');
    await mini.getByRole('button', { name: 'Вращать' }).click();
    await expect(mini.getByRole('button', { name: 'Вращать' }).or(mini.getByRole('button', { name: 'Фриспин', exact: true }))).toBeEnabled();
    await expect(mini.locator('.panda-reel[data-spinning], .panda-hero-tiptoe')).toHaveCount(0);
    expect(await mini.locator('.panda-page').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await mini.locator('.game-chat-toggle').click();
    await expect(mini.locator('#chat-input')).toBeInViewport();
    await expect(mini.locator('#chat-input')).toBeEnabled();
  });
}

test('английский язык Royal применяется к карточке и правилам', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterRoyal(page, 'en');
  const catalogue = page.locator('#casino-catalog');
  await catalogue.getByRole('combobox', { name: 'Genre' }).selectOption('slot');
  await catalogue.getByRole('searchbox').fill('Dragon Path');
  const card = catalogue.getByRole('button', { name: /Dragon Path/ });
  await expect(card).toContainText('Virtual stakes');
  await card.click();
  const mini = page.locator('#mini-dialog');
  await expect(mini.locator('#mini-title')).toHaveText('Dragon Path');
  await expect(mini.getByRole('heading', { name: 'Dragon Path', exact: true, level: 1 })).toBeVisible();
  await expect(mini.getByRole('combobox', { name: 'Quick stakes' })).toBeEnabled();
  await mini.getByRole('button', { name: 'About the game' }).click();
  await expect(mini.getByRole('dialog', { name: 'About the game' })).toContainText('Three Dragon Scrolls trigger the bonus.');
  await mini.getByText('Paytable', { exact: true }).click();
  await expect(mini.getByRole('table')).toContainText('×88.51');
  await mini.getByText('Paylines', { exact: true }).click();
  await expect(mini.locator('.panda-paylines li')).toHaveCount(10);
});

async function expectFitted(mini: Locator) {
  const stage = mini.locator('.mini-stage');
  const grid = mini.getByRole('group', { name: 'Барабаны' });
  await expect(grid).toBeInViewport({ ratio: 0.98 });
  await expect(mini.getByRole('button', { name: 'Авто', exact: true })).toBeInViewport({ ratio: 0.98 });
  const stake = mini.getByRole('textbox', { name: 'Ставка' });
  await expect(stake).toBeInViewport({ ratio: 0.98 });
  expect((await stake.boundingBox())!.width).toBeGreaterThanOrEqual(48);
  const box = await grid.boundingBox();
  const cell = await grid.locator('.panda-cell').first().boundingBox();
  expect(Math.abs(box!.height - box!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(cell!.height - cell!.width)).toBeLessThanOrEqual(1);
  expect(await stage.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await mini.locator('.panda-page').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
  test(`поле и кнопки помещаются в ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await enterRoyal(page);
    const mini = await openDragonPath(page);
    await expect(mini).toHaveAttribute('data-game-viewport', 'layout');
    await expectFitted(mini);
    if (viewport.width > 1000) {
      await expect(mini.locator('#chat-input')).toBeVisible();
      const valley = mini.locator('.panda-valley');
      const waterfall = valley.locator('.panda-valley-water');
      await expect(valley).toHaveCSS('pointer-events', 'none');
      await expect(waterfall).toHaveCSS('animation-play-state', 'running');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(waterfall).toHaveCSS('animation-play-state', 'paused');
      await page.evaluate(() => {
        Reflect.deleteProperty(document, 'hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(waterfall).toHaveCSS('animation-play-state', 'running');
      await mini.getByRole('button', { name: 'Скрыть героя' }).click();
      await expect(mini.locator('.panda-hero-wrap')).toHaveCount(0);
      await expectFitted(mini);
      await mini.getByRole('button', { name: 'Показать героя' }).click();
      await expect(mini.locator('.panda-hero-wrap')).toBeVisible();
    } else {
      await mini.locator('.game-chat-toggle').click();
      await expect(mini.locator('#chat-input')).toBeEnabled();
      await mini.locator('.game-chat-close').click();
      await expectFitted(mini);
    }
    if (process.env.PANDA_CAPTURE === '1') await page.screenshot({ path: info.outputPath('компоновка.png') });
  });
}

test('отказ по балансу остаётся видим после обновления кошелька', async ({ page }) => {
  await enterRoyal(page, 'ru', false);
  const mini = await openDragonPath(page);
  const spin = mini.getByRole('button', { name: 'Вращать' });
  await spin.click();
  await expect(spin).toBeEnabled();
  await expect(mini.locator('.panda-error')).toHaveText('Недостаточно демомонет для начальных ставок.');
  await expect(mini.getByRole('button', { name: 'Проверить', exact: true })).toHaveCount(0);
});

async function prepareAutoplay(mini: Locator) {
  await mini.getByRole('button', { name: 'Авто', exact: true }).click();
  const dialogue = mini.getByRole('dialog', { name: 'Автоигра' });
  const count = dialogue.getByRole('combobox', { name: 'Количество вращений' });
  await expect(count.locator('option')).toHaveText(['10', '25', '50', '100']);
  await expect(count).toHaveValue('10');
  return dialogue;
}

test('десять вращений автоигры списываются через общий HTTP-кошелёк', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const headers = await enterRoyal(page);
  const mini = await openDragonPath(page);
  await expect(mini.locator('#chat-input')).toBeVisible();
  const rounds: { id: string; state: 'settled' | 'active' }[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const op = route.request().postDataJSON();
    if (op.gameId !== gameId || op.action !== 'start') return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const { session } = await response.json();
    expect(session).toMatchObject({ id: op.id, spentUnits: '10' });
    rounds.push(session);
    await route.fulfill({ response });
  });
  const auto = await prepareAutoplay(mini);
  expect(rounds).toEqual([]);
  await auto.getByRole('button', { name: 'Запустить автоигру' }).click();
  for (let index = 0; index < 10; index++) {
    await expect.poll(() => rounds.length).toBeGreaterThan(index);
    if (rounds[index].state !== 'active') continue;
    await mini.getByRole('button', { name: 'Пельмени Мастера' }).click();
    await mini.getByRole('dialog', { name: 'Итог бонуса' }).getByRole('button', { name: 'Продолжить' }).click();
  }
  await expect(mini.getByRole('button', { name: 'Авто', exact: true })).toBeEnabled();
  expect(new Set(rounds.map(round => round.id)).size).toBe(10);
  const result = await page.request.get('/api/demo-wallet/expansion', { headers });
  expect(result.ok()).toBe(true);
  const { wallet } = await result.json();
  const bets = wallet.entries.filter((row: { kind: string; source: string }) => row.kind === 'bet' && row.source === gameId);
  expect(bets.map((row: { amount: number }) => row.amount)).toEqual(Array(10).fill(-0.1));
});

for (const width of [1440, 390, 320]) {
  const ending = width === 1440 ? 'десять ставок' : width === 390 ? 'закрытие итога' : 'ручной стоп';
  test(`автоигра ${width} пикселей: бесплатный ход, выбор и ${ending}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterRoyal(page);
    const operations: string[] = [];
    let round: ReturnType<typeof startDragonPath>;
    let id = '', starts = 0, balance = 5000;
    const plain = (i: number) => 32 + (i % 2) * 9 + (i % 3) * 2;
    await page.route('**/api/demo-wallet/expansion', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const op = route.request().postDataJSON();
      if (op.gameId !== gameId) return route.continue();
      operations.push(op.action === 'start' ? 'start' : op.move);
      if (op.action === 'start') {
        expect(op.stakeUnits).toBe('10');
        id = op.id;
        const bonus = ++starts === 1;
        let i = 0;
        round = startDragonPath(op.stakeUnits, () => {
          const position = i++;
          return bonus && position < 3 ? 0 : plain(position);
        });
        balance -= Number(op.stakeUnits);
      } else {
        expect(op.sessionId).toBe(id);
        let i = 0;
        round = moveDragonPath(round.round, op.revision, op.move, op.picks, () => plain(i++));
      }
      const view = dragonPathExpansionView(round);
      const precision = round.ended ? makeRoundPrecision(dragonPathFinalAward(round.round), round.baseCreditUnits, () => 0) : undefined;
      const returnedUnits = precision?.creditedUnits ?? round.baseCreditUnits;
      const session = { gameId, id, rulesVersion: 1, stakeUnits: round.round.stakeUnits, spentUnits: round.round.stakeUnits,
        state: round.ended ? 'settled' : 'active', view, returnedUnits, ...(precision ? { precision } : {}) };
      if (round.ended) balance += Number(returnedUnits);
      await route.fulfill({ json: { wallet: { balance: balance / 100, entries: [] }, sessions: [session], session, replayed: false } });
    });
    const mini = await openDragonPath(page);
    let dialogue = await prepareAutoplay(mini);
    await dialogue.getByRole('combobox').selectOption('25');
    await dialogue.getByRole('button', { name: 'Закрыть', exact: true }).click();
    expect(operations).toEqual([]);
    await mini.getByRole('button', { name: 'Авто', exact: true }).click();
    dialogue = mini.getByRole('dialog', { name: 'Автоигра' });
    await dialogue.getByRole('combobox').selectOption('10');
    await dialogue.getByRole('button', { name: 'Запустить автоигру' }).click();
    const stop = mini.getByRole('button', { name: 'Стоп · 9', exact: true });
    const peach = mini.getByRole('button', { name: 'Персик Мудрости' });
    await expect(peach).toBeFocused();
    await expect(mini.locator('.panda-bonus-ribbon')).toHaveText('Бонусное вращение ×3');
    await expect(stop).toBeEnabled();
    expect(operations).toEqual(['start', DRAGON_PATH_FREE_SPIN]);
    expect(balance).toBe(4990);
    if (width === 320) await stop.click();
    await peach.press('Enter');
    const receipt = mini.getByRole('dialog', { name: 'Итог бонуса' });
    await expect(receipt).toContainText('Персик Мудрости');
    expect(operations).toEqual(['start', DRAGON_PATH_FREE_SPIN, DRAGON_PATH_CHOOSE_REWARD]);
    if (width === 1440) {
      await receipt.getByRole('button', { name: 'Продолжить' }).click();
      await expect(mini.getByRole('button', { name: 'Авто', exact: true })).toBeEnabled({ timeout: 20_000 });
      expect(starts).toBe(10);
    } else {
      await page.keyboard.press('Escape');
      await expect(mini.getByRole('button', { name: 'Авто', exact: true })).toBeEnabled();
      expect(starts).toBe(1);
      await mini.locator('.game-chat-toggle').click();
      await expect(mini.locator('#chat-input')).toBeEnabled();
    }
  });
}
