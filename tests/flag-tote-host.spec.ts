import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { Client } from '@colyseus/sdk';
const api='http://127.0.0.1:2637';
const snapshot=async(page:Page)=>page.evaluate(async()=>{const module='/src/wallet/FlagToteClient.ts';const c=(await import(/* @vite-ignore */module)).flagToteClient;await c.refresh();return c.snapshot;});
async function clock(page:Page,phase:string){const r=await page.request.post('/__test/flag-tote/clock',{data:{phase}});expect(r.ok()).toBe(true);await snapshot(page);}
async function enter(page:Page,path:string){
  await page.route('https://luelonplay.com/demo-api/**',r=>r.fulfill({json:{games:[]}}));await page.goto(path);
  await page.getByLabel('Почта',{exact:true}).fill(`tote-ui-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill('Royal-tote-test-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect.poll(async()=>await page.locator('#character-step').isVisible()||!await page.locator('#join-dialog').isVisible()).toBe(true);
  if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
  expect((await page.request.post('/__test/flag-tote/topup')).ok()).toBe(true);await snapshot(page);
}
async function open(page:Page){await expect(page.locator('.flag-tote-announcement')).toBeVisible();await page.locator('.flag-tote-announcement').click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','flag-tote',{timeout:25000});await expect(page.locator('[data-ft="bet"]')).toBeVisible();}
async function openCatalog(page:Page){
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-cosmic-escape]').click();
  await expect.poll(async()=>{if(await page.locator('#mini-dialog').isVisible())return true;try{await page.locator('[data-cabinet=studio-cosmic-escape]').click({timeout:600});}catch{}return page.locator('#mini-dialog').isVisible();},{timeout:30000,intervals:[1000]}).toBe(true);
  await page.locator('[data-platform-game=flag-tote]').click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','flag-tote');
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();}
const mini=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
async function room(context:BrowserContext){
 const response=await context.request.post('/api/auth/login',{data:{email:`tote-owner-${crypto.randomUUID()}@example.test`,password:'Royal-tote-test-123!'}});expect(response.ok()).toBe(true);const cookie=response.headers()['set-cookie'].split(';')[0];await context.request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client(api,{headers:{Cookie:cookie},fetchFn:async(url,options)=>{const r=await context.request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}});
 const r=await client.create<any>('lobby');for(const kind of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])r.onMessage(kind,()=>{});return r;
}
test('shared pool: two real clients, 48 countries, consolation 60/30/10, reopen and mobile chat',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext(),owner=await room(a);const page=await a.newPage(),other=await b.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));other.on('pageerror',e=>errors.push(e.message));
 try{
  // Room owner and actual players use separate authenticated accounts.
  await a.clearCookies();await enter(page,'/?room='+owner.roomId);await enter(other,'/?room='+owner.roomId);await clock(page,'next');await open(page);await openCatalog(other);
  await expect(page.locator('[data-country]')).toHaveCount(48);await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();await expect(page.locator('#chat-input')).toBeInViewport();
  await page.locator('[data-country=FR]').click();await page.locator('#ft-stake').selectOption('100');await page.locator('[data-ft=bet]').click();await expect(page.locator('.ft-ticket')).toHaveCount(1);
  await other.locator('[data-country=BR]').click();await other.locator('#ft-stake').selectOption('500');await other.locator('[data-ft=bet]').click();await expect(other.locator('.ft-ticket')).toHaveCount(1);
  await page.locator('[data-country=RU]').click();await page.locator('#ft-stake').selectOption('200');await page.locator('[data-ft=bet]').click();await expect(page.locator('.ft-ticket')).toHaveCount(2);
  const first=await snapshot(page),second=await snapshot(other);expect(first.round.id).toBe(second.round.id);expect(first.round.potUnits).toBe('800');expect(second.round.potUnits).toBe('800');expect(first.round.order).toBeUndefined();
  await page.screenshot({path:'artifacts/work/flag-tote/desktop.png'});
  await clock(page,'close');await snapshot(other);await expect(page.locator('[data-ft=bet]')).toBeDisabled();const race=await snapshot(page);expect(race.round.state).toBe('racing');expect(race.round.order).toHaveLength(48);
  await expect.poll(async()=>(await mini(page))?.physics.eliminated,{timeout:10000}).toBeGreaterThan(0);
  const s1=await snapshot(page),s2=await snapshot(other);expect(s1.round.order).toEqual(s2.round.order);expect(s1.round.seed).toBe(s2.round.seed);
  await expect.poll(async()=>(await snapshot(page)).round.state,{timeout:40000,intervals:[1000]}).toBe('settled');await snapshot(other);await expect(page.locator('[data-ft=results]')).toContainText('Победитель без ставок');
  await expect.poll(async()=>(await mini(page)).physics.eliminated).toBe(47);expect((await mini(page)).physics.order).toEqual(race.round.order.slice(0,47));expect((await mini(page)).physics.winner).toBe('KE');expect((await mini(other)).audio.scheduled.win??0).toBe(0);
  const final=await snapshot(page);expect(final.round.settlement.feeUnits).toBe('40');expect(final.round.settlement.awards.map((a:any)=>a.units)).toEqual(['456','228','76']);
  expect(final.round.settlement.awards.map((a:any)=>a.country)).toEqual(['FR','BR','RU']);expect(final.wallet.balance).toBe(1002.32);expect((await snapshot(other)).wallet.balance).toBe(997.28);
  await expect(page.locator('[data-ft=results]')).toContainText('Итог: +2,32');await expect(other.locator('[data-ft=results]')).toContainText('Итог: -2,72');
  const before=final.wallet.entries;await close(page);await open(page);expect((await snapshot(page)).wallet.entries).toEqual(before);expect((await mini(page)).audio.timeline).toBe(false);
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();await page.locator('[data-ft=bet]').scrollIntoViewIfNeeded();await expect(page.locator('[data-ft=bet]')).toBeInViewport();expect(await page.locator('.ft-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:'artifacts/work/flag-tote/mobile.png'});
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(page.locator('.flag-tote-announcement')).toBeVisible();expect(errors).toEqual([]);
 }finally{await a.close();await b.close();await owner.leave();}
});
test('lost accepted response preserves the ticket across close/reopen and refunds an insufficient round once',async({browser})=>{
 const context=await browser.newContext(),owner=await room(context),page=await context.newPage();try{
  await context.clearCookies();await enter(page,'/?room='+owner.roomId);await clock(page,'next');await open(page);let lost=false,id='';
  await page.route('**/api/demo-wallet/flag-tote',async route=>{if(!lost&&route.request().method()==='POST'){lost=true;id=route.request().postDataJSON().id;await route.fetch();await route.abort();}else await route.continue();});
  await page.locator('[data-country=FR]').click();await page.locator('[data-ft=bet]').click();await expect(page.locator('[data-ft=retry]')).toBeVisible();await close(page);await open(page);await expect(page.locator('[data-ft=retry]')).toBeVisible();await page.locator('[data-ft=retry]').click();await expect(page.locator('[data-ft=retry]')).toBeHidden();
  const saved=await snapshot(page);expect(saved.tickets.filter((t:any)=>t.id===id)).toHaveLength(1);expect(saved.wallet.entries.filter((e:any)=>e.source==='flag-tote'&&e.kind==='bet')).toHaveLength(1);
  await clock(page,'close');const refund=await snapshot(page);expect(refund.round.state).toBe('refunded');expect(refund.wallet.balance).toBe(1000);expect(refund.tickets[0].payoutUnits).toBe('100');await expect(page.locator('[data-ft=results]')).toContainText('Полный возврат');
 }finally{await context.close();await owner.leave();}
});
