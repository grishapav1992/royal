import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const idle=(p:Page)=>expect.poll(async()=>!!(await state(p))?.busy,{timeout:15000}).toBe(false);
async function ready(p:Page,reduced=false){await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await p.goto('/tests/fixtures/temple-preview.html?lang=en');await expect(game(p).locator('.ft')).toBeVisible();await idle(p);}
async function sound(p:Page){await p.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await game(p).locator('[data-ft=sound]').click();await expect.poll(async()=>(await state(p)).feedback.audio.ready).toBe(true);}
async function spin(p:Page){const before=(await state(p)).sessionId;await game(p).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(p)).sessionId).not.toBe(before);await expect.poll(async()=>(await state(p)).revision).toBe(1);}
async function move(p:Page,to:number,rope=false){await game(p).locator(`[data-room="${to}"]`).click();if(rope)await game(p).locator('[data-ft=rope]').click();await game(p).locator('[data-ft=primary]').click();await idle(p);}

test('confirmed base events animate in order and audio accents use the shared output clock',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);await sound(page);await spin(page);
  await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Show result/);await idle(page);
  const result=await state(page),feedback=result.feedback;
  expect(feedback.audio.played.stone).toBe(4);expect(feedback.audio.played.step).toBeGreaterThan(0);expect(feedback.audio.played.lever).toBe(1);expect(feedback.audio.played.relic).toBe(1);expect(feedback.audio.played.win??0).toBe(0);expect(feedback.audio.played.big??0).toBe(0);
  expect(feedback.audio.anchors.some((a:any)=>a.state==='scheduled'&&a.method!=='silent')).toBe(true);
  expect(feedback.frames.filter((f:any)=>f.kind==='card').length).toBe(4);expect(Math.max(...feedback.frames.map((f:any)=>f.skewMs))).toBeLessThan(100);
  expect(feedback.audio.activeSources).toBeLessThanOrEqual(3);expect(result.moves).toBe(6);expect(result.totalPayoutUnits).toBe('0');
  await game(page).locator('[data-ft=log]').click();await expect(game(page).locator('dialog')).toContainText('Lever opens gate');await game(page).locator('[data-ft=close]').click();
  await mkdir('artifacts/work/flooded-temple-navigation',{recursive:true});await writeFile('artifacts/work/flooded-temple-navigation/clock-baseline.json',JSON.stringify(feedback,null,2));expect(errors).toEqual([]);
});
test('pause freezes the visual clock, cancels voices, resumes without replay and skip never makes a move',async({page})=>{
  await ready(page);await sound(page);await spin(page);await expect.poll(async()=>(await state(page)).feedback.active).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.pause());const paused=(await state(page)).feedback;
  await page.waitForTimeout(250);const after=(await state(page)).feedback;expect(after.paused).toBe(true);expect(after.event).toBe(paused.event);expect(after.offsetMs).toBe(paused.offsetMs);expect(after.audio.activeSources).toBe(0);
  await page.evaluate(()=>(window as any).templePreview.resume());await expect.poll(async()=>(await state(page)).feedback.paused).toBe(false);
  const requests:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))requests.push(r.postData()!);});
  await game(page).locator('[data-ft=primary]').click();await idle(page);expect(requests).toHaveLength(0);expect((await state(page)).moves).toBe(6);expect((await state(page)).feedback.active).toBe(false);
  await page.evaluate(()=>{const h=(window as any).templePreview;h.open();h.pause();});await expect.poll(async()=>(await state(page))?.feedback?.paused).toBe(true);await page.evaluate(()=>(window as any).templePreview.resume());await idle(page);
});
test('mute, zero volume and a reduced motion change cancel pending audio and never replay past rewards',async({page})=>{
  await ready(page);await sound(page);await spin(page);await page.evaluate(()=>(window as any).templePreview.audio.setMuted(true));
  await expect.poll(async()=>(await state(page)).feedback.audio.activeSources).toBe(0);await idle(page);const before=(await state(page)).feedback.audio.played;
  await game(page).locator('[data-ft=sound]').click();await page.waitForTimeout(180);expect((await state(page)).feedback.audio.played).toEqual(before);
  await page.evaluate(()=>(window as any).templePreview.audio.setVolume(0));await expect.poll(async()=>(await state(page)).feedback.audio.activeSources).toBe(0);
  await move(page,6);expect((await state(page)).feedback.audio.played).toEqual(before);await page.evaluate(()=>(window as any).templePreview.audio.setVolume(.35));
  await game(page).locator('[data-room="11"]').click();await game(page).locator('[data-ft=primary]').click();await page.emulateMedia({reducedMotion:'reduce'});await idle(page);
  const reduced=await state(page);expect(reduced.feedback.reducedMotion).toBe(true);expect(reduced.feedback.active).toBe(false);expect(reduced.revision).toBe(3);
  expect(await game(page).locator('.ft').evaluate(root=>root.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);
});
test('rope, treasure and sixth-step settlement are presented once and reopening stays quiet',async({page})=>{
  await ready(page,true);await sound(page);await spin(page);await idle(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await move(page,6);await move(page,11);await move(page,12,true);let result=await state(page);await writeFile('artifacts/work/flooded-temple-navigation/rope-clock.json',JSON.stringify(result.feedback,null,2));expect(result.feedback.audio.played.rope).toBe(1);expect(result.totalPayoutUnits).toBe('250');
  for(const to of[13,8,9])await move(page,to);
  result=await state(page);expect(result.totalPayoutUnits).toBe('1750');expect(result.feedback.audio.played.win).toBe(1);expect(result.feedback.audio.played.big??0).toBe(0);await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('17.50');
  const balance=await page.evaluate(()=>(window as any).templePreview.wallet.wallet.balance);await page.locator('#reopen').click();await expect(game(page).locator('.ft')).toBeVisible();await idle(page);result=await state(page);expect(result.feedback.audio.played).toEqual({});expect(result.totalPayoutUnits).toBe('1750');expect(await page.evaluate(()=>(window as any).templePreview.wallet.wallet.balance)).toBe(balance);
});
test('close in an effect releases all module audio and animation owners',async({page})=>{
  await ready(page);await sound(page);await spin(page);await expect.poll(async()=>(await state(page)).feedback.active).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.close());const closed=await page.evaluate(()=>(window as any).templePreview.closedState());expect(closed.disposed).toBe(true);expect(closed.feedback.audio.disposed).toBe(true);await expect.poll(async()=>(await page.evaluate(()=>(window as any).templePreview.closedState())).feedback.audio.activeSources).toBe(0);expect(closed.feedback.effects.animations).toBe(0);
  await page.waitForTimeout(300);expect((await page.evaluate(()=>(window as any).templePreview.closedState())).feedback.audio.played).toEqual(closed.feedback.audio.played);
});
test('unknown replies restore silently and never schedule a second discovery theme',async({page})=>{
  await ready(page);await sound(page);let saved=false;
  const lose=async(route:Route)=>{if(route.request().method()!=='POST'||saved){await route.fallback();return;}saved=true;await route.fetch();await route.abort('failed');};
  await page.route('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await idle(page);expect((await state(page)).pending).toBe(true);await page.unroute('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await idle(page);
  const result=await state(page);expect(result.feedback.active).toBe(false);expect(result.feedback.audio.played.relic??0).toBe(0);expect(result.revision).toBe(1);expect(result.moves).toBe(6);
});
test('latency fallback schedules against simulated device delay without doubling the offset',async({page})=>{
  await ready(page);await sound(page);
  await page.evaluate(()=>{const context=(window as any).templePreview.audio.context;Object.defineProperty(context,'getOutputTimestamp',{configurable:true,value:undefined});Object.defineProperty(context,'outputLatency',{configurable:true,value:.18});Object.defineProperty(context,'baseLatency',{configurable:true,value:.02});});
  await spin(page);await idle(page);const result=(await state(page)).feedback;expect(result.audio.clock.method).toBe('latency-estimate');expect(result.audio.clock.latencyMs).toBeCloseTo(200,3);expect(result.audio.anchors.some((a:any)=>a.state==='scheduled')).toBe(true);expect(Math.max(...result.frames.map((f:any)=>f.skewMs))).toBeLessThan(100);
  await writeFile('artifacts/work/flooded-temple-navigation/clock-simulated-latency.json',JSON.stringify(result,null,2));
});
test('partial returns stay neutral and a later large paid round gets its own full-stake result',async({page})=>{
  let fixture='partial';await page.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()==='POST')await route.continue({headers:{...route.request().headers(),'x-temple-test-case':fixture}});else await route.continue();});
  await ready(page);await sound(page);await spin(page);await expect(game(page).locator('.ft')).toHaveAttribute('data-outcome','partial',{timeout:10000});await idle(page);
  let result=await state(page);expect(result.totalPayoutUnits).toBe('350');expect(result.feedback.audio.played.neutral).toBe(1);expect(result.feedback.audio.played.win??0).toBe(0);expect(result.feedback.audio.played.big??0).toBe(0);await expect(game(page).locator('.ft-status')).toContainText('Net result -6.50');
  fixture='big';await spin(page);await expect(game(page).locator('.ft')).toHaveAttribute('data-outcome','big',{timeout:10000});await idle(page);result=await state(page);expect(result.totalPayoutUnits).toBe('35000');expect(result.feedback.audio.played.big).toBe(1);await expect(game(page).locator('.ft-status')).toContainText('Net result +340.00');
});
test('hidden-page simulation freezes playback and an account change during an effect leaves no stale voices',async({page})=>{
  await ready(page);await sound(page);await spin(page);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  const paused=(await state(page)).feedback;await page.waitForTimeout(180);expect((await state(page)).feedback.offsetMs).toBe(paused.offsetMs);await expect.poll(async()=>(await state(page)).feedback.audio.activeSources).toBe(0);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(async()=>(await state(page)).feedback.paused).toBe(false);
  await page.evaluate(()=>(window as any).templePreview.wallet.setAccount(null));await expect(game(page).locator('.ft-sealed')).toBeVisible();expect((await state(page)).sessionId).toBeNull();await expect.poll(async()=>(await state(page)).feedback.audio.activeSources).toBe(0);await page.waitForTimeout(250);await expect.poll(async()=>(await state(page)).feedback.audio.activeSources).toBe(0);
});
test('CPU throttling keeps final state exact and does not accumulate a reward queue',async({page})=>{
  await ready(page);await sound(page);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  try{await spin(page);await idle(page);const feedback=(await state(page)).feedback;expect(feedback.audio.activeSources).toBeLessThanOrEqual(3);expect(feedback.audio.played.relic??0).toBeLessThanOrEqual(1);expect((await state(page)).totalPayoutUnits).toBe('0');await writeFile('artifacts/work/flooded-temple-navigation/clock-cpu-4x.json',JSON.stringify(feedback,null,2));}
  finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();}
});
test('an old in-flight response cannot lock or animate a restored account',async({page})=>{
  await ready(page);await sound(page);let release!:()=>void,received=false;
  const delay=async(route:Route)=>{if(route.request().method()!=='POST'||received){await route.fallback();return;}received=true;const response=await route.fetch();await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({response});};
  await page.route('**/api/*-wallet/expansion',delay);await game(page).locator('[data-ft=primary]').click();await expect.poll(()=>!!release).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.wallet.setAccount(null));await expect.poll(async()=>(await state(page)).busy).toBe(false);expect((await state(page)).sessionId).toBeNull();
  await page.evaluate(async()=>{const h=(window as any).templePreview;h.wallet.setAccount(h.account);await h.wallet.refresh();await h.client.refresh();});
  release();await expect(game(page).locator('[data-ft=primary]')).toHaveText(/Check move/);await expect.poll(async()=>(await state(page)).busy).toBe(false);await page.unroute('**/api/*-wallet/expansion',delay);
  await game(page).locator('[data-ft=primary]').click();await idle(page);expect((await state(page)).feedback.audio.played.relic??0).toBe(0);expect((await state(page)).revision).toBe(1);expect((await state(page)).moves).toBe(6);
});

