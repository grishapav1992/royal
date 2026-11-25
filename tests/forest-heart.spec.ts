import { expect, type Page, type FrameLocator } from '@playwright/test';
import { test } from './themed-room';
import { selectEntryMode } from './entry-mode';
import { mkdir, writeFile } from 'node:fs/promises';
// @ts-expect-error Independent JavaScript graph oracle has no production scorer dependency.
import { referenceBoard, referenceFlow } from '../scripts/game-math/forest-heart-reference.mjs';

const out = process.env.FOREST_ARTIFACT_DIR || 'artifacts/work/forest-heart-client';
const id = 'studio-forest-heart';
const game = (page: Page) => page.frameLocator('.forest-heart-frame');
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getMiniState());
const online = (page: Page) => page.evaluate(() => (window as any).royalDemo?.getNetworkState()?.status === 'connected');
async function expectConnectedChat(page: Page) {
  const dialog = page.locator('#mini-dialog');
  const chat = dialog.locator('#chat-input');
  const toggle = dialog.locator('.game-chat-toggle');
  await expect(toggle).toBeInViewport();
  const wasClosed = await toggle.getAttribute('aria-expanded') === 'false';
  if (wasClosed) await toggle.click();
  await expect(chat).toBeInViewport();
  expect(await online(page)).toBe(true);
  if (wasClosed) {
    await dialog.locator('.game-chat-close').click();
    await expect(chat).toBeHidden();
  }
}
async function enter(page: Page, roomPath: string, lang = 'ru') {
  await page.goto(roomPath + '&lang=' + lang);
  // The casino entry uses the same game window and connected chat without rendering the club world.
  await selectEntryMode(page, 'casino');
  await page.getByLabel(lang === 'en' ? 'Email' : 'Почта', { exact: true }).fill(`forest-${crypto.randomUUID()}@example.test`);
  await page.getByLabel(lang === 'en' ? 'Password' : 'Пароль', { exact: true }).fill('Forest-complete-test-42!');
  await page.getByRole('button', { name: lang === 'en' ? 'Continue' : 'Продолжить', exact: true }).click();
  await expect.poll(() => online(page), { timeout: 30000 }).toBe(true);
  expect(await page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    const response = await fetch('/__test/forest-heart/fund',{method:'POST',headers:{'Content-Type':'application/json','X-Royal-Account-Id':me.account.id},body:JSON.stringify({id:crypto.randomUUID(),kind:'deposit',amount:10000})});
    return response.status;
  })).toBe(200);
  await choose(page);
}
async function reloadAndChoose(page: Page) {
  await page.reload();
  await selectEntryMode(page, 'casino');
  await expect.poll(() => online(page), { timeout: 30000 }).toBe(true);
  await choose(page);
}
async function choose(page: Page) {
  await page.locator(`#casino-catalog [data-platform-game="${id}"]`).click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id', id, { timeout: 25000 });
  await expect(game(page).locator('[data-fh=spin]:visible,[data-fh=pass]:visible,[data-fh=retry]:visible').first()).toBeEnabled();
  await expect.poll(() => game(page).locator('.fh-elf').evaluateAll(images => images.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect.poll(async () => (await state(page)).character.ready).toBe(true);
  // Fresh synthetic scenarios use 10 USDT; accepted or pending series keep their original stake.
  const stake = game(page).locator('[data-manual-stake]');
  if (await stake.isEditable()) {
    await stake.fill('10.00');
    await stake.blur();
    await expect(stake).toHaveValue('10.00');
  }
}
async function routeScenario(page: Page, scenario: string, loseFirst = false) {
  let lost = false;
  await page.route('**/api/demo-wallet/expansion', async route => {
    const request = route.request();
    if (request.method() !== 'POST' || request.postDataJSON()?.gameId !== id) { await route.fallback(); return; }
    const response = await route.fetch({ url: new URL('/__test/forest-heart/operate', request.url()).href, headers: { ...request.headers(), 'x-forest-scenario': scenario } });
    if (loseFirst && !lost) { expect(response.status()).toBe(200); lost = true; await route.abort('connectionreset'); return; }
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
  await expect(game(page).locator('[data-fh=total]')).toHaveText((current.scene.totalUnits / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  // The complete bonus ends with its own confirmed total. Closing it never sends a request.
  const result = game(page).locator('[data-fh=result-dialog]');
  if (before.view?.stage === 'bonus' && v.stage === 'settled') { await expect(result).toBeVisible(); await game(page).locator('[data-fh=result-confirm]').click(); await expect(result).toBeHidden(); }
  return current;
}
async function installPresentationClock(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    if (window === window.parent || location.href !== 'about:blank') return;
    // The game module runs in the host and schedules drawing in its iframe.
    // Keep the module, iframe and frame recorder on a single clock.
    const host = window.parent;
    window.performance.now = host.performance.now.bind(host.performance);
    window.requestAnimationFrame = host.requestAnimationFrame.bind(host);
    window.cancelAnimationFrame = host.cancelAnimationFrame.bind(host);
  });
}
async function advanceRecordedSpin(page: Page, duration: number) {
  const response = page.waitForResponse(reply => reply.url().endsWith('/api/demo-wallet/expansion')
    && reply.request().method() === 'POST' && reply.request().postDataJSON()?.gameId === id);
  await game(page).locator('[data-fh=spin]').click();
  expect((await response).ok()).toBe(true);
  await expect(game(page).locator('.fh')).toHaveClass(/fh-presenting/);
  await page.clock.runFor(duration);
}
async function wallet(page: Page) {
  return page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    return (await fetch('/api/demo-wallet', { headers: { 'X-Royal-Account-Id': me.account.id } })).json();
  });
}

test('the elf has no video, breathes and blinks in calm and stops for rules, reduced motion and closing', async ({page,roomPath}) => {
  const errors: string[] = [], media: string[] = []; page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/forest-heart/.test(request.url())&&/\.(mp4|webm)(\?|$)/.test(request.url()))media.push(request.url());});
  await routeScenario(page,'win'); await enter(page,roomPath);
  await expect(game(page).locator('video')).toHaveCount(0);await expect(game(page).locator('.fh-character-video')).toHaveCount(0);
  await game(page).locator('.fh-character-canvas').evaluate(canvas=>{
    const gl=(canvas as HTMLCanvasElement).getContext('webgl')!,draw=gl.drawElements.bind(gl),pixels=new Uint8Array(64*64*4),rows:{hash:number;lids:number}[]=[];
    (canvas as any).__frames=rows;
    gl.drawElements=(...args:Parameters<WebGLRenderingContext['drawElements']>)=>{
      draw(...args);if(rows.length>400)return;const c=canvas as HTMLCanvasElement;
      gl.readPixels(Math.floor((c.width-64)/2),Math.floor((c.height-64)/2),64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let hash=2166136261;for(let i=0;i<pixels.length;i+=16)hash=Math.imul(hash^pixels[i],16777619)>>>0;
      rows.push({hash,lids:(c.ownerDocument.defaultView!.parent as any).royalDemo.getMiniState().character.lids});
    };
  });
  await expect.poll(async()=>(await state(page)).character.blinks,{timeout:15000}).toBeGreaterThanOrEqual(2);
  const frames=await game(page).locator('.fh-character-canvas').evaluate(c=>(c as any).__frames as {hash:number;lids:number}[]);
  // The drawing starts within the first percent of its height, so nothing may fade it from above.
  expect(await game(page).locator('.fh-character').evaluate(e=>getComputedStyle(e).webkitMaskImage)).toMatch(/^linear-gradient\(rgb\(0, 0, 0\)/);
  expect(new Set(frames.map(f=>f.hash)).size).toBeGreaterThan(12);expect(frames.some(f=>f.lids>.8)).toBe(true);expect(frames.filter(f=>f.lids>0).length).toBeLessThan(frames.length*.3);
  expect((await state(page)).character.pose).toBe('idle');expect((await state(page)).character.events).toEqual([]);
  await page.screenshot({path:out+'/elf-calm.png'});
  await game(page).locator('[data-fh=rules]').click();const stopped=(await state(page)).character;expect(stopped.running).toBe(false);expect(stopped.lids).toBe(0);
  await page.waitForTimeout(400);expect((await state(page)).character.frames).toBe(stopped.frames);await game(page).locator('[data-fh=close]').click();
  await expect.poll(async()=>(await state(page)).character.running).toBe(true);
  await game(page).locator('[data-fh=settings]').click();await game(page).locator('[data-fh=motion]').check();await game(page).locator('[data-fh=close]').click();
  await game(page).locator('.fh-character').evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  const reduced=(await state(page)).character;expect(reduced.running).toBe(false);await page.waitForTimeout(300);expect((await state(page)).character.frames).toBe(reduced.frames);
  await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('.forest-heart-frame')).toHaveCount(0);
  expect(media).toEqual([]);expect(errors).toEqual([]);
});

