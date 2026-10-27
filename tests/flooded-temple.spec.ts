import {test,expect,request as apiRequest,type Page,type Route} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {mkdir} from 'node:fs/promises';
const entry='/tests/fixtures/temple-preview.html',review='artifacts/work/flooded-temple-stage4/browser';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const session=(p:Page)=>p.evaluate(()=>(window as any).templePreview.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const balance=(p:Page)=>p.evaluate(()=>(window as any).templePreview.wallet.wallet.balance);
const valid=(p:Page)=>p.evaluate(()=>{const h=(window as any).templePreview;return h.validate(h.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));});
async function idle(p:Page){await expect.poll(async()=>!!(await state(p))?.busy).toBe(false);}
async function ready(p:Page,lang='en'){await p.emulateMedia({reducedMotion:'reduce'});await p.goto(entry+'?lang='+lang);await expect(game(p).locator('.ft')).toBeVisible();await idle(p);await expect.poll(()=>game(p).locator('img').evaluateAll(images=>images.every(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0))).toBe(true);}
async function start(p:Page){await game(p).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(p)).revision).toBe(1);await idle(p);expect(await valid(p)).toBe(true);}
async function move(p:Page,to:number,rope=false){const before=(await state(p)).revision;await game(p).locator(`[data-room="${to}"]`).click();if(rope){await expect(game(p).locator('[data-ft=primary]')).toBeDisabled();await game(p).locator('[data-ft=rope]').click();}await game(p).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(p)).revision).toBe(before+1);await idle(p);expect(await valid(p)).toBe(true);}

