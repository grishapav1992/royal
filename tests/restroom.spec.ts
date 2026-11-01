import { test, expect, type Page } from '@playwright/test';
import { RESTROOM } from '../src/shared/restroom';


const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
async function worldPoint(page: Page, x: number, y: number) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!, { view } = await state(page);
  return { x: box.x + (x - view.x) * view.zoom * box.width / view.width, y: box.y + (y - view.y) * view.zoom * box.height / view.height };
}

async function floorThree(page: Page) {
  await page.locator('#elevator-shortcut').click();
  await expect(page.locator('#elevator-dialog')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-elevator-floor]')).toHaveCount(3);
  await page.locator('[data-elevator-floor="github"]').click();
  await expect.poll(async () => (await state(page)).hall).toBe('github');
  await expect(page.locator('#elevator-dialog')).toBeHidden();
}

async function visitRestroom(page: Page, name: string) {
  await floorThree(page);
  await page.locator('#room-overview').click();
  // Exercise the visible world doorway, including the walk to its threshold.
  const door = await worldPoint(page, RESTROOM.entrance.click.x, RESTROOM.entrance.click.y);
  await page.mouse.click(door.x, door.y);
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('restroom');
  await expect(page.locator('h1')).toContainText('Туалет');
  await expect(page.locator('#elevator-shortcut')).toBeHidden();
  await expect(page.locator('[data-floor-target="github"]')).toHaveText(/Карточный салон/);
  await expect(page.locator('#games-tab')).toHaveText('Игры · 0');
  // Walk to a sink, then leave through the same shared navigation system.
  const sink = await worldPoint(page, 1120, 770);
  await page.mouse.click(sink.x, sink.y);
  await expect.poll(async () => Math.hypot((await state(page)).x - 1120, (await state(page)).y - 770), { timeout: 10000 }).toBeLessThan(5);
  await page.locator('#game').screenshot({ path: `artifacts/work/third-floor-restroom/${name}.png` });
  await page.locator('[data-floor-target="github"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 12000 }).toBe('github');
  await expect(page.locator('#elevator-shortcut')).toBeVisible();
  await expect.poll(async () => Math.hypot((await state(page)).x - RESTROOM.entrance.arrival.x, (await state(page)).y - RESTROOM.entrance.arrival.y)).toBeLessThan(5);
}

test('desktop and mobile can enter, walk inside and return to floor three', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.goto('/?offline=1'); await expect(page.locator('#loading')).toHaveCount(0);
    await visitRestroom(page, name);
    expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('online visitor enters and returns with the server confirming each location', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Prepare an isolated visitor through the real API so this test focuses on room travel.
  const login = await page.request.post('/api/auth/login', { data: { email: `restroom-${crypto.randomUUID()}@example.test`, password: 'Restroom-browser-password!' } });
  expect(login.ok(), `login ${login.status()}: ${await login.text()}`).toBe(true);
  const character = await page.request.post('/api/auth/character', { data: { skin: 0 } });
  expect(character.ok(), `character ${character.status()}: ${await character.text()}`).toBe(true);
  await page.goto('/'); await expect(page.locator('#loading')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).online, { timeout: 15000 }).toBe(true);
  await expect(page.locator('#join-dialog')).toBeHidden();
  await visitRestroom(page, 'online');
  expect((await state(page)).online).toBe(true);
  expect(errors).toEqual([]);
});
