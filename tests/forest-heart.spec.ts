import { expect, type Page, type FrameLocator } from '@playwright/test';
import { test } from './themed-room';
import { mkdir, writeFile } from 'node:fs/promises';
// @ts-expect-error Independent JavaScript graph oracle has no production scorer dependency.
import { referenceBoard, referenceFlow } from '../scripts/game-math/forest-heart-reference.mjs';

const out = process.env.FOREST_ARTIFACT_DIR || 'artifacts/work/forest-heart-client';
const id = 'studio-forest-heart';
const game = (page: Page) => page.frameLocator('.forest-heart-frame');
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getMiniState());
// RoomScene is constructed asynchronously during a full page reload.
const online = (page: Page) => page.evaluate(() => { try { return !!(window as any).royalDemo?.getState().online; } catch { return false; } });
async function enter(page: Page, roomPath: string, lang = 'ru') {
  await page.goto(roomPath + '&lang=' + lang);
  await page.getByLabel(lang === 'en' ? 'Email' : 'Почта', { exact: true }).fill(`forest-${crypto.randomUUID()}@example.test`);
  await page.getByLabel(lang === 'en' ? 'Password' : 'Пароль', { exact: true }).fill('Forest-complete-test-42!');
  await page.getByRole('button', { name: lang === 'en' ? 'Continue' : 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.locator('#join-button').click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 });
  await expect.poll(() => online(page)).toBe(true);
  expect(await page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    const response = await fetch('/__test/forest-heart/fund',{method:'POST',headers:{'Content-Type':'application/json','X-Royal-Account-Id':me.account.id},body:JSON.stringify({id:crypto.randomUUID(),kind:'deposit',amount:10000})});
    return response.status;
  })).toBe(200);
  await page.locator('#room-overview').click(); await page.locator('#games-tab').click();
  await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect.poll(async () => {
    if (await page.locator('#mini-dialog').isVisible()) return true;
    try { await page.locator('[data-cabinet="studio-cosmic-escape"]').click({ timeout: 600 }); } catch {}
    return page.locator('#mini-dialog').isVisible();
  }, { timeout: 25000, intervals: [1000, 2000] }).toBe(true);
  await choose(page);
}
async function choose(page: Page) {
  await page.locator(`#mini-game [data-platform-game="${id}"]`).click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', id, { timeout: 25000 });
  await expect(game(page).locator('[data-fh=spin]:visible,[data-fh=pass]:visible,[data-fh=retry]:visible').first()).toBeEnabled();
  await expect.poll(() => game(page).locator('.fh-elf').evaluateAll(images => images.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect.poll(async () => (await state(page)).character.ready).toBe(true);
}
async function routeScenario(page: Page, scenario: string, loseFirst = false) {
  let lost = false;
  await page.route('**/api/demo-wallet/expansion', async route => {
    const request = route.request();
    if (request.method() !== 'POST' || request.postDataJSON()?.gameId !== id) { await route.fallback(); return; }
    const response = await route.fetch({ url: new URL('/__test/forest-heart/operate', request.url()).href, headers: { ...request.headers(), 'x-forest-scenario': scenario } });
    if (loseFirst && !lost) { lost = true; await route.abort('connectionreset'); return; }
    await route.fulfill({ response });
  });
}
async function act(page: Page, selector = '[data-fh=spin]') {
  const before = await state(page);
  await game(page).locator(selector).click();
  await expect.poll(async () => { const after = await state(page); return !after.busy && after.view && (after.sessionId !== before.sessionId || after.view.revision !== before.view?.revision); }, { timeout: 15000 }).toBe(true);
  const current = await state(page), v = current.view;
  const bits = v.bonus.at(-1)?.bits ?? (v.base.bits ^ (v.base.rotation === null ? 0 : 1 << v.base.rotation));
  const board = referenceBoard(bits), flow = referenceFlow(board);
  expect(current.scene.board).toEqual(board);
  const lit = await game(page).locator('.fh-powered').evaluateAll(cells => cells.map(c => Number((c as HTMLElement).dataset.cell)).sort((a,b)=>a-b));
  expect(lit).toEqual(flow.reachedCells);
  await expect(game(page).locator('[data-fh=total]')).toHaveText((current.scene.totalUnits / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));
  return current;
}
async function wallet(page: Page) {
  return page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    return (await fetch('/api/demo-wallet', { headers: { 'X-Royal-Account-Id': me.account.id } })).json();
  });
}
async function fit(frame: FrameLocator) {
  const boxes = await frame.locator('.fh').evaluate(root => ({ width: root.ownerDocument.documentElement.clientWidth, scroll: root.ownerDocument.documentElement.scrollWidth, board: root.querySelector('.fh-board')!.getBoundingClientRect().toJSON(), bonusBottom:(root.querySelector('.fh-bonus') as HTMLElement).hidden ? 0 : root.querySelector('.fh-bonus')!.getBoundingClientRect().bottom, controlsTop:root.querySelector('.fh-controls')!.getBoundingClientRect().top }));
  expect(boxes.scroll).toBeLessThanOrEqual(boxes.width + 1); expect(boxes.board.width).toBeGreaterThanOrEqual(180);
  expect(boxes.board.x).toBeGreaterThanOrEqual(0); expect(boxes.board.right).toBeLessThanOrEqual(boxes.width);
  expect(boxes.bonusBottom).toBeLessThanOrEqual(boxes.controlsTop);
}
test.beforeAll(async () => {
  await mkdir(out, { recursive: true });
  await writeFile(out + '/owner.json', JSON.stringify({ owner: 'forest-heart-client', purpose: 'Full Royal host browser and audio checks', cleanup: 'After final report and selected screenshot are saved' }));
});

