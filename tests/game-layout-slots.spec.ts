import {expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';

const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-slots';
const games=['studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-last-convoy','studio-nitro-run','studio-afterglow','studio-meme-overload'];
const family=(id:string)=>id==='studio-cosmic-escape'||id==='studio-velvet-reign'?'lg':'cc';
async function open(page:Page,id:string){
 await chooseGame(page,id);const prefix=family(id);
 await expect(page.locator('#mini-game>:is(.cc-game,.ce-game)')).toHaveAttribute('data-asset-state','ready',{timeout:40000});
 const intro=page.locator(`[data-${prefix}-${prefix==='lg'?'dialog-action':'action'}="enter"]`);
 if(await intro.isVisible())await intro.click();
 await expect(page.locator('.cc-dialog-backdrop,.ce-dialog-backdrop')).toBeHidden();
}
test('measure the seven active slots in their connected host',async({page,roomPath})=>{
 test.setTimeout(300000);await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);
 const rows:any[]=[];
 for(const id of process.env.LAYOUT_GAMES?.split(',')??games){
  await page.setViewportSize({width:1440,height:900});await open(page,id);
  for(const [width,height]of [[1440,900],[393,852],[852,393],[568,320]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
   const state=await page.locator('#mini-game').evaluate((host,prefix)=>{
    const root=host.firstElementChild!,board=root.querySelector<HTMLElement>(`[data-${prefix}-board]`)!,play=root.querySelector<HTMLElement>(`[data-${prefix}-spin]`)!;
    const rect=(e:Element)=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right};};
    const p=rect(play),hit=document.elementFromPoint(p.x+p.width/2,p.y+p.height/2);
    return{board:rect(board),play:p,playHit:!!hit&&play.contains(hit),hit:hit?.outerHTML.slice(0,200),root:rect(root),rootRows:getComputedStyle(root).gridTemplateRows,rootChildren:[...root.children].map(c=>({class:c.className,box:rect(c),display:getComputedStyle(c).display,visibility:getComputedStyle(c).visibility})),hud:[...root.querySelectorAll('.slot-feature-strip>*')].map(c=>({class:c.className,box:rect(c)})),sceneOverflow:[...root.querySelectorAll('.cc-scene,.ce-stage')].map(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth}))};
   },family(id));rows.push({id,width,height,...state});
   if([393,852,1440].includes(width))await page.screenshot({path:out+'/'+(process.env.LAYOUT_PHASE||'before')+'-'+id+'-'+width+'x'+height+'.png'});
  }
 }
 await writeFile(out+'/'+(process.env.LAYOUT_PHASE||'before')+'-audit.json',JSON.stringify({games,connectedHost:true,rows},null,2));
 console.log(JSON.stringify(rows.filter(r=>r.width===852).map(r=>({id:r.id,field:[Math.round(r.board.width),Math.round(r.board.height)],primary:r.playHit}))));
});