test('painted chest states remain exact and skipping a paused collection releases its particles',async({page})=>{
  await ready(page,true);await sound(page);await spin(page);await idle(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await move(page,6);await move(page,11);
  const requests:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))requests.push(r.postData()!);});
  await game(page).locator('[data-room="12"]').click();await game(page).locator('[data-ft=rope]').click();await game(page).locator('[data-ft=primary]').click();
  await expect.poll(async()=>(await state(page)).feedback.event,{timeout:4000,intervals:[25]}).toBe('collect');await page.evaluate(()=>(window as any).templePreview.pause());
  const collection=await state(page);expect(collection.feedback.effects.decorations).toBeLessThanOrEqual(8);expect(collection.feedback.effects.decorations).toBeGreaterThan(0);
  await expect(game(page).locator('[data-room="12"] .ft-prop-open')).toHaveJSProperty('complete',true);
  const frozen=collection.feedback.offsetMs;await page.waitForTimeout(100);expect((await state(page)).feedback.offsetMs).toBe(frozen);
  await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).feedback.active).toBe(false);const final=await state(page);
  expect(requests).toHaveLength(1);expect(final.totalPayoutUnits).toBe('250');expect(final.feedback.effects.decorations).toBe(0);expect(final.feedback.effects.animations).toBe(0);
  await expect(game(page).locator('[data-room="12"] .ft-room-art')).toHaveAttribute('data-open','true');await expect(game(page).locator('[data-room="12"] .ft-prop-open')).toHaveCSS('opacity','1');
  expect(await game(page).locator('img').evaluateAll(images=>images.every(i=>(i as HTMLImageElement).complete&&(i as HTMLImageElement).naturalWidth>0))).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.resume());await idle(page);
});

