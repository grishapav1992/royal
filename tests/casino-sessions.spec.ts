import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { worldPoint } from './room-ui';
import type { CasinoSession } from '../src/shared/casinoSessions';
async function login(page:Page){
  const meta=JSON.parse(readFileSync('/tmp/royal-mainnet-ui-fixture.json','utf8'));
  await page.goto('/');await page.getByLabel('Почта',{exact:true}).fill(meta.email);await page.getByLabel('Пароль',{exact:true}).fill(meta.password);await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#login-step')).toBeHidden();if(await page.locator('#character-step').isVisible()){await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();}
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});return meta;
}
async function casinoFloor(page:Page){
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().hall)).toBe('arcade');
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
}
async function open(page:Page,id:string,asset:'demo'|'usdt'){
  await casinoFloor(page);await page.locator('#games-tab').click();await page.locator(`[data-cabinet="${id}"]`).click();await expect(page.locator('.casino-session')).toBeVisible({timeout:20000});await page.locator('[data-asset]').selectOption(asset);await expect(page.locator('[data-start], [data-cashout]')).toBeVisible();
}
const reply=(page:Page,asset:string)=>page.waitForResponse(r=>r.url().endsWith(`/api/${asset}-wallet/casino-sessions`)&&r.request().method()==='POST');
test('both casino cabinets use the shared demo balance, preserve a lost response and restore after reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const meta=await login(page);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
  await open(page,'github-tower','demo');await expect(page.locator('[data-start]')).toBeEnabled();await page.locator('[data-stake]').selectOption('5000');
  let discarded=false,id='';await page.route('**/api/demo-wallet/casino-sessions',async route=>{if(route.request().method()!=='POST')return route.continue();const op=route.request().postDataJSON();if(!discarded){discarded=true;id=op.id;const r=await route.fetch();expect(r.ok()).toBe(true);await route.abort('failed');}else{expect(op.id).toBe(id);await route.continue();}});
  await page.locator('[data-start]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});await open(page,'github-tower','demo');await expect(page.locator('[data-retry]')).toBeEnabled();
  let wait=reply(page,'demo');await page.locator('[data-retry]').click();let result=await(await wait).json();expect(result.replayed).toBe(true);expect(result.wallet.balance).toBe(950);await expect(page.locator('[data-stake]')).toHaveValue('5000');expect(result.session).not.toHaveProperty('dragons');await page.unroute('**/api/demo-wallet/casino-sessions');
  await expect(page.locator('[data-cell="0:1"]')).toBeEnabled();wait=reply(page,'demo');await page.locator('[data-cell="0:1"]').click();result=await(await wait).json();
  if(result.session.state==='active'){await expect(page.locator('[data-cashout]')).toBeEnabled();wait=reply(page,'demo');await page.locator('[data-cashout]').click();result=await(await wait).json();}
  expect(['lost','cashed_out']).toContain(result.session.state);expect(result.wallet.balance).toBe(950+Number(result.session.payoutUnits)/100);await page.screenshot({path:'artifacts/casino-expansion/tower-demo.png'});await page.setViewportSize({width:390,height:844});expect(await page.locator('.casino-session').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.locator('[data-start]').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/casino-expansion/tower-demo-mobile.png'});await page.setViewportSize({width:1440,height:1000});
  const before=result.wallet.balance;await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page,'github-hilo','demo');await expect(page.locator('[data-start]')).toBeEnabled();wait=reply(page,'demo');await page.locator('[data-start]').click();result=await(await wait).json();expect(result.wallet.balance).toBe(before-10);expect(result.session.cards).toHaveLength(1);
  const rank=result.session.cards[0].rank,direction=rank<=7?'higher':'lower';wait=reply(page,'demo');await page.locator(`[data-pick="${direction}"]`).click();result=await(await wait).json();
  if(result.session.state==='active'){wait=reply(page,'demo');await page.locator('[data-cashout]').click();result=await(await wait).json();}
  expect(Math.round(result.wallet.balance*100)).toBe(Math.round(before*100)-1000+Number(result.session.payoutUnits));await page.locator('#mini-dialog .mini-top [data-close]').click();await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await expect(page.locator('#wallet-balance')).toHaveText(result.wallet.balance.toLocaleString('ru-RU'));await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
  const headers={'X-Royal-Account-Id':meta.config.accountId};for(const asset of ['demo','usdt']){
    const path=`/api/${asset}-wallet/casino-sessions`,data={id:crypto.randomUUID(),gameId:'github-tower',action:'start',stakeUnits:asset==='demo'?'1000':'1000000',settings:{difficulty:'easy'}};
    expect((await page.request.get(path,{headers:{'X-Royal-Account-Id':crypto.randomUUID()}})).status()).toBe(401);
    expect((await page.request.post(path,{headers:{...headers,Origin:'https://evil.example'},data})).status()).toBe(403);
    expect((await page.request.post(path,{headers,data:{...data,payoutUnits:'999999999'}})).status()).toBe(400);
  }expect(errors).toEqual([]);
});
test('real USDT flows through the Unix money service and journal, pays once after lost response and displays on mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const meta=await login(page);await open(page,'github-tower','usdt');await expect(page.locator('[data-start]')).toBeEnabled();
  let wait=reply(page,'usdt');await page.locator('[data-start]').click();let result=await(await wait).json();expect(result.wallet.balanceUnits).toBe('19000000');expect(result.session).not.toHaveProperty('dragons');const session=result.session as CasinoSession;
  await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page,'github-tower','usdt');await expect(page.locator('[data-cell="0:1"]')).toBeEnabled();
  wait=reply(page,'usdt');await page.locator('[data-cell="0:1"]').click();result=await(await wait).json();expect(result.session.id).toBe(session.id);expect(result.session.payoutUnits).toBe('1320000');
  let discarded=false,cashId='';await page.route('**/api/usdt-wallet/casino-sessions',async route=>{if(route.request().method()!=='POST')return route.continue();const op=route.request().postDataJSON();if(!discarded){discarded=true;cashId=op.id;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');}else{expect(op.id).toBe(cashId);await route.continue();}});
  await page.locator('[data-cashout]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await page.reload();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});await open(page,'github-tower','usdt');wait=reply(page,'usdt');await page.locator('[data-retry]').click();result=await(await wait).json();expect(result.replayed).toBe(true);expect(result.wallet.balanceUnits).toBe('20320000');await expect(page.locator('.casino-status')).toContainText('1,32 USDT');await page.unroute('**/api/usdt-wallet/casino-sessions');
  await page.locator('#mini-dialog .mini-top [data-close]').click();await open(page,'github-hilo','usdt');wait=reply(page,'usdt');await page.locator('[data-start]').click();result=await(await wait).json();expect(result.wallet.balanceUnits).toBe('19320000');expect(result.session.cards).toEqual([{rank:1,suit:0}]);await expect(page.locator('[data-pick="lower"]')).toBeDisabled();
  for(let i=0;i<2;i++){wait=reply(page,'usdt');await page.locator('[data-pick="higher"]').click();result=await(await wait).json();}
  expect(result.session.state).toBe('cashed_out');expect(result.session.payoutUnits).toBe('2323750');expect(result.wallet.balanceUnits).toBe('21643750');await expect(page.locator('.casino-status')).toContainText('2,32375 USDT');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/casino-expansion/hilo-usdt-mobile.png'});expect(await page.locator('.casino-session').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.locator('#mini-dialog .mini-top [data-close]').click();await page.locator('#usdt-wallet-button').click();await expect(page.locator('#usdt-wallet-balance')).toHaveText('21,64375');await expect(page.locator('#usdt-wallet-rounds')).toContainText('Hi-Lo: ставка 1, начислено 2,32375 USDT');await expect(page.locator('#usdt-wallet-rounds')).toContainText('Dragon Tower: ставка 1, начислено 1,32 USDT');
  const headers={'X-Royal-Account-Id':meta.config.accountId},wallet=await(await page.request.get('/api/usdt-wallet',{headers})).json();expect(wallet.balanceUnits).toBe('21643750');expect(errors).toEqual([]);
});
test('an unassigned account cannot place real-money bets and no demo amount is presented as USDT',async({page})=>{
  await page.goto('/');await page.getByLabel('Почта',{exact:true}).fill(`unassigned-casino-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill('Unassigned-casino-test-password!');await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});
  await open(page,'github-hilo','usdt');await expect(page.locator('.casino-status')).toContainText('Денежный кошелёк пока недоступен');await expect(page.locator('[data-start]')).toBeDisabled();await expect(page.locator('.casino-balance')).toHaveText('Недоступен');
  await page.locator('[data-asset]').selectOption('demo');await expect(page.locator('.casino-balance')).toHaveText('0 монет');await expect(page.locator('.casino-balance')).not.toContainText('USDT');
});