const sizes=[[1440,900],[1280,720],[768,1024],[1024,768],[393,852],[852,393],[320,568],[568,320]];
async function fit(page:Page,id:string,action?:string,modal=false){
 const prefix=family(id),primary=action||`[data-${prefix}-spin]`;
 await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const failures=await page.locator('#mini-game').evaluate((host,{prefix,primary,modal})=>{
  const root=host.firstElementChild!,selectors=[`[data-${prefix}-board]`,primary,`[data-${prefix}-stake]`,`[data-${prefix}-cost]`,'.slot-settings-button',`[data-${prefix}-auto]`,'.slot-feature-strip'];
  const failures:string[]=[];
  for(const selector of selectors){
   const el=root.querySelector<HTMLElement>(selector);if(!el){failures.push(selector+': missing');continue;}
   if(!el.getClientRects().length)continue;
   const box=el.getBoundingClientRect();if(!box.width||!box.height){failures.push(selector+': empty');continue;}
   for(let parent=el.parentElement;parent;parent=parent.parentElement){
    if(!/(hidden|auto|scroll|clip)/.test(getComputedStyle(parent).overflow))continue;
    const b=parent.getBoundingClientRect();if(box.left<b.left-2||box.top<b.top-2||box.right>b.right+2||box.bottom>b.bottom+2)failures.push(selector+': clipped by '+parent.className);
   }
   if(!modal&&el.matches('button,select')){const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);if(!hit||!el.contains(hit))failures.push(selector+': blocked');}
  }
  const stake=root.querySelector(`[data-${prefix}-stake]`)!.closest('.cc-stake,.ce-stake,.cx-stake')!.getBoundingClientRect();
  const cost=root.querySelector(`[data-${prefix}-cost]`)!.getBoundingClientRect();
  if(cost.top<stake.top-2||cost.bottom>stake.bottom+2)failures.push('whole-round price outside stake');
  const stage=host.closest('.mini-stage')!;if(stage.scrollHeight>stage.clientHeight+2||stage.scrollWidth>stage.clientWidth+2)failures.push('host scroll');
  return failures;
 },{prefix,primary,modal});
 expect(failures).toEqual([]);
 for(const selector of [primary,`[data-${prefix}-stake]`,'.slot-settings-button']){
  const box=await page.locator('#mini-game '+selector).boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(44);
 }
}
async function currentSession(page:Page,id:string){return page.evaluate(async id=>{const path='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */path)).expansionClient.sessions.find((s:any)=>s.gameId===id);},id);}
async function finish(page:Page,id:string){
 const p=family(id),attribute=p==='lg'?'data-lg-dialog-action':'data-cc-action';
 await expect.poll(async()=>{
  const dialog=page.locator('#mini-game :is(.cc-dialog,.ce-dialog)');
  if(await dialog.isVisible()){
   const kind=await dialog.getAttribute('data-dialog'),button=dialog.locator(`[${attribute}="${kind}"]`);
   if((kind==='bonus'||kind==='complete')&&await button.isEnabled())await button.click();
   return false;
  }
  const session=await currentSession(page,id),spin=page.locator(`[data-${p}-spin]`);
  if(session?.state==='settled'&&await spin.isEnabled())return true;
  if(session?.state==='active'&&await spin.isEnabled()){
   // A scheduled free spin can start between the readiness check and the click.
   try{await spin.click({timeout:process.env.LAYOUT_BROWSER==='webkit'?5000:1000});}catch(error){if(!(error instanceof Error)||error.name!=='TimeoutError')throw error;}
  }
  return false;
 },{timeout:process.env.LAYOUT_BROWSER==='webkit'?180000:90000,intervals:[100,250,500]}).toBe(true);
}
for(const id of games)test('field and actions without scrolling: '+id,async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await open(page,id);
 for(const [width,height]of sizes)await test.step(width+'x'+height,async()=>{await page.setViewportSize({width,height});await fit(page,id);});
});

for(const id of games)test('settings, Stop and one accepted ten-cent round: '+id,async({page,roomPath})=>{
 test.skip(process.env.LAYOUT_BROWSER==='webkit'&&!['studio-cosmic-escape','studio-caramel-carnival','studio-afterglow','studio-velvet-reign'].includes(id),'All seven flows run in Chromium; four distinct presentations also run with WebKit touch.');
 await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});await open(page,id);const p=family(id);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.slot-settings-button').click();
 if(process.env.LAYOUT_DEBUG==='1')console.log(await page.locator('.slot-secondary-controls').evaluate(root=>[root,...root.children,...root.querySelectorAll('.ce-sidebar>*')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{node:e.className,display:s.display,flexDirection:s.flexDirection,contain:s.contain,columns:s.gridTemplateColumns,rows:s.gridTemplateRows,area:s.gridArea,position:s.position,height:r.height,width:r.width,left:r.left,top:r.top};})));
 // The redesigned Cosmic Escape keeps speed and autoplay on the cabinet: a speed control and an autoplay panel.
 const cosmic=id==='studio-cosmic-escape';
 const fastSpeed=()=>cosmic?expect(page.locator('#mini-game [data-cx-speed="fast"]')).toHaveAttribute('aria-checked','true'):expect(page.locator(`[data-${p}-speed]`)).toHaveAttribute('aria-pressed','true');
 if(!cosmic){await page.locator(`[data-${p}-auto-count]`).selectOption('25');await page.locator(`[data-${p}-speed]`).click();}
 expect(errors).toEqual([]);
 if(!cosmic)await fastSpeed();
 if(id==='studio-velvet-reign'||id==='studio-afterglow')await page.screenshot({path:out+'/'+id+'-options.png'});
 await page.setViewportSize({width:852,height:393});await page.keyboard.press('Escape');await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('.slot-settings-button')).toBeFocused();
 if(cosmic){await page.locator('#mini-game [data-cx-speed-cycle]').click();await fastSpeed();}
 await fit(page,id);await page.setViewportSize({width:1440,height:900});await fit(page,id);
 await fastSpeed();
 if(!cosmic)await expect(page.locator(`[data-${p}-auto-count]`)).toHaveValue('25');await page.setViewportSize({width:393,height:852});
 await page.locator('.slot-settings-button').click();await fastSpeed();await page.keyboard.press('Escape');
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let request:any;
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){request=route.request().postDataJSON();await gate;}await route.continue();});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(`[data-${p}-auto]`).click();
 if(cosmic){const panel=page.locator('#mini-game [data-cx-auto-panel]');await expect(panel).toBeVisible();await panel.locator('[data-cx-auto-count="25"]').click();await panel.locator('[data-cx-auto-start]').click();await expect(panel).toBeHidden();}
 await expect.poll(()=>!!request).toBe(true);expect(request.stakeUnits).toBe('10');
 await expect(page.locator(`[data-${p}-auto]`)).toContainText('Стоп');await page.setViewportSize({width:852,height:393});await fit(page,id);
 await page.locator(`[data-${p}-auto]`).click();release();const paid=await response;expect(paid.ok(),await paid.text()).toBe(true);
 await finish(page,id);await page.unroute('**/api/demo-wallet/expansion');
 const snapshot=await walletSnapshot(page),bets=snapshot.entries.filter((e:any)=>e.kind==='bet');expect(bets).toHaveLength(1);expect(bets[0].amount).toBe(-0.1);
 await open(page,id);await finish(page,id);expect((await walletSnapshot(page)).entries).toEqual(snapshot.entries);await fit(page,id);
 for(const kind of ['info','history','purchase']){
  const selector=kind==='purchase'?'[data-cc-buy],[data-cosmic-missions],[data-velvet-missions]':`[data-${p}-${kind}]`;
  // Cosmic Escape keeps missions on the cabinet strip under the reels.
  if(cosmic&&kind==='purchase')await page.locator('#mini-game').locator(selector).click();
  else{await page.locator('.slot-settings-button').click();await page.locator('.slot-settings-dialog').locator(selector).click();}
  await expect(page.locator('.slot-settings-dialog')).toBeHidden();
  await expect(page.locator('#mini-game :is(.cc-dialog,.ce-dialog)')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#mini-game :is(.cc-dialog,.ce-dialog)')).toBeHidden();
 }
 expect((await walletSnapshot(page)).entries).toEqual(snapshot.entries);
 let lost=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(!lost&&route.request().method()==='POST'){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();
 });
 await page.locator(`[data-${p}-spin]`).click();await expect(page.locator(`[data-${p}-retry]`)).toBeVisible();
 await page.setViewportSize({width:568,height:320});await fit(page,id,`[data-${p}-retry]`);
 await open(page,id);const retry=page.locator(`[data-${p}-retry]`);
 if(await retry.isVisible())await retry.click();await finish(page,id);await page.unroute('**/api/demo-wallet/expansion');
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);
 await page.screenshot({path:out+'/'+id+'-result.png'});expect(errors).toEqual([]);
});

