import {expect, type Page} from '@playwright/test';
import {test} from './themed-room';
import {mkdir, writeFile} from 'node:fs/promises';
import {chooseGame} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';

const game='studio-caramel-carnival';
const out=process.env.LAYOUT_ARTIFACTS_DIR||'artifacts/work/caramel-design-polish';
const sizes=[[1440,900],[1280,720],[1024,768],[768,1024],[728,803],[393,852],[852,393],[320,568],[568,320]];
async function open(page:Page){
 await chooseGame(page,game);
 await expect(page.locator('[data-caramel-game]')).toHaveAttribute('data-asset-state','ready');
 await page.locator('[data-cc-action="enter"]').click();
}
async function enter(page:Page,roomPath:string){
 const login=await page.request.post('/api/auth/login',{data:{email:`caramel-${crypto.randomUUID()}@example.test`,password:'Caramel-QA-only-123!'}});expect(login.ok()).toBe(true);
 await page.request.post('/api/auth/character',{data:{skin:0,name:'Caramel QA'}});
 const credit=await page.request.post('/__test/layout/topup');expect(credit.ok()).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(roomPath+'&mode=club');
 await expect(page.locator('#games-tab')).toBeVisible({timeout:60000});
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await expect.poll(async()=>{
  if(await page.locator('.royal-platform').isVisible())return true;
  try{if(!await page.locator('[data-cabinet="studio-caramel-carnival"]').isVisible())await page.locator('#games-tab').click({timeout:3000});
   await page.locator('[data-cabinet="studio-caramel-carnival"]').click({timeout:3000});}catch(e){if(!(e instanceof Error&&e.name==='TimeoutError'))throw e;}
  return page.locator('.royal-platform').isVisible();
 },{timeout:60000}).toBe(true);
 await expect(page.locator('.royal-platform')).toBeVisible({timeout:60000});
}
async function fit(page:Page){
 await expect.poll(()=>page.locator('[data-caramel-game]').evaluate(root=>{
  const problems:string[]=[];
  const essential=['[data-cc-board]','[data-cc-spin]','[data-cc-cost]','[data-manual-stake]','[data-cc-rules]','.slot-settings-button','[data-cc-auto]','.ccf-tickets','.ccf-slots','.ccf-energy','.ccf-energy-main','.ccf-fest','[data-cc-buy]'];
  for(const selector of essential){
   const el=root.querySelector<HTMLElement>(selector)!;if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
   if(r.width<2||r.height<2||r.top<0||r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1)problems.push(selector+': outside viewport');
   for(let parent=el.parentElement;parent;parent=parent.parentElement){
    if(!/(hidden|clip|auto|scroll)/.test(getComputedStyle(parent).overflow))continue;
    const p=parent.getBoundingClientRect();if(r.left<p.left-2||r.top<p.top-2||r.right>p.right+2||r.bottom>p.bottom+2)problems.push(selector+': clipped');
   }
   if(el.matches('button,input')){const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!hit||!el.contains(hit))problems.push(selector+': covered');}
  }
  const help=root.querySelector<HTMLElement>('.ccf-wallet-help')!;
  if(!help.hidden){const h=help.getBoundingClientRect();for(const selector of ['.ccf-tickets','.ccf-energy','.ccf-fest','[data-cc-board]']){const r=root.querySelector(selector)!.getBoundingClientRect();if(h.left<r.right&&h.right>r.left&&h.top<r.bottom&&h.bottom>r.top)problems.push('wallet help overlaps '+selector+' '+JSON.stringify({help:{top:h.top,bottom:h.bottom},card:{top:r.top,bottom:r.bottom}}));}}
  return problems;
 })).toEqual([]);
}
test('Caramel keeps prices, rules and cards readable in the connected host',async({page,roomPath})=>{
 test.setTimeout(180000);await mkdir(out,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await enter(page,roomPath);
 await expect(page.locator('[data-platform-game="'+game+'"]')).toContainText('До 20 каскадов');
 await open(page);
 const measurements=[];
 for(const [width,height] of sizes){
  await page.setViewportSize({width,height});await test.step(`${width}x${height}`,async()=>{try{await fit(page);}catch(e){await page.screenshot({path:out+`/failure-${width}x${height}.png`});throw e;}});
  await expect(page.locator('[data-cc-cost]')).toHaveText('Ставка · USDT за вращение');
  await expect(page.locator('.mini-top .settings-shortcut')).toBeHidden();
  if(width===1440)await expect(page.locator('#club-chat-dock')).toBeVisible();
  if(width===393||width===852)await expect(page.locator('#mini-dialog .game-chat-toggle')).toBeVisible();
  const board=await page.locator('[data-cc-board]').boundingBox();measurements.push({width,height,board});
  if([1440,728,393,852].includes(width))await page.screenshot({path:out+'/caramel-'+width+'x'+height+'.png'});
 }
 await page.setViewportSize({width:393,height:852});await page.locator('[data-cc-rules]').click();
 const rules=page.locator('[data-cc-dialog]');await expect(rules).toContainText('До 20 выигрышных каскадов');
 await expect(rules).not.toContainText('Выплаты округляются вниз');await expect(rules.locator('.cc-info-scroll [data-stake-rules]')).toHaveCount(1);
 await page.keyboard.press('Escape');await expect(page.locator('[data-cc-rules]')).toBeFocused();
 await writeFile(out+'/layout.json',JSON.stringify(measurements,null,2));expect(errors).toEqual([]);
});
test('Caramel guest notice occupies its own row',async({page})=>{
 test.setTimeout(120000);await page.goto('/?offline=1&lang=ru');await page.locator('#games-tab').click();
 await page.locator('[data-cabinet="studio-caramel-carnival"]').click();
 await expect(page.locator('.royal-platform')).toBeVisible({timeout:60000});await open(page);
 for(const [width,height] of [[728,803],[393,852],[852,393],[568,320]]){
  await page.setViewportSize({width,height});await test.step(`${width}x${height}`,async()=>{try{await fit(page);}catch(e){await page.screenshot({path:out+`/failure-${width}x${height}.png`});throw e;}});
  await expect(page.locator('[data-cc-wallet-help]')).toBeVisible();
  await expect(page.locator('[data-cc-spin]')).toBeDisabled();
 }
 await page.screenshot({path:out+'/caramel-guest.png'});
});

async function finish(page:Page){
 await expect.poll(async()=>{
  const dialog=page.locator('[data-cc-dialog]');
  if(await dialog.isVisible()){
   const action=await dialog.getAttribute('data-dialog');
   if(action==='bonus'||action==='complete')await dialog.locator(`[data-cc-action="${action}"]`).click();
   return false;
  }
  const active=await page.locator('[data-caramel-game]').getAttribute('data-festival');
  const spin=page.locator('[data-cc-spin]');
  if(active==='true'&&await spin.isEnabled()){await spin.click();return false;}
  return active==='false'&&await spin.isEnabled();
 },{timeout:90000,intervals:[100,250]}).toBe(true);
}
test('Caramel distinguishes speed-up from Stop and recovers one accepted debit',async({page,roomPath})=>{
 test.setTimeout(180000);await enter(page,roomPath);await open(page);
 await page.emulateMedia({reducedMotion:'no-preference'});
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let accepted:any;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const response=await route.fetch();accepted=await response.json();await gate;await route.fulfill({response});
 });
 await page.locator('[data-cc-spin]').click();
 await expect(page.locator('[data-cc-spin]')).toHaveText('УСКОРИТЬ');
 await expect(page.locator('.ccf-accelerate-icon')).toBeVisible();await expect(page.locator('.ccf-stop-icon')).toBeHidden();
 await page.locator('[data-cc-spin]').click();release();await finish(page);await page.unroute('**/api/demo-wallet/expansion');
 const initial=await walletSnapshot(page);expect(initial.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 expect(initial.entries.find((e:any)=>e.kind==='bet').amount).toBe(-0.1);
 expect(accepted.session.stakeUnits).toBe('10');
 await open(page);await expect(page.locator('[data-cc-spin]')).toBeEnabled();
 expect((await walletSnapshot(page)).entries).toEqual(initial.entries);
 let lost=false;
 await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();return route.abort('failed');}
  return route.continue();
 });
 await page.locator('[data-cc-spin]').click();await expect(page.locator('[data-cc-retry]')).toBeVisible({timeout:30000});
 await page.locator('[data-cc-retry]').click();await finish(page);
 expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);
 await page.unroute('**/api/demo-wallet/expansion');
});
test('Caramel festival pause has a visible Continue action in both phone orientations',async({page,roomPath})=>{
 test.setTimeout(180000);await enter(page,roomPath);await open(page);await page.setViewportSize({width:393,height:852});
 const fixture=await page.request.post('/__test/layout/bonus',{data:{gameId:game}});expect(fixture.ok()).toBe(true);
 await page.locator('[data-cc-spin]').click();await expect(page.locator('[data-cc-action="bonus"]')).toBeVisible({timeout:30000});
 await page.locator('[data-cc-action="bonus"]').click();await expect(page.locator('[data-cc-pause]')).toBeEnabled();await page.locator('[data-cc-pause]').click();
 await expect(page.locator('[data-cc-spin]')).toBeEnabled({timeout:30000});await expect(page.locator('[data-cc-spin]')).toContainText('ПРОДОЛЖИТЬ');
 const before=await walletSnapshot(page);expect(before.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 for(const [width,height] of [[393,852],[852,393]]){
  await page.setViewportSize({width,height});await fit(page);await page.screenshot({path:out+`/caramel-festival-${width}x${height}.png`});
 }
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('[data-cc-spin]').click();
 await expect(page.locator('[data-cc-groups] .ccf-group').first()).toBeVisible({timeout:60000});
 const groupText=await page.locator('[data-cc-groups]').innerText();expect(groupText).toMatch(/\d+ символов → \d+,\d{2} USDT/);expect(groupText).not.toContain(' × ');
 const geometry=await page.locator('.ccf-outcome').evaluate(e=>{const board=document.querySelector('.ccf-frame')!.getBoundingClientRect(),r=e.getBoundingClientRect(),root=e.closest('[data-caramel-game]')!.getBoundingClientRect();return {gap:r.top-board.bottom,bottom:r.bottom,limit:root.bottom};});
 expect(geometry.gap).toBeGreaterThanOrEqual(0);expect(geometry.gap).toBeLessThanOrEqual(20);expect(geometry.bottom).toBeLessThanOrEqual(geometry.limit);
 const chip=page.locator('[data-cc-energy-chip]');
 if(await chip.isVisible()){
  const box=await chip.boundingBox(),card=await page.locator('.ccf-energy').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(card!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(card!.x+card!.width);
 }
 await page.screenshot({path:out+'/caramel-win.png'});
 await page.locator('[data-cc-pause]').click();await page.emulateMedia({reducedMotion:'reduce'});
 await finish(page);expect((await walletSnapshot(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
});
