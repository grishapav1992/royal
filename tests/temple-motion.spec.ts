import {test,expect,request as apiRequest,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const scope=process.env.TEMPLE_MOTION_SCOPE??'artifacts/work/temple-motion-fix';
const game=(page:Page)=>page.frameLocator('.temple-frame');
async function ready(page:Page){
  await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-15'});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/tests/fixtures/temple-preview.html?lang=ru');
  await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>(window as any).templePreview?.state().character.loaded.length)).toBe(6);
}
async function capture(page:Page){
  await game(page).locator('.ft').evaluate(root=>{
    const win=root.ownerDocument.defaultView! as any;
    const board=root.querySelector('.ft-cabinet')!,portrait=root.querySelector('canvas')!,button=root.querySelector('[data-ft=primary]')!;
    const sample=win.templeMotionProbe={frames:[] as any[],active:true};
    const frame=()=>{
      if(!sample.active)return;
      const origin=root.getBoundingClientRect();
      const box=(selector:string)=>{const r=root.querySelector(selector)!.getBoundingClientRect();return [r.x-origin.x,r.y-origin.y,r.width,r.height];};
      sample.frames.push({beat:(root as HTMLElement).dataset.feedback,board:box('.ft-cabinet'),character:box('.ft-character'),
        origin:[origin.x,origin.y],scroll:win.scrollY,
        sameBoard:board===root.querySelector('.ft-cabinet'),samePortrait:portrait===root.querySelector('canvas'),sameButton:button===root.querySelector('[data-ft=primary]'),
        transforms:[...root.querySelectorAll('[data-cell]')].map(el=>win.getComputedStyle(el).transform),
        top:box('[data-cell="0"]'),reels:box('.ft-reels'),
        pose:(root.querySelector('.ft-character') as HTMLElement).dataset.pose});
      if(sample.frames.length<500)win.requestAnimationFrame(frame);
    };
    win.requestAnimationFrame(frame);
  });
}
async function result(page:Page){await expect.poll(()=>page.evaluate(()=>{const s=(window as any).templePreview?.state()??(window as any).royalDemo?.getMiniState();return s?.completed&&!s.busy&&!s.presenting;}),{timeout:60000}).toBe(true);}
async function finishCapture(page:Page,name:string,quick=false){
  const frames=await game(page).locator('.ft').evaluate(root=>{const p=(root.ownerDocument.defaultView! as any).templeMotionProbe;p.active=false;return p.frames;});
  const drops=frames.filter((f:any)=>f.beat==='drop');
  const visible=drops.filter((f:any)=>f.top[1]+f.top[3]>f.reels[1]&&f.top[1]<f.reels[1]+f.reels[3]&&f.transforms[0]!=='matrix(1, 0, 0, 1, 0, 0)');
  const stable=frames.every((f:any)=>f.sameBoard&&f.samePortrait&&f.sameButton);
  const ranges=Object.fromEntries(['board','character'].map(part=>[part,[0,1,2,3].map(i=>Math.max(...frames.map((f:any)=>f[part][i]))-Math.min(...frames.map((f:any)=>f[part][i])))]));
  const viewportShift=[0,1].map(i=>Math.max(...frames.map((f:any)=>f.origin[i]))-Math.min(...frames.map((f:any)=>f.origin[i])));
  await mkdir(scope,{recursive:true});await writeFile(scope+'/'+name+'.json',JSON.stringify({frames:frames.length,dropFrames:drops.length,visibleTopPositions:new Set(visible.map((f:any)=>f.top[1].toFixed(1))).size,stable,ranges,viewportShift,scrollRange:Math.max(...frames.map((f:any)=>f.scroll))-Math.min(...frames.map((f:any)=>f.scroll))},null,2)+'\n');
  expect(new Set(drops.map((f:any)=>JSON.stringify(f.transforms))).size).toBeGreaterThan(quick?4:8);
  expect(new Set(visible.map((f:any)=>f.top[1].toFixed(1))).size).toBeGreaterThanOrEqual(quick?4:8);
  expect(stable).toBe(true);
  for(const range of Object.values(ranges))for(const delta of range)expect(delta).toBeLessThan(1);
  // Pointer focus may round the narrow iframe scroll position by one CSS pixel.
  for(const delta of viewportShift)expect(delta).toBeLessThanOrEqual(1);
}
test('ordinary spins visibly animate confirmed stones while the cabinet, portrait and controls remain mounted',async({page})=>{
  await ready(page);await capture(page);await game(page).locator('[data-ft=primary]').click();
  await result(page);await finishCapture(page,'fixture');
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2,50');
  expect(await page.evaluate(()=>(window as any).templePreview.state().character.poseBlendMode)).toBe('anchored-mesh');
  expect(await page.evaluate(()=>(window as any).templePreview.state().character.pose)).toBe('idle');
});

