import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {cabinetsInHall} from '../src/shared/cabinets';
import {collectionGames} from '../src/shared/arcadeCatalog';
const out='artifacts/work/cabinet-groups/proof';
const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function enter(page:Page,path:string){
 await page.route('https://luelonplay.com/demo-api/**',route=>route.fulfill({json:{games:[{id:'fixture-demo',name:'Luelon Test Demo',category:'slot',embedUrl:'https://luelonplay.com/embed/fixture-demo'}]}}));
 await page.route('https://luelonplay.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Luelon demo fixture</body></html>'}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`groups-${crypto.randomUUID()}@example.test`);
 await page.getByLabel('Пароль',{exact:true}).fill('Royal-groups-check-123!');
 await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect(page.locator('#character-step')).toBeVisible();
 await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
 await expect.poll(async()=>(await state(page)).online).toBe(true);
}
async function approach(page:Page,id:string){
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await expect.poll(async()=>page.evaluate(()=>Math.abs((window as any).royalDemo.getState().view.width-document.getElementById('game')!.clientWidth))).toBeLessThanOrEqual(1);
 if((await state(page)).x<1100){
  await page.locator('#game').focus();
  await page.keyboard.down('ArrowDown');
  try {await expect.poll(async()=>(await state(page)).y,{timeout:15000,intervals:[25]}).toBeGreaterThan(900);} finally {await page.keyboard.up('ArrowDown');}
  await page.keyboard.down('ArrowRight');
  try {await expect.poll(async()=>(await state(page)).x,{timeout:15000,intervals:[25]}).toBeGreaterThan(1100);} finally {await page.keyboard.up('ArrowRight');}
 }
 await page.locator('#games-tab').click();await page.locator(`[data-cabinet="${id}"]`).click();
 await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});
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

test('all nineteen cabinets have their own collection, independent seating and an isolated Luelon demo',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/casinoapipro/status',route=>route.fulfill({json:{configured:false,walletConnected:false,currency:'DEMO',playerId:'test',balance:'0.00'}}));
 await enter(page,roomPath);
 for(const cabinet of cabinetsInHall('arcade')){
  await approach(page,cabinet.id);
  if(cabinet.collection==='luelon'){
   await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','luelon',{timeout:25000});
   await expect(page.locator('#mini-dialog iframe')).toBeVisible();await expect(page.locator('#studio-game-list')).toBeHidden();
   await page.locator('#all-demo-games').click();await expect(page.locator('[data-demo-game=fixture-demo]')).toBeVisible();
  }else{
   await expect(page.locator('#mini-game')).toHaveAttribute('data-collection',cabinet.collection!);
   const menu=page.locator('.royal-platform');
   await expect(page.locator('#chat-input')).toBeInViewport();
   const ids=await menu.locator('[data-platform-game]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-platform-game')).sort());
   expect(ids).toEqual(cabinet.collection==='casinoapipro'?[]:[...collectionGames(cabinet.collection!)].sort());
   await expect(menu.locator('[data-source]')).toHaveCount(1);
   await expect(menu.getByRole('combobox',{name:'Жанр',exact:true})).toBeVisible();
  }
  await close(page);
 }
 await page.screenshot({path:`${out}/hall-desktop.png`});expect(errors).toEqual([]);
});

