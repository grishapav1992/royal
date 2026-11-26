import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import sharp from 'sharp';
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).templePreview.state());
const session=(p:Page)=>p.evaluate(()=>(window as any).templePreview.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const scope='artifacts/work/temple-ebb';
async function ready(p:Page,seed='15',reduced=false){await p.context().setExtraHTTPHeaders({'x-temple-test-case':'cascade-seed-'+seed});await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await p.goto('/tests/fixtures/temple-preview.html?lang=en');await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(p)).ready).toBe(true);await game(p).locator('[data-ft=stake]').selectOption('1000');await expect.poll(async()=>(await state(p)).selectedStakeUnits).toBe('1000');}
async function sound(p:Page){await p.evaluate(()=>(window as any).templePreview.audio.setMuted(true));await game(p).locator('[data-ft=mute]').click();await expect.poll(async()=>(await state(p)).audio.ready).toBe(true);}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s.completed&&!s.presenting&&!s.busy;},{timeout:60000}).toBe(true);}

test('a paid chain shows the lever, landings, crumble and the next water mark with their sounds',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);await sound(page);
  const clips=new Set<string>(),steps:number[]=[];await game(page).locator('[data-ft=primary]').click();
  await expect.poll(async()=>{const s=await state(page);clips.add(s.character.clip);if(s.character.pose)clips.add('pose:'+s.character.pose);if(steps.at(-1)!==s.stage.step)steps.push(s.stage.step);return s.completed&&!s.presenting;},{intervals:[25],timeout:30000}).toBe(true);
  const s=await state(page),played=s.audio.played;expect(clips.has('lever')).toBe(true);expect(clips.has('pose:pull')).toBe(true);expect(steps).toEqual([0,1]);
  for(const cue of['lever','cascadeReturn','scrape'])expect(played[cue]??0).toBeGreaterThan(0);expect((played.cascadeLandA??0)+(played.cascadeLandB??0)+(played.cascadeLandC??0)).toBeGreaterThanOrEqual(5);expect((played.cascadeBreakA??0)+(played.cascadeBreakB??0)).toBeGreaterThan(0);
  expect(played.big??0).toBe(0);expect(s.stage.maxParticles).toBeLessThanOrEqual(951);expect(errors).toEqual([]);
});

test('skipping a bonus shows its confirmed end once, keeps the paid start single and credits once',async({page})=>{
  await ready(page,'118');const starts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion')&&r.postDataJSON().action==='start')starts.push(r.postDataJSON().id);});
  await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>(await state(page)).stage.holy,{timeout:20000}).toBe(1);await mkdir(scope,{recursive:true});await sharp(await page.screenshot()).webp({quality:80}).toFile(scope+'/sanctuary.webp');
  await game(page).locator('[data-ft=primary]').click();await done(page);const final=await session(page);expect(final.state).toBe('settled');expect(starts.length).toBe(1);expect(final.spentUnits).toBe(final.stakeUnits);
  await expect(game(page).locator('[data-ft-value=payout]')).toHaveText((Number(final.returnedUnits)/100).toLocaleString('en-US',{minimumFractionDigits:2}));expect((await state(page)).stage.holy).toBe(0);expect((await state(page)).presenting).toBe(false);
});

test('reduced motion presents the same confirmed round without particles or a moving heroine',async({page})=>{
  await ready(page,'15',true);await game(page).locator('[data-ft=primary]').click();await done(page);const s=await state(page);expect(s.stage.maxParticles).toBe(0);
  expect(await game(page).locator('.ebb').evaluate(root=>root.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);expect((await session(page)).returnedUnits).toBe('250');
});