test('real host preserves choice, bonus, exact settlement and connected chat across desktop, mobile and reopen', async ({ page, roomPath }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await routeScenario(page, 'choice-bonus'); await enter(page, roomPath);
  await expect(page.locator('#chat-input')).toBeInViewport(); await page.screenshot({ path: out + '/desktop.png' }); await fit(game(page));
  const initial = await act(page); expect(initial.view.stage).toBe('choice');await expect(game(page).locator('[data-fh=next]')).toContainText('со знаком ↻');
  await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  const balance = await wallet(page); expect(balance.balance).toBe(9990);
  await page.locator('#studio-game-list').click(); await choose(page);
  expect((await state(page)).sessionId).toBe(initial.sessionId); expect((await state(page)).presentations).toBe(0);
  await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  let current = await act(page, '[data-cell="5"]'); expect(current.view.stage).toBe('bonus');await expect(game(page).locator('[data-fh=next]')).toContainText('бесплатно'); expect((await wallet(page)).balance).toBe(9990);
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('#chat-input')).toBeInViewport(); await fit(game(page));
  await expect(game(page).locator('[data-fh=spin]')).toBeInViewport();
  await page.screenshot({ path: out + '/mobile.png' });
  await page.setViewportSize({width:320,height:780});await fit(game(page));
  const bonusWidth=await game(page).locator('.fh-bonus').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(bonusWidth.scroll).toBeLessThanOrEqual(bonusWidth.width+1);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect(page.locator('#mini-dialog')).toBeHidden();
  await page.setViewportSize({width:1440,height:1000}); await page.locator('#games-tab').click(); await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 }); await choose(page);
  expect((await state(page)).view).toEqual(current.view); expect((await wallet(page)).balance).toBe(9990);
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await expect.poll(()=>online(page)).toBe(true);
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});await choose(page);
  expect((await state(page)).view).toEqual(current.view);expect((await wallet(page)).balance).toBe(9990);
  while (current.view.stage !== 'settled') current = await act(page);
  expect(current.view.totalPayoutUnits).toBe('8834'); expect((await wallet(page)).balance).toBe(10078.34);
  await expect(game(page).locator('[data-fh=net]')).toContainText('+78,34');
  const final = await wallet(page); expect(final.entries.filter((e: any) => e.operationId === initial.sessionId && e.kind === 'bet')).toHaveLength(1);
  await page.locator('#studio-game-list').click(); await choose(page); expect((await wallet(page)).balance).toBe(10078.34);
  expect((await state(page)).presentations).toBe(0); expect((await state(page)).audio.played).toEqual({});
  expect(errors).toEqual([]);
});

test('a lost accepted response retries the same UUID once, with no repeated charge or award', async ({ page, roomPath }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await routeScenario(page, 'partial', true); await enter(page, roomPath);
  await game(page).locator('[data-fh=spin]').click(); await expect(game(page).locator('[data-fh=retry]')).toBeVisible();
  expect((await wallet(page)).balance).toBe(9996.31);
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await expect.poll(()=>online(page)).toBe(true);
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect(page.locator('#mini-dialog')).toBeVisible({timeout:25000});await choose(page);
  await expect(game(page).locator('[data-fh=retry]')).toBeVisible();
  await game(page).locator('[data-fh=retry]').click(); await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  const current = await state(page); expect(current.view.totalPayoutUnits).toBe('631'); expect(current.presentations).toBe(0);
  expect(current.audio.played).toEqual({}); expect((await wallet(page)).balance).toBe(9996.31);
  await expect(game(page).locator('.fh')).toHaveAttribute('data-outcome', 'partial');
  await expect(game(page).locator('[data-fh=net]')).toContainText('-3,69');
});

test('motion and shared audio respect result tiers, mute, pause, rules, skip, and immutable resource loading', async ({ page, roomPath }) => {
  const failed: string[] = []; page.on('response', r => { if (r.status() >= 400 && /game-modules.*forest-heart/.test(r.url())) failed.push(r.url()); });
  await routeScenario(page, 'win'); await enter(page, roomPath);
  await act(page); let current = await state(page);
  await writeFile(out + '/timing.json', JSON.stringify(current.timing, null, 2));
  expect(current.audio.played.land).toBe(1); expect(current.audio.played.flow).toBe(1); expect(current.audio.played.win).toBe(1);
  expect(current.timing.every((t: any) => t.skewMs < 80)).toBe(true);
  const cuesBeforeSilence=current.audio.played;
  await page.evaluate(async()=>{const path='/src/game/GameAudio.ts';const {gameAudio}=await import(path);gameAudio.setVolume(0);});
  expect((await state(page)).audio.activeVoices).toBe(0);
  await page.evaluate(async()=>{const path='/src/game/GameAudio.ts';const {gameAudio}=await import(path);gameAudio.setVolume(.35);});
  await expect.poll(async()=>((await state(page)).audio.musicVoices??0)>0).toBe(true);
  expect((await state(page)).audio.played).toEqual(cuesBeforeSilence);
  await game(page).locator('[data-fh=spin]').click(); await expect(game(page).locator('[data-fh=skip]')).toBeVisible();
  await game(page).locator('[data-fh=skip]').click(); await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).audio.activeVoices).toBe(0);
  await game(page).locator('[data-fh=rules]').click(); await expect(game(page).locator('dialog')).toBeVisible();
  expect((await state(page)).audio.activeVoices).toBe(0);
  await game(page).locator('[data-fh-tab=settings]').click(); await game(page).locator('[data-fh=music]').uncheck(); await game(page).locator('[data-fh=motion]').check();
  await game(page).locator('[data-fh=close]').click(); expect((await state(page)).reduced).toBe(true);
  await game(page).locator('[data-fh=sound]').click(); await act(page); current = await state(page);
  expect(current.audio.activeVoices).toBe(0); expect(current.audio.played.win).toBe(1);
  await page.locator('#studio-game-list').click(); await choose(page); expect((await state(page)).audio.activeVoices).toBe(0);
  expect(failed).toEqual([]);
  await writeFile(out + '/timing.json', JSON.stringify(current.timing, null, 2));
});

