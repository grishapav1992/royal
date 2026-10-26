// Verify prepared application bytes in the actual host and isolated PostgreSQL.
// Run with node --import tsx; this helper never accepts a remote origin or database.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect, request as playwrightRequest} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import pg from 'pg';
import {temporaryDatabase} from '../../../scripts/database-test.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--manifest', '--output'].includes(process.argv[i]) && process.argv[i + 1], 'Expected --manifest PATH or --output PATH');
  assert(!options.has(process.argv[i]), 'Duplicate option');
  options.set(process.argv[i], process.argv[i + 1]);
}
const manifestPath = resolve(root, options.get('--manifest') || 'module-build/release-manifest.json');
const output = resolve(root, options.get('--output') || 'artifacts/work/cosmic-origin-release/local-host');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const displayedUnits = text => Math.round(Number(text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')) * 100);
const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes);
const sourceCommit = execFileSync(process.env.ROYAL_GIT_BINARY || 'git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
assert.equal(manifest.format, 1);
assert.equal(manifest.scope, 'application', 'Host verification requires a prepared application release');
assert.equal(manifest.sourceCommit, sourceCommit);
assert.equal(manifest.build?.passed, true);
assert(manifest.files && Object.keys(manifest.files).length > 0);
async function verifyBytes() {
  assert.equal(hash(await readFile(manifestPath)), hash(manifestBytes), 'Release manifest changed during verification');
  for (const [name, digest] of Object.entries(manifest.files)) {
    assert(/^(dist|dist-server|module-dist)\//.test(name) && !name.split('/').includes('..'), 'Unexpected release output');
    assert.equal(hash(await readFile(resolve(root, name))), digest, 'Prepared output changed: ' + name);
  }
}
await verifyBytes();
assert(manifest.files['dist/index.html'] && manifest.files['dist-server/index.js']);
const game = 'studio-cosmic-escape', pointerPath = `module-dist/${game}/active.json`;
assert(manifest.files[pointerPath], 'Cosmic pointer must belong to the prepared release');
const pointerBytes = await readFile(resolve(root, pointerPath)), pointer = JSON.parse(pointerBytes);
const packageManifestPath = 'module-dist/' + pointer.manifest.replace(/^\/game-modules\//, '');
const packageManifest = JSON.parse(await readFile(resolve(root, packageManifestPath)));
assert.equal(packageManifest.gameId, game);
await mkdir(output, {recursive: true});
const proof = {format: 1, checkedAt: new Date().toISOString(), sourceCommit, releaseManifestSha256: hash(manifestBytes),
  method: 'Prepared dist and dist-server served by the actual application with actual authenticated HTTP, real Colyseus chat, shared wallet and independent Cosmic module. Fresh temporary local PostgreSQL only. Random outcomes check recovery and accounting, not RTP.',
  preparedIndexSha256: manifest.files['dist/index.html'], preparedBackendSha256: manifest.files['dist-server/index.js'],
  moduleVersion: packageManifest.version, remoteBrowserRequestsBlocked: 0, localSyntheticAccounts: 7, scenarios: [], passed: false};
let database, application, pool, browser, observerApi, host, currentPage, serverOutput = '';
const sleep = ms => new Promise(done => setTimeout(done, ms));
try {
  database = await temporaryDatabase();
  assert.equal(database.env.PGHOST, '127.0.0.1');
  pool = new pg.Pool({host: database.env.PGHOST, port: Number(database.env.PGPORT), database: database.env.PGDATABASE,
    user: database.env.PGUSER, password: database.env.PGPASSWORD, max: 2});
  const probe = createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const origin = `http://127.0.0.1:${port}`, schema = 'cosmic_release_' + randomUUID().replaceAll('-', '');
  application = spawn(process.execPath, ['dist-server/index.js'], {cwd: root,
    env: {PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...database.env, AUTH_DB_PATH: schema,
      PORT: String(port), CODEX_SALE_API_KEY: '', PAYMENTS_SERVICE_URL: '', PAYMENTS_REQUEST_SECRET: '', PAYMENTS_EVENT_SECRET: ''},
    stdio: ['ignore', 'pipe', 'pipe']});
  application.stdout.on('data', data => {serverOutput = (serverOutput + data).slice(-12000);});
  application.stderr.on('data', data => {serverOutput = (serverOutput + data).slice(-12000);});
  await expect.poll(async () => {
    assert.equal(application.exitCode, null, 'Prepared backend exited: ' + serverOutput);
    try { return (await fetch(origin + '/healthz')).status; } catch { return 0; }
  }, {timeout: 30000}).toBe(200);
  const indexResponse = await fetch(origin + '/');
  assert.equal(hash(Buffer.from(await indexResponse.arrayBuffer())), manifest.files['dist/index.html']);
  assert.equal(hash(Buffer.from(await (await fetch(origin + pointer.manifest)).arrayBuffer())), pointer.sha256);
  assert.equal(hash(Buffer.from(await (await fetch(origin + '/game-modules/' + game + '/active.json')).arrayBuffer())), hash(pointerBytes), 'A local override replaced the prepared Cosmic package');
  const rows = async (sql, values = []) => (await pool.query(sql.replaceAll('$SCHEMA', '"' + schema + '"'), values)).rows;
  const ledger = async account => rows('SELECT entry_type,count(*)::int AS count,sum(amount_units)::text AS units FROM $SCHEMA.demo_ledger WHERE account_id=$1 AND source=$2 GROUP BY entry_type ORDER BY entry_type', [account, game]);
  const stored = async (account, id) => JSON.parse((await rows('SELECT payload FROM $SCHEMA.demo_casino_sessions WHERE account_id=$1 AND id=$2', [account, id]))[0].payload);
  browser = await chromium.launch({channel: 'chrome', headless: true});
  observerApi = await playwrightRequest.newContext({baseURL: origin});
  const observerLogin = await observerApi.post('/api/auth/login', {data: {email: `cosmic-observer-${randomUUID()}@example.test`, password: 'Cosmic-local-verification-123!'}});
  assert(observerLogin.ok());
  assert((await observerApi.post('/api/auth/character', {data: {skin: 0}})).ok());
  host = await new Client(origin, {headers: {Cookie: observerLogin.headers()['set-cookie'].split(';')[0]}}).create('lobby');
  const observedMessages = [];
  host.onMessage('*', () => {});
  host.onMessage('chat', message => observedMessages.push(message.text));

  for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
    for (const mode of [{id: 'cosmic-chaos', cost: 40, spins: 10}, {id: 'ufo-invasion', cost: 75, spins: 12}, {id: 'deep-echo', cost: 135, spins: 15}]) {
      const name = `${mode.id}-${viewport.width}`, errors = [], operations = [], stake = 100, deposit = 1000;
      const context = await browser.newContext({baseURL: origin, viewport, reducedMotion: 'reduce', locale: 'ru-RU'});
      const page = await context.newPage();
      currentPage = page;
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
          proof.remoteBrowserRequestsBlocked++; return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      let pauseFirstMove = true, droppedFinal = false;
      await context.route('**/api/demo-wallet/expansion', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const input = route.request().postDataJSON(), response = await route.fetch();
        assert.equal(response.status(), 200, JSON.stringify(input));
        const body = await response.json();
        operations.push({input, body, dropped: false});
        if (input.action === 'move' && pauseFirstMove) {
          pauseFirstMove = false;
          await page.locator('[data-lg-pause]').click();
        }
        if (input.action === 'move' && body.session?.state === 'settled' && !droppedFinal) {
          droppedFinal = true; operations.at(-1).dropped = true;
          await route.abort('failed'); return;
        }
        await route.fulfill({response});
      });
      const login = await page.request.post('/api/auth/login', {data: {email: `cosmic-host-${randomUUID()}@example.test`, password: 'Cosmic-local-verification-123!'}});
      assert(login.ok()); const account = (await login.json()).account.id;
      assert((await page.request.post('/api/auth/character', {data: {skin: 0}})).ok());
      const headers = {'X-Royal-Account-Id': account};
      const expansion = async () => {
        const response = await page.request.get('/api/demo-wallet/expansion', {headers});
        assert(response.ok()); return response.json();
      };
      const wallet = async () => {
        const response = await page.request.get('/api/demo-wallet', {headers});
        assert(response.ok()); return response.json();
      };
      const round = async () => (await expansion()).sessions.find(session => session.gameId === game);
      await page.goto(`/?room=${host.roomId}&lang=ru`);
      await expect(page.locator('#loading')).toHaveCount(0, {timeout: 90000});
      await expect(page.locator('#join-dialog')).toBeHidden();
      await expect.poll(() => page.evaluate(() => window.royalDemo.getState().online)).toBe(true);
      await page.getByRole('button', {name: 'Открыть демокошелёк'}).click();
      await page.locator('#wallet-amount').fill(String(deposit));
      await page.getByRole('button', {name: 'Пополнить баланс', exact: true}).click();
      await expect.poll(async () => (await wallet()).balance).toBe(deposit);
      await page.getByRole('button', {name: 'Закрыть кошелёк'}).click();
      const open = async () => {
        if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click();
        await page.locator('#games-tab').click();
        await page.locator(`[data-cabinet="${game}"]`).click();
        await expect(page.locator('#mini-dialog')).toBeVisible({timeout: 45000});
        if (await page.locator('.royal-platform').isVisible()) await page.locator(`[data-platform-game="${game}"]`).click();
        await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version', packageManifest.version);
        await expect(page.locator('[data-cosmic-escape]')).toHaveAttribute('data-asset-state', 'ready', {timeout: 60000});
        await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
        await expect(page.locator('#chat-input')).toBeInViewport();
      };
      const close = async () => {
        await page.locator('#mini-dialog .mini-top [data-close]').click();
        await expect(page.locator('#mini-dialog')).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.royalDemo.getState().cabinet)).toBe('');
      };
      const stable = () => expect(page.locator('[data-cosmic-escape]')).toHaveAttribute('aria-busy', 'false');
      await open();
      const greeting = `Привет из локальной проверки ${name}`;
      await page.locator('#chat-input').fill(greeting); await page.locator('#send-chat').click();
      await expect(page.locator('#chat-log')).toContainText(greeting);
      await expect.poll(() => observedMessages.includes(greeting)).toBe(true);
      const reply = `Локальный ответ ${name}`; host.send('chat', reply);
      await expect(page.locator('#chat-log')).toContainText(reply);
      await page.locator('[data-lg-dialog-action="enter"]').click();
      await page.locator('[data-lg-stake]').selectOption(String(stake));
      await page.locator('[data-cosmic-missions]').click();
      await page.locator(`[data-lg-dialog-action="mission:${mode.id}"]`).click();
      const displayedCost = await page.locator('.ce-confirm strong').textContent();
      const parsedCost = displayedUnits(displayedCost);
      assert.equal(parsedCost, stake * mode.cost);
      await page.locator('[data-lg-dialog-action="buy"]').click();
      await stable();
      const initial = await round();
      assert.equal(initial.state, 'active'); assert.equal(initial.spentUnits, String(stake * mode.cost));
      assert.equal(initial.view.luelon.bonus.awarded, mode.spins); assert.equal(initial.view.luelon.bonus.played, 0);
      assert.equal((await wallet()).balance, deposit - stake * mode.cost / 100);
      assert.equal(displayedUnits(await page.locator('[data-lg-balance]').textContent()), deposit * 100 - stake * mode.cost);
      await page.locator('[data-lg-dialog-action="bonus"]').click();
      await expect.poll(async () => (await round()).view.luelon.bonus.played).toBe(1);
      await stable();
      const partial = await round(), partialLedger = await ledger(account), beforeReopen = operations.length;
      assert.equal(partial.state, 'active'); assert.equal(partial.view.luelon.bonus.played, 1);
      assert.equal((await wallet()).balance, deposit - stake * mode.cost / 100);
      assert.equal(displayedUnits(await page.locator('[data-lg-balance]').textContent()), deposit * 100 - stake * mode.cost);
      await page.screenshot({path: resolve(output, name + '-partial.png')});
      await close(); await open();
      assert.deepEqual(await round(), partial); assert.equal(operations.length, beforeReopen);
      assert.deepEqual(await ledger(account), partialLedger);
      await page.reload();
      await expect(page.locator('#loading')).toHaveCount(0, {timeout: 90000});
      await expect(page.locator('#join-dialog')).toBeHidden();
      if (!await page.locator('#mini-dialog').isVisible()) await open();
      await expect(page.locator('[data-cosmic-escape]')).toHaveAttribute('data-asset-state', 'ready');
      assert.deepEqual(await round(), partial); assert.equal(operations.length, beforeReopen);
      await expect(page.locator('#chat-input')).toBeInViewport();
      await expect(page.locator('[data-lg-stake]')).toHaveValue(String(stake));
      await expect(page.locator('[data-lg-cost]')).toContainText('бесплатно');
      await page.locator('[data-lg-dialog-action="enter"]').click();
      await expect.poll(() => droppedFinal, {timeout: 90000}).toBe(true);
      await stable();
      await expect(page.locator('[data-lg-retry]')).toBeVisible();
      const final = await round(), finalLedger = await ledger(account), acceptedFinal = operations.at(-1);
      assert.equal(final.state, 'settled');
      const finalBalance = deposit - stake * mode.cost / 100 + Number(final.returnedUnits) / 100;
      assert.equal((await wallet()).balance, finalBalance);
      const played = final.view.luelon.history.filter(spin => spin.kind === 'free-spin').length;
      assert(played >= 1 && played <= mode.spins);
      if (played < mode.spins) assert.equal(final.returnedUnits, String(stake * 10000), 'Only the full-round win cap may shorten a purchased bonus');
      assert.deepEqual(finalLedger, [{entry_type: 'bet', count: 1, units: String(-stake * mode.cost)}, {entry_type: 'win', count: 1, units: final.returnedUnits}]);
      const savedPending = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('royal-expansion:')));
      assert(savedPending, 'Committed final response must remain pending in browser storage');
      assert.deepEqual(JSON.parse(savedPending[1]), acceptedFinal.input);
      await close(); await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden(); await open();
      await page.locator('[data-lg-dialog-action="enter"]').click();
      await expect(page.locator('[data-lg-retry]')).toBeEnabled();
      assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), savedPending[0]), acceptedFinal.input);
      await page.locator('[data-lg-retry]').click(); await stable();
      await expect(page.locator('[data-lg-retry]')).toBeHidden();
      assert.deepEqual(operations.at(-1).input, acceptedFinal.input); assert.equal(operations.at(-1).body.replayed, true);
      assert.deepEqual(await ledger(account), finalLedger); assert.equal((await wallet()).balance, finalBalance);
      assert.deepEqual(await round(), final);
      const saved = await stored(account, final.id);
      assert.equal(saved.mathProfileVersion, 3);
      assert.equal(saved.state, 'settled');
      assert.equal((await rows('SELECT reserved_units::text AS units FROM $SCHEMA.demo_casino_sessions WHERE account_id=$1 AND id=$2', [account, final.id]))[0].units, '0');
      await expect.poll(async () => Number(await page.locator('[data-lg-total]').getAttribute('data-units'))).toBe(Number(final.returnedUnits));
      await expect.poll(async () => displayedUnits(await page.locator('[data-lg-balance]').textContent())).toBe(Math.round(finalBalance * 100));
      await page.locator('#chat-input').fill('Черновик локальной проверки');
      await close(); await expect(page.locator('#chat-input')).toHaveValue('Черновик локальной проверки'); await open();
      await expect(page.locator('#chat-input')).toBeInViewport();
      await expect(page.locator('#chat-input')).toHaveValue('Черновик локальной проверки');
      assert.deepEqual(await ledger(account), finalLedger); assert.equal((await wallet()).balance, finalBalance);
      assert(operations.filter(item => item.input.action === 'move').every(item => !('stakeUnits' in item.input) && !('settings' in item.input)));
      assert.equal(operations.filter(item => item.input.action === 'start').length, 1);
      assert.equal(operations.filter(item => !item.body.replayed && item.input.action === 'move').length, played);
      for (const operation of operations) {
        assert.equal(operation.body.session.spentUnits, String(stake * mode.cost));
        assert.equal(operation.body.wallet.balance, deposit - stake * mode.cost / 100 + (operation.body.session.state === 'settled' ? Number(operation.body.session.returnedUnits) / 100 : 0));
      }
      assert.deepEqual(errors, []);
      assert(await page.locator('#mini-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({path: resolve(output, name + '-recovered.png')});
      proof.scenarios.push({name, viewport, mode: mode.id, stakeUnits: stake, displayedPurchaseCostUnits: parsedCost,
        spentUnits: Number(final.spentUnits), returnedUnits: Number(final.returnedUnits), finalBalance, displayedFinalBalance: await page.locator('[data-lg-balance]').textContent(),
        awardedSpins: mode.spins, completedSpins: played,
        actualHost: true, connectedChat: true, bidirectionalLocalChat: true, partialCloseReopen: true,
        partialPageReload: true, lostFinalResponse: true, finalPendingSurvivedReload: true,
        finalReplaySameOperation: true, oneDebitAndOneCredit: true, settledReopenNoLedgerChange: true,
        sharedComposerDraftRetained: true, moduleVersion: packageManifest.version, errors});
      console.log(JSON.stringify({name, passed: true, spentUnits: final.spentUnits, returnedUnits: final.returnedUnits}));
      await context.close();
    }
  }
  await verifyBytes();
  assert.equal(proof.scenarios.length, 6); proof.passed = true;
} catch (error) {
  proof.failure = error.message;
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({path: resolve(output, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(proof, null, 2) + '\n');
  await Promise.race([host?.leave().catch(() => {}), sleep(3000)]); await observerApi?.dispose(); await browser?.close(); await pool?.end();
  if (application && application.exitCode === null) {
    const exited = once(application, 'exit'); application.kill('SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    if (application.exitCode === null) {application.kill('SIGKILL'); await exited;}
  }
  await database?.cleanup();
}
console.log(JSON.stringify({passed: proof.scenarios.length, output: resolve(output, 'verification.json')}));
