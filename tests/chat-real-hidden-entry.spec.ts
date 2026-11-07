import { test, expect, type Page } from '@playwright/test';
import { PostgresDatabase } from '../server/database';
import { projectStreetPoint, StreetView } from '../src/game/streetView';
import type { RoomScene } from '../src/game/RoomScene';
import { onRoofWindowPlatform, roofWindowPlatformOffset, roofWindowPlatformPosition } from '../src/shared/rooftop';
import { STAIR_WINDOW } from '../src/shared/stairWindow';
import { STREET } from '../src/shared/street';
import { ROOF_TOILET, TOILET_HALL_DOOR } from '../src/shared/toilet';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import type { ChatMessage, HallId } from '../src/shared/world';
import { securityRoom } from './security-room';

type Point = { x: number; y: number };
type SceneState = ReturnType<RoomScene['getState']>;
type NetworkState = { roomId: string; selfId: string; status: string };
const state = (page: Page) => page.evaluate((): SceneState => (window as any).royalDemo?.getState());
const network = (page: Page) => page.evaluate((): NetworkState => (window as any).royalDemo?.getNetworkState());

async function overview(page: Page, on: boolean) {
  const button = page.locator('#room-overview');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(on);
}

async function clickViewPoint(page: Page, point: Point, inStreetCoordinates = false) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const current = await state(page), { view } = current;
  const target = inStreetCoordinates && current.street ? projectStreetPoint(point, current.street.view.orientation) : point;
  const box = (await page.locator('#game canvas').boundingBox())!;
  const x = box.x + (target.x - view.x) * view.zoom * box.width / view.width;
  const y = box.y + (target.y - view.y) * view.zoom * box.height / view.height;
  expect(x).toBeGreaterThanOrEqual(box.x); expect(x).toBeLessThanOrEqual(box.x + box.width);
  expect(y).toBeGreaterThanOrEqual(box.y); expect(y).toBeLessThanOrEqual(box.y + box.height);
  await page.mouse.click(x, y);
}

async function walk(page: Page, point: Point) {
  const tolerance = Math.max(5, 2 / (await state(page)).view.zoom);
  await clickViewPoint(page, point, true);
  await expect.poll(async () => {
    const p = await state(page);
    return Math.max(Math.hypot(p.x - point.x, p.y - point.y), Math.hypot(p.serverX! - point.x, p.serverY! - point.y));
  }, { timeout: 25000 }).toBeLessThan(tolerance);
}

async function walkBalcony(page: Page, offset: number) {
  const view = new StreetView(); view.side = 'rear';
  const point = view.point(roofWindowPlatformPosition(offset), true);
  await clickViewPoint(page, { x: point.x, y: point.y + 6 });
  await expect.poll(async () => {
    const position = await state(page);
    return onRoofWindowPlatform(position) ? Math.abs(roofWindowPlatformOffset(position) - offset) : Infinity;
  }, { timeout: 8000 }).toBeLessThan(4);
}

