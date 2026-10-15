import { test,expect,type Page } from '@playwright/test';
import {selectHall,worldPoint} from './room-ui';

const games=[
  {id:'capro-mines',slug:'mines',name:'Mines',category:'INSTANT',minBet:'0.10',maxBet:'100.00'},
  {id:'capro-slots',slug:'slots',name:'Royal Slots',category:'SLOTS',minBet:'1.00',maxBet:'100.00'},
];
async function login(page:Page) {
  await page.goto('/');
  await page.getByLabel('Почта',{exact:true}).fill(`capro-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Capro-test-password!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
}
async function openCabinet(page:Page) {
  await page.locator('#casinoapipro-open').click();
  await expect(page.locator('#casinoapipro-dialog')).toBeVisible({timeout:15000});
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().near)).toBe('casinoapipro');
}
async function mockProvider(page:Page,state={connected:true}) {
  await page.route('**/api/casinoapipro/status',async route=>{
    const {account}=await (await page.request.get('/api/auth/me')).json();
    const wallet=await (await page.request.get('/api/demo-wallet',{headers:{'X-Royal-Account-Id':account.id}})).json();
    await route.fulfill({json:{configured:true,walletConnected:state.connected,currency:'USD',playerId:'royal_fixture',balance:wallet.balance.toFixed(2)}});
  });
  await page.route('**/api/casinoapipro/games',route=>route.fulfill({json:{games,currency:'USD'}}));
  await page.route('**/api/casinoapipro/sessions',route=>route.fulfill({json:{launchUrl:'https://games.casinoapipro.com/play?token=fixture',game:games[0],currency:'USD'}}));
  await page.route('https://games.casinoapipro.com/play?token=fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Provider fixture</title><p>Test provider frame</p>'}));
}

test('mobile common wallet, category selection, provider frame and cleanup',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:844});await mockProvider(page);await login(page);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.locator('#wallet-provider-games').click();
  await expect(page.locator('#wallet-dialog')).toBeHidden();
  await expect(page.locator('#capro-wallet')).toHaveText(/1\s000/);
  await expect(page.locator('#capro-connection')).toBeEmpty();
  await expect(page.locator('#casinoapipro-dialog .demo-library-card')).toHaveCount(2);
  await page.getByLabel('Категория Casino Api Pro').selectOption('SLOTS');
  await expect(page.locator('#casinoapipro-dialog .demo-library-card')).toHaveCount(1);
  const session=page.waitForRequest(request=>request.url().endsWith('/api/casinoapipro/sessions'));
  await page.getByRole('button',{name:'Тестовая игра Royal Slots',exact:true}).click();
  expect((await session).postDataJSON()).toEqual({gameId:'capro-slots'});
  await expect(page.frameLocator('#casinoapipro-dialog iframe').getByText('Test provider frame')).toBeVisible();
  await expect(page.locator('#capro-message')).toBeHidden();
  const box=(await page.locator('#casinoapipro-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(844);
  await page.locator('#capro-catalogue').click();await expect(page.locator('#casinoapipro-dialog iframe')).toHaveCount(0);
  await page.getByLabel('Категория Casino Api Pro').selectOption('');
  await page.getByLabel('Поиск игр Casino Api Pro').fill('Mines');
  await expect(page.locator('#casinoapipro-dialog .demo-library-card')).toHaveCount(1);
  await page.locator('#capro-close').click();await expect(page.locator('#casinoapipro-dialog')).toBeHidden();
  await page.locator('#games-tab').click();await openCabinet(page);
  await expect(page.locator('#casinoapipro-dialog .demo-library')).toBeVisible();
  expect(errors).toEqual([]);
});

test('missing wallet confirmation disables launch until a signed connection check',async({page})=>{
  const state={connected:false};await mockProvider(page,state);await login(page);
  await page.locator('#games-tab').click();await openCabinet(page);
  await expect(page.getByRole('button',{name:'Тестовая игра Mines',exact:true})).toBeDisabled();
  await page.locator('#capro-setup summary').click();await expect(page.locator('#capro-player')).toHaveText('royal_fixture');
  state.connected=true;
  await expect(page.getByRole('button',{name:'Тестовая игра Mines',exact:true})).toBeEnabled({timeout:10000});
  await expect(page.locator('#capro-setup')).toBeHidden();
});

test('disabled provider explains setup; a closed pending launch cannot reopen a frame',async({page})=>{
  await login(page);await page.locator('#games-tab').click();await openCabinet(page);
  await expect(page.locator('#capro-message')).toContainText('нужны тестовые ключи');
  await expect(page.locator('#casinoapipro-dialog iframe')).toHaveCount(0);
  await page.locator('#capro-close').click();await mockProvider(page);
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/casinoapipro/sessions',async route=>{await gate;await route.fulfill({json:{launchUrl:'https://games.casinoapipro.com/play?token=fixture'}}).catch(()=>{});});
  await page.locator('#games-tab').click();await openCabinet(page);
  const request=page.waitForRequest(request=>request.url().endsWith('/api/casinoapipro/sessions'));
  await page.getByRole('button',{name:'Тестовая игра Mines',exact:true}).click();await request;
  await page.locator('#capro-close').click();release();
  await expect(page.locator('#casinoapipro-dialog')).toBeHidden();await expect(page.locator('#casinoapipro-dialog iframe')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().locked)).toBe(false);
  await page.keyboard.press('e');await expect(page.locator('#casinoapipro-dialog')).toBeVisible();
  await expect(page.locator('#casinoapipro-dialog .demo-library')).toBeVisible();
  await page.locator('#capro-close').click();
});


test('casino cabinets stand in the first hall and Luelon joins the second-floor table games',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await mockProvider(page);await login(page);
  await expect(page.locator('h1')).toContainText('Казино и бар');
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(10);
  await expect(page.locator('[data-cabinet="casinoapipro"]')).toContainText('14 казино-игр');
  await expect(page.locator('[data-cabinet="royal-fruits"]')).toContainText('Royal Fruits');
  await expect(page.locator('.shared-cards')).toBeHidden();
  await expect(page.locator('[data-cabinet="breaker"],[data-cabinet="orbit"],[data-cabinet="drift"],[data-cabinet="pixel"]')).toHaveCount(0);
  await expect(page.locator('[data-cabinet="luelon"]')).toBeHidden();
  await page.locator('#panel-close').click();
  await page.locator('#room-overview').click();
  await page.screenshot({path:'artifacts/casino-hall-local.png'});
  const machine=await worldPoint(page,240,240);
  await page.mouse.click(machine.x,machine.y);
  await expect(page.locator('#casinoapipro-dialog')).toBeVisible({timeout:15000});
  await expect(page.locator('#casinoapipro-dialog .demo-library-card')).toHaveCount(2);
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().locked)).toBe(true);
  await page.locator('#capro-close').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().locked)).toBe(false);
  await expect(page.locator('#visit-bar')).toBeVisible();
  await selectHall(page,'tables');await page.locator('#games-tab').click();
  for(const id of ['chess','pool','hockey']) await expect(page.locator('[data-activity="'+id+'"]').first()).toBeVisible();
  await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(1);
  await expect(page.locator('[data-cabinet="luelon"]')).toBeVisible();
  await expect(page.locator('[data-cabinet="breaker"],[data-cabinet="orbit"],[data-cabinet="drift"],[data-cabinet="pixel"]')).toHaveCount(0);
  await expect(page.locator('#visit-bar')).toBeHidden();
  await page.screenshot({path:'artifacts/casino-tables-local.png'});
  await page.locator('#panel-close').click();await selectHall(page,'arcade');
  await page.locator('#games-tab').click();await openCabinet(page);
  await expect(page.locator('#casinoapipro-dialog .demo-library-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});
