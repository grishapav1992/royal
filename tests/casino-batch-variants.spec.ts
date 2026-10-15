import { test, expect, type Page, type Response } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { BATCH_VARIANT_GAMES, type BatchVariantGameId } from '../src/shared/casinoBatchVariants';
import type { ExpansionSession } from '../src/shared/casinoExpansion';
import { worldPoint } from './room-ui';

const password = 'Casino-batch-isolated-password!';
const endpoint = '/api/demo-wallet/expansion';
const artifactDir = process.env.ROYAL_BATCH_ARTIFACTS_DIR || 'artifacts/casino-batch-20261011';
let host: Room, room = '';
const record = (account: {id:string;email:string}) => { if (process.env.ROYAL_BATCH_RECORDS) appendFileSync(process.env.ROYAL_BATCH_RECORDS, JSON.stringify({id:account.id,email:account.email})+'\n'); };
type Reply = { session: ExpansionSession; wallet: {balance:number;entries:{operationId:string;kind:string}[]}; replayed:boolean };

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', {data:{email:`batchvariant-host-${crypto.randomUUID()}@example.test`,password}});
  expect(auth.ok()).toBe(true); record((await auth.json()).account);
  await request.post('/api/auth/character',{data:{skin:0}});
  const base = process.env.ROYAL_BATCH_URL || 'http://127.0.0.1:2604';
  host = await new Client(base,{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{
    const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
    return new globalThis.Response(await response.body(),{status:response.status(),headers:response.headers()});
  }}).create('lobby'); room=host.roomId;
  for(const type of ['chat','activities','piano-note','notice'])host.onMessage(type,()=>{});
});
test.afterAll(async()=>{await host?.leave();});

