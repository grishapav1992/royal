// Verify the current production successors without reinstalling historical releases.
import {chromium, request, expect} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {randomUUID, createHash} from 'node:crypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {validNeopolisSession} from '../../../src/shared/neopolis.ts';
import {validDraconaSession} from '../../../src/shared/dracona.ts';

const base='https://stealth-spark-gokmxooi.expresshost.cloud';
const output=process.env.NEOPOLIS_PRODUCTION_PROOF || 'artifacts/neopolis-production/resumed-proof';
fs.mkdirSync(output,{recursive:true});
const sha=data=>createHash('sha256').update(data).digest('hex');
const hostProof=JSON.parse(fs.readFileSync(process.env.NEOPOLIS_HOST_PROOF || new URL('../raise-windows-20261023-v2/verification.json',import.meta.url)));
const http=await request.newContext({baseURL:base,timeout:90000,extraHTTPHeaders:{'Cache-Control':'no-cache','Origin':base}});
const result={verifiedAt:new Date().toISOString(),hostSourceCommit:hostProof.sourceCommit,hostFiles:[],modules:[],games:[],screens:[]};
const save=()=>fs.writeFileSync(output+'/live-verification.json',JSON.stringify(result,null,2)+'\n');
const browser=await chromium.launch({channel:'chrome',headless:true});
let peer, ownerApi, context;
try {
  assert.equal((await (await http.get('/healthz')).json()).ok,true);
  for(const file of hostProof.publicSHA256Files){
    const response=await http.get('/'+file.path);assert(response.ok());
    assert.equal(sha(await response.body()),file.sha256,file.path);result.hostFiles.push(file.path);
  }
  for(const [game,progress] of [['studio-neopolis',3],['studio-dracona',2]]){
    const pointer=await(await http.get('/game-modules/'+game+'/active.json')).json();
    const response=await http.get(pointer.manifest);assert(response.ok());
    assert.equal(sha(await response.body()),pointer.sha256);
    const manifest=await response.json();assert.equal(manifest.rulesVersion,3);assert.equal(manifest.progressVersion,progress);
    const prefix=pointer.manifest.slice(0,pointer.manifest.lastIndexOf('/')+1);
    for(const [name,digest] of Object.entries(manifest.files)){
      const file=await http.get(prefix+name);assert(file.ok(),name);assert.equal(sha(await file.body()),digest,name);
    }
    result.modules.push({game,version:manifest.version,rulesVersion:manifest.rulesVersion,progressVersion:progress,manifest:pointer.manifest,filesVerified:Object.keys(manifest.files).length});
  }
  assert.equal((await http.get('/api/demo-wallet')).status(),401);
  console.log('Public host and all 42 module files verified');
  ownerApi=await request.newContext({baseURL:base,timeout:90000,extraHTTPHeaders:{Origin:base}});
  const ownerLogin=await ownerApi.post('/api/auth/login',{data:{email:'neopolis-room-'+randomUUID()+'@example.test',password:randomUUID()+'!'}});
  assert(ownerLogin.ok());console.log('Isolated room owner authenticated');assert((await ownerApi.post('/api/auth/character',{data:{skin:0}})).ok());
  peer=await new Client(base,{headers:{Cookie:ownerLogin.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{
    const response=await ownerApi.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body});
    return new Response(await response.body(),{status:response.status(),headers:response.headers()});
  }}).create('lobby');
  peer.onMessage('*',()=>{});
  context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',extraHTTPHeaders:{Origin:base}});
  const auth=await context.request.post(base+'/api/auth/login',{timeout:90000,data:{email:'neopolis-smoke-'+randomUUID()+'@example.test',password:randomUUID()+'!'}});
  assert(auth.ok());const account=(await auth.json()).account;console.log('Synthetic player authenticated');
  assert((await context.request.post(base+'/api/auth/character',{data:{skin:0}})).ok());
  const headers={'X-Royal-Account-Id':account.id,'X-Royal-Neopolis-Rules':'3','X-Royal-Dracona-Rules':'2','X-Royal-Card-Rules':'2'};
  const fund=await context.request.post(base+'/api/demo-wallet/operations',{headers,data:{id:randomUUID(),kind:'deposit',amount:10000}});
  assert(fund.ok());assert.equal((await fund.json()).wallet.balance,10000);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const enter=async()=>{
    await page.goto(base+'/?lang=ru&room='+peer.roomId,{waitUntil:'load'});
    await expect(page.locator('#join-dialog')).toBeHidden({timeout:60000});
    await page.locator('#loading').waitFor({state:'detached',timeout:60000});
    await page.waitForFunction(()=>{try{return window.royalDemo?.getState().online===true;}catch{return false;}},undefined,{timeout:30000});
    await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();
    await page.locator('[data-platform-game=studio-neopolis]').waitFor({state:'visible',timeout:30000});
  };
  const current=game=>page.evaluate(game=>window[Symbol.for('royal.game-host.v1')].expansionClient.sessions.find(s=>s.gameId===game),game);
  const balance=()=>page.evaluate(()=>window[Symbol.for('royal.game-host.v1')].demoWallet.wallet.balance);
  const walletReady=()=>page.waitForFunction(()=>{
    const host=window[Symbol.for('royal.game-host.v1')],c=host?.expansionClient,w=host?.demoWallet;
    return c?.accountId&&w?.accountId===c.accountId&&!c.loading&&!c.busy&&!w.busy&&!w.pending&&!w.hasExternalBusy('expansion');
  },undefined,{timeout:45000});
  await enter();
  console.log('Connected production room opened');
  for(const game of ['studio-neopolis','studio-dracona']){
    console.log('Verifying '+game);
    const np=game==='studio-neopolis',valid=np?validNeopolisSession:validDraconaSession;
    await page.locator('[data-platform-game='+game+']').click();
    const scope=np?page:page.frameLocator('iframe.dracona-frame');
    const spin=scope.locator(np?'[data-np=spin]':'#spin');
    await expect(spin).toBeEnabled({timeout:45000});
    await walletReady();
    await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
    // The preceding API-only rounds bypass this tab's cache; explicitly refresh it.
    await page.evaluate(async()=>{
      const host=window[Symbol.for('royal.game-host.v1')];
      await host.expansionClient.refresh();await host.demoWallet.refresh();
    });
    await walletReady();await expect(spin).toBeEnabled();
    const beforeSnapshot=await(await context.request.get(base+'/api/demo-wallet',{headers})).json();
    const before=beforeSnapshot.balance;assert.equal(await balance(),before);
    let original,operation;
    const discard=async route=>{
      if(original||route.request().method()!=='POST'){await route.continue();return;}
      operation=route.request().postDataJSON();
      const response=await route.fetch();assert(response.ok());original=await response.json();
      assert.equal(original.session.gameId,game);console.log('Confirmed result discarded for '+game);await route.abort('failed');
    };
    await page.route('**/api/demo-wallet/expansion',discard);
    await spin.click();
    await expect(spin).toContainText(np?'Проверить':'ПРОВЕРИТЬ',{timeout:30000});
    assert(original);assert.equal(original.session.rulesVersion,3);assert(valid(original.session));
    await page.unroute('**/api/demo-wallet/expansion',discard);
    const retry=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
    await spin.click();const repeated=await(await retry).json();
    assert.equal(repeated.replayed,true);assert.deepEqual(repeated.session,original.session);
    await expect(spin).toBeEnabled({timeout:45000});
    let session=await current(game);assert(valid(session));
    assert.equal(Math.round((await balance())*100),Math.round(before*100)-Number(session.spentUnits)+Number(session.returnedUnits));
    if(np&&await page.locator('[data-np=dialog]').isVisible())await page.locator('[data-np=close]').click();
    if(!np&&await scope.locator('#dialog').isVisible())await scope.locator('#dialog-close').click();
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();
      assert(await page.locator('#mini-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await expect(spin).toBeVisible();await page.screenshot({path:output+'/'+game+'-online-'+viewport.width+'.png'});
      result.screens.push({game,viewport,connectedChat:true,noHorizontalOverflow:true});
    }
    const saved=structuredClone(session);
    await page.setViewportSize({width:1440,height:1000});await page.reload();
    console.log(game+' reloaded');
    await expect(page.locator('#join-dialog')).toBeHidden({timeout:45000});
    await page.locator('#loading').waitFor({state:'detached',timeout:60000});
    await page.waitForFunction(()=>{try{return window.royalDemo?.getState().online===true;}catch{return false;}});
    await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();
    await page.locator('[data-platform-game='+game+']').click();
    await expect(spin).toBeEnabled({timeout:45000});await walletReady();assert.deepEqual(await current(game),saved);
    console.log(game+' saved session restored');
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    let paid=1,free=0;
    const post=async data=>{
      const response=await context.request.post(base+'/api/demo-wallet/expansion',{headers,data});
      assert.equal(response.status(),200);const reply=await response.json();assert(valid(reply.session));assert.equal(reply.session.rulesVersion,3);return reply;
    };
    let expected=Math.round((await balance())*100),last=operation;
    while(paid<10||session.state==='active'){
      assert(free<80,'Bonus exceeded declared finite bounds');
      const isFree=session.state==='active';
      last=isFree?{id:randomUUID(),gameId:game,action:'move',sessionId:session.id,move:np?'neopolis-spin':'dracona-spin',revision:session.view[np?'neopolis':'dracona'].revision}
        :{id:randomUUID(),gameId:game,action:'start',stakeUnits:'10000',settings:np?{neopolis:{hero:'granite'}}:{dracona:{mode:'normal'}}};
      const reply=await post(last);session=reply.session;
      if(isFree)free++;else paid++;
      expected-=(isFree?0:10000);if(session.state==='settled')expected+=Number(session.returnedUnits);
      assert.equal(Math.round(reply.wallet.balance*100),expected,'Exact wallet settlement');
      if(isFree)assert.equal(session.spentUnits,'10000','Free continuation must retain its original stake');
      await page.waitForTimeout(200);
      console.log(game+': '+paid+' paid, '+free+' free');
    }
    const replay=await post(last);assert(replay.replayed);assert.equal(Math.round(replay.wallet.balance*100),expected);assert.deepEqual(replay.session,session);
    const restored=await(await context.request.get(base+'/api/demo-wallet/expansion',{headers})).json();
    assert.deepEqual(restored.sessions.find(s=>s.gameId===game),session);
    result.games.push({game,rulesVersion:session.rulesVersion,viewVersion:session.view[np?'neopolis':'dracona'].version,paidRounds:paid,freeContinuations:free,transcriptReplay:true,lostResponseRecovered:true,reloadPreservedSession:true,exactCents:true,finalReplayDidNotCreditTwice:true});
    save();
    console.log(game+' passed: '+paid+' paid rounds, '+free+' free continuations');
    await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();
  }
  assert.deepEqual(errors,[]);result.ok=true;result.pageErrors=errors;
  result.productionScope={syntheticAccounts:2,isolatedRoom:true,freeVirtualDeposit:10000,blockchainTransfers:0,otherPlayerBalancesModified:false};
} catch(error) {
  result.ok=false;result.failure=error.message;throw error;
} finally {
  save();
  const cleanup=async(name,action)=>{
    let timer;
    try{await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+' timed out')),5000);})]);}
    catch(error){(result.cleanupWarnings??=[]).push(error.message);}
    finally{clearTimeout(timer);}
  };
  if(context){await cleanup('player logout',()=>context.request.post(base+'/api/auth/logout',{timeout:4000}));await cleanup('browser context',()=>context.close());}
  if(peer)await cleanup('isolated room leave',()=>peer.leave());
  if(ownerApi){await cleanup('owner logout',()=>ownerApi.post('/api/auth/logout',{timeout:4000}));await cleanup('owner API',()=>ownerApi.dispose());}
  await cleanup('public API',()=>http.dispose());await cleanup('browser',()=>browser.close());save();
}
console.log(JSON.stringify(result));
