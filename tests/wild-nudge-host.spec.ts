import {test as base,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {writeFile} from 'node:fs/promises';
const game='studio-wild-nudge',output=process.env.NUDGE_ARTIFACT_DIR||'artifacts/work/wild-nudge-v1-20261030';
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
 await page.locator(`[data-platform-game="${game}"]`).click();await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:30000});await expect(page.locator('.gn')).toBeVisible();await expect.poll(()=>page.locator('[data-gn=board]').evaluate(el=>el.clientWidth)).toBeGreaterThan(200);await chat(page);
}
async function chat(page:Page,closeOverlay=true){
 if(!await page.locator('#chat-input').isVisible())await page.locator('#mini-dialog .game-chat-toggle').click();
 await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();await expect(page.locator('#chat-input')).toBeInViewport();
 if(closeOverlay&&await page.locator('#mini-dialog').getAttribute('data-game-chat')==='overlay')await page.locator('#club-chat-dock .game-chat-close').click();
}
async function topup(page:Page){if(!await page.evaluate(()=>!!(globalThis as any)[Symbol.for('royal.game-host.v1')]))await open(page);const r=await page.request.post('/__test/nudge/topup',{data:{amount:1000}});expect(r.ok()).toBe(true);await page.evaluate(async()=>{await (globalThis as any)[Symbol.for('royal.game-host.v1')].demoWallet.refresh();});}
async function scenario(page:Page,name:string){expect((await page.request.post('/__test/nudge/scenario',{data:{name}})).ok()).toBe(true);}
async function session(page:Page){return page.evaluate(async()=>{return(globalThis as any)[Symbol.for('royal.game-host.v1')].expansionClient.sessions.find((s:any)=>s.gameId==='studio-wild-nudge');});}
async function spin(page:Page){await page.locator('[data-gn=spin]').click();await expect.poll(async()=>(await mini(page))?.busy).toBe(false);await expect.poll(async()=>(await mini(page))?.presenting).toBe(false);expect(await page.locator('[data-gn=status]').textContent()).not.toContain('не подтвержд');}
async function fast(page:Page){await page.locator('[data-gn=settings]').click();await page.locator('[data-setting=fast]').check();await page.locator('[data-setting=music]').uncheck();await page.locator('[data-gn=close]').click();await expect(page.locator('[data-gn=modal]')).toBeHidden();}

