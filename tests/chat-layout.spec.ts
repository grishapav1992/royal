import {test,expect} from '@playwright/test';
import {Client} from '@colyseus/sdk';
test('persistent chat fits with the game and a reduced mobile viewport',async({page,request})=>{
 const login=await request.post('/api/auth/login',{data:{email:`layout-host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie}}).create('lobby');for(const type of ['chat','activities'])host.onMessage(type,()=>{});
 try{
  await page.goto('/?room='+host.roomId);await page.getByLabel('Почта',{exact:true}).fill(`layout-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill('Royal-test-123!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await expect(page.locator('#join-dialog')).toBeHidden();
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#chat-input')).toBeInViewport();
  // VisualViewport changes app height when a mobile keyboard covers the screen.
  await page.evaluate(()=>document.documentElement.style.setProperty('--app-height','420px'));await page.waitForTimeout(250);
  const game=(await page.locator('#game').boundingBox())!,chat=(await page.locator('#chat-panel').boundingBox())!,input=(await page.locator('#chat-input').boundingBox())!;
  expect(game.height).toBeGreaterThan(70);expect(game.y+game.height).toBeLessThanOrEqual(chat.y);expect(input.y+input.height).toBeLessThan(420);
  await page.locator('#chat-input').fill('Чат открыт вместе с игрой');await page.locator('#send-chat').click();await expect(page.locator('#chat-log')).toContainText('Чат открыт вместе с игрой');
  await page.screenshot({path:'artifacts/chat-keyboard-viewport.png'});
  await page.evaluate(()=>document.documentElement.style.removeProperty('--app-height'));await page.setViewportSize({width:1366,height:768});await page.locator('#games-tab').click();await expect(page.locator('#chat-input')).toBeVisible();await expect(page.locator('.catalog-panel')).toBeVisible();await page.locator('#panel-close').click();await expect(page.locator('#chat-panel')).toBeVisible();
 }finally{await host.leave();await request.post('/api/auth/logout');}
});
