import { test, expect, request as apiRequest, type Page, type Route } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { mkdir } from 'node:fs/promises';
import { validNeopolisSession } from '../src/shared/neopolis';

const entry = '/tests/fixtures/neopolis-preview.html';
const state = (page: Page) => page.evaluate(() => (window as any).neopolisPreview.state());
const session = (page: Page) => page.evaluate(() => (window as any).neopolisPreview.client.sessions.find((value: any) => value.gameId === 'studio-neopolis'));
// Full HTTP/service/DB settlement with reproducible entropy for rare campaigns.
test.beforeEach(async({page})=>{
  await page.route('**/api/game-wallet/expansion',async route=>{
    const req=route.request();
    if(req.method()!=='POST'||!['studio-neopolis','studio-dracona'].includes(req.postDataJSON()?.gameId)){await route.fallback();return;}
    const response=await route.fetch({url:new URL('/__test/neopolis/operate',req.url()).href});
    await route.fulfill({response});
  });
});
async function ready(page: Page, lang = 'en') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(entry + '?lang=' + lang);
  await expect(page.locator('#preview')).toHaveAttribute('data-game-module-id', 'studio-neopolis');
  await expect(page.locator('[data-np=spin]')).toBeEnabled();
  await expect.poll(() => page.locator('.np img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)),{timeout:15000}).toBe(true);
  await page.locator('.np img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
}
async function spin(page: Page) {
  const before = await session(page), marker = before?.id + ':' + before?.view.neopolis.revision;
  await expect(page.locator('[data-np=spin]')).toBeEnabled(); await page.locator('[data-np=spin]').click();
  await page.waitForFunction(old => {
    const harness = (window as any).neopolisPreview, s = harness.client.sessions.find((value: any) => value.gameId === 'studio-neopolis');
    return s && s.id + ':' + s.view.neopolis.revision !== old && !harness.client.busy && !harness.state().busy && !harness.client.pending;
  }, marker);
  const result = await session(page); expect(validNeopolisSession(result)).toBe(true);
  const visible=await state(page);
  expect(visible.feedback.shownUnits).toBe(Number(result.view.neopolis.totalPayoutUnits));
  if(result.state==='active') expect(visible.feedback.round).toBeNull();
  else expect(visible.feedback.round).toMatchObject({payout:Number(result.returnedUnits),stake:Number(result.stakeUnits),net:Number(result.returnedUnits)-Number(result.stakeUnits)});
  return result;
}
async function closeNotice(page: Page) { if (await page.locator('[data-np=dialog]').isVisible()) await page.locator('[data-np=close]').click(); }

test('Russian and English modules fit desktop and phone, with localized rules and hero selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results/neopolis/review', { recursive: true });
  for (const lang of ['ru','en']) {
    await ready(page, lang);
    await expect(page.locator('.np h1')).toHaveText(lang === 'en' ? 'Guardians of Neopolis' : 'Стражи Неополиса');
    await page.locator('[data-hero=prism]').click(); expect((await state(page)).selected).toBe('prism');
    await expect(page.locator('[data-hero=prism]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-np=rules]').click();
    await expect(page.locator('.np-dialog h2')).toHaveText(lang === 'en' ? 'Game rules' : 'Правила игры');
    await expect(page.locator('.np-dialog tbody tr')).toHaveCount(6);
    if (lang === 'en') expect(await page.locator('.np').innerText()).not.toMatch(/[А-Яа-яЁё]/);
    await page.locator('[data-np=close]').click();
    for (const [width, height] of [[1920,1080],[1366,768],[900,900],[390,844],[360,740]]) {
      await page.setViewportSize({ width, height });
      const geometry = await page.locator('.np').evaluate(root => ({ width: root.clientWidth, scroll: root.scrollWidth, cells: root.querySelectorAll('[role=gridcell]').length }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1); expect(geometry.cells).toBe(20);
      const cards = await page.locator('.np-hero').evaluateAll(cards => cards.map(card => { const rect = card.getBoundingClientRect(); return { x:rect.x, y:rect.y }; }));
      if (width < 760) { expect(new Set(cards.map(card => card.y)).size).toBe(1); expect(cards[0].x).toBeLessThan(cards[1].x); expect(cards[1].x).toBeLessThan(cards[2].x); }
      await page.locator('[data-np=spin]').scrollIntoViewIfNeeded(); await expect(page.locator('[data-np=spin]')).toBeInViewport();
      await page.locator('.np').evaluate(root => { root.scrollTop = 0; });
      await page.screenshot({ path: 'test-results/neopolis/review/' + lang + '-' + width + '.png', fullPage: true });
    }
    await page.setViewportSize({ width:1440, height:1000 });
  }
  expect(errors).toEqual([]);
});

test('real API retries a lost result once, restores collection and bonus, and settles the free series', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  let original: any;
  const loseFirst = async (route:Route) => {
    if (route.request().method() !== 'POST' || original) { await route.fallback(); return; }
    original = await (await route.fetch({url:new URL('/__test/neopolis/operate',route.request().url()).href})).json(); await route.abort('failed');
  };
  await page.route('**/api/game-wallet/expansion',loseFirst);
  await page.locator('[data-np=spin]').click();
  await expect(page.locator('.np-reels')).toHaveCount(0);
  await page.waitForFunction(() => !!(window as any).neopolisPreview.client.pending && !(window as any).neopolisPreview.state().busy);
  const pendingId = await page.evaluate(() => (window as any).neopolisPreview.client.pending.id);
  await expect(page.locator('[data-np=spin]')).toHaveText(/Check move/);
  await page.unroute('**/api/game-wallet/expansion',loseFirst);
  const replay = await spin(page); expect(replay.id).toBe(pendingId); expect(replay).toEqual(original.session);
  const collected = (await state(page)).team;
  await page.getByRole('button', { name: 'Reopen game' }).click();
  await expect(page.locator('[data-np=spin]')).toBeEnabled(); expect((await state(page)).team).toEqual(collected);
  await expect(page.locator('[data-np=bet]')).toBeDisabled();
  let current = await session(page);
  for (let attempt = 0; current.state !== 'active' && attempt < 75; attempt++) current = await spin(page);
  expect(current.state).toBe('active'); expect(current.view.neopolis.battle.remaining).toBe(10);
  await page.screenshot({ path: 'test-results/neopolis/review/bonus-start-en.png', fullPage: true });
  await closeNotice(page);
  const battleId = current.id;
  const balanceBefore = await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance);
  current = await spin(page); expect(current.id).toBe(battleId); expect(current.spentUnits).toBe('10000');
  expect(await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance)).toBe(balanceBefore);
  const revision = current.view.neopolis.revision;
  await page.reload(); await expect(page.locator('[data-np=spin]')).toBeEnabled();
  expect((await state(page)).revision).toBe(revision);
  expect((await session(page)).id).toBe(battleId);
  while (current.state === 'active') { await closeNotice(page); current = await spin(page); }
  expect(current.view.neopolis.team.complete).toBe(true); expect(current.view.neopolis.revision).toBeLessThanOrEqual(46);
  const finalBalance = await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance);
  expect(finalBalance).toBeCloseTo(balanceBefore + Number(current.returnedUnits) / 100, 2);
  await closeNotice(page); await expect(page.locator('[data-np=bet]')).toBeEnabled();
  await page.locator('[data-hero=prism]').click(); expect((await state(page)).selected).toBe('prism');
  await page.screenshot({ path: 'test-results/neopolis/review/bonus-finished-en.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('real host opens published Dracona with connected chat on desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const hostApi = await apiRequest.newContext({ baseURL:test.info().project.use.baseURL });
  const auth = await hostApi.post('/api/auth/login', { data:{email:'neopolis-room-' + crypto.randomUUID() + '@example.test',password:'Neopolis-room-review-42!'} });
  expect(auth.ok()).toBe(true); await hostApi.post('/api/auth/character', {data:{skin:0}});
  const peer = await new Client('http://127.0.0.1:' + (process.env.NEOPOLIS_API_PORT || '2616'), { headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]}, fetchFn:async (url, options) => {
    const response = await hostApi.fetch(String(url), {method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
    return new globalThis.Response(await response.body(), {status:response.status(),headers:response.headers()});
  } }).create('lobby');
  for (const type of ['chat','activities','piano-note','notice']) peer.onMessage(type, () => {});
  try {
    await ready(page); expect((await page.request.post('/api/auth/character', {data:{skin:0}})).ok()).toBe(true);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto('/?lang=en&room=' + peer.roomId);
    await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});
    await page.waitForFunction(() => (window as any).royalDemo?.getState().online === true);
    await page.locator('#games-tab').click(); await page.locator('[data-cabinet=studio-dracona]').click();
    await page.locator('#mini-game [data-platform-game=studio-dracona]').click();
    const game=page.frameLocator('iframe.dracona-frame');
    await expect(game.locator('#spin')).toBeEnabled({timeout:45000});
    await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
    await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
    for(const [width,height] of [[1440,1000],[390,844]]) {
      await page.setViewportSize({width,height});
      await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();
      const layout=await page.locator('#mini-dialog').evaluate(root=>({width:root.clientWidth,scroll:root.scrollWidth}));
      expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);
      await expect(game.locator('#spin')).toBeVisible();
      await page.screenshot({path:'test-results/neopolis/review/dracona-host-'+width+'.png'});
    }
    await page.locator('#studio-game-list').click();
    await expect(page.locator('[data-platform-game=studio-neopolis]')).toHaveCount(0);
    await page.locator('[data-platform-game=studio-dracona]').click();
    await expect(page.frameLocator('iframe.dracona-frame').locator('#spin')).toBeEnabled();
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect(page.locator('#mini-dialog')).toBeHidden();
    await expect(page.locator('#club-chat-dock')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await peer.leave(); await hostApi.dispose(); }
});