test('Rive Lyra renders moving parts, reacts to confirmed nudges and supports reduced motion',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await page.emulateMedia({reducedMotion:'no-preference'});await topup(page);await open(page);
 await expect(page.locator('[data-ss="side:light"]')).toBeEnabled();await page.locator('[data-ss="side:light"]').click();await expect.poll(async()=>(await mini(page)).character?.ready,{timeout:30000}).toBe(true);expect((await mini(page)).character.bound).toBe(true);await expect(page.locator('.ss-companion .ss-rive-canvas')).toBeVisible();expect((await mini(page)).character.playing).toBe(true);
 await page.locator('[data-gn=crew]').click();await expect(page.locator('[data-ss-card=lyra] .ss-rive-canvas')).toBeVisible();
 const bytes=await page.locator('.ss-rive-canvas').evaluate(async(canvas:HTMLCanvasElement)=>{const stream=canvas.captureStream(30),chunks:Blob[]=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise<void>(resolve=>recorder.onstop=()=>resolve());recorder.start();await new Promise(r=>setTimeout(r,5500));recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));});expect(bytes.length).toBeGreaterThan(5000);await writeFile(output+'/lyra-rive-preview.webm',Buffer.from(bytes));await page.screenshot({path:output+'/rive-collection.png'});
 await page.locator('[data-ss=close]').click();await scenario(page,'nudge');await spin(page);expect((await mini(page)).character.reactions.wild_align).toBeGreaterThan(0);await page.screenshot({path:output+'/rive-host.png'});
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.ss-rive-canvas')).toBeHidden();expect((await mini(page)).character.playing).toBe(false);await expect(page.locator('[data-ss-portrait]')).toBeVisible();
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(page.locator('.ss-rive-canvas')).toBeVisible();await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('.ss-rive-canvas')).toHaveCount(0);await open(page);await expect.poll(async()=>(await mini(page)).character?.ready,{timeout:30000}).toBe(true);expect((await mini(page)).character.reactions).toEqual({});
});
test('invalid Rive assets keep the static companion and common-wallet play available',async({page,roomPath})=>{
 await enter(page,roomPath);await page.emulateMedia({reducedMotion:'no-preference'});await topup(page);await open(page);
 await page.route('**/characters/lyra-rive.json',route=>route.fulfill({json:{format:'royal-rive-v1',bytes:1,sha256:'0'.repeat(64),data:'AA=='}}));await expect(page.locator('[data-ss="side:light"]')).toBeEnabled();await page.locator('[data-ss="side:light"]').click();await expect.poll(async()=>(await mini(page)).character?.fallback).toBe(true);await expect.poll(async()=>(await mini(page)).character?.loading).toBe(false);await expect(page.locator('[data-ss-portrait]')).toBeVisible();await scenario(page,'loss');await spin(page);expect((await session(page)).state).toBe('settled');expect((await mini(page)).character.ready).toBe(false);
});
test('all four Rive companions retain their identity, react to paid outcomes and stop when hidden on mobile',async({page,roomPath})=>{
 test.setTimeout(180000);await enter(page,roomPath);await topup(page);await open(page);await fast(page);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('[data-ss="side:light"]').click();await page.locator('[data-gn=crew]').click();
 const observed=[];
 for(const [side,id]of [['light','lyra'],['light','aeliri'],['dark','vespera'],['dark','nyxara']]){
  if(await page.locator(`[data-ss="select:${id}"]`).isEnabled())await page.locator(`[data-ss="select:${id}"]`).click();
  await expect(page.locator('.gn')).toHaveAttribute('data-character',id);await expect.poll(async()=>(await mini(page)).character.ready,{timeout:30000}).toBe(true);expect((await mini(page)).character.bound).toBe(true);if(id!=='lyra')expect((await mini(page)).character.reactions.select).toBe(1);await expect(page.locator(`[data-ss-card=${id}] .ss-rive-canvas`)).toBeVisible();await expect(page.locator('.ss-rive-canvas')).toHaveCount(1);
  if(id!=='lyra'){
   const bytes=await page.locator('.ss-rive-canvas').evaluate(async(canvas:HTMLCanvasElement)=>{const stream=canvas.captureStream(30),chunks:Blob[]=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise<void>(resolve=>recorder.onstop=()=>resolve());recorder.start();await new Promise(r=>setTimeout(r,7500));recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));});expect(bytes.length).toBeGreaterThan(5000);await writeFile(output+`/${id}-rive-preview.webm`,Buffer.from(bytes));
  }
  await page.locator('[data-ss=close]').click();await scenario(page,'nudge');await spin(page);expect((await mini(page)).character.reactions.wild_align).toBeGreaterThan(0);await scenario(page,'win');await spin(page);const wins=(await mini(page)).character.reactions.round_win;expect(wins).toBeGreaterThan(0);await scenario(page,'loss');await spin(page);expect((await mini(page)).character.reactions.round_win).toBe(wins);observed.push((await mini(page)).character);
  await page.screenshot({path:output+`/${id}-full-body.png`});
  if(id==='vespera'){
   await page.locator('.ss-companion').screenshot({path:output+'/vespera-animated-silhouette.png'});
   await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.ss-companion .ss-rive-canvas')).toBeHidden();await page.locator('.ss-companion').screenshot({path:output+'/vespera-static-silhouette.png'});
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.setViewportSize({width:390,height:844});await expect.poll(async()=>(await mini(page)).character.playing).toBe(true);await chat(page);await page.screenshot({path:output+'/vespera-portrait.png'});
   await page.setViewportSize({width:707,height:447});await expect.poll(async()=>(await mini(page)).character.playing).toBe(false);await page.screenshot({path:output+'/vespera-landscape.png'});
   await page.setViewportSize({width:1440,height:1000});await expect.poll(async()=>(await mini(page)).character.playing).toBe(true);
  }
  await page.locator('[data-gn=crew]').click();
 }
 await page.locator('[data-ss=close]').click();await page.setViewportSize({width:390,height:844});await expect.poll(async()=>(await mini(page)).character.playing).toBe(true);await page.setViewportSize({width:844,height:390});await expect.poll(async()=>(await mini(page)).character.playing).toBe(false);await page.setViewportSize({width:390,height:844});await chat(page);await expect(page.locator('[data-gn=spin]')).toBeInViewport();
 await page.locator('[data-gn=crew]').click();await expect(page.locator('[data-ss-card=nyxara] .ss-rive-canvas')).toBeVisible();await expect.poll(async()=>(await mini(page)).character.playing).toBe(true);await page.screenshot({path:output+'/rive-mobile.png'});
 await page.locator('[data-ss="select:lyra"]').click();await expect(page.locator('.gn')).toHaveAttribute('data-character','lyra');await page.locator('[data-ss="select:nyxara"]').click();await expect.poll(async()=>(await mini(page)).character.playing).toBe(true);
 await page.locator('[data-ss=close]').click();await page.setViewportSize({width:1440,height:1000});await expect.poll(async()=>(await mini(page)).character.playing).toBe(true);await scenario(page,'bonus');await spin(page);expect((await mini(page)).character.reactions.bonus_enter).toBe(1);await expect.poll(async()=>(await mini(page)).character.mode).toBe('bonus_idle');
 await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page);await expect.poll(async()=>(await mini(page)).character.ready).toBe(true);expect((await mini(page)).character.reactions).toEqual({});expect((await mini(page)).character.mode).toBe('bonus_idle');await writeFile(output+'/rive-character-verification.json',JSON.stringify({characters:observed,mobileHiddenStops:true,mobileCollectionResumes:true,savedBonusRestoresQuietly:true},null,2));
});
test('all companions are immediately selectable without token or challenge UI and favorites persist',async({page,roomPath})=>{
 await enter(page,roomPath);await open(page);await page.locator('[data-gn=crew]').click();
 const dialog=page.locator('.ss-dialog');await expect(dialog.locator('h3')).toHaveText('Выбери героиню');await expect(dialog.locator('[data-ss-card]')).toHaveCount(4);
 await expect.poll(async()=>(await mini(page)).collection.owned.length).toBe(4);
 await expect(dialog.locator('[data-ss^="answer:"],[data-ss^="unlock:"],[data-ss-tokens],.ss-tabs')).toHaveCount(0);
 expect(await dialog.innerText()).not.toMatch(/жетон|задани|RTP|USDT|открыть/i);
 const actions:string[]=[];page.on('request',request=>{if(request.url().endsWith('/api/star-spin/collection')&&request.method()==='POST')actions.push(request.postDataJSON().action);});
 const balance=await page.locator('[data-gn=balance]').textContent();
 for(const id of ['lyra','aeliri','vespera','nyxara']){await expect(dialog.locator('[data-ss="select:'+id+'"]')).toBeEnabled();await dialog.locator('[data-ss="select:'+id+'"]').click();await expect(page.locator('.gn')).toHaveAttribute('data-character',id);await expect(dialog.locator('[data-ss="select:'+id+'"]')).toHaveAttribute('aria-pressed','true');}
 expect(actions).toEqual(['select','select','select','select']);expect(await session(page)).toBeUndefined();await expect(page.locator('[data-gn=balance]')).toHaveText(balance!);
 for(const [width,height] of [[1440,1000],[390,844],[320,568],[707,447]]){
  await page.setViewportSize({width,height});await expect(dialog).toBeInViewport();
  for(const id of ['lyra','aeliri','vespera','nyxara']){const button=dialog.locator('[data-ss="select:'+id+'"]');await expect(button).toBeInViewport();const box=await button.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);}
  const overflow=await dialog.evaluate(el=>el.scrollWidth>el.clientWidth);expect(overflow).toBe(false);await page.screenshot({path:output+'/all-companions-'+width+'x'+height+'.png'});
 }
 await page.setViewportSize({width:1440,height:1000});await dialog.locator('[data-ss=close]').click();await page.locator('[data-ss="side:light"]').click();await expect(page.locator('.gn')).toHaveAttribute('data-character','aeliri');await page.locator('[data-ss="side:dark"]').click();await expect(page.locator('.gn')).toHaveAttribute('data-character','nyxara');
 await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page);await expect(page.locator('.gn')).toHaveAttribute('data-character','nyxara');await page.locator('[data-gn=crew]').click();await expect(dialog.locator('[data-ss="select:nyxara"]')).toHaveAttribute('aria-pressed','true');
});

