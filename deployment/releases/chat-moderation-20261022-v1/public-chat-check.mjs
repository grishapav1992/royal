import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const origin = new URL(args.get('--origin') || 'https://stealth-spark-gokmxooi.expresshost.cloud').origin;
const expectedEntry = args.get('--expected-entry') || 'index-C3VY0wdW.js';
const expectedStyles = args.get('--expected-styles') || 'index-CiQek4Jj.css';
const output = resolve(args.get('--output') || 'artifacts/chat-moderation-20261022/proof/public-browser.json');
const gameSmoke = args.get('--game-smoke') !== '0';
const proof = {
  at: new Date().toISOString(), origin, source: '6bc234991e3d3afb38af55b48f58bd8f28ceb6e2', expectedEntry, expectedStyles,
  transport: 'Published host and its actual LobbyClient.join. Browser debugger replaces only the room transport with a local sink. Guest account stays null. All real WebSockets, API writes and external HTTP are blocked. API GETs return a guest stub.',
  limitation: 'This checks the published client and real host layout. No authenticated server or live moderation request is exercised. Local real WS/PG and moderation coverage are recorded separately.',
  accountsCreated: 0, productionMessages: 0, trials: [], passed: false,
};
await mkdir(dirname(output), { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });

async function socialInstance(context, page) {
  const cdp = await context.newCDPSession(page);
  const fn = await cdp.send('Runtime.evaluate', { expression: 'window.royalDemo.getNetworkState' });
  const properties = await cdp.send('Runtime.getProperties', { objectId: fn.result.objectId });
  const scopesId = properties.internalProperties.find(property => property.name === '[[Scopes]]')?.value?.objectId;
  if (!scopesId) throw Error('Published client debugger scope unavailable');
  const scopes = await cdp.send('Runtime.getProperties', { objectId: scopesId });
  const name = await page.evaluate(() => window.royalDemo.getNetworkState.toString().match(/=>\s*([\w$]+)\?\.client/)?.[1]);
  if (!name) throw Error('Published client social reference unavailable');
  for (const scope of scopes.result) {
    if (!scope.value?.objectId || !/^\d+$/.test(scope.name)) continue;
    const values = await cdp.send('Runtime.getProperties', { objectId: scope.value.objectId });
    const objectId = values.result.find(value => value.name === name)?.value?.objectId;
    if (objectId) return { cdp, objectId };
  }
  throw Error('Published client social instance unavailable');
}