test('Dracona displays fractional payouts and restores its complete bonus without another stake',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(entry+'?game=dracona&lang=ru');
  let game=page.frameLocator('iframe.dracona-frame');
  await expect(game.locator('#spin')).toBeEnabled();await game.locator('#speed').selectOption('turbo');
  const getSession=()=>page.evaluate(()=>(window as any).neopolisPreview.client.sessions.find((s:any)=>s.gameId==='studio-dracona'));
  const play=async()=>{
    if(await game.locator('#dialog').isVisible())await game.locator('#dialog-close').click();
    await game.locator('#spin').click();
    await page.waitForFunction(()=>!(window as any).neopolisPreview.state().busy);
    const s=await getSession();expect(s.rulesVersion).toBe(3);return s;
  };
  const before=await page.evaluate(()=>(window as any).neopolisPreview.wallet.wallet.balance);
  let current=await play();expect(current.state).toBe('active');expect(current.view.dracona.remaining).toBe(8);
  const balance=await page.evaluate(()=>(window as any).neopolisPreview.wallet.wallet.balance);
  expect(balance).toBe(before-100);
  current=await play();const revision=current.view.dracona.revision;
  await page.reload();game=page.frameLocator('iframe.dracona-frame');
  await expect(game.locator('#spin')).toBeEnabled();expect((await getSession()).view.dracona.revision).toBe(revision);
  await game.locator('#speed').selectOption('turbo');
  while(current.state==='active'){
    current=await play();expect(current.spentUnits).toBe('10000');
    if(current.state==='active')expect(await page.evaluate(()=>(window as any).neopolisPreview.wallet.wallet.balance)).toBe(balance);
  }
  expect(current.view.dracona.version).toBe(2);expect(current.view.dracona.freePlayed).toBeLessThanOrEqual(20);
  expect(await page.evaluate(()=>(window as any).neopolisPreview.wallet.wallet.balance)).toBeCloseTo(balance+Number(current.returnedUnits)/100,2);
  if(await game.locator('#dialog').isVisible())await game.locator('#dialog-close').click();
  await game.locator('#rules').click();await expect(game.locator('.rules-copy')).toContainText('1,24325');
  await expect(game.locator('.rules-copy')).toContainText('0,01');
});