test('Russian and English maps, rules, keyboard and controls fit desktop and phone',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await mkdir(review,{recursive:true});
  for(const lang of['ru','en']){
    await ready(page,lang);await expect(game(page).locator('h1')).toHaveText(lang==='en'?'Flooded Temple':'Затопленный храм');
    await game(page).locator('[data-ft=rules]').click();await expect(game(page).locator('dialog')).toBeVisible();
    await expect(game(page).locator('dialog tbody tr')).toHaveCount(4);if(lang==='en')expect(await game(page).locator('body').innerText()).not.toMatch(/[А-Яа-яЁё]/);
    await game(page).locator('[data-ft=close]').click();await start(page);
    await game(page).locator('[data-room="5"]').focus();await page.keyboard.press('ArrowRight');await expect(game(page).locator('[data-room="6"]')).toBeFocused();
    for(const [width,height]of[[1440,1000],[1000,760],[390,844],[360,740]]){
      await page.setViewportSize({width,height});
      await game(page).locator('.ft').evaluate(root=>new Promise<void>(resolve=>root.ownerDocument.defaultView!.requestAnimationFrame(()=>root.ownerDocument.defaultView!.requestAnimationFrame(()=>resolve()))));
      const geometry=await game(page).locator('.ft').evaluate(root=>{const detail=root.querySelector('.ft-room-detail')!.getBoundingClientRect(),console=root.querySelector('.ft-console')!.getBoundingClientRect();return {width:root.clientWidth,scroll:root.scrollWidth,detailBottom:detail.bottom,consoleTop:console.top,rooms:[...root.querySelectorAll('[data-room]')].map(r=>r.getBoundingClientRect().height)};});
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.consoleTop).toBeGreaterThanOrEqual(geometry.detailBottom-1);expect(Math.min(...geometry.rooms)).toBeGreaterThanOrEqual(44);
      await game(page).locator('[data-ft=primary]').scrollIntoViewIfNeeded();await expect(game(page).locator('[data-ft=primary]')).toBeInViewport();
      await game(page).locator('.ft').evaluate(root=>root.ownerDocument.scrollingElement!.scrollTop=0);
      await page.screenshot({path:`${review}/${lang}-${width}.png`});
    }
    await page.setViewportSize({width:1440,height:1000});
    await game(page).locator('[data-ft=finish]').click();await game(page).locator('[data-ft=confirm-finish]').click();await idle(page);
  }expect(errors).toEqual([]);
});
test('lost start and move responses retry the same UUID, restore, use one rope and settle once',async({page})=>{
  await ready(page);const before=await balance(page);let saved:any;
  const lose=async(route:Route)=>{if(route.request().method()!=='POST'||saved){await route.fallback();return;}saved=await(await route.fetch()).json();await route.abort('failed');};
  await page.route('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();
  await expect.poll(async()=>(await state(page)).pending).toBe(true);await idle(page);
  await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Check move/);const pending=await page.evaluate(()=>(window as any).templePreview.client.pending.id);
  await page.reload();await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Check move/);await idle(page);
  await page.unroute('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await idle(page);
  expect((await session(page)).id).toBe(pending);expect((await session(page))).toEqual(saved.session);expect(await balance(page)).toBe(before-10);
  await move(page,6);expect(await balance(page)).toBe(before-10);
  await page.locator('#reopen').click();await expect(game(page).locator('.ft')).toBeVisible();await idle(page);expect((await state(page)).revision).toBe(2);expect((await state(page)).moves).toBe(5);await expect(game(page).locator('[data-ft=stake]')).toBeDisabled();
  saved=undefined;await page.route('**/api/*-wallet/expansion',lose);await game(page).locator('[data-room="11"]').click();await game(page).locator('[data-ft=primary]').click();await idle(page);expect((await state(page)).pending).toBe(true);await page.unroute('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await idle(page);expect((await state(page)).revision).toBe(3);expect((await state(page)).moves).toBe(4);
  await move(page,12,true);await expect(game(page).locator('[data-ft=rope]')).toBeDisabled();
  for(const to of[13,8,9])await move(page,to);
  const final=await session(page);expect(final.state).toBe('settled');expect(final.returnedUnits).toBe('1750');expect(await balance(page)).toBe(before+7.5);await expect(game(page).locator('.ft-status')).toContainText('Net result +7.50');await expect(game(page).locator('[data-ft=stake]')).toBeEnabled();
  await page.reload();await expect(game(page).locator('.ft')).toBeVisible();await idle(page);expect(await balance(page)).toBe(before+7.5);expect((await state(page)).totalPayoutUnits).toBe('1750');
});
test('revisits consume moves without duplicate treasure; early finish preserves the collected amount',async({page})=>{
  await ready(page);await start(page);for(const to of[6,7,6,7])await move(page,to);
  expect((await state(page)).moves).toBe(2);expect((await state(page)).totalPayoutUnits).toBe('100');
  await game(page).locator('[data-ft=finish]').click();await expect(game(page).locator('dialog')).toContainText('1.00');await game(page).locator('[data-ft=confirm-finish]').click();await idle(page);
  expect((await session(page)).state).toBe('settled');expect((await session(page)).returnedUnits).toBe('100');await expect(game(page).locator('.ft-status')).toContainText('Net result -9.00');
});
test('ordinary paid round displays only confirmed payout and permits the next stake',async({page})=>{
  await page.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()==='POST')await route.continue({headers:{...route.request().headers(),'x-temple-test-case':'paid'}});else await route.continue();});
  await ready(page);const before=await balance(page);await start(page);const s=await session(page);expect(s.state).toBe('settled');expect(Number(s.returnedUnits)).toBeGreaterThan(0);expect(await balance(page)).toBe(before-10+Number(s.returnedUnits)/100);await expect(game(page).locator('[data-ft=stake]')).toBeEnabled();
});
test('shared wallet limits paid starts and changing account removes the previous map',async({page})=>{
  await ready(page);await page.evaluate(()=>{const w=(window as any).templePreview.wallet;w.wallet={...w.wallet,balance:5};w.dispatchEvent(new Event('change'));});
  await expect(game(page).locator('[data-ft=primary]')).toBeDisabled();await expect(game(page).locator('.ft-status')).toContainText('Insufficient balance');
  await page.evaluate(async()=>{await(window as any).templePreview.wallet.refresh();});await start(page);
  await page.evaluate(()=>{(window as any).templePreview.wallet.setAccount(null);});
  await expect(game(page).locator('.ft-sealed')).toBeVisible();await expect(game(page).locator('[data-ft=primary]')).toBeDisabled();expect((await state(page)).sessionId).toBeNull();await expect(game(page).locator('[data-ft-value=balance]')).toHaveText('···');
});
test('real Royal host loads Temple with connected chat, keeps the seat and restores bonus on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const api=await apiRequest.newContext({baseURL:test.info().project.use.baseURL});
  const auth=await api.post('/api/auth/login',{data:{email:'temple-room-'+crypto.randomUUID()+'@example.test',password:'Temple-room-review-42!'}});expect(auth.ok()).toBe(true);await api.post('/api/auth/character',{data:{skin:0}});
  const peer=await new Client('http://127.0.0.1:'+(process.env.TEMPLE_API_PORT||'2626'),{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{const r=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new globalThis.Response(await r.body(),{status:r.status(),headers:r.headers()});}}).create('lobby');
  for(const type of['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
  try{
    await ready(page);expect((await page.request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/?lang=en&room='+peer.roomId);
    await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});await page.waitForFunction(()=>(window as any).royalDemo?.getState().online===true);
    await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();
    await expect(game(page).locator('[data-ft=primary]')).toBeEnabled({timeout:45000});await game(page).locator('[data-ft=primary]').click();await expect(game(page).locator('[data-ft=rope]')).toBeVisible();await expect(game(page).locator('.ft')).toHaveAttribute('data-event','idle');
    for(const [width,height]of[[1440,1000],[390,844]]){
      await page.setViewportSize({width,height});await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
      const geometry=await page.locator('#mini-dialog').evaluate(root=>({width:root.clientWidth,scroll:root.scrollWidth}));expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);
      await expect(async()=>{await game(page).locator('[data-ft=primary]').scrollIntoViewIfNeeded();await expect(game(page).locator('[data-ft=primary]')).toBeInViewport();}).toPass();await page.screenshot({path:`${review}/host-${width}.png`});
    }
    await page.locator('#studio-game-list').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();await expect(game(page).locator('[data-ft=stake]')).toBeDisabled();await expect(game(page).locator('.ft-step-count strong')).toHaveText('6');
    await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();await expect(page.locator('#club-chat-dock')).toBeVisible();expect(errors).toEqual([]);
  }finally{await peer.leave();await api.dispose();}
});