test('she keeps one unbroken action from the press to the result and never shows a third drawing', async ({page,roomPath}) => {
  await routeScenario(page,'win');await enter(page,roomPath);
  let release!:()=>void,held=false;const gate=new Promise<void>(done=>release=done);
  await page.route('**/api/demo-wallet/expansion',async route=>{if(!held&&route.request().method()==='POST'){held=true;await gate;}await route.fallback();});
  const recording=game(page).locator('.fh').evaluate(async root=>{
    const rows:{pose:string;reaction:string|null;weights:number[];streams:string[];outcome:string}[]=[],start=performance.now(),host=root.ownerDocument.defaultView!.parent as any;let done=false;
    while(performance.now()-start<14000&&!done){
      const s=host.royalDemo.getMiniState();rows.push({pose:s.character.pose,reaction:s.character.reaction,weights:s.character.weights,streams:s.visual.effects.streams,outcome:(root as HTMLElement).dataset.outcome||''});
      done=rows.length>60&&(root as HTMLElement).dataset.outcome==='win';
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    return rows;
  });
  await game(page).locator('[data-fh=spin]').click();await expect.poll(()=>held).toBe(true);await page.waitForTimeout(2600);
  // However long the reply takes, her hand keeps turning the roots and no result is shown.
  const waiting=await state(page);expect(waiting.character.pose).toBe('channel');expect(waiting.character.reaction).toBe('awaken');expect(waiting.visual.effects.streams).toEqual(['spin']);expect(waiting.visual.effects.motes).toBeGreaterThan(0);
  release();const rows=await recording;
  const order=rows.map(row=>row.pose).filter((pose,i,all)=>pose!==all[i-1]);expect(order.filter((pose,i)=>!(i===0&&pose==='idle'))).toEqual(['channel','flower','win']);
  expect(rows.some(row=>row.streams.includes('flow'))).toBe(true);
  for(const row of rows){expect(row.weights.filter(w=>w>0).length).toBeLessThanOrEqual(2);expect(row.weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);}
  const settled=await state(page);expect(settled.visual.effects.streams).toEqual([]);
  expect(settled.character.events.map((e:any)=>e.reaction)).toEqual(['awaken','land','channel','flower','pulse','pulse','win']);
  // The celebration stays for a while after the round and then she calms down.
  await page.waitForTimeout(3200);expect((await state(page)).character.pose).toBe('win');
  await expect.poll(async()=>(await state(page)).character.pose,{timeout:8000}).toBe('idle');
});

test('a loss lowers her eyes, a partial return only nods and a hovered root gets her attention', async ({page,roomPath}) => {
  await routeScenario(page,'loss');await enter(page,roomPath);await act(page);
  expect((await state(page)).character.events.map((e:any)=>e.reaction)).toEqual(['awaken','land','channel','loss']);
  await expect.poll(async()=>(await state(page)).character.lids,{intervals:[40],timeout:4000}).toBeGreaterThan(.9);
  await expect.poll(async()=>(await state(page)).character.lids,{timeout:4000}).toBe(0);expect((await state(page)).character.pose).toBe('idle');
  await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,'partial');await act(page);
  expect((await state(page)).character.events.map((e:any)=>e.reaction).slice(-5)).toEqual(['awaken','land','channel','flower','partial']);
  await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,'choice-bonus');await act(page);
  await game(page).locator('[data-cell="7"]').hover();await expect.poll(async()=>(await state(page)).visual.effects.streams).toEqual(['point']);
  expect((await state(page)).character.pose).toBe('choice');await page.screenshot({path:out+'/elf-hover.png'});
  await page.mouse.move(5,5);await expect.poll(async()=>(await state(page)).visual.effects.streams).toEqual([]);
  await game(page).locator('[data-cell="5"]').click();await expect.poll(async()=>(await state(page)).character.reaction).toBe('turn');
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled({timeout:15000});const last=await state(page);
  expect(last.character.events.map((e:any)=>e.reaction).slice(-4)).toEqual(['turn','channel','flower','bonus']);expect(last.character.pose).toBe('bonus');
});

