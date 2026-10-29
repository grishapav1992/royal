import {test,expect,type Page} from '@playwright/test';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const balance=(p:Page)=>p.evaluate(()=>(window as any).templePreview.wallet.wallet.balance);
const idle=(p:Page)=>expect.poll(async()=>!!(await state(p))?.busy,{timeout:15000}).toBe(false);
async function ready(p:Page){await p.emulateMedia({reducedMotion:'no-preference'});await p.goto('/tests/fixtures/temple-preview.html?lang=en');await expect(game(p).locator('.ft')).toBeVisible();await idle(p);if(!(await state(p)).fast)await game(p).locator('[data-ft=fast]').click();}
async function fixture(p:Page,name='blank'){await p.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()==='POST')await route.continue({headers:{...route.request().headers(),'x-temple-test-case':name}});else await route.continue();});}

test('quick play shows the same confirmed payout with one short reaction and persists only the preference',async({page})=>{
  await fixture(page,'big');await ready(page);const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postData()!);});
  await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).feedback.quick).toBe(true);expect((await state(page)).feedback.event).toBe('summary');expect((await state(page)).feedback.character.pose).toBe('celebrate');await idle(page);
  expect((await state(page)).totalPayoutUnits).toBe('35000');expect(posts).toHaveLength(1);
  await page.reload();await expect(game(page).locator('[data-ft=fast]')).toHaveAttribute('aria-pressed','true');await idle(page);expect((await state(page)).autoplay.running).toBe(false);expect((await state(page)).totalPayoutUnits).toBe('35000');expect(posts).toHaveLength(1);
});

test('a finite ten-spin series uses ten unique paid operations at the locked stake and stops',async({page})=>{
  await fixture(page);await ready(page);const before=await balance(page),posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(JSON.parse(r.postData()!));});
  await expect(game(page).locator('[data-ft=auto-count] option')).toHaveText(['10','25','50','100']);
  await game(page).locator('[data-ft=auto-count]').selectOption('10');await game(page).locator('[data-ft=auto]').click();await expect(game(page).locator('[data-ft=stake]')).toBeDisabled();await expect(game(page).locator('[data-ft=auto-count]')).toBeDisabled();
  await expect.poll(async()=>posts.length,{timeout:30000}).toBe(10);await expect.poll(async()=>(await state(page)).autoplay.running,{timeout:10000}).toBe(false);await idle(page);
  expect(posts.every(p=>p.action==='start'&&p.stakeUnits==='1000'&&p.settings.temple.mode==='normal')).toBe(true);expect(new Set(posts.map(p=>p.id)).size).toBe(10);expect(await balance(page)).toBe(before-100);expect((await state(page)).autoplay.note).toBe('complete');
  await page.waitForTimeout(900);expect(posts).toHaveLength(10);await expect(game(page).locator('[data-ft=stake]')).toBeEnabled();
});

test('autoplay waits for manual expedition choices and resumes without counting its free moves',async({page})=>{
  await fixture(page,'bonus');await ready(page);const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(JSON.parse(r.postData()!));});
  await game(page).locator('[data-ft=auto]').click();await expect.poll(async()=>(await state(page)).autoplay.waitingForRoute).toBe(true);expect((await state(page)).autoplay.remaining).toBe(9);
  await page.waitForTimeout(800);expect(posts).toHaveLength(1);expect((await state(page)).moves).toBe(6);
  await game(page).locator('[data-room="6"]').click();await game(page).locator('[data-ft=primary]').click();await idle(page);expect((await state(page)).autoplay.remaining).toBe(9);expect((await state(page)).moves).toBe(5);
  await game(page).locator('[data-ft=finish]').click();await game(page).locator('[data-ft=confirm-finish]').click();await expect.poll(async()=>posts.filter(p=>p.action==='start').length,{timeout:10000}).toBe(2);await expect.poll(async()=>(await state(page)).autoplay.waitingForRoute).toBe(true);
  expect((await state(page)).autoplay.remaining).toBe(8);expect(posts.filter(p=>p.action==='move').map(p=>p.move)).toEqual(['temple-step','temple-finish']);await game(page).locator('[data-ft=auto]').click();await page.waitForTimeout(900);expect(posts.filter(p=>p.action==='start')).toHaveLength(2);
});

test('stop remains available during an accepted request and prevents every later automatic start',async({page})=>{
  await ready(page);let release!:()=>void,posts=0;
  await page.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}posts++;const response=await route.fetch({headers:{...route.request().headers(),'x-temple-test-case':'blank'}});await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({response});});
  await game(page).locator('[data-ft=auto]').click();await expect.poll(()=>!!release).toBe(true);await expect(game(page).locator('[data-ft=auto]')).toBeEnabled();await game(page).locator('[data-ft=auto]').click();release();await idle(page);
  expect((await state(page)).autoplay.running).toBe(false);await page.waitForTimeout(1000);expect(posts).toBe(1);await page.locator('#reopen').click();await expect(game(page).locator('.ft')).toBeVisible();await idle(page);expect((await state(page)).autoplay.running).toBe(false);expect(posts).toBe(1);
});

test('an unknown auto reply stops the series and manual recovery retries only its original UUID',async({page})=>{
  await ready(page);const before=await balance(page),ids:string[]=[];let lost=false;
  await page.route('**/api/*-wallet/expansion',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}ids.push(JSON.parse(route.request().postData()!).id);const response=await route.fetch({headers:{...route.request().headers(),'x-temple-test-case':'blank'}});if(!lost){lost=true;await route.abort('failed');}else await route.fulfill({response});});
  await game(page).locator('[data-ft=auto]').click();await expect.poll(async()=>(await state(page)).pending).toBe(true);await idle(page);expect((await state(page)).autoplay.running).toBe(false);await page.waitForTimeout(900);expect(ids).toHaveLength(1);
  await game(page).locator('[data-ft=primary]').click();await idle(page);expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect(await balance(page)).toBe(before-10);expect((await state(page)).autoplay.running).toBe(false);
});

test('insufficient shared funds stop a series before the next paid request',async({page})=>{
  await fixture(page);await ready(page);let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts++;});
  await game(page).locator('[data-ft=auto]').click();await expect.poll(async()=>(await state(page)).autoplay.remaining,{intervals:[20]}).toBe(9);
  await page.evaluate(()=>{const w=(window as any).templePreview.wallet;w.wallet={...w.wallet,balance:5};w.dispatchEvent(new Event('change'));});
  await expect.poll(async()=>(await state(page)).autoplay.running).toBe(false);expect((await state(page)).autoplay.note).toBe('funds');await page.waitForTimeout(900);expect(posts).toBe(1);
});

test('host pause, hidden tab, account change and closing cancel the automatic queue',async({page})=>{
  await fixture(page);let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts++;});
  for(const mode of ['pause','hidden','account','close']){
    await ready(page);const before=posts;await game(page).locator('[data-ft=auto]').click();await expect.poll(async()=>(await state(page)).autoplay.remaining,{intervals:[20]}).toBe(9);
    await page.evaluate(mode=>{const h=(window as any).templePreview;if(mode==='pause')h.pause();if(mode==='hidden'){Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));}if(mode==='account')h.wallet.setAccount(null);if(mode==='close')h.close();},mode);
    const stopped=mode==='close'?await page.evaluate(()=>(window as any).templePreview.closedState()):await state(page);expect(stopped.autoplay.running).toBe(false);expect(stopped.autoplay.timerPending).toBe(false);await page.waitForTimeout(800);expect(posts).toBe(before+1);
  }
});
