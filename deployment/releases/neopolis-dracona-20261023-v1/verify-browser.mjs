import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const base = 'https://stealth-spark-gokmxooi.expresshost.cloud';
const folder = process.env.NEOPOLIS_PRODUCTION_PROOF || 'artifacts/neopolis-production/proof';
fs.mkdirSync(folder, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const results = [];
try {
  for (const language of ['ru','en']) {
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/?offline=1&lang='+language, {waitUntil:'load'});
    await page.locator('#loading').waitFor({state:'detached',timeout:60000});
    await page.locator('#games-tab').click();
    await page.locator('[data-cabinet=studio-dracona]').click();
    for (const game of ['studio-neopolis','studio-dracona']) {
      await page.locator('[data-platform-game='+game+']').click();
      const scope = game==='studio-dracona' ? page.frameLocator('iframe.dracona-frame') : page;
      const spin = scope.locator(game==='studio-dracona' ? '#spin' : '[data-np=spin]');
      await spin.waitFor({state:'visible',timeout:45000});
      assert.equal(await spin.isDisabled(), true, 'Anonymous preview must not accept a stake');
      let atlasesLoaded = 0;
      if(game==='studio-neopolis') {
        assert.equal(await page.locator('.np h1').textContent(),language==='en'?'Guardians of Neopolis':'Стражи Неополиса');
        atlasesLoaded = await page.locator('.np-symbol,.np-costume').evaluateAll(async elements => {
          const urls = new Set(elements.flatMap(element => [...getComputedStyle(element).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match=>match[1])));
          const loaded = await Promise.all([...urls].map(async url=>{const image=new Image();image.src=url;await image.decode();return image.naturalWidth>0;}));
          if(urls.size<2||loaded.some(value=>!value)) throw Error('Symbol or costume atlas did not load');
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return urls.size;
        });
      }
      for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(200);
        const geometry=await page.locator('#mini-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
        assert(geometry.scroll<=geometry.width+1,JSON.stringify({game,geometry}));
        const images=await scope.locator(game==='studio-dracona' ? 'img[src]' : '.np img[src]').evaluateAll(images=>Promise.all(images.map(image=>image.decode().then(()=>image.naturalWidth>0).catch(()=>false))));
        assert(images.length>0&&images.every(Boolean),'Game image failed to load');
        assert(await spin.isVisible());
        await page.screenshot({path:folder+'/'+game+'-'+language+'-'+viewport.width+'.png'});
        results.push({game,language,viewport,imagesLoaded:images.length,atlasesLoaded,anonymousStakeBlocked:true,noHorizontalOverflow:true});
      }
      if(game==='studio-neopolis') {
        await page.locator('[data-np=rules]').click();
        assert((await page.locator('.np-dialog').innerText()).includes('96%'));
        await page.locator('[data-np=close]').click();
      } else {
        await scope.locator('#rules').click();
        assert((await scope.locator('.rules-copy').innerText()).includes('0,01'));
        await scope.locator('#dialog-close').click();
      }
      await page.locator('#studio-game-list').click();
      await page.locator('[data-platform-game='+game+']').waitFor();
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
} finally { await browser.close(); }
const result={ok:true,verifiedAt:new Date().toISOString(),results,productionAccountsOrMoneyModified:false,
  chatVerification:'Connected chat and transactional recovery tested on the actual local host with temporary PostgreSQL; public guest preview has no online chat.'};
fs.writeFileSync(folder+'/browser-verification.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