test('missing lid artwork only removes blinking', async({page,roomPath})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/elf-blink.webp',route=>route.abort());await enter(page,roomPath);
  expect((await state(page)).character.renderer).toBe('webgl');await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();expect(errors).toEqual([]);
});
async function fit(frame: FrameLocator) {
  await expect(async () => {
    const boxes = await frame.locator('.fh').evaluate(root => ({ width: root.ownerDocument.documentElement.clientWidth, scroll: root.ownerDocument.documentElement.scrollWidth, board: root.querySelector('.fh-board')!.getBoundingClientRect().toJSON(), bonusBottom:(root.querySelector('.fh-bonus') as HTMLElement).hidden ? 0 : root.querySelector('[data-bud]')!.getBoundingClientRect().bottom, controlsTop:root.querySelector('.fh-controls')!.getBoundingClientRect().top }));
    expect(boxes.scroll).toBeLessThanOrEqual(boxes.width + 1); expect(boxes.board.width).toBeGreaterThanOrEqual(180);
    expect(boxes.board.x).toBeGreaterThanOrEqual(0); expect(boxes.board.right).toBeLessThanOrEqual(boxes.width);
    expect(boxes.bonusBottom).toBeLessThanOrEqual(boxes.controlsTop);
  }).toPass({ timeout: 5000 });
}
test.beforeAll(async () => {
  await mkdir(out, { recursive: true });
  await writeFile(out + '/owner.json', JSON.stringify({ owner: 'forest-heart-client', purpose: 'Full Royal host browser and audio checks', cleanup: 'After final report and selected screenshot are saved' }));
});

