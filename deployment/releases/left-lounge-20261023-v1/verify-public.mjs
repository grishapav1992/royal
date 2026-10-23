import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin=process.env.ROYAL_VERIFY_ORIGIN||'https://stealth-spark-gokmxooi.expresshost.cloud';
const out=resolve(process.env.ROYAL_VERIFY_OUTPUT||'artifacts/work/left-lounge/public-proof');await mkdir(out,{recursive:true});
const proof={origin,passed:false,productionWrites:0,productionWebSockets:0,errors:[],viewports:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,locale:'ru-RU'});const page=await context.newPage();page.on('pageerror',e=>proof.errors.push(e.message));
  await context.route('**/*',r=>{const req=r.request(),u=new URL(req.url());if(!['http:','https:'].includes(u.protocol))return r.continue();if(u.origin!==origin||!['GET','HEAD'].includes(req.method()))return r.abort('blockedbyclient');if(u.pathname.startsWith('/api/'))return r.fulfill({json:{account:null,games:[]}});return r.continue();});
  await context.routeWebSocket('**/*',socket=>socket.close());
  const response=await page.goto(origin+'/?offline=1&lounge-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});expect(response.ok()).toBe(true);await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});
  const state=()=>page.evaluate(()=>window.royalDemo.getState());
  await page.locator('#room-overview').click();
  await page.waitForFunction(()=>{const key=JSON.stringify(window.royalDemo.getState().view),now=performance.now(),last=window.__loungeView;if(!last||last.key!==key){window.__loungeView={key,at:now};return false;}return now-last.at>=150;});
  async function point(x,y){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const box=await page.locator('#game canvas').boundingBox();const {view}=await state();await page.mouse.click(box.x+(x-view.x)*view.zoom*box.width/view.width,box.y+(y-view.y)*view.zoom*box.height/view.height);}
  await point(272,442);await expect(page.locator('#bar-dialog')).toBeVisible({timeout:18000});const at=await state();expect(at.x).toBeLessThan(405);expect(at.y).toBeGreaterThanOrEqual(515);await page.locator('#bar-dialog [data-close]').click();
  for(const [id,x] of [['arcade-lounge',320],['arcade-lounge-2',720]]){
   await point(x,932);await expect.poll(async()=>(await state()).seat,{timeout:20000}).toBe(id);
   await page.locator('#game').focus();await page.keyboard.down('ArrowDown');await page.waitForTimeout(180);await page.keyboard.up('ArrowDown');await expect.poll(async()=>(await state()).seat).toBe('');
  }
  expect(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:resolve(out,viewport.width>500?'desktop.png':'mobile.png')});proof.viewports.push({...viewport,bar:true,sofas:2,overflow:false});await context.close();
 }
 expect(proof.errors).toEqual([]);proof.passed=true;
}finally{await writeFile(resolve(out,'verification.json'),JSON.stringify(proof,null,2)+'\n');await browser.close();}
