import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('Почта',{exact:true}).fill(`nile-address-check-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Nile-address-check-password!');
  const authenticated=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  expect((await authenticated).ok()).toBe(true);
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  return (await (await page.request.get('/api/auth/me')).json()).account.id as string;
}

test('published automatic addresses remain private and stable without a manual invitation',async({page,browser})=>{
  test.skip(!process.env.TEST_BASE_URL||process.env.NILE_AUTO_DEPOSIT_PUBLIC_CHECK!=='1','Opt in explicitly: this check allocates two permanent public test addresses.');
  test.setTimeout(90000);
  await page.setViewportSize({width:390,height:844});
  const firstId=await login(page),headers={'X-Royal-Account-Id':firstId};
  await page.locator('#nile-wallet-button').click();
  await expect(page.locator('#nile-wallet-content')).toBeVisible({timeout:25000});
  await expect(page.locator('#nile-wallet-claim')).toBeHidden();
  await expect(page.locator('#nile-wallet-balance')).toHaveText('0');
  const address=await page.locator('#nile-wallet-address').inputValue();
  expect(address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  expect(address).not.toBe('TQXj2m3KDSCbLXZHyQs1YFtmnjGQntfWi7');
  const replies=await Promise.all(Array.from({length:4},()=>page.request.post('/api/nile-play/deposit',{headers,data:{}})));
  for(const reply of replies){expect(reply.status()).toBe(200);expect((await reply.json()).address).toBe(address);}
  await page.screenshot({path:'artifacts/nile-automatic-deposit-public-mobile.png'});
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-address')).toHaveValue(address);
  const secondContext=await browser.newContext({baseURL:process.env.TEST_BASE_URL});
  try{
    const second=await secondContext.newPage();
    const loggedIn=await second.request.post('/api/auth/login',{data:{email:`nile-address-owner-${crypto.randomUUID()}@example.test`,password:'Nile-address-check-password!'}});
    expect(loggedIn.status()).toBe(200);const secondId=(await loggedIn.json()).account.id as string;
    const secondHeaders={'X-Royal-Account-Id':secondId};
    const before=await second.request.get('/api/nile-play/wallet',{headers:secondHeaders});
    expect((await before.json()).state).toBe('unassigned');
    expect((await second.request.post('/api/nile-play/deposit',{headers,data:{}})).status()).toBe(401);
    const provision=await second.request.post('/api/nile-play/deposit',{headers:secondHeaders,data:{}});
    expect(provision.status()).toBe(200);const other=await provision.json();
    expect(other.address).not.toBe(address);expect(other.balanceUnits).toBe('0');
    expect(other.deposits).toHaveLength(0);expect(other.maxStakeUnits).toBe('0');
    const original=await page.request.get('/api/nile-play/wallet',{headers});
    expect((await original.json()).address).toBe(address);
  }finally{await secondContext.close();}
});

test('an existing public test wallet explains a missing payout reserve and keeps its address',async({page})=>{
  test.skip(!process.env.TEST_BASE_URL||!process.env.NILE_AUTO_QA_ACCOUNT_FILE,'Provide an existing synthetic QA account to avoid allocating another address.');
  const {email}=JSON.parse(readFileSync(process.env.NILE_AUTO_QA_ACCOUNT_FILE!,'utf8'));
  expect(email).toMatch(/^nile-address-check-[a-f0-9-]+@example\.test$/);
  const authenticated=await page.request.post('/api/auth/login',{data:{email,password:'Nile-address-check-password!'}});
  expect(authenticated.status()).toBe(200);const headers={'X-Royal-Account-Id':(await authenticated.json()).account.id as string};
  const before=await(await page.request.get('/api/nile-play/wallet',{headers})).json();
  expect(before.state).toBe('assigned');expect(before.balanceUnits).toBe('0');
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-address')).toHaveValue(before.address,{timeout:15000});
  await expect(page.locator('#nile-wallet-message')).toContainText('резерв выплат');
  await expect(page.locator('#nile-wallet-updated')).toContainText('Игровой баланс. Подтверждено:');
  await page.screenshot({path:'artifacts/nile-automatic-deposit-public-mobile.png'});
  const repeat=await page.request.post('/api/nile-play/deposit',{headers,data:{}});
  expect(repeat.status()).toBe(200);expect((await repeat.json()).address).toBe(before.address);
});