test('a marked guest enters by the roof toilet and the exterior balcony window with separate chat visits', async ({ page, request }) => {
  test.setTimeout(160000);
  expect(process.env.NODE_ENV).toBe('test');
  expect(process.env.PGHOST).toBe('127.0.0.1');
  expect(process.env.PGDATABASE).toBe('royal_test');
  expect(process.env.DATABASE_URL).toBe('');

  const host = await securityRoom(request);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const outsideMessages: string[] = [];
  host.room.onMessage<ChatMessage>('chat', message => outsideMessages.push(message.text));
  const dock = page.locator('#club-chat-dock'), input = page.locator('#chat-input');
  const rows = (text: string) => page.locator('#chat-log > [data-message-id]').filter({ hasText: text });
  const send = async (text: string) => {
    await input.fill(text);
    await page.locator('#send-chat').click();
    await expect(rows(text)).toHaveCount(1);
  };

  try {
    const login = await page.request.post('/api/auth/login', { data: {
      email: `hidden-entry-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!',
    } });
    expect(login.ok()).toBe(true);
    const account = (await login.json()).account.id as string;
    expect((await page.request.post('/api/auth/character', { data: { skin: 0, name: 'Гость с меткой' } })).ok()).toBe(true);
    const sanction = { id: crypto.randomUUID(), until: Date.now() + 20 * 60_000, amountCents: 1000, revision: 1 };
    const db = new PostgresDatabase('test_chat_real', { existingSchema: true });
    try {
      await db.prepare('INSERT INTO club_sanctions (account_id,episode_id,expires_at,amount_cents,revision) VALUES (?,?,?,?,?)')
        .run(account, sanction.id, sanction.until, sanction.amountCents, sanction.revision);
    } finally { await db.close(); }
    const verifyMark = async () => {
      const response = await page.request.get('/api/demo-wallet/club-fine', { headers: { [WALLET_ACCOUNT_HEADER]: account } });
      expect(response.ok()).toBe(true);
      expect((await response.json()).sanction).toEqual(sanction);
    };

    await page.goto('/?mode=club&room=' + host.room.roomId + '&lang=en');
    await expect.poll(async () => (await network(page))?.status, { timeout: 30000 }).toBe('connected');
    const joined = await network(page);
    const hall = async (location: HallId, timeout = 25000) => {
      await expect.poll(() => host.room.state.players.get(joined.selfId)?.hall, { timeout }).toBe(location);
      await expect.poll(async () => {
        const p = await state(page);
        return p?.online && !p.switching && p.hall === location;
      }, { timeout }).toBe(true);
    };
    const noChat = async () => {
      await expect(dock).toBeHidden();
      await expect(input).toBeDisabled();
    };
    await hall('street'); await noChat(); await verifyMark();

    await overview(page, true);
    for (const point of [STREET.loop[0], STREET.loop[3], { x: 1660, y: 360 }]) await walk(page, point);
    await overview(page, false);
    await page.locator('#game').focus();
    await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    try { await hall('roof', 45000); }
    finally { await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
    await noChat();

    await overview(page, true);
    await clickViewPoint(page, ROOF_TOILET.click);
    await hall('toilet');
    await expect(dock).toHaveAttribute('data-chat-hall', 'toilet');
    await expect(input).toBeEnabled();
    const toiletText = 'A message from the restroom visit';
    await send(toiletText);
    const arcadeText = 'The arcade observer is still downstairs';
    host.sendChat(arcadeText);
    await expect.poll(() => outsideMessages).toContain(arcadeText);
    expect(outsideMessages).not.toContain(toiletText);
    await expect(rows(arcadeText)).toHaveCount(0);

    await overview(page, true);
    await clickViewPoint(page, TOILET_HALL_DOOR.click);
    await hall('github');
    await expect(dock).toHaveAttribute('data-chat-hall', 'github');
    await expect(rows(toiletText)).toHaveCount(0);
    const oldVisitText = 'The first visit to the third floor';
    await send(oldVisitText);
    await verifyMark();

    await overview(page, true);
    // Move sideways before approaching the window to stay clear of the nearby restroom doorway.
    await walk(page, STAIR_WINDOW.arrival);
    await walk(page, STAIR_WINDOW.entry);
    await page.locator('#game').focus();
    await page.keyboard.down('w');
    try { await hall('street'); }
    finally { await page.keyboard.up('w'); }
    expect(onRoofWindowPlatform(await state(page))).toBe(true);
    await noChat();

    await overview(page, false);
    await walkBalcony(page, 170);
    await walkBalcony(page, STAIR_WINDOW.platformLength - 38);
    await expect.poll(() => {
      const player = host.room.state.players.get(joined.selfId);
      return player && onRoofWindowPlatform(player) && Math.abs(roofWindowPlatformOffset(player) - (STAIR_WINDOW.platformLength - 38)) < 5;
    }).toBe(true);
    await page.locator('#game').focus();
    await page.keyboard.down('w');
    try { await hall('github'); }
    finally { await page.keyboard.up('w'); }
    await expect(dock).toHaveAttribute('data-chat-hall', 'github');
    await expect(rows(oldVisitText)).toHaveCount(0);
    await send('A fresh visit from the balcony window');
    await verifyMark();
    expect(await network(page)).toMatchObject(joined);
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank').catch(() => {});
    await host.room.leave();
  }
});