async function check(viewport) {
  const trial = { viewport, cases: [], apiWritesAttempted: [], webSocketsAttempted: [], externalRequestsBlocked: [], pageErrors: [], requestFailures: [], httpErrors: [], screenshots: [], passed: false };
  proof.trials.push(trial);
  const context = await browser.newContext({ viewport, isMobile: viewport.width === 390, hasTouch: viewport.width === 390, locale: 'ru-RU', serviceWorkers: 'block' });
  const page = await context.newPage();
  let closing = false;
  page.on('pageerror', error => trial.pageErrors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) trial.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('requestfailed', request => {
    const url = new URL(request.url()), path = url.pathname, error = request.failure()?.errorText || '';
    const classification = url.origin !== origin && /ERR_BLOCKED_BY_CLIENT/.test(error) && trial.externalRequestsBlocked.includes(url.origin + path) ? 'external GET intentionally blocked by the read-only test route'
      : /ERR_ABORTED/.test(error) && path.startsWith('/assets/cat/optimized/') ? 'optional decoration cancelled by game intent'
      : closing && /ERR_ABORTED/.test(error) ? 'request cancelled at explicit test context close' : null;
    trial.requestFailures.push({ url: url.origin + path, path, error, classification });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) { trial.externalRequestsBlocked.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
    if (!['GET', 'HEAD'].includes(request.method())) { trial.apiWritesAttempted.push(request.method() + ' ' + url.pathname); return route.abort('blockedbyclient'); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { account: null, games: [] } });
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => { trial.webSocketsAttempted.push(socket.url()); socket.close(); });
  const packets = () => page.evaluate(() => window.__publicChatCheck.packets.filter(packet => packet.type === 'chat'));
  const receive = (type, value) => page.evaluate(({ type, value }) => window.__publicChatCheck.receive(type, value), { type, value });
  const run = async (name, callback) => { await callback(); trial.cases.push({ name, passed: true }); };
  const send = async text => {
    await page.locator('#chat-input').fill(text); await page.locator('#send-chat').click();
    const sent = (await packets()).at(-1)?.value;
    expect(sent).toMatchObject({ text }); expect(sent.id).toMatch(/^[0-9a-f-]{36}$/); return sent;
  };
  try {
    const started = Date.now();
    const document = await page.goto(origin + '/?lang=ru&chat-client-check=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!document?.ok()) throw Error('Host document unavailable');
    const entries = await page.evaluate(() => ({ scripts: [...document.scripts].map(script => new URL(script.src || location.href).pathname), styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => new URL(link.href).pathname) }));
    expect(entries.scripts.filter(path => path.startsWith('/assets/index-'))).toEqual(['/assets/' + expectedEntry]);
    expect(entries.styles.filter(path => path.startsWith('/assets/index-'))).toEqual(['/assets/' + expectedStyles]);
    trial.loadedAssets = entries;
    await expect(page.locator('#join-dialog')).toBeVisible({ timeout: 120000 });
    await expect(page.locator('#loading')).toHaveCount(0, { timeout: 120000 });
    trial.hallReadyMs = Date.now() - started;
    const { cdp, objectId } = await socialInstance(context, page);
    const installed = await cdp.send('Runtime.callFunctionOn', { objectId, awaitPromise: true, returnByValue: true,
      functionDeclaration: `async function() {
        const handlers = new Map(), packets = []; let drop, reconnect, leave;
        const room = { roomId:'public-browser-sink',sessionId:'public-browser-self',reconnection:{},
          send(type,value){packets.push({type,value});},onMessage(type,callback){handlers.set(type,callback);},onStateChange(){},onError(){},
          onDrop(callback){drop=callback;},onReconnect(callback){reconnect=callback;},onLeave(callback){leave=callback;},leave(){leave(1000);} };
        this.client.client={joinOrCreate:async()=>room}; await this.client.join(); this.scene.network=undefined; packets.length=0;
        window.__publicChatCheck={packets,receive:(type,value)=>handlers.get(type)?.(value),drop,reconnect,state:()=>({checking:this.checking,status:this.client.status,account:this.auth.account})};
        return window.__publicChatCheck.state();
      }` });
    if (installed.exceptionDetails) throw Error(installed.exceptionDetails.text);
    expect(installed.result.value).toEqual({ checking: false, status: 'connected', account: null });
    await expect(page.locator('#join-dialog')).toBeHidden(); await expect(page.locator('#chat-input')).toBeEnabled();
    let first, retry;
    await run('queued message keeps next draft editable', async () => {
      first = await send('Локальная проверка интерфейса');
      await receive('chat-check', true); await receive('chat-result', { id: first.id, status: 'queued' });
      await expect(page.locator(`[data-request-id="${first.id}"]`)).toHaveAttribute('data-delivery', 'queued');
      await expect(page.locator('#chat-input')).toBeEnabled(); await page.locator('#chat-input').fill('Следующий сохранённый черновик');
      expect(await packets()).toHaveLength(1);
    });
    await run('explicit rejection retains both texts and only manual retry sends', async () => {
      await receive('chat-result', { id: first.id, status: 'rejected', message: 'Не удалось подтвердить сообщение. Оно не отправлено. Попробуй ещё раз.' });
      const saved = page.locator(`[data-request-id="${first.id}"]`);
      await expect(saved).toContainText(first.text); await expect(saved).toHaveAttribute('data-delivery', 'rejected');
      await saved.locator('[data-chat-restore]').click(); await expect(page.locator('#chat-input')).toHaveValue('Следующий сохранённый черновик');
      expect(await packets()).toHaveLength(1);
      await saved.locator('[data-chat-retry]').click(); retry = (await packets()).at(-1).value;
      expect(await packets()).toHaveLength(2); expect(retry.id).not.toBe(first.id); expect(retry.text).toBe(first.text);
      await expect(page.locator('#chat-input')).toHaveValue('Следующий сохранённый черновик');
    });
    await run('publication replaces the matching pending row once', async () => {
      await receive('chat', { id: 'sink-published', requestId: retry.id, senderId: 'public-browser-self', name: 'Тест', text: retry.text, time: Date.now() });
      await receive('chat-result', { id: retry.id, status: 'published' });
      await expect(page.locator('[data-request-id]')).toHaveCount(0); await expect(page.locator('[data-message-id="sink-published"]')).toHaveCount(1);
      await expect(page.locator('#chat-input')).toHaveValue('Следующий сохранённый черновик');
    });
    await run('drop and reconnect clear checking and reconcile history without resend', async () => {
      const message = await send('Текст перед обрывом'); await receive('chat-check', true); await receive('chat-result', { id: message.id, status: 'queued' });
      await page.locator('#chat-input').fill('Черновик при восстановлении'); await page.evaluate(() => window.__publicChatCheck.drop());
      const saved = page.locator(`[data-request-id="${message.id}"]`);
      await expect(saved).toHaveAttribute('data-delivery', 'uncertain'); await expect(saved.locator('[data-chat-retry]')).toHaveCount(0);
      expect(await page.evaluate(() => window.__publicChatCheck.state())).toEqual({ checking: false, status: 'reconnecting', account: null });
      await page.evaluate(() => window.__publicChatCheck.reconnect());
      await expect(page.locator('#chat-input')).toBeEnabled(); await expect(page.locator('#chat-input')).toHaveValue('Черновик при восстановлении');
      expect(await packets()).toHaveLength(3);
      await receive('history', [{ id: 'sink-history', requestId: message.id, senderId: 'public-browser-self', name: 'Тест', text: message.text, time: Date.now() }]);
      await expect(saved).toHaveCount(0); await expect(page.locator('#chat-delivery-status')).toBeHidden(); expect(await packets()).toHaveLength(3);
    });
    await run('explicit cancellation keeps the recoverable text', async () => {
      const message = await send('Текст отменённой проверки'); await receive('chat-result', { id: message.id, status: 'cancelled', message: 'Проверка сообщения отменена.' });
      const saved = page.locator(`[data-request-id="${message.id}"]`);
      await expect(saved).toHaveAttribute('data-delivery', 'cancelled'); await saved.locator('[data-chat-restore]').click();
      await expect(page.locator('#chat-input')).toHaveValue(message.text); expect(await packets()).toHaveLength(4);
      await saved.locator('[data-chat-dismiss]').click();
    });
    if (gameSmoke) await run('real RoyalDice catalog opening keeps desktop or mobile chat usable', async () => {
      await page.locator('#games-tab').click();
      const cabinet = page.locator('[data-studio="royal-dice"], [data-cabinet="royal-dice"]').first();
      await cabinet.scrollIntoViewIfNeeded(); await cabinet.click();
      if (await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();
      await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', 'royal-dice', { timeout: 30000 });
      trial.moduleVersion = await page.locator('#mini-game').getAttribute('data-game-module-version');
      await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
    });
    await run('20 second deadline is unconfirmed and never retries automatically', async () => {
      await page.clock.install(); const message = await send('Текст без ответа'); await receive('chat-check', true);
      await page.clock.fastForward(20100);
      const saved = page.locator(`[data-request-id="${message.id}"]`);
      await expect(saved).toHaveAttribute('data-delivery', 'uncertain'); await expect(saved.locator('[data-chat-retry]')).toHaveCount(0);
      expect(await packets()).toHaveLength(5); await expect(page.locator('[data-message-id]')).toHaveCount(2);
      await saved.locator('[data-chat-dismiss]').click();
    });
    await run('pending row and next draft fit the real host', async () => {
      const message = await send('Сохранённое сообщение на проверке'); await receive('chat-result', { id: message.id, status: 'queued' });
      await page.locator('#chat-input').fill('Можно писать следующее сообщение');
      await expect(page.locator('#chat-input')).toBeEnabled(); await expect(page.locator('#chat-input')).toBeInViewport();
      await expect(page.locator('#send-chat')).toBeInViewport(); await expect(page.locator(`[data-request-id="${message.id}"]`)).toBeInViewport();
      trial.chatBounds = await page.locator('#chat-panel').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      expect(trial.chatBounds.scrollWidth).toBeLessThanOrEqual(trial.chatBounds.width);
      const screenshot = resolve(dirname(output), `public-chat-${viewport.width}.png`); await page.screenshot({ path: screenshot }); trial.screenshots.push(screenshot);
      if (viewport.width === 390) {
        await page.evaluate(() => document.documentElement.style.setProperty('--app-height', '500px'));
        await expect(page.locator('#chat-input')).toBeInViewport();
        expect(await page.locator('#chat-input').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(500);
        const keyboard = resolve(dirname(output), 'public-chat-390-keyboard.png'); await page.screenshot({ path: keyboard }); trial.screenshots.push(keyboard);
      }
    });
    trial.chatRequestsInLocalSink = (await packets()).length;
    expect(trial.chatRequestsInLocalSink).toBe(6); expect(trial.apiWritesAttempted).toEqual([]); expect(trial.webSocketsAttempted).toEqual([]); expect(trial.pageErrors).toEqual([]); expect(trial.httpErrors).toEqual([]);
    trial.passed = true;
  } catch (error) {
    trial.error = error.stack || error.message;
    const screenshot = resolve(dirname(output), `public-chat-${viewport.width}-failure.png`);
    await page.screenshot({ path: screenshot }).then(() => trial.screenshots.push(screenshot)).catch(() => {});
  } finally {
    closing = true; await context.close();
    trial.genuineRequestFailures = trial.requestFailures.filter(failure => !failure.classification);
    if (trial.genuineRequestFailures.length) trial.passed = false;
    await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({ viewport: viewport.width, passed: trial.passed, cases: trial.cases.length, hallReadyMs: trial.hallReadyMs, error: trial.error?.slice(0, 300), genuineRequestFailures: trial.genuineRequestFailures.length }));
  }
}
try {
  await check({ width: 1440, height: 1000 });
  await check({ width: 390, height: 844 });
  proof.passed = proof.trials.length === 2 && proof.trials.every(trial => trial.passed);
} finally {
  await browser.close(); await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
}
if (!proof.passed) process.exitCode = 1;