test('moving symbols retain their field through both phone orientations',async({page,roomPath})=>{
 test.setTimeout(240000);await enterGameHall(page,roomPath);
 for(const id of ['studio-cosmic-escape','studio-caramel-carnival','studio-velvet-reign','studio-afterglow']){
  await page.setViewportSize({width:393,height:852});await open(page,id);const p=family(id);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator(`[data-${p}-spin]`).click();await expect(page.locator('#mini-game > .slot-priority-game, #mini-game > .cx-game')).not.toHaveAttribute('data-phase','idle');
  await page.setViewportSize({width:852,height:393});await fit(page,id);await page.setViewportSize({width:393,height:852});await fit(page,id);
  await page.emulateMedia({reducedMotion:'reduce'});await finish(page,id);
 }
});

test('album, photo and themed menu remain accessible from the compact panel',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});await open(page,'studio-afterglow');
 const before=(await walletSnapshot(page)).entries;
 await page.locator('.slot-settings-button').click();await page.screenshot({path:out+'/studio-afterglow-options.png'});await page.locator('.slot-settings-dialog [data-ag-album]').click();
 await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.getByRole('heading',{name:'АЛЬБОМ ГЕРОИНЬ',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.locator('.slot-settings-button').click();await page.locator('.slot-settings-dialog [data-ag-photo]').click();
 await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('.slot-photo-viewer')).toBeVisible();
 await page.setViewportSize({width:852,height:393});await expect(page.locator('.slot-photo-viewer [aria-label="Закрыть фото"]')).toBeInViewport({ratio:1});
 await page.keyboard.press('Escape');await expect(page.locator('.slot-photo-viewer')).toBeHidden();await fit(page,'studio-afterglow');
 await open(page,'studio-meme-overload');
 for(const kind of ['info','history']){
  await page.locator('.slot-settings-button').click();await page.locator(`.slot-settings-dialog [data-mo-menu="${kind}"]`).click();
  await expect(page.locator('.slot-settings-dialog')).toBeHidden();await expect(page.locator('[data-cc-dialog]')).toHaveAttribute('data-dialog',kind);await page.keyboard.press('Escape');
 }
 expect((await walletSnapshot(page)).entries).toEqual(before);
});