test('real host preserves choice, bonus, exact settlement and connected chat across desktop, mobile and reopen', async ({ page, roomPath }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await routeScenario(page, 'choice-bonus'); await enter(page, roomPath);
  await expectConnectedChat(page); await page.screenshot({ path: out + '/desktop.png' }); await fit(game(page));
  const initial = await act(page); expect(initial.view.stage).toBe('choice');await expect(game(page).locator('[data-fh=status]')).toHaveText('Поверни один корень');
  await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  const balance = await wallet(page); expect(balance.balance).toBe(9990);
  await page.locator('#studio-game-list').click(); await choose(page);
  expect((await state(page)).sessionId).toBe(initial.sessionId); expect((await state(page)).presentations).toBe(0);
  await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  let current = await act(page, '[data-cell="5"]'); expect(current.view.stage).toBe('bonus');await expect(game(page).locator('[data-fh=next]')).toContainText('закрепятся');await expect(game(page).locator('[data-fh=spin]')).toContainText('бесплатно, осталось 4'); expect((await wallet(page)).balance).toBe(9990);
  await page.setViewportSize({ width: 390, height: 844 }); await fit(game(page)); await expectConnectedChat(page);
  await expect(game(page).locator('[data-fh=spin]')).toBeInViewport();
  await page.screenshot({ path: out + '/mobile.png' });
  await page.setViewportSize({width:320,height:780});await fit(game(page));
  const seeds=await game(page).locator('[data-bud]').evaluateAll(buds=>buds.map(bud=>{const b=bud.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0;}));expect(seeds).toEqual([true,true,true,true]);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await expect(page.locator('#mini-dialog')).toBeHidden();
  await page.setViewportSize({width:1440,height:1000}); await choose(page);
  expect((await state(page)).view).toEqual(current.view); expect((await wallet(page)).balance).toBe(9990);
  await reloadAndChoose(page);
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
  await expect(game(page).locator('[data-fh=retry]')).toBeEnabled();
  expect((await wallet(page)).balance).toBe(9996.31);
  await reloadAndChoose(page);
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
  const frame = game(page).locator('.fh');
  await frame.evaluate(root => {
    const sample = { gaps: [] as number[], running: true };
    (root as any).__audioFrames = sample;
    let previous: number | undefined;
    const tick = (now: number) => {
      if (!sample.running) return;
      if (previous !== undefined) sample.gaps.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act(page); let current = await state(page);
  const frameGaps = await frame.evaluate(root => {
    const sample = (root as any).__audioFrames as { gaps: number[]; running: boolean };
    sample.running = false;
    return sample.gaps;
  });
  expect(frameGaps.length).toBeGreaterThan(0);
  const maxFrameGapMs = Math.max(...frameGaps);
  await writeFile(out + '/timing.json', JSON.stringify({ cues: current.timing, maxFrameGapMs }, null, 2));
  expect(current.audio.played.land).toBe(1); expect(current.audio.played.flow).toBe(1); expect(current.audio.played.win).toBe(1);
  // The accent is applied on the next animation frame. Keep the 80 ms budget
  // on a fast renderer and account for a slow frame measured on this host.
  for (const cue of current.timing) {
    expect(cue.skewMs).toBeGreaterThanOrEqual(-1);
    expect(cue.skewMs).toBeLessThanOrEqual(Math.max(80, maxFrameGapMs) + 1);
  }
  const cuesBeforeSilence=current.audio.played;
  await page.evaluate(async()=>{const path='/src/game/GameAudio.ts';const {gameAudio}=await import(path);gameAudio.setVolume(0);});
  expect((await state(page)).audio.activeVoices).toBe(0);
  await page.evaluate(async()=>{const path='/src/game/GameAudio.ts';const {gameAudio}=await import(path);gameAudio.setVolume(.35);});
  await expect.poll(async()=>((await state(page)).audio.musicVoices??0)>0).toBe(true);
  expect((await state(page)).audio.played).toEqual(cuesBeforeSilence);
  await game(page).locator('[data-fh=spin]').click(); await expect(game(page).locator('[data-fh=skip]')).toBeVisible();
  await game(page).locator('[data-fh=skip]').click(); await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).audio.activeVoices).toBe(0);
  await game(page).locator('[data-fh=rules]').click(); await expect(game(page).locator('.fh-dialog')).toBeVisible();
  expect((await state(page)).audio.activeVoices).toBe(0);
  await game(page).locator('[data-fh=close]').click(); await game(page).locator('[data-fh=settings]').click(); await game(page).locator('[data-fh=music]').uncheck(); await game(page).locator('[data-fh=motion]').check();
  await game(page).locator('[data-fh=close]').click(); expect((await state(page)).reduced).toBe(true);
  await game(page).locator('[data-fh=sound]').click(); await act(page); current = await state(page);
  expect(current.audio.activeVoices).toBe(0); expect(current.audio.played.win).toBe(1);
  await page.locator('#studio-game-list').click(); await choose(page); expect((await state(page)).audio.activeVoices).toBe(0);
  expect(failed).toEqual([]);
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
  await game(page).locator('.fh-full-rules summary').click();await expect(game(page).locator('.fh-dialog')).toContainText('95.9942%');expect(await game(page).locator('.fh').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await game(page).locator('[data-fh=close]').click();await page.setViewportSize({width:320,height:780});await fit(game(page));
  await game(page).locator('[data-fh=spin]').click();await expect(game(page).locator('.fh')).toHaveAttribute('data-outcome','loss');
  await expect(game(page).locator('[data-fh=total]')).toHaveText('0.00');expect((await wallet(page)).balance).toBe(9990);
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
    const frames:{motion:string;angles:number[];sap:number[];total:number;cell:{x:number;y:number;width:number;height:number;transform:string}}[]=[];
    const start=performance.now();
    while(performance.now()-start<5000){
      const cells=Array.from(root.querySelectorAll<HTMLElement>('[data-cell]'));
      const total=Number(root.querySelector('[data-fh=total]')!.textContent!.replace(/\s/g,'').replace(',','.'));
      const cell=cells[5],box=cell.getBoundingClientRect(),css=getComputedStyle(cell);
      frames.push({motion:(root as HTMLElement).dataset.motion||'',angles:cells.map(c=>parseFloat(c.style.getPropertyValue('--turn'))),sap:cells.map(c=>Number(c.style.getPropertyValue('--sap'))),total:Math.round(total*100),cell:{x:box.x,y:box.y,width:box.width,height:box.height,transform:css.transform}});
      if(frames.some(f=>f.motion==='flow') && !(root as HTMLElement).dataset.motion) break;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    return frames;
  });
  const turn=frames.filter(f=>f.motion==='turn');
  for(const frame of turn){expect(frame.cell).toEqual(turn[0].cell);expect(frame.cell.transform).toBe('none');}
  expect(turn.some(f=>f.angles[5]>0 && f.angles[5]<90)).toBe(true);
  for(const frame of frames) for(let cell=0;cell<25;cell++) if(cell!==5) expect(frame.angles[cell]).toBe(parseFloat(before[cell]));
  expect(frames.some(f=>f.motion==='flow' && f.sap.some(value=>value>0 && value<1))).toBe(true);
  // The earlier flower stays collected and the new one joins the sum only after its light arrives.
  expect(frames[0].total).toBe(631);expect(frames.every(f=>f.total===631||f.total===1262)).toBe(true);expect(frames.at(-1)!.total).toBe(1262);
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  expect((await state(page)).view.base.rotation).toBe(2);
  const bonusFit=await game(page).locator('.fh').evaluate(root=>({bonus:root.querySelector('[data-bud]')!.getBoundingClientRect().bottom,controls:root.querySelector('.fh-controls')!.getBoundingClientRect().top}));
  expect(bonusFit.bonus).toBeLessThanOrEqual(bonusFit.controls);
  await page.screenshot({path:out+'/desktop-lit.png'});
  await writeFile(out+'/motion-frames.json',JSON.stringify({frames:frames.length,turnFrames:turn.length,intermediateAngles:turn.map(f=>f.angles[5]),continuousSapFrames:frames.filter(f=>f.sap.some(v=>v>0&&v<1)).length},null,2));
  await page.setViewportSize({width:1110,height:1244}); await fit(game(page));
  await expect(game(page).locator('.fh')).toHaveAttribute('data-frame-layout','portrait');
  await expect(game(page).locator('.fh-board')).toBeInViewport();
  await expect.poll(()=>game(page).locator('.fh-board').evaluate(board=>board.clientWidth)).toBeGreaterThan(400);
  await expectConnectedChat(page);
  await page.screenshot({path:out+'/desktop-tall.png'});
  await expect(game(page).locator('.fh-character')).toBeInViewport();
});

test('twelve straight roots turn before the reply and settle on the confirmed field while thirteen joints stay', async({page,roomPath})=>{
  await page.setViewportSize({width:1280,height:720});await routeScenario(page,'loss');await enter(page,roomPath);
  const rotors=[1,3,5,7,9,11,13,15,17,19,21,23],records=[];
  for(const mode of ['normal','muted','fast']){
    if(mode==='muted')await game(page).locator('[data-fh=sound]').click();
    if(mode==='fast')await game(page).locator('[data-fh=fast]').check();
    let held=false,release!:()=>void;const gate=new Promise<void>(done=>release=done);
    await page.route('**/api/demo-wallet/expansion',async route=>{if(!held&&route.request().method()==='POST'){held=true;await gate;}await route.fallback();});
    const before=(await wallet(page)).balance;
    const recording=game(page).locator('.fh').evaluate(async root=>{
      const frames:{motion:string;angles:number[];total:string;balance:string;boxes:string}[]=[],start=performance.now();
      const cells=Array.from(root.querySelectorAll<HTMLElement>('[data-cell]'));
      while(performance.now()-start<9000){
        frames.push({motion:(root as HTMLElement).dataset.motion||'',angles:cells.map(cell=>parseFloat(cell.style.getPropertyValue('--turn'))),total:root.querySelector('[data-fh=total]')!.textContent!,balance:root.querySelector('[data-fh=balance]')!.textContent!,boxes:JSON.stringify(cells[10].getBoundingClientRect())});
        if(frames.some(f=>f.motion==='reveal')&&(root as HTMLElement).dataset.motion==='flow')break;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      return frames;
    });
    await game(page).locator('[data-fh=spin]').click();await expect.poll(()=>held).toBe(true);
    await expect(game(page).locator('[data-fh=spin]')).toBeDisabled();await expect(game(page).locator('[data-fh=spin]')).toContainText('ПРОБУЖДАЕМ');
    await page.waitForTimeout(500);expect((await state(page)).visual.field.spinning).toBe(12);
    await expect(game(page).locator('[data-fh=retry]')).toBeHidden();await expect(game(page).locator('.fh-powered')).toHaveCount(0);
    release();const frames=await recording;
    const spin=frames.filter(f=>f.motion==='spin'),reveal=frames.filter(f=>f.motion==='reveal');
    expect(spin.length).toBeGreaterThan(8);expect(reveal.length).toBeGreaterThan(5);
    for(const cell of rotors)expect(new Set(spin.map(f=>f.angles[cell])).size).toBeGreaterThan(4);
    for(const frame of frames){expect(frame.boxes).toBe(frames[0].boxes);for(let cell=0;cell<25;cell++)if(!rotors.includes(cell))expect(frame.angles[cell]).toBe(frames[0].angles[cell]);}
    expect(reveal.every(f=>f.total==='0,00')).toBe(true);
    await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();expect((await state(page)).scene.board).toEqual(referenceBoard(4095));
    const angles=await game(page).locator('[data-cell]').evaluateAll(cells=>cells.map(c=>parseFloat((c as HTMLElement).style.getPropertyValue('--turn'))));
    for(const cell of rotors)expect(angles[cell]).toBe(90);
    if(mode!=='normal')expect((await state(page)).audio.activeVoices).toBe(0);
    expect((await wallet(page)).balance).toBe(before-10);
    records.push({mode,spinFrames:spin.length,revealFrames:reveal.length});
  }
  await writeFile(out+'/field-arrival.json',JSON.stringify(records,null,2));
  await page.screenshot({path:out+'/board-fixed.png'});
});

test('the displayed wallet and result wait for the light, while the server has already settled', async({page,roomPath})=>{
  await routeScenario(page,'win');await enter(page,roomPath);
  await game(page).locator('[data-fh=spin]').click();await expect(game(page).locator('[data-fh=skip]')).toBeVisible();
  await expect(game(page).locator('[data-fh=balance]')).toHaveText(/^9.990,00$/);
  await expect(game(page).locator('.fh')).toHaveAttribute('data-outcome','');await expect(game(page).locator('[data-fh=net]')).toHaveText('');
  expect((await wallet(page)).balance).toBe(10008.93);
  await expect(game(page).locator('[data-flower][data-paid=true]')).toHaveCount(0);
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled({timeout:15000});
  await expect(game(page).locator('[data-fh=balance]')).toHaveText(/^10.008,93$/);await expect(game(page).locator('[data-fh=net]')).toHaveText('+8,93');
  await expect(game(page).locator('[data-flower][data-paid=true]')).toHaveCount(3);
});

test('autoplay starts only on confirmation, waits at the rune, plays free pulses for free and stops by hand', async({page,roomPath})=>{
  await routeScenario(page,'choice-bonus');await enter(page,roomPath);
  const auto=game(page).locator('[data-fh=auto]'),panel=game(page).locator('[data-fh=auto-dialog]'),result=game(page).locator('[data-fh=result-dialog]');
  const bets=async()=>(await wallet(page)).entries.filter((e:any)=>e.kind==='bet').length;
  const change=async(scenario:string)=>{await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,scenario);};
  await game(page).locator('[data-fh=fast]').check();
  await auto.click();await expect(panel).toBeVisible();await expect(panel.locator('[data-auto-count]')).toHaveText(['10','25','50','100']);
  await panel.locator('[data-auto-count="25"]').click();await expect(panel.locator('[data-fh=auto-start]')).toContainText('25');
  await page.screenshot({path:out+'/autoplay-panel.png'});
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(auto).toBeFocused();
  expect((await state(page)).autoplay.active).toBe(false);expect(await bets()).toBe(0);
  await auto.click();await panel.locator('[data-auto-count="10"]').click();await panel.locator('[data-fh=auto-start]').click();
  await expect.poll(async()=>(await state(page)).view?.stage,{timeout:20000}).toBe('choice');await expect(game(page).locator('[data-fh=pass]')).toBeEnabled();
  await page.waitForTimeout(2000);expect((await state(page)).view.stage).toBe('choice');
  await expect(game(page).locator('[data-fh=next]')).toHaveText('Автоигра ждёт твоего выбора.');await expect(auto).toContainText('Стоп 9');
  await expect(game(page).locator('[data-manual-stake]')).toBeDisabled();expect((await state(page)).accepted).toBe(1);
  await game(page).locator('[data-fh=pass]').click();
  await expect(result).toBeVisible({timeout:60000});await expect(game(page).locator('[data-fh=result-confirm]')).toContainText('осталось 9');
  expect(await bets()).toBe(1);expect((await state(page)).accepted).toBe(1);await page.waitForTimeout(1500);expect(await bets()).toBe(1);
  await page.screenshot({path:out+'/autoplay-result.png'});
  await change('loss');await game(page).locator('[data-fh=result-confirm]').click();
  await expect.poll(async()=>(await state(page)).accepted,{timeout:40000}).toBe(3);await auto.click();
  await expect.poll(async()=>{const now=await state(page);return now.autoplay.active||now.busy;},{timeout:20000}).toBe(false);
  // A slow machine may accept one more field before the click reaches Stop. Nothing is accepted afterwards.
  const stopped=(await state(page)).accepted;expect([3,4]).toContain(stopped);expect(await bets()).toBe(stopped);await page.waitForTimeout(1500);expect(await bets()).toBe(stopped);
  // Dismissing the bonus result ends the paid series.
  await change('choice-bonus');await auto.click();await panel.locator('[data-fh=auto-start]').click();
  await expect(game(page).locator('[data-fh=pass]')).toBeEnabled({timeout:20000});await game(page).locator('[data-fh=pass]').click();
  await expect(result).toBeVisible({timeout:60000});await game(page).locator('[data-fh=close-result]').click();
  await expect.poll(async()=>(await state(page)).autoplay.active).toBe(false);await page.waitForTimeout(1500);expect(await bets()).toBe(stopped+1);
  // Opening the rules stops the series after the accepted field.
  await change('loss');await auto.click();await panel.locator('[data-fh=auto-start]').click();await expect.poll(async()=>(await state(page)).accepted,{timeout:20000}).toBe(1);
  await game(page).locator('[data-fh=rules]').click();await expect.poll(async()=>(await state(page)).autoplay.active,{timeout:20000}).toBe(false);const paused=await bets();
  await game(page).locator('[data-fh=close]').click();await page.waitForTimeout(1800);expect(await bets()).toBe(paused);
  // A full series of ten accepts exactly ten paid fields.
  await auto.click();await panel.locator('[data-fh=auto-start]').click();
  await expect.poll(async()=>{const now=await state(page);return now.accepted===10&&!now.autoplay.active&&!now.busy;},{timeout:90000}).toBe(true);
  expect(await bets()).toBe(paused+10);await page.waitForTimeout(1500);expect(await bets()).toBe(paused+10);
});

test('autoplay stops on a lost reply and recovery never repeats the charge or resumes the series', async({page,roomPath})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await routeScenario(page,'partial',true);await enter(page,roomPath);
  await game(page).locator('[data-fh=auto]').click();await game(page).locator('[data-fh=auto-start]').click();
  await expect(game(page).locator('[data-fh=retry]')).toBeEnabled({timeout:20000});expect((await state(page)).autoplay.active).toBe(false);
  expect((await wallet(page)).balance).toBe(9996.31);
  await reloadAndChoose(page);await game(page).locator('[data-fh=retry]').click();await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();
  await page.waitForTimeout(1500);const entries=(await wallet(page)).entries;expect(entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
  expect((await wallet(page)).balance).toBe(9996.31);expect((await state(page)).autoplay.active).toBe(false);
});

test('a held root stays visible and fixed while the next bonus field is assembled', async({page,roomPath})=>{
  await routeScenario(page,'maximum');await enter(page,roomPath);await game(page).locator('[data-fh=fast]').check();
  await act(page);await act(page);const previous=await state(page),held:number[]=previous.scene.lockedCells;expect(held.length).toBeGreaterThan(0);
  const recording=game(page).locator('.fh').evaluate(async(root,held)=>{
    const frames:{motion:string;angles:string[];locked:number[]}[]=[],start=performance.now();
    while(performance.now()-start<6000){
      const field=(root.ownerDocument.defaultView!.parent as any).royalDemo.getMiniState().visual.field;
      frames.push({motion:(root as HTMLElement).dataset.motion||'',locked:field.held,angles:held.map((index:number)=>root.querySelector<HTMLElement>(`[data-cell="${index}"]`)!.style.getPropertyValue('--turn'))});
      if(frames.some(f=>f.motion==='reveal')&&(root as HTMLElement).dataset.motion==='flow')break;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    return frames;
  },held);
  await game(page).locator('[data-fh=spin]').click();const frames=await recording;
  expect(frames.some(f=>f.motion==='spin')).toBe(true);expect(frames.some(f=>f.motion==='reveal')).toBe(true);
  for(const frame of frames){expect(frame.angles).toEqual(frames[0].angles);for(const cell of held)expect(frame.locked).toContain(cell);}
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();let current=await state(page);while(current.view.stage!=='settled')current=await act(page);
  expect(current.scene.totalUnits).toBe(946500);expect((await wallet(page)).balance).toBe(19455);
  await writeFile(out+'/held-field.json',JSON.stringify({held,frames},null,2));
});

test('the native face stays intact while idle motion, rules and fresh reactions work', async ({page,roomPath}) => {
  await routeScenario(page,'win'); await enter(page,roomPath);
  const initial=(await state(page)).character;
  expect(initial.renderer).toBe('webgl');expect(initial.events).toEqual([]);
  const canvas=game(page).locator('.fh-character');
  const idle=await canvas.screenshot();
  await page.waitForTimeout(600);
  const moving=await canvas.screenshot();expect(moving.equals(idle)).toBe(false);
  await writeFile(out+'/native-face.png',moving);
  await game(page).locator('[data-fh=rules]').click();
  const stopped=(await state(page)).character;expect(stopped.running).toBe(false);expect(stopped.lids).toBe(0);
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
  expect(current.character.events.map((e:any)=>e.reaction)).toEqual(['awaken','land','channel','flower','pulse','pulse','win']);
  expect(current.character.pose).toBe('win');
  await page.screenshot({path:out+'/elf-win.png'});
  await page.locator('#studio-game-list').click();await choose(page);
  current=await state(page);expect(current.character.pose).toBe('idle');expect(current.character.events).toEqual([]);expect(current.presentations).toBe(0);
  for(const scenario of ['loss','partial']){
    await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,scenario);await act(page);
    expect((await state(page)).character.events.some((e:any)=>e.pose==='win'||e.pose==='big')).toBe(false);
  }
  await game(page).locator('[data-fh=settings]').click();await game(page).locator('[data-fh=motion]').check();await game(page).locator('[data-fh=close]').click();
  await game(page).locator('.fh-character').evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  const reduced=(await state(page)).character;expect(reduced.reduced).toBe(true);expect(reduced.running).toBe(false);
  await page.waitForTimeout(300);expect((await state(page)).character.frames).toBe(reduced.frames);
  await writeFile(out+'/character-lifecycle.json',JSON.stringify({idle:initial,paused:stopped,reopened:current.character,reduced},null,2));
});

test('the elf shows choice, flower, bonus and large final reactions in the real host with chat', async ({page,roomPath}) => {
  await routeScenario(page,'choice-bonus');await enter(page,roomPath);
  await act(page);let current=await state(page);
  expect(current.character.events.map((e:any)=>e.reaction)).toEqual(['awaken','land','channel','flower','choice']);
  await page.screenshot({path:out+'/elf-choice.png'});
  await game(page).locator('[data-cell="5"]').click();
  await expect(game(page).locator('.fh-character')).toHaveAttribute('data-pose','flower');
  await expect.poll(async()=>(await state(page)).character.transition,{intervals:[30]}).toBe(1);
  await page.screenshot({path:out+'/elf-flower.png'});
  await expect(game(page).locator('[data-fh=spin]')).toBeEnabled();current=await state(page);
  expect(current.view.stage).toBe('bonus');expect(current.character.pose).toBe('bonus');
  expect(current.character.events.some((e:any)=>e.pose==='win'||e.pose==='big')).toBe(false);
  // Both flower colours grow on every side of the frame.
  for(let side=0;side<4;side++)expect(new Set(current.visual.effects.blossoms.filter((_:boolean,i:number)=>i%4===side)).size).toBe(2);
  await page.screenshot({path:out+'/elf-bonus.png'});
  await page.setViewportSize({width:390,height:844});await fit(game(page));await expectConnectedChat(page);
  await page.screenshot({path:out+'/elf-mobile.png'});
  await game(page).locator('[data-fh=fast]').check();
  while(current.view.stage!=='settled')current=await act(page);
  await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,'maximum');
  current=await act(page);while(current.view.stage!=='settled')current=await act(page);
  expect(current.character.events.at(-1).reaction).toBe('big');expect(current.scene.totalUnits).toBe(946500);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:out+'/elf-big.png'});
  // She celebrates again after a fresh large round and keeps the pose while its result window is open.
  await page.unroute('**/api/demo-wallet/expansion');await routeScenario(page,'maximum');const result=game(page).locator('[data-fh=result-dialog]');
  const spin=game(page).locator('[data-fh=spin]');await spin.click();for(let i=0;i<4;i++){await expect(spin).toContainText('осталось '+(4-i),{timeout:20000});await expect(spin).toBeEnabled();await spin.click();}
  await expect(result).toBeVisible({timeout:20000});await page.waitForTimeout(5500);expect((await state(page)).character.pose).toBe('big');
  await game(page).locator('[data-fh=result-confirm]').click();await expect.poll(async()=>(await state(page)).character.pose,{timeout:4000}).toBe('idle');
  await writeFile(out+'/character-events.json',JSON.stringify(current.character,null,2));
});