test('maximum complete paid round and held roots remain correct in the client', async ({ page, roomPath }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await routeScenario(page, 'maximum'); await enter(page, roomPath);
  let current = await act(page); let held = 0;
  while (current.view.stage !== 'settled') { current = await act(page); expect(current.view.heldState).toBeGreaterThanOrEqual(held); held = current.view.heldState; }
  expect(current.view.totalPayoutUnits).toBe('946500'); expect(current.scene.totalUnits).toBe(946500);
  expect((await wallet(page)).balance).toBe(19455); await expect(game(page).locator('.fh')).toHaveAttribute('data-outcome', 'big');
});

test('a malformed payout reply keeps the same pending operation until a valid replay', async ({ page, roomPath }) => {
  let altered = false;
  await page.route('**/api/demo-wallet/expansion', async route => {
    const request=route.request();if(request.method()!=='POST'||request.postDataJSON()?.gameId!==id){await route.fallback();return;}
    const response=await route.fetch({url:new URL('/__test/forest-heart/operate',request.url()).href});
    if(!altered){altered=true;const reply=await response.json();reply.session.view.forestHeart.totalPayoutUnits='999999';await route.fulfill({json:reply});}
    else await route.fulfill({response});
  });
  await enter(page,roomPath);await game(page).locator('[data-fh=spin]').click();await expect(game(page).locator('[data-fh=retry]')).toBeVisible();
  expect((await state(page)).view).toBeNull();expect((await wallet(page)).balance).toBe(10008.93);
  await game(page).locator('[data-fh=retry]').click();await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).view.totalPayoutUnits).toBe('1893');expect((await state(page)).presentations).toBe(0);
});

test('English rules, zero return and a narrow mobile viewport stay readable',async({page,roomPath})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await routeScenario(page,'loss');await enter(page,roomPath,'en');
  await expect(game(page).locator('h1')).toHaveText('Forest Heart');await game(page).locator('[data-fh=rules]').click();
  await game(page).locator('.fh-full-rules summary').click();await expect(game(page).locator('dialog')).toContainText('95.9942%');expect(await game(page).locator('.fh').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await game(page).locator('[data-fh=close]').click();await page.setViewportSize({width:320,height:780});await fit(game(page));
  await game(page).locator('[data-fh=spin]').click();await expect(game(page).locator('.fh')).toHaveAttribute('data-outcome','loss');
  await expect(game(page).locator('[data-fh=total]')).toHaveText('0');expect((await wallet(page)).balance).toBe(9990);
  expect((await state(page)).audio.played.win).toBeUndefined();expect((await state(page)).audio.played.big).toBeUndefined();
});

