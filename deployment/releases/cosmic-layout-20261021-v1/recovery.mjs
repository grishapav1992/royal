import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const proof=process.env.ROYAL_COSMIC_PROOF_DIR || resolve(root,'artifacts/cosmic-layout-publish-20261021');
const packages=resolve(root,'module-dist');
const mime={'.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp'};
const server=await createServer({configFile:false,root,optimizeDeps:{entries:['tests/fixtures/independent-games.html']},server:{host:'127.0.0.1',port:0},plugins:[{
  name:'cosmic-recovery-fixture',configureServer(vite){vite.middlewares.use('/game-modules',async(req,res)=>{
    try {const file=resolve(packages,'.'+new URL(req.url,'http://fixture.test').pathname);if(!file.startsWith(packages+sep))throw Error('Unsafe path');res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
    catch {res.statusCode=404;res.end('Missing module');}
  });},
}]});
await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const sent=[];
  await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'Local fixture'}}));
  await page.route('**/api/demo-wallet',route=>route.fulfill({json:{balance:1000,entries:[]}}));
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{wallet:{balance:1000,entries:[]},sessions:[]}});
    sent.push(route.request().postDataJSON());await route.abort('failed');
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/independent-games.html`);
  await page.waitForFunction(()=>!!window.moduleHarness);
  await page.evaluate(()=>window.moduleHarness.account('cosmic-recovery-fixture'));
  async function open(){
    await page.evaluate(()=>window.moduleHarness.open('studio-cosmic-escape'));
    await page.locator('[data-cosmic-escape][data-asset-state=ready]').waitFor();
    await page.locator('[data-lg-dialog-action=enter]').click();
  }
  await open();await page.locator('[data-lg-spin]').click();
  await expect.poll(()=>sent.length).toBe(1);
  await expect(page.locator('[data-lg-retry]')).toBeVisible();
  const before=await page.evaluate(()=>window.moduleHarness.snapshot());
  expect(before).toMatchObject({sharedWallet:true,sharedExpansion:true,balance:1000,locked:true});
  expect(JSON.parse(before.storage)).toEqual(before.pending);
  await page.evaluate(()=>window.moduleHarness.close());
  await expect(page.locator('link[data-royal-game-module]')).toHaveCount(0);
  await open();
  const reopened=await page.evaluate(()=>window.moduleHarness.snapshot());
  expect(reopened.pending).toEqual(before.pending);expect(reopened.storage).toEqual(before.storage);expect(reopened.locked).toBe(true);
  await page.locator('[data-lg-retry]').click();
  await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);
  await mkdir(proof,{recursive:true});
  await writeFile(resolve(proof,'recovery.json'),JSON.stringify({passed:true,sharedWallet:true,closeReopen:true,pendingRetained:true,retryKeptOperation:true,noBalanceChange:true},null,2));
  console.log('Cosmic module recovery passed');
} finally {await browser.close();await server.close();}
