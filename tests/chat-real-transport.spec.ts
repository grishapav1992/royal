import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import type { ChatRequest, ChatResult } from '../src/shared/chat';
import type { ChatMessage } from '../src/shared/world';

type Proof = { requests: ChatRequest[]; results: ChatResult[]; messages: ChatMessage[] };
const proof = (page: Page) => page.evaluate(() => (window as any).__realChat as Proof);
const api = 'http://127.0.0.1:2584';

async function register(page: Page, name: string) {
  const login = await page.request.post(api + '/api/auth/login', { data: { email: `transport-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(login.ok()).toBe(true);
  expect((await page.request.post(api + '/api/auth/character', { data: { skin: 0, name } })).ok()).toBe(true);
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

async function createHost(request: APIRequestContext) {
  const hostLogin = await request.post(api + '/api/auth/login', { data: { email: `transport-host-${crypto.randomUUID()}@example.test`, password: 'Royal-test-123!' } });
  expect(hostLogin.ok()).toBe(true);
  const cookie = hostLogin.headers()['set-cookie'].split(';')[0];
  expect((await request.post(api + '/api/auth/character', { data: { skin: 0 } })).ok()).toBe(true);
  const host = await new Client(api, { headers: { Cookie: cookie } }).create('lobby');
  host.onMessage('*', () => {});
  return host;
}

test('real chat masks profanity and ejects an account after a second directed insult', async ({ browser, request }) => {
  const host = await createHost(request);
  const senderContext = await browser.newContext(), observerContext = await browser.newContext();
  const sender = await senderContext.newPage(), observer = await observerContext.newPage(), errors: string[] = [];
  for (const page of [sender, observer]) page.on('pageerror', error => errors.push(error.message));
  try {
    await register(sender, 'Тест отправки'); await register(observer, 'Тест наблюдения');
    for (const page of [sender, observer]) {
      await page.goto('/?mode=club&room=' + host.roomId + '&lang=en');
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
    const legacy = 'F**k, сообщение старого клиента';
    await sender.evaluate(text => (window as any).__realChat.send(text), 'Fuck, сообщение старого клиента');
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: legacy })).toHaveCount(1);
    await expect(sender.locator('#chat-log > [data-message-id]').filter({ hasText: legacy })).toHaveCount(1);
    await sender.locator('#chat-input').fill('I am an idiot'); await sender.locator('#send-chat').click();
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: 'I am an idiot' })).toHaveCount(1);
    await expect(observer.locator('.security-message')).toHaveCount(0);
    await sender.locator('#chat-input').fill('You are an idiot'); await sender.locator('#send-chat').click();
    await expect(sender.locator('.chat-outgoing[data-delivery="rejected"]')).toContainText('rejected for insulting other players');
    await expect(observer.locator('.security-message')).toContainText('first warning for insults');
    expect((await proof(sender)).messages.some(message => message.text === 'You are an idiot')).toBe(false);
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: 'You are an idiot' })).toHaveCount(0);
    await expect(sender.locator('#chat-input')).toBeEnabled({ timeout: 20000 });
    await sender.locator('#chat-input').fill('Du bist ein Idiot'); await sender.locator('#send-chat').click();
    await expect(observer.locator('.security-message').last()).toContainText('Entry blocked for 10 minutes');
    await expect(sender.locator('#security-dialog')).toBeVisible({ timeout: 20000 });
    await expect(sender.locator('#security-return')).toBeDisabled();

    expect(errors).toEqual([]);
    console.log('REAL_CHAT_PROOF: English UI + PostgreSQL + real WebSocket, masked delivery, warning and ejection after insults in two languages.');
    await cdp.detach();
  } finally { await senderContext.close(); await observerContext.close(); await host.leave(); }
});

test('the tenth profane word ejects an account without a warning in the real chat', async ({ page, request }) => {
  const host = await createHost(request);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await register(page, 'Проверка порога');
    await page.goto('/?mode=club&room=' + host.roomId + '&lang=en');
    const input = page.locator('#chat-input'), send = page.locator('#send-chat');
    await expect(input).toBeEnabled();
    await input.fill('fuck shit Scheiße putain coño cazzo kurwa caralho klootzak'); await send.click();
    const masked = 'f**k s**t S*****e p****n c**o c***o k***a c*****o k******k';
    await expect(page.locator('#chat-log > [data-message-id]').filter({ hasText: masked })).toHaveCount(1);
    await expect(page.locator('.security-message')).toHaveCount(0);
    await input.fill('блять'); await send.click();
    await expect(page.locator('.security-message')).toContainText('too much profanity in chat');
    await expect(page.locator('#security-dialog')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#security-dialog')).toContainText('Entry blocked for excessive profanity in chat.');
    await expect(page.locator('#security-return')).toBeDisabled();
    expect(errors).toEqual([]);
  } finally { await host.leave(); }
});