test('reels move during the request, pause in rules, brake in order and respect fast mode on mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); await page.emulateMedia({ reducedMotion:'no-preference' });
  const observe = () => page.evaluate(() => {
    const board = document.querySelector('.np-board')!;
    const motion = { stops:[] as number[], duration:0, started:performance.now(), falling:0 };
    (window as any).npMotion = motion;
    new MutationObserver(records => {
      for (const record of records) {
        const element = record.target as HTMLElement;
        if (record.attributeName === 'data-phase' && element.dataset.phase === 'stopped') {
          const col = Array.from(board.querySelectorAll('.np-reel')).indexOf(element);
          if (col >= 0 && !motion.stops.includes(col)) motion.stops.push(col);
          if (motion.stops.length === 5) motion.duration = performance.now() - motion.started;
        }
        if (record.attributeName === 'data-falling' && element.dataset.falling === 'true') {
          motion.falling += Array.from(board.querySelectorAll<HTMLElement>('[role=gridcell]')).filter(cell => cell.style.transform.includes('-')).length;
        }
      }
    }).observe(board, {subtree:true,attributes:true,attributeFilter:['data-phase','data-falling']});
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/game-wallet/expansion', async route => {
    if (route.request().method() === 'POST') await held;
    await route.fallback();
  });
  try {
    await observe();
    const initial = await page.locator('.np-board [role=gridcell]').evaluateAll(cells => cells.map(cell => (cell as HTMLElement).dataset.symbol));
    await page.locator('[data-np=spin]').click();
    await expect(page.locator('.np-reel')).toHaveCount(5);
    const alignment = await page.locator('.np-board').evaluate(board => {
      const cell = board.querySelector('[role=gridcell]')!.getBoundingClientRect();
      const reel = board.querySelector('.np-reel')!.getBoundingClientRect();
      return Math.max(Math.abs(reel.x - cell.x), Math.abs(reel.y - cell.y), Math.abs(reel.width - cell.width));
    });
    expect(alignment).toBeLessThan(.5);
    await expect(page.locator('.np-board')).toHaveAttribute('aria-busy','true');
    const track = page.locator('.np-reel-track').first();
    const position = await track.evaluate(element => element.style.transform);
    await expect.poll(() => track.evaluate(element => element.style.transform)).not.toBe(position);
    expect(await page.locator('.np-board [role=gridcell]').evaluateAll(cells => cells.map(cell => (cell as HTMLElement).dataset.symbol))).toEqual(initial);
    await page.screenshot({path:'test-results/neopolis/review/reels-running-en.png'});
    await page.locator('[data-np=rules]').click();
    const paused = await track.evaluate(element => element.style.transform);
    await page.waitForTimeout(160);
    expect(await track.evaluate(element => element.style.transform)).toBe(paused);
    await page.locator('[data-np=close]').click();
    release();
    await page.waitForFunction(() => !(window as any).neopolisPreview.state().busy);
    await expect(page.locator('.np-reels')).toHaveCount(0);
    const normal = await page.evaluate(() => (window as any).npMotion);
    expect(normal.stops).toEqual([0,1,2,3,4]);
    const result = await session(page);
    expect(await page.locator('.np-board [role=gridcell]').evaluateAll(cells => cells.map(cell => Number((cell as HTMLElement).dataset.symbol)))).toEqual(result.view.neopolis.history.at(-1).result.grid);
    if (result.view.neopolis.history.at(-1).result.frames.some((frame: any) => frame.kind === 'cascade' || frame.hero === 'granite')) expect(normal.falling).toBeGreaterThan(0);
    await closeNotice(page);

    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-np=fast]').check();
    await observe();
    await spin(page); await closeNotice(page);
    const fast = await page.evaluate(() => (window as any).npMotion);
    expect(fast.stops).toEqual([0,1,2,3,4]);
    expect(fast.duration).toBeLessThan(normal.duration * .8);
    expect(await page.locator('.np').evaluate(root => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
    await expect(page.locator('.np-reels')).toHaveCount(0);
    await expect(page.locator('.np-board')).not.toHaveAttribute('aria-busy','true');
    expect(errors).toEqual([]);
  } finally { release(); await page.unroute('**/api/game-wallet/expansion'); }
});