for(const viewport of [{width:1280,height:720,quick:false},{width:390,height:844,quick:false},{width:1280,height:720,quick:true},{width:390,height:844,quick:true}])test(`real Royal with connected chat keeps spin geometry: ${viewport.width} ${viewport.quick?'quick':'normal'}`,async({page})=>{
  const api=await apiRequest.newContext({baseURL:test.info().project.use.baseURL});let peer:any;
  try{
  const auth=await api.post('/api/auth/login',{data:{email:'temple-motion-peer-'+crypto.randomUUID()+'@example.test',password:'Temple-local-review-42!'}});expect(auth.ok()).toBe(true);await api.post('/api/auth/character',{data:{skin:0}});
  peer=await new Client('http://127.0.0.1:'+(process.env.TEMPLE_API_PORT??'2663'),{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{const r=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}}).create('lobby');
  for(const type of['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
  await page.setViewportSize({width:viewport.width,height:viewport.height});await ready(page);await page.request.post('/api/auth/character',{data:{skin:0}});
  await page.goto('/?lang=ru&room='+peer.roomId);await expect(page.locator('#join-dialog')).toBeHidden();
  await page.waitForFunction(()=>{try{return(window as any).royalDemo?.getState().online===true;}catch{return false;}});
  await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();
  await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();
  await page.locator('#mini-dialog').evaluate(async dialog=>{await Promise.all(dialog.getAnimations({subtree:true}).filter(a=>Number.isFinite(Number(a.effect?.getComputedTiming().endTime))).map(a=>a.finished.catch(()=>{})));});
  if(viewport.quick)await game(page).locator('[data-ft=fast]').click();
  await game(page).locator('[data-ft=primary]').scrollIntoViewIfNeeded();await capture(page);
  await game(page).locator('[data-ft=primary]').click();
  if(viewport.quick){
    await expect.poll(()=>page.evaluate(()=>{const s=(window as any).royalDemo.getMiniState();return s.feedback.event==='drop'&&s.feedback.offsetMs>25&&s.feedback.offsetMs<150;}),{intervals:[10]}).toBe(true);
    await sharp(await page.screenshot()).webp({quality:82}).toFile(scope+'/host-'+viewport.width+'-quick-falling.webp');
  }
  await result(page);const name='host-'+viewport.width+(viewport.quick?'-quick':'');await finishCapture(page,name,viewport.quick);
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2,50');await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
  const state=await page.evaluate(()=>(window as any).royalDemo.getMiniState());expect(state.audio.played.win??0).toBe(0);
  await sharp(await page.screenshot()).webp({quality:82}).toFile(scope+'/'+name+'.webp');
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getMiniState().character.renderer)).toBe('mesh');
  if(viewport.width<600){
    await game(page).locator('.ft-character').scrollIntoViewIfNeeded();
    await expect(game(page).locator('.ft-character')).toBeInViewport();
    await sharp(await page.screenshot()).webp({quality:82}).toFile(scope+'/'+name+'-portrait.webp');
  }
  }finally{if(peer)await peer.leave();await api.dispose();}
});

