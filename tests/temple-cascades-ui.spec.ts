import {test,expect,request as apiRequest,type Page,type Route} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {walletSnapshot} from './wallet-snapshot';
const entry='/tests/fixtures/temple-preview.html',review=process.env.TEMPLE_REVIEW_DIR||'artifacts/work/temple-cascades-stage4';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const session=(p:Page)=>p.evaluate(()=>(window as any).templePreview.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const balance=(p:Page)=>p.evaluate(()=>(window as any).templePreview.wallet.wallet.balance);
async function ready(p:Page,scenario='cascade-blank',lang='en',reduced=true){await p.context().setExtraHTTPHeaders({'x-temple-test-case':scenario});await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await p.goto(entry+'?lang='+lang);await expect(game(p).locator('.ebb')).toBeVisible();await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(p)).ready).toBe(true);await game(p).locator('[data-ft=stake]').selectOption('1000');await expect.poll(async()=>(await state(p)).selectedStakeUnits).toBe('1000');}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s?.completed&&!s?.busy&&!s?.presenting;},{timeout:60000}).toBe(true);}
async function spin(p:Page){await game(p).locator('[data-ft=primary]').click();await done(p);}

test('RU/EN rules, payline table, stake entry and responsive framing without overflow',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const geometry:unknown[]=[];
  for(const lang of['ru','en']){
    await ready(page,'cascade-blank',lang);await expect(game(page).locator('[data-ft=stake] option')).toHaveCount(10);await expect(game(page).locator('input[data-manual-stake]')).toBeVisible();
    await game(page).locator('[data-ft=rules]').click();await expect(game(page).locator('dialog tbody tr')).toHaveCount(7);await expect(game(page).locator('.ft-paylines>div')).toHaveCount(20);await expect(game(page).locator('dialog')).toContainText('500');
    await game(page).locator('[data-ft=close]').click();await expect(game(page).locator('[data-ft=rules]')).toBeFocused();
    await expect(game(page).locator('.ebb-grid')).toHaveAttribute('aria-label',lang==='en'?/^5 by 3 grid: /:/^Поле 5 на 3: /);
    for(const [width,height]of[[1440,1000],[1000,760],[768,1024],[390,844],[360,740],[844,390]]){
      await page.setViewportSize({width,height});await game(page).locator('.ebb').evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
      const g=await game(page).locator('.ebb').evaluate(root=>{const rect=(q:string)=>root.querySelector(q)!.getBoundingClientRect().toJSON();const st=(window as any).parent.templePreview.state().stage;return {width:root.clientWidth,height:root.clientHeight,scroll:root.scrollWidth,board:rect('.ebb-grid'),console:rect('.ebb-console'),title:rect('.ebb-top'),mode:st.mode,controls:Array.from(root.querySelectorAll('.ebb-console button,.ebb-console input,.ebb-top button')).map(e=>e.getBoundingClientRect().toJSON())};});
      geometry.push({lang,width,height,...g});expect(g.scroll).toBeLessThanOrEqual(g.width+1);expect(g.board.bottom).toBeLessThanOrEqual(g.console.top);expect(g.board.top).toBeGreaterThanOrEqual(g.title.top);
      for(const c of g.controls){expect(c.right).toBeLessThanOrEqual(g.width+1);expect(c.bottom).toBeLessThanOrEqual(g.height+1);expect(Math.min(c.width,c.height)).toBeGreaterThanOrEqual(36);}
      await expect(game(page).locator('[data-ft=primary]')).toBeInViewport();
    }
    await page.setViewportSize({width:1440,height:1000});await spin(page);expect((await session(page)).returnedUnits).toBe('0');await expect(game(page).locator('[data-ft-value=payout]')).toHaveText(lang==='en'?'0.00':'0,00');await expect(game(page).locator('.ebb-say')).toContainText(lang==='en'?'No win':'Без выигрыша');
  }
  await mkdir(review,{recursive:true});await writeFile(review+'/geometry.json',JSON.stringify(geometry,null,2));expect(errors).toEqual([]);
});

