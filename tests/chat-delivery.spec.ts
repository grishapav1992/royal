import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  CHAT_CONFIRMATION_TIMEOUT_MS, CHAT_V2_FIRST_ADMISSION_MS, ROOM_CHAT_PROTOCOL, ROOM_CHAT_PROTOCOL_V2, type ChatV2Send,
} from '../src/shared/chat';

const visitId = 7;
const roomEpoch = '601c144d-7064-4e29-8ce0-91f0829946f0';
const publicationId = '56708784-314f-4f7a-8d61-a931ac924440';
type Packet = { type: string; value: unknown };
type BrowserFixture = {
  packets: Packet[];
  receive: (type: string, value: unknown) => void;
  drop: () => void;
  reconnect: () => void;
  disconnect: () => void;
  legacy: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  useLocalMovement: () => void;
};
declare global { interface Window { __chatFixture: BrowserFixture; royalDemo: { getNetworkState: () => unknown; isWorldLoaded: () => boolean } } }

test.beforeEach(async ({ baseURL }) => {
  test.skip(baseURL !== 'http://127.0.0.1:4180', 'Run with playwright.chat-delivery.config.ts to keep every connection local.');
});

async function host(page: Page, supportsChatVisits = true, v2?: { accountId: string; ready?: boolean }) {
  const context = page.context(), writes: string[] = [], errors: string[] = [];
  let entrySession = true;
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.origin !== 'http://127.0.0.1:4180') return route.abort('blockedbyclient');
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method() + ' ' + url.pathname); return route.abort('blockedbyclient'); }
    if (url.pathname === '/api/auth/me' && entrySession) {
      entrySession = false;
      return route.fulfill({ json: { account: { id: 'chat-fixture-entry' } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { account: null, games: [] } });
    if (url.pathname.startsWith('/game-modules/')) {
      const root = resolve('module-dist'), path = resolve(root, url.pathname.slice('/game-modules/'.length));
      if (!path.startsWith(root + sep)) return route.abort('blockedbyclient');
      try {
        const body = await readFile(path);
        return route.fulfill({ body, contentType: path.endsWith('.json') ? 'application/json' : path.endsWith('.css') ? 'text/css' : 'text/javascript' });
      } catch { return route.fulfill({ status: 404, body: 'Missing local test module' }); }
    }
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?mode=club&lang=ru');
  await page.waitForFunction(() => typeof window.royalDemo?.getNetworkState === 'function');
  await expect(page.locator('#join-dialog')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  const fn = await cdp.send('Runtime.evaluate', { expression: 'window.royalDemo.getNetworkState' });
  const properties = await cdp.send('Runtime.getProperties', { objectId: fn.result.objectId! });
  const scopesId = properties.internalProperties!.find(property => property.name === '[[Scopes]]')!.value!.objectId!;
  const scopes = await cdp.send('Runtime.getProperties', { objectId: scopesId });
  const socialName = await page.evaluate(() => window.royalDemo.getNetworkState.toString().match(/=>\s*([\w$]+)\?\.client/)?.[1]);
  let socialId: string | undefined;
  for (const scope of scopes.result) {
    if (!scope.value?.objectId || !/^\d+$/.test(scope.name)) continue;
    const values = await cdp.send('Runtime.getProperties', { objectId: scope.value.objectId });
    socialId = values.result.find(value => value.name === socialName)?.value?.objectId;
    if (socialId) break;
  }
  expect(socialId, 'the test changes only the real host transport through the debugger').toBeTruthy();
  const installed = await cdp.send('Runtime.callFunctionOn', { objectId: socialId!, awaitPromise: true, returnByValue: true,
    arguments: [{ value: supportsChatVisits }, { value: ROOM_CHAT_PROTOCOL }, { value: visitId }, { value: v2 ?? null }, { value: roomEpoch }],
    functionDeclaration: `async function(supportsChatVisits, protocol, visitId, v2, roomEpoch) {
      const handlers = new Map(), packets = [];
      let drop, reconnect, leave;
      const room = {
        roomId: 'chat-fixture-room', sessionId: 'chat-fixture-self', reconnection: {},
        send(type, value) {
          packets.push({type,value});
          if (type.startsWith('chat.') && (!v2 || v2.ready === false)) throw new Error('V1 rejected an unregistered packet: ' + type);
          if (type === 'history') {
            if (v2 && v2.ready !== false && value?.offerVersion === 2) {
              handlers.get('chat.ready')?.({ version: 2, serverTimeMs: Date.now() });
              handlers.get('chat.visit')?.({ roomEpoch, visitId, location: 'arcade', initialCursor: 0 });
              return;
            }
            if (supportsChatVisits && value?.version === protocol) handlers.get('chat-visit')?.({ id: visitId, hall: 'arcade' });
            const legacy = { id: 'legacy-history', senderId: 'other', name: 'Игрок', text: 'Общая история', time: Date.now() };
            handlers.get('history')?.(supportsChatVisits ? [] : [legacy]);
          }
        },
        onMessage(type, callback) { handlers.set(type, callback); }, onStateChange() {}, onError() {},
        onDrop(callback) { drop = callback; }, onReconnect(callback) { reconnect = callback; },
        onLeave(callback) { leave = callback; }, leave() { leave(1000); },
      };
      this.client.client = { joinOrCreate: async () => room };
      const switchAccount = async accountId => {
        this.auth.account = { id: accountId, name: 'Тест', skin: 0, email: 'chat@example.test' };
        await this.client.join(undefined, false, accountId);
      };
      if (v2) {
        this.client.chatV2Enabled = true;
        await switchAccount(v2.accountId);
      } else await this.client.join();
      window.__chatFixture = {
        packets, receive: (type, value) => handlers.get(type)?.(value), drop, reconnect,
        disconnect: () => leave(1000), switchAccount,
        useLocalMovement: () => { this.scene.world.network = undefined; },
        legacy: async () => {
          const { LobbyClient } = await import('/src/network/LobbyClient.ts');
          const noop = () => {};
          const client = new LobbyClient({npcTime:noop,guards:noop,guests:noop,mira:noop,security:noop,ejected:noop,status:noop,joined:noop,players:noop,chat:noop,history:noop,notice:noop,activities:noop,note:noop});
          client.client = {joinOrCreate: async () => room}; await client.join();
          handlers.get('chat-result')({id:crypto.randomUUID(),status:'queued'});
          handlers.get('chat-result')({id:crypto.randomUUID(),status:'rejected'});
          client.leave();
        },
      };
      return {account:this.auth.account,status:this.client.status};
    }` });
  expect(installed.exceptionDetails).toBeUndefined();
  expect(installed.result.value).toMatchObject({ account: v2 ? { id: v2.accountId } : null, status: 'connected' });
  await expect(page.locator('#join-dialog')).toBeHidden();
  if (supportsChatVisits) await expect(page.locator('#chat-input')).toBeEnabled();
  else await expect(page.locator('#chat-input')).toBeDisabled();
  return { writes, errors };
}

async function send(page: Page, text: string) {
  await page.locator('#chat-input').fill(text); await page.locator('#send-chat').click();
  return page.evaluate(() => window.__chatFixture.packets.filter(packet => packet.type === 'chat').at(-1)!.value as { id: string; text: string; visitId: number });
}
const receive = (page: Page, type: string, value: unknown) => page.evaluate(({ type, value }) => window.__chatFixture.receive(type, value), { type, value });
const chatPackets = (page: Page) => page.evaluate(() => window.__chatFixture.packets.filter(packet => packet.type === 'chat') as Array<{ type: 'chat'; value: { id: string; text: string; visitId: number } }>);
const historyRequests = (page: Page) => page.evaluate(() => window.__chatFixture.packets.filter(packet => packet.type === 'history').map(packet => packet.value));
const v2Packets = (page: Page, type: string) => page.evaluate(type => window.__chatFixture.packets.filter(packet => packet.type === type).map(packet => packet.value), type);

async function sendV2(page: Page, text: string) {
  const before = (await v2Packets(page, 'chat.send')).length;
  await page.locator('#chat-input').fill(text); await page.locator('#send-chat').click();
  await expect.poll(async () => (await v2Packets(page, 'chat.send')).length).toBe(before + 1);
  return (await v2Packets(page, 'chat.send')).at(-1)! as ChatV2Send;
}

test('V2 saves a masked outgoing message, retries its original envelope and recovers a lost receipt after reload', async ({ page }) => {
  const accountId = 'v2-reload';
  await page.clock.install();
  const proof = await host(page, true, { accountId });
  const first = await sendV2(page, 'Fuck, проверка восстановления');
  expect(first.messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(first).toMatchObject({ text: 'Fuck, проверка восстановления', roomEpoch, visitId });
  const outgoing = page.locator(`[data-request-id="${first.messageId}"]`);
  await expect(outgoing).toContainText('F**k, проверка восстановления');
  await expect(outgoing.locator('.chat-outgoing-status')).toHaveCount(0);
  await expect(page.locator('#chat-delivery-status')).toBeHidden();
  await expect(page.locator('#chat-input')).toHaveValue('');
  expect(await historyRequests(page)).toEqual([{ version: ROOM_CHAT_PROTOCOL, offerVersion: ROOM_CHAT_PROTOCOL_V2 }]);
  expect(await v2Packets(page, 'chat.ready')).toHaveLength(0);
  expect(await chatPackets(page)).toHaveLength(0);

  await page.clock.fastForward(CHAT_CONFIRMATION_TIMEOUT_MS + 100);
  await expect(outgoing).toHaveAttribute('data-delivery', 'uncertain');
  expect((await v2Packets(page, 'chat.resume'))[0]).toEqual({ messageIds: [first.messageId] });
  await receive(page, 'chat.resume', { results: [{ messageId: first.messageId, status: 'not_found' }] });
  await page.clock.fastForward(3000);
  await expect.poll(() => v2Packets(page, 'chat.send')).toEqual([first, first]);
  await receive(page, 'chat.result', { messageId: first.messageId, status: 'accepted' });

  const priorResumes = (await v2Packets(page, 'chat.resume')).length;
  await page.evaluate(() => { window.__chatFixture.drop(); window.__chatFixture.reconnect(); });
  await expect.poll(async () => (await v2Packets(page, 'chat.resume'))[priorResumes]).toEqual({ messageIds: [first.messageId] });
  expect(await v2Packets(page, 'chat.send')).toEqual([first, first]);

  await host(page, true, { accountId });
  await expect.poll(async () => (await v2Packets(page, 'chat.resume'))[0]).toEqual({ messageIds: [first.messageId] });
  expect(await v2Packets(page, 'chat.send')).toHaveLength(0);
  await receive(page, 'chat.resume', { results: [{ messageId: first.messageId, status: 'published', publicationId }] });
  await expect(outgoing).toHaveCount(0);
  await expect(page.locator('#chat-delivery-status')).toBeHidden();
  await host(page, true, { accountId });
  await expect(page.locator('#send-chat')).toBeDisabled();
  expect(await v2Packets(page, 'chat.resume')).toHaveLength(0);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('V2 respects retry delay and keeps a moved draft private when accounts switch', async ({ page }) => {
  const accountId = 'v2-owner', other = 'v2-other';
  await page.clock.install();
  const proof = await host(page, true, { accountId });
  const first = await sendV2(page, 'Сохранить только у владельца');
  await receive(page, 'chat.result', { messageId: first.messageId, status: 'retry_later', reasonCode: 'commit_unknown', retryAfterMs: 5000 });
  await page.clock.fastForward(4000);
  expect(await v2Packets(page, 'chat.resume')).toHaveLength(0);
  await page.clock.fastForward(2000);
  await expect.poll(() => v2Packets(page, 'chat.resume')).toEqual([{ messageIds: [first.messageId] }]);
  await receive(page, 'chat.visit', { roomEpoch, visitId: visitId + 1, location: 'tables', initialCursor: 0 });
  await receive(page, 'chat.resume', { results: [{ messageId: first.messageId, status: 'not_found' }] });
  await page.clock.fastForward(4000);
  expect(await v2Packets(page, 'chat.send')).toEqual([first]);
  const outgoing = page.locator(`[data-request-id="${first.messageId}"]`);
  await expect(outgoing).toContainText('Черновик из другой локации');
  await expect(outgoing).not.toContainText(first.text);
  await outgoing.locator('[data-chat-restore]').click();
  await expect(page.locator('#chat-input')).toHaveValue(first.text);
  const priorResumes = (await v2Packets(page, 'chat.resume')).length;
  await page.evaluate(id => window.__chatFixture.switchAccount(id), other);
  await expect(outgoing).toHaveCount(0);
  await expect(page.locator('#chat-input')).toHaveValue('');
  await page.clock.fastForward(20000);
  expect((await v2Packets(page, 'chat.resume')).length).toBe(priorResumes);
  await receive(page, 'chat.result', { messageId: first.messageId, status: 'rejected', reasonCode: 'spam' });
  await expect(outgoing).toHaveCount(0);
  await page.evaluate(id => window.__chatFixture.switchAccount(id), accountId);
  await expect.poll(async () => (await v2Packets(page, 'chat.resume')).at(-1)).toEqual({ messageIds: [first.messageId] });
  expect(await v2Packets(page, 'chat.send')).toEqual([first]);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('V2 keeps the composer text and sticker picker open when storage fails', async ({ page }) => {
  const proof = await host(page, true, { accountId: 'v2-storage-failure' });
  const restoreStorage = await page.evaluateHandle(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === 'royal-chat-outbox' && args[1] === 'readwrite') throw new DOMException('Fixture storage failure', 'QuotaExceededError');
      return transaction.apply(this, args);
    };
    return () => { IDBDatabase.prototype.transaction = transaction; };
  });
  await page.locator('#chat-input').fill('Текст остаётся в поле'); await page.locator('#send-chat').click();
  await expect(page.getByText('Сообщение не отправлено. Текст сохранён.', { exact: true })).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveValue('Текст остаётся в поле');
  expect(await v2Packets(page, 'chat.send')).toHaveLength(0);
  await page.locator('#chat-media-toggle').click(); await page.locator('[data-chat-pack="duck"]').click();
  const sticker = page.locator('[data-chat-sticker]').first();
  await sticker.click();
  await expect(page.getByText('Сообщение не отправлено.', { exact: true })).toBeVisible();
  await expect(sticker).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveValue('Текст остаётся в поле');
  expect(await v2Packets(page, 'chat.send')).toHaveLength(0);
  await restoreStorage.evaluate(restore => restore());
  await sticker.click();
  await expect(page.locator('#chat-media-panel')).toBeHidden();
  await expect(page.locator('[data-request-id] [data-sticker-id]')).toHaveCount(1);
  expect(await v2Packets(page, 'chat.send')).toHaveLength(1);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('V2 keeps private delivery status on the street without exposing the draft or chat', async ({ page }) => {
  const proof = await host(page, true, { accountId: 'v2-street' });
  const first = await sendV2(page, 'Сохранить этот черновик в тайне');
  await receive(page, 'chat.visit', null);
  await expect(page.locator('.chat-dock')).toBeHidden();
  await expect(page.locator('#chat-input')).toBeDisabled();
  const panel = page.locator('#chat-private-outbox'), row = panel.locator(`[data-request-id="${first.messageId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-delivery', 'uncertain');
  await expect(row).not.toContainText(first.text);
  await expect(row.locator('[data-chat-restore], [data-chat-retry]')).toHaveCount(0);
  await receive(page, 'chat.result', { messageId: first.messageId, status: 'rejected', reasonCode: 'spam' });
  await expect(row).toContainText('Сообщение отклонено за спам.');
  await row.locator('[data-chat-dismiss]').click();
  await expect(panel).toBeHidden();
  expect(await v2Packets(page, 'chat.send')).toEqual([first]);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('V2 automatically reloads saved deliveries after a transient storage read failure', async ({ page }) => {
  const accountId = 'v2-storage-recovery';
  await page.clock.install();
  const proof = await host(page, true, { accountId });
  const first = await sendV2(page, 'Восстановить сохранённую отправку');
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    let failNextRead = true;
    IDBDatabase.prototype.transaction = function (...args) {
      if (failNextRead && this.name === 'royal-chat-outbox' && args[1] === 'readonly') {
        failNextRead = false;
        document.documentElement.setAttribute('data-fixture-storage-read-failed', '');
        throw new DOMException('Fixture transient read failure', 'UnknownError');
      }
      return transaction.apply(this, args);
    };
  });
  const reloaded = await host(page, true, { accountId });
  await expect(page.locator('html')).toHaveAttribute('data-fixture-storage-read-failed', '');
  await page.clock.fastForward(2_000);
  await expect(page.locator(`[data-request-id="${first.messageId}"]`)).toBeVisible();
  await page.clock.fastForward(100);
  await expect.poll(async () => (await v2Packets(page, 'chat.resume'))[0]).toEqual({ messageIds: [first.messageId] });
  expect(await v2Packets(page, 'chat.send')).toHaveLength(0);
  expect(proof).toEqual({ writes: [], errors: [] });
  expect(reloaded).toEqual({ writes: [], errors: [] });
});

test('V2 checks durable status but does not retransmit when retry backoff crosses the UUID deadline', async ({ page }) => {
  await page.clock.install();
  const proof = await host(page, true, { accountId: 'v2-expired' });
  const first = await sendV2(page, 'Черновик с истёкшим сроком');
  await page.clock.fastForward(CHAT_V2_FIRST_ADMISSION_MS - 700);
  await expect.poll(() => v2Packets(page, 'chat.resume')).toHaveLength(1);
  await receive(page, 'chat.resume', { results: [{ messageId: first.messageId, status: 'not_found' }] });
  await page.clock.fastForward(2000);
  await expect.poll(() => v2Packets(page, 'chat.resume')).toHaveLength(2);
  expect(await v2Packets(page, 'chat.send')).toEqual([first]);
  await receive(page, 'chat.resume', { results: [{ messageId: first.messageId, status: 'expired', reasonCode: 'message_id_expired' }] });
  const row = page.locator(`[data-request-id="${first.messageId}"]`);
  await expect(row).toHaveAttribute('data-delivery', 'uncertain');
  await expect(row).not.toContainText('Не опубликовано');
  await page.clock.fastForward(30000);
  expect(await v2Packets(page, 'chat.resume')).toHaveLength(2);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('an unacknowledged V2 offer falls back to V1 and ignores a late V2 response', async ({ page }) => {
  const proof = await host(page, true, { accountId: 'v2-v1-fallback', ready: false });
  expect(await v2Packets(page, 'chat.ready')).toHaveLength(0);
  expect(await historyRequests(page)).toEqual([{ version: ROOM_CHAT_PROTOCOL, offerVersion: ROOM_CHAT_PROTOCOL_V2 }]);
  await receive(page, 'chat.ready', { version: ROOM_CHAT_PROTOCOL_V2, serverTimeMs: Date.now() });
  await receive(page, 'chat.visit', { roomEpoch, visitId: visitId + 1, location: 'tables', initialCursor: 0 });
  expect(await send(page, 'Сообщение через V1')).toMatchObject({ visitId });
  expect(await v2Packets(page, 'chat.send')).toHaveLength(0);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('a masked message appears immediately without a checking indicator and is replaced on delivery', async ({ page }) => {
  const proof = await host(page);
  const first = await send(page, 'Fuck, первое сообщение');
  expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.text).toBe('Fuck, первое сообщение');
  expect(first.visitId).toBe(visitId);
  expect(await historyRequests(page)).toEqual([{ version: ROOM_CHAT_PROTOCOL }]);
  const pending = page.locator(`[data-request-id="${first.id}"]`);
  await expect(pending).toContainText('F**k, первое сообщение');
  await expect(pending.locator('.chat-meta')).toBeVisible();
  await receive(page, 'chat-check', true); await receive(page, 'chat-result', { id: first.id, status: 'queued' });
  await expect(pending).toHaveAttribute('data-delivery', 'queued');
  await expect(pending.locator('.chat-outgoing-status')).toHaveCount(0);
  await expect(page.locator('#chat-delivery-status')).toBeHidden();
  await expect(page.locator('#chat-input')).toHaveValue(''); await expect(page.locator('#chat-input')).toBeEnabled();
  await page.locator('#chat-input').fill('Следующий черновик');
  const masked = 'F**k, первое сообщение';
  await receive(page, 'chat', { id: 'published-first', requestId: first.id, senderId: 'chat-fixture-self', name: 'Тест', text: masked, time: Date.now(), visitId });
  await receive(page, 'chat-result', { id: first.id, status: 'published' });
  await expect(page.locator('[data-request-id]')).toHaveCount(0);
  await expect(page.locator('[data-message-id="published-first"]')).toContainText(masked);
  await receive(page, 'chat', { id: 'other-visit', senderId: 'other', name: 'Игрок', text: 'Чужой этаж', time: Date.now(), visitId: visitId + 1 });
  await expect(page.locator('[data-message-id="other-visit"]')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toHaveValue('Следующий черновик');
  await send(page, 'Второе сообщение'); await send(page, 'Третье сообщение'); await send(page, 'Четвёртое сообщение');
  await page.locator('#chat-input').fill('Пятый черновик');
  await expect(page.locator('[data-request-id]')).toHaveCount(3);
  await expect(page.locator('#chat-input')).toBeEnabled(); await expect(page.locator('#send-chat')).toBeDisabled();
  expect((await chatPackets(page)).length).toBe(4);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('an explicit rejection preserves both texts and only a manual retry creates a new request', async ({ page }) => {
  const proof = await host(page), first = await send(page, 'Сохранённое сообщение');
  await page.locator('#chat-input').fill('Мой следующий черновик');
  await receive(page, 'chat-result', { id: first.id, status: 'rejected', message: 'Не удалось проверить. Попробуй ещё раз.' });
  const saved = page.locator(`[data-request-id="${first.id}"]`);
  await expect(saved).toHaveAttribute('data-delivery', 'rejected'); await expect(saved).toContainText(first.text);
  await saved.locator('[data-chat-restore]').click();
  await expect(page.locator('#chat-input')).toHaveValue('Мой следующий черновик');
  expect((await chatPackets(page)).length).toBe(1);
  await page.locator('#chat-input').fill(''); await saved.locator('[data-chat-restore]').click();
  await expect(page.locator('#chat-input')).toHaveValue(first.text);
  await page.locator('#chat-input').fill('Мой следующий черновик'); await saved.locator('[data-chat-retry]').click();
  const packets = await chatPackets(page);
  expect(packets).toHaveLength(2); expect(packets[1].value.id).not.toBe(first.id); expect(packets[1].value.text).toBe(first.text);
  await expect(page.locator('#chat-input')).toHaveValue('Мой следующий черновик');
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('drop preserves unconfirmed text and reconciles history without resending', async ({ page }) => {
  const proof = await host(page), first = await send(page, 'Сообщение перед обрывом');
  await receive(page, 'chat-result', { id: first.id, status: 'queued' }); await page.locator('#chat-input').fill('Черновик после отправки');
  await page.evaluate(() => window.__chatFixture.drop());
  const saved = page.locator(`[data-request-id="${first.id}"]`);
  await expect(saved).toHaveAttribute('data-delivery', 'uncertain'); await expect(saved.locator('[data-chat-retry]')).toHaveCount(0);
  await page.evaluate(() => window.__chatFixture.reconnect());
  await expect(page.locator('#chat-input')).toBeEnabled(); await expect(page.locator('#chat-input')).toHaveValue('Черновик после отправки');
  expect((await chatPackets(page)).length).toBe(1);
  expect(await historyRequests(page)).toEqual([{ version: ROOM_CHAT_PROTOCOL }, { version: ROOM_CHAT_PROTOCOL }]);
  await receive(page, 'history', [{ id: 'after-reconnect', requestId: first.id, senderId: 'chat-fixture-self', name: 'Тест', text: first.text, time: Date.now(), visitId }]);
  await expect(saved).toHaveCount(0); await expect(page.locator('[data-message-id="after-reconnect"]')).toContainText(first.text);
  await expect(page.locator('#chat-delivery-status')).toBeHidden(); expect((await chatPackets(page)).length).toBe(1);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('the confirmation deadline retains uncertain text without fabricating delivery or enabling retry', async ({ page }) => {
  const proof = await host(page); await page.clock.install();
  const first = await send(page, 'Нет ответа на отправку'); await receive(page, 'chat-result', { id: first.id, status: 'queued' });
  await page.clock.fastForward(CHAT_CONFIRMATION_TIMEOUT_MS + 100);
  const saved = page.locator(`[data-request-id="${first.id}"]`);
  await expect(saved).toHaveAttribute('data-delivery', 'uncertain'); await expect(saved).toContainText('Ответ задерживается');
  await expect(saved.locator('[data-chat-retry]')).toHaveCount(0); await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toBeEnabled(); expect((await chatPackets(page)).length).toBe(1);
  await saved.locator('[data-chat-restore]').click(); await page.locator('#send-chat').click();
  expect((await chatPackets(page)).length).toBe(1);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('sanctions and a missing connection cannot discard a draft or send another message', async ({ page }) => {
  const proof = await host(page); await page.locator('#chat-input').fill('Нельзя потерять');
  await page.evaluate(() => window.__chatFixture.drop());
  await page.locator('#chat-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(page.locator('#chat-input')).toHaveValue('Нельзя потерять'); expect(await chatPackets(page)).toHaveLength(0);
  await page.evaluate(() => window.__chatFixture.reconnect());
  await receive(page, 'security', { kind: 'warning', until: Date.now() + 5000, message: 'Охрана обращается к тебе.' });
  await expect(page.locator('#chat-input')).toBeDisabled();
  await page.locator('#chat-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(page.locator('#chat-input')).toHaveValue('Нельзя потерять'); expect(await chatPackets(page)).toHaveLength(0);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('old transport fixtures may omit the delivery callback', async ({ page }) => {
  const proof = await host(page); await page.evaluate(() => window.__chatFixture.legacy());
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('a legacy backend cannot unlock chat or show its unscoped history and live messages', async ({ page }) => {
  const proof = await host(page, false);
  const message = { id: 'legacy-live', senderId: 'other', name: 'Игрок', text: 'Сообщение всей комнаты', time: Date.now() };
  await receive(page, 'chat', message);
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toBeDisabled();
  await page.evaluate(() => { window.__chatFixture.drop(); window.__chatFixture.reconnect(); });
  await receive(page, 'history', [{ ...message, visitId }]);
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(page.locator('#chat-input')).toBeDisabled();
  expect(await historyRequests(page)).toEqual([{ version: ROOM_CHAT_PROTOCOL }, { version: ROOM_CHAT_PROTOCOL }]);
  expect(await chatPackets(page)).toHaveLength(0);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('published acknowledgement remains authoritative until history arrives and cancellation permits manual recovery', async ({ page }) => {
  const proof = await host(page); await page.clock.install();
  const first = await send(page, 'Публикация подтверждена');
  await receive(page, 'chat-result', { id: first.id, status: 'published' });
  expect(await historyRequests(page)).toEqual([{ version: ROOM_CHAT_PROTOCOL }, { version: ROOM_CHAT_PROTOCOL }]);
  await expect(page.locator(`[data-request-id="${first.id}"]`)).toHaveAttribute('data-delivery', 'published');
  await page.clock.fastForward(CHAT_CONFIRMATION_TIMEOUT_MS + 100);
  await expect(page.locator(`[data-request-id="${first.id}"]`)).toHaveAttribute('data-delivery', 'published');
  await receive(page, 'history', [{ id: 'published-history', requestId: first.id, senderId: 'chat-fixture-self', name: 'Тест', text: first.text, time: Date.now(), visitId }]);
  await expect(page.locator('[data-request-id]')).toHaveCount(0);
  const second = await send(page, 'Сохранить после отмены');
  await receive(page, 'chat-result', { id: second.id, status: 'cancelled', message: 'Отправка сообщения отменена.' });
  await expect(page.locator(`[data-request-id="${second.id}"]`)).toHaveAttribute('data-delivery', 'cancelled');
  await expect(page.locator(`[data-chat-retry="${second.id}"]`)).toBeEnabled();
  expect((await chatPackets(page)).length).toBe(2);
  expect(proof).toEqual({ writes: [], errors: [] });
});

test('a sticker uses the same tracked protocol and keeps a typed draft', async ({ page }) => {
  const proof = await host(page); await page.locator('#chat-input').fill('Текст после стикера');
  await page.locator('#chat-media-toggle').click(); await page.locator('[data-chat-pack="duck"]').click();
  await page.locator('[data-chat-sticker]').first().click();
  const packets = await chatPackets(page);
  expect(packets).toHaveLength(1); expect(packets[0].value.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('[data-request-id] [data-sticker-id]')).toHaveCount(1);
  await expect(page.locator('#chat-input')).toHaveValue('Текст после стикера');
  expect(proof).toEqual({ writes: [], errors: [] });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) test(`real host game chat keeps pending text and composition in bounds at ${viewport.width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport); const proof = await host(page);
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 20000 });
  await page.waitForFunction(() => window.royalDemo.isWorldLoaded());
  await page.evaluate(() => window.__chatFixture.useLocalMovement());
  // Open through the real catalog, walking, seating and host game window.
  await page.locator('#games-tab').click();
  const cabinet = page.locator('[data-cabinet="original-jackie-chan"]');
  await cabinet.scrollIntoViewIfNeeded(); await cabinet.click();
  const dialog = page.locator('#mini-dialog');
  await dialog.locator('[data-platform-game="royal-roulette"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'royal-roulette', { timeout: 20000 });
  const dock = dialog.locator('#club-chat-dock');
  if (viewport.width === 390) await dialog.locator('.game-chat-toggle').click();
  await expect(dock).toBeVisible();
  const first = await send(page, 'Сообщение в игровом окне'); await receive(page, 'chat-result', { id: first.id, status: 'queued' });
  await page.locator('#chat-input').fill('Следующее сообщение');
  await expect(page.locator('#chat-input')).toBeInViewport(); await expect(page.locator('#send-chat')).toBeInViewport();
  await expect(page.locator('[data-request-id]')).toBeInViewport();
  const bounds = await page.locator('#chat-panel').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  if (viewport.width === 390) {
    await page.evaluate(() => document.documentElement.style.setProperty('--app-height', '500px'));
    await expect(page.locator('#chat-input')).toBeInViewport();
    const bottom = await page.locator('#chat-input').evaluate(element => element.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(500);
  }
  await page.screenshot({ path: testInfo.outputPath(`chat-delivery-${viewport.width}.png`) });
  expect(proof).toEqual({ writes: [], errors: [] });
});
