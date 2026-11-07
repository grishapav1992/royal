import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { OFFENSIVE_CHAT_BURST } from './security-room';

const state=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getState());
async function openGame(page:Page, info?: TestInfo){
  await page.bringToFront();
  await expect.poll(async()=>{
    if(await page.locator('#mini-dialog').isVisible())return true;
    const player = await state(page);
    if (player?.near === 'original-jackie-chan' && await page.locator('#interact').isVisible()) {
      await page.locator('#interact').click();
      return page.locator('#mini-dialog').isVisible();
    }
    if (player?.moving) return false;
    if(!await page.locator('[data-cabinet="original-jackie-chan"]').isVisible())await page.locator('#games-tab').click();
    await page.locator('[data-cabinet="original-jackie-chan"]').click();
    return page.locator('#mini-dialog').isVisible();
  },{timeout:60000,intervals:[1000,3000]}).toBe(true);
  await page.locator('[data-platform-game="royal-roulette"]').click();
  await expect(page.locator('[data-rr-spin]')).toBeVisible({timeout:20000});
  const dock=page.locator('#mini-dialog #club-chat-dock');
  if(!await dock.isVisible()){
    await page.locator('#mini-dialog .game-chat-toggle').click();
    await expect(dock).toBeVisible();
    if (info) await page.screenshot({path:info.outputPath('host-chat-mobile.png')});
    await dock.getByRole('button',{name:'Закрыть чат',exact:true}).click();
  }else await expect(dock).toBeVisible();
}
test.afterEach(async({page})=>{
  if(await page.locator('#mini-dialog').isVisible()){
    await page.locator('#mini-dialog .mini-top [data-close]').click();
    await expect.poll(async()=>(await state(page)).cabinet).toBe('');
  }
});
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  test(`settings recover an occupied cabinet and preserve a lost paid reply at ${viewport.width}px`,async({page},info)=>{
    await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const login=await page.request.post('/api/auth/login',{data:{email:`recovery-${crypto.randomUUID()}@example.test`,password:'Recovery-local-123!'}});
    expect(login.ok()).toBe(true);await login.json();
    await page.request.post('/api/auth/character',{data:{skin:0}});
    const funded=await page.request.post('/__test/recovery/fund');expect(funded.ok(),await funded.text()).toBe(true);
    await page.goto('/?mode=club&lang=ru',{waitUntil:'domcontentloaded'});await expect(page.locator('#loading')).toHaveCount(0);await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
    await expect.poll(async()=>(await state(page)).online).toBe(true);
    await expect(page.locator('#recover-player')).toBeHidden();
    await openGame(page,info);
    await expect.poll(async()=>(await state(page)).cabinet).toBe('original-jackie-chan');
    let operation:any,first:any;
    await page.route('**/api/demo-wallet/operations',async route=>{
      operation=route.request().postDataJSON();const accepted=await route.fetch();expect(accepted.ok()).toBe(true);first=await accepted.json();await route.abort('failed');
    },{times:1});
    await page.locator('[data-rr-spin]').click();
    await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат');
    await page.locator('#mini-dialog .settings-shortcut').click();
    await expect(page.locator('#name-dialog')).toBeVisible();
    await page.locator('#recover-player').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('settings.png')});
    await page.locator('#recover-player').click();
    await expect(page.locator('#name-dialog')).toBeHidden();await expect(page.locator('#mini-dialog')).toBeHidden();
    await expect.poll(async()=>{const s=await state(page);return !s.playing&&!s.seat&&!s.cabinet&&s.y<1300;}).toBe(true);
    const before=await state(page);await page.locator('#game').focus();await page.keyboard.down('ArrowRight');
    await expect.poll(async()=>(await state(page)).x).toBeGreaterThan(before.x+20);await page.keyboard.up('ArrowRight');
    await page.screenshot({path:info.outputPath('recovered.png')});
    await openGame(page,info);await expect(page.locator('[data-rr-spin]')).toHaveAccessibleName('Проверить результат');
    const replay=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');
    await page.locator('[data-rr-spin]').click();const response=await replay;expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().id).toBe(operation.id);
    const restored=await response.json();expect(restored.gameRound).toEqual(first.gameRound);expect(restored.wallet.balance).toBe(first.wallet.balance);
    expect(restored.wallet.entries.filter((e:any)=>e.kind==='bet')).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test('guard capture closes an occupied paid game and reentry recovers the accepted operation', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: {
    email: `recovery-guard-${crypto.randomUUID()}@example.test`, password: 'Recovery-local-123!',
  } });
  expect(login.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character', { data: { skin: 0 } })).ok()).toBe(true);
  expect((await page.request.post('/__test/recovery/fund')).ok()).toBe(true);
  await page.goto('/?mode=club&lang=ru');
  await expect(page.locator('#chat-input')).toBeEnabled({ timeout: 30000 });
  await openGame(page);

  let accepted: { wallet: { balance: number }; gameRound: unknown } | undefined;
  let originalId: string | undefined;
  await page.route('**/api/demo-wallet/operations', async route => {
    originalId = route.request().postDataJSON().id;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    accepted = await response.json();
    await route.abort('failed');
  }, { times: 1 });
  const spin = page.locator('[data-rr-spin]');
  await spin.click();
  await expect(spin).toHaveAccessibleName('Проверить результат');
  expect(accepted?.gameRound).toBeTruthy();
  expect(originalId).toBeTruthy();

  await page.locator('#chat-input').fill(OFFENSIVE_CHAT_BURST);
  await page.locator('#send-chat').click();
  await expect(page.locator('#mini-dialog')).toBeHidden({ timeout: 45000 });
  await expect(page.locator('#club-chat-dock')).toHaveAttribute('data-chat-unavailable', '', { timeout: 30000 });
  await expect.poll(async () => (await state(page)).cabinet).toBe('');
  await page.locator('#club-fine-open').click();
  await expect(page.locator('#club-fine-quote')).toHaveText('К оплате 10 виртуальных USDT');
  await page.locator('#club-fine-pay').click();
  await expect(page.locator('#club-fine-status')).toHaveText('Штраф оплачен.');
  await page.locator('#club-fine-close').click();
  await page.locator('[data-floor-target="arcade"]').click();
  await expect(page.locator('#club-chat-dock')).toHaveAttribute('data-chat-hall', 'arcade', { timeout: 30000 });
  await openGame(page);

  await expect(spin).toHaveAccessibleName('Проверить результат');
  const replay = page.waitForResponse(response => response.url().endsWith('/api/demo-wallet/operations') && response.request().method() === 'POST');
  await spin.click();
  const response = await replay;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().id).toBe(originalId);
  const restored = await response.json();
  expect(restored.gameRound).toEqual(accepted!.gameRound);
  expect(restored.wallet.balance).toBeCloseTo(accepted!.wallet.balance - 10, 2);
  expect(restored.wallet.entries.filter((entry: { operationId: string; kind: string }) => entry.operationId === originalId && entry.kind === 'bet')).toHaveLength(1);
});
