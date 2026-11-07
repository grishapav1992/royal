import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import type { ChatRequest, ChatResult } from '../src/shared/chat';
import type { ChatMessage } from '../src/shared/world';
import type { SecurityDecision } from '../src/shared/security';

type Proof = { requests: ChatRequest[]; results: ChatResult[]; messages: ChatMessage[]; captures: SecurityDecision[]; ejections: unknown[] };
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
      const requests = [], results = [], messages = [], captures = [], ejections = [];
      room.send = (type, value) => { if (type === 'chat') requests.push(value); return send(type, value); };
      room.onMessage('chat-result', result => results.push(result));
      room.onMessage('chat', message => messages.push(message));
      room.onMessage('club-capture', value => captures.push(value));
      room.onMessage('club-ejected', value => ejections.push(value));
      window.__realChat = {
        requests, results, messages, captures, ejections, send: value => room.send('chat', value),
        self: () => {
          const player = room.state.players.get(room.sessionId);
          return { hall: player.hall, x: player.x, security: player.security, connected: player.connected };
        }
      };
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

test('real chat masks profanity and delivers insults below the threshold regardless of address', async ({ browser, request }) => {
  const host = await createHost(request);
  const senderContext = await browser.newContext(), observerContext = await browser.newContext();
  const sender = await senderContext.newPage(), observer = await observerContext.newPage(), errors: string[] = [];
  for (const page of [sender, observer]) page.on('pageerror', error => errors.push(error.message));
  try {
    await register(sender, 'Тест отправки'); await register(observer, 'Тест наблюдения');
    for (const page of [sender, observer]) {
      await page.goto('/?mode=club&room=' + host.roomId + '&lang=en');
      await expect(page.locator('#club-chat-dock')).toHaveAttribute('data-chat-hall', 'arcade', { timeout: 30000 });
      await expect(page.locator('#chat-input')).toBeEnabled();
    }
    const cdp = await captureRealTransport(sender);
    const greeting = 'Синтетическое приветствие по WebSocket';
    await sender.locator('#chat-input').fill(greeting); await sender.locator('#send-chat').click();
    await expect(sender.locator('#chat-log > [data-message-id]').filter({ hasText: greeting })).toHaveCount(1);
    await observer.bringToFront();
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: greeting })).toHaveCount(1, { timeout: 15000 });
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
    await sender.locator('#chat-input').fill('You are an idiot'); await sender.locator('#send-chat').click();
    await expect(observer.locator('#chat-log > [data-message-id]').filter({ hasText: 'You are an idiot' })).toHaveCount(1);
    await expect(observer.locator('.security-message')).toHaveCount(0);

    expect(errors).toEqual([]);
    console.log('REAL_CHAT_PROOF: English UI + PostgreSQL + real WebSocket, masked delivery and a shared threshold for insults.');
    await cdp.detach();
  } finally { await senderContext.close(); await observerContext.close(); await host.leave(); }
});

test('the tenth offensive word triggers a capture and street escort in the same session', async ({ page, request }) => {
  const host = await createHost(request);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await register(page, 'Проверка порога');
    await page.goto('/?mode=club&room=' + host.roomId + '&lang=en');
    const input = page.locator('#chat-input'), send = page.locator('#send-chat');
    await expect(input).toBeEnabled();
    const transport = await captureRealTransport(page);
    await input.fill('fuck shit Scheiße putain coño cazzo kurwa caralho klootzak'); await send.click();
    const masked = 'f**k s**t S*****e p****n c**o c***o k***a c*****o k******k';
    await expect(page.locator('#chat-log > [data-message-id]').filter({ hasText: masked })).toHaveCount(1);
    await expect(page.locator('.security-message')).toHaveCount(0);
    const confirmedAfter = Date.now();
    await input.fill('Ты идиот'); await send.click();
    await expect(page.locator('.security-message')).toContainText('too much offensive language in chat');
    await expect.poll(async () => (await proof(page)).ejections.length, { timeout: 30000 }).toBe(1);
    const { captures } = await proof(page);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ kind: 'ejecting', reason: 'profanity' });
    expect(captures[0].until).toBeGreaterThanOrEqual(confirmedAfter + 20 * 60_000);
    expect(captures[0].until).toBeLessThanOrEqual(Date.now() + 20 * 60_000);
    await expect.poll(() => page.evaluate(() => (window as any).__realChat.self()))
      .toMatchObject({ hall: 'street', security: '', connected: true });
    await expect(page.locator('#security-dialog')).toBeHidden();
    await expect(page.locator('#club-chat-dock')).toBeHidden();
    expect(errors).toEqual([]);
    await transport.detach();
  } finally { await host.leave(); }
});