test('the cinematic score keeps its position across moves and obeys shared mute, pause and disposal',async({page})=>{
  await ready(page,true);await sound(page);await expect.poll(async()=>(await state(page)).feedback.audio.music.readyState).toBeGreaterThanOrEqual(2);
  await expect.poll(async()=>(await state(page)).feedback.audio.music.playing).toBe(true);
  const initial=(await state(page)).feedback.audio.music.positionSeconds;await spin(page);await idle(page);await move(page,6);
  expect((await state(page)).feedback.audio.music.positionSeconds).toBeGreaterThan(initial);
  await game(page).locator('[data-ft=rules]').click();await expect(game(page).locator('dialog a').filter({hasText:'Memories Of Stone'})).toHaveAttribute('href','https://www.scottbuckley.com.au/library/memories-of-stone/');await game(page).locator('[data-ft=close]').click();
  await page.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await expect.poll(async()=>(await state(page)).feedback.audio.music.playing).toBe(false);
  const paused=(await state(page)).feedback.audio.music.positionSeconds;await page.waitForTimeout(180);expect((await state(page)).feedback.audio.music.positionSeconds).toBeCloseTo(paused,1);
  await game(page).locator('[data-ft=sound]').click();await expect.poll(async()=>(await state(page)).feedback.audio.music.positionSeconds).toBeGreaterThan(paused);
  await page.evaluate(()=>(window as any).templePreview.pause());expect((await state(page)).feedback.audio.music.playing).toBe(false);await page.evaluate(()=>(window as any).templePreview.resume());await expect.poll(async()=>(await state(page)).feedback.audio.music.playing).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.close());const closed=await page.evaluate(()=>(window as any).templePreview.closedState());expect(closed.feedback.audio.music.disposed).toBe(true);expect(closed.feedback.audio.music.playing).toBe(false);
});

