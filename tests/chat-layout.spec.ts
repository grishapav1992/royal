import {test,expect} from '@playwright/test';
import {Client} from '@colyseus/sdk';
test('persistent chat fits with the game and a reduced mobile viewport',async({page,request},testInfo)=>{
 const login=await request.post('/api/auth/login',{data:{email:`layout-host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie}}).create('lobby');host.onMessage('*',()=>{});
 try{
  const visitor=await page.request.post('/api/auth/login',{data:{email:`layout-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
  expect(visitor.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
  await page.goto('/?mode=club&room='+host.roomId+'&lang=ru');
  await expect(page.locator('#club-chat-dock')).toHaveAttribute('data-chat-hall','arcade',{timeout:30000});
  await expect(page.locator('#chat-input')).toBeEnabled();
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();
  // Reduce the viewport through the browser and measure the visible composer.
  await page.setViewportSize({width:390,height:420});
  await expect.poll(async () => {
    const input = await page.locator('#chat-input').boundingBox();
    return input ? input.y + input.height : Infinity;
  }).toBeLessThan(420);
  const game = (await page.locator('#game').boundingBox())!;
  const chat = (await page.locator('#chat-panel').boundingBox())!;
  expect(game.height).toBeGreaterThan(70);
  expect(game.y + game.height).toBeLessThanOrEqual(chat.y);
  await page.locator('#chat-input').fill('Чат открыт вместе с игрой');await page.locator('#send-chat').click();await expect(page.locator('#chat-log')).toContainText('Чат открыт вместе с игрой');
  await page.screenshot({path:testInfo.outputPath('chat-keyboard-viewport.png')});
  await page.setViewportSize({width:1366,height:768});await page.locator('#games-tab').click();await expect(page.locator('#chat-input')).toBeVisible();await expect(page.locator('.catalog-panel')).toBeVisible();await page.locator('#panel-close').click();await expect(page.locator('#chat-panel')).toBeVisible();
 }finally{await host.leave();await request.post('/api/auth/logout');}
});
