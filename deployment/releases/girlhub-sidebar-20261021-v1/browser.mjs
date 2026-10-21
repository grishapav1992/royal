import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const directory = resolve('deployment/releases/girlhub-sidebar-20261021-v1');
const override = process.env.ROYAL_GIRLHUB_OVERRIDE === '1';
const origin = 'https://stealth-spark-gokmxooi.expresshost.cloud';
const moduleRoot = resolve('module-dist/studio-afterglow');
const pointer = JSON.parse(await readFile(resolve(moduleRoot, 'active.json')));
const expectedVersion = pointer.manifest.split('/')[4];
const proof = resolve('artifacts/girlhub-sidebar-release/proof');
await mkdir(proof, { recursive: true });
// Use the existing host's chat installer and styles in the real offline hall.
// The empty chat panel permits geometry checks without creating an account or sending messages.
const chatSource = (await readFile('src/ui/GameChat.ts', 'utf8')).replace("import './game-chat.css';", '');
const chat = (await build({ stdin: { contents: chatSource, loader: 'ts' }, write: false, format: 'iife', globalName: 'GirlhubChatVerification' })).outputFiles[0].text;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
 for (const [width, height] of [[2193,1259],[1366,768],[390,844]]) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const errors = [], missing = [];
  let posts = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/game-modules/studio-afterglow/') && response.status() >= 400) missing.push(response.url()); });
  await page.route('**/api/**', async route => {
   if (route.request().method() === 'POST') { posts++; return route.abort(); }
   return route.continue();
  });
  if (override) await page.route('**/game-modules/studio-afterglow/**', async route => {
   const path = new URL(route.request().url()).pathname.slice('/game-modules/studio-afterglow/'.length);
   const file = resolve(moduleRoot, path);
   if (!file.startsWith(moduleRoot + sep)) throw Error('Unsafe module path');
   const type = { '.json':'application/json', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.mp3':'audio/mpeg' }[extname(file)];
   await route.fulfill({ contentType: type, body: await readFile(file) });
  });
  try {
   await page.goto(origin + '/?offline=1&lang=ru', { waitUntil: 'domcontentloaded' });
   await page.locator('#games-tab').waitFor({ timeout: 60000 });
   await page.addScriptTag({ content: chat });
   await page.evaluate(() => {
    const dock = document.createElement('aside'); dock.className = 'chat-dock';
    dock.innerHTML = '<section class="chat-panel" id="chat-panel"><div class="chat-heading"><strong>Общий чат</strong><span>0 / 30</span></div><div class="people-list"></div><div class="chat-log" role="log"></div><form class="chat-form"><input placeholder="Напиши что-нибудь…" disabled><button disabled>↵</button></form></section>';
    document.querySelector('.workspace').append(dock);
    document.querySelector('.workspace').classList.add('with-chat');
    window.GirlhubChatVerification.installGameChat(dock, document.querySelector('#mini-dialog'));
   });
   const open = async () => {
    await page.locator('#games-tab').click();
    await page.locator('[data-studio="studio-afterglow"]').click();
    await page.locator('[data-afterglow-game][data-asset-state="ready"]').waitFor({ timeout: 60000 });
    await page.locator('[data-cc-action="enter"]').click();
    await page.locator('#mini-dialog.game-chat-layout #club-chat-dock').waitFor();
   };
   await open();
   const metrics = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const stage = document.querySelector('.mini-stage');
    return { version: document.querySelector('#mini-game').dataset.gameModuleVersion,
     mode: document.querySelector('#mini-dialog').dataset.gameViewport,
     panel: rect('.cc-energy'), results: rect('.cc-results'), chat: rect('#club-chat-dock'),
     stage: rect('.mini-stage'), horizontalOverflow: stage.scrollWidth - stage.clientWidth,
     cards: [...document.querySelectorAll('.cc-energy>div')].map(card => ({
      className: card.className, height: card.getBoundingClientRect().height,
      children: [...card.children].map(child => ({ overflow: child.scrollWidth - child.clientWidth }))
     })) };
   });
   if (metrics.version !== expectedVersion || metrics.horizontalOverflow > 1) throw Error('Wrong module or horizontal overflow');
   if (metrics.mode === 'layout' && metrics.panel.bottom > metrics.results.top + 1) throw Error('Sidebar overlaps results');
   if (metrics.chat.bottom > height + 1 || metrics.chat.right > width + 1) throw Error('Chat escapes the host window');
   if (metrics.cards.some(card => card.children.some(child => child.overflow > 1))) throw Error('Sidebar content overflows');
   await page.screenshot({path: resolve(proof, `${override ? 'candidate' : 'public'}-${width}.png`)});
   await page.locator('#mini-dialog .mini-top [data-close]').click();
   if (await page.locator('link[data-royal-game-module="studio-afterglow"]').count()) throw Error('Module styles remained after close');
   await open();
   if (await page.locator('#mini-game').getAttribute('data-game-module-version') !== expectedVersion) throw Error('Reopened game has the wrong version');
   if (errors.length || missing.length || posts) throw Error(JSON.stringify({ errors, missing, posts }));
   results.push({ width, height, override, chat: 'shared host installer with an empty panel; no online session', reopened: true, posts, errors, missing, metrics });
   console.log(JSON.stringify({width,height,version:metrics.version,mode:metrics.mode,reopened:true,errors}));
  } finally { await page.close(); }
 }
} finally { await browser.close(); }
await writeFile(resolve(directory, override ? 'candidate-browser.json' : 'public-browser.json'), JSON.stringify(results, null, 2) + '\n');
