import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_APPEARANCE } from '../src/shared/appearance';
import { PLAYER_CHARACTERS } from '../src/shared/characters';

const password = 'Character-selection-123!';
const email = () => `character-selection-${crypto.randomUUID()}@example.test`;
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const network = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());
const savedAccount = async (page: Page) => {
  const response = await page.request.get('/api/auth/me');
  expect(response.ok()).toBe(true);
  return (await response.json()).account;
};

async function login(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Почта', { exact: true }).fill(email());
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
}

async function expectConnected(page: Page) {
  await expect(page.locator('#join-dialog')).toBeHidden();
  await expect.poll(async () => (await network(page)).status).toBe('connected');
}

async function createAccount(page: Page, character: object) {
  const loginResponse = await page.request.post('/api/auth/login', { data: { email: email(), password } });
  expect(loginResponse.ok()).toBe(true);
  const characterResponse = await page.request.post('/api/auth/character', { data: character });
  expect(characterResponse.ok()).toBe(true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expectConnected(page);
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Настройки игрока', exact: true }).click();
  await expect(page.locator('#name-dialog')).toBeVisible();
  await expect(page.locator('#settings-character-selection .character-choice')).toHaveCount(PLAYER_CHARACTERS.length);
  await expect(page.locator('.character-editor')).toHaveCount(0);
}

test('new account selects the expanded roster character and keeps it after reloading', async ({ page }) => {
  await login(page);
  const selection = page.locator('#character-selection');
  await expect(selection.locator('.character-choice')).toHaveCount(PLAYER_CHARACTERS.length);
  await expect(page.locator('.character-editor')).toHaveCount(0);
  for (const character of PLAYER_CHARACTERS) {
    await expect(selection.getByRole('button', { name: character.name, exact: true })).toHaveAttribute('data-skin', String(character.id));
  }
  await expect(selection.locator('[data-skin="6"]')).toHaveCount(0);
  await expect(selection.getByRole('button', { name: 'Эдди', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Игровое имя', { exact: true }).fill('Рэн из клуба');
  await selection.getByRole('button', { name: 'Рэн', exact: true }).click();
  await expect(selection.locator('[aria-pressed="true"]')).toHaveCount(1);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/character') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ skin: 16, name: 'Рэн из клуба' });
  await expectConnected(page);
  await expect.poll(async () => (await state(page)).skin).toBe(16);
  expect((await state(page)).texture).toBe('citizen-16');
  expect((await state(page)).appearance).toBe('');
  expect(await savedAccount(page)).toMatchObject({ skin: 16, name: 'Рэн из клуба', appearance: null });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectConnected(page);
  await expect.poll(async () => (await state(page)).skin).toBe(16);
  expect((await state(page)).texture).toBe('citizen-16');
  await openSettings(page);
  await expect(page.locator('#settings-character-selection').getByRole('button', { name: 'Рэн', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('settings replace the fixed character live without reconnecting', async ({ page }) => {
  await createAccount(page, { skin: 1, name: 'Лиззи в клубе' });
  const beforeNetwork = await network(page);
  const beforeState = await state(page);
  const beforePortrait = await page.locator('#player-portrait img').getAttribute('src');
  await openSettings(page);
  const selection = page.locator('#settings-character-selection');
  await expect(selection.getByRole('button', { name: 'Лиззи', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await selection.getByRole('button', { name: 'Гас', exact: true }).click();
  await page.locator('#new-game-name').fill('Гас в клубе');
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/character') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ skin: 12, name: 'Гас в клубе' });
  await expect(page.locator('#name-dialog')).toBeHidden();
  await expect.poll(async () => (await state(page)).skin).toBe(12);
  expect((await state(page)).texture).toBe('citizen-12');
  expect((await state(page)).appearance).toBe('');
  expect((await network(page)).selfId).toBe(beforeNetwork.selfId);
  expect((await network(page)).roomId).toBe(beforeNetwork.roomId);
  expect((await state(page)).x).toBeCloseTo(beforeState.x, 0);
  expect((await state(page)).y).toBeCloseTo(beforeState.y, 0);
  await expect.poll(() => page.locator('#player-portrait img').getAttribute('src')).not.toBe(beforePortrait);
  expect(await savedAccount(page)).toMatchObject({ skin: 12, name: 'Гас в клубе', appearance: null });
  await openSettings(page);
  await expect(selection.getByRole('button', { name: 'Гас', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('renaming a legacy custom character preserves its appearance', async ({ page }) => {
  const appearance = { ...DEFAULT_APPEARANCE, body: 1, hair: 3, tattoo: 5 };
  await createAccount(page, { appearance, name: 'Старый образ' });
  await expect.poll(async () => JSON.parse((await state(page)).appearance || '{}')).toEqual(appearance);
  const beforeTexture = (await state(page)).texture;
  await openSettings(page);
  await expect(page.locator('#settings-character-selection .character-choice[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#settings-character-selection').getByRole('button', { name: 'Гас', exact: true }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('#name-dialog')).toBeHidden();
  expect(JSON.parse((await state(page)).appearance)).toEqual(appearance);
  await openSettings(page);
  await expect(page.locator('#settings-character-selection .character-choice[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#new-game-name').fill('Новое имя');
  const characterRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/auth/character')) characterRequests.push(request.url());
  });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ name: 'Новое имя' });
  await expect(page.locator('#name-dialog')).toBeHidden();
  expect(characterRequests).toEqual([]);
  expect(await savedAccount(page)).toMatchObject({ skin: 0, name: 'Новое имя', appearance });
  expect(JSON.parse((await state(page)).appearance)).toEqual(appearance);
  expect((await state(page)).texture).toBe(beforeTexture);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectConnected(page);
  await expect.poll(async () => JSON.parse((await state(page)).appearance || '{}')).toEqual(appearance);
  expect((await state(page)).texture).toBe(beforeTexture);
});

test('explicitly choosing Eddie replaces a legacy custom character with skin zero', async ({ page }) => {
  const appearance = { ...DEFAULT_APPEARANCE, body: 2, top: 5, glasses: 1 };
  await createAccount(page, { appearance, name: 'Кастомный гость' });
  await expect.poll(async () => (await state(page)).texture).toMatch(/^avatar-v1-/);
  await openSettings(page);
  const selection = page.locator('#settings-character-selection');
  await expect(selection.locator('.character-choice[aria-pressed="true"]')).toHaveCount(0);
  await selection.getByRole('button', { name: 'Эдди', exact: true }).click();
  await expect(selection.getByRole('button', { name: 'Эдди', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/character') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ skin: 0, name: 'Кастомный гость' });
  await expect(page.locator('#name-dialog')).toBeHidden();
  await expect.poll(async () => (await state(page)).texture).toBe('citizen-0');
  expect((await state(page)).appearance).toBe('');
  expect(await savedAccount(page)).toMatchObject({ skin: 0, name: 'Кастомный гость', appearance: null });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectConnected(page);
  await expect.poll(async () => (await state(page)).texture).toBe('citizen-0');
  expect((await state(page)).appearance).toBe('');
});
