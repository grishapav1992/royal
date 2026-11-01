import {expect,type Page,type Frame} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';

const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-iframes';
const profiles={
 'studio-dracona':{root:'.game',board:'#board',primary:'#spin',stake:'.bet-control',essential:['#reserve-grid','#bonus-description']},
 'studio-forest-heart':{root:'.fh',board:'.fh-board',primary:'.fh-primary>button:not([hidden])',stake:'.fh-bet',essential:['.fh-source','.fh-flowers']},
 'studio-flooded-temple':{root:'.ft-cascade',board:'.ft-reels',primary:'[data-ft=primary]',stake:'.ft-stake',essential:['.ft-multiplier','[data-free-count]']},
};
type Id=keyof typeof profiles;
const ids=Object.keys(profiles) as Id[];
const sizes=[[1440,900],[1280,720],[768,1024],[1024,768],[393,852],[852,393],[320,568],[568,320]];
async function open(page:Page,id:Id){
 await chooseGame(page,id);const handle=await page.locator('#mini-game iframe').elementHandle(),frame=(await handle!.contentFrame())!;
 await expect(frame.locator(profiles[id].board)).toBeVisible();await expect(frame.locator(profiles[id].root)).toHaveAttribute('data-frame-layout',/full|portrait|landscape/);
 return frame;
}
async function fit(page:Page,frame:Frame,id:Id,modal=false){
 await frame.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const p=profiles[id],selectors=[p.board,p.primary,p.stake,...p.essential];
 const failures=await frame.evaluate(({selectors,modal})=>{
  const failures:string[]=[];
  for(const selector of selectors){
   const el=document.querySelector<HTMLElement>(selector);if(!el||!el.getClientRects().length){failures.push(selector+': missing or hidden');continue;}
   const b=el.getBoundingClientRect();if(b.width<1||b.height<1||b.left< -1||b.top< -1||b.right>innerWidth+1||b.bottom>innerHeight+1)failures.push(selector+': outside iframe '+JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height,innerWidth,innerHeight}));
   for(let parent=el.parentElement;parent;parent=parent.parentElement){
    if(!/(auto|hidden|scroll|clip)/.test(getComputedStyle(parent).overflow))continue;
    const r=parent.getBoundingClientRect();if(b.left<r.left-2||b.top<r.top-2||b.right>r.right+2||b.bottom>r.bottom+2)failures.push(selector+': clipped by '+parent.className);
   }
   if(!modal&&el.matches('button,select')){const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!hit||!el.contains(hit))failures.push(selector+': obstructed');}
  }
  return failures;
 },{selectors,modal});expect(failures).toEqual([]);
 const primary=await frame.locator(p.primary).boundingBox();expect(primary!.height).toBeGreaterThanOrEqual(44);
 const host=await page.locator('.mini-stage').evaluate(e=>({h:e.clientHeight,sh:e.scrollHeight,w:e.clientWidth,sw:e.scrollWidth}));expect(host.sh).toBeLessThanOrEqual(host.h+2);expect(host.sw).toBeLessThanOrEqual(host.w+2);
}
async function session(page:Page,id:Id){return page.evaluate(async id=>{const path='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */path)).expansionClient.sessions.find((s:any)=>s.gameId===id);},id);}
async function finish(page:Page,frame:Frame,id:Id){
 await expect.poll(async()=>{
  const s=await session(page,id);
  if(id==='studio-dracona'&&await frame.locator('#dialog').isVisible()){await frame.locator('#dialog .dialog-primary').click();return false;}
  const main=frame.locator(profiles[id].primary).first();
  if(s?.state==='settled'&&await main.isEnabled())return true;
  if(s?.state==='active'&&await main.isEnabled())try{await main.click({timeout:process.env.LAYOUT_BROWSER==='webkit'?5000:1500});}catch(e){if(!(e instanceof Error)||e.name!=='TimeoutError')throw e;}
  return false;
 },{timeout:process.env.LAYOUT_BROWSER==='webkit'?180000:90000,intervals:[100,250,500]}).toBe(true);
}

for(const id of ids)test('iframe field and essential actions fit: '+id,async({page,roomPath})=>{
 await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);const frame=await open(page,id),rows:unknown[]=[];
 for(const [width,height]of sizes)await test.step(width+'x'+height,async()=>{
  await page.setViewportSize({width,height});await fit(page,frame,id);
  rows.push({width,height,field:await frame.locator(profiles[id].board).boundingBox()});
  if([1440,393,852].includes(width))await page.screenshot({path:out+'/'+id+'-'+width+'x'+height+'.png'});
 });
 await writeFile(out+'/'+id+'-sizes.json',JSON.stringify(rows,null,2));
});

for(const id of ids)test('iframe settings, accepted round and recovery: '+id,async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});let frame=await open(page,id);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const gear=()=>frame.locator(id==='studio-dracona'?'.frame-options-button':id==='studio-forest-heart'?'[data-fh=settings]':'[data-ft=settings]');
 const panel=()=>frame.locator(id==='studio-dracona'?'.frame-options':id==='studio-forest-heart'?'.fh-dialog':'.ft-dialog');
 await gear().click();
 if(id==='studio-dracona'){await frame.locator('#speed').selectOption('turbo');await frame.locator('#autoplay-count').selectOption('25');}
 else if(id==='studio-forest-heart')await frame.locator('[data-fh=fast]').check();
 else{await panel().locator('[data-ft=fast]').click();await panel().locator('[data-ft=auto-count]').selectOption('25');}
 await page.screenshot({path:out+'/'+id+'-options.png'});await page.setViewportSize({width:852,height:393});await frame.locator('body').press('Escape');await expect(panel()).toBeHidden();await expect(gear()).toBeFocused();
 await fit(page,frame,id);await page.setViewportSize({width:1440,height:900});await fit(page,frame,id);await page.setViewportSize({width:393,height:852});
 let release!:()=>void,seen=false;const gate=new Promise<void>(r=>release=r);
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){seen=true;await gate;}await route.continue();});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 const auto=frame.locator(id==='studio-dracona'?'#autoplay':'[data-ft=auto]');
 if(id==='studio-forest-heart')await frame.locator(profiles[id].primary).click();else await auto.click();
 await expect.poll(()=>seen).toBe(true);await page.setViewportSize({width:852,height:393});await fit(page,frame,id);
 if(id!=='studio-forest-heart'){await expect(auto).toContainText(/СТОП|Стоп/);await auto.click();}
 release();const paid=await response;expect(paid.ok(),await paid.text()).toBe(true);await finish(page,frame,id);await page.unroute('**/api/demo-wallet/expansion');
 const first=await walletSnapshot(page);expect(first.entries.filter((e:any)=>e.kind==='bet').map((e:any)=>e.amount)).toEqual([-0.1]);
 frame=await open(page,id);await finish(page,frame,id);expect((await walletSnapshot(page)).entries).toEqual(first.entries);
 let lost=false;await page.route('**/api/demo-wallet/expansion',async route=>{if(!lost&&route.request().method()==='POST'){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await frame.locator(profiles[id].primary).click();await expect.poll(()=>lost).toBe(true);
 const retry=()=>frame.locator(id==='studio-dracona'?'#spin':id==='studio-forest-heart'?'[data-fh=retry]':'[data-ft=primary]');await expect(retry()).toBeEnabled();
 await page.setViewportSize({width:568,height:320});await fit(page,frame,id);frame=await open(page,id);await retry().click();await finish(page,frame,id);await page.unroute('**/api/demo-wallet/expansion');
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);expect(errors).toEqual([]);
});

