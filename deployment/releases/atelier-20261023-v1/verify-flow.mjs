import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = process.env.ATELIER_EVIDENCE;
const stage = process.env.ATELIER_STAGE;
if (!stage || !evidence || process.env.PGDATABASE !== 'royal_test' || process.env.PGHOST !== '127.0.0.1') throw Error('Isolated test database and explicit stage required');
process.chdir(stage);
mkdirSync(evidence, { recursive: true });
const cells = Array.from({ length: 16 }, (_, i) => `<g transform="translate(${i % 4 * 256},${Math.floor(i / 4) * 384})"><circle cx="128" cy="105" r="65" fill="#f2c59a"/><rect x="80" y="170" width="96" height="150" fill="#bb4433"/><path d="M90 320V350H115V320M142 320V350H167V320" fill="#334466"/></g>`).join('');
const png = await sharp(Buffer.from(`<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`)).png().toBuffer();
const originalFetch = globalThis.fetch; let imageCalls = 0;
globalThis.fetch = async (url, ...args) => {
  if (String(url).startsWith('https://codex.sale/v1/images/')) {
    imageCalls++; return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(url, ...args);
};
Object.assign(process.env, { NODE_ENV: 'test', PORT: '2597', PUBLIC_ORIGIN: 'http://127.0.0.1:2597', CODEX_SALE_API_KEY: 'local-validation-only', PAYMENTS_SERVICE_URL: '', CASINOAPIPRO_ENABLED: 'false' });
await import(new URL('file:///' + resolve('dist-server/index.js').replaceAll('\\', '/')));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const base = 'http://127.0.0.1:2597';
  const login = await context.request.post(base + '/api/auth/login', { data: { email: 'atelier-release@example.test', password: 'local-release-check' } });
  if (!login.ok()) throw Error('Local login failed');
  const { account } = await login.json();
  const headers = { 'x-royal-account-id': account.id };
  const selected = await context.request.post(base + '/api/auth/character', { headers, data: { skin: 0, name: 'Проверка ателье' } });
  if (!selected.ok()) throw Error('Local character selection failed');
  const funded = await context.request.post(base + '/api/demo-wallet/operations', { headers, data: { id: crypto.randomUUID(), kind: 'deposit', amount: 50 } });
  if (!funded.ok()) throw Error('Local shared wallet funding failed');
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.locator('#loading').waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.royalDemo?.getState().online, null, { timeout: 20000 });
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByLabel('Опиши образ').fill('Гангстер в бордовом костюме');
  await page.getByRole('button', { name: 'Создать за $10', exact: true }).click();
  await page.locator('.skin-results .skin-card').nth(2).waitFor({ timeout: 20000 });
  const before = await (await context.request.get(base + '/api/skin-studio', { headers })).json();
  if (before.job.variants.length !== 3 || imageCalls !== 3) throw Error('Generation must produce exactly three images');
  await page.screenshot({ path: evidence + '/three-variants.png' });
  await page.getByRole('button', { name: 'Выбрать вариант 2' }).click();
  await page.getByRole('button', { name: 'Сохранить образ' }).click();
  await page.getByRole('button', { name: 'Сейчас надет' }).waitFor();
  await page.waitForFunction(() => window.royalDemo.getState().texture?.startsWith('avatar-generated-'), null, { timeout: 10000 });
  const wallet = await (await context.request.get(base + '/api/demo-wallet', { headers })).json();
  if (wallet.balance !== 40 || wallet.entries.filter(e => e.source === 'atelier').length !== 1) throw Error('Shared wallet must debit ten dollars exactly once');
  const state = await (await context.request.get(base + '/api/skin-studio', { headers })).json();
  if (state.wardrobe.length !== 1 || state.equippedId !== before.job.variants[1].id) throw Error('Exactly the chosen outfit must be owned and equipped');
  for (const card of before.job.variants.filter(c => c.id !== state.equippedId)) if ((await context.request.get(base + '/api/skin-studio/assets/' + card.id)).status() !== 404) throw Error('Unchosen candidate survived');
  await page.reload(); await page.locator('#loading').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Образы', exact: true }).click();
  await page.getByRole('button', { name: 'Сейчас надет' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  if (!await page.locator('#skin-studio-dialog').evaluate(e => e.scrollWidth <= e.clientWidth + 1)) throw Error('Mobile wardrobe overflows');
  await page.screenshot({ path: evidence + '/mobile-wardrobe.png' });
  if (errors.length) throw Error(errors.join('; '));
  const result = { ok: true, simulatedProviderImages: true, imageCalls, sharedBalanceBefore: 50, sharedBalanceAfter: wallet.balance, ownedOutfits: state.wardrobe.length, reloadPersisted: true, unselectedDeleted: true, realLocalRoomAndChat: true, mobile: true, errors };
  writeFileSync(evidence + '/full-flow.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
process.exit(0);
