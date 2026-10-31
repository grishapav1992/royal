import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill('progression-player-' + crypto.randomUUID() + '@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('Progression-host-test-42!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 25000 });
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().online)).toBe(true);
  await expect(page.locator('#progression-button')).toHaveText('Уровень 1');
}
async function unlock(page: Page) {
  const funding = await page.request.post('/__test/progression/fund'); expect(funding.ok()).toBe(true);
  const result = await page.evaluate(async () => {
    const { account } = await (await fetch('/api/auth/me')).json();
    const headers = { 'Content-Type': 'application/json', 'X-Royal-Account-Id': account.id };
    for (let i = 0; i < 2; i++) {
      const response = await fetch('/api/demo-wallet/operations', { method: 'POST', headers,
        body: JSON.stringify({ id: crypto.randomUUID(), kind: 'play', amount: 500, gameId: 'royal-coins', rulesVersion: 1, input: {} }) });
      if (!response.ok) throw Error(await response.text());
    }
    return (await fetch('/api/progression', { headers })).json();
  });
  expect(result.level).toBeGreaterThanOrEqual(10); expect(result.grants).toHaveLength(2); return result;
}
async function open(page: Page) {
  await page.locator('#progression-button').click();
  await expect(page.locator('#progression-dialog')).toBeVisible();
  await expect(page.locator('[data-progression-roadmap] button')).toHaveCount(100);
  await expect(page.locator('#progression-dialog #club-chat-dock')).toBeVisible();
  await expect(page.locator('#chat-input')).toBeInViewport();
}

test('the real host keeps local levels, shared free-spin packs and chat usable on desktop and mobile', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enter(page); const before = await unlock(page); await open(page);
  await expect(page.locator('[data-progression-current-level]')).toHaveText(String(before.level));
  await expect(page.locator('[data-progression-location]')).toHaveText('Южный парк');
  await page.locator('[data-progression-level="100"]').click();
  await expect(page.locator('[data-progression-detail]')).toContainText('Уровень 100');
  await page.locator('[data-progression-tab="rewards"]').click();
  await expect(page.locator('.progression-grant')).toHaveCount(4);
  await expect(page.locator('.progression-skin-grant')).toHaveCount(2);
  await expect(page.locator('.progression-grant').first()).toContainText('Royal Coins');
  const response = page.waitForResponse(reply => reply.url().endsWith('/api/progression/spins') && reply.request().method() === 'POST');
  await page.locator('[data-progression-grant]').first().click(); const accepted = await response; expect(accepted.ok()).toBe(true);
  const receipt = await accepted.json();
  await expect(page.locator('.progression-symbols span')).toHaveCount(3);
  await expect(page.locator('[data-progression-result]')).toContainText('XP не начисляется');
  const after = await page.evaluate(async () => {
    const { account } = await (await fetch('/api/auth/me')).json();
    return (await fetch('/api/progression', { headers: { 'X-Royal-Account-Id': account.id } })).json();
  });
  expect(after.xp).toBe(before.xp); expect(after.grants[0].remaining).toBe(before.grants[0].remaining - 1);
  await expect(page.locator('.progression-payout')).toContainText('USDT');
  expect(receipt.gameRound.gameId).toBe('royal-coins');
  await page.screenshot({ path: info.outputPath('desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#chat-input')).toBeInViewport();
  expect(await page.locator('.progression-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.locator('[data-progression-grant]').nth(1).scrollIntoViewIfNeeded();
  await expect(page.locator('[data-progression-grant]').nth(1)).toBeInViewport();
  await page.screenshot({ path: info.outputPath('mobile.png') });
  await page.locator('[data-progression-close]').click();
  await expect(page.locator('.workspace > #club-chat-dock')).toBeVisible();
  await expect(page.locator('#progression-button')).toBeInViewport();
  const header = await page.locator('.header').evaluate(element => element.scrollWidth <= element.clientWidth + 1); expect(header).toBe(true);
  expect(errors).toEqual([]);
});

test('a lost accepted reward survives reload and replays its original operation without another spin or payout', async ({ page }) => {
  await enter(page); await unlock(page); await open(page); await page.locator('[data-progression-tab="rewards"]').click();
  let original: any, saved: any;
  await page.route('**/api/progression/spins', async route => {
    original = route.request().postDataJSON(); const response = await route.fetch(); expect(response.ok()).toBe(true);
    saved = await response.json(); await route.abort('failed');
  }, { times: 1 });
  await page.locator('[data-progression-grant]').first().click();
  await expect(page.locator('[data-progression-retry]')).toBeVisible();
  await expect(page.locator('[data-progression-retry]')).toBeEnabled();
  await page.reload(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 25000 }); await open(page);
  const response = page.waitForResponse(reply => reply.url().endsWith('/api/progression/spins') && reply.request().method() === 'POST');
  await page.locator('[data-progression-retry]').click(); const retried = await response; expect(retried.request().postDataJSON()).toEqual(original);
  const receipt = await retried.json(); expect(receipt.replayed).toBe(true); expect(receipt.gameRound).toEqual(saved.gameRound);
  expect(receipt.wallet.balance).toBe(saved.wallet.balance); expect(receipt.remaining).toBe(saved.remaining);
  await expect(page.locator('[data-progression-retry]')).toBeHidden();
});

test('the same location track and shared rewards are fully translated in English', async ({ page }) => {
  await enter(page); await unlock(page);
  await page.getByRole('combobox', { name: 'Язык', exact: true }).selectOption('en');
  await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 25000 }); await open(page);
  await expect(page.locator('#progression-title')).toHaveText('Location levels');
  await expect(page.locator('[data-progression-location]')).toHaveText('South Park');
  await page.locator('[data-progression-tab="rewards"]').click();
  await expect(page.locator('.progression-grant')).toHaveCount(4);
  await expect(page.locator('#progression-dialog .game-chat-game')).not.toContainText(/[А-Яа-яЁё]/);
});