test('closing during reel motion cancels presentation and reopening restores the single server result', async ({ page }) => {
  await ready(page); await page.emulateMedia({reducedMotion:'no-preference'});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let release!: () => void, confirmed: any, requests = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/game-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    requests++;
    const response = await route.fetch({url:new URL('/__test/neopolis/operate',route.request().url()).href}); confirmed = await response.json();
    await held; await route.fulfill({response});
  });
  try {
    await page.locator('[data-np=spin]').click();
    await expect(page.locator('.np-reels')).toHaveCount(1);
    await expect.poll(() => !!confirmed).toBe(true);
    await page.evaluate(() => (window as any).neopolisPreview.close());
    await expect(page.locator('.np')).toHaveCount(0);
    release();
    await page.waitForFunction(() => !(window as any).neopolisPreview.client.busy);
    await page.evaluate(() => (window as any).neopolisPreview.open());
    await expect(page.locator('[data-np=spin]')).toBeEnabled();
    await expect(page.locator('.np-reels')).toHaveCount(0);
    expect((await session(page)).id).toBe(confirmed.session.id);
    expect(await page.locator('.np-board [role=gridcell]').evaluateAll(cells => cells.map(cell => Number((cell as HTMLElement).dataset.symbol)))).toEqual(confirmed.session.view.neopolis.history.at(-1).result.grid);
    expect(requests).toBe(1); expect(errors).toEqual([]);
  } finally { release(); await page.unroute('**/api/game-wallet/expansion'); }
});

