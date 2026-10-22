import { test, expect, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import type { ChatRequest, ChatResult } from '../src/shared/chat';
import type { ChatMessage } from '../src/shared/world';

type Proof = { requests: ChatRequest[]; results: ChatResult[]; messages: ChatMessage[] };
const proof = (page: Page) => page.evaluate(() => (window as any).__realChat as Proof);

async function register(page: Page, name: string) {
  const login = await page.request.post('/api/auth/login', { data: { email: `transport-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(login.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character', { data: { skin: 0, name } })).ok()).toBe(true);
}

async function captureRealTransport(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const fn = await cdp.send('Runtime.evaluate', { expression: 'window.royalDemo.getNetworkState' });
  const properties = await cdp.send('Runtime.getProperties', { objectId: fn.result.objectId! });
  const scopesId = properties.internalProperties!.find(property => property.name === '[[Scopes]]')!.value!.objectId!;
  const scopes = await cdp.send('Runtime.getProperties', { objectId: scopesId });
  const socialName = await page.evaluate(() => (window as any).royalDemo.getNetworkState.toString().match(/=>\s*([\w$]+)\?\.client/)?.[1]);
  let socialId: string | undefined;
  for (const scope of scopes.result) {
    if (!scope.value?.objectId || !/^\d+$/.test(scope.name)) continue;
    const values = await cdp.send('Runtime.getProperties', { objectId: scope.value.objectId });
    socialId = values.result.find(value => value.name === socialName)?.value?.objectId;
    if (socialId) break;
  }
  expect(socialId).toBeTruthy();
  const installed = await cdp.send('Runtime.callFunctionOn', { objectId: socialId!, returnByValue: true,
    functionDeclaration: `function() {
      const room = this.client.room, send = room.send.bind(room);
      const requests = [], results = [], messages = [];
      room.send = (type, value) => { if (type === 'chat') requests.push(value); return send(type, value); };
      room.onMessage('chat-result', result => results.push(result));
      room.onMessage('chat', message => messages.push(message));
      window.__realChat = { requests, results, messages, send: value => room.send('chat', value) };
      return { status: this.client.status, roomId: room.roomId };
    }` });
  expect(installed.exceptionDetails).toBeUndefined();
  expect(installed.result.value.status).toBe('connected');
  return cdp;
}

test('real UI and WebSocket deliver correlated messages once and keep legacy moderation', async ({ browser, request }) => {
  const hostLogin = await request.post('/api/auth/login', { data: { email: `transport-host-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(hostLogin.ok()).toBe(true);
  const cookie = hostLogin.headers()['set-cookie'].split(';')[0];
  await request.post('/api/auth/character', { data: { skin: 0 } });
  const host = await new Client(process.env.TEST_BASE_URL || 'http://127.0.0.1:2584', { headers: { Cookie: cookie } }).create('lobby');
  host.onMessage('*', () => {});
  const senderContext = await browser.newContext(), observerContext = await browser.newContext();
  const sender = await senderContext.newPage(), observer = await observerContext.newPage(), errors: string[] = [];
  for (const page of [sender, observer]) page.on('pageerror', error => errors.push(error.message));
  try {
    await register(sender, 'Тест отправки'); await register(observer, 'Тест наблюдения');
    for (const page of [sender, observer]) {
      await page.goto('/?room=' + host.roomId + '&lang=ru');
      await expect(page.locator('#chat-input')).toBeEnabled();
    }
    const cdp = await captureRealTransport(sender);
    const greeting = 'Синтетическое приветствие по WebSocket';
    await sender.locator('#chat-input').fill(greeting); await sender.locator('#send-chat').click();
    await expect(sender.locator('#chat-log > [data-message-id]').filter({ hasText: greeting })).toHaveCount(1);
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: greeting })).toHaveCount(1);
    const sent = (await proof(sender)).requests[0];
    expect(sent).toMatchObject({ text: greeting }); expect(sent.id).toMatch(/^[a-f0-9-]{36}$/);
    await expect.poll(async () => (await proof(sender)).results.filter(result => result.id === sent.id).map(result => result.status)).toEqual(['queued', 'published']);
    expect((await proof(sender)).messages.find(message => message.requestId === sent.id)?.text).toBe(greeting);
    await expect(sender.locator(`.chat-outgoing[data-request-id="${sent.id}"]`)).toHaveCount(0);
    await expect(sender.locator('#chat-input')).toHaveValue(''); await expect(sender.locator('#chat-input')).toBeEnabled();
    await sender.evaluate(value => (window as any).__realChat.send(value), sent);
    await expect.poll(async () => (await proof(sender)).results.filter(result => result.id === sent.id && result.status === 'published').length).toBe(2);
    expect((await proof(sender)).messages.filter(message => message.requestId === sent.id)).toHaveLength(1);
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: greeting })).toHaveCount(1);
    const legacy = 'Синтетическое сообщение старого клиента';
    await sender.evaluate(text => (window as any).__realChat.send(text), legacy);
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: legacy })).toHaveCount(1);
    await expect(sender.locator('#chat-log > [data-message-id]').filter({ hasText: legacy })).toHaveCount(1);
    await sender.locator('#chat-input').fill('ты дебил'); await sender.locator('#send-chat').click();
    await expect.poll(async () => (await proof(sender)).results.filter(result => result.status === 'rejected').length).toBe(1);
    const rejected = (await proof(sender)).results.find(result => result.status === 'rejected')!;
    await expect(sender.locator(`.chat-outgoing[data-request-id="${rejected.id}"]`)).toHaveAttribute('data-delivery', 'rejected');
    await expect(observer.locator('.security-message')).toContainText('первое предупреждение');
    expect((await proof(sender)).messages.some(message => message.text === 'ты дебил')).toBe(false);
    await expect(sender.locator('#chat-log > [data-message-id]').filter({ hasText: 'ты дебил' })).toHaveCount(0);
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: 'ты дебил' })).toHaveCount(0);
    await sender.screenshot({ path: 'artifacts/chat-real-rejected.png' });
    expect(errors).toEqual([]);
    console.log('REAL_CHAT_PROOF: UI auth + PostgreSQL + real WebSocket; sender/observer delivery; queued/published requestId; outbox cleared; duplicate UUID once; legacy delivered; insult rejected and warning persisted.');
    await cdp.detach();
  } finally { await senderContext.close(); await observerContext.close(); await host.leave(); }
});
