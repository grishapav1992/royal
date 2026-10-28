import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';

const game='studio-caribbean-treasures',out='artifacts/work/caribbean-empty-balance';
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
 await expect.poll(async()=>page.evaluate(()=>Math.abs((window as any).royalDemo.getState().view.width-document.getElementById('game')!.clientWidth))).toBeLessThanOrEqual(1);
 await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
 // Hall interactions can briefly own movement; reissue the free approach through its real control.
 try{await expect.poll(async()=>{
  if(await page.locator('#mini-dialog').isVisible())return true;
  const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');
  try{if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:500});if(!await page.locator('#mini-dialog').isVisible())await cabinet.click({timeout:500});}catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}
  return page.locator('#mini-dialog').isVisible();
 },{timeout:30000,intervals:[1000,3000]}).toBe(true);}catch(error){
  const {writeFile}=await import('node:fs/promises');await writeFile(out+'/hall-failure.json',JSON.stringify(await page.evaluate(()=>({state:(window as any).royalDemo.getState(),dialogs:[...document.querySelectorAll('dialog')].map(d=>({id:d.id,open:d.open,hidden:d.hidden,display:getComputedStyle(d).display,html:d.outerHTML.slice(0,200)}))})),null,2));throw error;
 }
 await page.locator(`[data-platform-game="${game}"]`).click();
 await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:25000});
 await expect(page.locator('.ct-root')).toBeVisible();
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.audio?.ready),{timeout:20000}).toBe(true);
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.captain?.ready),{timeout:20000}).toBe(true);
 await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
 await expect(page.locator('#chat-input')).toBeInViewport();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(async()=>(await state(page)).cabinet).toBe('');}
async function topup(page:Page){
 const r=await page.request.post('/__test/caribbean/topup',{data:{amount:1000}});expect(r.ok()).toBe(true);
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
}
async function session(page:Page){const r=await page.request.get('/api/demo-wallet/expansion',{headers:{'X-Royal-Caribbean-Treasures':'1'}});expect(r.ok()).toBe(true);return(await r.json()).sessions.find((s:any)=>s.gameId===game);}
async function wallet(page:Page){return(await(await page.request.get('/api/demo-wallet')).json());}
async function action(page:Page,selector:string){
 const reply=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');
 await page.locator(selector).click();const r=await reply;expect(r.ok()).toBe(true);const body=await r.json();
 await expect(page.locator('[data-ct-action=retry]')).toBeHidden();
 await expect.poll(async()=>page.locator('.ct-status').textContent()).not.toContain('Подтверждаем');
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState()?.presenting),{timeout:10000}).toBe(false);
 return body.session;
}
async function finish(page:Page){
 let s=await session(page);
 for(let moves=0;s.state==='active'&&moves<15;moves++)s=await action(page,'[data-ct-action=play]');
 expect(s.state).toBe('settled');return s;
}
async function layout(page:Page,name:string){
 await page.screenshot({path:out+'/'+name+'.png'});
 await expect(page.locator('[data-ct-action=play]')).toBeInViewport();await expect(page.locator('#chat-input')).toBeInViewport();
 await expect.poll(async()=>page.locator('.ct-root').evaluate(e=>Math.abs(e.getBoundingClientRect().height-e.closest('.mini-stage')!.getBoundingClientRect().height))).toBeLessThan(2);
 expect(await page.locator('.ct-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await expect.poll(async()=>page.locator('.ct-symbol').evaluateAll(nodes=>nodes.every(n=>(n as HTMLImageElement).complete&&(n as HTMLImageElement).naturalWidth>=720))).toBe(true);
 const spin=await page.locator('.ct-play').boundingBox();expect(Math.abs(spin!.width-spin!.height)).toBeLessThan(1);
 const boxes=await page.locator('.ct-board,.ct-giant:not([hidden])').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};}));
 if(boxes.length===2){expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].x-1);expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right+1);expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[0].bottom+1);expect(boxes[1].width).toBeGreaterThan(30);}
 await page.screenshot({path:out+'/'+name+'.png'});
}

