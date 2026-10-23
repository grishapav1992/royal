import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {CABINETS,cabinetsInHall} from '../src/shared/cabinets';
import {ROYAL_PLATFORM_GAMES} from '../src/shared/arcadeCatalog';
import {worldPoint} from './room-ui';
const out='artifacts/royal-platform';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function enter(page:Page,path:string){
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`platform-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Royal-platform-check-123!');
 await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect(page.locator('#character-step')).toBeVisible();
 await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
 await expect.poll(async()=>(await state(page)).online).toBe(true);
}
async function approach(page:Page,id:string){
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 if((await state(page)).x<1100){
  const aisle=await worldPoint(page,1100,900);await page.mouse.click(aisle.x,aisle.y);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-1100,s.y-900);},{timeout:20000}).toBeLessThan(30);
 }
 const cabinet=CABINETS.find(c=>c.id===id)!;
 await page.locator('#games-tab').click();
 await page.locator(`[data-cabinet="${id}"]`).click();
 await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});
 await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game',cabinet.defaultGameId!);
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',cabinet.defaultGameId!,{timeout:25000});
 await expect(page.locator('#studio-game-list')).toBeInViewport();
 expect((await state(page)).cabinet).toBe(id);
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(async()=>(await state(page)).cabinet).toBe('');}
async function catalog(page:Page){
 await page.locator('#studio-game-list').click();
 await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game','royal-catalog');
 const menu=page.locator('#mini-game .royal-platform');await expect(menu).toBeVisible();
 await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();await expect(page.locator('#chat-input')).toBeInViewport();return menu;
}
async function choose(page:Page,id:string){
 await page.locator(`#mini-game [data-platform-game="${id}"]`).first().click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',id,{timeout:25000});
 await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game',id);
}

test('all twenty cabinets open their artwork game directly and expose the same complete platform',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.text().includes('texImage2D: bad image data'))errors.push(message.text());});
 await page.route('**/api/casinoapipro/status',route=>route.fulfill({json:{configured:false,walletConnected:false,currency:'DEMO',playerId:'test',balance:'0.00'}}));
 await enter(page,roomPath);
 for(const cabinet of cabinetsInHall('arcade')){
  console.log('Default cabinet',cabinet.id,cabinet.defaultGameId);
  await approach(page,cabinet.id);
  const menu=await catalog(page);
  expect(await menu.locator('[data-platform-game]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-platform-game')).sort())).toEqual([...ROYAL_PLATFORM_GAMES].sort());
  await menu.locator('[data-source=royal]').click();await expect(menu.locator('[data-platform-game]')).toHaveCount(40);
  await menu.locator('[data-source=github]').click();await expect(menu.locator('[data-platform-game]')).toHaveCount(10);
  expect((await state(page)).cabinet).toBe(cabinet.id);await close(page);
 }
 await page.screenshot({path:`${out}/hall-desktop.png`});
 expect(errors).toEqual([]);
});

test('saved games, balance, filters and default reentry survive changes in one physical seat',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/casinoapipro/status',route=>route.fulfill({json:{configured:false,walletConnected:false,currency:'DEMO',playerId:'test',balance:'0.00'}}));
 await enter(page,roomPath);
 await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
 await approach(page,'royal-fruits');let menu=await catalog(page);
 await menu.getByRole('searchbox').fill('несуществующая');await expect(menu.locator('.rp-card')).toHaveCount(0);await expect(menu.locator('.rp-empty')).toBeVisible();
 await menu.getByRole('searchbox').fill('orbit');await menu.getByRole('combobox',{name:'Жанр',exact:true}).selectOption('flight');await expect(menu.locator('.rp-card')).toHaveCount(1);
 await menu.getByRole('searchbox').fill('');await menu.getByRole('combobox',{name:'Жанр',exact:true}).selectOption('all');
 await page.screenshot({path:`${out}/catalog-desktop.png`});
 await choose(page,'studio-fossil-trail');await expect(page.locator('#mini-game [data-start]')).toBeEnabled();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('#mini-game [data-start]').click();
 const result=await response;expect(result.ok()).toBe(true);const saved=await result.json();expect(saved.session.state).toBe('active');
 const headers={'X-Royal-Account-Id':result.request().headers()['x-royal-account-id']};const wallet=await(await page.request.get('/api/demo-wallet',{headers})).json();
 await catalog(page);await choose(page,'royal-dice');expect((await state(page)).cabinet).toBe('royal-fruits');
 await catalog(page);await choose(page,'studio-fossil-trail');await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();await expect(page.locator('#mini-game [data-start]')).toHaveCount(0);
 const restored=await(await page.request.get('/api/demo-wallet/expansion',{headers})).json();expect(restored.sessions.find((s:any)=>s.gameId==='studio-fossil-trail').id).toBe(saved.session.id);
 const unchanged=await(await page.request.get('/api/demo-wallet',{headers})).json();expect(unchanged.balance).toBe(wallet.balance);expect(unchanged.entries.filter((e:any)=>e.operationId===saved.session.id&&e.kind==='bet')).toHaveLength(1);
 await close(page);await approach(page,'royal-fruits');expect((await state(page)).cabinet).toBe('royal-fruits');
 await catalog(page);await choose(page,'studio-fossil-trail');await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();
 await close(page);await approach(page,'luelon');await catalog(page);await choose(page,'studio-fossil-trail');await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();
 expect((await state(page)).cabinet).toBe('luelon');await close(page);expect(errors).toEqual([]);
});

