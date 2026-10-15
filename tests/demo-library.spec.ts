import { test, expect, type Page } from '@playwright/test';
import { selectHall } from './room-ui';

const catalog = 'https://luelonplay.com/demo-api/v1/games?lang=en';
const categories = ['slot', 'flight', 'crash', 'keno', 'plinko', 'dice', 'wheel', 'mines'];
const games = categories.map(category => ({ id: `test-${category}`, name: `Test ${category}`, category, artworkUrl: 'https://luelonplay.com/assets/test-library.svg', embedUrl: `https://luelonplay.com/embed/test-${category}/?lang=en` }));
async function open(page: Page) {
  await page.goto('/?offline=1');
  await expect(page.locator('#loading')).toHaveCount(0);
  await selectHall(page, 'tables');
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="luelon"]').click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 15000 });
}
async function mockArt(page: Page) {
  await page.route('https://luelonplay.com/assets/test-library.svg', route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#126"/></svg>' }));
}

test('mobile catalogue filters all game categories, launches the chosen game and remembers its preview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let launches = 0;
  await page.route(catalog, route => route.fulfill({ json: { games: [...games,
    { ...games[0], id: 'untrusted', embedUrl: 'https://example.org/embed/test/' },
    { ...games[0], id: 'credentials', embedUrl: 'https://user@luelonplay.com/embed/test/' },
    { ...games[0], id: 'javascript', embedUrl: 'javascript:alert(1)' },
    { ...games[0], id: 'wrong-category', category: 'live' }, games[0],
  ] } }));
  await mockArt(page);
  await page.route('https://luelonplay.com/embed/**', route => {
    launches++; return route.fulfill({ contentType: 'text/html', body: `<button>${new URL(route.request().url()).pathname}</button>` });
  });
  await open(page);
  await expect(page.frameLocator('#mini-game iframe').getByRole('button')).toHaveText('/embed/test-slot/');
  await page.getByRole('button', { name: 'Все демоигры', exact: true }).click();
  await expect(page.locator('#mini-game iframe')).toHaveCount(0);
  await expect(page.locator('[data-demo-game]')).toHaveCount(8);
  expect(launches).toBe(1);
  await expect(page.locator('#mini-dialog .demo-library-count')).toHaveText('Показано 8 из 8');
  expect(await page.locator('#mini-dialog .demo-library').evaluate(element => element.scrollTop)).toBe(0);
  await page.getByLabel('Категория демоигр').selectOption('dice');
  await expect(page.locator('[data-demo-game]')).toHaveCount(1);
  await page.getByLabel('Поиск демоигр').fill('нет такой игры');
  await expect(page.locator('#mini-dialog .demo-library-empty')).toBeVisible();
  await page.getByLabel('Поиск демоигр').fill('DICE');
  await page.getByRole('button', { name: 'Играть в Test dice', exact: true }).click();
  await expect(page.frameLocator('#mini-game iframe').getByRole('button')).toHaveText('/embed/test-dice/');
  await expect(page.locator('#mini-title')).toHaveText('Test dice');
  const box = (await page.locator('#mini-game iframe').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(320);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.locator('#retry-demo').click();
  await expect.poll(() => launches).toBe(3);
  await expect(page.locator('#mini-game iframe')).toHaveCount(1);
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect(page.locator('#machine-name')).toHaveText('Test dice');
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet="luelon"]')).toContainText('Test dice');
  await page.locator('[data-cabinet="luelon"]').click();
  await expect(page.frameLocator('#mini-game iframe').getByRole('button')).toHaveText('/embed/test-dice/');
  expect(errors).toEqual([]);
});

test('a removed game fails safely and refreshing the catalogue removes its card', async ({ page }) => {
  let removed = false, launches = 0;
  await page.route(catalog, route => route.fulfill({ json: { games: removed ? [games[0]] : games } }));
  await mockArt(page);
  await page.route('https://luelonplay.com/embed/**', route => { launches++; return route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }); });
  await open(page);
  await expect(page.frameLocator('#mini-game iframe').getByRole('button')).toBeVisible();
  await page.getByRole('button', { name: 'Все демоигры', exact: true }).click();
  await expect(page.locator('[data-demo-game]')).toHaveCount(8);
  removed = true;
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now + 6 * 60 * 1000; });
  await page.getByRole('button', { name: 'Играть в Test mines', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible();
  await expect(page.locator('#mini-game iframe')).toHaveCount(0);
  expect(launches).toBe(1);
  await page.getByRole('button', { name: 'Все демоигры', exact: true }).click();
  await expect(page.locator('[data-demo-game]')).toHaveCount(1);
  await expect(page.locator('[data-demo-game="test-mines"]')).toHaveCount(0);
});

test('closing during catalogue refresh prevents late launch and selection changes', async ({ page }) => {
  let hold = false, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(catalog, async route => { if (hold) await blocked; await route.fulfill({ json: { games } }); });
  await mockArt(page);
  await page.route('https://luelonplay.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Play</button>' }));
  await open(page);
  await expect(page.frameLocator('#mini-game iframe').getByRole('button')).toBeVisible();
  await page.getByRole('button', { name: 'Все демоигры', exact: true }).click();
  await expect(page.locator('[data-demo-game]')).toHaveCount(8);
  hold = true;
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now + 6 * 60 * 1000; });
  const fetching = page.waitForRequest(catalog);
  await page.getByRole('button', { name: 'Играть в Test wheel', exact: true }).click();
  await fetching;
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  const loaded = page.waitForResponse(catalog); release(); await loaded;
  await expect(page.locator('#mini-game iframe')).toHaveCount(0);
  await expect(page.locator('#machine-name')).toHaveText('Test slot');
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().locked)).toBe(false);
});
