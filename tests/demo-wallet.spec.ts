import { expect, type Page } from '@playwright/test';
import { test } from './themed-room';
import { worldPoint } from './room-ui';
async function login(page: Page, path = '/') {
  await page.goto(path);
  await page.getByLabel('Почта',{exact:true}).fill(`wallet-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Demo-wallet-password!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
}

for (const width of [1440, 390]) {
test(`direct top-up and play persist in the real host at ${width}px`,async({page,roomPath})=>{
  test.setTimeout(90000);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width,height:1000});
  await login(page,roomPath);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().online)).toBe(true);
  const externalPages: string[] = [];
  page.context().on('page', popup => externalPages.push(popup.url()));
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await expect(page.locator('#wallet-balance')).toHaveText('0');
  await page.locator('#wallet-amount').fill('2375');
  await page.getByRole('button',{name:'Пополнить баланс',exact:true}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/2\s375/);
  expect(externalPages).toEqual([]);
  await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
  if(width >= 1000) {
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true') await page.locator('#room-overview').click();
  const aisle=await worldPoint(page,1100,900);await page.mouse.click(aisle.x,aisle.y);
  await expect.poll(async()=>{const s=await page.evaluate(()=>(window as any).royalDemo.getState());return Math.hypot(s.x-1100,s.y-900);},{timeout:25000}).toBeLessThan(30);
  }
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="royal-fruits"]').click();
  await page.locator('[data-platform-game="royal-fruits"]').click();
  await expect(page.locator('#mini-dialog #club-chat-dock')).toBeVisible();
  await expect(page.locator('[data-fruits-spin]')).toBeEnabled({timeout:15000});
  await page.locator('[data-fruits-stake]').selectOption('10000');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');
  await page.locator('[data-fruits-spin]').click();const result=await (await response).json();
  expect(result.gameRound.stakeUnits).toBe('10000');
  expect(result.wallet.balance).toBe(2375-100+Number(result.gameRound.payoutUnits)/100);
  await expect(page.locator('[data-fruits-spin]')).toHaveText('ВРАЩАТЬ');
  await expect(page.locator('[data-fruits-balance]')).toContainText(result.wallet.balance.toLocaleString('ru-RU'));
  await page.screenshot({path:`../game-${width}.png`});
  await page.locator('#mini-dialog .mini-top [data-close]').click();await page.reload();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="deposit"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="win"]')).toHaveCount(1);
  const box=(await page.locator('#wallet-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  await expect(page.getByRole('button',{name:'Закрыть кошелёк'})).toBeVisible();
  await page.screenshot({path:`../wallet-${width}.png`});
  expect(externalPages).toEqual([]);
});
}

test('lost response can be recovered after reload without a second deposit',async({page})=>{
  await login(page);
  let intercepted=false;
  await page.route('**/api/demo-wallet/operations',async route=>{
    if(intercepted){await route.continue();return;}
    intercepted=true;
    const response=await route.fetch();expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await page.getByRole('button',{name:'Пополнить баланс',exact:true}).click();
  await expect(page.locator('#wallet-retry')).toBeEnabled();
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await page.locator('#wallet-retry').click();
  await expect(page.locator('#wallet-retry')).toBeHidden();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await expect(page.locator('#wallet-history li')).toHaveCount(1);
});

test('wallet rejects unauthenticated and cross-origin writes',async({request,page})=>{
  expect((await request.get('/api/demo-wallet')).status()).toBe(401);
  await login(page);
  const outcome=await page.evaluate(async()=>{
    const {account}=await (await fetch('/api/auth/me')).json();
    const headers={'Content-Type':'application/json','X-Royal-Account-Id':account.id};
    const before=await (await fetch('/api/demo-wallet',{headers})).json();
    const response=await fetch('/api/demo-wallet/operations',{method:'POST',headers,body:JSON.stringify({id:crypto.randomUUID(),kind:'spin',amount:100,payout:999999})});
    const after=await (await fetch('/api/demo-wallet',{headers})).json();return {before,after,status:response.status};
  });
  expect(outcome.status).toBe(400);expect(outcome.before.balance).toBe(0);expect(outcome.after.balance).toBe(0);
  expect((await page.request.post('/api/demo-wallet/operations',{headers:{Origin:'https://untrusted.example'},data:{id:crypto.randomUUID(),kind:'deposit',amount:1000}})).status()).toBe(403);
});