test('painted tiles fit a short desktop window and only the accepted root rotates while sap flows continuously', async ({page,roomPath}) => {
  await page.setViewportSize({width:1280,height:720});
  await routeScenario(page,'choice-bonus'); await enter(page,roomPath); await fit(game(page));
  const bounds=await game(page).locator('.fh').evaluate(root=>{
    const height=root.ownerDocument.documentElement.clientHeight;
    return {height, boxes:['.fh-title','.fh-board','[data-fh=spin]'].map(s=>root.querySelector(s)!.getBoundingClientRect().toJSON())};
  });
  for (const box of bounds.boxes) {expect(box.y).toBeGreaterThanOrEqual(0);expect(box.bottom).toBeLessThanOrEqual(bounds.height+1);}
  await page.screenshot({path:out+'/desktop-720.png'});
  await act(page);
  const before=await game(page).locator('[data-cell]').evaluateAll(cells=>cells.map(c=>(c as HTMLElement).style.getPropertyValue('--turn')));
  await game(page).locator('[data-cell="5"]').click();
  await expect(game(page).locator('.fh')).toHaveAttribute('data-motion','turn');
  const frames=await game(page).locator('.fh').evaluate(async root=>{
    const frames:{motion:string;angles:number[];sap:number[];total:number;cell:{x:number;y:number;width:number;height:number;overflow:string;transform:string;plate:string}}[]=[];
    const start=performance.now();
    while(performance.now()-start<5000){
      const cells=Array.from(root.querySelectorAll<HTMLElement>('[data-cell]'));
      const total=Number(root.querySelector('[data-fh=total]')!.textContent!.replace(/\s/g,'').replace(',','.'));
      const cell=cells[5],box=cell.getBoundingClientRect(),css=getComputedStyle(cell);
      frames.push({motion:(root as HTMLElement).dataset.motion||'',angles:cells.map(c=>parseFloat(c.style.getPropertyValue('--turn'))),sap:cells.map(c=>Number(c.style.getPropertyValue('--sap'))),total:Math.round(total*100),cell:{x:box.x,y:box.y,width:box.width,height:box.height,overflow:css.overflow,transform:css.transform,plate:css.backgroundImage}});
      if(frames.some(f=>f.motion==='flow') && !(root as HTMLElement).dataset.motion) break;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    return frames;
  });
  const turn=frames.filter(f=>f.motion==='turn');
  for(const frame of turn){expect(frame.cell).toEqual(turn[0].cell);expect(frame.cell.overflow).toBe('hidden');expect(frame.cell.transform).toBe('none');expect(frame.cell.plate).toContain('v4/tile.webp');}
  expect(turn.some(f=>f.angles[5]>0 && f.angles[5]<90)).toBe(true);
  for(const frame of frames) for(let cell=0;cell<25;cell++) if(cell!==5) expect(frame.angles[cell]).toBe(parseFloat(before[cell]));
  expect(frames.some(f=>f.motion==='flow' && f.sap.some(value=>value>0 && value<1))).toBe(true);
  expect(frames.some(f=>f.motion==='count'&&f.total>631&&f.total<1262)).toBe(true);
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).view.base.rotation).toBe(2);
  const bonusFit=await game(page).locator('.fh').evaluate(root=>({bonus:root.querySelector('.fh-bonus')!.getBoundingClientRect().bottom,controls:root.querySelector('.fh-controls')!.getBoundingClientRect().top}));
  expect(bonusFit.bonus).toBeLessThanOrEqual(bonusFit.controls);
  await page.screenshot({path:out+'/desktop-lit.png'});
  await writeFile(out+'/motion-frames.json',JSON.stringify({frames:frames.length,turnFrames:turn.length,intermediateAngles:turn.map(f=>f.angles[5]),continuousSapFrames:frames.filter(f=>f.sap.some(v=>v>0&&v<1)).length,intermediateCounterFrames:frames.filter(f=>f.motion==='count'&&f.total>631&&f.total<1262).length},null,2));
  await page.setViewportSize({width:1110,height:1244}); await fit(game(page));
  const poster=await game(page).locator('.fh').evaluate(root=>{
    const board=root.querySelector('.fh-board')!.getBoundingClientRect(), character=root.querySelector('.fh-character')!.getBoundingClientRect();
    return {mode:(root as HTMLElement).dataset.layout,boardTop:board.top,boardWidth:board.width,characterBottom:character.bottom};
  });
  expect(poster.mode).toBe('poster');expect(poster.boardWidth).toBeGreaterThan(400);expect(poster.characterBottom).toBeLessThanOrEqual(poster.boardTop);
  await page.screenshot({path:out+'/desktop-tall.png'});
});