test('cap frames show confirmed order, multiplier, exact payout and quiet restore',async({page})=>{
  await ready(page,'cascade-cap','en',false);const before=await balance(page);await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);const s=await session(page);expect(s.rulesVersion).toBe(2);expect(s.view.templeCascade.frames.length).toBe(1);await expect(game(page).locator('[data-ft=primary]')).toContainText('Show result');
  const id=s.id;await game(page).locator('[data-ft=primary]').click();await done(page);expect((await session(page)).id).toBe(id);expect((await session(page)).returnedUnits).toBe('500000');expect(await balance(page)).toBe(before-10+5000);await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('5,000.00');expect((await state(page)).visual.capped).toBe(true);
  await page.locator('#reopen').click();await expect(game(page).locator('.ebb')).toBeVisible();await done(page);expect((await state(page)).audio.played).toEqual({});expect((await state(page)).presenting).toBe(false);expect((await state(page)).character.clip).not.toBe('triumph');expect((await state(page)).stage.holy).toBe(0);
});

test('free spins continue automatically across batches, retry a lost continuation and credit once',async({page})=>{
  await ready(page,'cascade-seed-118');const before=await balance(page);let lost:any,pendingId='';
  const lose=async(route:Route)=>{if(route.request().method()!=='POST'||route.request().postDataJSON().action!=='move'||lost){await route.fallback();return;}lost=await(await route.fetch()).json();await page.evaluate(()=>(window as any).templePreview.pause());await route.abort('failed');};
  await page.route('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await expect.poll(()=>!!lost,{timeout:15000}).toBe(true);await expect.poll(async()=>(await state(page)).busy).toBe(false);pendingId=await page.evaluate(()=>(window as any).templePreview.client.pending.id);
  const saved=await session(page);expect(saved.state).toBe('active');expect(saved.view.templeCascade.state.awardedFreeSpins).toBeGreaterThanOrEqual(10);expect(await balance(page)).toBe(before-10);
  await page.unroute('**/api/*-wallet/expansion',lose);await page.evaluate(()=>(window as any).templePreview.resume());await expect(game(page).locator('[data-ft=primary]')).toContainText('Check round');
  const retried:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))retried.push(r.postDataJSON().id);});await game(page).locator('[data-ft=primary]').click();await done(page);expect(retried[0]).toBe(pendingId);
  const final=await session(page);expect(final.view.templeCascade.state.playedFreeSpins).toBeGreaterThanOrEqual(10);expect(final.view.templeCascade.operations.length).toBeGreaterThan(1);expect(final.spentUnits).toBe('1000');expect(await balance(page)).toBe(before-10+Number(final.returnedUnits)/100);
  const after=await balance(page);await page.reload();await expect(game(page).locator('.ebb')).toBeVisible();await done(page);expect(await balance(page)).toBe(after);expect((await state(page)).audio.played).toEqual({});
});

test('lost start survives reload and checks the same UUID without a second wager',async({page})=>{
  await ready(page);const before=await balance(page);let saved:any;
  const lose=async(route:Route)=>{if(route.request().method()!=='POST'||saved){await route.fallback();return;}saved=await(await route.fetch()).json();await route.abort('failed');};
  await page.route('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).pending).toBe(true);await expect.poll(async()=>(await state(page)).busy).toBe(false);const id=await page.evaluate(()=>(window as any).templePreview.client.pending.id);
  await page.reload();await expect(game(page).locator('[data-ft=primary]')).toContainText('Check round');await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await page.unroute('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();await done(page);expect((await session(page)).id).toBe(id);expect(await session(page)).toEqual(saved.session);expect(await balance(page)).toBe(before-10);
});

test('partial return uses full-round net, reduced motion stays still and account change clears the result',async({page})=>{
  await ready(page,'cascade-seed-15');await spin(page);expect((await session(page)).returnedUnits).toBe('250');await expect(game(page).locator('.ebb-say')).toContainText('Partial return');await expect(game(page).locator('.ebb-console em')).toHaveText('Net −7.50');expect((await state(page)).audio.played.win??0).toBe(0);expect((await state(page)).audio.played.big??0).toBe(0);
  expect(await game(page).locator('.ebb').evaluate(root=>root.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);
  await page.evaluate(()=>{const w=(window as any).templePreview.wallet;w.wallet={...w.wallet,balance:0};w.dispatchEvent(new Event('change'));});await expect(game(page).locator('[data-ft=primary]')).toBeDisabled();await expect(game(page).locator('.ebb-console em')).toHaveText('Net −7.50');
  await page.evaluate(()=>(window as any).templePreview.wallet.setAccount(null));await expect(game(page).locator('[data-ft=primary]')).toBeDisabled();expect((await state(page)).visual).toBeUndefined();expect((await state(page)).stage.holy).toBe(0);expect((await state(page)).owner).toBeNull();expect((await state(page)).autoplay.running).toBe(false);
});

test('ordinary playback displays every confirmed frame in order and quick play has the same result',async({page,browser})=>{
  await ready(page,'cascade-seed-15','en',false);const steps:number[]=[];await game(page).locator('[data-ft=primary]').click();
  await expect.poll(async()=>{const s=await state(page);if(steps.at(-1)!==s.stage.step)steps.push(s.stage.step);return s.completed&&!s.presenting;},{intervals:[30],timeout:20000}).toBe(true);
  const normal=await session(page);expect(normal.view.templeCascade.frames.map((f:any)=>f.multiplier)).toEqual([1,2]);expect(steps).toEqual([0,1]);
  const context=await browser.newContext();try{const quick=await context.newPage();await ready(quick,'cascade-seed-15');await game(quick).locator('[data-ft=fast]').click();await spin(quick);const fast=await session(quick);expect(fast.view.templeCascade).toEqual(normal.view.templeCascade);}finally{await context.close();}
});

test('closing an active bonus cancels owned feedback and reopen resumes without another paid start',async({page})=>{
  await ready(page,'cascade-seed-118','en',false);const requests:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))requests.push(r.postDataJSON());});await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);const id=(await session(page)).id;expect((await session(page)).state).toBe('active');
  await page.evaluate(()=>{const h=(window as any).templePreview;h.pause();h.close();});await expect(game(page).locator('.ebb')).toHaveCount(0);await page.waitForTimeout(400);expect(requests.length).toBe(1);const closed=await page.evaluate(()=>(window as any).templePreview.closedState());expect(closed.disposed).toBe(true);expect(closed.audio.activeSources).toBe(0);expect(closed.stage.particles).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#reopen').click();await done(page);expect((await session(page)).id).toBe(id);expect(requests.filter(r=>r.action==='start').length).toBe(1);expect(requests.some(r=>r.action==='move')).toBe(true);
});

