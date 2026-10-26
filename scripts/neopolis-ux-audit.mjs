import {chromium,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {neopolisPaytable} from '../src/shared/neopolis.ts';
import {sourceDigest} from './game-math/rtp-gate.mjs';
const base=process.env.NEOPOLIS_AUDIT_BASE_URL||'http://127.0.0.1:5227',folder='artifacts/work/neopolis-boss-audit';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname)&&new URL(base).protocol==='http:','Use only an isolated local preview');
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checkedAt:new Date().toISOString(),scope:'Isolated temporary database and virtual wallet only',uiSourceSha256:sourceDigest(await readFile(new URL('../games/neopolis/NeopolisUI.ts',import.meta.url))),languages:[]};
try{
 for(const lang of ['ru','en']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const login=await context.request.post(base+'/api/auth/login',{data:{email:'neopolis-zero-'+randomUUID()+'@example.test',password:randomUUID()+'!'}});assert(login.ok());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/tests/fixtures/neopolis-preview.html?lang='+lang);
  const spin=page.locator('[data-np=spin]');await expect(spin).toBeVisible({timeout:30000});
  await page.waitForFunction(()=>{const c=window.neopolisPreview?.client;return c&&!c.loading&&!c.busy;});
  assert.equal(await page.evaluate(()=>window.neopolisPreview.wallet.wallet.balance),0);
  const spinEnabledAtZero=await spin.isEnabled();let paidRequests=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/demo-wallet/expansion'))paidRequests++;});
  await spin.click();const zeroBalanceMessage=await page.locator('[data-np=status]').innerText();
  assert.equal(paidRequests,0);
  await page.locator('[data-np=rules]').click();
  const displayed=await page.locator('.np-dialog tbody td').allTextContents();
  const exact=neopolisPaytable(3).flat(),mismatches=[];
  displayed.forEach((text,index)=>{const value=Number(text.replace('×','').replace(',','.'));if(Math.abs(value-exact[index])>1e-9)mismatches.push({coefficient:index,expected:exact[index],displayed:text});});
  await page.screenshot({path:folder+'/paytable-'+lang+'.png'});await page.locator('[data-np=close]').click();
  const controls=await page.locator('.np button,.np input,.np select').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,label:node.getAttribute('aria-label')||node.textContent,role:node.getAttribute('data-np')})));
  await page.setViewportSize({width:390,height:844});
  await page.locator('.np').evaluate(root=>{root.scrollTop=0;});
  const mobile=await page.locator('.np').evaluate(root=>{
   const r=root.getBoundingClientRect(),b=root.querySelector('[data-np=spin]').getBoundingClientRect();
   return {height:root.clientHeight,scrollHeight:root.scrollHeight,spinTop:b.top-root.getBoundingClientRect().top,spinInitiallyWithinGameViewport:b.top>=r.top&&b.bottom<=r.bottom};
  });
  await spin.scrollIntoViewIfNeeded();await expect(spin).toBeInViewport();
  await page.screenshot({path:folder+'/mobile-controls-'+lang+'.png'});
  report.languages.push({language:lang,spinEnabledAtZero,zeroBalanceMessage,paidRequests,controls,paytableMismatches:mismatches,mobile});
  assert.deepEqual(errors,[]);await context.close();
 }
 report.observationsComplete=true;
}finally{await writeFile(folder+'/ux.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report));