test('three real campaign bosses change arenas and costumes, survive reload and charge only the entry', async ({ page }) => {
  test.setTimeout(180000);
  await ready(page,'ru');
  const seen = new Set<number>();
  let current = await session(page), bonusBalance = 0, bonusId = '', moves = 0;
  for (let campaign = 0; campaign < 3 && !seen.has(2); campaign++) {
    while (current?.state !== 'active' && moves++ < 90) { await closeNotice(page); current = await spin(page); }
    expect(current?.state).toBe('active');
    bonusBalance = await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance); bonusId = current.id;
    while (current.state === 'active') {
      const battle = current.view.neopolis.battle, index = battle.boss;
      if (!seen.has(index)) {
        seen.add(index); await closeNotice(page);
        await expect(page.locator('.np')).toHaveAttribute('data-boss',['null','vespera','aeon'][index]);
        await expect(page.locator('[data-np=shield] i')).toHaveCount(index+3);
        await expect(page.locator('[data-np=core] i')).toHaveCount(index+3);
        expect(await page.locator('.np').evaluate(root => (root as HTMLElement).style.getPropertyValue('--np-costumes'))).toContain(['team-night','team-eclipse','team-chrono'][index]);
        const background = page.locator('.np-city-current');
        await expect(background).toHaveAttribute('src',new RegExp(['city-v2','citadel-v3','observatory-v3'][index]));
        await background.evaluate(image => (image as HTMLImageElement).decode());
        await page.screenshot({path:'test-results/neopolis/review/campaign-' + index + '-ru.png',fullPage:true});
        await page.setViewportSize({width:390,height:844});
        expect(await page.locator('.np').evaluate(root => root.scrollWidth <= root.clientWidth+1)).toBe(true);
        await page.screenshot({path:'test-results/neopolis/review/campaign-' + index + '-mobile-ru.png',fullPage:true});
        const revision = current.view.neopolis.revision;
        await page.reload(); await expect(page.locator('[data-np=spin]')).toBeEnabled();
        expect((await session(page)).id).toBe(bonusId); expect((await state(page)).revision).toBe(revision);
        expect((await state(page)).battle.boss).toBe(index);
        await page.setViewportSize({width:1440,height:1000});
      }
      await closeNotice(page); current = await spin(page);
      expect(current.id).toBe(bonusId); expect(current.spentUnits).toBe('10000');
      if (current.state === 'active') expect(await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance)).toBe(bonusBalance);
    }
    const final = await page.evaluate(() => (window as any).neopolisPreview.wallet.wallet.balance);
    expect(final).toBeCloseTo(bonusBalance+Number(current.returnedUnits)/100,2);
    await closeNotice(page);
  }
  expect([...seen].sort()).toEqual([0,1,2]);
});

