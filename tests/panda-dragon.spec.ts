import { expect, test, type Page } from '@playwright/test';
import { selectEntryMode } from './entry-mode';

const gameId = 'panda-dragon-preview';

async function enterRoyal(page: Page, language = 'ru') {
  const login = await page.request.post('/api/auth/login', { data: { email: `dragon-${crypto.randomUUID()}@example.test`, password: 'DragonLocal2026!' } });
  expect(login.ok()).toBe(true);
  const { account } = await login.json();
  expect((await page.request.post('/api/auth/character', { data: { skin: 0, name: 'Гость проверки' } })).ok()).toBe(true);
  expect((await page.request.post('/__local/entry-credit')).ok()).toBe(true);
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
  await stake.fill('0,101');
  await expect(spin).toBeDisabled();
  await stake.press('Enter');
  await stake.fill('0,10');
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
  await spin.click();
  await expect(mini.getByRole('button', { name: 'Проверить', exact: true })).toBeEnabled();
  await mini.locator('.mini-top [data-close]').click();
  await expect(mini).toBeHidden();
  await openDragonPath(page);
  await mini.getByRole('button', { name: 'Проверить', exact: true }).click();
  const bonus = mini.getByRole('button', { name: 'Бесплатно', exact: true });
  await expect(spin.or(bonus)).toBeEnabled();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  if (await bonus.isVisible()) {
    await bonus.click();
    await mini.getByRole('button', { name: 'Персик Мудрости' }).click();
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
    await plus.click();
    await expect(mini.getByRole('textbox', { name: 'Ставка' })).toHaveValue('0.20');
    await mini.getByRole('button', { name: 'Вращать' }).click();
    await expect(mini.getByRole('button', { name: 'Вращать' }).or(mini.getByRole('button', { name: 'Бесплатно', exact: true }))).toBeEnabled();
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
});
