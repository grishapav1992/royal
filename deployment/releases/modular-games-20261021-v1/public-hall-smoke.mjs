import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) options.set(process.argv[index], process.argv[index + 1]);
const origin = new URL(options.get('--origin') || 'https://stealth-spark-gokmxooi.expresshost.cloud').origin;
const local = new URL(origin).hostname === '127.0.0.1' || new URL(origin).hostname === 'localhost';
if (!origin.startsWith('https://') && !local) throw Error('Public hall verification requires HTTPS');
const output = resolve(options.get('--output') || 'artifacts/modular-production-20261021/proof/public-hall');
const manifestPath = options.get('--manifest') || 'artifacts/modular-production-20261021/shipping/install-manifest.json';
const beforePath = options.get('--before') || 'artifacts/modular-production-20261021/before.json';
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
const before = JSON.parse(await readFile(resolve(beforePath), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (value, message) => { if (!value) throw Error(message); };
await mkdir(output, { recursive: true });
const result = { origin, at: new Date().toISOString(), sourceCommit: manifest.sourceCommit,
  accountsCreated: false, stakesPlaced: false, authenticated: false, offlineGuest: true,
  serverMutationsSent: 0, blockedMutations: [], errors: [], opened: [], hockey: null };
const browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  executablePath: options.get('--chrome') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let page;
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
  locale: 'ru-RU' });
 if (options.get('--renderer') === 'canvas') {
  await context.addInitScript(() => {
   const getContext = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
    if (['webgl', 'webgl2', 'experimental-webgl'].includes(kind)) return null;
    return Reflect.apply(getContext, this, [kind, ...args]);
   };
  });
  result.graphicsBackend = 'Phaser Canvas';
  result.capabilityShim = 'Browser-only canvas.getContext returns null for WebGL contexts; 2D contexts unchanged';
 } else {
  result.graphicsBackend = 'Phaser AUTO (default browser WebGL)';
  result.capabilityShim = 'none';
 }
 result.coldLoadTimeoutMs = 180000;
 page = await context.newPage();
 page.on('pageerror', error => result.errors.push(error.message));
 result.console = []; result.failedRequests = []; result.httpErrors = [];
 page.on('console', message => { if (['error', 'warning'].includes(message.type()) && result.console.length < 60) result.console.push({ type: message.type(), message: message.text() }); });
 page.on('requestfailed', request => { if (result.failedRequests.length < 60) result.failedRequests.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }); });
 page.on('response', response => { if (response.status() >= 400 && result.httpErrors.length < 60) result.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
 page.on('request', request => {
  if (new URL(request.url()).origin === origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) result.serverMutationsSent++;
 });
 // Any unexpected API write is blocked before it can reach production.
 await page.route('**/api/**', async route => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
  result.blockedMutations.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
  await route.abort('blockedbyclient');
 });
 const response = await page.goto(`${origin}/?offline=1&chat=off&module-smoke=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
 assert(response?.ok(), 'Public hall document did not load');
 const indexHash = hash(await response.body());
 assert(indexHash === manifest.delta['index.html'], 'Public index differs from the reviewed modular release');
 result.indexSha256 = indexHash;
 await page.bringToFront();
 console.log(JSON.stringify({ checkpoint: 'public-index-matches', sourceCommit: manifest.sourceCommit }));
 await page.waitForFunction(() => { try { return window.royalDemo?.getState()?.hall === 'arcade'; } catch { return false; } }, null, { timeout: 180000 });
 await expect(page.locator('#loading')).toHaveCount(0);
 const initial = await page.evaluate(() => window.royalDemo.getState());
 assert(initial.online === false, 'The smoke test must stay in the guest offline hall');
 assert(await context.cookies().then(cookies => !cookies.some(cookie => cookie.name === 'royal_session')), 'Unexpected authenticated session in a clean guest context');
 result.initialHall = { hall: initial.hall, online: initial.online, stools: initial.stools };
 const house = ['studio-cosmic-escape', 'studio-caramel-carnival', 'studio-velvet-reign', 'studio-last-convoy',
  'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload', 'github-crash', 'royal-plinko', 'original-cr-vs-leo'];
 for (const gameId of house) await expect(page.locator(`[data-cabinet="${gameId}"],[data-studio="${gameId}"]`)).toHaveCount(1);
 result.uniqueHouseCabinets = house.length;
 console.log(JSON.stringify({ checkpoint: 'guest-hall-ready', uniqueHouseCabinets: house.length }));
 if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
 await expect.poll(() => page.evaluate(() => window.royalDemo.getState().view.overview)).toBe(true);
 await page.screenshot({ path: resolve(output, 'hall-layout.png'), fullPage: true });

 const girlPointerResponse = await context.request.get(`${origin}/game-modules/studio-afterglow/active.json`);
 assert(girlPointerResponse.ok(), 'Retained GIRLHUB pointer unavailable');
 const girlPointerBytes = await girlPointerResponse.body();
 const retainedHash = before.moduleFiles['/opt/royal-game-modules/studio-afterglow/active.json'];
 assert(retainedHash && hash(girlPointerBytes) === retainedHash, 'Published GIRLHUB active pointer changed');
 const girlPointer = JSON.parse(girlPointerBytes);
 result.retainedGirlhub = { activeSha256: retainedHash, manifest: girlPointer.manifest, unchanged: true };

 const games = [
  { id: 'studio-afterglow', selector: '[data-afterglow-game]', action: '[data-cc-spin]', x: 1200, y: 743 },
  { id: 'original-cr-vs-leo', selector: '.cr-leo', action: '[data-shoot]', x: 1740, y: 743 },
  { id: 'royal-plinko', selector: '.volcanic-plinko[data-game="royal-plinko"]', action: '[data-vp="drop"]', x: 1605, y: 743 },
 ];
 for (const game of games) {
  const cabinet = page.locator(`[data-cabinet="${game.id}"],[data-studio="${game.id}"]`);
  if (!await cabinet.isVisible()) await page.locator('#games-tab').click();
  await cabinet.click();
  if (await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game', game.id);
  await expect(page.locator(game.selector)).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', game.id, { timeout: 15000 });
  await expect(page.locator(game.action)).toBeDisabled();
  if (game.id === 'studio-afterglow') await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state', 'ready', { timeout: 120000 });
  if (game.id === 'original-cr-vs-leo') await expect(page.locator('.cr-leo')).toHaveAttribute('data-loading', 'false', { timeout: 120000 });
  const state = await page.evaluate(() => window.royalDemo.getState());
  assert(state.near === game.id && Math.abs(state.x - game.x) < 1 && Math.abs(state.y - game.y) < 1,
   `Cabinet ${game.id} does not use the retained two-row layout`);
  const version = await page.locator('#mini-game').getAttribute('data-game-module-version');
  if (game.id === 'studio-afterglow') assert(girlPointer.manifest.includes(`/versions/${version}/`), 'GIRLHUB did not mount its retained external version');
  await page.screenshot({ path: resolve(output, `${game.id}.png`), fullPage: true });
  result.opened.push({ gameId: game.id, moduleVersion: version, title: await page.locator(game.selector).getAttribute('aria-label'),
   cabinetSeat: { x: state.x, y: state.y }, actionDisabled: true, openedFromRealCabinet: true });
  console.log(JSON.stringify({ checkpoint: 'cabinet-opened', gameId: game.id, moduleVersion: version }));
  await page.locator('#mini-dialog .mini-top [data-close]').click({ force: true });
  await expect(page.locator('#mini-dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.royalDemo.getState().locked)).toBe(false);
 }

 // Offline guest mode does not join social tables. Exercise the actual deployed hockey package
 // with a local snapshot and a local command sink, without creating a server player or match.
 const hockey = await page.evaluate(async () => {
  const pointerReply = await fetch('/game-modules/hockey/active.json', { cache: 'no-store' });
  if (!pointerReply.ok) throw Error('Hockey pointer unavailable');
  const pointer = await pointerReply.json();
  const manifestReply = await fetch(pointer.manifest, { cache: 'no-store' });
  if (!manifestReply.ok) throw Error('Hockey manifest unavailable');
  const bytes = await manifestReply.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== pointer.sha256) throw Error('Hockey manifest digest differs');
  const metadata = JSON.parse(new TextDecoder().decode(bytes));
  if (metadata.gameId !== 'hockey' || metadata.apiVersion !== 1) throw Error('Unexpected hockey module');
  const root = pointer.manifest.slice(0, pointer.manifest.lastIndexOf('/') + 1);
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = root + metadata.styles[0];
  await new Promise((resolve, reject) => { style.onload = resolve; style.onerror = () => reject(Error('Hockey stylesheet unavailable')); document.head.append(style); });
  const module = await import(root + metadata.entry);
  const host = document.createElement('div'); host.id = 'public-hockey-smoke'; document.body.append(host);
  const sent = [], audio = { muted: true, unlock: async () => {}, note() {}, stop() {}, getState: () => ({ muted: true, played: 0 }) };
  const state = { tables: [{ id: 'hockey', players: ['offline-smoke-a', 'offline-smoke-b'], phase: 'playing', score: [0, 0], groups: ['open', 'open'],
   breaking: false, ballInHand: 'none', message: '', sound: { seq: 0, kind: '' }, winner: '', turn: 0, moving: true,
   balls: [{ id: 0, x: 360, y: 200, vx: 80, vy: 15, active: true }], paddles: [{ x: 100, y: 200 }, { x: 620, y: 200 }], ready: [], serveDelay: 0 }],
   pianist: '', notes: [], chess: { players: [], phase: 'waiting', turn: 'w', board: [], moves: [], last: null, check: false, winner: '', message: '',
    ready: [], revision: 0, sound: '', clock: { remainingMs: [900000, 900000], running: null } } };
  const game = module.mount(host, { activity: { scene: { hall: 'tables', player: { x: 1220, y: 510 }, setLocked() {}, pianoNote() {} },
   send: command => sent.push(command), state, players: [], self: 'offline-smoke-a', pianoAudio: audio, onClose() {} } });
  window.__publicHockeySmoke = { game, sent, host, style };
  return { gameId: metadata.gameId, moduleVersion: metadata.version, localSnapshotOnly: true, serverMatchCreated: false };
 });
 await expect(page.locator('#shared-dialog')).toBeVisible();
 await expect(page.locator('#shared-dialog')).toHaveAttribute('data-game', 'hockey');
 await page.waitForFunction(() => window.__publicHockeySmoke.game.getState().frames > 2);
 await page.keyboard.down('ArrowRight'); await page.waitForTimeout(160); await page.keyboard.up('ArrowRight');
 const moving = await page.evaluate(() => ({ state: window.__publicHockeySmoke.game.getState(), commands: window.__publicHockeySmoke.sent }));
 assert(moving.state.hockey.local.x > 100 && moving.commands.some(command => command.type === 'paddle'), 'Hockey paddle input did not render');
 await page.screenshot({ path: resolve(output, 'hockey-local-snapshot.png'), fullPage: true });
 const stopped = await page.evaluate(() => {
  const smoke = window.__publicHockeySmoke; smoke.game.destroy(); smoke.host.remove(); smoke.style.remove();
  globalThis[Symbol.for('royal.game-host.v1')].gameAudio.setGame('');
  return { frames: smoke.game.getState().frames, commands: smoke.sent.length };
 });
 await page.waitForTimeout(160);
 const afterDestroy = await page.evaluate(() => ({ frames: window.__publicHockeySmoke.game.getState().frames, commands: window.__publicHockeySmoke.sent.length }));
 assert(stopped.frames === afterDestroy.frames && stopped.commands === afterDestroy.commands, 'Closed hockey retained a frame loop or commands');
 result.hockey = { ...hockey, paddleMoved: true, framesStoppedAfterDestroy: true, commandsStayedLocal: true };
 assert(result.blockedMutations.length === 0 && result.serverMutationsSent === 0, 'Unexpected API write attempted');
 assert(result.errors.length === 0, 'Browser exceptions: ' + JSON.stringify(result.errors));
 result.verified = true;
 await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
 console.log(JSON.stringify({ verified: true, opened: result.opened.map(game => game.gameId), retainedGirlhub: true,
  hockey: 'deployed package with local snapshot', accountsCreated: false, stakesPlaced: false, output }));
} catch (error) {
 result.verified = false; result.failure = error.message;
 if (page) {
  try { result.finalHall = await page.evaluate(() => window.royalDemo?.getState()); } catch {}
  try { await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); } catch {}
 }
 await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
 throw error;
} finally { await browser.close(); }