test('a level reward opens the real atelier, recovers a lost accepted request and creates two choices without a cash debit',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await enter(page);const before=await unlock(page);await open(page);await page.locator('[data-progression-tab="rewards"]').click();
  await page.locator('[data-progression-atelier]').first().click();await expect(page.locator('#skin-studio-dialog')).toBeVisible();
  await expect(page.locator('.skin-free-generations')).toContainText('2');await expect(page.locator('.skin-generate-slot button')).toHaveText('Создать бесплатно');
  const wallet=await page.evaluate(async()=>{const {account}=await(await fetch('/api/auth/me')).json();return(await fetch('/api/demo-wallet',{headers:{'X-Royal-Account-Id':account.id}})).json();});
  let accepted:any;
  await page.route('**/api/skin-studio/generations',async route=>{accepted=route.request().postDataJSON();const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');},{times:1});
  await page.locator('#skin-prompt').fill('Космонавт в красном костюме');await page.locator('.skin-generate-slot button').click();
  await expect.poll(()=>accepted?.rewardGrantId).toBe(before.skinGrants[0].id);await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:25000});
  await page.getByRole('button',{name:'Образы',exact:true}).click();
  await expect(page.locator('#skin-studio-dialog .skin-results')).toBeVisible({timeout:25000});
  await expect(page.locator('[data-select-skin]')).toHaveCount(2);
  const state=await page.evaluate(async()=>{const {account}=await(await fetch('/api/auth/me')).json();const headers={'X-Royal-Account-Id':account.id};return {progression:await(await fetch('/api/progression',{headers})).json(),wallet:await(await fetch('/api/demo-wallet',{headers})).json(),atelier:await(await fetch('/api/skin-studio',{headers})).json()};});
  expect(state.atelier.job.id).toBe(accepted.id);expect(state.atelier.job.funding).toBe('reward');expect(state.wallet.balance).toBe(wallet.balance);
  expect(state.progression.xp).toBe(before.xp);expect(state.progression.skinGrants[0].remaining).toBe(0);expect(state.progression.skinGrants[1].remaining).toBe(1);
  await page.locator('[data-select-skin]').first().click();await page.getByRole('button',{name:'Сохранить образ',exact:true}).click();
  await expect(page.locator('.skin-closet-grid [data-skin-card]')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});expect(await page.locator('#skin-studio-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('free-generation-mobile.png')});expect(errors).toEqual([]);
});

async function openSlot(page: Page, game: 'royal-coins' | 'royal-fruits') {
  await page.emulateMedia({reducedMotion:'reduce'});
  if (!await page.locator('#mini-dialog').isVisible()) {
    if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
    if((await page.evaluate(()=>(window as any).royalDemo.getState())).x<1100){const point=await worldPoint(page,1100,900);await page.mouse.click(point.x,point.y);
      await expect.poll(async()=>{const state=await page.evaluate(()=>(window as any).royalDemo.getState());return Math.hypot(state.x-1100,state.y-900);},{timeout:25000}).toBeLessThan(30);}
    await page.locator('#games-tab').click();
    await page.locator('[data-cabinet="studio-cosmic-escape"]').click();
    await expect(page.locator('#mini-dialog')).toBeVisible({timeout:30000});
  }
  if(!await page.locator('#mini-game .royal-platform').isVisible())await page.locator('#studio-game-list').click();
  await page.locator('[data-platform-game="'+game+'"]').click();
  await expect(page.locator('#mini-game')).toHaveAttribute('data-game-module-id',game,{timeout:25000});
  await expect(page.locator('[data-reward-mode]')).toBeVisible();
}
async function current(page:Page) {
  return page.evaluate(async()=>{const {account}=await(await fetch('/api/auth/me')).json();const headers={'X-Royal-Account-Id':account.id};
    return {progression:await(await fetch('/api/progression',{headers})).json(),wallet:await(await fetch('/api/demo-wallet',{headers})).json()};});
}
async function freeSpin(page:Page, game:'royal-coins'|'royal-fruits') {
  const selector=game==='royal-coins'?'#coins-spin':'[data-fruits-spin]';
  await expect(page.locator(selector)).toBeEnabled();
  const received=page.waitForResponse(r=>r.url().endsWith('/api/progression/spins')&&r.request().method()==='POST');
  await page.locator(selector).click();const response=await received;expect(response.ok()).toBe(true);
  const result=await response.json();expect(result.gameRound.gameId).toBe(game);
  if(game==='royal-coins')await expect(page.locator('.royal-coins')).not.toHaveClass(/spinning/);
  else await expect(page.locator('.fruits-slot')).toHaveAttribute('data-phase','result');
  return result;
}

