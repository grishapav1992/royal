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
  await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 25000 });
  await choose(page);
}
async function choose(page: Page) {
  await page.locator(`#mini-game [data-platform-game="${id}"]`).click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', id, { timeout: 25000 });
  await expect(game(page).locator('[data-fh=spin]:visible,[data-fh=pass]:visible,[data-fh=retry]:visible').first()).toBeEnabled();
  await expect.poll(() => game(page).locator('.fh-elf').evaluateAll(images => images.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
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
  await expect.poll(async () => { const after = await state(page); return !after.busy && after.view && (after.sessionId !== before.sessionId || after.view.revision !== before.view?.revision); }).toBe(true);
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
  const initial = await act(page); expect(initial.view.stage).toBe('choice');
  await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  const balance = await wallet(page); expect(balance.balance).toBe(9990);
  await page.locator('#studio-game-list').click(); await choose(page);
  expect((await state(page)).sessionId).toBe(initial.sessionId); expect((await state(page)).presentations).toBe(0);
  await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  let current = await act(page, '[data-cell="5"]'); expect(current.view.stage).toBe('bonus'); expect((await wallet(page)).balance).toBe(9990);
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('#chat-input')).toBeInViewport(); await fit(game(page));
  await expect(game(page).locator('[data-fh=spin]')).toBeInViewport();
  await page.screenshot({ path: out + '/mobile.png' });
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
  await game(page).locator('[data-fh=spin]').click(); await expect(game(page).locator('[data-fh=skip]')).toBeVisible();
  await game(page).locator('[data-fh=skip]').click(); await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).audio.activeVoices).toBe(0);
  await game(page).locator('[data-fh=rules]').click(); await expect(game(page).locator('dialog')).toBeVisible();
  expect((await state(page)).audio.activeVoices).toBe(0);
  await game(page).locator('[data-fh=music]').uncheck(); await game(page).locator('[data-fh=motion]').check();
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
  await expect(game(page).locator('dialog')).toContainText('95.9942%');expect(await game(page).locator('.fh').innerText()).not.toMatch(/[А-Яа-яЁё]/);
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
    const frames:{motion:string;angles:number[];sap:number[]}[]=[];
    const start=performance.now();
    while(performance.now()-start<3000){
      const cells=Array.from(root.querySelectorAll<HTMLElement>('[data-cell]'));
      frames.push({motion:(root as HTMLElement).dataset.motion||'',angles:cells.map(c=>parseFloat(c.style.getPropertyValue('--turn'))),sap:cells.map(c=>Number(c.style.getPropertyValue('--sap')))});
      if(frames.some(f=>f.motion==='flow') && !(root as HTMLElement).dataset.motion) break;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    return frames;
  });
  const turn=frames.filter(f=>f.motion==='turn');
  expect(turn.some(f=>f.angles[5]>0 && f.angles[5]<90)).toBe(true);
  for(const frame of frames) for(let cell=0;cell<25;cell++) if(cell!==5) expect(frame.angles[cell]).toBe(parseFloat(before[cell]));
  expect(frames.some(f=>f.motion==='flow' && f.sap.some(value=>value>0 && value<1))).toBe(true);
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).view.base.rotation).toBe(2);
  const bonusFit=await game(page).locator('.fh').evaluate(root=>({bonus:root.querySelector('.fh-bonus')!.getBoundingClientRect().bottom,controls:root.querySelector('.fh-controls')!.getBoundingClientRect().top}));
  expect(bonusFit.bonus).toBeLessThanOrEqual(bonusFit.controls);
  await page.screenshot({path:out+'/desktop-lit.png'});
  await writeFile(out+'/motion-frames.json',JSON.stringify({frames:frames.length,turnFrames:turn.length,intermediateAngles:turn.map(f=>f.angles[5]),continuousSapFrames:frames.filter(f=>f.sap.some(v=>v>0&&v<1)).length},null,2));
  await page.setViewportSize({width:1110,height:1244}); await fit(game(page));
  const centres=await game(page).locator('.fh').evaluate(root=>{
    const board=root.querySelector('.fh-board')!.getBoundingClientRect(), character=root.querySelector('.fh-character')!.getBoundingClientRect();
    return {board:board.y+board.height/2,character:character.y+character.height/2};
  });
  expect(Math.abs(centres.board-centres.character)).toBeLessThan(100);
  await page.screenshot({path:out+'/desktop-tall.png'});
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