test('accepted fields visibly leave and arrive with fixed plates in normal, muted and fast modes', async({page,roomPath})=>{
  await page.setViewportSize({width:1280,height:720});await routeScenario(page,'loss');await enter(page,roomPath);
  const records=[];
  for(const mode of ['normal','muted','fast']){
    if(mode==='muted')await game(page).locator('[data-fh=sound]').click();
    if(mode==='fast')await game(page).locator('[data-fh=fast]').check();
    const recording=game(page).locator('.fh').evaluate(async root=>{
      const frames:{motion:string;opacity:number;y:number;reveal:number;exit:number;plateTransform:string;box:{x:number;y:number;width:number;height:number}}[]=[];
      const tile=root.querySelector<HTMLElement>('[data-cell="10"] .fh-tile')!,cell=tile.parentElement!,start=performance.now();
      while(performance.now()-start<5000){
        const css=getComputedStyle(tile),box=cell.getBoundingClientRect(),transform=new DOMMatrixReadOnly(css.transform);
        frames.push({motion:(root as HTMLElement).dataset.motion||'',opacity:Number(css.opacity),y:transform.m42,reveal:Number(cell.style.getPropertyValue('--reveal')),exit:Number(cell.style.getPropertyValue('--exit')),plateTransform:getComputedStyle(cell).transform,box:{x:box.x,y:box.y,width:box.width,height:box.height}});
        if(frames.some(f=>f.motion==='reveal')&&(root as HTMLElement).dataset.motion==='flow')break;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      return frames;
    });
    await game(page).locator('[data-fh=spin]').click();
    if(mode==='normal'){
      await expect(game(page).locator('.fh')).toHaveAttribute('data-motion','reveal');
      for(let index=0;index<6;index++)await game(page).locator('.fh-board-frame').screenshot({path:out+`/reveal-${index}.png`});
    }
    const frames=await recording;
    const reveal=frames.filter(f=>f.motion==='reveal');
    expect(frames.some(f=>f.motion==='clear'&&f.exit>0&&f.opacity<.9)).toBe(true);
    expect(reveal.some(f=>f.opacity<.15)).toBe(true);
    expect(reveal.some(f=>f.opacity>.15&&f.opacity<.85&&Math.abs(f.y)>f.box.height*.2)).toBe(true);
    expect(reveal.length).toBeGreaterThan(5);
    for(const frame of frames){expect(frame.plateTransform).toBe('none');expect(frame.box).toEqual(frames[0].box);}
    await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();expect((await state(page)).scene.board).toEqual(referenceBoard(4095));
    if(mode!=='normal')expect((await state(page)).audio.activeVoices).toBe(0);
    records.push({mode,frameCount:frames.length,revealFrames:reveal.length,minOpacity:Math.min(...reveal.map(f=>f.opacity)),maxTravelPx:Math.max(...reveal.map(f=>Math.abs(f.y))),cellHeight:frames[0].box.height,frames});
  }
  expect((await wallet(page)).balance).toBe(9970);
  await writeFile(out+'/field-arrival.json',JSON.stringify(records,null,2));
  await page.screenshot({path:out+'/board-fixed.png'});
});

test('a held root stays visible and fixed while the next bonus field is assembled', async({page,roomPath})=>{
  await routeScenario(page,'maximum');await enter(page,roomPath);await game(page).locator('[data-fh=fast]').check();
  await act(page);await act(page);const previous=await state(page),held:number[]=previous.scene.lockedCells;expect(held.length).toBeGreaterThan(0);
  const recording=game(page).locator('.fh').evaluate(async(root,held)=>{
    const frames:{motion:string;cells:{cell:number;reveal:number;exit:number;opacity:number;angle:string}[]}[]=[],start=performance.now();
    while(performance.now()-start<5000){
      frames.push({motion:(root as HTMLElement).dataset.motion||'',cells:held.map((index:number)=>{const cell=root.querySelector<HTMLElement>(`[data-cell="${index}"]`)!;return{cell:index,reveal:Number(cell.style.getPropertyValue('--reveal')),exit:Number(cell.style.getPropertyValue('--exit')),opacity:Number(getComputedStyle(cell.querySelector('.fh-tile')!).opacity),angle:cell.style.getPropertyValue('--turn')};})});
      if(frames.some(f=>f.motion==='reveal')&&(root as HTMLElement).dataset.motion==='flow')break;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    return frames;
  },held);
  await game(page).locator('[data-fh=spin]').click();const frames=await recording;
  expect(frames.some(f=>f.motion==='clear')).toBe(true);expect(frames.some(f=>f.motion==='reveal')).toBe(true);
  for(const frame of frames)for(const cell of frame.cells){expect(cell.reveal).toBe(1);expect(cell.exit).toBe(0);expect(cell.opacity).toBe(1);expect(cell.angle).toBe(frames[0].cells.find(c=>c.cell===cell.cell)!.angle);}
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();let current=await state(page);while(current.view.stage!=='settled')current=await act(page);
  expect(current.scene.totalUnits).toBe(946500);expect((await wallet(page)).balance).toBe(19455);
  await writeFile(out+'/held-field.json',JSON.stringify({held,frames},null,2));
});

test('the elf blinks and renders local movement, stops for rules, and reacts only to fresh positive results', async ({page,roomPath}) => {
  await routeScenario(page,'win'); await enter(page,roomPath);
  const initial=(await state(page)).character;
  expect(initial.renderer).toBe('webgl');expect(initial.events).toEqual([]);
  const canvas=game(page).locator('.fh-character');
  const idle=await canvas.screenshot();
  await expect.poll(async()=>(await state(page)).character.blink,{timeout:12000,intervals:[30]}).toBeGreaterThan(.4);
  const blink=await canvas.screenshot();expect(blink.equals(idle)).toBe(false);
  await writeFile(out+'/elf-blink.png',blink);
  await game(page).locator('[data-fh=rules]').click();
  const stopped=(await state(page)).character;expect(stopped.running).toBe(false);expect(stopped.blink).toBe(0);
  await page.waitForTimeout(300);
  expect((await state(page)).character.frames).toBe(stopped.frames);
  await game(page).locator('[data-fh=close]').click();
  await game(page).locator('.fh-character-canvas').evaluate(canvas=>{
    const gl=(canvas as HTMLCanvasElement).getContext('webgl')!,extension=gl.getExtension('WEBGL_lose_context');
    if(!extension)throw Error('Context loss testing is unavailable');extension.loseContext();setTimeout(()=>extension.restoreContext(),600);
  });
  await expect.poll(async()=>(await state(page)).character.renderer,{intervals:[30]}).toBe('image');
  await expect.poll(async()=>(await state(page)).character.renderer,{intervals:[50]}).toBe('webgl');
  await act(page);let current=await state(page);
  expect(current.character.events.map((e:any)=>e.reaction)).toEqual(['awaken','channel','flower','flower','flower','win']);
  expect(current.character.pose).toBe('win');
  await page.screenshot({path:out+'/elf-win.png'});
  await page.locator('#studio-game-list').click();await choose(page);
  current=await state(page);expect(current.character.pose).toBe('idle');expect(current.character.events).toEqual([]);expect(current.presentations).toBe(0);
  for(const scenario of ['loss','partial']){
    await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,scenario);await act(page);
    expect((await state(page)).character.events.some((e:any)=>e.pose==='win'||e.pose==='big')).toBe(false);
  }
  await game(page).locator('[data-fh=settings]').click();await game(page).locator('[data-fh=motion]').check();await game(page).locator('[data-fh=close]').click();
  const reduced=(await state(page)).character;expect(reduced.reduced).toBe(true);expect(reduced.running).toBe(false);
  await page.waitForTimeout(300);expect((await state(page)).character.frames).toBe(reduced.frames);
  await writeFile(out+'/character-lifecycle.json',JSON.stringify({idle:initial,paused:stopped,reopened:current.character,reduced},null,2));
});

test('the elf shows choice, flower, bonus and large final reactions in the real host with chat', async ({page,roomPath}) => {
  await routeScenario(page,'choice-bonus');await enter(page,roomPath);
  await act(page);let current=await state(page);
  expect(current.character.events.map((e:any)=>e.reaction)).toEqual(['awaken','channel','flower','choice']);
  await page.screenshot({path:out+'/elf-choice.png'});
  await game(page).locator('[data-cell="5"]').click();
  await expect(game(page).locator('.fh-character')).toHaveAttribute('data-pose','flower');
  await expect.poll(async()=>(await state(page)).character.transition,{intervals:[30]}).toBe(1);
  await page.screenshot({path:out+'/elf-flower.png'});
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();current=await state(page);
  expect(current.view.stage).toBe('bonus');expect(current.character.pose).toBe('bonus');
  expect(current.character.events.some((e:any)=>e.pose==='win'||e.pose==='big')).toBe(false);
  await page.screenshot({path:out+'/elf-bonus.png'});
  await page.setViewportSize({width:390,height:844});await fit(game(page));await expect(page.locator('#chat-input')).toBeInViewport();
  await page.screenshot({path:out+'/elf-mobile.png'});
  await game(page).locator('[data-fh=fast]').check();
  while(current.view.stage!=='settled')current=await act(page);
  await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,'maximum');
  current=await act(page);while(current.view.stage!=='settled')current=await act(page);
  expect(current.character.events.at(-1).pose).toBe('big');expect(current.scene.totalUnits).toBe(946500);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:out+'/elf-big.png'});
  await writeFile(out+'/character-events.json',JSON.stringify(current.character,null,2));
});