test('ordinary Coins and Fruits windows spend one shared packet, stop at zero and retain another nominal',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await enter(page);const earned=await unlock(page);const before=await current(page);let payout=0;
  await openSlot(page,'royal-coins');await page.locator('[data-reward-mode]').selectOption('500000');
  await expect(page.locator('[data-reward-remaining]')).toContainText('5');
  for(let i=0;i<3;i++){const result=await freeSpin(page,'royal-coins');payout+=Number(result.gameRound.payoutUnits);}
  await openSlot(page,'royal-fruits');await expect(page.locator('[data-reward-mode]')).toHaveValue('500000');
  await expect(page.locator('[data-reward-remaining]')).toContainText('2');
  await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
  for(let i=0;i<2;i++){const result=await freeSpin(page,'royal-fruits');payout+=Number(result.gameRound.payoutUnits);}
  await expect(page.locator('[data-fruits-spin]')).toBeDisabled();
  await expect(page.locator('[data-reward-mode]')).toHaveValue('500000');
  await expect(page.locator('[data-reward-remaining]')).toContainText('закончились');
  const after=await current(page);expect(after.progression.xp).toBe(earned.xp);
  expect(after.progression.grants[0].remaining).toBe(0);expect(after.progression.grants[1].remaining).toBe(5);
  expect(Math.round(after.wallet.balance*100)).toBe(Math.round(before.wallet.balance*100)+payout);
  await page.screenshot({path:info.outputPath('shared-spins-desktop.png')});
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();
  expect(await page.locator('.fruits-slot').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('shared-spins-mobile.png')});
  await page.locator('[data-reward-mode]').selectOption('1000000');await expect(page.locator('[data-fruits-spin]')).toBeEnabled();
  await page.locator('[data-reward-mode]').selectOption('');await expect(page.locator('[data-fruits-stake]')).toHaveValue('1000');
  await expect(page.locator('[data-fruits-spin]')).toHaveText('ВРАЩАТЬ');await page.locator('#mini-dialog .mini-top [data-close]').click();await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().cabinet)).toBe('');expect(errors).toEqual([]);
});

test('a lost normal-window spin blocks another game and recovers the same game and UUID after reload',async({page})=>{
  await enter(page);await unlock(page);await openSlot(page,'royal-coins');await page.locator('[data-reward-mode]').selectOption('500000');
  let original:any,accepted:any;
  await page.route('**/api/progression/spins',async route=>{original=route.request().postDataJSON();const response=await route.fetch();expect(response.ok()).toBe(true);accepted=await response.json();await route.abort('failed');},{times:1});
  await page.locator('#coins-spin').click();await expect(page.locator('#coins-spin')).toHaveText('Проверить бесплатный спин');
  await expect(page.locator('#coins-spin')).toBeEnabled();await openSlot(page,'royal-fruits');await expect(page.locator('[data-fruits-spin]')).toBeDisabled();
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:25000});await openSlot(page,'royal-coins');
  const received=page.waitForResponse(r=>r.url().endsWith('/api/progression/spins')&&r.request().method()==='POST');
  await page.locator('#coins-spin').click();const response=await received;expect(response.request().postDataJSON()).toEqual(original);
  const replay=await response.json();expect(replay.replayed).toBe(true);expect(replay.gameRound).toEqual(accepted.gameRound);
  expect(replay.remaining).toBe(4);await expect(page.locator('#coins-result')).toContainText('Деньги не списаны');
  await page.locator('#mini-dialog .mini-top [data-close]').click();await openSlot(page,'royal-coins');
  await expect(page.locator('[data-reward-remaining]')).toContainText('4');
});

async function worldPoint(page:Page,x:number,y:number){
  await page.bringToFront();await page.evaluate(()=>document.fonts.ready);
  const box=(await page.locator('#game canvas').boundingBox())!;
  const {view}=await page.evaluate(()=>(window as any).royalDemo.getState());
  return {x:box.x+(x-view.x)*view.zoom*box.width/view.width,y:box.y+(y-view.y)*view.zoom*box.height/view.height};
}