test('companion selection is locked during an accepted bonus and pending cosmetic replies recover with the same UUID',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await expect(page.locator('[data-ss="side:light"]')).toBeEnabled();const ids:string[]=[];let drop=true;
 await page.route('**/api/star-spin/collection',async route=>{if(route.request().method()==='POST'){ids.push(route.request().postDataJSON().id);if(drop){drop=false;await route.fetch();await route.abort('failed');return;}}await route.continue();});
 await page.locator('[data-ss="side:light"]').click();await expect.poll(async()=>(await mini(page)).collection.pending).toBe(true);await expect(page.locator('[data-gn=spin]')).toBeDisabled();await page.locator('[data-gn=crew]').click();await page.locator('[data-ss=retry]').click();await expect(page.locator('.gn')).toHaveAttribute('data-character','lyra');expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);await page.locator('[data-ss=close]').click();
 await scenario(page,'bonus');await spin(page);await expect(page.locator('[data-ss="side:dark"]')).toBeDisabled();await page.locator('[data-gn=crew]').click();await expect(page.locator('[data-ss="select:vespera"]')).toBeDisabled();await page.locator('[data-ss=close]').click();for(let i=0;i<8;i++)await spin(page);await expect(page.locator('[data-ss="side:dark"]')).toBeEnabled();
});
test('ordinary paid spin and all eight free continuations use the real host and common wallet',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'bonus');await spin(page);
 let saved=await session(page);expect(saved.view.wildNudge.remaining).toBe(8);expect(saved.spentUnits).toBe('10');expect(saved.returnedUnits).toBe('0');await expect(page.locator('[data-gn=stake]')).toBeDisabled();
 for(let i=0;i<8;i++){await spin(page);saved=await session(page);expect(saved.view.wildNudge.remaining).toBe(7-i);expect(saved.spentUnits).toBe('10');}
 expect(saved.state).toBe('settled');expect(saved.view.wildNudge.spins).toHaveLength(9);await expect(page.locator('[data-gn=auto]')).toBeEnabled();await page.screenshot({path:output+'/bonus-complete.png'});
});
test('all twenty lines cost ten cents and the displayed payout matches the committed fractional receipt',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);
 await expect(page.locator('[data-gn=stake]')).toHaveValue('10');expect(await page.locator('[data-gn=stake] option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value))).toEqual(['10','20','50','100','200','500','1000','2000','5000']);
 const before=await page.evaluate(()=>(globalThis as any)[Symbol.for('royal.game-host.v1')].demoWallet.wallet.balance);
 await scenario(page,'fraction');await spin(page);const saved=await session(page);expect(saved.rulesVersion).toBe(2);expect(saved.spentUnits).toBe('10');expect(saved.returnedUnits).toBe('34');expect(saved.view.wildNudge.totalPayoutUnits).toBe('33');
 await expect(page.locator('[data-gn=payout]')).toContainText(/0[.,]34/);await expect(page.locator('[data-gn=net]')).toContainText(/0[.,]24/);
 await expect.poll(()=>page.evaluate(()=>(globalThis as any)[Symbol.for('royal.game-host.v1')].demoWallet.wallet.balance)).toBeCloseTo(before+.24,5);
 await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page);expect(await session(page)).toEqual(saved);await expect(page.locator('[data-gn=payout]')).toContainText(/0[.,]34/);
 await page.emulateMedia({reducedMotion:'no-preference'});await scenario(page,'loss');await page.locator('[data-gn=spin]').click();await expect(page.locator('.gn')).toHaveAttribute('data-phase','reveal');await expect(page.locator('[data-gn=payout]')).toContainText(/0[.,]34/);
 await expect.poll(async()=>(await mini(page)).busy).toBe(false);await expect(page.locator('[data-gn=payout]')).toContainText(/0[.,]01/);expect((await session(page)).returnedUnits).toBe('1');expect((await session(page)).spentUnits).toBe('10');
});
test('a saved historical bonus keeps its original stake and the next paid round returns to ten cents',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await scenario(page,'bonus');
 const response=await page.request.post('/api/demo-wallet/expansion',{headers:{'X-Royal-Wild-Nudge':'1'},data:{id:crypto.randomUUID(),gameId:game,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}}});expect(response.ok()).toBe(true);const old=(await response.json()).session;expect(old.rulesVersion).toBe(1);expect(old.state).toBe('active');
 await page.evaluate(async()=>{await (globalThis as any)[Symbol.for('royal.game-host.v1')].expansionClient.refresh();});await open(page);await fast(page);await expect(page.locator('[data-gn=stake]')).toHaveValue('100');
 for(let i=0;i<8;i++){await spin(page);expect((await session(page)).spentUnits).toBe('100');}
 expect((await session(page)).rulesVersion).toBe(1);expect((await session(page)).state).toBe('settled');await expect(page.locator('[data-gn=stake]')).toHaveValue('10');
 await scenario(page,'loss');await spin(page);expect((await session(page)).rulesVersion).toBe(2);expect((await session(page)).spentUnits).toBe('10');
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
 await page.locator('[data-gn=spin]').click();await expect(page.locator('[data-gn=retry]')).toBeVisible();await expect(page.locator('[data-gn=auto]')).toBeDisabled();await page.locator('[data-gn=retry]').click();await expect(page.locator('[data-gn=retry]')).toBeHidden();await expect.poll(async()=>(await mini(page))?.busy).toBe(false);expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect((await session(page)).spentUnits).toBe('10');
});
test('closing a saved bonus restores it quietly and never restarts autoplay',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await scenario(page,'bonus');await spin(page);await spin(page);const saved=await session(page);
 await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('.gn')).toHaveCount(0);await open(page);const recovered=await session(page);expect(recovered).toEqual(saved);expect((await mini(page)).autoplay.running).toBe(false);expect((await mini(page)).audio.counts).toEqual({});await expect(page.locator('[data-gn=status]')).toContainText('восстановлен');await chat(page);
});
test('priority layout gives reels readable space, full touch controls and connected chat',async({page,roomPath})=>{
 test.setTimeout(180000);await enter(page,roomPath);await topup(page);await open(page);await fast(page);await page.locator('[data-ss="side:light"]').click();const measurements=[];
 for(const [width,height]of [[2206,1291],[1440,1000],[1280,720],[1024,768],[768,1024],[800,600],[707,447],[640,480],[500,760],[390,844],[320,568],[844,390],[568,320]]){
  await page.setViewportSize({width,height});await chat(page);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const geometry=await page.locator('.gn').evaluate(root=>{
   const rect=(el:Element)=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},failures:string[]=[];
   for(const selector of ['[data-gn=board]','[data-gn=spin]','[data-gn=stake]','[data-gn=auto]','[data-gn=settings]','[data-gn=crew]','[data-gn=balance]','[data-gn=payout]','[data-gn=net]','[data-gn=status]']){
    const el=root.querySelector<HTMLElement>(selector)!,box=rect(el);if(!box.width||!box.height){failures.push(selector+': empty');continue;}
    for(let parent=el.parentElement;parent;parent=parent.parentElement){if(!/(hidden|auto|scroll|clip)/.test(getComputedStyle(parent).overflow))continue;const p=rect(parent);if(box.x<p.x-2||box.y<p.y-2||box.right>p.right+2||box.bottom>p.bottom+2)failures.push(selector+': clipped by '+parent.className);}
    if(el.matches('button,select')){if(box.width<44||box.height<44)failures.push(selector+': touch target below 44px');const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);if(!hit||!el.contains(hit))failures.push(selector+': blocked');}
   }
   const stage=root.closest('.mini-stage')!;if(stage.scrollHeight>stage.clientHeight+2||stage.scrollWidth>stage.clientWidth+2)failures.push('host scroll');
   return{profile:(root as HTMLElement).dataset.layout,root:rect(root),board:rect(root.querySelector('.gn-board')!),stage:rect(root.querySelector('.gn-stage')!),failures};
  });
  expect(geometry.failures,`${width}x${height}`).toEqual([]);
  const amountOverflow=await page.locator('.gn-money').evaluate(root=>{
   const failures:string[]=[];
   for(const [name,value]of [['balance','117 381,84'],['payout','430 395,00'],['net','430 345,00']]){
    const el=root.querySelector<HTMLElement>(`[data-gn=${name}]`)!,original=el.textContent;el.textContent=value;
    const range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect(),cell=el.parentElement!.getBoundingClientRect();if(text.right>cell.right+1)failures.push(name+': amount crosses its column');el.textContent=original;
   }
   return failures;
  });expect(amountOverflow,`${width}x${height} large amounts`).toEqual([]);
  expect(geometry.board.width).toBeGreaterThanOrEqual(Math.floor(Math.min(geometry.stage.width-17,(geometry.stage.height-17)*5/3,geometry.profile==='portrait'?geometry.root.width-32:400))-1);
  if(geometry.profile==='portrait'&&geometry.root.height>=620)expect(geometry.board.width).toBeGreaterThanOrEqual(geometry.root.width-54);
  if(geometry.profile!=='landscape')await expect(page.locator('[data-ss-portrait]')).toBeVisible();
  if([2206,1440,707,390,320,844].includes(width))await page.screenshot({path:output+`/priority-${width}x${height}.png`});measurements.push({width,height,...geometry});
 }
 await page.locator('[data-gn=settings]').click();await page.locator('[data-gn=count]').selectOption('25');await expect(page.locator('[data-gn=lines]')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('[data-gn=settings]')).toBeFocused();
 await page.setViewportSize({width:390,height:844});await page.locator('[data-gn=settings]').click();await expect(page.locator('[data-gn=count]')).toHaveValue('25');await page.locator('[data-gn=lines]').click();await expect(page.locator('[data-gn=modal-title]')).toContainText('20 активных');await page.keyboard.press('Escape');await expect(page.locator('[data-gn=settings]')).toBeFocused();
 await page.locator('[data-gn=settings]').click();await expect(page.locator('[data-gn=count]')).toHaveValue('25');await page.keyboard.press('Escape');
 await writeFile(output+'/priority-layout.json',JSON.stringify({connectedHost:true,measurements},null,2));
});

