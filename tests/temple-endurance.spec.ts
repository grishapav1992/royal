import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const entry='/tests/fixtures/temple-preview.html?lang=en&version=0.9.0';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const session=(p:Page)=>p.evaluate(()=>(window as any).templePreview.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const balance=(p:Page)=>p.evaluate(()=>(window as any).templePreview.wallet.wallet.balance);
async function ready(p:Page,scenario?:string){await p.context().setExtraHTTPHeaders(scenario?{'x-temple-test-case':scenario}:{});await p.emulateMedia({reducedMotion:'reduce'});await p.goto(entry);await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s.completed&&!s.busy&&!s.presenting;},{timeout:60000}).toBe(true);}
async function report(name:string,value:unknown){await mkdir('artifacts/work/temple-endurance',{recursive:true});await writeFile(`artifacts/work/temple-endurance/${name}.json`,JSON.stringify(value,null,2)+'\n');}

for(const scenario of ['cascade-blank','cascade-seed-118',undefined])test(`sustained autoplay settles once and remains bounded: ${scenario??'crypto randomness'}`,async({page})=>{
  const errors:string[]=[],accepted=new Map<string,any>(),posts:any[]=[],times:number[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postDataJSON());});
  // Before requestfinished, the installed Playwright exposes startTime=0.
  page.on('requestfinished',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))times.push(r.timing().startTime);});
  page.on('response',async r=>{if(r.request().method()==='POST'&&r.url().endsWith('/expansion')&&r.ok()){const value=await r.json();if(value.session.state==='settled')accepted.set(value.session.id,value.session);}});
  await ready(page,scenario);await game(page).locator('[data-ft=fast]').click();await game(page).locator('[data-ft=auto-count]').selectOption('100');const initial=await balance(page),samples:any[]=[];
  const rounds=scenario==='cascade-blank'?300:100;
  for(let series=0;series<rounds/100;series++){
    await game(page).locator('[data-ft=auto]').click();
    await expect.poll(async()=>{const s=await state(page);if(posts.length>=samples.length*25)samples.push({requests:posts.length,dom:await game(page).locator('.ft *').count(),fx:s.feedback.effects.nodes,history:s.feedback.frames.length,voices:s.audio.activeSources});return s.autoplay.running;},{timeout:180000,intervals:[250]}).toBe(false);
    expect((await state(page)).pending).toBe(false);
    expect(accepted.size).toBe((series+1)*100);
  }
  await done(page);await expect.poll(()=>accepted.size).toBe(rounds);
  const starts=posts.filter(p=>p.action==='start');expect(starts.length).toBe(rounds);expect(new Set(starts.map(p=>p.id)).size).toBe(rounds);
  await expect.poll(()=>times.length).toBe(posts.length);expect(times.every(t=>Number.isFinite(t)&&t>0)).toBe(true);times.sort((a,b)=>a-b);
  const minimumRequestGapMs=Math.min(...times.slice(1).map((t,i)=>t-times[i]));
  const maximumRequestsInMinute=Math.max(...times.map((t,i)=>times.slice(0,i+1).filter(v=>v>t-60000).length));
  expect(maximumRequestsInMinute).toBeLessThanOrEqual(120);
  const spent=[...accepted.values()].reduce((n,s)=>n+BigInt(s.spentUnits),0n),returned=[...accepted.values()].reduce((n,s)=>n+BigInt(s.returnedUnits),0n);
  expect(Math.round((await balance(page))*100)).toBe(Math.round(initial*100)-Number(spent)+Number(returned));
  expect(starts.every(p=>accepted.has(p.id))).toBe(true);expect(samples.every(s=>s.dom<400&&s.fx<=60&&s.history<=120&&s.voices<=10)).toBe(true);
  const final=await state(page);expect(final.pending).toBe(false);expect(final.feedback.framePending).toBe(false);expect(final.feedback.effects.nodes).toBe(0);
  await page.waitForTimeout(350);expect(posts.filter(p=>p.action==='start').length).toBe(rounds);expect(errors).toEqual([]);
  await report(scenario??'crypto',{paidRounds:rounds,requests:posts.length,continuations:posts.length-rounds,elapsedMs:times.at(-1)!-times[0],minimumRequestGapMs,maximumRequestsInMinute,initialBalance:initial,finalBalance:await balance(page),spentUnits:String(spent),returnedUnits:String(returned),samples,errors});
});

