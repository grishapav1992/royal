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

test('the real host keeps local levels, fixed free-spin packs and chat usable on desktop and mobile', async ({ page }, info) => {
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

test('the same location track and fixed rewards are fully translated in English', async ({ page }) => {
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