test('rotation preserves an accepted spin, bonus counters and the chosen autoplay budget',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);await fast(page);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-gn=settings]').click();await page.locator('[data-gn=count]').selectOption('25');await page.keyboard.press('Escape');
 await scenario(page,'bonus');const ids:string[]=[];
 await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()==='POST'){ids.push(route.request().postDataJSON().id);const response=await route.fetch();await page.setViewportSize({width:707,height:447});await route.fulfill({response});}else await route.continue();});
 await spin(page);const saved=await session(page);expect(saved.spentUnits).toBe('10');expect(saved.view.wildNudge.remaining).toBe(8);expect(ids).toHaveLength(1);await expect(page.locator('[data-gn=remaining]')).toBeVisible();await expect(page.locator('[data-gn=remaining]')).toHaveText('8');await expect(page.locator('[data-gn=spin]')).toContainText('Бесплатно');
 await page.setViewportSize({width:320,height:568});await expect(page.locator('[data-gn=remaining]')).toBeVisible();await expect(page.locator('[data-gn=remaining]')).toHaveText('8');await page.locator('[data-gn=settings]').click();await expect(page.locator('[data-gn=count]')).toHaveValue('25');await page.keyboard.press('Escape');expect(await session(page)).toEqual(saved);
 await spin(page);const next=await session(page);expect(next.id).toBe(saved.id);expect(next.spentUnits).toBe('10');expect(next.view.wildNudge.remaining).toBe(7);expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);
});

