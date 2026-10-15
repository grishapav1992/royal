import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const network = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());
const password = 'Royal-bar-entry-123!';
const email = () => `bar-entry-${crypto.randomUUID()}@example.test`;

async function account(page: Page, address: string, skin: number) {
  expect((await page.context().request.post('/api/auth/login', { data: { email: address, password } })).ok()).toBe(true);
  expect((await page.context().request.post('/api/auth/character', { data: { skin } })).ok()).toBe(true);
}

async function mira(page: Page) {
  await page.route('**/api/npc/mira', route => route.fulfill({ json: {
    turns: [{ role: 'assistant', content: 'Привет. Тебе вино?' }], drinkOffer: 'wine', emotion: 'smile',
  } }));
}

test('the first bar click survives the initial authoritative room state arriving later', async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const held: Array<() => void> = [];
    let holding = true;
    (window as any).__heldRoomStates = () => held.length;
    (window as any).__releaseRoomStates = () => {
      holding = false;
      for (const deliver of held.splice(0)) deliver();
    };
    window.WebSocket = class extends NativeWebSocket {
      private handler: ((event: MessageEvent) => void) | null = null;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        super.addEventListener('message', event => {
          const code = event.data instanceof ArrayBuffer ? new Uint8Array(event.data)[0] : 0;
          // Hold real Colyseus full states and patches, preserving their order and bytes.
          if (holding && (code === 14 || code === 15)) held.push(() => this.handler?.call(this, event));
          else this.handler?.call(this, event);
        });
      }
      get onmessage() { return this.handler; }
      set onmessage(handler) { this.handler = handler; }
    };
  });
  await account(page, email(), 0);
  await mira(page);
  await page.goto('/');
  await expect.poll(async () => (await network(page))?.status).toBe('connected');
  await expect.poll(() => page.evaluate(() => (window as any).__heldRoomStates())).toBeGreaterThan(0);
  expect((await state(page)).serverX).toBeUndefined();
  expect((await state(page)).locked).toBe(false);
  await page.locator('#visit-bar').click();
  expect((await state(page)).serverX).toBeUndefined();
  await page.evaluate(() => (window as any).__releaseRoomStates());
  await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  expect((await state(page)).locked).toBe(true);
});

test('changing accounts closes the old bar and the new player can consume a confirmed drink', async ({ page }) => {
  test.setTimeout(45000);
  const nextAddress = email();
  await account(page, nextAddress, 4);
  await account(page, email(), 0);
  await mira(page);
  await page.goto('/');
  await expect.poll(async () => (await network(page))?.status).toBe('connected');
  await expect.poll(async () => (await state(page)).serverX).toBeDefined();
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.locator('#login-step')).toBeVisible();
  await expect(page.locator('#bar-dialog')).toBeHidden();
  await page.locator('#email').fill(nextAddress);
  await page.locator('#password').fill(password);
  await page.locator('#login-button').click();
  await expect.poll(async () => (await network(page))?.status).toBe('connected');
  await expect.poll(async () => (await state(page)).skin).toBe(4);
  await expect(page.locator('#bar-dialog')).toBeHidden();
  expect((await state(page)).intoxication.stage).toBe(0);
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Напитки', exact: true }).click();
  await page.locator('[data-drink="wine"]').click();
  await expect.poll(async () => (await state(page)).drink).toBe('wine');
  expect((await state(page)).intoxication.stage).toBe(1);
  await expect(page.locator('.mira-player figcaption small')).toContainText('Пьёшь: Вино');
});