test('finite autoplay spends exactly ten stakes; stop and pause cancel future stakes',async({page})=>{
  await ready(page);await game(page).locator('[data-ft=fast]').click();const before=await balance(page),starts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion')&&r.postDataJSON().action==='start')starts.push(r.postDataJSON().id);});
  await game(page).locator('[data-ft=auto]').click();await expect.poll(async()=>(await state(page)).autoplay.running,{timeout:30000}).toBe(false);expect(starts.length).toBe(10);expect(new Set(starts).size).toBe(10);expect(await balance(page)).toBe(before-100);
  await game(page).locator('[data-ft=auto-count]').selectOption('25');await game(page).locator('[data-ft=auto]').click();await expect.poll(()=>starts.length).toBeGreaterThan(10);await game(page).locator('[data-ft=auto]').click();await done(page);const stopped=starts.length;await page.waitForTimeout(600);expect(starts.length).toBe(stopped);expect((await state(page)).autoplay.running).toBe(false);
  await game(page).locator('[data-ft=auto]').click();await page.evaluate(()=>(window as any).templePreview.pause());const paused=starts.length;await page.waitForTimeout(400);expect(starts.length).toBe(paused);await page.evaluate(()=>(window as any).templePreview.resume());expect((await state(page)).autoplay.running).toBe(false);
});

test('accepted legacy expedition finishes under v1 before the next paid cascade round',async({page})=>{
  await ready(page);await page.context().setExtraHTTPHeaders({});await page.evaluate(async()=>{const h=(window as any).templePreview;const r=await fetch('/api/demo-wallet/expansion',{method:'POST',headers:{'Content-Type':'application/json','X-Royal-Temple-Rules':'1','x-temple-test-case':'legacy-bonus'},body:JSON.stringify({id:crypto.randomUUID(),gameId:'studio-flooded-temple',action:'start',stakeUnits:'1000',settings:{temple:{mode:'normal'}}})});if(!r.ok)throw Error(await r.text());await h.client.refresh();});
  await page.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-blank'});await expect(game(page).locator('[data-ft=finish]')).toBeVisible();await expect(game(page).locator('.ft-legacy-note')).toContainText('saved expedition');expect((await session(page)).rulesVersion).toBe(1);
  await game(page).locator('[data-ft=finish]').click();await game(page).locator('[data-ft=confirm-finish]').click();await expect(game(page).locator('.ebb')).toBeVisible();await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();await spin(page);expect((await session(page)).rulesVersion).toBe(2);
});

