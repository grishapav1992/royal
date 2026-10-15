import { test, expect } from '@playwright/test';
import { selectHall } from './room-ui';

for (const viewport of [{width:1440,height:1000},{width:667,height:375},{width:568,height:320},{width:390,height:844}]) {
  test(`Mira keeps the answer and drinks accessible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/npc/mira', route => route.fulfill({ json: {
      reply: 'Вино? Решай сам.', turns: [{ role: 'assistant', content: 'Вино? Решай сам.' }], drinkOffer: 'wine', emotion: 'tease',
    } }));
    await page.goto('/?offline=1');
    await page.locator('#loading').waitFor({state:'detached'});
    await page.locator('#visit-bar').click();
    await expect(page.locator('#bar-dialog')).toBeVisible({timeout:15000});
    const answer = page.getByRole('textbox',{name:'Твоя реплика Мире'});
    await expect(answer).toBeVisible();
    const answerBounds = (await answer.boundingBox())!;
    const dialogBounds = (await page.locator('#bar-dialog').boundingBox())!;
    expect(answerBounds.y+answerBounds.height).toBeLessThanOrEqual(dialogBounds.y+dialogBounds.height);
    expect(answerBounds.y+answerBounds.height).toBeLessThanOrEqual(viewport.height);
    await answer.fill('Пока просто поговорим');
    await page.getByRole('button',{name:'Сказать',exact:true}).click();
    await expect(page.locator('.mira-log')).toContainText('Вино? Решай сам.');
    await page.getByRole('button',{name:'Напитки',exact:true}).click();
    await page.getByRole('button',{name:'Выпить: Виски',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().intoxication.stage)).toBe(2);
    await expect(page.locator('.mira-player')).toHaveClass(/is-drinking/);
    await page.screenshot({path:`artifacts/mira-intoxication-${viewport.width}x${viewport.height}.png`});
  });
}

test('an old Mira dialogue cannot animate a rejected drink after logging in elsewhere', async ({ page }) => {
  const request = page.context().request, password = 'Synthetic-mira-check-123';
  const email = `mira-order-${crypto.randomUUID()}@example.test`;
  expect((await request.post('/api/auth/login',{data:{email,password}})).ok()).toBe(true);
  expect((await request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
  await page.route('**/api/npc/mira', route => route.fulfill({json:{reply:'Решай сам.',turns:[],emotion:'neutral'}}));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState()?.status)).toBe('connected');
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await page.locator('#email').fill(`mira-order-new-${crypto.randomUUID()}@example.test`);
  await page.locator('#password').fill(password);
  await page.locator('#login-button').click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.locator('#join-button').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState()?.status)).toBe('connected');
  await expect(page.locator('#bar-dialog')).toBeVisible();
  await page.getByRole('button',{name:'Напитки',exact:true}).click();
  await page.getByRole('button',{name:'Выпить: Виски',exact:true}).click();
  await page.waitForTimeout(800);
  await expect(page.locator('.mira-player')).not.toHaveClass(/is-drinking/);
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().intoxication.stage)).toBe(0);
  await page.getByRole('button',{name:'Разговор',exact:true}).click();
  await page.locator('#chat-input').fill('Проверка общего чата при открытой Мире');
  await page.locator('#send-chat').click();
  await expect(page.locator('#chat-log')).toContainText('Проверка общего чата при открытой Мире');
  await request.post('/api/auth/logout');
});

test('maximum intoxication persists offline', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/npc/mira', route => route.fulfill({json:{reply:'Решай сам.',turns:[],emotion:'neutral'}}));
  await page.goto('/?offline=1');
  await page.locator('#loading').waitFor({state:'detached'});
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Напитки',exact:true}).click();
  const whisky = page.getByRole('button',{name:'Выпить: Виски',exact:true});
  for (let i=0;i<3;i++) { await expect(whisky).toBeEnabled({timeout:5000}); await whisky.click(); await expect(whisky).toBeDisabled(); }
  const consumed = await page.evaluate(()=>(window as any).royalDemo.getState());
  expect(consumed.intoxication.stage).toBe(3);
  expect(consumed.intoxication.remainingMs).toBeLessThanOrEqual(30*60*1000);
  await page.reload();
  await page.locator('#loading').waitFor({state:'detached'});
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().soberAt)).toBe(consumed.soberAt);
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().intoxication.stage)).toBe(3);
});

test('the current chess game accepts a strongly intoxicated player', async ({ page }) => {
  test.setTimeout(70000);
  const request = page.context().request;
  expect((await request.post('/api/auth/login',{data:{email:`mira-chess-${crypto.randomUUID()}@example.test`,password:'Synthetic-mira-check-123'}})).ok()).toBe(true);
  expect((await request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
  await page.route('**/api/npc/mira', route => route.fulfill({json:{reply:'Решай сам.',turns:[],emotion:'neutral'}}));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState()?.status)).toBe('connected');
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Напитки',exact:true}).click();
  const whisky = page.getByRole('button',{name:'Выпить: Виски',exact:true});
  for (let i=0;i<3;i++) { await expect(whisky).toBeEnabled({timeout:5000}); await whisky.click(); await expect(whisky).toBeDisabled(); }
  await page.getByRole('button',{name:'Уйти',exact:true}).click();
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getNetworkState()?.status)).toBe('connected');
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().intoxication.stage)).toBe(3);
  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'Уйти',exact:true}).click();
  await selectHall(page,'tables');
  await page.locator('#games-tab').click();
  await page.locator('[data-activity="chess"]').click();
  await expect(page.locator('#shared-dialog')).toBeVisible({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getActivities().chess.players.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().intoxication.stage)).toBe(3);
  await request.post('/api/auth/logout');
});