test('empty balance explains disabled spins, live funding unlocks an exact-cost single line and free spins need no balance',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);await page.locator('[data-ct-lines]').selectOption('1');await page.locator('[data-ct-stake]').selectOption('1000');
 await expect(page.locator('[data-ct-balance]')).toHaveText('0');await expect(page.locator('[data-ct-action=play]')).toBeDisabled();await expect(page.locator('[data-ct-action=buy]')).toBeDisabled();
 await expect(page.locator('.ct-status')).toContainText('Недостаточно средств: нужно 10 USDT.');
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toEqual([]);
 await layout(page,'empty-balance-desktop');await page.setViewportSize({width:390,height:844});await layout(page,'empty-balance-mobile');await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Открыть тестовый кошелёк',exact:true}).click();await expect(page.locator('#wallet-dialog')).toBeVisible();await page.getByRole('button',{name:'Закрыть кошелёк',exact:true}).click();
 const funded=await page.request.post('/__test/caribbean/topup',{data:{amount:1}});expect(funded.ok()).toBe(true);
 // A real shared-wallet refresh must update this already mounted game without reopening.
 await page.evaluate(async()=>{const path='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */path)).demoWallet.refresh();});
 await expect(page.locator('[data-ct-balance]')).toHaveText('1');await expect(page.locator('[data-ct-action=play]')).toBeDisabled();
 await page.locator('[data-ct-stake]').selectOption('100');await expect(page.locator('[data-ct-action=play]')).toBeEnabled();
 await page.request.post('/__test/caribbean/force-bonus');const paid=await action(page,'[data-ct-action=play]');expect(paid.spentUnits).toBe('100');
 await expect(page.locator('[data-ct-balance]')).toHaveText('0');await expect(page.locator('[data-ct-action=choose-flagship]')).toBeEnabled();
 await action(page,'[data-ct-action=choose-flagship]');await expect(page.locator('[data-ct-action=play]')).toBeEnabled();await finish(page);
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await topup(page);
 let rejected=false;await page.route('**/api/demo-wallet/expansion',async route=>{
  if(route.request().method()==='POST'&&!rejected){rejected=true;await route.fulfill({status:409,json:{error:'Недостаточно демомонет для начальных ставок.'}});}else await route.continue();
 });
 const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='GET');await page.locator('[data-ct-action=play]').click();await refreshed;
 await expect(page.locator('.ct-status')).toHaveText('Недостаточно демомонет для начальных ставок.');
 await expect(page.locator('[data-ct-action=retry]')).toBeHidden();expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
 await page.locator('[data-ct-stake]').selectOption('200');await expect(page.locator('.ct-status')).not.toContainText('Недостаточно');
});