test('natural bonuses and Forest Heart choices retain their controls through rotation',async({page,roomPath})=>{
 test.setTimeout(process.env.LAYOUT_BROWSER==='webkit'?600000:300000);await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);
 for(const id of ids)await test.step(id,async()=>{
  await page.setViewportSize({width:393,height:852});const frame=await open(page,id);
  if(id==='studio-dracona'){await frame.locator('.frame-options-button').click();await frame.locator('#speed').selectOption('turbo');await frame.locator('body').press('Escape');}
  const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:id}});expect(fixture.ok(),await fixture.text()).toBe(true);
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  if(id==='studio-flooded-temple')await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='move')await gate;await route.continue();});
  await frame.locator(profiles[id].primary).click();await expect.poll(async()=>(await session(page,id))?.state).toBe('active');
  if(id==='studio-dracona'){
   const accept=frame.locator('#dialog .dialog-primary');await expect(accept).toBeVisible();
   for(const [width,height]of [[393,852],[852,393],[568,320]]){await page.setViewportSize({width,height});await fit(page,frame,id,true);await expect(accept).toBeInViewport({ratio:1});}await accept.click();
  }
  if(id==='studio-forest-heart'){
   await expect.poll(async()=>(await session(page,id))?.view.forestHeart.stage).toBe('choice');
   const rotor=frame.locator('[data-cell]:not(:disabled)').first();await expect(rotor).toBeEnabled();
   for(const [width,height]of [[320,568],[568,320],[393,852],[852,393]]){await page.setViewportSize({width,height});await fit(page,frame,id);const box=await rotor.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);}
   await rotor.click();await expect.poll(async()=>(await session(page,id))?.view.forestHeart.stage).toBe('bonus');
  }
  for(const [width,height]of [[393,852],[852,393],[568,320]]){await page.setViewportSize({width,height});await fit(page,frame,id);}
  await page.screenshot({path:out+'/'+id+'-bonus-landscape.png'});const before=(await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet').length;
  release();await finish(page,frame,id);if(id==='studio-flooded-temple')await page.unroute('**/api/demo-wallet/expansion');
  expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(before);
 });
});

