import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';

const game='studio-caribbean-treasures',out='artifacts/work/caribbean-stage3';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const response=await request.post('/api/auth/login',{data:{email:`ct-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
 expect(response.ok()).toBe(true);
 const cookie=response.headers()['set-cookie'].split(';')[0];
 await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:2634',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
  const reply=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
  return new Response(await reply.body(),{status:reply.status(),headers:reply.headers()});
 }});
 const room=await client.create<any>('lobby');
 for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
 try{await use('/?room='+room.roomId);}finally{await Promise.race([room.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
}});
const state=(page:Page)=>page.evaluate(()=>{try{return(window as any).royalDemo?.getState()??{};}catch{return{};}});
async function enter(page:Page,path:string,email=`ct-player-${crypto.randomUUID()}@example.test`){
 await page.route('https://luelonplay.com/demo-api/**',route=>route.fulfill({json:{games:[]}}));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill('Royal-ct-check-123!');
 await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);
 if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
 await expect.poll(async()=>(await state(page)).online).toBe(true);
 return email;
}
async function open(page:Page){
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
 await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});
 await page.locator(`[data-platform-game="${game}"]`).click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:25000});
 await expect(page.locator('.ct-root')).toBeVisible();
 await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
 await expect(page.locator('#chat-input')).toBeInViewport();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(async()=>(await state(page)).cabinet).toBe('');}
async function topup(page:Page){
 const r=await page.request.post('/__test/caribbean/topup',{data:{amount:1000}});expect(r.ok()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function session(page:Page){const r=await page.request.get('/api/demo-wallet/expansion');expect(r.ok()).toBe(true);return(await r.json()).sessions.find((s:any)=>s.gameId===game);}
async function wallet(page:Page){return(await(await page.request.get('/api/demo-wallet')).json());}
async function action(page:Page,selector:string){
 const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(selector).click();const r=await reply;expect(r.ok()).toBe(true);const body=await r.json();
 await expect(page.locator('[data-ct-action=retry]')).toBeHidden();
 await expect.poll(async()=>page.locator('.ct-status').textContent()).not.toContain('Подтверждаем');
 return body.session;
}
async function finish(page:Page){
 let s=await session(page);
 for(let moves=0;s.state==='active'&&moves<15;moves++)s=await action(page,'[data-ct-action=play]');
 expect(s.state).toBe('settled');return s;
}
async function layout(page:Page,name:string){
 await expect(page.locator('[data-ct-action=play]')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
 await expect.poll(async()=>page.locator('.ct-root').evaluate(e=>Math.abs(e.getBoundingClientRect().height-e.closest('.mini-stage')!.getBoundingClientRect().height))).toBeLessThan(2);
 expect(await page.locator('.ct-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 const boxes=await page.locator('.ct-board,.ct-giant').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};}));
 if(boxes.length===2){expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x-1);expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right+1);expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[0].bottom+1);expect(boxes[1].width).toBeGreaterThan(30);}
 await page.screenshot({path:out+'/'+name+'.png'});
}

test('natural bonus, real host/chat, line presets and desktop/mobile layout',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);await topup(page);await open(page);
 await page.locator('[data-ct-lines]').selectOption('5');await page.locator('[data-ct-stake]').selectOption('200');
 await expect(page.locator('[data-ct-action=play]')).toContainText('10');
 await page.locator('[data-ct-action=info]').click();await expect(page.locator('.ct-modal')).toBeVisible();
 await page.locator('.ct-modal').press('Escape');await expect(page.locator('.ct-backdrop')).toBeHidden();await expect(page.locator('#mini-dialog')).toBeVisible();
 await page.locator('[data-ct-action=lines]').click();await expect(page.locator('.ct-paths polyline')).toHaveCount(5);
 const before=await wallet(page);await page.request.post('/__test/caribbean/force-bonus');const started=await action(page,'[data-ct-action=play]');
 expect(started.view.caribbean.phase).toBe('choice');expect(started.spentUnits).toBe('1000');
 await expect(page.locator('[data-ct-lines]')).toBeDisabled();await expect(page.locator('[data-ct-stake]')).toBeDisabled();
 await action(page,'[data-ct-action=choose-flagship]');await action(page,'[data-ct-action=play]');
 await layout(page,'desktop');await page.setViewportSize({width:390,height:844});await layout(page,'mobile');
 const saved=await session(page);await close(page);await open(page);expect((await session(page)).id).toBe(saved.id);
 const done=await finish(page),after=await wallet(page);
 expect(after.balance).toBe(before.balance-10+Number(done.returnedUnits)/100);
 expect(after.entries.filter((e:any)=>e.operationId===done.id&&e.kind==='bet')).toHaveLength(1);
 expect(after.entries.filter((e:any)=>e.kind==='win')).toHaveLength(1);
 await page.locator('[data-ct-action=history]').click();await expect(page.locator('.ct-modal')).toContainText('Флагман');
 await page.locator('.ct-modal').press('Escape');expect(errors).toEqual([]);
});

test('an accepted start survives a lost response and reopening without duplicate debit',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-lines]').selectOption('1');
 await page.request.post('/__test/caribbean/force-bonus');
 let lost=false;await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();
 });
 await page.locator('[data-ct-action=play]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 const committed=await session(page),before=await wallet(page);expect(committed.state).toBe('active');
 await close(page);await open(page);await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 await action(page,'[data-ct-action=retry]');expect((await session(page)).id).toBe(committed.id);
 expect((await wallet(page)).balance).toBe(before.balance);
 await action(page,'[data-ct-action=choose-raid]');await finish(page);
 expect((await wallet(page)).entries.filter((e:any)=>e.operationId===committed.id&&e.kind==='bet')).toHaveLength(1);
});

test('both purchased tactics show the accepted price and recover after a full reload',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-lines]').selectOption('1');
 for(const [mode,spins] of [['buy-raid',14],['buy-flagship',6]] as const){
  const before=await wallet(page);await page.locator('[data-ct-action=buy]').click();
  await expect(page.locator(`[data-ct-modal=${mode}]`)).toBeVisible();expect((await wallet(page)).balance).toBe(before.balance);
  const shownPrice=Number((await page.locator('.ct-buy-price').innerText()).replace(/[^\d,.]/g,'').replace(',','.'));
  const started=await action(page,`[data-ct-modal=${mode}]`);expect(started.view.caribbean.remaining).toBe(spins);
  expect(started.view.caribbean.settings.mode).toBe(mode);expect(shownPrice).toBe(Number(started.spentUnits)/100);expect(Math.round((await wallet(page)).balance*100)).toBe(Math.round(before.balance*100)-Number(started.spentUnits));
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});await expect.poll(async()=>(await state(page)).online).toBe(true);await open(page);
  expect((await session(page)).id).toBe(started.id);await expect(page.locator('[data-ct-lines]')).toHaveValue('1');await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();
  const done=await finish(page);expect(Math.round((await wallet(page)).balance*100)).toBe(Math.round(before.balance*100)-Number(done.spentUnits)+Number(done.returnedUnits));
 }
});

test('switching accounts hides the previous series and restores it only for its owner',async({page,roomPath})=>{
 const email=await enter(page,roomPath);await topup(page);await open(page);await page.locator('[data-ct-lines]').selectOption('1');
 await page.request.post('/__test/caribbean/force-bonus');const original=await action(page,'[data-ct-action=play]');await close(page);
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
 await enter(page,roomPath);await open(page);expect(await session(page)).toBeUndefined();await expect(page.locator('.ct-choice')).toBeHidden();
 await expect(page.locator('[data-ct-lines]')).toHaveValue('20');await expect(page.locator('[data-ct-lines]')).toBeEnabled();await close(page);
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
 await enter(page,roomPath,email);await open(page);expect((await session(page)).id).toBe(original.id);
 await expect(page.locator('[data-ct-lines]')).toHaveValue('1');await action(page,'[data-ct-action=choose-flagship]');await finish(page);
});
