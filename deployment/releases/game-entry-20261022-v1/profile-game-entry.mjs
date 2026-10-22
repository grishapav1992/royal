import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const origin = args.get('--origin') || 'https://stealth-spark-gokmxooi.expresshost.cloud';
const output = resolve(args.get('--output') || 'artifacts/game-entry-20261022/proof/public-entry-before.json');
const gameIds = (args.get('--games') || 'studio-cosmic-escape,studio-caramel-carnival,studio-velvet-reign,royal-dice').split(',');
const mobile = args.get('--mobile') === '1';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const proof = { origin, at: new Date().toISOString(), accountsCreated: false, stakesPlaced: false,
  shim: 'Browser debugger changes only LobbyClient.status to connected after guest auth closes. RoomScene.network remains undefined, account stays null, real host chat and cabinet walk/seat/window stay active. All API writes blocked through CDP Fetch. This does not measure authenticated saved-round checks.',
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  blockedWrites: [], errors: [], intentionalCancellations: [], trials: [] };
try {
  const context = await browser.newContext({ viewport: proof.viewport, deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', async event => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
      proof.blockedWrites.push({ method: event.request.method, path: new URL(event.request.url).pathname });
      return cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
    }
    return cdp.send('Fetch.continueRequest', { requestId: event.requestId });
  });
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId, { url: event.request.url,
    type: event.type, method: event.request.method, started: event.timestamp, wallTime: event.wallTime,
    initiator: event.initiator.type, cached: false, encodedBytes: 0 }));
  cdp.on('Network.requestServedFromCache', event => { const request = requests.get(event.requestId); if (request) request.cached = true; });
  cdp.on('Network.responseReceived', event => Object.assign(requests.get(event.requestId) || {}, { status: event.response.status,
    mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache,
    responseStarted: event.timestamp }));
  cdp.on('Network.loadingFinished', event => Object.assign(requests.get(event.requestId) || {}, { encodedBytes: event.encodedDataLength, finished: event.timestamp }));
  cdp.on('Network.loadingFailed', event => Object.assign(requests.get(event.requestId) || {}, { failed: event.errorText,
    canceled: event.canceled, finished: event.timestamp }));
  page.on('pageerror', error => proof.errors.push(error.message));
  page.on('requestfailed', request => {
    const path = new URL(request.url()).pathname, error = request.failure()?.errorText || '';
    if (path.startsWith('/assets/cat/optimized/') && /ERR_ABORTED/.test(error)) proof.intentionalCancellations.push({ path, error });
    else proof.errors.push(`${path}: ${error}`);
  });
  await context.addInitScript(() => {
    window.__gameTrial = null;
    const inspect = () => {
      const trial = window.__gameTrial;
      if (!trial) return;
      const dialog = document.querySelector('#mini-dialog[open]');
      if (dialog && !trial.dialogOpenMs) trial.dialogOpenMs = performance.now();
      const host = document.querySelector('#mini-game');
      if (host?.dataset.gameModuleId !== trial.gameId) return;
      if (!trial.moduleMountedMs) trial.moduleMountedMs = performance.now();
      const assets = host.querySelector('[data-asset-state]');
      if (assets) trial.assetState = assets.dataset.assetState;
      const ready = trial.gameId.startsWith('studio-') ? assets?.dataset.assetState === 'ready' : !!host.querySelector('#original-play, [data-dice-play]');
      if (ready && !trial.assetsReadyMs) trial.assetsReadyMs = performance.now();
      if (assets?.dataset.assetState === 'error' && !trial.assetErrorMs) trial.assetErrorMs = performance.now();
    };
    new MutationObserver(inspect).observe(document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['open', 'data-game-module-id', 'data-asset-state'] });
  });
  await page.goto(`${origin}/?entry-profile=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#join-dialog[open] #email')?.getClientRects().length && !document.querySelector('#login-button')?.disabled && !document.querySelector('#loading'), null, { timeout: 120000 });
  proof.hallReadyMs = await page.evaluate(() => performance.now());
  const functionResult = await cdp.send('Runtime.evaluate', { expression: 'window.royalDemo.getNetworkState' });
  const functionProperties = await cdp.send('Runtime.getProperties', { objectId: functionResult.result.objectId });
  const scopesId = functionProperties.internalProperties.find(property => property.name === '[[Scopes]]')?.value.objectId;
  if (!scopesId) throw Error('Guest access debugger scope unavailable');
  const scopes = await cdp.send('Runtime.getProperties', { objectId: scopesId });
  const socialName = await page.evaluate(() => window.royalDemo.getNetworkState.toString().match(/=>\s*([\w$]+)\?\.client/)?.[1]);
  if (!socialName) throw Error('Guest access social reference unavailable');
  let socialObjectId;
  for (const scope of scopes.result) {
    if (!scope.value?.objectId || !/^\d+$/.test(scope.name)) continue;
    const properties = await cdp.send('Runtime.getProperties', { objectId: scope.value.objectId });
    socialObjectId = properties.result.find(property => property.name === socialName)?.value?.objectId;
    if (socialObjectId) break;
  }
  if (!socialObjectId) throw Error('Guest access social instance unavailable');
  await cdp.send('Runtime.callFunctionOn', { objectId: socialObjectId,
    functionDeclaration: 'function(){ this.client.status = "connected"; return {account:this.auth.account,status:this.client.status}; }', returnByValue: true }).then(result => { proof.shimState = result.result.value; });
  await page.evaluate(() => document.querySelector('#join-dialog').close());
  if (proof.shimState?.account !== null) throw Error('Expected guest account');
  proof.chatPresent = await page.locator('.chat-dock').count() === 1;
  console.log(JSON.stringify({ checkpoint: 'guest-host-ready', hallReadyMs: proof.hallReadyMs, chat: proof.chatPresent, shim: proof.shimState }));

  for (const gameId of gameIds) for (const temperature of ['cold', 'warm-reopen']) {
    const candidate = page.locator(`[data-studio="${gameId}"], [data-cabinet="${gameId}"]`).first();
    if (!await candidate.isVisible()) await page.locator('#games-tab').click();
    await candidate.scrollIntoViewIfNeeded();
    const pendingAtClick = [...requests.values()].filter(request => !request.finished).map(request => ({ url: new URL(request.url).pathname, started: request.started }));
    const startRequests = new Set(requests.keys());
    const started = Date.now();
    await page.evaluate(({ gameId, temperature }) => { window.__gameTrial = { gameId, temperature, clickMs: performance.now() }; }, { gameId, temperature });
    let failure = null;
    console.log(JSON.stringify({ checkpoint: 'cabinet-click', gameId, temperature }));
    try {
      await candidate.click();
      if (await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();
      await page.waitForFunction(() => !!window.__gameTrial?.assetsReadyMs || !!window.__gameTrial?.assetErrorMs, null, { timeout: 90000 });
    } catch (error) { failure = error.message; }
    const result = await page.evaluate(() => ({ ...window.__gameTrial, nowMs: performance.now(),
      miniState: window.royalDemo.getMiniState(), roomState: window.royalDemo.getState(),
      moduleVersion: document.querySelector('#mini-game')?.dataset.gameModuleVersion,
      nativeImages: [...document.querySelectorAll('#mini-game img')].map(image => ({ path: image.currentSrc ? new URL(image.currentSrc).pathname : null, complete: image.complete, width: image.naturalWidth })),
      primaryActions: [...document.querySelectorAll('#mini-game [data-lg-spin], #mini-game [data-cc-spin], #mini-game [data-lg-dialog-action="enter"], #mini-game [data-cc-action="enter"]')].map(button => ({ action: button.dataset.lgDialogAction || button.dataset.ccAction || 'spin', disabled: button.disabled, visible: !!button.getClientRects().length })),
      packageError: document.querySelector('#mini-game > div > p[role="alert"]')?.textContent || null,
      chatPresent: !!document.querySelector('.chat-dock'),
      gameBounds: document.querySelector('#mini-dialog')?.getBoundingClientRect().toJSON(),
      chatBounds: document.querySelector('.chat-dock')?.getBoundingClientRect().toJSON(),
      viewportWidth: innerWidth, viewportHeight: innerHeight,
    }));
    const newRequests = [...requests].filter(([id]) => !startRequests.has(id)).map(([, row]) => ({ ...row, url: new URL(row.url).pathname,
      startedFromClickMs: row.wallTime * 1000 - started,
      durationMs: row.finished ? (row.finished - row.started) * 1000 : null }));
    const row = { ...result, failure, elapsedMs: Date.now() - started,
      clickToDialogMs: result.dialogOpenMs ? result.dialogOpenMs - result.clickMs : null,
      dialogToMountedMs: result.moduleMountedMs && result.dialogOpenMs ? result.moduleMountedMs - result.dialogOpenMs : null,
      mountedToReadyMs: result.assetsReadyMs && result.moduleMountedMs ? result.assetsReadyMs - result.moduleMountedMs : null,
      clickToReadyMs: result.assetsReadyMs ? result.assetsReadyMs - result.clickMs : null,
      encodedNetworkBytes: newRequests.reduce((sum, request) => sum + request.encodedBytes, 0),
      moduleNetworkBytes: newRequests.filter(request => request.url.startsWith(`/game-modules/${gameId}/`)).reduce((sum, request) => sum + request.encodedBytes, 0),
      pendingAtClick,
      resources: newRequests,
    };
    proof.trials.push(row);
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, JSON.stringify(proof, null, 2));
    await page.screenshot({ path: output.replace(/\.json$/, `-${gameId}-${temperature}.png`), fullPage: true });
    if (args.get('--inspect-intro') === '1' && temperature === 'cold') {
      const enter = page.locator('#mini-game [data-lg-dialog-action="enter"], #mini-game [data-cc-action="enter"]').first();
      if (await enter.count()) {
        row.introProbe = { before: await enter.evaluate(button => ({ bounds: button.getBoundingClientRect().toJSON(),
          ancestors: [...(function* () { for (let parent = button.parentElement; parent; parent = parent.parentElement) yield parent; })()]
            .filter(parent => parent.scrollHeight > parent.clientHeight + 3).map(parent => ({ tag: parent.tagName, className: parent.className, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight, overflow: getComputedStyle(parent).overflowY, scrollTop: parent.scrollTop })) })) };
        try {
          await enter.scrollIntoViewIfNeeded({ timeout: 3000 });
          row.introProbe.afterScroll = await enter.evaluate(button => button.getBoundingClientRect().toJSON());
          await page.screenshot({ path: output.replace(/\.json$/, `-${gameId}-${temperature}-intro-scrolled.png`), fullPage: true });
          await enter.click({ timeout: 3000 });
          await page.waitForTimeout(200);
          row.introProbe.entered = true;
          await page.screenshot({ path: output.replace(/\.json$/, `-${gameId}-${temperature}-entered.png`), fullPage: true });
        } catch (error) { row.introProbe.failure = error.message; }
        await writeFile(output, JSON.stringify(proof, null, 2));
      }
    }
    console.log(JSON.stringify({ gameId, temperature, failure, clickToReadyMs: row.clickToReadyMs,
      clickToDialogMs: row.clickToDialogMs, dialogToMountedMs: row.dialogToMountedMs, mountedToReadyMs: row.mountedToReadyMs,
      encodedNetworkBytes: row.encodedNetworkBytes, assetState: row.assetState }));
    if (await page.locator('#mini-dialog').evaluate(dialog => dialog.open)) await page.locator('#mini-dialog .mini-top [data-close]').click({ force: true });
    await page.waitForFunction(() => !document.querySelector('#mini-dialog[open]'));
    await page.waitForTimeout(200);
  }
  await writeFile(output, JSON.stringify(proof, null, 2));
} finally { await browser.close(); }
