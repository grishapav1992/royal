import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_APPEARANCE } from '../src/shared/appearance';
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const net = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());
const appearance = async (page: Page) => JSON.parse((await state(page)).appearance || '{}');
async function login(page: Page, url = '/') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Почта', { exact: true }).fill(`wardrobe-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Wardrobe-test-123!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
}
async function option(page: Page, category: string, name: string) {
  await page.getByRole('tab', { name: category, exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('custom appearance persists and updates live for another player on desktop and phone', async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const b = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = []; for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  try {
    await login(a);
    await a.getByLabel('Игровое имя', { exact: true }).fill('Пельменный барон');
    await option(a, 'Основа', 'Телосложение: Толстый');
    await option(a, 'Лицо', 'Борода и усы: Усы');
    await option(a, 'Волосы', 'Причёска: Кудри');
    await option(a, 'Одежда', 'Верх: Жилет');
    await option(a, 'Аксессуары', 'Очки: Круглые');
    await option(a, 'Аксессуары', 'Головной убор: Дуршлаг');
    await option(a, 'Тату', 'Глупые татуировки: Пельмень на щеке');
    await a.getByRole('tab', { name: 'Основа', exact: true }).click();
    await a.screenshot({ path: 'artifacts/customization/editor-desktop.png' });
    await a.getByRole('button', { name: 'Войти в зал', exact: true }).click();
    await expect(a.locator('#join-dialog')).toBeHidden();
    await expect.poll(async () => (await appearance(a)).body).toBe(1);
    const first = await appearance(a), network = await net(a);
    expect(first).toMatchObject({ facialHair: 1, hair: 3, top: 5, glasses: 1, hat: 6, tattoo: 1 });
    expect((await state(a)).texture).toMatch(/^avatar-v1-/);
    const portrait = await a.locator('#player-portrait img').getAttribute('src');
    await login(b, '/?room=' + network.roomId);
    await option(b, 'Основа', 'Пол: Женский');
    await option(b, 'Основа', 'Телосложение: Длинный');
    await option(b, 'Волосы', 'Причёска: Два пучка');
    await option(b, 'Волосы', 'Цвет волос: Розовый');
    await option(b, 'Лицо', 'Макияж: Полный');
    await option(b, 'Лицо', 'Цвет макияжа: Красный');
    await option(b, 'Аксессуары', 'Серьги: Вишенки');
    await b.getByRole('tab', { name: 'Основа', exact: true }).click();
    await expect(b.locator('#join-button')).toBeInViewport();
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await b.screenshot({ path: 'artifacts/customization/editor-mobile.png' });
    await b.getByRole('button', { name: 'Войти в зал', exact: true }).click();
    await expect(b.locator('#join-dialog')).toBeHidden();
    await expect.poll(async () => (await appearance(b)).body).toBe(2);
    expect(await appearance(b)).toMatchObject({ makeup: 5, makeupColor: 1 });
    const phoneNetwork = await net(b);
    await expect.poll(async () => JSON.parse((await state(a)).remotePositions.find((p: any) => p.id === phoneNetwork.selfId)?.appearance || '{}').makeup).toBe(5);
    const remote = async () => (await state(b)).remotePositions.find((p: any) => p.id === network.selfId);
    await expect.poll(async () => JSON.parse((await remote())?.appearance || '{}')).toEqual(first);
    await a.keyboard.down('w');
    try { await expect.poll(async () => (await remote())?.frame).toMatch(/^up-[0-5]$/); }
    finally { await a.keyboard.up('w'); }
    await a.getByRole('button', { name: 'Настройки игрока', exact: true }).click();
    const position = await state(a);
    await option(a, 'Основа', 'Телосложение: Длинный');
    await option(a, 'Тату', 'Глупые татуировки: 404 на щеке');
    await a.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await expect(a.locator('#name-dialog')).toBeHidden();
    await expect.poll(async () => JSON.parse((await remote())?.appearance || '{}').tattoo).toBe(5);
    expect((await net(a)).selfId).toBe(network.selfId);
    expect((await state(a)).x).toBeCloseTo(position.x, 0);
    await expect.poll(async () => a.locator('#player-portrait img').getAttribute('src')).not.toBe(portrait);
    await a.getByRole('button', { name: 'Настройки игрока', exact: true }).click();
    await option(a, 'Основа', 'Телосложение: Стандартный');
    await a.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect((await appearance(a)).body).toBe(2);
    await a.reload({ waitUntil: 'domcontentloaded' });
    await expect(a.locator('#join-dialog')).toBeHidden();
    await expect.poll(async () => (await appearance(a)).tattoo).toBe(5);
    await b.getByRole('button', { name: 'Настройки игрока', exact: true }).click();
    await option(b, 'Одежда', 'Верх: Свитер в полоску');
    await expect(b.getByRole('button', { name: 'Сохранить настройки', exact: true })).toBeInViewport();
    await b.screenshot({ path: 'artifacts/customization/settings-mobile.png' });
    await b.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await expect.poll(async () => (await appearance(b)).top).toBe(3);
    await b.reload({ waitUntil: 'domcontentloaded' });
    await expect(b.locator('#join-dialog')).toBeHidden();
    await expect.poll(async () => (await appearance(b)).makeup).toBe(5);
    expect((await appearance(b)).makeupColor).toBe(1);
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

test('legacy accounts retain their old character until they save a custom appearance', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { email: `legacy-${crypto.randomUUID()}@example.test`, password: 'Legacy-test-123!' } });
  await page.request.post('/api/auth/character', { data: { skin: 12, name: 'Старый знакомый' } });
  await page.goto('/');
  await expect(page.locator('#join-dialog')).toBeHidden();
  await expect.poll(async () => (await state(page)).skin).toBe(12);
  expect((await state(page)).texture).toBe('citizen-12');
  await page.getByRole('button', { name: 'Настройки игрока', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Борода и усы: Усы', exact: true })).toBeHidden();
  await option(page, 'Лицо', 'Борода и усы: Борода');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect.poll(async () => (await appearance(page)).facialHair).toBe(2);
  expect((await state(page)).texture).toMatch(/^avatar-v1-/);
});

test('server rejects malformed appearances without changing the saved profile', async ({ request }) => {
  await request.post('/api/auth/login', { data: { email: `validation-${crypto.randomUUID()}@example.test`, password: 'Validation-test-123!' } });
  const valid = { ...DEFAULT_APPEARANCE, tattoo: 5, body: 1 };
  expect((await request.post('/api/auth/character', { data: { appearance: valid, name: 'Сохранённое имя' } })).ok()).toBe(true);
  for (const invalid of [{ ...valid, hat: 1000 }, { ...valid, body: -1 }, { ...valid, tattoo: 1.2 }, { ...valid, topColor: '#ff0000' }, { ...valid, makeup: 6 }, { ...valid, makeupColor: '#ff0000' }, { ...valid, version: 2 }, { ...valid, script: '<script>' }, { version: 1 }, null]) {
    expect((await request.post('/api/auth/character', { data: { appearance: invalid, name: 'Не сохранять' } })).status()).toBe(400);
  }
  const account = (await request.get('/api/auth/me').then(response => response.json())).account;
  expect(account.appearance).toEqual(valid); expect(account.name).toBe('Сохранённое имя');
});