test('original music and confirmed battle sounds honor shared mute, rules, host pause and disposal', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message));
  await ready(page); await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('[data-hero=granite]').click();
  await expect.poll(async () => (await state(page)).audio.playing).toBe(true);
  await expect.poll(async () => (await state(page)).audio.musicRms).toBeGreaterThan(.005);
  await page.evaluate(() => {
    (window as any).npFxSeen = false;
    const timer = setInterval(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.np-effects');
      if (!canvas) { clearInterval(timer); return; }
      if (canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((n,i) => i%4===3 && n>0)) (window as any).npFxSeen = true;
    },80);
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release=resolve; });
  await page.route('**/api/game-wallet/expansion',async route => { if (route.request().method()==='POST') await held; await route.fallback(); });
  try {
    await page.locator('[data-np=spin]').click();
    await expect(page.locator('.np-reels')).toHaveCount(1);
    const waiting = (await state(page)).audio.cues;
    expect(waiting.granite ?? 0).toBe(0); expect(waiting.impulse ?? 0).toBe(0); expect(waiting.prism ?? 0).toBe(0);
    await page.locator('[data-np=rules]').click();
    await expect.poll(async () => (await state(page)).audio.playing).toBe(false);
    await expect.poll(async () => (await state(page)).audio.voices).toBe(0);
    await page.locator('[data-np=close]').click(); release();
    await page.waitForFunction(() => !(window as any).neopolisPreview.state().busy);
    await closeNotice(page);
    await page.locator('[data-np=fast]').check();
    for(let i=0;i<5 && !(await state(page)).audio.cues.granite;i++) { await spin(page); await closeNotice(page); }
    expect((await state(page)).audio.cues.granite).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).npFxSeen)).toBe(true);
    await page.locator('[data-np=sound]').click();
    await expect(page.locator('[data-np=sound]')).toHaveAttribute('aria-pressed','false');
    await expect.poll(async () => (await state(page)).audio.playing).toBe(false);
    await expect.poll(async () => (await state(page)).audio.voices).toBe(0);
    await page.locator('[data-np=sound]').click();
    await expect.poll(async () => (await state(page)).audio.playing).toBe(true);
    await page.evaluate(async () => { const {gameAudio} = await import('/src/game/GameAudio.ts'); gameAudio.setVolume(0); });
    await expect.poll(async () => (await state(page)).audio.playing).toBe(false);
    await page.evaluate(async () => { const {gameAudio} = await import('/src/game/GameAudio.ts'); gameAudio.setVolume(.35); });
    await expect.poll(async () => (await state(page)).audio.playing).toBe(true);
    await page.evaluate(() => (window as any).neopolisPreview.pause());
    await expect.poll(async () => (await state(page)).audio.playing).toBe(false);
    await expect.poll(async () => (await state(page)).audio.voices).toBe(0);
    await page.evaluate(() => (window as any).neopolisPreview.resume());
    await expect.poll(async () => (await state(page)).audio.playing).toBe(true);
    await page.evaluate(() => (window as any).neopolisPreview.close());
    await expect(page.locator('.np-effects')).toHaveCount(0);
    await page.waitForTimeout(80);
    await page.evaluate(() => (window as any).neopolisPreview.open());
    await expect(page.locator('[data-np=spin]')).toBeEnabled();
    expect((await state(page)).audio.cues).toEqual({}); expect(errors).toEqual([]);
  } finally { release(); await page.unroute('**/api/game-wallet/expansion'); }
});

const feedbackState=(page:Page)=>page.evaluate(()=>(window as any).neopolisFeedbackReview.state());
async function feedbackReady(page:Page,language='en') {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/tests/fixtures/neopolis-feedback.html?lang='+language);
  await expect(page.locator('[data-review=reels]')).toBeVisible();
  await page.evaluate(async()=>{const image=new Image();image.src='/assets/neopolis/symbols-v2.webp';await image.decode();});
  await mkdir('test-results/neopolis/review',{recursive:true});
}

test('prepared combinations and cascades count exact units, pause and align audible and visual accents',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await feedbackReady(page);
  await page.locator('[data-review=combination]').click();
  await expect(page.locator('.np-award-visible')).toBeVisible();
  expect(await page.locator('.np-paying').count()).toBeGreaterThan(2);
  await expect(page.locator('.np-paylines polyline')).not.toHaveCount(0);
  await expect.poll(async()=>(await feedbackState(page)).feedback.shownUnits).toBeGreaterThan(1000);
  await page.locator('[data-review=pause]').click();
  const held=(await feedbackState(page)).feedback.shownUnits;
  await page.waitForTimeout(180);
  expect((await feedbackState(page)).feedback.shownUnits).toBe(held);
  await expect.poll(async()=>(await feedbackState(page)).audio.voices).toBe(0);
  await page.screenshot({path:'test-results/neopolis/review/feedback-combination-en.png'});
  await page.locator('[data-review=pause]').click();
  await expect.poll(async()=>(await feedbackState(page)).busy).toBe(false);
  expect((await feedbackState(page)).feedback.shownUnits).toBe(123450);
  await expect(page.locator('[data-review-amount]')).toHaveText('1,234.5');
  await page.locator('[data-review=cascade]').click();
  await expect(page.locator('.np-board')).toHaveAttribute('data-presentation','clear');
  await expect(page.locator('.np-board')).toHaveAttribute('data-falling','true');
  expect(await page.locator('.np-board [role=gridcell]').evaluateAll(cells=>cells.some(cell=>(cell as HTMLElement).style.transform.includes('-')))).toBe(true);
  await page.screenshot({path:'test-results/neopolis/review/feedback-falling-en.png'});
  await expect.poll(async()=>(await feedbackState(page)).busy).toBe(false);
  const audio=(await feedbackState(page)).audio,contacts=audio.accents.filter((value:any)=>value.cue==='land');
  expect(contacts.map((value:any)=>value.variant)).toEqual([0,1,2]);
  expect(audio.accents.some((value:any)=>value.cue==='clear')).toBe(true);
  expect(Math.max(...audio.accents.map((value:any)=>Math.abs(value.deltaMs)))).toBeLessThan(65);
  await expect(page.locator('.np-board [style*=translate]')).toHaveCount(0);
  // A real DelayNode plus a matching output timestamp models an additional device delay.
  await page.evaluate(()=>(window as any).neopolisFeedbackReview.setOutputDelay(180));
  await expect.poll(async()=>(await feedbackState(page)).audio.leadMs).toBeGreaterThan(170);
  await page.locator('[data-review=reels]').click();
  await expect.poll(async()=>(await feedbackState(page)).busy).toBe(false);
  const stops=(await feedbackState(page)).audio.accents.filter((value:any)=>value.cue==='stop');
  expect(stops.map((value:any)=>value.variant)).toEqual([0,1,2,3,4]);
  expect(stops.every((value:any)=>value.mode==='output-timestamp')).toBe(true);
  expect(Math.max(...stops.map((value:any)=>Math.abs(value.deltaMs)))).toBeLessThan(65);
  expect(errors).toEqual([]);
});

