import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const response=await request.post('/api/auth/login',{data:{email:`flags-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(response.ok()).toBe(true);
 const cookie=response.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:2635',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{const reply=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await reply.body(),{status:reply.status(),headers:reply.headers()});}});
 const room=await client.create<any>('lobby');for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
 try{await use('/?room='+room.roomId);}finally{await Promise.race([room.leave(),new Promise(resolve=>setTimeout(resolve,1500))]);}
}});
const out='artifacts/work/flag-battle';
async function enter(page:Page,path:string){
  await page.route('https://luelonplay.com/demo-api/**',r=>r.fulfill({json:{games:[]}}));
  await page.goto(path);
  await page.getByLabel('Почта',{exact:true}).fill(`flags-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Royal-flag-test-123!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);
  if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
  const r=await page.request.post('/__test/flag-battle/topup');expect(r.ok()).toBe(true);
  await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function open(page:Page){
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect.poll(async()=>{
    if(await page.locator('#mini-dialog').isVisible())return true;
    try{await page.locator('[data-cabinet="studio-cosmic-escape"]').click({timeout:600});}catch{}
    return page.locator('#mini-dialog').isVisible();
  },{timeout:30000,intervals:[1000,2000]}).toBe(true);
  await page.locator('[data-platform-game="flag-battle"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id','flag-battle',{timeout:25000});
  await expect(page.locator('[data-fb="play"]')).toBeEnabled();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();}
const mini=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
const wallet=async(page:Page)=>(await(await page.request.get('/api/demo-wallet')).json());

test('real host: countries, paid round, skips, reopen, mobile chat and reduced motion',async({page,roomPath})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await enter(page,roomPath);await open(page);
  await expect(page.locator('[data-country]')).toHaveCount(12);
  await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
  await expect(page.locator('#chat-input')).toBeInViewport();
  await expect(page.locator('[data-fb="play"]')).toBeInViewport();
  await page.screenshot({path:out+'/physics-desktop.png'});
  await page.locator('[data-country="JP"]').click();await page.locator('#fb-stake').selectOption('200');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
  await page.locator('[data-fb="play"]').click();const reply=await response;const payload=await reply.json();expect(reply.ok(),JSON.stringify(payload)).toBe(true);const accepted=payload.session;
  await expect.poll(async()=>(await mini(page))?.presenting).toBe(true);
  await expect(page.locator('[data-country="RU"]')).toBeDisabled();
  await page.locator('[data-fb="skip"]').click();await expect.poll(async()=>(await mini(page))?.presenting).toBe(false);
  expect((await mini(page)).audio.voices).toBe(0);expect((await mini(page)).audio.timeline).toBe(false);
  const before=await wallet(page);expect(before.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
  await close(page);await open(page);expect((await mini(page)).sessionId).toBe(accepted.id);
  expect((await mini(page)).presenting).toBe(false);expect((await wallet(page)).entries).toEqual(before.entries);
  expect((await mini(page)).audio.scheduled).toEqual({});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#chat-input')).toBeInViewport();
  await page.locator('[data-fb="play"]').scrollIntoViewIfNeeded();await expect(page.locator('[data-fb="play"]')).toBeInViewport();
  expect(await page.locator('.fb-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:out+'/physics-mobile.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-fb="play"]').click();
  await expect.poll(async()=>(await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length).toBe(2);
  await expect.poll(async()=>(await mini(page))?.presenting).toBe(false);
  const priorSound=(await mini(page)).audio.scheduled;
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('[data-fb="play"]').click();
  await expect.poll(async()=>(await mini(page))?.presenting).toBe(true);
  await expect.poll(async()=>(await mini(page))?.presenting,{timeout:30000}).toBe(false);
  await expect.poll(async()=>(await mini(page))?.eliminated).toBe(11);
  await expect(page.locator('[data-fb="count"]')).toHaveText('1');
  const saved=await page.request.get('/api/demo-wallet/expansion',{headers:{'X-Royal-Flag-Battle':'2'}});
  const settled=(await saved.json()).sessions.find((s:any)=>s.gameId==='flag-battle');
  const state=await mini(page);
  expect(state.returnedUnits).toBe(settled.returnedUnits);
  expect(state.physics.physicsVersion).toBe(3);
  expect(state.audio.scheduled.eliminate).toBe(11);expect(state.audio.scheduled['final-two']).toBe(1);
  expect((state.audio.scheduled.win??0)+(state.audio.scheduled.lose??0)-(priorSound.win??0)-(priorSound.lose??0)).toBe(1);
  expect(state.audio.maxVoices).toBeLessThanOrEqual(16);
  await expect.poll(async()=>(await mini(page)).audio.voices).toBe(0);
  expect(state.physics.order).toEqual(settled.view.flags.order.slice(0,11));
  expect(state.physics.winner).toBe(settled.view.flags.order[11]);
  expect(state.physics.bodies.filter((b:any)=>!b.escaped)).toHaveLength(1);
  expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(3);
  expect(errors).toEqual([]);
});
test('lost response retries the same paid request after close and reopen',async({page,roomPath})=>{
  await enter(page,roomPath);await open(page);await page.locator('button[data-mode=world]').click();let lost=false,paidId='';
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(!lost&&route.request().method()==='POST'){
      lost=true;paidId=route.request().postDataJSON().id;await route.fetch();await route.abort();
    }else await route.continue();
  });
  await page.locator('[data-fb="play"]').click();await expect(page.locator('[data-fb="retry"]')).toBeVisible();
  await close(page);await openRetry(page);
  await expect(page.locator('button[data-mode=world]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('button[data-mode=classic]')).toBeDisabled();
  await page.locator('[data-fb="retry"]').click();await expect(page.locator('[data-fb="retry"]')).toBeHidden();
  await expect.poll(async()=>(await mini(page))?.sessionId).toBe(paidId);
  expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
});
async function openRetry(page:Page){
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect.poll(async()=>{
    if(await page.locator('#mini-dialog').isVisible())return true;
    try{await page.locator('[data-cabinet="studio-cosmic-escape"]').click({timeout:600});}catch{}
    return page.locator('#mini-dialog').isVisible();
  },{timeout:30000,intervals:[1000,2000]}).toBe(true);
  await page.locator('[data-platform-game="flag-battle"]').click();
  await expect(page.locator('[data-fb="retry"]')).toBeVisible({timeout:25000});
}

test('24 and 48 flags: quotes, search, saved mode, natural world round and mobile chat',async({page,roomPath})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);await open(page);
  await page.locator('button[data-mode=expanded]').click();await expect(page.locator('[data-country]')).toHaveCount(24);
  await expect(page.locator('[data-fb=odds]')).toContainText('1 из 24');await expect(page.locator('[data-fb=quote]')).toContainText('23,04');
  await page.getByRole('searchbox',{name:'Найти страну'}).fill('Украина');await expect(page.locator('[data-country]:visible')).toHaveCount(1);
  await page.locator('[data-country=UA]').click();await page.locator('button[data-mode=world]').click();
  await expect(page.locator('[data-country]')).toHaveCount(48);await expect(page.locator('[data-country=UA]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('searchbox',{name:'Найти страну'}).fill('KE');await page.locator('[data-country=KE]').click();
  await page.locator('button[data-mode=expanded]').click();await expect(page.locator('[data-country=RU]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('searchbox',{name:'Найти страну'}).fill('Украина');await page.locator('[data-country=UA]').click();
  await page.locator('[data-fb=play]').click();await expect.poll(async()=>(await mini(page))?.presenting).toBe(true);
  await page.locator('[data-fb=skip]').click();await close(page);await open(page);
  expect((await mini(page)).mode).toBe('expanded');expect((await mini(page)).country).toBe('UA');expect((await mini(page)).eliminated).toBe(23);
  expect((await mini(page)).audio.scheduled).toEqual({});expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
  await page.locator('button[data-mode=world]').click();await page.getByRole('searchbox',{name:'Найти страну'}).fill('Кения');await page.locator('[data-country=KE]').click();
  await page.getByRole('searchbox',{name:'Найти страну'}).fill('');
  await expect(page.locator('[data-fb=quote]')).toContainText('46,08');await expect(page.locator('[data-fb=odds]')).toContainText('1 из 48');
  await expect.poll(()=>page.locator('.fb-countries img').evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  await page.screenshot({path:out+'/modes-desktop.png'});
  await page.locator('[data-fb=play]').click();await expect.poll(async()=>(await mini(page))?.presenting).toBe(true);
  await expect(page.locator('button[data-mode=classic]')).toBeDisabled();await expect(page.getByRole('searchbox',{name:'Найти страну'})).toBeDisabled();
  await expect.poll(async()=>(await mini(page))?.presenting,{timeout:45000}).toBe(false);
  const state=await mini(page);expect(state.mode).toBe('world');expect(state.eliminated).toBe(47);expect(state.physics.bodies).toHaveLength(48);
  expect(state.physics.bodies.filter((b:any)=>!b.escaped)).toHaveLength(1);expect(state.audio.scheduled.eliminate).toBe(47);
  expect(state.audio.scheduled['final-two']).toBe(1);expect((state.audio.scheduled.win??0)+(state.audio.scheduled.lose??0)).toBe(1);
  await expect.poll(async()=>(await mini(page)).audio.voices).toBe(0);
  const response=await page.request.get('/api/demo-wallet/expansion',{headers:{'X-Royal-Flag-Battle':'2'}});
  const saved=(await response.json()).sessions.find((s:any)=>s.gameId==='flag-battle');
  expect(saved.view.flags.mode).toBe('world');expect(state.physics.order).toEqual(saved.view.flags.order.slice(0,47));
  expect(state.physics.winner).toBe(saved.view.flags.order[47]);expect(state.returnedUnits).toBe(saved.returnedUnits);
  await close(page);await open(page);expect((await mini(page)).mode).toBe('world');expect((await mini(page)).audio.scheduled).toEqual({});
  await page.setViewportSize({width:669,height:804});
  await expect(page.locator('#chat-input')).toBeInViewport();
  expect(await page.locator('.fb-stage').evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(300);
  expect(await page.locator('.fb-layout').evaluate(e=>getComputedStyle(e).flexDirection)).toBe('column');
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();
  await page.locator('button[data-mode=classic]').click();await page.locator('button[data-mode=world]').click();
  await expect(page.locator('[data-country]')).toHaveCount(48);
  await page.locator('[data-fb=play]').scrollIntoViewIfNeeded();await expect(page.locator('[data-fb=play]')).toBeInViewport();
  expect(await page.locator('.fb-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.locator('button[data-mode=world]').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/modes-mobile.png'});
  expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(2);expect(errors).toEqual([]);
});
