import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Почта',{exact:true}).fill(`wallet-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Demo-wallet-password!');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
}

test('deposit, wager, settlement and history share one persistent account wallet',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await expect(page.locator('#wallet-balance')).toHaveText('0');
  await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
  await page.locator('#games-tab').click();await page.locator('[data-cabinet="royal-coins"]').click();
  await expect(page.locator('#coins-spin')).toBeEnabled({timeout:15000});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo-wallet/operations')&&r.request().method()==='POST');
  await page.locator('#coins-spin').click();const result=await (await response).json();
  expect(result.round.bet).toBe(100);
  expect(result.wallet.balance).toBe(1000-100+result.round.payout);
  await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  await expect(page.locator('#coins-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await page.locator('#mini-dialog .mini-top [data-close]').click();await page.reload();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));
  await expect(page.locator('#wallet-history [data-kind="deposit"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="bet"]')).toHaveCount(1);
  await expect(page.locator('#wallet-history [data-kind="win"]')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  const box=(await page.locator('#wallet-dialog').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button',{name:'Закрыть кошелёк'})).toBeVisible();
});

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
  await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();
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