test('provider games share the real mobile host and chat, preserve seats and clean up on switching',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let connected=true;let configured=true;let launchUrl='https://games.casinoapipro.com/play?session=platform-fixture';let sessions=0;let statusReads=0;
 await page.route('**/api/casinoapipro/status',route=>{statusReads++;return route.fulfill({json:{configured,walletConnected:connected,currency:'DEMO',playerId:'platform-fixture',balance:'1000.00'}});});
 await page.route('**/api/casinoapipro/games',route=>route.fulfill({json:{games:[{id:'fixture-slot',slug:'fixture-slot',name:'Provider Test Slot',category:'SLOTS',minBet:'1.00',maxBet:'100.00'}]}}));
 await page.route('**/api/casinoapipro/sessions',route=>{sessions++;return route.fulfill({json:{launchUrl}});});
 await page.route('https://games.casinoapipro.com/play?session=platform-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="background:#253d43;color:white;font:22px system-ui;padding:24px">Provider test game</body></html>'}));
 await enter(page,roomPath);await approach(page,'studio-velvet-reign');await page.setViewportSize({width:390,height:844});let menu=await catalog(page);
 await expect(menu.locator('[data-provider-game=fixture-slot]')).toBeVisible();
 await expect.poll(()=>menu.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:`${out}/catalog-mobile.png`});
 await menu.locator('[data-source=casinoapipro]').click();await choose(page,'casinoapipro');
 await expect(page.locator('#mini-dialog iframe')).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(page.locator('#chat-input')).toBeInViewport();await expect(page.locator('#studio-game-list')).toBeInViewport();
 await page.locator('#chat-input').fill('Чат внутри общего автомата');await page.locator('#send-chat').click();await expect(page.locator('#chat-log')).toContainText('Чат внутри общего автомата');
 expect((await state(page)).cabinet).toBe('studio-velvet-reign');expect(sessions).toBe(1);await page.screenshot({path:`${out}/provider-mobile-chat.png`});
 await page.setViewportSize({width:1440,height:1000});await expect(page.locator('#chat-input')).toBeInViewport();await expect(page.locator('#mini-dialog iframe')).toBeInViewport();await page.screenshot({path:`${out}/provider-desktop-chat.png`});
 menu=await catalog(page);await expect(page.locator('iframe')).toHaveCount(0);await choose(page,'royal-dice');expect((await state(page)).cabinet).toBe('studio-velvet-reign');
 const reads=statusReads;await page.waitForTimeout(3300);expect(statusReads).toBe(reads);
 await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:`${out}/github-mobile-chat.png`});
 connected=false;menu=await catalog(page);await menu.locator('[data-source=casinoapipro]').click();await expect(menu.locator('[data-provider-game=fixture-slot]')).toBeDisabled();expect(sessions).toBe(1);
 configured=false;await menu.locator('[data-provider-retry]').click();await expect(menu.locator('.rp-provider-status')).toContainText('пока не настроен');await menu.locator('[data-source=github]').click();await expect(menu.locator('.rp-card')).toHaveCount(10);
 configured=true;connected=true;await menu.locator('[data-source=casinoapipro]').click();await menu.locator('[data-provider-retry]').click();await expect(menu.locator('[data-provider-game=fixture-slot]')).toBeEnabled();
 launchUrl='https://example.test/forbidden';await choose(page,'casinoapipro');await expect(page.locator('#capro-message')).toContainText('недопустимый адрес');await expect(page.locator('iframe')).toHaveCount(0);
 menu=await catalog(page);await choose(page,'studio-cosmic-escape');await expect(page.locator('[data-cosmic-escape]')).toHaveAttribute('data-asset-state','ready',{timeout:30000});await page.locator('[data-lg-dialog-action=enter]').click();
 await expect(page.locator('#chat-input')).toBeInViewport();await expect(page.locator('#studio-game-list')).toBeInViewport();await page.screenshot({path:`${out}/royalgames-mobile-chat.png`});
 await close(page);expect(errors).toEqual([]);
});