test('responsive host keeps chat, settings and controls reachable without moving the lower panels',async({page,roomPath})=>{
 test.setTimeout(120000);await enter(page,roomPath);await topup(page);await open(page);await fast(page);const measurements=[];
 for(const [width,height]of [[1440,1000],[1280,720],[1024,768],[800,600],[640,480],[500,760],[390,844],[320,568],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);await chat(page);for(const selector of ['[data-gn=spin]','[data-gn=auto]','[data-gn=stake]','[data-gn=settings]'])await expect(page.locator(selector)).toBeInViewport();
  const overflow=await page.locator('.gn').evaluate(el=>el.scrollWidth-el.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
  if(width===1440||width===390)await page.screenshot({path:output+`/host-${width}.png`});
  const geometry=await page.locator('[data-gn=stage]').evaluate(el=>({stageHeight:el.clientHeight,machineHeight:el.parentElement!.clientHeight,boardWidth:el.querySelector('.gn-board')!.clientWidth}));expect(geometry.stageHeight+48).toBeGreaterThanOrEqual(geometry.machineHeight-1);expect(geometry.boardWidth).toBeGreaterThan(60);measurements.push({width,height,overflow,...geometry});
 }
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});await scenario(page,'nudge');
 await page.evaluate(()=>{const state=(window as any).__gnAnchors={running:true,samples:[]};const sample=()=>{state.samples.push(['money','controls','playback','status'].map(name=>{const r=document.querySelector(`[data-gn=${name}]`)!.getBoundingClientRect();return[r.x,r.y,r.width,r.height];}));if(state.running)requestAnimationFrame(sample);};sample();});
 await spin(page);const drift=await page.evaluate(()=>{const state=(window as any).__gnAnchors;state.running=false;return Math.max(...state.samples.flatMap((s:any)=>s.flatMap((r:any,i:number)=>r.map((v:number,j:number)=>Math.abs(v-state.samples[0][i][j])))));});expect(drift).toBeLessThanOrEqual(.75);await writeFile(output+'/layout-verification.json',JSON.stringify({measurements,spinPanelDrift:drift},null,2));
});
test('settings persist, Escape closes only the inner panel and typing in chat cannot start a spin',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await page.locator('[data-gn=settings]').click();await page.locator('[data-setting=effects]').uncheck();await page.locator('[data-setting=reduced]').check();await page.keyboard.press('Escape');await expect(page.locator('[data-gn=modal]')).toBeHidden();await expect(page.locator('.gn')).toBeVisible();
 const before=await session(page);await chat(page,false);await page.locator('#chat-input').fill('Проверка пробела');await page.locator('#chat-input').press('Space');await expect(page.locator('#chat-input')).toHaveValue('Проверка пробела ');expect(await session(page)).toEqual(before);
 await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page);await page.locator('[data-gn=settings]').click();await expect(page.locator('[data-setting=music]')).not.toBeChecked();await expect(page.locator('[data-setting=effects]')).not.toBeChecked();await expect(page.locator('[data-setting=fast]')).toBeChecked();await expect(page.locator('[data-setting=reduced]')).toBeChecked();
});
test('a real-server spin has a validated response and the account guard rejects a forged owner',async({page,roomPath})=>{
 await enter(page,roomPath);await topup(page);await open(page);await fast(page);await spin(page);const saved=await session(page);expect(saved.gameId).toBe(game);expect(saved.spentUnits).toBe('10');
 const result=await page.request.post('/api/demo-wallet/expansion',{headers:{'X-Royal-Account-Id':crypto.randomUUID(),'X-Royal-Wild-Nudge':'1'},data:{id:crypto.randomUUID(),gameId:game,action:'start',stakeUnits:'10',stakePolicyVersion:1,settings:{wildNudge:{mode:'normal'}}}});expect(result.status()).toBe(401);
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
