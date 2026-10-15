import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {NileTestLedger} from '../server/finance/nile-test-ledger';
import {customerPool} from '../server-tests/finance/helpers/nile-pool-fixture';
import {block,playTestConfig} from '../server-tests/finance/helpers/nile-play-fixture';
import {NILE_PLAY_SCOPE} from '../src/shared/nilePlay';
async function login(page:Page,fragment=''){
  await page.goto('/'+fragment);await page.getByLabel('Почта',{exact:true}).fill(`nile-play-ui-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill('Nile-play-test-password!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
}
async function coins(page:Page){await page.locator('#games-tab').click();await page.locator('[data-cabinet="royal-coins"]').click();}
async function walletHeaders(page:Page){
  const {account}=await(await page.request.get('/api/auth/me')).json();
  return {'X-Royal-Account-Id':account.id as string};
}
const assigned=()=>({...NILE_PLAY_SCOPE,state:'assigned',address:'TQXj2m3KDSCbLXZHyQs1YFtmnjGQntfWi7',balanceUnits:'200000000',reserveAllocatedUnits:'800000000',updatedAt:Date.now(),ready:true,maxStakeUnits:'10000000',deposits:[],rounds:[] as any[]});
test('isolated real flow claims the wallet, debits Nile, recovers a lost result and keeps demo coins separate',async({page})=>{
  test.skip(!!process.env.TEST_BASE_URL,'An isolated funded fixture is available only locally.');
  const {code}=JSON.parse(readFileSync('/tmp/royal-nile-play-ui-fixture.json','utf8'));await page.setViewportSize({width:390,height:844});await login(page,'#nile-invite='+code);
  expect(page.url()).not.toContain(code);await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-code')).toHaveValue(code);
  await page.getByRole('button',{name:'Подключить тестовый кошелёк'}).click();await expect(page.locator('#nile-wallet-balance')).toHaveText('200');
  await page.locator('#nile-wallet-close').click();await coins(page);await page.locator('#coins-currency').selectOption('nile');await expect(page.locator('#coins-spin')).toBeEnabled();
  let discarded=false,operationId='';await page.route('**/api/nile-play/rounds',async route=>{operationId=route.request().postDataJSON().id;if(!discarded){discarded=true;const reply=await route.fetch();expect(reply.ok()).toBe(true);await route.abort('failed');}else await route.continue();});
  await page.locator('#coins-spin').click();await expect(page.locator('#coins-spin')).toHaveText('Проверить результат');await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});await coins(page);
  await expect(page.locator('#coins-currency')).toHaveValue('nile');const retry=page.waitForResponse(r=>r.url().endsWith('/api/nile-play/rounds')&&r.request().method()==='POST');await page.locator('#coins-spin').click();const result=await(await retry).json();
  expect(result.replayed).toBe(true);expect(result.round.id).toBe(operationId);expect(result.round.stakeUnits).toBe('1000000');expect(result.wallet.balanceUnits).toBe((200000000n-1000000n+BigInt(result.round.payoutUnits)).toString());
  const displayed=(BigInt(result.wallet.balanceUnits)/1000000n).toString();
  await expect(page.locator('#coins-balance')).toHaveText(displayed+' USDT (Nile)');await expect(page.locator('#coins-spin')).toHaveText('Крутить');
  const before=await(await page.request.get('/api/demo-wallet',{headers:await walletHeaders(page)})).json();expect(before.balance).toBe(0);
  await page.locator('#mini-dialog .mini-top [data-close]').click();await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-rounds li')).toHaveCount(1);await expect(page.locator('#nile-wallet-balance')).toHaveText(displayed);
  const box=(await page.locator('#nile-wallet-dialog').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);await page.screenshot({path:'artifacts/nile-play-mobile.png'});
});
test('a stale wallet hides the previous amount and disables fresh Nile bets',async({page})=>{
  let stale=false;await page.route('**/api/nile-play/wallet',route=>route.fulfill({json:{...assigned(),ready:!stale}}));await login(page);await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-balance')).toHaveText('200');
  stale=true;await page.locator('#nile-wallet-refresh').click();await expect(page.locator('#nile-wallet-content')).toBeHidden();await expect(page.locator('#nile-wallet-address')).toHaveValue('');await expect(page.locator('#nile-wallet-message')).toContainText('временно недоступно');
  await page.locator('#nile-wallet-close').click();await coins(page);await page.locator('#coins-currency').selectOption('nile');await expect(page.locator('#coins-spin')).toBeDisabled();
});
test('the published API requires login and rejects caller-selected owners, payouts and external origins',async({page,request})=>{
  expect((await request.get('/api/nile-play/wallet')).status()).toBe(401);await login(page);
  const headers=await walletHeaders(page);
  expect((await page.request.get('/api/nile-play/wallet?userId=nile_deposit_001',{headers})).status()).toBe(400);
  const data={id:crypto.randomUUID(),stakeUnits:'1000000'};
  expect((await page.request.post('/api/nile-play/rounds',{headers,data:{...data,payoutUnits:'999999999'}})).status()).toBe(400);
  expect((await page.request.post('/api/nile-play/rounds',{headers,data:{...data,accountId:crypto.randomUUID()}})).status()).toBe(400);
  expect((await page.request.post('/api/nile-play/rounds',{headers:{...headers,Origin:'https://evil.example'},data})).status()).toBe(403);
  expect((await page.request.post('/api/nile-play/deposit',{headers,data:{amountUnits:'1000000000'}})).status()).toBe(400);
  const response=await page.request.get('/api/nile-play/wallet',{headers});expect(response.status()).toBe(200);expect((await response.json()).state).toBe('unassigned');
});

for(const scenario of [
  {name:'last losing stake',symbols:[0,1,2],multiplier:0,balanceUnits:'0',maxStakeUnits:'10000000',result:'Без выигрыша. Списано 1 USDT (Nile).',warning:'Недостаточно тестовых USDT'},
  {name:'winning stake exhausting the reserve',symbols:[0,0,0],multiplier:12,balanceUnits:'12000000',maxStakeUnits:'0',result:'Начислено 12 USDT (Nile)! Ставка 1.',warning:'Недостаточно резерва'},
]){
  test(`Nile keeps the ${scenario.name} result through wallet refresh until the wager changes`,async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    let wallet={...assigned(),balanceUnits:'1000000'};
    let releaseRefresh:(()=>void)|undefined;
    let holdRefresh=false;
    await page.route('**/api/demo-wallet',route=>route.fulfill({json:{balance:1000,entries:[]}}));
    await page.route('**/api/nile-play/wallet',async route=>{
      if(holdRefresh)await new Promise<void>(resolve=>{releaseRefresh=resolve;});
      await route.fulfill({json:wallet});
    });
    await page.route('**/api/nile-play/rounds',async route=>{
      const request=route.request().postDataJSON();
      const round={...request,payoutUnits:String(BigInt(request.stakeUnits)*BigInt(scenario.multiplier)),symbols:scenario.symbols,multiplier:scenario.multiplier,createdAt:Date.now()};
      wallet={...wallet,balanceUnits:scenario.balanceUnits,maxStakeUnits:scenario.maxStakeUnits,rounds:[round]};
      await route.fulfill({json:{wallet,round,replayed:false}});
    });
    await login(page);await coins(page);await page.locator('#coins-currency').selectOption('nile');
    await expect(page.locator('#coins-spin')).toBeEnabled();await page.locator('#coins-spin').click();
    await expect(page.locator('#coins-spin')).toHaveText('Крутить');
    await expect(page.locator('#coins-result')).toHaveText(scenario.result);
    await expect(page.locator('#coins-spin')).toBeDisabled();
    holdRefresh=true;
    await page.locator('#coins-wallet').click();
    await expect(page.locator('#coins-balance')).toHaveText('…');
    await expect(page.locator('#coins-result')).toHaveText(scenario.result);
    await expect.poll(()=>typeof releaseRefresh).toBe('function');
    holdRefresh=false;releaseRefresh!();
    await expect(page.locator('#nile-wallet-content')).toBeVisible();
    await page.locator('#nile-wallet-close').click();
    await expect(page.locator('#coins-result')).toHaveText(scenario.result);
    await expect(page.locator('#coins-spin')).toBeDisabled();
    await page.locator('#coins-bet').selectOption('2000000');
    await expect(page.locator('#coins-result')).toContainText(scenario.warning);
    await page.locator('#coins-currency').selectOption('demo');
    await expect(page.locator('#coins-result')).toHaveText('Выбери ставку и запусти барабаны.');
    await page.locator('#coins-game').selectOption('royal-roulette');
    await expect(page.locator('#coins-result')).toHaveText('Выбери ставку и запусти колесо.');
    await page.locator('#coins-currency').selectOption('nile');
    await expect(page.locator('#coins-result')).toContainText(scenario.warning);
  });
}

test('a new Nile round clears the previous result and restores availability warnings after a rejection',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  let wallet=assigned(),rounds=0;
  await page.route('**/api/nile-play/wallet',route=>route.fulfill({json:wallet}));
  await page.route('**/api/nile-play/rounds',async route=>{
    rounds++;
    if(rounds===2){
      wallet={...wallet,maxStakeUnits:'0'};
      await route.fulfill({status:400,json:{error:'Резерв изменился. Обнови кошелёк.'}});return;
    }
    const request=route.request().postDataJSON();
    const round={...request,payoutUnits:request.stakeUnits,symbols:[0,0,1],multiplier:1,createdAt:Date.now()};
    wallet={...wallet,rounds:[round]};
    await route.fulfill({json:{wallet,round,replayed:false}});
  });
  await login(page);await coins(page);await page.locator('#coins-currency').selectOption('nile');
  await expect(page.locator('#coins-spin')).toBeEnabled();await page.locator('#coins-spin').click();
  await expect(page.locator('#coins-result')).toHaveText('Ставка 1 USDT (Nile) возвращена.');
  await page.locator('#coins-spin').click();
  await expect(page.locator('#coins-result')).toHaveText('Резерв изменился. Обнови кошелёк.');
  await page.locator('#coins-wallet').click();await expect(page.locator('#nile-wallet-content')).toBeVisible();
  await page.locator('#nile-wallet-close').click();
  await expect(page.locator('#coins-result')).toContainText('Недостаточно резерва');
  await expect(page.locator('#coins-spin')).toBeDisabled();
  expect(rounds).toBe(2);
});

test('a user gets an address without a code, receives a confirmed deposit automatically and plays from that balance',async({page})=>{
  test.skip(!!process.env.TEST_BASE_URL,'Only the isolated fixture may synthesize a confirmed transfer.');
  test.setTimeout(90000);await page.setViewportSize({width:390,height:844});await login(page);
  let lost=false;await page.route('**/api/nile-play/deposit',async route=>{if(!lost){lost=true;const result=await route.fetch();expect(result.ok()).toBe(true);await route.abort('failed');}else await route.continue();});
  await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-deposit')).toBeVisible();await page.locator('#nile-wallet-deposit').click();
  await expect(page.locator('#nile-wallet-balance')).toHaveText('0');await expect(page.locator('#nile-wallet-claim')).toBeHidden();
  const address=await page.locator('#nile-wallet-address').inputValue();expect(address).toMatch(/^T/);
  const headers=await walletHeaders(page);const retry=await page.request.post('/api/nile-play/deposit',{headers,data:{}});expect(retry.ok()).toBe(true);expect((await retry.json()).address).toBe(address);
  const meta=JSON.parse(readFileSync('/tmp/royal-nile-play-ui-fixture.json','utf8'));expect(meta.sourceFile).toContain('royal-nile-play-ui-');
  const source=new NileTestLedger(meta.sourceFile,playTestConfig.source,false,customerPool);try{source.ingest(block(101,'125000000',customerPool.addresses[0].address));}finally{source.close();}
  await expect(page.locator('#nile-wallet-balance')).toHaveText('125',{timeout:65000});await expect(page.locator('#nile-wallet-history li')).toHaveCount(1);
  await page.screenshot({path:'artifacts/nile-automatic-deposit-mobile.png'});await page.locator('#nile-wallet-close').click();await coins(page);
  await expect(page.locator('#coins-currency')).toHaveValue('nile');await expect(page.locator('#coins-spin')).toBeEnabled();
  const spin=page.waitForResponse(r=>r.url().endsWith('/api/nile-play/rounds'));await page.locator('#coins-spin').click();const result=await(await spin).json();
  expect(result.wallet.balanceUnits).toBe((125000000n-1000000n+BigInt(result.round.payoutUnits)).toString());
  const wallet=await(await page.request.get('/api/nile-play/wallet',{headers})).json();expect(wallet.deposits[0].playerUnits).toBe('125000000');expect(wallet.deposits[0].reserveUnits).toBe('0');expect(wallet.rounds).toHaveLength(1);
  await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});await page.locator('#nile-wallet-button').click();await expect(page.locator('#nile-wallet-address')).toHaveValue(address);
});