test('real Royal host keeps connected chat, heroine lane, controls and close/reopen on desktop and phone',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const api=await apiRequest.newContext({baseURL:test.info().project.use.baseURL});
  const auth=await api.post('/api/auth/login',{data:{email:'temple-cascade-peer-'+crypto.randomUUID()+'@example.test',password:'Temple-room-review-42!'}});expect(auth.ok()).toBe(true);await api.post('/api/auth/character',{data:{skin:0}});
  const peer=await new Client('http://127.0.0.1:2627',{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{const r=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new globalThis.Response(await r.body(),{status:r.status(),headers:r.headers()});}}).create('lobby');for(const type of['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
  try{
    await ready(page);expect((await page.request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);await page.goto('/?lang=en&room='+peer.roomId);
    await expect.poll(async()=>{
      const online=await page.evaluate(()=>{try{return (window as any).royalDemo?.getState().online===true;}catch{return false;}});
      if(online)return true;
      const mode=page.locator('.entry-options [data-entry-mode="club"]'),enter=page.getByRole('button',{name:'Enter the hall',exact:true});
      if(await mode.isVisible())await mode.click({timeout:2000});
      else if(await enter.isVisible())await enter.click({timeout:2000});
      return false;
    },{timeout:60000}).toBe(true);
    await page.locator('#games-tab').click();await page.locator('[data-cabinet=studio-dracona]').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();await expect(game(page).locator('.ebb')).toBeVisible({timeout:45000});await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();
    const paid:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion')&&r.postDataJSON().action==='start')paid.push(r.postDataJSON().id);});await game(page).locator('[data-ft=primary]').click();await expect(game(page).locator('.ebb-console em')).toHaveText('Net −0.10');expect(paid.length).toBe(1);
    for(const [width,height]of[[1440,1000],[1000,1100],[768,1024],[390,844]]){
      await page.setViewportSize({width,height});await expect.poll(async()=>await page.locator('#mini-dialog #chat-input').isVisible()||await page.getByRole('button',{name:/^Open chat/}).first().isVisible()).toBe(true);
      const g=await game(page).locator('.ebb').evaluate(root=>({width:root.clientWidth,scroll:root.scrollWidth,board:root.querySelector('.ebb-grid')!.getBoundingClientRect().toJSON(),console:root.querySelector('.ebb-console')!.getBoundingClientRect().toJSON()}));expect(g.scroll).toBeLessThanOrEqual(g.width+1);expect(g.board.bottom).toBeLessThanOrEqual(g.console.top);
      await game(page).locator('[data-ft=primary]').scrollIntoViewIfNeeded();await expect(game(page).locator('[data-ft=primary]')).toBeInViewport();await mkdir(review,{recursive:true});if(width===1440||width===390)await sharp(await page.screenshot()).webp({quality:82}).toFile(`${review}/ebb-host-${width}.webp`);
    }
    await page.locator('#studio-game-list').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();await expect(game(page).locator('.ebb-console em')).toHaveText('Net −0.10');expect(paid.length).toBe(1);
    if(process.env.TEMPLE_RELEASE_VERSION)await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-version',process.env.TEMPLE_RELEASE_VERSION);
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      const before=await walletSnapshot(page),attempts=paid.length;
      let acceptedId='';
      await page.route('**/api/demo-wallet/expansion',async route=>{
        const r=route.request();
        if(acceptedId||r.method()!=='POST'||r.postDataJSON().action!=='start'){await route.continue();return;}
        expect(r.postDataJSON().stakeUnits).toBe('10');
        const reply=await route.fetch();expect(reply.ok()).toBe(true);
        acceptedId=(await reply.json()).session.id;await route.abort('failed');
      });
      await game(page).locator('[data-ft=primary]').click();
      await expect(game(page).locator('[data-ft=primary]')).toHaveText('Check round');
      await page.locator('#studio-game-list').click();
      await page.locator('[data-platform-game=studio-flooded-temple]').click();
      const retry=game(page).locator('[data-ft=primary]');
      await expect(retry).toHaveText('Check round');await retry.click();
      await expect(game(page).locator('.ebb-console em')).toHaveText('Net −0.10');
      const after=await walletSnapshot(page);
      expect(paid.slice(attempts)).toEqual([acceptedId,acceptedId]);
      expect(after.entries.filter((e:any)=>e.kind==='bet').length-before.entries.filter((e:any)=>e.kind==='bet').length).toBe(1);
      expect(Math.round(after.balance*100)).toBe(Math.round(before.balance*100)-10);
      await page.unroute('**/api/demo-wallet/expansion');
    }
    await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#club-chat-dock')).toBeVisible();expect(errors).toEqual([]);
  }finally{await peer.leave();await api.dispose();}
});
