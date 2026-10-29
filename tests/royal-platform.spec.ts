import {sandboxTopUp} from './sandbox-topup';
import {expect,type Page} from '@playwright/test';
import {test} from './themed-room';
import {cabinetsInHall} from '../src/shared/cabinets';
import {collectionGames} from '../src/shared/arcadeCatalog';
const out=process.env.ROYAL_FLOOR_PROOF_DIR||'artifacts/work/royal-floor-one-only/proof';
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
 await page.locator('#games-tab').click();await page.locator(`[data-cabinet="${id}"]`).click();
 await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});
 await expect.poll(async()=>(await state(page)).cabinet).toBe(id);
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


test('the first floor exposes only twelve Royal cabinets and catalogues with connected chat',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);
 await expect(page.locator('[data-cabinet-collection=github]')).toHaveCount(0);
 expect(cabinetsInHall('arcade')).toHaveLength(12);
 for(const cabinet of cabinetsInHall('arcade')){
  await approach(page,cabinet.id);const menu=page.locator('.royal-platform');
  const ids=await menu.locator('[data-platform-game]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-platform-game')).sort());
  expect(ids).toEqual([...collectionGames('royal')].sort());await choose(page,cabinet.id);await expect(page.locator('#chat-input')).toBeInViewport();await close(page);
 }
 await page.screenshot({path:out+'/hall-desktop.png'});expect(errors).toEqual([]);
});

test('a Royal round keeps the same stake after catalogue switching, reopening and mobile resizing',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);
 await sandboxTopUp(page,1000);
 await approach(page,'studio-cosmic-escape');let menu=page.locator('.royal-platform');
 await menu.getByRole('searchbox').fill('несуществующая');await expect(menu.locator('.rp-card')).toHaveCount(0);
 await menu.getByRole('searchbox').fill('');await menu.getByRole('combobox',{name:'Жанр',exact:true}).selectOption('slot');await expect(menu.locator('.rp-card')).toHaveCount(10);
 await menu.getByRole('combobox',{name:'Жанр',exact:true}).selectOption('all');
 await page.screenshot({path:out+'/royal-desktop.png'});
 await choose(page,'original-cr-vs-leo');let result:any,saved:any;
 for(let attempt=0;attempt<8;attempt++){const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('#mini-game [data-shoot]').click();result=await response;expect(result.ok()).toBe(true);saved=await result.json();if(saved.session.state==='active')break;}
 expect(saved.session.state).toBe('active');
 const headers={'X-Royal-Account-Id':result.request().headers()['x-royal-account-id'],'X-Royal-Cr-Leo':'1'};const wallet=await(await page.request.get('/api/demo-wallet',{headers})).json();
 await catalog(page);await choose(page,'royal-plinko');await catalog(page);await choose(page,'original-cr-vs-leo');await close(page);
 await approach(page,'studio-caramel-carnival');await choose(page,'original-cr-vs-leo');
 const restored=await(await page.request.get('/api/demo-wallet/expansion',{headers})).json();expect(restored.sessions.find((s:any)=>s.gameId==='original-cr-vs-leo').id).toBe(saved.session.id);
 const unchanged=await(await page.request.get('/api/demo-wallet',{headers})).json();expect(unchanged.balance).toBe(wallet.balance);expect(unchanged.entries.filter((e:any)=>e.operationId===saved.session.id&&e.kind==='bet')).toHaveLength(1);
 await page.setViewportSize({width:390,height:844});menu=await catalog(page);await expect(page.locator('#chat-input')).toBeInViewport();expect(await menu.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:out+'/royal-mobile.png'});
 await choose(page,'studio-neopolis');await expect(page.locator('#chat-input')).toBeInViewport();await page.screenshot({path:out+'/neopolis-mobile.png'});await close(page);expect(errors).toEqual([]);
});

test('a saved removed Mines round can be cashed out without reopening new stakes',async({page,roomPath})=>{
 await enter(page,roomPath);const me=await(await page.request.get('/api/auth/me')).json();
 const {PostgresDatabase}=await import('../server/database');const {DemoWalletStore}=await import('../server/demoWallet');
 const db=new PostgresDatabase('royal_floor_e2e'),wallet=new DemoWalletStore(db,()=>0);
 try{
  await wallet.operate(me.account.id,{id:crypto.randomUUID(),kind:'deposit',amount:1000});
  const result=await wallet.mines.operate(me.account.id,{id:crypto.randomUUID(),action:'start',amount:10,mineCount:1});
  await wallet.mines.operate(me.account.id,{id:crypto.randomUUID(),action:'reveal',sessionId:result.session!.id,cell:1});
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await page.locator('#games-tab').click();await page.locator('[data-retired-session]').click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','royal-mines');
  await expect(page.locator('#chat-input')).toBeInViewport();await page.locator('#original-play').click();await expect(page.locator('#original-play')).toBeDisabled();
  await page.screenshot({path:out+'/retired-mines-recovery.png'});await close(page);
  const headers={'X-Royal-Account-Id':me.account.id};const active=await(await page.request.get('/api/demo-wallet/mines',{headers})).json();expect(active.session).toBeNull();
 }finally{await db.close();}
});
