// Public GET/HEAD verification only. No accounts, wallet writes or room joins.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--manifest', '--install-manifest', '--before', '--output', '--origin'].includes(process.argv[i]) && process.argv[i + 1], 'Expected a supported option with a value');
  assert(!options.has(process.argv[i]), 'Duplicate option'); options.set(process.argv[i], process.argv[i + 1]);
}
assert(options.has('--before'), 'Pass the reviewed production snapshot with --before');
const origin = new URL(options.get('--origin') || 'https://stealth-spark-gokmxooi.expresshost.cloud').origin;
assert(new URL(origin).protocol === 'https:', 'Public verification requires HTTPS');
const manifestBytes = await readFile(resolve(root, options.get('--manifest') || 'module-build/release-manifest.json'));
const beforeBytes = await readFile(resolve(root, options.get('--before')));
const manifest = JSON.parse(manifestBytes), before = JSON.parse(beforeBytes);
const installBytes = await readFile(resolve(root, options.get('--install-manifest') || 'artifacts/work/cosmic-origin-release/payload/install-manifest.json'));
const install = JSON.parse(installBytes);
assert.equal(manifest.format, 1); assert.equal(manifest.scope, 'application'); assert.equal(manifest.build?.passed, true);
assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
assert(manifest.files?.['dist/index.html']); assert(before.program && before.moduleFiles);
assert.equal(manifest.baseCommit, before.sourceRevision);
assert.equal(install.release, 'cosmic-origin-20261026-v1'); assert.equal(install.sourceCommit, manifest.sourceCommit);
assert.equal(install.baseCommit, manifest.baseCommit); assert.deepEqual(install.before, before);
for (const [name, digest] of Object.entries(install.delta)) assert.equal(manifest.files['dist/' + name], digest);
assert.equal(install.delta['index.html'], manifest.files['dist/index.html']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = resolve(root, options.get('--output') || 'artifacts/work/cosmic-origin-release/public');
await mkdir(output, {recursive: true});
const game = 'studio-cosmic-escape';
const proof = {format: 1, checkedAt: new Date().toISOString(), origin, sourceCommit: manifest.sourceCommit,
  releaseManifestSha256: hash(manifestBytes), productionBeforeSha256: hash(beforeBytes),
  installManifestSha256: hash(installBytes), retainedPublicRuntimeFiles: install.retainedPublicRuntime.length,
  accountsCreated: 0, productionStakes: 0, productionMessages: 0, method: 'Anonymous public HTTP GET and browser GET/HEAD only. The actual published host opens Cosmic in offline guest mode. Production writes and all browser WebSockets are blocked before navigation. Connected chat and wallet recovery are covered by verify-local.mjs.',
  http: [], authentication: [], unrelatedPointers: [], oldCosmicManifests: [], browser: [], passed: false};
async function get(path, status = 200, digest) {
  assert(path.startsWith('/') && !path.startsWith('//') && !path.includes('..'), 'Only same-origin public paths are allowed');
  const response = await fetch(origin + path, {method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000)});
  assert.equal(response.status, status, path);
  const bytes = Buffer.from(await response.arrayBuffer()), actual = hash(bytes);
  if (digest) assert.equal(actual, digest, 'Published bytes differ: ' + path);
  proof.http.push({path, status: response.status, sha256: actual, cacheControl: response.headers.get('cache-control')});
  return {bytes, response};
}
async function concurrent(items, callback, workers = 4) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(workers, items.length)}, async () => {
    while (next < items.length) {const index = next++; await callback(items[index]);}
  }));
}
let browser, page;
try {
  const health = JSON.parse((await get('/healthz')).bytes); assert.equal(health.ok, true);
  const hostFiles = Object.entries(manifest.files).filter(([name]) => name === 'dist/index.html' || name.startsWith('dist/') && /\.(js|css)$/.test(name));
  assert(hostFiles.some(([name]) => name.endsWith('.js')) && hostFiles.some(([name]) => name.endsWith('.css')));
  await concurrent(hostFiles, async ([name, digest]) => {
    const sub = name.slice('dist/'.length), installedDigest = install.delta[sub] || before.program[name];
    assert(installedDigest, 'Missing expected installed host file ' + name);
    if (installedDigest !== digest) assert(install.retainedPublicRuntime.some(row => row.file === name && row.retainedSha256 === installedDigest && row.preparedSha256 === digest), 'Unreviewed retained file ' + name);
    const {response} = await get('/' + sub, 200, installedDigest);
    if (name === 'dist/index.html') assert.match(response.headers.get('cache-control') || '', /no-store/);
  });
  for (const [path, status] of [['/api/auth/me', 200], ['/api/demo-wallet', 401], ['/api/demo-wallet/expansion', 401], ['/api/game-wallet', 401], ['/api/skin-studio', 401], ['/api/nile-wallet', 410]]) {
    const reply = await get(path, status);
    if (path === '/api/auth/me') assert.equal(JSON.parse(reply.bytes).account, null);
    proof.authentication.push({path, anonymousStatus: status});
  }
  const expectedPointer = manifest.files[`module-dist/${game}/active.json`]; assert(expectedPointer);
  const current = await get(`/game-modules/${game}/active.json`, 200, expectedPointer);
  assert.match(current.response.headers.get('cache-control') || '', /no-store/);
  const pointer = JSON.parse(current.bytes);
  assert(pointer.manifest.startsWith(`/game-modules/${game}/versions/`));
  const packageReply = await get(pointer.manifest, 200, pointer.sha256);
  assert.equal(pointer.sha256, manifest.files['module-dist/' + pointer.manifest.slice('/game-modules/'.length)]);
  const metadata = JSON.parse(packageReply.bytes);
  assert.equal(metadata.gameId, game); assert.equal(metadata.apiVersion, 1); assert.equal(metadata.rulesVersion, 2);
  const prefix = pointer.manifest.slice(0, pointer.manifest.lastIndexOf('/') + 1);
  await concurrent(Object.entries(metadata.files), async ([name, digest]) => {
    assert(!name.startsWith('/') && !name.split('/').includes('..'));
    const path = prefix + name;
    assert.equal(digest, manifest.files['module-dist/' + path.slice('/game-modules/'.length)]);
    const {response} = await get(path, 200, digest);
    assert.match(response.headers.get('cache-control') || '', /immutable/);
  });
  proof.cosmic = {version: metadata.version, manifest: pointer.manifest, filesVerified: Object.keys(metadata.files).length};
  const effectivePointers = new Map();
  for (const [name, digest] of Object.entries(before.program)) {
    const match = name.match(/^module-dist\/([^/]+)\/active\.json$/);
    if (match) effectivePointers.set(match[1], digest);
  }
  for (const [name, digest] of Object.entries(before.moduleFiles)) {
    const match = name.match(/^\/opt\/royal-game-modules\/([^/]+)\/active\.json$/);
    if (match) effectivePointers.set(match[1], digest);
  }
  assert(effectivePointers.has(game));
  const unrelated = [...effectivePointers].filter(([id]) => id !== game).sort(([a], [b]) => a.localeCompare(b));
  assert(unrelated.length > 0);
  await concurrent(unrelated, async ([id, digest]) => {
    await get(`/game-modules/${id}/active.json`, 200, digest);
    proof.unrelatedPointers.push({gameId: id, sha256: digest, preserved: true});
  });
  proof.unrelatedPointers.sort((a, b) => a.gameId.localeCompare(b.gameId));
  proof.effectivePointerCountBefore = effectivePointers.size;
  const oldManifests = new Map();
  for (const [name, digest] of Object.entries(before.program)) {
    if (name.startsWith(`module-dist/${game}/versions/`) && name.endsWith('/manifest.json')) oldManifests.set('/game-modules/' + name.slice('module-dist/'.length), digest);
  }
  for (const [name, digest] of Object.entries(before.moduleFiles)) {
    if (name.startsWith(`/opt/royal-game-modules/${game}/versions/`) && name.endsWith('/manifest.json')) oldManifests.set('/game-modules/' + name.slice('/opt/royal-game-modules/'.length), digest);
  }
  assert(oldManifests.size > 0, 'The production snapshot must identify an earlier Cosmic manifest');
  for (const [path, digest] of oldManifests) {
    await get(path, 200, digest); proof.oldCosmicManifests.push({path, sha256: digest, preserved: true});
  }
  browser = await chromium.launch({channel: 'chrome', headless: true});
  for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport, locale: 'ru-RU', reducedMotion: 'reduce'});
    const errors = [], blockedWrites = [], blockedWebSockets = [], moduleErrors = [];
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (new URL(response.url()).pathname.startsWith(`/game-modules/${game}/`) && response.status() >= 400) moduleErrors.push({path: new URL(response.url()).pathname, status: response.status()});});
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
      if (url.origin !== origin) return route.abort('blockedbyclient');
      if (!['GET', 'HEAD'].includes(request.method())) {
        blockedWrites.push({method: request.method(), path: url.pathname}); return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await context.routeWebSocket('**/*', socket => {blockedWebSockets.push(new URL(socket.url()).pathname); socket.close();});
    const document = await page.goto(origin + '/?offline=1&lang=ru&cosmic-release-verification=' + Date.now(), {waitUntil: 'domcontentloaded', timeout: 60000});
    assert(document.ok()); assert.equal(hash(await document.body()), manifest.files['dist/index.html']);
    await expect(page.locator('#loading')).toHaveCount(0, {timeout: 120000});
    assert.equal(await page.evaluate(() => window.royalDemo.getState().online), false);
    await expect(page.locator('[data-cabinet]')).toHaveCount(12);
    const open = async () => {
      await page.locator('#games-tab').click(); await page.locator(`[data-cabinet="${game}"]`).click();
      await expect(page.locator('.royal-platform')).toBeVisible({timeout: 60000});
      await expect(page.locator('[data-platform-game]')).toHaveCount(12);
      await page.locator(`[data-platform-game="${game}"]`).click();
      await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version', metadata.version, {timeout: 60000});
      await expect(page.locator('[data-cosmic-escape]')).toHaveAttribute('data-asset-state', 'ready', {timeout: 60000});
      await page.locator('[data-lg-dialog-action="enter"]').click();
      await expect(page.locator('[data-lg-spin]')).toBeDisabled();
    };
    await open();
    await page.locator('[data-lg-info]').click(); await expect(page.locator('[data-lg-dialog]')).toHaveAttribute('data-dialog', 'info');
    await page.locator('[data-lg-dialog-action="close"]').click();
    await page.locator('.slot-settings-button').click(); await expect(page.locator('.slot-settings-dialog')).toHaveAttribute('open', '');
    await page.locator('.slot-settings-dialog header button').click();
    assert(await page.locator('#mini-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.locator('#mini-dialog .mini-top [data-close]').click(); await expect(page.locator('#mini-dialog')).toBeHidden();
    await expect(page.locator(`link[data-royal-game-module="${game}"]`)).toHaveCount(0);
    await open(); await expect(page.locator(`link[data-royal-game-module="${game}"]`)).toHaveCount(1);
    await page.screenshot({path: resolve(output, `cosmic-${viewport.width}.png`)});
    assert.deepEqual(errors, []); assert.deepEqual(moduleErrors, []); assert.deepEqual(blockedWrites, []); assert.deepEqual(blockedWebSockets, []);
    assert(!(await context.cookies()).some(cookie => cookie.name === 'royal_session'));
    proof.browser.push({viewport, moduleVersion: metadata.version, actualHost: true, offlineGuest: true, catalogGames: 12,
      artworkReady: true, spinDisabled: true, infoAndSettings: true, closeReopen: true, noHorizontalOverflow: true,
      accountsCreated: 0, attemptedWrites: blockedWrites.length, attemptedWebSockets: blockedWebSockets.length, errors});
    await context.close();
  }
  proof.passed = true;
} catch (error) {
  proof.failure = error.message;
  if (page && !page.isClosed()) await page.screenshot({path: resolve(output, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(proof, null, 2) + '\n'); await browser?.close();
}
console.log(JSON.stringify({passed: true, sourceCommit: manifest.sourceCommit, moduleVersion: proof.cosmic.version,
  unchangedPointers: proof.unrelatedPointers.length, preservedCosmicManifests: proof.oldCosmicManifests.length, viewports: proof.browser.length, output: resolve(output, 'verification.json')}));
