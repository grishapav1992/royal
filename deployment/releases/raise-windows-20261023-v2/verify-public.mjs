import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const out=resolve(process.env.ROYAL_VERIFY_OUTPUT||'artifacts/work/raise-windows/public-proof');await mkdir(out,{recursive:true});
const proof={passed:false,productionWrites:0,productionWebSockets:0,errors:[],viewports:[]};
const response=await fetch(origin+'/healthz',{cache:'no-store',signal:AbortSignal.timeout(30000)});expect(response.ok).toBe(true);expect((await response.json()).ok).toBe(true);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 const context=await browser.newContext({viewport,locale:'ru-RU'});const page=await context.newPage();page.on('pageerror',e=>proof.errors.push(e.message));
 await context.route('**/*',r=>{const req=r.request(),url=new URL(req.url());if(!['http:','https:'].includes(url.protocol))return r.continue();if(url.origin!==origin||!['GET','HEAD'].includes(req.method()))return r.abort('blockedbyclient');if(url.pathname.startsWith('/api/'))return r.fulfill({json:{account:null,games:[]}});return r.continue();});await context.routeWebSocket('**/*',socket=>socket.close());
 const result=await page.goto(origin+'/?offline=1&windows-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});expect(result.ok()).toBe(true);await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});await page.locator('#room-overview').click();
 await page.waitForFunction(()=>{const key=JSON.stringify(window.royalDemo.getState().view),now=performance.now(),last=window.__windowView;if(!last||last.key!==key){window.__windowView={key,at:now};return false;}return now-last.at>=150;});
 const cat=await page.evaluate(()=>window.royalDemo.getState().cat);if(cat.onPillow)expect(cat.y).toBe(89);
 expect(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(out,viewport.width>500?'desktop.png':'mobile.png')});proof.viewports.push({...viewport,catOnPillow:cat.onPillow,catY:cat.y,overflow:false});await context.close();
}expect(proof.errors).toEqual([]);proof.passed=true;}finally{await browser.close();await writeFile(resolve(out,'verification.json'),JSON.stringify(proof,null,2)+'\n');}
