import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {writeFile} from 'node:fs/promises';
const game='studio-wild-nudge',output='artifacts/work/wild-nudge-v1-20261030';
const test=base.extend<{roomPath:string}>({roomPath:async({request},use)=>{
 const login=await request.post('/api/auth/login',{data:{email:`gn-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const client=new Client('http://127.0.0.1:2637',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{const r=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}});
 const room=await client.create<any>('lobby');for(const event of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(event,()=>{});
 try{await use('/?room='+room.roomId);}finally{await Promise.race([room.leave(),new Promise(r=>setTimeout(r,1500))]);}
}});
const mini=(page:Page)=>page.evaluate(()=>{try{return(window as any).royalDemo?.getMiniState();}catch{return{};}});
const browserErrors=new WeakMap<Page,string[]>();
test.beforeEach(({page})=>{const errors:string[]=[];browserErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(({page})=>{expect(browserErrors.get(page)).toEqual([]);});
async function enter(page:Page,path:string){
 await page.route('https://luelonplay.com/demo-api/**',route=>route.fulfill({json:{games:[]}}));await page.emulateMedia({reducedMotion:'reduce'});await page.goto(path);
 await page.getByLabel('Почта',{exact:true}).fill(`gn-player-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill('Royal-gn-check-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect.poll(async()=>await page.locator('#character-step').isVisible()||!(await page.locator('#join-dialog').isVisible())).toBe(true);if(await page.locator('#character-step').isVisible())await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
 await expect(page.locator('#join-dialog')).toBeHidden();await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
}
async function open(page:Page){
 if(await page.locator('#mini-dialog').isVisible())await page.locator('#mini-dialog .mini-top [data-close]').click();
 if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
 await page.locator('#games-tab').click();
 await expect.poll(async()=>{if(await page.locator('#mini-dialog').isVisible())return true;try{const cabinet=page.locator('[data-cabinet="studio-cosmic-escape"]');if(!await cabinet.isVisible())await page.locator('#games-tab').click({timeout:500});await cabinet.click({timeout:500});}catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error;}return page.locator('#mini-dialog').isVisible();},{timeout:30000,intervals:[700,1500]}).toBe(true);
 await page.locator(`[data-platform-game="${game}"]`).click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:30000});await expect(page.locator('.gn')).toBeVisible();await expect.poll(()=>page.locator('[data-gn=board]').evaluate(el=>el.clientWidth)).toBeGreaterThan(200);await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();await expect(page.locator('#chat-input')).toBeInViewport();
}
async function topup(page:Page){const r=await page.request.post('/__test/nudge/topup',{data:{amount:1000}});expect(r.ok()).toBe(true);await page.evaluate(async()=>{const url='/src/wallet/WalletClient.ts';await(await import(/* @vite-ignore */url)).demoWallet.refresh();});}
async function scenario(page:Page,name:string){expect((await page.request.post('/__test/nudge/scenario',{data:{name}})).ok()).toBe(true);}
async function session(page:Page){return page.evaluate(async()=>{const url='/src/wallet/ExpansionClient.ts';return(await import(/* @vite-ignore */url)).expansionClient.sessions.find((s:any)=>s.gameId==='studio-wild-nudge');});}
async function spin(page:Page){await page.locator('[data-gn=spin]').click();await expect.poll(async()=>(await mini(page))?.busy).toBe(false);await expect.poll(async()=>(await mini(page))?.presenting).toBe(false);expect(await page.locator('[data-gn=status]').textContent()).not.toContain('не подтвержд');}
async function fast(page:Page){await page.locator('[data-gn=settings]').click();await page.locator('[data-setting=fast]').check();await page.locator('[data-setting=music]').uncheck();await page.locator('[data-gn=close]').click();await expect(page.locator('.gn-modal')).toBeHidden();}

test('ordinary paid spin and all eight free continuations use the real host and common wallet',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'bonus');await spin(page);
 let saved=await session(page);expect(saved.view.wildNudge.remaining).toBe(8);expect(saved.spentUnits).toBe('100');expect(saved.returnedUnits).toBe('0');await expect(page.locator('[data-gn=stake]')).toBeDisabled();
 for(let i=0;i<8;i++){await spin(page);saved=await session(page);expect(saved.view.wildNudge.remaining).toBe(7-i);expect(saved.spentUnits).toBe('100');}
 expect(saved.state).toBe('settled');expect(saved.view.wildNudge.spins).toHaveLength(9);await expect(page.locator('[data-gn=auto]')).toBeEnabled();await page.screenshot({path:output+'/bonus-complete.png'});
});
test('finite autoplay makes ten paid starts, completes their bonuses and never runs an eleventh',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);await fast(page);const starts:string[]=[],moves:string[]=[];
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){const op=route.request().postDataJSON();if(op.action==='start'){starts.push(op.id);await scenario(page,starts.length===1?'bonus':'loss');}else moves.push(op.id);}await route.continue();});
 await page.locator('[data-gn=auto]').click();await expect.poll(async()=>(await mini(page))?.autoplay.running).toBe(true);await expect.poll(async()=>(await mini(page))?.autoplay.running,{timeout:90000}).toBe(false);
 expect(starts).toHaveLength(10);expect(new Set(starts).size).toBe(10);expect(moves).toHaveLength(8);await page.waitForTimeout(1000);expect(starts).toHaveLength(10);await expect(page.locator('[data-gn=status]')).toContainText('завершена');
});
test('Stop during an accepted request preserves that round and prevents another paid start',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'nudge');let starts=0;
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){starts++;await new Promise(r=>setTimeout(r,500));}await route.continue();});
 await page.locator('[data-gn=auto]').click();await expect.poll(()=>starts).toBe(1);await page.locator('[data-gn=auto]').click();await expect.poll(async()=>(await mini(page))?.busy).toBe(false);await page.waitForTimeout(1100);expect(starts).toBe(1);expect((await mini(page)).autoplay.running).toBe(false);expect((await session(page)).state).toBe('settled');
});
test('a committed reply lost on the wire recovers the same UUID once',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'nudge');const ids:string[]=[];let drop=true;
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){ids.push(route.request().postDataJSON().id);if(drop){drop=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
 await page.locator('[data-gn=spin]').click();await expect(page.locator('[data-gn=retry]')).toBeVisible();await expect(page.locator('[data-gn=auto]')).toBeDisabled();await page.locator('[data-gn=retry]').click();await expect(page.locator('[data-gn=retry]')).toBeHidden();await expect.poll(async()=>(await mini(page))?.busy).toBe(false);expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect((await session(page)).spentUnits).toBe('100');
});
test('closing a saved bonus restores it quietly and never restarts autoplay',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'bonus');await spin(page);await spin(page);const saved=await session(page);
 await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('.gn')).toHaveCount(0);await open(page);const recovered=await session(page);expect(recovered).toEqual(saved);expect((await mini(page)).autoplay.running).toBe(false);expect((await mini(page)).audio.counts).toEqual({});await expect(page.locator('[data-gn=status]')).toContainText('восстановлен');await expect(page.locator('#chat-input')).toBeInViewport();
});
test('responsive host keeps chat, settings and controls reachable without moving the lower panels',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);await fast(page);const measurements=[];
 for(const [width,height]of [[1440,1000],[1280,720],[1024,768],[800,600],[640,480],[500,760],[390,844],[320,568],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);for(const selector of ['[data-gn=spin]','[data-gn=auto]','[data-gn=stake]','[data-gn=settings]','#chat-input'])await expect(page.locator(selector)).toBeInViewport();
  const overflow=await page.locator('.gn').evaluate(el=>el.scrollWidth-el.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
  if(width===1440||width===390)await page.screenshot({path:output+`/host-${width}.png`});
  const geometry=await page.locator('[data-gn=stage]').evaluate(el=>({stageHeight:el.clientHeight,machineHeight:el.parentElement!.clientHeight,boardWidth:el.querySelector('.gn-board')!.clientWidth}));expect(geometry.stageHeight+46).toBeGreaterThanOrEqual(geometry.machineHeight-1);expect(geometry.boardWidth).toBeGreaterThan(60);measurements.push({width,height,overflow,...geometry});
 }
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});await scenario(page,'nudge');
 await page.evaluate(()=>{const state=(window as any).__gnAnchors={running:true,samples:[]};const sample=()=>{state.samples.push(['money','controls','playback','status'].map(name=>{const r=document.querySelector(`[data-gn=${name}]`)!.getBoundingClientRect();return[r.x,r.y,r.width,r.height];}));if(state.running)requestAnimationFrame(sample);};sample();});
 await spin(page);const drift=await page.evaluate(()=>{const state=(window as any).__gnAnchors;state.running=false;return Math.max(...state.samples.flatMap((s:any)=>s.flatMap((r:any,i:number)=>r.map((v:number,j:number)=>Math.abs(v-state.samples[0][i][j])))));});expect(drift).toBeLessThanOrEqual(.75);await writeFile(output+'/layout-verification.json',JSON.stringify({measurements,spinPanelDrift:drift},null,2));
});
test('settings persist, Escape closes only the inner panel and typing in chat cannot start a spin',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await page.locator('[data-gn=settings]').click();await page.locator('[data-setting=effects]').uncheck();await page.locator('[data-setting=reduced]').check();await page.keyboard.press('Escape');await expect(page.locator('.gn-modal')).toBeHidden();await expect(page.locator('.gn')).toBeVisible();
 const before=await session(page);await page.locator('#chat-input').fill('Проверка пробела');await page.locator('#chat-input').press('Space');await expect(page.locator('#chat-input')).toHaveValue('Проверка пробела ');expect(await session(page)).toEqual(before);
 await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page);await page.locator('[data-gn=settings]').click();await expect(page.locator('[data-setting=music]')).not.toBeChecked();await expect(page.locator('[data-setting=effects]')).not.toBeChecked();await expect(page.locator('[data-setting=fast]')).toBeChecked();await expect(page.locator('[data-setting=reduced]')).toBeChecked();
});
test('a real-server spin has a validated response and the account guard rejects a forged owner',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await spin(page);const saved=await session(page);expect(saved.gameId).toBe(game);expect(saved.spentUnits).toBe('100');
 const result=await page.request.post('/api/demo-wallet/expansion',{headers:{'X-Royal-Account-Id':crypto.randomUUID(),'X-Royal-Wild-Nudge':'1'},data:{id:crypto.randomUUID(),gameId:game,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}}});expect(result.status()).toBe(401);
});

