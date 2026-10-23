import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startAfter} from '../../../server/games/afterglow.ts';
import {validAfterSession} from '../../../src/shared/afterglow.ts';

const here=dirname(fileURLToPath(import.meta.url));
const origin='https://stealth-spark-gokmxooi.expresshost.cloud';
const shipping=resolve(process.argv[2]),candidate=process.argv.includes('--candidate');
const out=resolve(shipping,'../proof',candidate?'candidate':'public');await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile(resolve(shipping,'install-manifest.json'),'utf8'));
const version=manifest.games['studio-afterglow'].version;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const proof={version,candidate,origin,transport:'Actual published host and chat with local room and wallet fixtures; all production writes and WebSockets blocked',productionWrites:0,accountsCreated:0,errors:[],runs:[],passed:false};
const profile={version:3,revision:0,selectedGirl:0,selectedLook:0,albumUnits:0,pointsUnits:[0,0,0,0],unlocked:[false,false,false,false],active:false,activeGirl:null};
const wallet={balance:1000,entries:[]};
function session(seed,id){let n=seed;const r=startAfter({afterglow:{mode:'normal'}},'100',0,max=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n%max;});const s={gameId:'studio-afterglow',id,rulesVersion:2,stakeUnits:'100',spentUnits:'100',returnedUnits:r.ended?r.view.totalPayoutUnits:'0',state:r.ended?'settled':'active',view:{afterglow:r.view,player:[],dealer:[],community:[],actions:r.actions,phase:r.view.revision+1,ended:r.ended,message:r.message}};expect(validAfterSession(s)).toBe(true);return s;}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const lang of ['ru','en']){
  let selected=1,posts=0,saved;
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:lang==='en'?'en-US':'ru-RU'}),page=await context.newPage();
  page.on('pageerror',e=>proof.errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('royal-afterglow-music','0');localStorage.setItem('royal-afterglow-voices','0');});
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(!['http:','https:'].includes(u.protocol))return route.continue();
   if(u.origin!==origin)return route.abort('blockedbyclient');
   if(u.pathname==='/api/demo-wallet/expansion'){
    if(req.method()==='POST'){posts++;saved=session(selected,req.postDataJSON().id);return route.fulfill({json:{wallet,sessions:[saved],session:saved,replayed:false}});}
    return route.fulfill({json:{wallet,sessions:saved?[saved]:[]}});
   }
   if(!['GET','HEAD'].includes(req.method()))return route.abort('blockedbyclient');
   if(u.pathname==='/api/demo-wallet/afterglow-wardrobe')return route.fulfill({json:profile});
   if(u.pathname==='/api/demo-wallet')return route.fulfill({json:wallet});
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:{account:null,games:[]}});
   if(candidate&&u.pathname.startsWith('/game-modules/studio-afterglow/')){
    if(u.pathname.endsWith('/active.json'))return route.fulfill({path:resolve(shipping,'candidate-active.json'),contentType:'application/json'});
    const prefix='/game-modules/studio-afterglow/versions/'+version+'/';
    if(u.pathname.startsWith(prefix)){
     const name=u.pathname.slice(prefix.length);expect(Object.hasOwn(manifest.games['studio-afterglow'].files,name)).toBe(true);
     return route.fulfill({path:resolve(shipping,'packages/studio-afterglow',name)});
    }
   }
   return route.continue();
  });
  await context.routeWebSocket('**/*',socket=>socket.close());
  const response=await page.goto(origin+'/?lang='+lang+'&girlhub-feedback-check='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});expect(response.ok()).toBe(true);expect(hash(await response.body())).toBe(manifest.before.program['dist/index.html']);
  await expect(page.locator('#join-dialog')).toBeVisible({timeout:120000});await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});
  // Attach the real host chat to a local room sink without contacting production multiplayer.
  const cdp=await context.newCDPSession(page),fn=await cdp.send('Runtime.evaluate',{expression:'window.royalDemo.getNetworkState'}),props=await cdp.send('Runtime.getProperties',{objectId:fn.result.objectId}),scopes=await cdp.send('Runtime.getProperties',{objectId:props.internalProperties.find(p=>p.name==='[[Scopes]]').value.objectId});
  const name=await page.evaluate(()=>window.royalDemo.getNetworkState.toString().match(/=>\s*([\w$]+)\?\.client/)[1]);let objectId;
  for(const scope of scopes.result){if(!scope.value?.objectId||!/^\d+$/.test(scope.name))continue;const values=await cdp.send('Runtime.getProperties',{objectId:scope.value.objectId});objectId=values.result.find(v=>v.name===name)?.value?.objectId;if(objectId)break;}
  if(!objectId)throw Error('Published host social scope unavailable');
  const installed=await cdp.send('Runtime.callFunctionOn',{objectId,awaitPromise:true,returnByValue:true,functionDeclaration:`async function(){const handlers=new Map(),packets=[];let leave;const room={roomId:'girlhub-local-room',sessionId:'girlhub-local-self',reconnection:{},send(type,value){packets.push({type,value});},onMessage(type,fn){handlers.set(type,fn);},onStateChange(){},onError(){},onDrop(){},onReconnect(){},onLeave(fn){leave=fn;},leave(){leave(1000);}};this.client.client={joinOrCreate:async()=>room};await this.client.join();this.scene.network=undefined;window.__girlhubPublic={receive:(type,value)=>handlers.get(type)?.(value),packets};return this.client.status;}`});
  if(installed.exceptionDetails)throw Error(installed.exceptionDetails.text);expect(installed.result.value).toBe('connected');await expect(page.locator('#join-dialog')).toBeHidden();
  const open=async()=>{
   const button=page.locator('[data-cabinet="studio-afterglow"]');if(!await button.isVisible())await page.locator('#games-tab').click();await button.click();if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();
   await expect(page.locator('#mini-dialog')).toBeVisible();
   if(await page.locator('[data-platform-game="studio-afterglow"]').isVisible())await page.locator('[data-platform-game="studio-afterglow"]').click();
   await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version',version,{timeout:60000});
   await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-asset-state','ready',{timeout:60000});
   await page.evaluate(()=>window[Symbol.for('royal.game-host.v1')].demoWallet.setAccount('girlhub-local-wallet'));
   await page.locator('[data-cc-action=enter]').click();await expect(page.locator('[data-cc-spin]')).toBeEnabled();
   await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();await expect(page.locator('#chat-input')).toBeInViewport();
  };
  await open();const observations=[];
  for(const [seed,tier]of (lang==='ru'?[[1,'win'],[143,'big'],[7085,'epic'],[3,'partial'],[2,'loss']]:[[7085,'epic']])){
   selected=seed;if(tier==='big'||lang==='en')await page.setViewportSize({width:390,height:844});
   await page.locator('[data-cc-spin]').click();
   if(['win','big','epic'].includes(tier)){
    await expect(page.locator('.ag-live-lines polyline')).not.toHaveCount(0);
    await expect(page.locator('.ag-result')).toBeVisible();await expect(page.locator('.ag-result')).toHaveAttribute('data-tier',tier);
    await expect(page.locator('[data-ag-skip]')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
    if(lang==='en'){await expect(page.locator('.ag-result h3')).toHaveText('EPIC WIN');await expect(page.locator('.ag-result small')).toHaveText('ROUND PAYOUT');await expect(page.locator('[data-ag-net]')).toContainText('ROUND NET');await expect(page.locator('[data-ag-skip]')).toHaveText('Show total');}
    await page.screenshot({path:resolve(out,lang+'-'+tier+'.png')});if(tier==='epic')await page.locator('[data-ag-skip]').click();
   }
   await expect(page.locator('[data-cc-spin]')).toBeEnabled();await expect(page.locator('[data-afterglow-game]')).toHaveAttribute('data-ag-outcome',tier);await expect(page.locator('[data-cc-total]')).toHaveAttribute('data-units',saved.returnedUnits);
   observations.push({tier,returned:saved.returnedUnits,state:await page.evaluate(()=>window.royalDemo.getMiniState())});
   if(['loss','partial'].includes(tier))await expect(page.locator('.ag-result')).toBeHidden();
  }
  const completed=posts;
  // Restoring a settled operation is static and never sends another stake.
  saved=session(143,crypto.randomUUID());
  await page.locator('.slot-settings-button').click();await page.locator('[data-cc-refresh]').click();await expect(page.locator('[data-cc-total]')).toHaveAttribute('data-units','1380');await expect(page.locator('.ag-result')).toBeHidden();expect(posts).toBe(completed);await page.locator('.slot-settings-dialog header button').click();
  await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('link[data-royal-game-module="studio-afterglow"]')).toHaveCount(0);await open();expect(posts).toBe(completed);expect((await page.evaluate(()=>window.royalDemo.getMiniState())).accents.counts).toEqual({});
  if(lang==='ru'){
   selected=5;await page.locator('[data-cc-spin]').click();await expect(page.locator('[data-cc-action=bonus]')).toBeVisible();await expect(page.locator('.ag-result')).toBeHidden();const state=await page.evaluate(()=>window.royalDemo.getMiniState());expect(state.accents.counts.bonus).toBe(1);expect(state.accents.counts.win).toBeUndefined();expect(posts).toBe(6);
  }
  proof.runs.push({lang,observations,fixtureOperations:posts,chat:true,reopened:true,restoredWithoutReplay:true});console.log(JSON.stringify({lang,version,fixtureOperations:posts,passed:true}));await context.close();
 }
 expect(proof.errors).toEqual([]);proof.passed=true;
}finally{await writeFile(resolve(out,'verification.json'),JSON.stringify(proof,null,2)+'\n');await browser.close();}