test('Royal search, genre, wallet and saved rounds survive switching and reopening on desktop and mobile',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await enter(page,roomPath);
 await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
 await approach(page,'studio-cosmic-escape');let menu=page.locator('.royal-platform');
 await menu.getByRole('searchbox').fill('несуществующая');await expect(menu.locator('.rp-card')).toHaveCount(0);
 await menu.getByRole('searchbox').fill('orbit');await menu.getByRole('combobox',{name:'Жанр',exact:true}).selectOption('flight');await expect(menu.locator('.rp-card')).toHaveCount(1);
 await menu.getByRole('searchbox').fill('');await menu.getByRole('combobox',{name:'Жанр',exact:true}).selectOption('all');
 await page.screenshot({path:`${out}/royal-desktop.png`});
 await choose(page,'studio-fossil-trail');await expect(page.locator('#mini-game [data-start]')).toBeEnabled();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('#mini-game [data-start]').click();
 const result=await response;expect(result.ok()).toBe(true);const saved=await result.json();expect(saved.session.state).toBe('active');
 const headers={'X-Royal-Account-Id':result.request().headers()['x-royal-account-id']};const wallet=await(await page.request.get('/api/demo-wallet',{headers})).json();
 await catalog(page);await choose(page,'royal-plinko');await catalog(page);await choose(page,'studio-fossil-trail');
 await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();
 await close(page);await approach(page,'studio-caramel-carnival');await choose(page,'studio-fossil-trail');
 await expect(page.locator('#mini-game [data-mine]').first()).toBeEnabled();
 const restored=await(await page.request.get('/api/demo-wallet/expansion',{headers})).json();expect(restored.sessions.find((s:any)=>s.gameId==='studio-fossil-trail').id).toBe(saved.session.id);
 const unchanged=await(await page.request.get('/api/demo-wallet',{headers})).json();expect(unchanged.balance).toBe(wallet.balance);expect(unchanged.entries.filter((e:any)=>e.operationId===saved.session.id&&e.kind==='bet')).toHaveLength(1);
 await page.setViewportSize({width:390,height:844});menu=await catalog(page);await expect(page.locator('#chat-input')).toBeInViewport();
 expect(await menu.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:`${out}/royal-mobile.png`});
 await close(page);await approach(page,'royal-dice');await choose(page,'royal-dice');await expect(page.locator('#chat-input')).toBeInViewport();
 await page.screenshot({path:`${out}/github-mobile.png`});await close(page);expect(errors).toEqual([]);
});

test('all three provider seats share their catalogue and cleanly host the iframe and connected chat',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let connected=true;let configured=true;let launchUrl='https://games.casinoapipro.com/play?session=groups-fixture';let sessions=0;
 await page.route('**/api/casinoapipro/status',route=>route.fulfill({json:{configured,walletConnected:connected,currency:'DEMO',playerId:'groups-fixture',balance:'1000.00'}}));
 await page.route('**/api/casinoapipro/games',route=>route.fulfill({json:{games:[{id:'fixture-slot',slug:'fixture-slot',name:'Provider Test Slot',category:'SLOTS',minBet:'1.00',maxBet:'100.00'}]}}));
 await page.route('**/api/casinoapipro/sessions',route=>{sessions++;return route.fulfill({json:{launchUrl}});});
 await page.route('https://games.casinoapipro.com/play?session=groups-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="background:#253d43;color:white">Provider test game</body></html>'}));
 await enter(page,roomPath);
 for(const id of ['casinoapipro','casinoapipro-2','casinoapipro-3']){
  await approach(page,id);await expect(page.locator('[data-provider-game=fixture-slot]')).toBeEnabled();await expect(page.locator('[data-platform-game]')).toHaveCount(1);
  await choose(page,'casinoapipro');await expect(page.locator('#mini-dialog iframe')).toBeVisible();expect((await state(page)).cabinet).toBe(id);
  await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(page.locator('#chat-input')).toBeInViewport();
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();await expect(page.locator('#mini-dialog iframe')).toBeInViewport();
  const message={casinoapipro:'Проверяем связь с первым автоматом','casinoapipro-2':'Сменил место, игра работает','casinoapipro-3':'Открыл третий автомат, чат рядом'}[id]!;
  await page.locator('#chat-input').fill(message);await page.locator('#send-chat').click();await expect(page.locator('#chat-log > [data-message-id]').filter({hasText:message})).toBeVisible();
  await page.screenshot({path:`${out}/provider-mobile.png`});
  await page.setViewportSize({width:1440,height:1000});await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:`${out}/provider-desktop.png`});await catalog(page);await expect(page.locator('iframe')).toHaveCount(0);await close(page);
 }
 expect(sessions).toBe(3);connected=false;await approach(page,'casinoapipro-2');let menu=page.locator('.royal-platform');
 await expect(menu.locator('[data-provider-game=fixture-slot]')).toBeDisabled();
 configured=false;await menu.locator('[data-provider-retry]').click();await expect(menu.locator('.rp-provider-status')).toContainText('пока не настроен');
 configured=true;connected=true;await menu.locator('[data-provider-retry]').click();await expect(menu.locator('[data-provider-game=fixture-slot]')).toBeEnabled();
 launchUrl='https://example.test/forbidden';await choose(page,'casinoapipro');await expect(page.locator('#capro-message')).toContainText('недопустимый адрес');await expect(page.locator('iframe')).toHaveCount(0);
 await close(page);expect(errors).toEqual([]);
});