test('persistent explorer changes real poses, pauses with dialogs and releases its mesh on close',async({page})=>{
  await ready(page);await expect.poll(async()=>(await state(page)).feedback.character.loaded.length).toBe(6);
  await expect.poll(async()=>(await state(page)).feedback.character.renderer).toBe('mesh');
  await game(page).locator('canvas.ft-portrait').evaluate(canvas=>{(window as any).__templePortrait=canvas;});
  await spin(page);await expect.poll(async()=>(await state(page)).feedback.character.clip,{intervals:[25],timeout:12000}).toBe('relic');
  await page.evaluate(()=>(window as any).templePreview.pause());
  const paused=(await state(page)).feedback.character;expect(paused.pose).toBe('discover');expect(paused.framePending).toBe(false);
  await page.waitForTimeout(180);expect((await state(page)).feedback.character.clockMs).toBe(paused.clockMs);
  expect(await game(page).locator('canvas.ft-portrait').evaluate(canvas=>canvas===(window as any).__templePortrait)).toBe(true);
  expect(paused.transitions.some((t:any)=>t.clip==='gate'&&t.pose==='brace')).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.resume());await idle(page);
  await game(page).locator('[data-ft=rules]').click();const dialog=(await state(page)).feedback.character;await page.waitForTimeout(150);expect((await state(page)).feedback.character.clockMs).toBe(dialog.clockMs);expect(dialog.framePending).toBe(false);await game(page).locator('[data-ft=close]').click();
  await expect.poll(async()=>(await state(page)).feedback.character.clockMs).toBeGreaterThan(dialog.clockMs);
  await page.evaluate(()=>(window as any).templePreview.close());const closed=await page.evaluate(()=>(window as any).templePreview.closedState());expect(closed.feedback.character.disposed).toBe(true);expect(closed.feedback.character.framePending).toBe(false);expect(closed.feedback.character.textures).toBe(0);
});

