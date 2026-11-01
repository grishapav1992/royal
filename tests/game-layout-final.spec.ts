import {expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from './themed-room';
import {enterGameHall,chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';
const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/game-layout-final';
const profiles={
 'royal-roulette':{root:'.rr-root',field:'.rr-wheel',main:'[data-rr-spin]',stake:'.rr-compact-stake select',essential:['[data-rr-selection]','[data-rr-payout]','[data-rr-balance]']},
 'github-crash':{root:'.last-exit',field:'.le-stage',main:'[data-start]:not([hidden]),[data-cashout]:not([hidden])',stake:'[data-stake]',essential:['[data-balance]','[data-value]']},
 'original-cr-vs-leo':{root:'.cr-leo',field:'.cl-stage',main:'[data-shoot]',stake:'[data-stake]',essential:['[data-balance]','.cl-risks','.cl-progress','.cl-pips']},
 'original-jackie-chan':{root:'.jackie',field:'.jc-stage',main:'[data-fight]',stake:'[data-stake]',essential:['[data-balance]','.jc-risk-options','[data-path]','[data-takes]','.jc-collection-line']},
};
type Id=keyof typeof profiles;
const ids=Object.keys(profiles) as Id[];
const sizes=[[1440,900],[1280,720],[768,1024],[1024,768],[393,852],[852,393],[320,568],[568,320]];
async function fit(page:Page,id:Id,extra:string[]=[]){
 const p=profiles[id];await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const recovering=id!=='royal-roulette'&&await page.locator(p.root+' [data-recovery]').isVisible();
 const main=recovering?'[data-recovery] [data-retry]':p.main;
 const essential=recovering&&id==='original-jackie-chan'?p.essential.filter(s=>s!=='.jc-risk-options'):p.essential;
 const selectors=[p.field,main,...essential,...extra];
 selectors.push(id==='royal-roulette'&&await page.locator(p.root).getAttribute('data-priority-layout')==='full'?'.rr-chips':p.stake);
 const failures=await page.evaluate(selectors=>{
  const errors:string[]=[];
  for(const selector of selectors){const el=document.querySelector<HTMLElement>(selector);if(!el||!el.getClientRects().length){errors.push(selector+': missing');continue;}
   const b=el.getBoundingClientRect();if(b.width<1||b.height<1||b.top< -1||b.left< -1||b.bottom>innerHeight+1||b.right>innerWidth+1)errors.push(selector+': outside viewport');
   for(let parent=el.parentElement;parent;parent=parent.parentElement){if(!/(hidden|clip|auto|scroll)/.test(getComputedStyle(parent).overflow))continue;const r=parent.getBoundingClientRect();if(b.top<r.top-2||b.left<r.left-2||b.right>r.right+2||b.bottom>r.bottom+2)errors.push(selector+': clipped by '+parent.className);}
   if(el.matches('button,select')){const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!hit||!el.contains(hit))errors.push(selector+': obstructed');}
  }
  const stage=document.querySelector('.mini-stage')!;if(stage.scrollHeight>stage.clientHeight+2||stage.scrollWidth>stage.clientWidth+2)errors.push('host needs scrolling');return errors;
 },selectors);expect(failures).toEqual([]);
 expect((await page.locator(main).first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
}
async function open(page:Page,id:Id){await chooseGame(page,id);const p=profiles[id];await expect(page.locator(p.root)).toHaveAttribute('data-priority-layout',/full|portrait|landscape/);
 if(id==='github-crash')await expect(page.locator(p.root)).toHaveAttribute('data-asset-state','ready',{timeout:30000});
 if(id==='original-cr-vs-leo'||id==='original-jackie-chan')await expect(page.locator(p.root)).toHaveAttribute('data-loading','false',{timeout:30000});
}
async function session(page:Page,id:Id){return page.evaluate(async id=>{const path='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */path)).expansionClient.sessions.find((s:any)=>s.gameId===id);},id);}
async function finish(page:Page,id:Id){
 if(id==='royal-roulette'){await expect(page.locator('[data-rr-spin]')).toBeEnabled({timeout:30000});return;}
 await expect.poll(async()=>{const s=await session(page,id);const main=page.locator(profiles[id].main).first();if(s?.state==='settled'&&await main.isEnabled())return true;
  const take=page.locator(id==='github-crash'?'.last-exit [data-cashout]':id==='original-cr-vs-leo'?'.cr-leo [data-take]':'.jackie [data-cashout]');
  if(s?.state==='active'&&await take.isVisible()&&await take.isEnabled())await take.click();return false;
 },{timeout:45000,intervals:[100,250,500]}).toBe(true);
}
for(const id of ids)test('field and essential actions without scrolling: '+id,async({page,roomPath})=>{
 await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);await open(page,id);const rows=[];
 for(const [width,height]of sizes){await page.setViewportSize({width,height});await test.step(width+'x'+height,()=>fit(page,id));
  if(width===1440)await expect(page.locator('#club-chat-dock')).toBeVisible();if(width===393||width===852)await expect(page.locator('#mini-dialog .game-chat-toggle')).toBeVisible();
  rows.push({width,height,field:await page.locator(profiles[id].field).boundingBox()});if([1440,393,852].includes(width))await page.screenshot({path:out+'/'+id+'-'+width+'x'+height+'.png'});
 }
 await writeFile(out+'/'+id+'-sizes.json',JSON.stringify(rows,null,2));
});
for(const id of ids)test('settings, paid round, reopen and lost response: '+id,async({page,roomPath})=>{
 await mkdir(out,{recursive:true});await enterGameHall(page,roomPath);await page.setViewportSize({width:393,height:852});await open(page,id);
 const p=profiles[id],root=page.locator(p.root),gear=root.locator('[data-options]'),panel=root.locator('.game-options-panel');const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await gear.click();await expect(panel).toBeVisible();
 if(id==='royal-roulette'){await panel.locator('[data-rr-value="17"]').click();await expect(panel.locator('[data-rr-value="17"]')).toHaveAttribute('aria-pressed','true');}
 if(id==='original-cr-vs-leo')await panel.locator('[data-hero=leo]').click();
 let location='';
 if(id==='original-jackie-chan'){await panel.locator('[data-location]').selectOption({index:1});location=await panel.locator('[data-location]').inputValue();await panel.locator('[data-speed]').click();}
 if(id==='royal-roulette'){
  for(const button of await panel.locator('[data-rr-bet]').all()){const box=await button.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);}
  await page.screenshot({path:out+'/'+id+'-options.png'});await panel.locator('.rr-rules summary').click();await expect(panel.locator('.rr-rules')).toHaveAttribute('open','');
 }
 else{
  await panel.locator('[data-rules]').click();await expect(panel).toBeHidden();
  const rules=root.locator(id==='github-crash'?'.le-dialog':id==='original-cr-vs-leo'?'.cl-dialog':'[data-dialog]');await expect(rules).toBeVisible();await rules.locator('[data-close]').click();await expect(gear).toBeFocused();await gear.click();
 }
 if(id!=='royal-roulette')await page.screenshot({path:out+'/'+id+'-options.png'});await page.setViewportSize({width:852,height:393});await panel.press('Escape');await expect(panel).toBeHidden();await expect(gear).toBeFocused();await fit(page,id);
 await page.setViewportSize({width:1440,height:900});await fit(page,id);await page.setViewportSize({width:393,height:852});
 if(id==='original-cr-vs-leo')await expect(root.locator('button[data-hero=leo]')).toHaveAttribute('aria-pressed','true');
 if(id==='original-jackie-chan'){await expect(root.locator('[data-location]')).toHaveValue(location);await expect(root.locator('[data-speed]')).toHaveAttribute('aria-pressed','true');}
 if(id==='royal-roulette'){await expect(root.locator('[data-rr-selection]')).toContainText('17');await root.locator(p.stake).selectOption('0.1');}
 else await root.locator(p.stake).selectOption('10');
 let release!:()=>void,seen=false;const gate=new Promise<void>(r=>release=r),endpoint=id==='royal-roulette'?'**/api/demo-wallet/operations':'**/api/demo-wallet/expansion';
 await page.route(endpoint,async route=>{if(route.request().method()==='POST'){seen=true;await gate;}await route.continue();});
 await root.locator(p.main).first().click();await expect.poll(()=>seen).toBe(true);await page.setViewportSize({width:852,height:393});await fit(page,id);release();await finish(page,id);await page.unroute(endpoint);
 const first=await walletSnapshot(page);expect(first.entries.filter((e:any)=>e.kind==='bet').map((e:any)=>e.amount)).toEqual([-0.1]);
 await open(page,id);await finish(page,id);expect((await walletSnapshot(page)).entries).toEqual(first.entries);
 let lost=false;const operations:string[]=[];await page.route(endpoint,async route=>{if(route.request().method()==='POST'){operations.push(route.request().postDataJSON().id);if(!lost){lost=true;await route.fetch();await route.abort('failed');return;}}await route.continue();});
 await root.locator(p.main).first().click();await expect.poll(()=>lost).toBe(true);
 const retry=()=>root.locator(id==='royal-roulette'?'[data-rr-spin]':'[data-retry]');await expect(retry()).toBeVisible();await expect(retry()).toBeEnabled();
 await page.setViewportSize({width:568,height:320});await fit(page,id,id==='royal-roulette'?[]:['[data-retry]']);await retry().click();await finish(page,id);await page.unroute(endpoint);
 expect(operations.length).toBeGreaterThanOrEqual(2);expect(operations[0]).toBe(operations[1]);expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);expect(errors).toEqual([]);
});

test('free series choices, cashout and collections survive rotation',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);
 for(const id of ['original-cr-vs-leo','original-jackie-chan'] as const){
  await page.setViewportSize({width:393,height:852});await open(page,id);const root=page.locator(profiles[id].root);
  const seeded=await page.request.post('/__test/layout/bonus',{data:{gameId:id}});expect(seeded.ok(),await seeded.text()).toBe(true);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await root.locator(profiles[id].main).click();expect((await response).ok()).toBe(true);
  const take=id==='original-cr-vs-leo'?'[data-take]':'[data-cashout]';await expect(root.locator(take)).toBeVisible({timeout:30000});await expect(root.locator(profiles[id].main)).toBeEnabled();
  const accepted=await session(page,id);expect(accepted.state).toBe('active');
  for(const [width,height]of sizes){await page.setViewportSize({width,height});await fit(page,id,[take]);for(const button of await root.locator('[data-risk]').all()){const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);}}
  await open(page,id);expect((await session(page,id)).id).toBe(accepted.id);await expect(root.locator(take)).toBeVisible();await root.locator('[data-risk=extreme]').click();await root.locator(profiles[id].main).click();await expect(root.locator(take)).toBeVisible({timeout:30000});await expect(root.locator(take)).toBeEnabled();
  const s=await session(page,id),shots=id==='original-cr-vs-leo'?s.view.penalty.shots:s.view.jackie.combat.shots;expect(shots).toHaveLength(2);expect(shots[1].risk).toBe('extreme');
  await page.setViewportSize({width:852,height:393});await fit(page,id,[take]);await page.screenshot({path:out+'/'+id+'-series-landscape.png'});await root.locator(take).click();await finish(page,id);
  expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(id==='original-cr-vs-leo'?1:2);
  if(id==='original-jackie-chan'){await root.locator('[data-gallery]').click();await expect(root.locator('[data-dialog]')).toBeVisible();await page.screenshot({path:out+'/jackie-wardrobe.png'});await root.locator('[data-close]').click();}
 }
});