test('natural bonuses keep counters and free continuation visible in both orientations',async({page,roomPath})=>{
 test.setTimeout(process.env.LAYOUT_BROWSER==='webkit'?900000:300000);await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);
 for(const id of games){
  await test.step(id,async()=>{
   await page.setViewportSize({width:393,height:852});await open(page,id);const p=family(id),attribute=p==='lg'?'data-lg-dialog-action':'data-cc-action';
   const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:id}});expect(fixture.ok(),await fixture.text()).toBe(true);
   const accepted=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator(`[data-${p}-spin]`).click();expect((await accepted).ok()).toBe(true);
   const bonus=page.locator(`[${attribute}="bonus"]`);await expect(bonus).toBeVisible({timeout:30000});
   for(const [width,height]of [[393,852],[852,393],[568,320]]){
    await page.setViewportSize({width,height});await fit(page,id,undefined,true);await expect(bonus).toBeInViewport({ratio:1});
   }
    await bonus.click();await expect(page.locator(`[data-${p}-pause]`)).toBeVisible({timeout:15000});await fit(page,id,`[data-${p}-pause]`);
   await page.locator(`[data-${p}-pause]`).click();await page.setViewportSize({width:393,height:852});await fit(page,id);
   const before=await walletSnapshot(page),debits=before.entries.filter((e:any)=>e.kind==='bet').length;
   await page.screenshot({path:out+'/'+id+'-bonus-portrait.png'});await page.setViewportSize({width:852,height:393});await fit(page,id);
   await page.screenshot({path:out+'/'+id+'-bonus-landscape.png'});await finish(page,id);
   expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(debits);
  });
 }
});
