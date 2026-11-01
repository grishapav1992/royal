import {expect,type Page,type Frame} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {test} from './themed-room';
import {ROYAL_COLLECTION_GAMES} from '../src/shared/arcadeCatalog';
import {walletSnapshot as wallet} from './wallet-snapshot';

const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-stage2';
const profiles:Record<string,{board:string;play:string;frame?:boolean}>={
 'studio-cosmic-escape':{board:'.lg-board',play:'.ce-spin'},
 'studio-caramel-carnival':{board:'.cc-board',play:'.cc-spin'},
 'studio-velvet-reign':{board:'.lg-board',play:'.ce-spin'},
 'studio-last-convoy':{board:'.cc-board',play:'.cc-spin'},
 'studio-nitro-run':{board:'.cc-board',play:'.cc-spin'},
 'studio-afterglow':{board:'.cc-board',play:'.cc-spin'},
 'studio-meme-overload':{board:'.cc-board',play:'.cc-spin'},
 'studio-neopolis':{board:'.np-board',play:'.np-spin'},
 'studio-dracona':{board:'.board',play:'.spin-button',frame:true},
 'studio-forest-heart':{board:'.fh-board',play:'.fh-spin',frame:true},
 'studio-flooded-temple':{board:'.ft-reels',play:'[data-ft="primary"]',frame:true},
 'studio-caribbean-treasures':{board:'.ct-board',play:'.ct-play'},
 'royal-plinko':{board:'.vp-board',play:'[data-vp="drop"], [data-vp="play"], .vp-drop'},
 'github-crash':{board:'.le-stage',play:'[data-start]'},
 'original-cr-vs-leo':{board:'.cl-stage',play:'[data-shoot]'},
 'original-jackie-chan':{board:'.jc-stage',play:'[data-fight]'},
 'royal-roulette':{board:'.rr-wheel',play:'.rr-spin'},
 'flag-battle':{board:'.fb-stage',play:'.fb-play'},
};
async function enter(page:Page,path:string){
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`layout-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Royal-layout-check-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo?.getState()?.online)).toBe(true);
 const credit=await page.request.post('/__test/layout/topup');expect(credit.ok(),await credit.text()).toBe(true);
 await page.evaluate(async()=>{const module='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */module)).demoWallet.refresh();});
 await page.locator('#room-overview').click();
 await expect.poll(()=>page.evaluate(()=>Math.abs((window as any).royalDemo.getState().view.width-document.getElementById('game')!.clientWidth))).toBeLessThanOrEqual(1);
 await page.locator('#games-tab').click();
 await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');
  try{
   if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:4000});
   if(!await page.locator('#mini-dialog').isVisible())await cabinet.click({timeout:4000});
  }catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:60000,intervals:[1000,4000]}).toBe(true);
 await expect(page.locator('.royal-platform')).toBeVisible();
}
async function choose(page:Page,id:string){
 if(await page.locator('#mini-dialog').getAttribute('data-game')!=='royal-catalog')await page.locator('#studio-game-list').click();
 await page.locator(`[data-platform-game="${id}"]`).click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',id);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
async function surface(page:Page,id:string):Promise<Page|Frame>{
 if(!profiles[id].frame)return page;
 const frameElement=page.locator('#mini-game iframe');await expect(frameElement).toBeVisible();
 const handle=await frameElement.elementHandle(),frame=await handle!.contentFrame();expect(frame).not.toBeNull();return frame!;
}

test('audit active game priorities in the connected host',async({page,roomPath})=>{
 test.setTimeout(300000);await mkdir(out,{recursive:true});await enter(page,roomPath);
 const rows:any[]=[];
 const ids=process.env.LAYOUT_GAMES?.split(',')??[...ROYAL_COLLECTION_GAMES];
 for(const id of ids){
  expect(ROYAL_COLLECTION_GAMES.includes(id)).toBe(true);expect(profiles[id]).toBeTruthy();await page.setViewportSize({width:1440,height:900});await choose(page,id);
  const view=await surface(page,id);
  const intro=view.locator('[data-cc-action="enter"], [data-lg-dialog-action="enter"], [data-vp="enter"]');
  if(await intro.count()&&await intro.first().isVisible()){
   await expect(intro.first()).toBeEnabled({timeout:20000});await intro.first().click();
  }
  for(const [width,height] of [[1440,900],[393,852],[852,393],[568,320]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   const board=view.locator(profiles[id].board).first();
   const box=await board.count()?await board.boundingBox():null;
   const play=view.locator(profiles[id].play).first(),playBox=await play.count()?await play.boundingBox():null;
   const state=await view.evaluate(({boardSelector,playSelector})=>{
    const board=document.querySelector<HTMLElement>(boardSelector),play=document.querySelector<HTMLElement>(playSelector);
    const rect=(element:Element)=>{const b=element.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
    const scrolling:unknown[]=[];let parent=board?.parentElement;
    while(parent&&parent!==document.body){if(parent.scrollHeight>parent.clientHeight+2||parent.scrollWidth>parent.clientWidth+2)scrolling.push({class:parent.className,overflow:getComputedStyle(parent).overflow,box:rect(parent),scrollHeight:parent.scrollHeight,clientHeight:parent.clientHeight});parent=parent.parentElement;}
    const p=play?.getBoundingClientRect(),hit=p&&document.elementFromPoint(p.x+p.width/2,p.y+p.height/2);
    return{board:board?rect(board):null,play:play?rect(play):null,playHit:!!play&&(hit===play||play.contains(hit??null)),scrolling};
   },{boardSelector:profiles[id].board,playSelector:profiles[id].play});
   const available=await page.locator('.mini-stage').boundingBox();
   rows.push({id,width,height,available,boardPage:box,playPage:playBox,fieldWidthRatio:box&&available?box.width/available.width:0,...state});
   if(width===393||width===852)await page.screenshot({path:out+`/${process.env.LAYOUT_PHASE||'before'}-${id}-${width}x${height}.png`});
  }
  await writeFile(out+'/'+(process.env.LAYOUT_PHASE||'before')+'-audit.json',JSON.stringify({activeGames:ids,realConnectedHost:true,rows},null,2));
 }
 await writeFile(out+'/'+(process.env.LAYOUT_PHASE||'before')+'-audit.json',JSON.stringify({activeGames:ids,realConnectedHost:true,rows},null,2));
 console.log(JSON.stringify(rows.map(r=>({game:r.id,size:r.width+'x'+r.height,fieldWidthRatio:+r.fieldWidthRatio.toFixed(3),field:r.board?Math.round(r.board.width)+'x'+Math.round(r.board.height):'MISSING',primary:r.playHit,scroll:r.scrolling.length}))));
});

const priorityGames=['studio-neopolis','royal-plinko','flag-battle'];
const sizes=[[1440,900],[1280,720],[768,1024],[1024,768],[393,852],[852,393],[320,568],[568,320]];
async function fit(page:Page,id:string,action=profiles[id].play){
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const selectors=[profiles[id].board,action,...(id==='studio-neopolis'?['[data-np="bet"]','.np-boss-meters']:id==='royal-plinko'?['.vp-stake','.vp-profiles','.vp-result']:['.fb-bet','.fb-selection-summary'])];
 const failures=await page.evaluate(selectors=>{
  const failures:string[]=[];
  for(const selector of selectors){
   const el=document.querySelector<HTMLElement>(selector);if(!el){failures.push(selector+': missing');continue;}if(getComputedStyle(el).display==='none')continue;
   const box=el.getBoundingClientRect();if(!box.width||!box.height){failures.push(selector+': empty');continue;}
   for(let parent=el.parentElement;parent;parent=parent.parentElement){
    const css=getComputedStyle(parent);if(!/(hidden|clip|scroll|auto)/.test(css.overflow))continue;
    const p=parent.getBoundingClientRect();
    if(box.top<p.top-2||box.bottom>p.bottom+2||box.left<p.left-2||box.right>p.right+2)failures.push(selector+': clipped by '+parent.className);
   }
   const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
   if(!hit||!el.contains(hit))failures.push(selector+': obstructed');
  }
  const stage=document.querySelector('.mini-stage')!;
  if(stage.scrollHeight>stage.clientHeight+2||stage.scrollWidth>stage.clientWidth+2)failures.push('host needs scrolling');
  return failures;
 },selectors);
 expect(failures).toEqual([]);
 const main=await page.locator(action).boundingBox();expect(main).not.toBeNull();expect(main!.height).toBeGreaterThanOrEqual(44);
}
for(const id of priorityGames)test('field and main actions fit without scrolling: '+id,async({page,roomPath})=>{
 await enter(page,roomPath);await choose(page,id);
 const intro=page.locator('[data-vp="enter"]');if(await intro.count())await intro.click();
 for(const [width,height]of sizes){
  await page.setViewportSize({width,height});await test.step(width+'x'+height,()=>fit(page,id));
  const chat=page.locator('#mini-dialog .game-chat-toggle');
  if(width===1440)await expect(page.locator('#club-chat-dock')).toBeVisible();
  if(width===393||width===852){await expect(chat).toBeVisible();await expect(page.locator('#chat-input')).toBeHidden();}
 }
});

const mini=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
async function panelClose(page:Page,trigger:string){
 const panel=page.locator('.game-options-panel');await expect(panel).toBeVisible();
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(page.locator('#mini-dialog')).toBeVisible();
 await expect(page.locator(trigger)).toBeFocused();
}
test('live options survive orientation changes and accepted rounds are recovered once',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await enter(page,roomPath);await page.setViewportSize({width:393,height:852});await choose(page,'studio-neopolis');
 await page.locator('.np-options').click();await page.locator('.game-options-panel [data-hero="impulse"]').click();
 await page.locator('[data-np="auto-count"]').selectOption('25');await page.locator('[data-np="fast"]').check();
 await page.setViewportSize({width:852,height:393});await panelClose(page,'.np-options');
 await expect(page.locator('.np-options')).toContainText('Импульс');await fit(page,'studio-neopolis');
 await page.locator('.np-options').click();await expect(page.locator('[data-np="auto-count"]')).toHaveValue('25');
 await expect(page.locator('[data-np="fast"]')).toBeChecked();await panelClose(page,'.np-options');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator('[data-np="spin"]').click();const accepted=await response;expect(accepted.ok()).toBe(true);const session=(await accepted.json()).session;
 expect(session.stakeUnits).toBe('10');await expect(page.locator('[data-np="spin"]')).toBeEnabled({timeout:30000});
 const before=await wallet(page);await page.locator('#studio-game-list').click();await page.locator('[data-platform-game="studio-neopolis"]').click();
 await expect.poll(async()=>(await mini(page))?.revision).toBe(session.view.neopolis.revision);
 expect((await wallet(page)).entries).toEqual(before.entries);await fit(page,'studio-neopolis');
 // Delay a real request so Stop can be verified while a paid action is in flight.
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let intercepted=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{intercepted=true;await gate;await route.continue();});
 await page.locator('[data-np="auto"]').click();await expect.poll(()=>intercepted).toBe(true);
 await expect(page.locator('[data-np="auto"]')).toContainText('Стоп');await page.setViewportSize({width:393,height:852});
 await fit(page,'studio-neopolis','[data-np="auto"]');await page.locator('[data-np="auto"]').click();release();
 await expect.poll(async()=>(await mini(page))?.autoplay.running).toBe(false);
 await expect(page.locator('[data-np="spin"]')).toBeEnabled({timeout:30000});await page.unroute('**/api/demo-wallet/expansion');

 await choose(page,'royal-plinko');await page.locator('[data-vp="enter"]').click();
 await page.locator('[data-risk="medium"]').click();await page.locator('.vp-header .game-options-trigger').click();
 await page.locator('[data-vp="speed"]').click();await page.setViewportSize({width:852,height:393});
 await panelClose(page,'.vp-header .game-options-trigger');await expect(page.locator('[data-risk="medium"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('.vp-header .game-options-trigger').click();await expect(page.locator('[data-vp="speed"]')).toHaveAttribute('aria-pressed','true');await panelClose(page,'.vp-header .game-options-trigger');
 let dropped=false;
 await page.route('**/api/demo-wallet/operations',async route=>{
  const reply=await route.fetch();if(!dropped&&route.request().postDataJSON()?.gameId==='royal-plinko'){dropped=true;await route.abort('failed');}else await route.fulfill({response:reply});
 });
 await page.locator('[data-vp="drop"]').click();await expect.poll(()=>dropped).toBe(true);
 await expect(page.locator('[data-vp="drop"]')).toContainText('ПРОВЕРИТЬ РЕЗУЛЬТАТ');const once=await wallet(page);
 await page.setViewportSize({width:393,height:852});await fit(page,'royal-plinko');
 await page.locator('[data-vp="drop"]').click();await expect(page.locator('[data-vp="drop"]')).toBeEnabled({timeout:20000});
 expect((await wallet(page)).entries).toEqual(once.entries);await page.unroute('**/api/demo-wallet/operations');

 await choose(page,'flag-battle');await page.locator('.fb-selection-summary').click();
 await page.locator('[data-mode="world"]').click();await page.locator('[data-fb="search"]').fill('Германия');await page.locator('[data-country="DE"]').click();
 await page.setViewportSize({width:393,height:852});await panelClose(page,'.fb-selection-summary');
 await expect(page.locator('.fb-selection-summary')).toContainText('Германия · 48');
 await page.emulateMedia({reducedMotion:'no-preference'});
 const flagReply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator('.fb-play').click();const flagAccepted=await flagReply;expect(flagAccepted.ok()).toBe(true);const flagSession=(await flagAccepted.json()).session;
 expect(flagSession.stakeUnits).toBe('10');await expect(page.locator('.fb-skip')).toBeVisible();
 await page.setViewportSize({width:852,height:393});await fit(page,'flag-battle','.fb-skip');await page.locator('.fb-skip').click();
 await expect(page.locator('.fb-play')).toBeEnabled();const settled=await wallet(page);
 await choose(page,'flag-battle');await expect.poll(async()=>(await mini(page))?.sessionId).toBe(flagSession.id);
 expect((await wallet(page)).entries).toEqual(settled.entries);expect(errors).toEqual([]);
});

test('live animations keep the field visible through both phone orientations',async({page,roomPath})=>{
 await enter(page,roomPath);await page.emulateMedia({reducedMotion:'no-preference'});
 for(const id of priorityGames){
  await page.setViewportSize({width:393,height:852});await choose(page,id);
  if(id==='royal-plinko')await page.locator('[data-vp="enter"]').click();
  await page.locator(profiles[id].play).click();
  if(id==='studio-neopolis')await expect.poll(async()=>(await mini(page))?.busy).toBe(true);
  if(id==='royal-plinko')await expect(page.locator('.volcanic-plinko')).toHaveAttribute('data-state','falling');
  if(id==='flag-battle')await expect(page.locator('.fb-root')).toHaveAttribute('data-presenting','true');
  await page.setViewportSize({width:852,height:393});await fit(page,id,id==='flag-battle'?'.fb-skip':profiles[id].play);
  await page.setViewportSize({width:393,height:852});await fit(page,id,id==='flag-battle'?'.fb-skip':profiles[id].play);
  if(id==='flag-battle')await page.locator('.fb-skip').click();
  await expect(page.locator(profiles[id].play)).toBeEnabled({timeout:30000});
 }
});
