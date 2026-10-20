import {showChat} from './room-ui';
import {test,expect,type Page} from '@playwright/test';
const net = (p: Page) => p.evaluate(() => (window as any).royalDemo.getNetworkState());
const state = (p: Page) => p.evaluate(() => (window as any).royalDemo.getState());
async function enter(p: Page, name: string, url = '/') {
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.getByLabel('Почта',{exact:true}).fill('name-'+crypto.randomUUID()+'@example.test');
  await p.getByLabel('Пароль',{exact:true}).fill('Royal-name-123!');
  await p.getByRole('button',{name:'Продолжить',exact:true}).click();
  await p.getByLabel('Игровое имя',{exact:true}).fill(name);
  await expect(p.locator('#character-step')).toBeVisible();
  await p.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(p.locator('#join-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await net(p)).status).toBe('connected');
}

test('custom name persists and can be changed live for other players and chat', async({browser})=>{
  const ca=await browser.newContext(),cb=await browser.newContext();
  try {
    const a=await ca.newPage(),b=await cb.newPage();
    await enter(a,'  Лунный кот 🎮  ');
    await expect(a.locator('.profile-name')).toContainText('Лунный кот 🎮');
    await enter(b,'Наблюдатель','/?room='+(await net(a)).roomId);
    await expect(b.locator('#people-list')).toContainText('Лунный кот 🎮');
    const initial=await state(a), initialNet=await net(a);
    await a.getByRole('button',{name:'Настройки игрока',exact:true}).click();
    await a.getByLabel('Новое игровое имя',{exact:true}).fill('');
    await a.getByLabel('Новое игровое имя',{exact:true}).pressSequentially('wasd');
    expect((await state(a)).x).toBeCloseTo(initial.x,0);
    expect((await state(a)).y).toBeCloseTo(initial.y,0);
    await a.getByLabel('Новое игровое имя',{exact:true}).fill('x'.repeat(25));
    await a.getByRole('button',{name:'Сохранить настройки',exact:true}).click();
    await expect(a.locator('#name-error')).toContainText('24');
    await expect(b.locator('#people-list')).toContainText('Лунный кот 🎮');
    await a.getByLabel('Новое игровое имя',{exact:true}).fill('<b>Маша ★</b>');
    await a.locator('#settings-character-selection').getByRole('button',{name:'Майлз',exact:true}).click();
    await a.getByRole('button',{name:'Сохранить настройки',exact:true}).click();
    await expect(a.locator('#name-dialog')).not.toBeVisible();
    await expect.poll(async()=>(await state(a)).skin).toBe(7);
    await expect.poll(async()=>(await state(b)).remotePositions.find((p:any)=>p.id===initialNet.selfId)?.skin).toBe(7);
    expect((await net(a)).selfId).toBe(initialNet.selfId);
    await expect(b.locator('#people-list')).toContainText('<b>Маша ★</b>');
    await expect(b.locator('#people-list b')).toHaveCount(0);
    await showChat(a);await a.getByLabel('Сообщение в общий чат').fill('Проверка нового имени');await a.keyboard.press('Enter');
    await expect(b.locator('.chat-message').filter({hasText:'Проверка нового имени'}).locator('.chat-meta strong')).toHaveText('<b>Маша ★</b>');
    const account=(await ca.request.get('/api/auth/me').then(r=>r.json())).account;
    expect(account.name).toBe('<b>Маша ★</b>');
    await a.reload({waitUntil:'domcontentloaded'});
    await expect.poll(async()=>(await net(a)).status).toBe('connected');
    await expect(a.locator('#join-dialog')).not.toBeVisible();
    await expect(a.locator('.profile-name')).toContainText('<b>Маша ★</b>');
    await expect.poll(async()=>(await state(a)).skin).toBe(7);
    expect((await ca.request.post('/api/auth/profile',{data:{name:''}})).status()).toBe(400);
    expect((await ca.request.post('/api/auth/profile',{headers:{Origin:'https://other.example'},data:{name:'Чужой'}})).status()).toBe(403);
    await ca.request.post('/api/auth/logout');
    expect((await ca.request.post('/api/auth/profile',{data:{name:'Чужой'}})).status()).toBe(401);
  } finally {await ca.close();await cb.close();}
});

test('mobile name editor fits and cancel keeps saved name',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const page=await context.newPage();await enter(page,'Космический странник');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'Настройки игрока',exact:true}).tap();
    await page.getByLabel('Новое игровое имя',{exact:true}).fill('Другой ник');
    await page.locator('#settings-character-selection').getByRole('button',{name:'Гас',exact:true}).tap();
    await page.screenshot({path:'artifacts/name-editor-mobile.png'});
    await page.getByRole('button',{name:'Отмена',exact:true}).tap();
    await expect(page.locator('#people-list')).toContainText('Космический странник');
    expect((await state(page)).skin).toBe(0);
    await page.getByRole('button',{name:'Настройки игрока',exact:true}).tap();
    await expect(page.locator('#settings-character-selection').getByRole('button',{name:'Эдди',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.keyboard.press('Escape');
    await expect.poll(async()=>(await state(page)).locked).toBe(false);
  }finally{await context.close();}
});