test('character distinguishes paid outcomes and reduced motion has no portrait frame loop',async({page})=>{
  let fixture='partial';await page.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()==='POST')await route.continue({headers:{...route.request().headers(),'x-temple-test-case':fixture}});else await route.continue();});
  await ready(page);await spin(page);await expect.poll(async()=>(await state(page)).feedback.character.clip,{intervals:[25]}).toBe('reflect');expect((await state(page)).feedback.character.pose).toBe('reflect');await idle(page);
  fixture='big';await spin(page);await expect.poll(async()=>(await state(page)).feedback.character.clip,{intervals:[25]}).toBe('triumph');expect((await state(page)).feedback.character.pose).toBe('celebrate');
  await page.emulateMedia({reducedMotion:'reduce'});await idle(page);const reduced=(await state(page)).feedback.character;expect(reduced.reduced).toBe(true);expect(reduced.framePending).toBe(false);
  await page.waitForTimeout(180);expect((await state(page)).feedback.character.clockMs).toBe(reduced.clockMs);
  await page.locator('#reopen').click();await idle(page);expect((await state(page)).feedback.character.pose).toBe('idle');expect((await state(page)).feedback.character.transitions.some((t:any)=>t.pose==='celebrate')).toBe(false);
});

test('portrait context loss falls back safely, restores and account changes clear gestures',async({page})=>{
  await ready(page);await expect.poll(async()=>(await state(page)).feedback.character.loaded.length).toBe(6);
  await expect.poll(async()=>(await state(page)).feedback.character.renderer).toBe('mesh');
  await game(page).locator('canvas.ft-portrait').evaluate(canvas=>{const gl=(canvas as HTMLCanvasElement).getContext('webgl')!;const ext=gl.getExtension('WEBGL_lose_context')!;(window as any).__templeContext=ext;ext.loseContext();});
  await expect(game(page).locator('.ft-portrait-fallback')).toBeVisible();await expect.poll(async()=>(await state(page)).feedback.character.renderer).toBe('image');
  await game(page).locator('canvas.ft-portrait').evaluate(()=>{(window as any).__templeContext.restoreContext();});await expect.poll(async()=>(await state(page)).feedback.character.renderer).toBe('mesh');expect((await state(page)).feedback.character.textures).toBe(6);
  await spin(page);await page.evaluate(()=>(window as any).templePreview.wallet.setAccount(null));await expect.poll(async()=>(await state(page)).feedback.character.pose).toBe('idle');expect((await state(page)).feedback.character.framePending).toBe(false);
});

test('rope Foley is scheduled before a 200 ms main-thread stall and is never replayed late',async({page})=>{
  await ready(page,true);await sound(page);await spin(page);await idle(page);await page.emulateMedia({reducedMotion:'no-preference'});await move(page,6);await move(page,11);
  await game(page).locator('.ft').evaluate(root=>{const observer=new MutationObserver(()=>{if((root as HTMLElement).dataset.event!=='rope')return;observer.disconnect();setTimeout(()=>{const until=performance.now()+200;while(performance.now()<until){/* Deliberate device-load simulation. */}},300);});observer.observe(root,{attributes:true,attributeFilter:['data-event']});});
  await move(page,12,true);const feedback=(await state(page)).feedback;
  expect(feedback.audio.played.rope).toBe(1);expect(feedback.audio.anchors.filter((a:any)=>a.cue==='rope').map((a:any)=>a.state)).toEqual(['scheduled']);expect((await state(page)).totalPayoutUnits).toBe('250');
  await writeFile('artifacts/work/flooded-temple-navigation/rope-stall.json',JSON.stringify(feedback,null,2));
});

test('quiet idle has distinct gestures without reward poses or new network operations',async({page})=>{
  await ready(page);const requests:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))requests.push(r.postData()!);});
  await expect.poll(async()=>(await state(page)).feedback.character.clip,{timeout:16000,intervals:[100]}).toBe('glance');
  await expect.poll(async()=>(await state(page)).feedback.character.clip,{timeout:10000,intervals:[100]}).toBe('rest');
  const character=(await state(page)).feedback.character;expect(character.transitions.every((t:any)=>!['celebrate','discover','reflect'].includes(t.pose))).toBe(true);expect(requests).toEqual([]);expect((await state(page)).sessionId).toBeNull();
});