test('the elf anticipates the field and keeps pose weights and gestures continuous through muted and fast wins', async ({page,roomPath}) => {
  await routeScenario(page,'win');await enter(page,roomPath);
  const records=[];
  for(const mode of ['normal','muted','fast']){
    if(mode==='muted')await game(page).locator('[data-fh=sound]').click();
    if(mode==='fast')await game(page).locator('[data-fh=fast]').check();
    await game(page).locator('[data-fh=spin]').click();
    const frames=await game(page).locator('.fh').evaluate(async root=>{
      const frames:{at:number;motion:string;pose:string;reaction:string|null;weights:number[];gesture:number[];draws:number;light:number}[]=[];
      const start=performance.now();let winAt=0;
      while(performance.now()-start<12000){
        const character=(root.ownerDocument.defaultView!.parent as any).royalDemo.getMiniState().character;
        const at=performance.now();
        frames.push({at,motion:(root as HTMLElement).dataset.motion||'',pose:character.pose,reaction:character.reaction,weights:character.weights,gesture:character.gesture,draws:character.frames,light:Number(getComputedStyle(root.querySelector('.fh-character-energy')!).opacity)});
        if(character.reaction==='win'&&!winAt)winAt=at;
        if(winAt&&at-winAt>1600)break;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      return frames;
    });
    expect(frames.some(f=>['clear','reveal'].includes(f.motion)&&f.reaction==='awaken')).toBe(true);
    expect(frames.some(f=>f.reaction==='awaken'&&f.gesture[0]>.5)).toBe(true);
    expect(frames.some(f=>f.reaction==='win'&&f.gesture[1]>.85)).toBe(true);
    expect(frames.some(f=>f.reaction==='win'&&f.light>.8)).toBe(true);
    let maxWeightStep=0,maxGestureStep=0;
    for(let i=0;i<frames.length;i++){
      const frame=frames[i];expect(frame.weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
      expect(frame.weights.every(w=>Number.isFinite(w)&&w>=0&&w<=1)).toBe(true);
      if(i&&frame.at-frames[i-1].at<40){
        maxWeightStep=Math.max(maxWeightStep,...frame.weights.map((w,j)=>Math.abs(w-frames[i-1].weights[j])));
        maxGestureStep=Math.max(maxGestureStep,...frame.gesture.map((w,j)=>Math.abs(w-frames[i-1].gesture[j])));
      }
    }
    expect(maxWeightStep).toBeLessThan(.2);expect(maxGestureStep).toBeLessThan(.4);
    const current=await state(page);expect(current.scene.totalUnits).toBe(1893);expect(current.view.stage).toBe('settled');
    const events=current.character.events;expect(events.filter((e:any)=>e.reaction==='awaken')).toHaveLength(records.length+1);
    records.push({mode,maxWeightStep,maxGestureStep,frames});
    if(mode==='normal')await page.screenshot({path:out+'/elf-v6-win.png'});
  }
  await page.setViewportSize({width:390,height:844});await fit(game(page));await expect(page.locator('#chat-input')).toBeInViewport();
  await page.screenshot({path:out+'/elf-v6-mobile.png'});
  await game(page).locator('[data-fh=rules]').click();const paused=(await state(page)).character;
  expect(paused.gesture).toEqual([0,0,0,0]);expect(paused.reaction).toBeNull();
  await game(page).locator('[data-fh=close]').click();
  await writeFile(out+'/character-v6-frames.json',JSON.stringify(records,null,2));
});

test('the original score renders finite unclipped audio and releases its owned voices',async({page})=>{
  await page.goto('/');
  const rendered=await page.evaluate(async()=>{
    const path='/games/forest-heart/ForestAudio.ts';const {ForestScore}=await import(path);
    const rate=22050,c=new OfflineAudioContext(1,rate*12,rate),score=new ForestScore(c,c.destination);
    const events=['land','flow','flower','choice','bonus','flower','win','big'];
    const scheduled=Array.from({length:16},(_,i)=>c.suspend(.02+i*.52).then(async()=>{
      score.tick(i,c.currentTime+.015,i>8);if(i%2===0)score.cue(events[i/2],c.currentTime+.05,i%3);await c.resume();
    }));
    const bufferPromise=c.startRendering();await Promise.all(scheduled);const buffer=await bufferPromise;
    let peak=0,sum=0;const pcm=Array.from(buffer.getChannelData(0),n=>{if(!Number.isFinite(n))throw Error('Nonfinite audio');peak=Math.max(peak,Math.abs(n));sum+=n*n;return Math.max(-32768,Math.min(32767,Math.round(n*32767)));});
    score.destroy();return {rate,pcm,peak,rms:Math.sqrt(sum/pcm.length),active:score.active};
  });
  expect(rendered.peak).toBeGreaterThan(.01);expect(rendered.peak).toBeLessThan(.95);expect(rendered.active).toBe(0);
  const wav=Buffer.alloc(44+rendered.pcm.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rendered.rate,24);wav.writeUInt32LE(rendered.rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(rendered.pcm.length*2,40);rendered.pcm.forEach((v,i)=>wav.writeInt16LE(v,44+i*2));
  await writeFile(out+'/audio-preview.wav',wav);await writeFile(out+'/audio-measurement.json',JSON.stringify({sampleRate:rendered.rate,seconds:12,peak:rendered.peak,rms:rendered.rms,ownedVoicesAfterDestroy:rendered.active,scope:'Digital offline rendering only; no physical device or human listening assessment'},null,2));
});

test('readable outcomes, accepted flower values and separate settings fit desktop and phones with chat',async({page,roomPath})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await routeScenario(page,'partial');await enter(page,roomPath);
  await expect(game(page).locator('[data-fh=next]')).toContainText('Пробуди поле');
  await expect(game(page).locator('[data-fh=spin]')).toContainText('Стоимость 10 USDT');
  await act(page);await expect(game(page).locator('[data-fh=total]')).toHaveText('6,31');await expect(game(page).locator('[data-fh=net]')).toHaveText('-3,69');
  await expect(game(page).locator('.fh-flower-value')).toHaveText(['6,31','6,31','6,31']);
  await game(page).locator('[data-fh=higher]').click();
  await expect(game(page).locator('[data-fh=next]')).toContainText('Ставка поля: 10 USDT');
  await expect(game(page).locator('.fh-flower-value')).toHaveText(['6,31','6,31','6,31']);
  await game(page).locator('[data-fh=energy]').click();await expect(game(page).locator('#fh-energy-note')).toBeVisible();
  await expect(game(page).locator('[data-fh=flower-value-note]')).toContainText('6,31 USDT');
  await game(page).locator('#fh-energy-note button').click();
  const metrics=[];
  for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:320,height:780}]){
    await page.setViewportSize(viewport);await fit(game(page));await expect(page.locator('#chat-input')).toBeInViewport();
    const sizes=await game(page).locator('.fh').evaluate(root=>{
      const selectors=['[data-fh=lower]','[data-fh=higher]','[data-fh=rules]','[data-fh=settings]','[data-fh=energy]','.fh-fast'];
      const controls=selectors.map(selector=>{const e=root.querySelector(selector)!,r=e.getBoundingClientRect();return{selector,width:r.width,height:r.height};});
      const fonts=['[data-fh=net]','[data-fh=next]','.fh-spin small'].map(selector=>({selector,size:parseFloat(getComputedStyle(root.querySelector(selector)!).fontSize)}));
      const board=root.querySelector('.fh-board')!.getBoundingClientRect();
      const result=root.querySelector('[data-fh=total]')!,net=root.querySelector('[data-fh=net]')!;
      return{width:root.clientWidth,height:root.clientHeight,board:board.toJSON(),controls,fonts,returnColor:getComputedStyle(result).color,netFont:parseFloat(getComputedStyle(net).fontSize),returnFont:parseFloat(getComputedStyle(result).fontSize),textFits:[result,net,root.querySelector('[data-fh=balance]')!].every(e=>e.scrollWidth<=e.clientWidth+1)};
    });
    for(const control of sizes.controls){expect(control.width).toBeGreaterThanOrEqual(44);expect(control.height).toBeGreaterThanOrEqual(44);}
    for(const font of sizes.fonts)expect(font.size).toBeGreaterThanOrEqual(12);
    expect(sizes.netFont).toBe(sizes.returnFont);expect(sizes.returnColor).toBe('rgb(242, 232, 211)');expect(sizes.textFits).toBe(true);
    if(viewport.width===1280)expect(sizes.board.width).toBeGreaterThanOrEqual(330);
    metrics.push({viewport,...sizes});await page.screenshot({path:out+`/ux-v7-${viewport.width}.png`});
  }
  await game(page).locator('[data-fh=settings]').click();
  await expect(game(page).locator('[data-panel=settings]')).toBeVisible();await expect(game(page).locator('[data-fh=motion]')).toBeInViewport();
  await page.screenshot({path:out+'/ux-v7-settings.png'});
  await game(page).locator('[data-fh-tab=settings]').press('ArrowLeft');await expect(game(page).locator('.fh-steps li')).toHaveCount(3);
  await expect(game(page).locator('[data-panel=settings]')).toBeHidden();
  await page.screenshot({path:out+'/ux-v7-rules.png'});
  await game(page).locator('[data-fh=close]').click();expect((await wallet(page)).balance).toBe(9996.31);
  await page.locator('#studio-game-list').click();await choose(page);
  expect((await state(page)).presentations).toBe(0);await expect(game(page).locator('[data-fh=net]')).toHaveText('-3,69');
  await writeFile(out+'/ux-v7-metrics.json',JSON.stringify(metrics,null,2));
});

