import { test, expect, type Page } from '@playwright/test';
import type { ChatResult } from '../src/shared/chat';
import type { ClubCaptureDecision } from '../src/shared/security';
import type { ChatMessage } from '../src/shared/world';
import { securityRoom } from './security-room';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo?.getState());
const network = (page: Page) => page.evaluate(() => (window as any).royalDemo?.getNetworkState());

async function register(page: Page) {
  const login = await page.request.post('/api/auth/login', { data: { email: `security-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(login.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character', { data: { skin: 4, name: 'Тест охраны' } })).ok()).toBe(true);
}

test('an observer sees masked profanity and the first confirmed spam capture while the offender stays connected', async ({ browser, request }) => {
  test.setTimeout(90000);
  const a = await browser.newContext(), b = await browser.newContext();
  const player = await a.newPage(), observer = await b.newPage();
  const errors: string[] = [];
  for (const page of [player, observer]) page.on('pageerror', error => errors.push(error.message));
  const { room: host } = await securityRoom(request);
  try {
    for (const page of [player, observer]) {
      await register(page);
      await page.goto('/?mode=club&lang=ru&room=' + host.roomId);
      await expect(page.locator('#chat-input')).toBeEnabled();
    }
    const { selfId } = await network(player);
    const input = player.locator('#chat-input');
    const send = async (text: string) => { await input.fill(text); await input.press('Enter'); };
    await send('Всем привет');
    await expect(observer.locator('#chat-log')).toContainText('Всем привет');
    await send('я дебил, fuck');
    await expect(observer.locator('#chat-log')).toContainText('я дебил, f**k');
    await expect(observer.locator('.security-message')).toHaveCount(0);

    const spam = 'Синтетическое объявление';
    const messages = observer.locator('#chat-log > [data-message-id]').filter({ hasText: spam });
    for (let count = 1; count <= 2; count++) {
      await send(spam);
      await expect(messages).toHaveCount(count);
    }
    await send(spam);
    await expect(observer.locator('.security-message')).toContainText('спам в чате');
    await expect(messages).toHaveCount(2);
    await expect.poll(() => host.state.guards.get('security')?.target, { timeout: 20000 }).toBe(selfId);
    await expect.poll(async () => (await state(observer))?.guards?.[0]?.phase, { timeout: 20000 }).toBe('carry');
    await player.locator('#game').focus();
    await player.keyboard.press('d', { delay: 150 });
    expect((await state(player)).predicted).toBe(false);
    await expect.poll(async () => (await state(player))?.hall, { timeout: 30000 }).toBe('street');
    expect(await network(player)).toMatchObject({ status: 'connected', roomId: host.roomId, selfId });
    await expect(player.locator('#club-chat-dock')).toBeHidden();
    await expect(player.locator('#security-dialog')).toBeHidden();

    await player.setViewportSize({ width: 390, height: 844 });
    await player.reload();
    await expect.poll(async () => (await network(player))?.status, { timeout: 30000 }).toBe('connected');
    await expect.poll(async () => (await state(player))?.hall).toBe('street');
    await expect(player.locator('#join-dialog')).toBeHidden();
    await expect(player.locator('#club-fine-open')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); await host.leave(); }
});

test('Telegram references across two rooms count toward the same spam threshold and capture in the source room', async ({ request }) => {
  test.setTimeout(60000);
  const a = await securityRoom(request), b = await securityRoom(request, a.cookie);
  const results = new Map<string, ChatResult>();
  const announcements: ChatMessage[] = [];
  const captures: ClubCaptureDecision[] = [];
  for (const { room } of [a, b]) room.onMessage('chat-result', value => results.set(value.id, value));
  a.room.onMessage('club-capture', value => captures.push(value));
  b.room.onMessage('chat', value => { if (value.senderId === 'security') announcements.push(value); });
  try {
    const first = a.sendChat('Анонсы здесь: https://t.me/RoyalExample');
    await expect.poll(() => results.get(first)?.status).toBe('published');
    const second = b.sendChat('Наш канал: телеграм @royalexample');
    await expect.poll(() => results.get(second)?.status).toBe('published');
    const third = a.sendChat('Новая публикация t.me/s/RoyalExample/4');
    await expect.poll(() => results.get(third)?.status).toBe('rejected');
    await expect.poll(() => captures, { timeout: 30000 }).toMatchObject([{ kind: 'ejecting', reason: 'spam' }]);
    await expect.poll(() => a.room.state.players.get(a.room.sessionId)?.hall, { timeout: 25000 }).toBe('street');
    expect(announcements).toEqual([]);
  } finally { await a.room.leave(); await b.room.leave(); }
});