test('the elf anticipates the field and keeps pose weights and gestures continuous through muted and fast wins', async ({page,roomPath}) => {
  await installPresentationClock(page);
  await routeScenario(page,'win');await enter(page,roomPath);
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
  const records=[];
  for(const mode of ['normal','muted','fast']){
    if(mode==='muted')await game(page).locator('[data-fh=sound]').click();
    if(mode==='fast')await game(page).locator('[data-fh=fast]').check();
    const recording=game(page).locator('.fh').evaluate(async root=>{
      const frames:{at:number;motion:string;pose:string;reaction:string|null;weights:number[];gesture:number[];draws:number;light:number}[]=[];
      const start=performance.now();let winAt=0,sawField=false;
      while(performance.now()-start<12000){
        const character=(root.ownerDocument.defaultView!.parent as any).royalDemo.getMiniState().character;
        const at=performance.now();
        const motion=(root as HTMLElement).dataset.motion||'';
        frames.push({at,motion,pose:character.pose,reaction:character.reaction,weights:character.weights,gesture:character.gesture,draws:character.frames,light:Number(getComputedStyle(root.querySelector('.fh-character-energy')!).opacity)});
        if(motion==='spin'||motion==='reveal')sawField=true;
        if(sawField&&character.reaction==='win'&&!winAt)winAt=at;
        if(winAt&&at-winAt>1600)break;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      return frames;
    });
    await advanceRecordedSpin(page, 12200);
    const frames=await recording;
    expect(frames.some(f=>['spin','reveal'].includes(f.motion)&&f.reaction==='awaken')).toBe(true);
    // The fast field lands after 480 ms, so its gesture is cut short and the living sway decides the exact peak.
    expect(frames.some(f=>f.reaction==='awaken'&&f.gesture[0]>(mode==='fast'?.2:.5))).toBe(true);
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
  await page.clock.resume();
  await page.setViewportSize({width:390,height:844});await fit(game(page));await expectConnectedChat(page);
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
  await expect(game(page).locator('[data-fh=next]')).toContainText('Свет дойдёт от кристалла');
  await expect(game(page).locator('[data-fh=spin]')).toContainText('10,00 USDT за поле');
  await act(page);await expect(game(page).locator('[data-fh=total]')).toHaveText('6,31');await expect(game(page).locator('[data-fh=net]')).toHaveText('-3,69');
  await expect(game(page).locator('.fh-flower-value')).toHaveText(['6,31','6,31','6,31']);
  await game(page).locator('[data-fh=higher]').click();
  await expect(game(page).locator('[data-fh=next]')).toContainText('Собрано меньше ставки 10,00 USDT');
  await expect(game(page).locator('.fh-flower-value')).toHaveText(['6,31','6,31','6,31']);
  await game(page).locator('[data-fh=energy]').click();await expect(game(page).locator('#fh-energy-note')).toBeVisible();
  await expect(game(page).locator('[data-fh=flower-value-note]')).toContainText('6,31 USDT');
  await game(page).locator('#fh-energy-note button').click();
  const metrics=[];
  for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:320,height:780}]){
    await page.setViewportSize(viewport);await fit(game(page));await expectConnectedChat(page);
    const sizes=await game(page).locator('.fh').evaluate(root=>{
      const selectors=['[data-fh=settings]','[data-fh=energy]','[data-fh=spin]','[data-manual-stake]'];
      selectors.push('[data-fh=lower]','[data-fh=higher]','[data-fh=rules]','[data-fh=auto]','.fh-fast');
      const controls=selectors.map(selector=>{const e=root.querySelector(selector)!,r=e.getBoundingClientRect();return{selector,width:r.width,height:r.height};});
      const fonts=[{selector:'[data-fh=net]',minimum:14},{selector:'[data-fh=next]',minimum:12},{selector:'.fh-spin small',minimum:11}].map(({selector,minimum})=>{
        const element=root.querySelector(selector)!;
        return {selector,minimum,size:parseFloat(getComputedStyle(element).fontSize),fits:element.scrollWidth<=element.clientWidth+1};
      });
      const board=root.querySelector('.fh-board')!.getBoundingClientRect();
      const result=root.querySelector('[data-fh=total]')!,net=root.querySelector('[data-fh=net]')!;
      return{width:root.clientWidth,height:root.clientHeight,board:board.toJSON(),controls,fonts,returnColor:getComputedStyle(result).color,netFont:parseFloat(getComputedStyle(net).fontSize),returnFont:parseFloat(getComputedStyle(result).fontSize),textFits:[result,net,root.querySelector('[data-fh=balance]')!].every(e=>e.scrollWidth<=e.clientWidth+1)};
    });
    for(const control of sizes.controls){expect(control.width).toBeGreaterThanOrEqual(44);expect(control.height).toBeGreaterThanOrEqual(44);}
    for(const font of sizes.fonts){expect(font.size).toBeGreaterThanOrEqual(font.minimum);expect(font.fits).toBe(true);}
    expect(sizes.returnFont).toBeGreaterThanOrEqual(20);expect(sizes.returnFont).toBeGreaterThan(sizes.netFont);expect(sizes.textFits).toBe(true);
    if(viewport.width===1280)expect(sizes.board.width).toBeGreaterThanOrEqual(330);
    metrics.push({viewport,...sizes});await page.screenshot({path:out+`/ux-v7-${viewport.width}.png`});
  }
  await game(page).locator('[data-fh=settings]').click();
  await expect(game(page).locator('[data-panel=settings]')).toBeVisible();await expect(game(page).locator('[data-fh=motion]')).toBeInViewport();
  await page.screenshot({path:out+'/ux-v7-settings.png'});
  await game(page).locator('[data-fh=close]').click();await expect(game(page).locator('[data-fh=settings]')).toBeFocused();await game(page).locator('[data-fh=rules]').click();await expect(game(page).locator('.fh-steps li')).toHaveCount(5);
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
    // The host resizes the iframe before the module's own layout frame runs.
    await expect(async()=>{
      const outer=await page.locator('.forest-heart-frame').evaluate(frame=>({frame:frame.getBoundingClientRect().toJSON(),stage:frame.closest('.mini-stage')!.getBoundingClientRect().toJSON(),mode:frame.closest('#mini-dialog')!.getAttribute('data-game-viewport')}));
      const inner=await game(page).locator('.fh').evaluate(async root=>{
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
        const box=(selector:string)=>root.querySelector(selector)!.getBoundingClientRect().toJSON();
        const logo=root.querySelector<HTMLImageElement>('.fh-title-logo')!;
        return{width:root.clientWidth,height:root.clientHeight,layout:(root as HTMLElement).dataset.layout,logo:{...logo.getBoundingClientRect().toJSON(),fit:getComputedStyle(logo).objectFit},board:box('.fh-board'),source:box('.fh-source'),character:box('.fh-character'),plate:box('.fh-plate'),story:root.querySelector('.fh-story')!.getBoundingClientRect().bottom-root.querySelector('.fh-plate')!.getBoundingClientRect().bottom,controls:box('.fh-controls'),tools:box('.fh-tools'),spin:box('[data-fh=spin]'),flowers:[...root.querySelectorAll('.fh-flower')].map(flower=>({image:flower.getBoundingClientRect().toJSON(),value:flower.querySelector('.fh-flower-value')!.getBoundingClientRect().toJSON(),font:parseFloat(getComputedStyle(flower.querySelector('.fh-flower-value')!).fontSize)})),scrollWidth:root.ownerDocument.documentElement.scrollWidth,scrollHeight:root.ownerDocument.documentElement.scrollHeight};
      });
      expect(Math.abs(outer.frame.width-outer.stage.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(outer.frame.height-outer.stage.height)).toBeLessThanOrEqual(2);
      expect(inner.scrollWidth).toBeLessThanOrEqual(inner.width+1);expect(inner.scrollHeight).toBeLessThanOrEqual(inner.height+1);
      for(const box of [inner.board,inner.plate,inner.controls,inner.spin,inner.tools,...inner.flowers.map(f=>f.value)]){
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(inner.width+1);expect(box.bottom).toBeLessThanOrEqual(inner.height+1);
      }
      expect(inner.board.width).toBeGreaterThanOrEqual(viewport.height<500?150:180);
      expect(inner.logo.fit).toBe('contain');
      expect(inner.story).toBeLessThanOrEqual(0);
      for(const flower of inner.flowers)expect(flower.image.left).toBeGreaterThanOrEqual(inner.board.right-2);
      if(inner.layout!=='landscape'){expect(inner.plate.top).toBeGreaterThanOrEqual(inner.board.bottom);expect(inner.plate.bottom).toBeLessThanOrEqual(inner.controls.top+1);}
      else expect(inner.plate.bottom).toBeLessThanOrEqual(inner.controls.top+1);
      if(inner.layout==='wide'){
        expect(inner.logo.top).toBeGreaterThanOrEqual(-1);expect(inner.height-inner.controls.bottom).toBeLessThanOrEqual(90);
        // The plate belongs to the frame and the main action stays on the axis of the field.
        expect(inner.plate.width).toBeLessThanOrEqual(inner.board.width*1.03);expect(Math.abs((inner.plate.left+inner.plate.right)/2-(inner.board.left+inner.board.right)/2)).toBeLessThanOrEqual(2);
        expect(Math.abs((inner.spin.left+inner.spin.right)/2-(inner.board.left+inner.board.right)/2)).toBeLessThanOrEqual(2);
        for(const flower of inner.flowers){expect(flower.value.left).toBeGreaterThanOrEqual(inner.board.right);expect(flower.font).toBeGreaterThanOrEqual(16);}
        expect(inner.character.height).toBeGreaterThanOrEqual(inner.board.height*.95);
        expect(inner.character.width/inner.character.height).toBeCloseTo(5/6,1);
      }
      records.push({viewport,outer,inner});
    }).toPass({timeout:5000});
    await page.screenshot({path:out+`/responsive-${viewport.width}x${viewport.height}.png`});
    await writeFile(out+'/responsive-metrics.json',JSON.stringify(records,null,2));
    await expectConnectedChat(page);
  }
  await act(page);await expect(game(page).locator('[data-cell]:enabled')).toHaveCount(12);
  await page.screenshot({path:out+'/layout-v11-connected.png'});
  await page.setViewportSize({width:844,height:390});await expect(game(page).locator('[data-fh=pass]')).toBeInViewport();
  await act(page,'[data-cell="5"]');
  await expect(game(page).locator('[data-fh=spin]')).toBeInViewport();
  const round=await state(page);expect(round.view.stage).toBe('bonus');
  for(const viewport of [{width:667,height:375},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    await expect.poll(()=>game(page).locator('.fh-board').evaluate(e=>e.clientWidth)).toBeGreaterThanOrEqual(150);
    await expect.poll(() => game(page).locator('.fh').evaluate(root => {
      const spin=root.querySelector('[data-fh=spin]')!.getBoundingClientRect();
      const bonus=root.querySelector('.fh-bonus')!.getBoundingClientRect();
      return Math.max(spin.bottom,bonus.bottom)-root.clientHeight;
    })).toBeLessThanOrEqual(0);
    await expect(game(page).locator('[data-fh=spin]')).toContainText(/БЕСПЛАТН/i);
    expect(await game(page).locator('.fh-spin .fh-button-label').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await page.screenshot({path:out+`/responsive-bonus-${viewport.width}.png`});
  }
  // Rotating with a focused control must never leave the scene scrolled.
  await game(page).locator('[data-fh=spin]').focus();
  expect(await game(page).locator('.fh').evaluate(async root=>{root.scrollLeft=85;root.scrollTop=20;await new Promise(done=>setTimeout(done,120));return [root.scrollLeft,root.scrollTop];})).toEqual([0,0]);
  // Every caption of the main button fits, including the animation skip.
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const viewport of [{width:320,height:568},{width:393,height:852},{width:568,height:320},{width:852,height:393},{width:1280,height:720}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(150);
    const fits=await game(page).locator('.fh-primary').evaluate(root=>[...root.querySelectorAll<HTMLElement>('.fh-spin,.fh-pass,.fh-skip')].map(button=>{const hidden=button.hidden;button.hidden=false;const ok=[...button.querySelectorAll<HTMLElement>('.fh-button-label,small')].every(e=>e.scrollWidth<=e.clientWidth+1);button.hidden=hidden;return button.className+':'+ok;}));
    expect(fits,JSON.stringify(viewport)).toEqual(['fh-spin:true','fh-pass:true','fh-skip:true']);
  }
  await page.locator('#mini-dialog .mini-top [data-close]').click();
  await choose(page);expect((await state(page)).sessionId).toBe(round.sessionId);
});