test('eight lost starts keep their UUID across repeated failures, offline retries and reloads',async({page})=>{
  await ready(page,'cascade-seed-118');const initial=await balance(page),settled:any[]=[],cases:any[]=[];
  for(let i=0;i<8;i++){
    let sent=false,saved:any;const requests:any[]=[];
    const watch=(r:any)=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))requests.push(r.postDataJSON());};page.on('request',watch);
    const lose=async(route:Route)=>{
      if(route.request().method()!=='POST'||sent){await route.fallback();return;}sent=true;
      await page.evaluate(()=>(window as any).templePreview.pause());
      if(i%2===0)saved=await(await route.fetch()).json();
      await route.abort('failed');
    };
    await page.route('**/api/*-wallet/expansion',lose);await game(page).locator('[data-ft=primary]').click();
    await expect.poll(async()=>{const s=await state(page);return s.pending&&!s.busy;}).toBe(true);
    const id=await page.evaluate(()=>(window as any).templePreview.client.pending.id);expect(id).toBe(requests[0].id);
    await page.unroute('**/api/*-wallet/expansion',lose);
    if(i%2===0){await page.reload();await expect(game(page).locator('[data-ft=primary]')).toContainText('Check round');}
    else await page.evaluate(()=>(window as any).templePreview.resume());
    // An actual offline request must preserve pending state without clearing its UUID.
    await page.context().setOffline(true);await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).busy).toBe(false);
    expect(await page.evaluate(()=>(window as any).templePreview.client.pending.id)).toBe(id);
    await page.context().setOffline(false);
    const fail=async(route:Route)=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary test outage'})}):route.fallback();
    await page.route('**/api/*-wallet/expansion',fail);await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).busy).toBe(false);
    expect(await page.evaluate(()=>(window as any).templePreview.client.pending.id)).toBe(id);await page.unroute('**/api/*-wallet/expansion',fail);
    await game(page).locator('[data-ft=primary]').click();await done(page);const s=await session(page);expect(s.id).toBe(id);expect(s.spentUnits).toBe('1000');if(saved?.session.state==='settled')expect(s).toEqual(saved.session);
    expect(new Set(requests.filter(p=>p.action==='start').map(p=>p.id)).size).toBe(1);expect((await state(page)).autoplay.running).toBe(false);
    settled.push(s);cases.push({acceptedBeforeLoss:i%2===0,requests:requests.length,startAttempts:requests.filter(p=>p.action==='start').length,paidRounds:1,continuations:s.view.templeCascade.revision-1});page.off('request',watch);
  }
  const returned=settled.reduce((n,s)=>n+Number(s.returnedUnits),0);expect(Math.round((await balance(page))*100)).toBe(Math.round(initial*100)-8000+returned);
  await report('lost-starts',{paidRounds:8,cases,initialBalance:initial,finalBalance:await balance(page),returnedUnits:returned});
});

test('twelve tab closures during an accepted 20-free-spin bonus resume without another stake',async({page,context})=>{
  await ready(page,'cascade-seed-118-close-0');const initial=await balance(page),requests:any[]=[];context.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))requests.push(r.postDataJSON());});
  let current=page;const rounds:any[]=[];
  for(let i=0;i<12;i++){
    await context.setExtraHTTPHeaders({'x-temple-test-case':`cascade-seed-118-close-${i}`});
    const pause=async(route:Route)=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='start'){const response=await route.fetch();await current.evaluate(()=>(window as any).templePreview.pause());await route.fulfill({response});}else await route.fallback();};
    await current.route('**/api/*-wallet/expansion',pause);await game(current).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(current)).busy).toBe(false);const saved=await session(current);expect(saved.state).toBe('active');
    const id=saved.id;await current.close();current=await context.newPage();await current.emulateMedia({reducedMotion:'reduce'});await current.goto(entry);await expect(game(current).locator('.ft-cascade')).toBeVisible();await done(current);
    const restored=await session(current);expect(restored.id).toBe(id);expect(restored.spentUnits).toBe('1000');expect(restored.view.templeCascade.state.playedFreeSpins).toBe(20);expect(restored.view.templeCascade.state.falls).toBe(31);expect(restored.returnedUnits).toBe('30250');rounds.push({falls:31,freeSpins:20,operations:restored.view.templeCascade.revision});
    expect((await state(current)).autoplay.running).toBe(false);expect((await state(current)).pending).toBe(false);
  }
  expect(requests.filter(p=>p.action==='start').length).toBe(12);expect(new Set(requests.filter(p=>p.action==='start').map(p=>p.id)).size).toBe(12);
  expect(Math.round((await balance(current))*100)).toBe(Math.round(initial*100)+12*(30250-1000));
  await report('tab-recovery',{paidRounds:12,tabClosures:12,rounds,requests:requests.length,initialBalance:initial,finalBalance:await balance(current)});
});