test('round celebrations use the paid stake, skip without another action and remain quiet on returns',async({page})=>{
  await feedbackReady(page,'ru');
  for(const [action,payout] of [['loss',0],['partial',4000],['even',10000]] as const) {
    await page.locator('[data-review='+action+']').click();
    await expect.poll(async()=>(await feedbackState(page)).feedback.round?.tier).toBe(action);
    await expect(page.locator('.np-result')).toBeHidden();
    expect((await feedbackState(page)).feedback.shownUnits).toBe(payout);
    expect(Object.keys((await feedbackState(page)).audio.cues).some(cue=>cue.startsWith('round-'))).toBe(false);
  }
  for(const [action,payout,title] of [['win',25000,'Победа!'],['big',150000,'Большая победа!'],['epic',300000,'Грандиозная победа!']] as const) {
    await page.locator('[data-review='+action+']').click();
    await expect(page.locator('.np-result')).toBeVisible();
    await expect(page.locator('.np-result h2')).toHaveText(title);
    await expect(page.locator('.np-result')).toHaveAttribute('data-revealed','true');
    if(action==='epic') {
      await page.setViewportSize({width:390,height:844});
      expect(await page.locator('.np').evaluate(root=>root.scrollWidth<=root.clientWidth+1)).toBe(true);
      await page.screenshot({path:'test-results/neopolis/review/feedback-epic-mobile-ru.png',fullPage:true});
    }
    if(action==='big') await page.screenshot({path:'test-results/neopolis/review/feedback-big-ru.png'});
    await page.locator('[data-result-skip]').click();
    await expect.poll(async()=>(await feedbackState(page)).busy).toBe(false);
    const result=(await feedbackState(page)).feedback;
    expect(result.round).toEqual({tier:action,payout,stake:10000,net:payout-10000});
    expect(result.shownUnits).toBe(payout);
    await expect(page.locator('.np-result')).toBeHidden();
  }
  await page.locator('[data-review=epic]').click();
  await expect(page.locator('.np-result')).toHaveAttribute('data-revealed','true');
  await page.locator('[data-review=cancel]').click();
  await expect(page.locator('.np-result')).toBeHidden();
  const count=(await feedbackState(page)).audio.cues['round-end']??0;
  await page.waitForTimeout(250);
  expect((await feedbackState(page)).audio.cues['round-end']??0).toBe(count);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-review=big]').click();
  await expect.poll(async()=>(await feedbackState(page)).busy).toBe(false);
  expect((await feedbackState(page)).feedback.shownUnits).toBe(150000);
  await expect(page.locator('.np-reels')).toHaveCount(0);
  await page.evaluate(()=>(window as any).neopolisFeedbackReview.destroy());
  await expect.poll(async()=>(await feedbackState(page)).audio.voices).toBe(0);
  expect((await feedbackState(page)).audio.playing).toBe(false);
});
