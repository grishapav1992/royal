import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

test('manual field preserves drafts, validates before play, locks accepted stakes and keeps presets',async()=>{
  const built=await build({entryPoints:['src/ui/stakeSelection.ts'],bundle:true,write:false,format:'esm',logLevel:'silent'});
  const html=`<!doctype html><html lang="ru"><body><div id="mini-game"><label>Ставка<select aria-label="Общая ставка"><option value="10">0.10</option><option value="20">0.20</option><option value="5000">50.00</option></select></label><button data-gn="spin">Spin</button></div><script type="module">
    import {syncStakeSelect} from '/control.js';const select=document.querySelector('select');window.value='10';window.clicks=0;window.sync=(locked=false)=>syncStakeSelect(select,window.value,['10','20','5000'],locked);
    select.onchange=()=>{window.value=select.value;window.sync();};document.querySelector('button').onclick=()=>window.clicks++;window.sync();window.ready=true;
  </script></body></html>`;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/control.js'?'text/javascript':'text/html');res.end(req.url==='/control.js'?built.outputFiles[0].text:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
    const input=page.locator('[data-manual-stake]');assert.equal(await input.inputValue(),'0.10');
    await input.fill('2.');await page.evaluate(()=>window.sync());assert.equal(await input.inputValue(),'2.');
    await page.locator('button').click();assert.equal(await page.evaluate(()=>window.clicks),0);
    await input.fill('2,35');assert.equal(await page.evaluate(()=>window.value),'235');
    await page.locator('button').click();assert.equal(await page.evaluate(()=>window.clicks),1);
    for(const invalid of ['','0.09','50.01','1e1','1.001']){await input.fill(invalid);await page.locator('button').click();assert.equal(await page.evaluate(()=>window.clicks),1,invalid);}
    await page.locator('select').focus();await page.locator('select').selectOption('20');assert.equal(await input.inputValue(),'0.20');
    await input.fill('0.15');await page.locator('button').click();assert.equal(await page.evaluate(()=>window.value),'15');
    await page.evaluate(()=>window.sync(true));assert(await input.isDisabled());assert.equal(await input.inputValue(),'0.15');
    await page.evaluate(()=>window.sync(false));assert(!(await input.isDisabled()));assert.equal(await input.inputValue(),'0.15');
    for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});const b=await input.boundingBox();assert(b&&b.width>=36&&b.x>=0&&b.x+b.width<=width);}
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
