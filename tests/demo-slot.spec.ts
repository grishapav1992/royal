import { test, expect, type Page } from '@playwright/test';
import { CABINETS } from '../src/shared/cabinets';
import { selectHall, worldPoint } from './room-ui';
const catalog = 'https://luelonplay.com/demo-api/v1/games?lang=en';
const embed = 'https://luelonplay.com/embed/test-slot/?lang=en';
const games = { games: [{ id: 'test-slot', name: 'Test Slot', category: 'slot', embedUrl: embed }] };
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
async function openSlot(page: Page) {
  await selectHall(page, 'tables');
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="luelon"]').click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 15000 });
}

test('logged-in player opens Luelon on the second floor, closes it and returns to a casino game', async ({ page }) => {
  let launches = 0;
  await page.route(catalog, route => route.fulfill({ json: games }));
  await page.route(embed, route => { launches++; return route.fulfill({ contentType: 'text/html', body: '<button>Spin demo</button>' }); });
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`slot-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-demo-123!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden();
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet="luelon"]')).toBeHidden();
  await page.locator('#panel-close').click();
  await page.locator('#room-overview').click();
  await selectHall(page, 'tables');
  const cabinet = CABINETS.find(item => item.id === 'luelon')!;
  const point = await worldPoint(page, cabinet.x, cabinet.y - 25);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 15000 });
  expect((await state(page)).hall).toBe('tables');
  expect((await state(page)).near).toBe('luelon');
  await expect(page.frameLocator('#mini-game iframe').getByRole('button', { name: 'Spin demo' })).toBeVisible();
  const demoAudio = await page.evaluate(() => (window as any).royalDemo.getAudio());
  expect(demoAudio.game).toBe('demo');
  expect(demoAudio.casino.scheduled).toBe(false);
  expect(demoAudio.casino.level).toBe(0);
  expect(launches).toBe(1);
  expect((await state(page)).locked).toBe(true);
  await expect(page.locator('#start-game')).toBeHidden();
  await expect(page.locator('.mini-stats')).toBeHidden();
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect(page.locator('#mini-game iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).royalDemo.getAudio().game)).toBe('');
  expect(await page.evaluate(() => (window as any).royalDemo.getAudio().hall)).toBe('tables');
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await selectHall(page, 'arcade');
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet="luelon"]')).toBeHidden();
  await page.locator('[data-cabinet="royal-dice"]').click();
  await expect(page.locator('.original-game[data-game="royal-dice"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#original-play')).toBeVisible();
  await expect(page.locator('.demo-footer')).toBeHidden();
});

test('unavailable catalogue retries and mobile frame stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let available = false;
  await page.route(catalog, route => available ? route.fulfill({ json: games }) : route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.route(embed, route => route.fulfill({ contentType: 'text/html', body: '<button>Spin demo</button>' }));
  await page.goto('/?offline=1');
  await expect(page.locator('#loading')).toHaveCount(0);
  await openSlot(page);
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.frameLocator('#mini-game iframe').getByRole('button')).toBeVisible();
  const box = (await page.locator('#mini-game iframe').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(320);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect.poll(async () => (await state(page)).locked).toBe(false);
});

test('slow provider response survives the first 31 seconds and loads successfully', async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route(catalog, route => route.fulfill({ json: games }));
  await page.route(embed, async route => {
    await hold;
    await route.fulfill({ contentType: 'text/html', body: '<button>Spin demo</button>' });
  });
  await page.clock.install();
  try {
    await page.goto('/?offline=1');
    await expect(page.locator('#loading')).toHaveCount(0);
    const requested = page.waitForRequest(embed);
    await openSlot(page);
    await requested;
    await expect(page.locator('#mini-game iframe')).toHaveCount(1);
    await expect(page.locator('.demo-slot-status')).toContainText('Загружаем демоигру');
    await page.clock.fastForward(31000);
    await expect(page.locator('#mini-game iframe')).toHaveCount(1);
    await expect(page.locator('.demo-slot-status')).toContainText('Загружаем демоигру');
    await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeHidden();
    expect((await state(page)).locked).toBe(true);
    const loaded = page.waitForResponse(embed);
    release();
    await loaded;
    await expect(page.frameLocator('#mini-game iframe').getByRole('button', { name: 'Spin demo' })).toBeVisible();
    await expect(page.locator('.demo-slot-status')).toBeHidden();
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#mini-game iframe')).toHaveCount(0);
    await expect.poll(async () => (await state(page)).locked).toBe(false);
  } finally { release(); }
});

test('closing while catalogue is pending prevents a late iframe launch', async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route(catalog, async route => { await hold; await route.fulfill({ json: games }); });
  await page.goto('/?offline=1');
  await expect(page.locator('#loading')).toHaveCount(0);
  await openSlot(page);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  const loaded = page.waitForResponse(catalog);
  release(); await loaded;
  await expect(page.locator('#mini-game iframe')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).locked).toBe(false);
});

test('cover and title appear before launch and still launch the advertised game after catalogue reorder', async ({ page }) => {
  const artworkUrl = 'https://luelonplay.com/assets/test-cover.svg';
  const advertised = { ...games.games[0], artworkUrl };
  let reordered = false, launches = 0;
  await page.route(catalog, route => route.fulfill({ json: { games: reordered
    ? [{ ...advertised, id: 'another', name: 'Another Slot', embedUrl: 'https://luelonplay.com/embed/another/' }, advertised]
    : [advertised] } }));
  await page.route(artworkUrl, route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#126"/><text x="30" y="70" fill="white">Test Slot</text></svg>' }));
  await page.route('https://luelonplay.com/embed/**', route => {
    launches++;
    expect(route.request().url()).toBe(embed);
    return route.fulfill({ contentType: 'text/html', body: '<button>Spin demo</button>' });
  });
  await page.goto('/?offline=1');
  await expect(page.locator('#loading')).toHaveCount(0);
  await selectHall(page, 'tables');
  await page.locator('#games-tab').click();
  const card = page.locator('[data-cabinet="luelon"]');
  await expect(card).toContainText('Test Slot');
  const cover = card.getByRole('img', { name: 'Обложка Test Slot' });
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(480);
  const box = (await cover.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(1.5);
  expect(launches).toBe(0);
  await expect(page.locator('#mini-game iframe')).toHaveCount(0);
  reordered = true;
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now + 6 * 60 * 1000; });
  await card.click();
  await expect(page.frameLocator('#mini-game iframe').getByRole('button', { name: 'Spin demo' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#mini-title')).toHaveText('Test Slot');
  expect(launches).toBe(1);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect(page.locator('#interaction .interaction-cover')).toBeVisible();
  await expect(page.locator('#machine-name')).toHaveText('Test Slot');
});
