import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const origin=process.env.ROYAL_VERIFY_ORIGIN||'https://stealth-spark-gokmxooi.expresshost.cloud';
const out=resolve(process.env.ROYAL_VERIFY_OUTPUT||'../proof/public');await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile('../shipping/install-manifest.json','utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const proof={sourceCommit:manifest.sourceCommit,origin,transport:'Published client with a local room sink; production API writes and WebSockets blocked',accountsCreated:0,productionMessages:0,stakes:0,errors:[],opened:[],checks:[],passed:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU'});const page=await context.newPage();
 page.on('pageerror',e=>proof.errors.push(e.message));
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(!['http:','https:'].includes(u.protocol))return route.continue();if(u.origin!==origin)return route.abort('blockedbyclient');if(!['GET','HEAD'].includes(r.method()))return route.abort('blockedbyclient');if(u.pathname.startsWith('/api/'))return route.fulfill({json:{account:null,games:[]}});return route.continue();});
 await context.routeWebSocket('**/*',socket=>socket.close());
 const response=await page.goto(origin+'/?royal-platform-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});expect(response.ok()).toBe(true);expect(hash(await response.body())).toBe(manifest.delta['index.html']);
 await expect(page.locator('#join-dialog')).toBeVisible({timeout:120000});await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});
 const cdp=await context.newCDPSession(page);const fn=await cdp.send('Runtime.evaluate',{expression:'window.royalDemo.getNetworkState'});const props=await cdp.send('Runtime.getProperties',{objectId:fn.result.objectId});const scopesId=props.internalProperties.find(p=>p.name==='[[Scopes]]').value.objectId;const scopes=await cdp.send('Runtime.getProperties',{objectId:scopesId});const name=await page.evaluate(()=>window.royalDemo.getNetworkState.toString().match(/=>\s*([\w$]+)\?\.client/)[1]);let objectId;
 for(const scope of scopes.result){if(!scope.value?.objectId||!/^\d+$/.test(scope.name))continue;const values=await cdp.send('Runtime.getProperties',{objectId:scope.value.objectId});objectId=values.result.find(v=>v.name===name)?.value?.objectId;if(objectId)break;}
 if(!objectId)throw Error('Published host social scope unavailable');
 const installed=await cdp.send('Runtime.callFunctionOn',{objectId,awaitPromise:true,returnByValue:true,functionDeclaration:`async function(){const handlers=new Map(),packets=[];let leave;const room={roomId:'platform-local-sink',sessionId:'platform-local-self',reconnection:{},send(type,value){packets.push({type,value});},onMessage(type,fn){handlers.set(type,fn);},onStateChange(){},onError(){},onDrop(){},onReconnect(){},onLeave(fn){leave=fn;},leave(){leave(1000);}};this.client.client={joinOrCreate:async()=>room};await this.client.join();this.scene.network=undefined;window.__platformPublic={receive:(type,value)=>handlers.get(type)?.(value),packets};return this.client.status;}`});
 if(installed.exceptionDetails)throw Error(installed.exceptionDetails.text);expect(installed.result.value).toBe('connected');await expect(page.locator('#join-dialog')).toBeHidden();
 const ids=await page.locator('[data-cabinet]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-cabinet')));expect(ids).toHaveLength(20);expect(new Set(ids).size).toBe(20);
 for(const id of ids){
  const button=page.locator(`[data-cabinet="${id}"]`);if(!await button.isVisible())await page.locator('#games-tab').click();await button.click();if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',id,{timeout:120000});await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game',id);expect(await page.evaluate(()=>window.royalDemo.getState().cabinet)).toBe(id);
  await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();await expect(page.locator('#chat-input')).toBeInViewport();
  await page.locator('#studio-game-list').click();await expect(page.locator('#mini-game .rp-card')).toHaveCount(52);await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game','royal-catalog');
  await page.locator('#mini-game [data-source=royal]').click();await expect(page.locator('#mini-game .rp-card')).toHaveCount(43);await page.locator('#mini-game [data-source=github]').click();await expect(page.locator('#mini-game .rp-card')).toHaveCount(9);
  proof.opened.push({id,defaultGame:id,localGames:52,chat:true});console.log('Verified public cabinet',id);
  if(id===ids[0]){
   await page.locator('#mini-game [data-platform-game=royal-dice]').click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','royal-dice');expect(await page.evaluate(()=>window.royalDemo.getState().cabinet)).toBe(id);
   await page.setViewportSize({width:390,height:844});await expect(page.locator('#studio-game-list')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:resolve(out,'game-mobile.png')});
   await page.locator('#studio-game-list').click();await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:resolve(out,'catalog-mobile.png')});await page.locator('#mini-game [data-source=casinoapipro]').click();await expect(page.locator('.rp-provider-status')).toContainText('Войди в онлайн-зал');
   await page.setViewportSize({width:1440,height:1000});await page.locator('#mini-game [data-source=all]').click();await page.screenshot({path:resolve(out,'catalog-desktop.png')});proof.checks.push('Different module and provider category retain the same cabinet; mobile and desktop chat stay visible');
  }
  await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.royalDemo.getState().cabinet)).toBe('');
 }
 expect(proof.errors).toEqual([]);expect(await context.cookies()).not.toContainEqual(expect.objectContaining({name:'royal_session'}));proof.passed=true;
}finally{await writeFile(resolve(out,'verification.json'),JSON.stringify(proof,null,2)+'\n');await browser.close();}