test('natural bonus, real host/chat, line presets and desktop/mobile layout',async({page,roomPath})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,roomPath);await topup(page);await open(page);
 await layout(page,'reference-ready-desktop');
 await page.locator('[data-ct-action=lines-down]').click();await expect(page.locator('[data-ct-lines]')).toHaveValue('10');
 await page.locator('[data-ct-action=lines-up]').click();await expect(page.locator('[data-ct-lines]')).toHaveValue('20');await expect(page.locator('[data-ct-action=lines-up]')).toBeDisabled();
 await page.locator('[data-ct-action=stake-up]').click();await expect(page.locator('[data-ct-stake]')).toHaveValue('200');await page.locator('[data-ct-action=stake-down]').click();await expect(page.locator('[data-ct-stake]')).toHaveValue('100');await expect(page.locator('[data-ct-action=stake-down]')).toBeDisabled();
 await page.locator('[data-ct-lines]').selectOption('5');await page.locator('[data-ct-stake]').selectOption('200');
 await expect(page.locator('[data-ct-action=play]')).toContainText('10');
 await page.locator('[data-ct-action=info]').click();await expect(page.locator('.ct-modal')).toBeVisible();
 await expect(page.locator('.ct-audio-credits')).toContainText('Matthew Pablo');await expect(page.locator('.ct-audio-credits')).toContainText('CC BY 3.0');
 await page.locator('.ct-modal').press('Escape');await expect(page.locator('.ct-backdrop')).toBeHidden();await expect(page.locator('#mini-dialog')).toBeVisible();
 await page.locator('[data-ct-action=lines]').click();await expect(page.locator('.ct-paths polyline')).toHaveCount(5);
 const before=await wallet(page);await page.request.post('/__test/caribbean/force-bonus');const started=await action(page,'[data-ct-action=play]');
 expect(started.view.caribbean.phase).toBe('choice');expect(started.spentUnits).toBe('1000');
 expect((await(await page.request.get('/api/demo-wallet/expansion')).json()).sessions.some((s:any)=>s.gameId===game)).toBe(false);
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
  if(route.request().method()==='POST'&&!lost){lost=true;const accepted=await route.fetch();expect(accepted.ok(),await accepted.text()).toBe(true);await route.abort('failed');}else await route.continue();
 });
 await page.locator('[data-ct-action=play]').click();await expect(page.locator('[data-ct-action=retry]')).toBeVisible();
 await expect(page.locator('[data-ct-action=retry]')).toBeEnabled();
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

