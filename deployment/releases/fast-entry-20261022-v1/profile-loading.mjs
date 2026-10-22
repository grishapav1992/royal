import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const origin = args.get('--origin') || 'https://stealth-spark-gokmxooi.expresshost.cloud';
const output = resolve(args.get('--output') || 'artifacts/fast-entry-20261022/proof/loading-before.json');
const profiles = args.get('--profiles')?.split(',') || ['desktop', 'mobile', 'desktop-10mbps', 'mobile-10mbps'];
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const results = [];
try {
  for (const profile of profiles) {
    const mobile = profile.startsWith('mobile');
    const throttled = profile.endsWith('10mbps');
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      deviceScaleFactor: mobile ? 3 : 1,
      isMobile: mobile,
      hasTouch: mobile,
      locale: 'ru-RU',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (throttled) await session.send('Network.emulateNetworkConditions', {
      offline: false, latency: 80, downloadThroughput: 10_000_000 / 8,
      uploadThroughput: 2_000_000 / 8, connectionType: 'cellular4g',
    });
    const requests = new Map();
    console.log(JSON.stringify({ checkpoint: "start", profile }));
    session.on('Network.requestWillBeSent', event => requests.set(event.requestId, {
      url: event.request.url, method: event.request.method, type: event.type,
      timestamp: event.timestamp,
    }));
    session.on('Network.responseReceived', event => Object.assign(requests.get(event.requestId) || {}, {
      status: event.response.status, mimeType: event.response.mimeType,
      encodedHeaderBytes: event.response.encodedDataLength,
    }));
    session.on('Network.loadingFinished', event => Object.assign(requests.get(event.requestId) || {}, {
      encodedBytes: event.encodedDataLength, finishedTimestamp: event.timestamp,
    }));
    const errors = [];
    const blockedMutations = [];
    page.on('pageerror', error => { errors.push(error.message); console.log(JSON.stringify({ checkpoint: "pageerror", profile, message: error.message })); });
    page.on('requestfailed', request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    await page.route('**/api/**', async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      blockedMutations.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
      await route.abort('blockedbyclient');
    });
    await context.addInitScript(() => {
      const metrics = window.__loadingMetrics = { longTasks: [], hallReadyMs: null, authDialogMs: null, authReadyMs: null };
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) metrics.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
      new MutationObserver(() => {
        if (!metrics.hallReadyMs && document.querySelector('canvas') && !document.querySelector('#loading')) metrics.hallReadyMs = performance.now();
        if (!metrics.authDialogMs && document.querySelector('#join-dialog[open]')) metrics.authDialogMs = performance.now();
        const email = document.querySelector('#join-dialog[open] #email');
        if (!metrics.authReadyMs && email?.getClientRects().length && !document.querySelector('#login-button')?.disabled) metrics.authReadyMs = performance.now();
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'disabled'] });
    });
    let failure = null;
    const started = Date.now();
    try {
      await page.goto(`${origin}/?loading-profile=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(JSON.stringify({ checkpoint: "dom", profile, elapsedMs: Date.now() - started }));
      await page.waitForFunction(() => document.querySelector('#join-dialog[open] #email')?.getClientRects().length && !document.querySelector('#login-button')?.disabled && !document.querySelector('#loading'), null, { timeout: 120000 });
    } catch (error) { failure = error.message; }
    const metrics = await page.evaluate(() => ({
      ...window.__loadingMetrics,
      nowMs: performance.now(),
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON(),
      resources: performance.getEntriesByType('resource').map(entry => ({
        path: new URL(entry.name).pathname, initiator: entry.initiatorType,
        transferBytes: entry.transferSize, bodyBytes: entry.encodedBodySize,
        decodedBytes: entry.decodedBodySize, startMs: entry.startTime, durationMs: entry.duration,
      })),
      paints: performance.getEntriesByType('paint').map(entry => ({ name: entry.name, startMs: entry.startTime })),
      loadingPresent: Boolean(document.querySelector('#loading')),
      authOpen: Boolean(document.querySelector('#join-dialog[open]')),
      chatPresent: Boolean(document.querySelector('.chat-dock')),
      graphics: window.royalDemo?.getState?.().renderer,
    }));
    const row = {
      profile, origin, at: new Date().toISOString(), elapsedMs: Date.now() - started,
      failure, errors, blockedMutations, ...metrics,
      encodedNetworkBytes: [...requests.values()].reduce((sum, request) => sum + (request.encodedBytes || 0), 0),
      largestRequests: [...requests.values()].sort((a, b) => (b.encodedBytes || 0) - (a.encodedBytes || 0)).slice(0, 30).map(request => ({ ...request, url: new URL(request.url).pathname })),
    };
    results.push(row);
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, JSON.stringify({ results }, null, 2));
    await page.screenshot({ path: output.replace(/\.json$/, `-${profile}.png`), fullPage: true });
    console.log(JSON.stringify({ profile, authReadyMs: row.authReadyMs, hallReadyMs: row.hallReadyMs, encodedNetworkBytes: row.encodedNetworkBytes, failure, errors: errors.length }));
    await context.close();
  }
} finally { await browser.close(); }
