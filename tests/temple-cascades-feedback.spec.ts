import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const session=(p:Page)=>p.evaluate(()=>(window as any).templePreview.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const scope='artifacts/work/temple-cascades-stage4';
async function ready(p:Page,seed='15',reduced=false){await p.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-'+seed});await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await p.goto('/tests/fixtures/temple-preview.html?lang=en&version=0.9.0');await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(p)).character.loaded.length).toBe(6);}
async function sound(p:Page){await p.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await game(p).locator('[data-ft=mute]').click();await expect.poll(async()=>(await state(p)).audio.ready).toBe(true);}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s.completed&&!s.presenting&&!s.busy;},{timeout:60000}).toBe(true);}

test('landings, line count, break and final net share one clock and recorded accents',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);await sound(page);await game(page).locator('[data-ft=primary]').click();
  await expect.poll(async()=>(await state(page)).feedback.event,{intervals:[15]}).toBe('break');const breaking=await state(page);expect(breaking.feedback.effects.nodes).toBeGreaterThan(0);expect(breaking.feedback.effects.nodes).toBeLessThanOrEqual(60);await mkdir('docs/assets/flooded-temple',{recursive:true});await sharp(await page.screenshot()).webp({quality:84}).toFile('docs/assets/flooded-temple/cascades-stage4-fracture.webp');
  await done(page);const result=await state(page);expect(result.feedback.frames.map((f:any)=>f.kind)).toEqual(['drop','evaluate','break','drop','evaluate','outcome']);expect(result.feedback.effects.shownUnits).toBe('250');await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2.50');await expect(game(page).locator('.ft-status')).toContainText('Round net -7.50');
  expect(result.audio.played.cascadeLandB).toBe(1);expect(result.audio.played.cascadeLandC).toBe(1);expect(result.audio.played.cascadeBreakB).toBe(1);expect(result.audio.played.neutral).toBe(1);expect(result.audio.played.win??0).toBe(0);expect(result.character.transitions.some((t:any)=>t.clip==='watch-fall')).toBe(true);expect(result.character.transitions.some((t:any)=>t.clip==='follow-stones'||t.clip==='shield')).toBe(true);expect(result.character.clip).toBe('reflect');
  expect(result.audio.anchors.every((a:any)=>a.state==='scheduled')).toBe(true);expect(result.feedback.accents.length).toBe(4);expect(Math.max(...result.feedback.accents.map((a:any)=>a.skewMs))).toBeLessThan(120);expect(result.audio.activeSources).toBeLessThanOrEqual(5);
  for(const accent of result.feedback.accents){const anchor=result.audio.anchors.find((a:any)=>Math.abs(a.targetPerformanceTime-accent.planned)<.01);expect(anchor).toBeTruthy();}
  await mkdir(scope,{recursive:true});await writeFile(scope+'/timing.json',JSON.stringify({events:result.feedback.frames,accents:result.feedback.accents,anchors:result.audio.anchors,audio:result.audio.played,character:result.character.transitions},null,2));expect(errors).toEqual([]);
});

test('a muted mid-cascade change and zero volume cancel future sounds without replaying them',async({page})=>{
  await ready(page);await sound(page);await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).feedback.event).toBe('evaluate');await page.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await expect.poll(async()=>(await state(page)).audio.activeSources).toBe(0);await done(page);
  const before=(await state(page)).audio.played;await game(page).locator('[data-ft=mute]').click();await page.waitForTimeout(160);expect((await state(page)).audio.played).toEqual(before);
  await page.evaluate(()=>(window as any).templePreview.audio.setVolume(0));await expect.poll(async()=>(await state(page)).audio.activeSources).toBe(0);expect((await state(page)).feedback.effects.nodes).toBe(0);
});

test('skip reveals the exact confirmed result and cancels particles and pending sounds without a new operation',async({page})=>{
  await ready(page);await sound(page);const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postData()!);});await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).feedback.event).toBe('drop');const id=(await session(page)).id;await game(page).locator('[data-ft=primary]').click();await done(page);
  expect(posts.length).toBe(1);expect((await session(page)).id).toBe(id);expect((await state(page)).feedback.effects.nodes).toBe(0);expect((await state(page)).feedback.framePending).toBe(false);await expect(game(page).locator('[data-ft-value=payout]')).toHaveText('2.50');await expect.poll(async()=>(await state(page)).audio.activeSources).toBeLessThanOrEqual(2);
});

test('reduced motion shows a still result; switching to it cancels the live timeline',async({page})=>{
  await ready(page);await sound(page);await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);await page.emulateMedia({reducedMotion:'reduce'});await done(page);const first=await state(page);expect(first.feedback.effects.nodes).toBe(0);expect(first.character.framePending).toBe(false);expect(first.feedback.framePending).toBe(false);
  const plays={...first.audio.played};await page.locator('#reopen').click();await expect(game(page).locator('.ft')).toBeVisible();await done(page);expect((await state(page)).audio.played).toEqual({});expect(await game(page).locator('.ft').evaluate(root=>root.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);expect(plays.win??0).toBe(0);
});

test('pause and a hidden document cancel the owned timeline and stop autoplay',async({page})=>{
  await ready(page);await sound(page);await game(page).locator('[data-ft=auto]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);await page.evaluate(()=>(window as any).templePreview.pause());await expect.poll(async()=>(await state(page)).audio.activeSources).toBe(0);expect((await state(page)).feedback.framePending).toBe(false);expect((await state(page)).autoplay.running).toBe(false);const paused=(await session(page)).id;
  await page.evaluate(()=>(window as any).templePreview.resume());await page.waitForTimeout(250);expect((await session(page)).id).toBe(paused);expect((await state(page)).presenting).toBe(false);
  await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).presenting).toBe(true);await game(page).locator('.ft').evaluate(root=>{Object.defineProperty(root.ownerDocument,'hidden',{configurable:true,value:true});root.ownerDocument.dispatchEvent(new Event('visibilitychange'));});await expect.poll(async()=>(await state(page)).audio.activeSources).toBe(0);expect((await state(page)).feedback.framePending).toBe(false);expect((await state(page)).feedback.effects.nodes).toBe(0);
});

test('bonus presentation spans transport batches, saves the base grid and returns without a repeated paid start',async({page})=>{
  await ready(page,'118');await sound(page);const posts:any[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion'))posts.push(r.postDataJSON());});await game(page).locator('[data-ft=primary]').click();await expect(game(page).locator('.ft-fall-award')).toContainText('FREE SPINS',{timeout:20000});
  await expect.poll(async()=>(await state(page)).feedback.frames.some((f:any)=>f.kind==='base-return'),{timeout:60000}).toBe(true);await done(page);const s=await state(page);expect(posts.filter(p=>p.action==='start').length).toBe(1);expect(posts.some(p=>p.action==='move')).toBe(true);expect(s.audio.played.cascadeBonus).toBeGreaterThanOrEqual(1);expect(s.audio.played.cascadeReturn).toBe(1);expect(s.character.transitions.some((t:any)=>t.clip==='back-to-temple')).toBe(true);expect(s.feedback.effects.maxNodes).toBeLessThanOrEqual(60);
  const v=(await session(page)).view.templeCascade;expect(s.visual.grid).toEqual(v.frames.at(-1).grid);expect(s.feedback.effects.shownUnits).toBe(v.totalPayoutUnits);await writeFile(scope+'/bonus-timing.json',JSON.stringify({feedback:s.feedback,played:s.audio.played,anchors:s.audio.anchors,operations:v.revision,free:v.state.playedFreeSpins},null,2));
});