test('confirmed animation, cannon, skip, mute, zero volume and close release owned audio',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
 await page.evaluate(()=>{const c=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio.context;if(!c)throw Error('Shared context missing');const active=(window as any).__ctSources=new Set();for(const name of ['createOscillator','createBufferSource']){const create=c[name].bind(c);c[name]=()=>{const node=create();active.add(node);node.addEventListener('ended',()=>active.delete(node));return node;};}});
 await page.locator('[data-ct-lines]').selectOption('1');await page.request.post('/__test/caribbean/force-bonus');await action(page,'[data-ct-action=play]');
 await action(page,'[data-ct-action=choose-raid]');await page.request.post('/__test/caribbean/force-cannon');await action(page,'[data-ct-action=play]');
 const playback=await page.evaluate(()=>(window as any).royalDemo.getMiniState());expect(playback.audio.counts.cannon).toBe(1);expect(playback.accents.filter((a:any)=>a.cue==='stop')).toHaveLength(12);
 expect(playback.captain.history.filter((e:any)=>e.cue==='cannon')).toHaveLength(1);
 expect(playback.captain.history.find((e:any)=>e.cue==='cannon').pose).toBe('surprise');
 expect(new Set(playback.captain.history.filter((e:any)=>e.cue==='stop').map((e:any)=>e.variant)).size).toBe(6);
 const maximumDeviationMs=Math.max(...playback.accents.map((a:any)=>Math.abs(a.deviationMs)));
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/playback-measurements.json',JSON.stringify({maximumDeviationMs,accents:playback.accents},null,2));expect(maximumDeviationMs).toBeLessThanOrEqual(50);
 await page.locator('[data-ct-action=music]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.music)).toBe(false);
 await page.locator('[data-ct-action=music]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.music)).toBe(true);
 await page.locator('[data-ct-action=play]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
 await expect(page.locator('.ct-strip:not([hidden])')).not.toHaveCount(0);await page.screenshot({path:out+'/reels.png'});
 await page.locator('[data-ct-action=skip]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 const saved=await session(page);expect(await page.locator('.ct-cell').evaluateAll(nodes=>nodes.map(n=>Number((n as HTMLElement).dataset.symbol)))).toEqual(saved.view.caribbean.spins.at(-1).frame.grid);
 await page.evaluate(()=>{const audio=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio;audio.setVolume(0);audio.setMuted(false);});
 const before=await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts);await action(page,'[data-ct-action=play]');
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual(before);
 await page.evaluate(()=>{const audio=(globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio;audio.setVolume(.35);audio.setMuted(true);});
 await action(page,'[data-ct-action=play]');expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual(before);
 await page.locator('[data-ct-action=sound]').click();await page.locator('[data-ct-action=play]').click();
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 const hidden=await page.evaluate(()=>(window as any).royalDemo.getMiniState());expect(hidden.captain.timers).toBe(0);expect(hidden.captain.animations).toBe(0);expect(hidden.visuals).toEqual({animations:0,particles:0});
 await page.evaluate(()=>{delete(document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await page.locator('[data-ct-action=play]').click();await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().visualPhase)).toBe('reels');
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);await expect(page.locator('.ct-root')).toHaveAttribute('data-motion','reduced');
 const reduced=await session(page);expect(await page.locator('.ct-cell').evaluateAll(nodes=>nodes.map(n=>Number((n as HTMLElement).dataset.symbol)))).toEqual(reduced.view.caribbean.spins.at(-1).frame.grid);
 await close(page);await expect.poll(async()=>page.evaluate(()=>(window as any).__ctSources.size),{timeout:4000}).toBe(0);
 await open(page);expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().audio.counts)).toEqual({});
 expect(await page.evaluate(()=>(window as any).royalDemo.getMiniState().captain.history)).toEqual([]);
 await page.screenshot({path:out+'/desktop-final.png'});
});

test('extreme stakes, rapid double click, mobile purchase and English recovery keep one paid round',async({page,roomPath})=>{
 await enter(page,roomPath);const funded=await page.request.post('/__test/caribbean/topup',{data:{amount:10000}});expect(funded.ok()).toBe(true);await open(page);
 for(const count of ['1','5','10','20']){await page.locator('[data-ct-lines]').selectOption(count);await page.locator('[data-ct-action=lines]').click();if(await page.locator('[data-ct-action=lines]').getAttribute('aria-pressed')==='false')await page.locator('[data-ct-action=lines]').click();await expect(page.locator('.ct-paths polyline')).toHaveCount(Number(count));}
 for(const stake of ['100','200','500','1000'])await page.locator('[data-ct-stake]').selectOption(stake);
 await expect(page.locator('[data-ct-action=play]')).toContainText('200');const before=await wallet(page);
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST')await new Promise(resolve=>setTimeout(resolve,100));await route.continue();});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/expansion')&&r.request().method()==='POST');await page.locator('[data-ct-action=play]').dblclick({delay:10});const started=(await(await response).json()).session;
 await expect.poll(async()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().presenting)).toBe(false);
 if(started.view.caribbean.phase==='choice'){await action(page,'[data-ct-action=choose-flagship]');await finish(page);}
 expect((await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length-before.entries.filter((e:any)=>e.kind==='bet').length).toBe(1);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-ct-action=buy]').click();const bought=await action(page,'[data-ct-modal=buy-flagship]');expect(bought.view.caribbean.settings.lines).toBe(20);expect(bought.stakeUnits).toBe('1000');
 await page.goto(roomPath+'&lang=en');
 // A full navigation can reach the hall before its previous presence lease expires.
 await expect.poll(async()=>{if((await state(page)).online)return true;const retry=page.locator('#retry-entry');if(await retry.isVisible()&&await retry.isEnabled())await retry.click();return false;},{timeout:35000,intervals:[1000,5000]}).toBe(true);
 await open(page);await expect(page.locator('.ct-heading h2')).toHaveText('Caribbean Treasures');
 expect((await session(page)).id).toBe(bought.id);await finish(page);await expect(page.locator('.ct-status')).toContainText(/round|Round/);
});

