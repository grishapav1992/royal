import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const proof = process.env.ROYAL_COSMIC_PROOF_DIR || resolve(root, 'artifacts/cosmic-layout-publish-20261021');
const candidate = process.argv.includes('--candidate');
const expected = process.env.ROYAL_COSMIC_VERSION || '1.0.0-3277b369c29d';
const origin = 'https://stealth-spark-gokmxooi.expresshost.cloud';
const packageRoot = resolve(root, 'module-dist/studio-cosmic-escape');
const mime = {'.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp'};
// The public guest hall intentionally has no network chat. Exercise its actual
// game window with the unchanged production chat-layout function and an empty
// local dock, without creating an account or joining a production room.
const chatSource = (await readFile(resolve(root,'src/ui/GameChat.ts'),'utf8')).replace("import './game-chat.css';",'');
const chatLayout = (await transform(chatSource,{loader:'ts',format:'iife',globalName:'__cosmicChatLayout'})).code;
await mkdir(proof,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const checks = [];
try {
  for (const [width,height,lang] of [[1920,1080,'ru'],[1366,768,'en'],[390,844,'ru']]) {
    const page = await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
    const errors = [], posts = [], loaded = [];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()==='POST' && r.url().includes('/api/demo-wallet')) posts.push(r.url());});
    page.on('response',r=>{if(r.url().includes('/game-modules/studio-cosmic-escape/')) loaded.push({url:r.url(),status:r.status()});});
    if (candidate) await page.route('**/game-modules/studio-cosmic-escape/**',async route=>{
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/studio-cosmic-escape/')[1]);
      const file = resolve(packageRoot,name);
      if (!file.startsWith(packageRoot+sep)) throw Error('Unsafe candidate path');
      await route.fulfill({contentType:mime[extname(file)],body:await readFile(file)});
    });
    await page.goto(`${origin}/?offline=1&lang=${lang}`);
    await page.locator('#loading').waitFor({state:'detached',timeout:90000});
    await page.addScriptTag({content:chatLayout});
    await page.addStyleTag({content:'body > #club-chat-dock { display: none; }'});
    await page.evaluate(()=>{
      const dock=document.createElement('aside');
      dock.innerHTML='<section class="chat-panel"><div class="chat-heading"><strong>Общий чат</strong></div><div class="chat-log"></div></section>';
      document.body.append(dock);
      window.__cosmicChatLayout.installGameChat(dock,document.querySelector('#mini-dialog'));
    });
    async function open() {
      if (!await page.locator('[data-studio="studio-cosmic-escape"]').isVisible()) await page.locator('#games-tab').click();
      await page.locator('[data-studio="studio-cosmic-escape"]').click();
      await page.locator('#mini-dialog[open]').waitFor({timeout:60000});
      await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version',expected,{timeout:60000});
      await page.locator('[data-cosmic-escape][data-asset-state=ready]').waitFor({timeout:60000});
      await page.locator('[data-lg-dialog-action=enter]').click();
    }
    await open();
    await expect(page.locator('#mini-dialog')).toHaveClass(/game-chat-layout/);
    await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
    await expect(page.locator('[data-lg-spin]')).toBeDisabled();
    const metrics = await page.evaluate(()=>{
      const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
      const stage=document.querySelector('.mini-stage');
      return {mode:document.querySelector('#mini-dialog').dataset.gameViewport,board:rect('.ce-metal-frame'),panel:rect('.ce-console'),results:rect('.ce-results'),chat:rect('#club-chat-dock'),overflow:stage.scrollWidth-stage.clientWidth};
    });
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    if(metrics.mode==='layout') {
      expect(metrics.board.width).toBeLessThanOrEqual(861);
      expect(metrics.panel.width).toBeLessThanOrEqual(1041);
      expect(metrics.board.bottom).toBeLessThanOrEqual(metrics.results.top+1);
    }
    await page.locator('[data-lg-info]').click();
    await expect(page.locator('[data-lg-dialog]')).toHaveAttribute('data-dialog','info');
    await page.locator('[data-lg-dialog-action=close]').click();
    await page.locator('.slot-settings-button').click();
    await expect(page.locator('.slot-settings-dialog')).toHaveAttribute('open','');
    await page.locator('.slot-settings-dialog header button').click();
    await page.locator('#mini-dialog > .game-chat-game > .mini-top [data-close]').click();
    await expect(page.locator('link[data-royal-game-module="studio-cosmic-escape"]')).toHaveCount(0);
    await open();
    await expect(page.locator('link[data-royal-game-module="studio-cosmic-escape"]')).toHaveCount(1);
    await page.screenshot({path:resolve(proof,`${candidate?'candidate':'published'}-${width}x${height}-${lang}.png`),fullPage:true});
    expect(errors).toEqual([]);
    expect(posts).toEqual([]);
    expect(loaded.every(r=>r.status===200)).toBe(true);
    checks.push({width,height,lang,version:expected,metrics,errors,posts,resources:loaded.length,closeReopen:true,guestOffline:true,chatLayout:'unchanged production installGameChat with empty local dock'});
    console.log(JSON.stringify({width,height,lang,candidate,passed:true,mode:metrics.mode}));
    await page.close();
  }
} finally {await browser.close();}
await writeFile(resolve(proof,candidate?'candidate-browser.json':'public-browser.json'),JSON.stringify(checks,null,2));