test('quick and reduced modes, pause and quiet reopen retain exact results',async({page})=>{
  await ready(page);const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postDataJSON());});
  await page.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await game(page).locator('[data-ft=mute]').click();await expect.poll(()=>page.evaluate(()=>(window as any).templePreview.state().audio.ready)).toBe(true);
  await game(page).locator('[data-ft=fast]').click();await game(page).locator('[data-ft=primary]').click();await result(page);
  const quick=await page.evaluate(()=>(window as any).templePreview.state());
  expect(quick.feedback.frames.map((f:any)=>f.kind)).toEqual(['drop','evaluate','break','drop','evaluate','outcome']);
  expect(quick.audio.played.cascadeLandB).toBe(1);expect(quick.audio.played.cascadeLandC).toBe(1);expect(quick.audio.played.cascadeBreakB).toBe(1);expect(quick.audio.played.neutral).toBe(1);expect(quick.audio.played.win??0).toBe(0);
  expect(quick.audio.activeSources).toBeLessThanOrEqual(10);expect(quick.feedback.effects.maxNodes).toBe(0);expect(quick.character.reduced).toBe(false);
  await expect(game(page).locator('.ft')).toHaveAttribute('data-motion','full');
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2,50');
  await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-15-reduced'});
  await page.emulateMedia({reducedMotion:'reduce'});await game(page).locator('[data-ft=primary]').click();await result(page);
  const reduced=await page.evaluate(()=>(window as any).templePreview.state());expect(reduced.feedback.frames.slice(-1).map((f:any)=>f.kind)).toEqual(['summary']);expect(reduced.character.reduced).toBe(true);
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2,50');
  await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-15-pause'});
  await game(page).locator('[data-ft=fast]').click();
  await page.emulateMedia({reducedMotion:'no-preference'});await game(page).locator('[data-ft=primary]').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).templePreview.state().presenting)).toBe(true);
  await game(page).locator('[data-ft=fast]').click();expect(await page.evaluate(()=>(window as any).templePreview.state().presenting)).toBe(true);
  await page.evaluate(()=>(window as any).templePreview.pause());await result(page);
  const count=posts.length;await page.locator('#reopen').click();await result(page);expect(posts.length).toBe(count);
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2,50');
  expect(await page.evaluate(()=>(window as any).templePreview.state().audio.played)).toEqual({});
  expect(posts.filter(p=>p.action==='start')).toHaveLength(3);
});

for(const quick of[false,true])test(`a full bonus keeps stable mounted stones through free continuations and restores the saved base grid: ${quick?'quick':'normal'}`,async({page})=>{
  await ready(page);await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-118'});
  if(quick)await game(page).locator('[data-ft=fast]').click();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postDataJSON());});
  await game(page).locator('[data-ft=primary]').click();await result(page);
  const state=await page.evaluate(()=>(window as any).templePreview.state());
  const accepted=await page.evaluate(()=>(window as any).templePreview.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
  expect(state.feedback.frames.filter((f:any)=>f.kind==='drop')).toHaveLength(31);
  expect(state.feedback.frames.filter((f:any)=>f.kind==='base-return')).toHaveLength(1);
  expect(state.feedback.effects.maxNodes).toBeLessThanOrEqual(60);
  expect(accepted.returnedUnits).toBe('30250');expect(posts.filter(p=>p.action==='start')).toHaveLength(1);
  expect(await game(page).locator('[data-cell]').evaluateAll(cells=>cells.map(c=>Number((c as HTMLElement).dataset.symbol)))).toEqual(accepted.view.templeCascade.frames.at(-1).grid);
  expect(errors).toEqual([]);
});

test('ten quick autoplay rounds each animate once, debit once and stop at the selected count',async({page})=>{
  await ready(page);await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-blank'});await game(page).locator('[data-ft=fast]').click();
  const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postDataJSON());});
  await game(page).locator('[data-ft=auto-count]').selectOption('10');await game(page).locator('[data-ft=auto]').click();
  await expect.poll(()=>page.evaluate(()=>{const s=(window as any).templePreview.state();return s.completed&&!s.autoplay.running&&!s.busy&&!s.presenting;}),{timeout:30000}).toBe(true);
  const state=await page.evaluate(()=>(window as any).templePreview.state());expect(state.feedback.frames.filter((f:any)=>f.kind==='drop')).toHaveLength(10);
  const starts=posts.filter(p=>p.action==='start');expect(starts).toHaveLength(10);expect(new Set(starts.map(p=>p.id)).size).toBe(10);
  await expect(game(page).locator('[data-ft-value=balance]')).toHaveText('9 900,00');expect(state.autoplay.remaining).toBe(0);expect(state.pending).toBe(false);
});