test('animated nudge follows the accepted steps, supports skip and cancels owned motion',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await page.emulateMedia({reducedMotion:'no-preference'});await scenario(page,'nudge');await spin(page);
 const saved=await session(page),frame=saved.view.wildNudge.spins[0],observed=await mini(page);
 expect(observed.audio.counts.stop).toBe(5);expect(observed.audio.counts.nudge).toBe(frame.reels.reduce((n:number,reel:any)=>n+reel.steps,0));
 for(let c=0;c<5;c++)await expect(page.locator(`[data-reel="${c}"]`)).toHaveAttribute('aria-label',new RegExp(frame.reels[c].multiplier>1?'×'+frame.reels[c].multiplier:'.+'));
 expect(observed.animations).toBe(0);await writeFile(output+'/feedback-verification.json',JSON.stringify({acceptedSteps:frame.reels.map((r:any)=>({direction:r.direction,steps:r.steps,multiplier:r.multiplier})),audio:observed.audio,synchronization:observed.synchronization},null,2));
 await page.screenshot({path:output+'/host-nudge.png'});
 await scenario(page,'nudge');await page.locator('[data-gn=spin]').click();await expect(page.locator('[data-gn=skip]')).toBeVisible();await page.locator('[data-gn=skip]').click();await expect.poll(async()=>(await mini(page)).busy).toBe(false);await expect.poll(async()=>(await mini(page)).animations).toBe(0);await expect(page.locator('.gn-charging')).toHaveCount(0);expect((await session(page)).state).toBe('settled');
});

test('simulated page visibility events stop autoplay and preserve the accepted real-server round',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'loss');let starts=0;
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){starts++;await new Promise(r=>setTimeout(r,400));}await route.continue();});
 await page.locator('[data-gn=auto]').click();await expect.poll(()=>starts).toBe(1);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(async()=>(await mini(page)).autoplay.running).toBe(false);
 await expect.poll(async()=>(await mini(page)).busy).toBe(false);expect((await mini(page)).audio.activeEffects).toBe(0);await page.evaluate(()=>{delete(document as any).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(1200);expect(starts).toBe(1);expect((await session(page)).state).toBe('settled');expect((await mini(page)).autoplay.running).toBe(false);await expect(page.locator('[data-gn=spin]')).toBeEnabled();
});