test('the first confirmed spam episode immediately dispatches the guard', async ({ page, request }) => {
  const host = await createHost(request);
  try {
    await register(page, 'Проверка спама');
    await page.goto('/?mode=club&room=' + host.roomId + '&lang=en');
    const input = page.locator('#chat-input'), send = page.locator('#send-chat');
    const text = 'Check the announcements t.me/ExampleChannel';
    const rows = page.locator('#chat-log > [data-message-id]').filter({ hasText: text });
    await expect(input).toBeEnabled();
    const transport = await captureRealTransport(page);
    for (let count = 1; count <= 2; count++) {
      await input.fill(text); await send.click();
      await expect(rows).toHaveCount(count);
    }
    await input.fill(text); await send.click();
    await expect(page.locator('.security-message')).toContainText('spam in chat. Security is on its way.');
    await expect(rows).toHaveCount(2);
    await expect.poll(async () => (await proof(page)).ejections.length, { timeout: 30000 }).toBe(1);
    expect((await proof(page)).captures).toMatchObject([{ kind: 'ejecting', reason: 'spam' }]);
    await transport.detach();
  } finally { await host.leave(); }
});

test('real chat follows each floor visit and closes on the street', async ({ browser, request }) => {
  const host = await createHost(request);
  const senderContext = await browser.newContext(), observerContext = await browser.newContext();
  const sender = await senderContext.newPage(), observer = await observerContext.newPage();
  const dock = sender.locator('#club-chat-dock');
  const rows = (page: Page, text: string) => page.locator('#chat-log > [data-message-id]').filter({ hasText: text });
  const send = async (page: Page, text: string) => {
    await page.locator('#chat-input').fill(text);
    await page.locator('#send-chat').click();
    await expect(rows(page, text)).toHaveCount(1);
  };
  const travel = async (hall: 'arcade' | 'tables') => {
    await sender.bringToFront();
    await sender.locator('#elevator-shortcut').click();
    await expect(sender.locator('#elevator-dialog')).toHaveAttribute('data-phase', 'choose', { timeout: 20000 });
    await sender.locator(`[data-elevator-floor="${hall}"]`).click();
    await expect(sender.locator('#elevator-dialog')).toBeHidden({ timeout: 20000 });
    await expect(dock).toHaveAttribute('data-chat-hall', hall);
  };
  try {
    await register(sender, 'Гость на этажах'); await register(observer, 'Гость первого этажа');
    for (const page of [sender, observer]) {
      await page.goto('/?mode=club&room=' + host.roomId + '&lang=en');
      await expect(page.locator('#club-chat-dock')).toHaveAttribute('data-chat-hall', 'arcade');
      await expect(page.locator('#chat-input')).toBeEnabled();
    }
    const senderTransport = await captureRealTransport(sender), observerTransport = await captureRealTransport(observer);
    const old = 'Before leaving the arcade';
    await send(observer, old);
    await expect(rows(sender, old)).toHaveCount(1);
    const draft = 'A rejected draft from the arcade ' + 'x'.repeat(300);
    await sender.locator('#chat-input').evaluate((input: HTMLInputElement, text) => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    }, draft);
    const rejected = sender.locator('.chat-outgoing[data-delivery="rejected"]');
    await expect(rejected).toContainText(draft);

    await travel('tables');
    await expect(rows(sender, old)).toHaveCount(0);
    await expect(rejected).toContainText('Draft from another location');
    await expect(rejected).not.toContainText(draft);
    await expect(rejected.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await rejected.getByRole('button', { name: 'Restore to input' }).click();
    await expect(sender.locator('#chat-input')).toHaveValue(draft);
    await rejected.getByRole('button', { name: 'Dismiss' }).click();
    const downstairs = 'Still downstairs while you are away';
    const upstairs = 'A message from the second floor';
    await send(observer, downstairs);
    await send(sender, upstairs);
    expect((await proof(sender)).messages.some(message => message.text === downstairs)).toBe(false);
    expect((await proof(observer)).messages.some(message => message.text === upstairs)).toBe(false);

    await travel('arcade');
    await expect(rows(sender, old)).toHaveCount(0);
    await expect(rows(sender, upstairs)).toHaveCount(0);
    await expect(rows(sender, downstairs)).toHaveCount(0);
    const fresh = 'After arriving back downstairs';
    await send(observer, fresh);
    await expect(rows(sender, fresh)).toHaveCount(1);

    await sender.bringToFront();
    await sender.locator('[data-floor-target="street"]').click();
    await expect(dock).toBeHidden({ timeout: 20000 });
    await expect(sender.locator('#chat-input')).toBeDisabled();
    await senderTransport.detach(); await observerTransport.detach();
  } finally { await senderContext.close(); await observerContext.close(); await host.leave(); }
});
