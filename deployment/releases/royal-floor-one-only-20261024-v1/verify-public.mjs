import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const origin=process.env.ROYAL_VERIFY_ORIGIN||'https://stealth-spark-gokmxooi.expresshost.cloud';
const work=resolve('..'),out=resolve(work,'public-proof');await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile(resolve(work,'payload/install-manifest.json'),'utf8'));
const proof={sourceCommit:manifest.sourceCommit,checkedAt:new Date().toISOString(),origin,accountsCreated:0,stakes:0,errors:[],viewports:[],passed:false};
const hash=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({locale:'ru-RU'});const page=await context.newPage();page.on('pageerror',e=>proof.errors.push(e.message));
 await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());return ['GET','HEAD'].includes(r.method())&&u.origin===origin?route.continue():route.abort('blockedbyclient');});
 await context.routeWebSocket('**/*',socket=>socket.close());
 const health=await context.request.get(origin+'/healthz');expect(health.ok()).toBe(true);expect((await health.json()).ok).toBe(true);
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);const response=await page.goto(origin+'/?offline=1&royal-floor-verification='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});expect(response.ok()).toBe(true);expect(hash(await response.body())).toBe(manifest.delta['index.html']);
  await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});await expect(page.locator('[data-cabinet-collection=github]')).toHaveCount(0);await expect(page.locator('[data-cabinet]')).toHaveCount(12);
  await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-cosmic-escape]').click();await expect(page.locator('.royal-platform')).toBeVisible({timeout:30000});await expect(page.locator('[data-platform-game]')).toHaveCount(12);
  const ids=await page.locator('[data-platform-game]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-platform-game')));expect(new Set(ids).size).toBe(12);expect(ids).toContain('studio-neopolis');expect(ids).toContain('royal-plinko');expect(ids).toContain('original-cr-vs-leo');
  await page.screenshot({path:resolve(out,'catalog-'+viewport.width+'.png')});await page.locator('[data-platform-game=studio-neopolis]').click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','studio-neopolis',{timeout:30000});await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game','studio-neopolis');
  expect(await page.locator('#mini-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:resolve(out,'neopolis-'+viewport.width+'.png')});proof.viewports.push({viewport,gameCount:ids.length,neopolisOpened:true});
 }
 expect(proof.errors).toEqual([]);proof.passed=true;
}finally{await writeFile(resolve(out,'verification.json'),JSON.stringify(proof,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(proof));