test('accepted Temple v1 route and rope remain usable before returning to cascades',async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);const id='studio-flooded-temple',frame=await open(page,id);
 const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:id,scenario:'legacy'}});expect(fixture.ok(),await fixture.text()).toBe(true);
 const account=await page.evaluate(async()=>{const p='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */p)).expansionClient.accountId;});
 const accepted=await page.request.post('/api/demo-wallet/expansion',{headers:{[WALLET_ACCOUNT_HEADER]:account},data:{id:crypto.randomUUID(),gameId:id,action:'start',stakeUnits:'10',settings:{temple:{mode:'normal'}}}});expect(accepted.ok(),await accepted.text()).toBe(true);
 await page.evaluate(async()=>{const p='/src/wallet/ExpansionClient.ts';await(await import(/* @vite-ignore */p)).expansionClient.refresh();});await expect(frame.locator('.ft:not(.ft-cascade)')).toBeVisible();
 for(const [width,height]of sizes){
  await page.setViewportSize({width,height});await frame.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  const clipped=await frame.evaluate(()=>['.ft-map','[data-ft=primary]','.ft-stake','.ft-rope'].filter(selector=>{const e=document.querySelector(selector);if(!e||!e.getClientRects().length)return true;const b=e.getBoundingClientRect();return b.left< -1||b.top< -1||b.right>innerWidth+1||b.bottom>innerHeight+1;}));expect(clipped).toEqual([]);
 }
 await page.setViewportSize({width:852,height:393});await frame.locator('[data-ft=settings]').click();await frame.locator('.ft-dialog .ft-route-option').first().click();
 const rope=frame.locator('[data-ft=rope]');if(await rope.isEnabled()&&await rope.getAttribute('aria-pressed')==='false')await rope.click();
 const revision=(await session(page,id)).view.temple.revision;await frame.locator('[data-ft=primary]').click();await expect.poll(async()=>(await session(page,id)).view.temple.revision).toBeGreaterThan(revision);
 await expect(frame.locator('[data-ft=primary]')).toBeEnabled();await page.screenshot({path:out+'/temple-legacy-landscape.png'});
 await frame.locator('[data-ft=settings]').click();await frame.locator('.ft-dialog [data-ft=finish]').click();await frame.locator('.ft-dialog [data-ft=confirm-finish]').click();
 await expect(frame.locator('.ft-cascade')).toBeVisible();expect((await session(page,id)).rulesVersion).toBe(1);expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await frame.locator('[data-ft=primary]').click();await finish(page,frame,id);expect((await session(page,id)).rulesVersion).toBe(2);expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);
});

test('iframe animations keep their field and actions through both orientations',async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);
 for(const id of ids){
  await page.setViewportSize({width:393,height:852});const frame=await open(page,id);await page.emulateMedia({reducedMotion:'no-preference'});
  await frame.locator(profiles[id].primary).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.busy??(window as any).royalDemo.getMiniState()?.presenting)).toBe(true);
  await page.setViewportSize({width:852,height:393});await fit(page,frame,id);await page.setViewportSize({width:393,height:852});await fit(page,frame,id);
  await page.emulateMedia({reducedMotion:'reduce'});await finish(page,frame,id);
 }
});