async function joined(page:Page) { await page.bringToFront();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click(); }
async function login(page:Page) {
  await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/?room='+room);
  await page.getByLabel('Почта',{exact:true}).fill(`batchvariant-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await joined(page);
  const account=(await(await page.request.get('/api/auth/me')).json()).account;record(account);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();
  await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);
  await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
  return {'X-Royal-Account-Id':account.id as string};
}
async function open(page:Page,game:BatchVariantGameId) {
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().playing)).toBe(false);
  await page.locator('#games-tab').click();await page.locator(`[data-variant="${game}"]`).click();
  try { await expect(page.locator(`.${game}`)).toBeVisible({timeout:60000}); } catch(error) { console.log('route failure',game,JSON.stringify(await page.evaluate(()=>(window as any).royalDemo.getState())));throw error; }
  await expect(page.locator(`[data-casino-mode="${game}"]`)).toHaveAttribute('aria-pressed','true');
}
async function close(page:Page) {await page.locator('#mini-dialog .mini-top [data-close]').click();}
const post=(page:Page)=>page.waitForResponse(r=>r.url().endsWith(endpoint)&&r.request().method()==='POST');
async function reply(response:Response):Promise<Reply>{expect(response.ok()).toBe(true);return response.json();}
async function start(page:Page) {await expect(page.locator('[data-start]')).toBeEnabled();const wait=post(page);await page.locator('[data-start]').click();return reply(await wait);}
async function move(page:Page,game:'variant-double-mines'|'variant-dice-streak') {
  if(game==='variant-double-mines'){await page.locator('[data-cell="0"]:enabled').click();await page.locator('[data-cell="1"]:enabled').click();}
  else await page.locator('[data-threshold="2"]').click();
  const wait=post(page);await page.locator(`[data-move="${game==='variant-double-mines'?'reveal':'roll'}"]`).click();return reply(await wait);
}
async function finish(page:Page,game:BatchVariantGameId,value:Reply) {
  if(value.session.state==='active')value=await move(page,game as 'variant-double-mines'|'variant-dice-streak');
  if(value.session.state==='active'){const wait=post(page);await page.locator('[data-move="cashout"]').click();value=await reply(await wait);}
  expect(value.session.state).toBe('settled');return value;
}

test('six physical casino cabinets use one wallet in the enlarged first-floor wing',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const headers=await login(page);
  await expect(page.locator('#games-tab')).toHaveText('Игры · 94');
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().world.width)).toBe(4260);
  const targets={'variant-target-plinko':'edges','variant-triple-poker':'straight','variant-blackjack-target':'19-20'};
  for(const game of BATCH_VARIANT_GAMES){
    await open(page,game);
    expect(await page.evaluate(()=>(window as any).royalDemo.getState().x)).toBeGreaterThan(2090);
    await page.locator('[data-stake]').selectOption('5000');
    if(game in targets)await page.locator(`[data-setting="${targets[game as keyof typeof targets]}"]`).click();
    const initial=await start(page);expect(initial.session.gameId).toBe(game);expect(initial.session.stakeUnits).toBe('5000');
    const result=await finish(page,game,initial);
    expect(result.wallet.entries.filter(e=>e.operationId===initial.session.id&&e.kind==='bet')).toHaveLength(1);
    const wallet=await(await page.request.get('/api/demo-wallet',{headers})).json();expect(wallet.balance).toBe(result.wallet.balance);
    await expect(page.locator('[data-batch-balance]')).toContainText(wallet.balance.toLocaleString('ru-RU'));
    await expect(page.locator('.batch-error')).toBeEmpty();
    await page.screenshot({path:`${artifactDir}/${game}.png`});await close(page);
  }
  await page.locator('#games-tab').click();await expect(page.locator('[data-variant]')).toHaveCount(18);
  if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  await page.screenshot({path:`${artifactDir}/hall-overview.png`});expect(errors).toEqual([]);
});

test('paired mines and dice series recover a lost payout without redrawing or paying twice',async({page})=>{
  const headers=await login(page);
  for(const game of ['variant-double-mines','variant-dice-streak'] as const){
    await open(page,game);let active:Reply|undefined;
    for(let attempt=0;attempt<30;attempt++){await start(page);const result=await move(page,game);if(result.session.state==='active'){active=result;break;}}
    expect(active).toBeDefined();let committed:Reply|undefined,id='',calls=0;
    await page.route('**/api/demo-wallet/expansion',async route=>{
      if(route.request().method()!=='POST')return route.continue();calls++;const operation=route.request().postDataJSON();
      expect(operation.move).toBe('cashout');
      if(!committed){id=operation.id;const response=await route.fetch();expect(response.ok()).toBe(true);committed=await response.json();await route.abort('failed');}
      else{expect(operation.id).toBe(id);await route.continue();}
    });
    await page.locator('[data-move="cashout"]').click();await expect(page.locator('[data-retry]')).toBeEnabled();
    await close(page);await page.reload();await joined(page);await open(page,game);
    await expect(page.locator('[data-retry]')).toBeEnabled();const wait=post(page);await page.locator('[data-retry]').click();const restored=await reply(await wait);
    expect(restored.replayed).toBe(true);expect(restored.session).toEqual(committed!.session);expect(calls).toBe(2);
    expect(restored.wallet.entries.filter(e=>e.operationId===id&&e.kind==='win')).toHaveLength(1);
    await expect(page.locator('[data-retry]')).toHaveCount(0);await expect(page.locator('[data-start]')).toBeEnabled();
    const wallet=await(await page.request.get('/api/demo-wallet',{headers})).json();expect(wallet.balance).toBe(restored.wallet.balance);
    await page.unroute('**/api/demo-wallet/expansion');await close(page);
  }
});

test('mobile controls, classic switching and walking use the new physical wing',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});await login(page);
  for(const game of BATCH_VARIANT_GAMES){await open(page,game);await expect(page.locator('[data-start]')).toBeEnabled();expect(await page.locator('#mini-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);await close(page);}
  await open(page,'variant-blackjack-target');await page.locator('[data-casino-mode="github-blackjack"]').click();
  await expect(page.locator('#mini-title')).toHaveText('Блэкджек');
  await expect(page.locator('.mini-bottom>span')).toHaveText('Бесплатные игры с отдельными учебными фишками');
  await page.locator('[data-casino-mode="variant-blackjack-target"]').click();
  await expect(page.locator('.mini-bottom>span')).toHaveText('Общий тестовый кошелёк клуба');
  await expect(page.locator('.variant-blackjack-target [data-start]')).toBeEnabled();
  await page.locator('[data-setting="17-18"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-setting="17-18"]')).toHaveAttribute('aria-pressed','true');await close(page);
  if(await page.locator('#panel-close').isVisible())await page.locator('#panel-close').click();if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
  const point=await worldPoint(page,2520,700);await page.mouse.click(point.x,point.y);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().x),{timeout:15000}).toBeGreaterThan(2480);
  expect(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`${artifactDir}/mobile-wing.png`});expect(errors).toEqual([]);
});

// A correct server commit must remain recoverable when its response is corrupted.
test('inconsistent payout response keeps the operation for one valid retry',async({page})=>{
  const headers=await login(page);const game='variant-dice-streak';await open(page,game);let active:Reply|undefined;
  for(let attempt=0;attempt<30;attempt++){await start(page);const result=await move(page,game);if(result.session.state==='active'){active=result;break;}}
  expect(active).toBeDefined();let committed:Reply|undefined,id='',calls=0;
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();calls++;const operation=route.request().postDataJSON();expect(operation.move).toBe('cashout');
    if(!committed){
      id=operation.id;const response=await route.fetch();expect(response.ok()).toBe(true);committed=await response.json();
      const corrupted=structuredClone(committed) as any;const wrong=(BigInt(corrupted.session.returnedUnits)+100n).toString();
      corrupted.session.returnedUnits=wrong;corrupted.session.view.variant.cashoutUnits=wrong;
      for(const session of corrupted.sessions??[])if(session.id===corrupted.session.id){session.returnedUnits=wrong;session.view.variant.cashoutUnits=wrong;}
      await route.fulfill({response,json:corrupted});
    }else{expect(operation.id).toBe(id);await route.continue();}
  });
  await page.locator('[data-move="cashout"]').click();await expect(page.locator('[data-retry]')).toBeEnabled();
  const wait=post(page);await page.locator('[data-retry]').click();const recovered=await reply(await wait);
  expect(recovered.replayed).toBe(true);expect(recovered.session).toEqual(committed!.session);expect(calls).toBe(2);
  expect(recovered.wallet.entries.filter(e=>e.operationId===id&&e.kind==='win')).toHaveLength(1);
  const wallet=await(await page.request.get('/api/demo-wallet',{headers})).json();expect(wallet.balance).toBe(recovered.wallet.balance);
  await expect(page.locator('[data-retry]')).toHaveCount(0);await page.unroute('**/api/demo-wallet/expansion');await close(page);
});