test('recorded orchestral music and Foley render without clipping and end in silence',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');
 const rendered=await page.evaluate(async()=>{
  const offline=new OfflineAudioContext(1,44100*19,44100);let clock=0;const output=offline.createGain();output.connect(offline.destination);
  const context=new Proxy(offline,{get(target,key){if(key==='state')return'running';if(key==='currentTime')return clock;if(key==='getOutputTimestamp')return()=>({contextTime:0,performanceTime:0});const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  const prefs={muted:false,volume:1};(globalThis as any)[Symbol.for('royal.game-host.v1')]={apiVersion:1,gameAudio:{context,output,getPreferences:()=>prefs,onPreferences:()=>()=>{},unlock:async()=>{}}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const audio=new CaribbeanAudio();audio.setMusic(true);await audio.enter();
  const events:[number,string,number?][]=[[1,'click'],...[0,1,2,3,4,5].map(i=>[2+i*.15,'stop',i] as [number,string,number]),[4,'giant'],[5,'cannon'],[6,'line'],[7,'bonus'],[10,'partial'],[11,'return'],[13,'win'],[16,'bigwin']];
  for(const [time,cue,variant] of events){clock=time;audio.cue(cue,variant);}
  clock=14;audio.setMusic(false);
  const buffer=await offline.startRendering(),samples=buffer.getChannelData(0);let peak=0,step=0,sum=0,tail=0;
  const bytes=new Uint8Array(44+samples.length*2),view=new DataView(bytes.buffer),word=(at:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
  word(0,'RIFF');view.setUint32(4,bytes.length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));sum+=samples[i]*samples[i];if(i)step=Math.max(step,Math.abs(samples[i]-samples[i-1]));if(i>samples.length-4410)tail=Math.max(tail,Math.abs(samples[i]));view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);}
  let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return{peak,rms:Math.sqrt(sum/samples.length),maxSampleStep:step,tail,samples:audio.state().samples,ready:audio.state().ready,wav:btoa(encoded)};
 });
 const {writeFile}=await import('node:fs/promises');await writeFile(out+'/sound-preview.wav',Buffer.from(rendered.wav,'base64'));
 await writeFile(out+'/audio-measurements.json',JSON.stringify({...rendered,wav:undefined},null,2));
 expect(rendered.ready).toBe(true);expect(rendered.samples.music).toBe(1);expect(rendered.samples.cannon).toBe(1);
 // Two reel stops use each take; the neutral partial-return cue adds one wood settling sound.
 expect(rendered.samples['stop-a']).toBe(3);for(const id of ['stop-b','stop-c'])expect(rendered.samples[id]).toBe(2);
 expect(rendered.peak).toBeGreaterThan(.001);expect(rendered.peak).toBeLessThan(.9);expect(rendered.tail).toBeLessThan(.0001);
});

test('sample loading can fail and retry, and late decode after close cannot restart audio',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');
 await page.route('**/caribbean-treasures/audio/manifest.json',r=>r.fulfill({status:503,body:'unavailable'}));
 const failed=await page.evaluate(async()=>{
  const c=new OfflineAudioContext(1,44100,44100),out=c.createGain();out.connect(c.destination);
  const ctx=new Proxy(c,{get(target,key){if(key==='state')return'running';const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  (globalThis as any)[Symbol.for('royal.game-host.v1')]={apiVersion:1,gameAudio:{context:ctx,output:out,getPreferences:()=>({muted:false,volume:1}),onPreferences:()=>()=>{},unlock:async()=>{}}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const a=(window as any).__ctAudio=new CaribbeanAudio();await a.enter();a.cue('bigwin');return a.state();
 });
 expect(failed.ready).toBe(false);expect(failed.loadError).not.toBe('');expect(failed.counts).toEqual({});expect(failed.activeSources).toBe(0);
 await page.unroute('**/caribbean-treasures/audio/manifest.json');
 expect(await page.evaluate(async()=>{const a=(window as any).__ctAudio;await a.enter();const ready=a.state().ready;a.destroy();return ready;})).toBe(true);
 const closed=await page.evaluate(async()=>{
  let decoding=0;const c=new OfflineAudioContext(1,44100,44100),out=c.createGain();out.connect(c.destination);
  const ctx=new Proxy(c,{get(target,key){if(key==='state')return'running';if(key==='decodeAudioData')return async(bytes:ArrayBuffer)=>{decoding++;await new Promise(r=>setTimeout(r,200));return target.decodeAudioData(bytes);};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  (globalThis as any)[Symbol.for('royal.game-host.v1')].gameAudio={context:ctx,output:out,getPreferences:()=>({muted:false,volume:1}),onPreferences:()=>()=>{},unlock:async()=>{}};
  const path='/games/caribbean-treasures/CaribbeanAudio.ts';const {CaribbeanAudio}=await import(/* @vite-ignore */path);const a=new CaribbeanAudio(),enter=a.enter();
  for(let i=0;i<200&&decoding===0;i++)await new Promise(r=>setTimeout(r,10));if(!decoding)throw Error('Decode did not start');a.destroy();await enter;await new Promise(r=>setTimeout(r,250));return a.state();
 });
 expect(closed.activeSources).toBe(0);expect(closed.ownedGraphs).toBe(0);expect(closed.music).toBe(false);expect(closed.counts).toEqual({});expect(closed.loadedClips).toBe(0);
});

test('captain blinks and looks at the field, deduplicates reactions and releases her timer',async({page})=>{
 await page.goto('/tests/fixtures/caribbean-audio.html');await page.clock.install();
 await page.evaluate(async()=>{
  const root=document.createElement('section');root.className='ct-root';
  root.innerHTML='<span class="ct-portrait-gesture"><img class="ct-portrait-layer"><img class="ct-portrait-layer"></span><span class="ct-captain-caption" hidden></span>';
  document.body.append(root);const path='/games/caribbean-treasures/CaribbeanCaptain.ts';
  const {CaribbeanCaptain}=await import(/* @vite-ignore */path);(window as any).__ctCaptain=new CaribbeanCaptain(root);
 });
 const captain=()=>page.evaluate(()=>(window as any).__ctCaptain.state());
 await expect.poll(async()=>(await captain()).ready,{timeout:20000}).toBe(true);
 await page.evaluate(()=>(window as any).__ctCaptain.context(true,false,false));
 await page.clock.runFor(5200);expect((await captain()).pose).toBe('blink');
 await page.clock.runFor(125);expect((await captain()).pose).toBe('idle');
 await page.clock.runFor(5850);expect((await captain()).pose).toBe('blink');
 await page.clock.runFor(125+6500);expect((await captain()).pose).toBe('focus');
 await page.clock.runFor(1400);expect((await captain()).pose).toBe('idle');expect((await captain()).timers).toBe(1);
 await page.evaluate(()=>{const c=(window as any).__ctCaptain;c.begin();c.react('partial','round:1:partial');c.react('partial','round:1:partial');c.finish();});
 expect((await captain()).history).toHaveLength(1);expect((await captain()).pose).toBe('soft');await expect(page.locator('.ct-captain-caption')).toHaveText('Вернулась часть ставки.');
 await page.evaluate(()=>(window as any).__ctCaptain.context(true,true,true));
 expect((await captain()).animations).toBe(0);await expect(page.locator('.ct-captain-caption')).toHaveText('Part of the cost returned.');
 await page.clock.runFor(1200);expect((await captain()).pose).toBe('idle');expect((await captain()).timers).toBe(0);
 await page.evaluate(()=>{const c=(window as any).__ctCaptain;c.context(true,false,false);c.begin();c.react('bigwin','round:2:bigwin');c.finish();});
 expect((await captain()).pose).toBe('laugh');await page.clock.runFor(1300);expect((await captain()).pose).toBe('win');
 await page.evaluate(()=>(window as any).__ctCaptain.context(false,false,false));
 await page.clock.runFor(30000);expect((await captain()).pose).toBe('idle');expect((await captain()).timers).toBe(0);expect((await captain()).animations).toBe(0);
 await page.evaluate(()=>{const c=(window as any).__ctCaptain;c.context(true,false,false);c.destroy();c.react('win','after-close');});
 await page.clock.runFor(30000);expect((await captain()).history).toEqual([]);expect((await captain()).timers).toBe(0);expect((await captain()).animations).toBe(0);
});

test('saved complete rounds give distinct captain reactions in the real host',async({browser,roomPath})=>{
 test.setTimeout(180000);const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:out+'/video',size:{width:1440,height:1000}}});
 const page=await context.newPage(),videoStartWall=Date.now(),cuts:{name:string;start:number;duration:number}[]=[],results:any[]=[];
 const mini=()=>page.evaluate(()=>(window as any).royalDemo.getMiniState());
 const cut=(name:string,from:any,to:any,tail=1.1)=>cuts.push({name,start:Math.max(0,(from.wallTimeMs-videoStartWall)/1000-.15),duration:(to.wallTimeMs-from.wallTimeMs)/1000+tail+.15});
 try{
  await enter(page,roomPath);await topup(page);await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
  for(const [name,cue,pose] of [['partial','partial','soft'],['loss','loss','soft'],['return','return','idle'],['positive','win','win']] as const){
   const forced=await page.request.post('/__test/caribbean/force-scenario',{data:{name}});expect(forced.ok()).toBe(true);
   const done=await action(page,'[data-ct-action=play]'),view=await mini(),history=view.captain.history;
   expect(done.state).toBe('settled');expect(history.at(-1).cue).toBe(cue);expect(view.captain.pose).toBe(pose);
   expect(await page.locator('[data-ct-payout]').textContent()).not.toBe('...');
   const result=history.at(-1),giant=history.findLast((e:any)=>e.cue==='giant'&&e.key.startsWith(done.id));
   cut(name,giant??result,result);results.push({name,costUnits:done.spentUnits,payoutUnits:done.returnedUnits,captain:history.filter((e:any)=>e.key.startsWith(done.id))});
   await page.screenshot({path:out+'/reaction-'+name+'.png'});await page.waitForTimeout(1200);
  }
  await page.request.post('/__test/caribbean/force-scenario',{data:{name:'natural-flagship'}});
  const natural=await action(page,'[data-ct-action=play]');expect(natural.view.caribbean.phase).toBe('choice');
  let history=(await mini()).captain.history;const bonus=history.at(-1);expect(bonus.cue).toBe('bonus');cut('bonus',bonus,bonus);await page.screenshot({path:out+'/reaction-bonus.png'});await page.waitForTimeout(1200);
  await action(page,'[data-ct-action=choose-flagship]');const done=await finish(page);history=(await mini()).captain.history;
  const grand=history.at(-1);expect(grand.cue).toBe('bigwin');expect((await mini()).captain.pose).toBe('laugh');cut('bigwin',grand,grand,1.6);
  results.push({name:'natural-flagship',costUnits:done.spentUnits,payoutUnits:done.returnedUnits,captain:history.filter((e:any)=>e.key.startsWith(done.id))});
  await page.screenshot({path:out+'/reaction-bigwin.png'});await page.waitForTimeout(1800);
  await page.locator('[data-ct-action=lines]').click();await page.locator('[data-ct-lines]').selectOption('1');
  await page.locator('[data-ct-action=buy]').click();await action(page,'[data-ct-modal=buy-raid]');
  await page.request.post('/__test/caribbean/force-cannon');const cannon=await action(page,'[data-ct-action=play]');history=(await mini()).captain.history;
  const shot=history.findLast((e:any)=>e.cue==='cannon');expect(shot.pose).toBe('surprise');cut('cannon',shot,shot,1.3);
  results.push({name:'cannon',roundId:cannon.id,captain:history.filter((e:any)=>e.key.startsWith(cannon.id))});
  await page.emulateMedia({reducedMotion:'reduce'});await finish(page);
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});await layout(page,'motion-mobile');
  await close(page);
 }finally{
  const video=page.video();await context.close();const {writeFile}=await import('node:fs/promises');
  await writeFile(out+'/character-measurements.json',JSON.stringify({video:await video?.path(),videoStartWall,cuts,results},null,2));
 }
});