test('moving wheel, chase, shot and fight remain visible through both orientations',async({page,roomPath})=>{
 await enterGameHall(page,roomPath);await page.emulateMedia({reducedMotion:'no-preference'});
 for(const id of ids){
  await page.setViewportSize({width:393,height:852});await open(page,id);const root=page.locator(profiles[id].root);
  const endpoint=id==='royal-roulette'?'/api/demo-wallet/operations':'/api/demo-wallet/expansion';const response=page.waitForResponse(r=>r.url().endsWith(endpoint)&&r.request().method()==='POST');
  await root.locator(profiles[id].main).first().click();expect((await response).ok()).toBe(true);
  if(id==='royal-roulette')await expect(root).toHaveAttribute('data-motion-phase',/launch|orbit|coast|drop/);
  if(id==='github-crash')await expect(root).toHaveAttribute('data-motion-phase',/waiting|racing/);
  if(id==='original-cr-vs-leo')await expect(root.locator('[data-shoot]')).toContainText('МЯЧ В ИГРЕ');
  if(id==='original-jackie-chan')await page.waitForFunction(()=>{const s=(window as any).royalDemo.getMiniState();return s?.busy===true&&s.phase!=='ready';});
  for(const [width,height]of [[852,393],[393,852]]){await page.setViewportSize({width,height});await fit(page,id);}
  await finish(page,id);expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(ids.indexOf(id)+1);
 }
});