test('the full host uses the available monitor and keeps the board, elf and paid controls in view through resizing',async({page,roomPath})=>{
  await page.setViewportSize({width:2507,height:1100});
  await page.emulateMedia({reducedMotion:'reduce'});await routeScenario(page,'choice-bonus');await enter(page,roomPath);
  const records=[];
  for(const viewport of [{width:2507,height:1100},{width:2560,height:1440},{width:2006,height:880},{width:1920,height:1080},{width:1366,height:768},{width:1280,height:720},{width:1024,height:768},{width:1024,height:1366},{width:768,height:1024},{width:390,height:844},{width:320,height:780},{width:844,height:390},{width:667,height:375},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);
    await expect.poll(async()=>{
      const boxes=await page.locator('.forest-heart-frame').evaluate(frame=>({width:frame.getBoundingClientRect().width,stage:frame.closest('.mini-stage')!.getBoundingClientRect().width}));
      return Math.abs(boxes.width-boxes.stage);
    }).toBeLessThanOrEqual(2);
    const outer=await page.locator('.forest-heart-frame').evaluate(frame=>({frame:frame.getBoundingClientRect().toJSON(),stage:frame.closest('.mini-stage')!.getBoundingClientRect().toJSON(),mode:frame.closest('#mini-dialog')!.getAttribute('data-game-viewport')}));
    const inner=await game(page).locator('.fh').evaluate(root=>{
      const box=(selector:string)=>root.querySelector(selector)!.getBoundingClientRect().toJSON();
      const logo=root.querySelector<HTMLImageElement>('.fh-title-logo')!;
      return{width:root.clientWidth,height:root.clientHeight,layout:(root as HTMLElement).dataset.layout,header:box('.fh-top'),world:box('.fh-world'),logo:{...logo.getBoundingClientRect().toJSON(),fit:getComputedStyle(logo).objectFit},board:box('.fh-board'),machine:box('.fh-machine'),character:box('.fh-character'),portrait:box('.fh-character-canvas'),controls:box('.fh-controls'),status:box('.fh-status-band'),spin:box('[data-fh=spin]'),scrollWidth:root.ownerDocument.documentElement.scrollWidth,scrollHeight:root.ownerDocument.documentElement.scrollHeight};
    });
    await page.screenshot({path:out+`/responsive-${viewport.width}x${viewport.height}.png`});
    records.push({viewport,outer,inner});await writeFile(out+'/responsive-metrics.json',JSON.stringify(records,null,2));
    expect(Math.abs(outer.frame.height-outer.stage.height)).toBeLessThanOrEqual(2);
    expect(inner.scrollWidth).toBeLessThanOrEqual(inner.width+1);expect(inner.scrollHeight).toBeLessThanOrEqual(inner.height+1);
    for(const box of [inner.board,inner.controls,inner.spin]){
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(inner.width+1);expect(box.bottom).toBeLessThanOrEqual(inner.height+1);
    }
    expect(inner.board.width).toBeGreaterThanOrEqual(viewport.height<500?150:180);
    expect(inner.logo.fit).toBe('contain');
    expect(inner.logo.top).toBeGreaterThanOrEqual(inner.header.top-1);expect(inner.logo.bottom).toBeLessThanOrEqual(inner.header.bottom+1);
    if(inner.layout==='wide'){
      expect(inner.machine.top-inner.header.bottom).toBeLessThanOrEqual(12);
      expect(Math.abs(inner.character.top-inner.machine.top)).toBeLessThanOrEqual(2);
      expect(inner.portrait.height).toBeGreaterThanOrEqual(inner.board.height*.95);
      expect(inner.portrait.width/inner.portrait.height).toBeCloseTo(5/6,1);
      expect(inner.character.left).toBeGreaterThanOrEqual(inner.machine.right);
    }
    await expect(page.locator('#chat-input')).toBeInViewport();
  }
  await act(page);await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  await page.setViewportSize({width:844,height:390});await expect(game(page).locator('[data-fh=pass]')).toBeInViewport();
  await act(page,'[data-cell="5"]');
  await expect(game(page).locator('[data-fh=spin]')).toBeInViewport();
  const round=await state(page);expect(round.view.stage).toBe('bonus');
  for(const viewport of [{width:667,height:375},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    await expect.poll(()=>game(page).locator('.fh-board').evaluate(e=>e.clientWidth)).toBeGreaterThanOrEqual(150);
    const boxes=await game(page).locator('.fh').evaluate(root=>({height:root.clientHeight,button:root.querySelector('[data-fh=spin]')!.getBoundingClientRect().toJSON(),bonus:root.querySelector('.fh-bonus')!.getBoundingClientRect().toJSON()}));
    expect(boxes.button.bottom).toBeLessThanOrEqual(boxes.height);expect(boxes.bonus.bottom).toBeLessThanOrEqual(boxes.height);
    await expect(game(page).locator('[data-fh=spin]')).toContainText(/БЕСПЛАТН/i);
    expect(await game(page).locator('.fh-button-label').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await page.screenshot({path:out+`/responsive-bonus-${viewport.width}.png`});
  }
  await page.locator('#mini-dialog .mini-top [data-close]').click();await page.locator('#games-tab').click();await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
  await expect(page.locator('#mini-dialog')).toBeVisible();
  await choose(page);expect((await state(page)).sessionId).toBe(round.sessionId);
});
