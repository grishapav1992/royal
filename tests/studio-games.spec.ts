import { test,expect,type Page,type APIRequestContext } from '@playwright/test';
import { appendFileSync,writeFileSync } from 'node:fs';
import { Client,type Room } from '@colyseus/sdk';
import { STUDIO_GAMES,STUDIO_INFO,STUDIO_DEFAULTS,studioScore,studioPayFrame,validStudioSettlement,type StudioGameId } from '../src/shared/studioGames';
import type { ExpansionSession,ExpansionAction } from '../src/shared/casinoExpansion';
const password='Royal-studio-isolated-password!';
const endpoint='/api/demo-wallet/expansion',directory='artifacts/royal-studio-20261011';
let host:Room,room='';
type Reply={session:ExpansionSession;wallet:{balance:number;entries:{operationId:string;kind:string}[]};replayed:boolean};
const record=(account:{id:string;email:string})=>{if(process.env.ROYAL_STUDIO_RECORDS)appendFileSync(process.env.ROYAL_STUDIO_RECORDS,JSON.stringify(account)+'\n');};
test.beforeAll(async({request})=>{
  const auth=await request.post('/api/auth/login',{data:{email:`royalstudio-host-${crypto.randomUUID()}@example.test`,password}});expect(auth.ok()).toBe(true);record((await auth.json()).account);
  await request.post('/api/auth/character',{data:{skin:0}});
  host=await new Client(process.env.ROYAL_STUDIO_URL||'http://127.0.0.1:2692',{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new globalThis.Response(await response.body(),{status:response.status(),headers:response.headers()});}}).create('lobby');room=host.roomId;
  for(const type of ['chat','activities','piano-note','notice'])host.onMessage(type,()=>{});
});
test.afterAll(async()=>{await host?.leave();});
async function apiAccount(request:APIRequestContext){
  const auth=await request.post('/api/auth/login',{data:{email:`royalstudio-${crypto.randomUUID()}@example.test`,password}});expect(auth.ok()).toBe(true);const account=(await auth.json()).account;record(account);
  const headers={'X-Royal-Account-Id':account.id as string};
  expect((await request.post('/api/demo-wallet/operations',{headers,data:{id:crypto.randomUUID(),kind:'deposit',amount:1000}})).ok()).toBe(true);return headers;
}
async function operation(request:APIRequestContext,headers:Record<string,string>,data:ExpansionAction){
  const response=await request.post(endpoint,{headers,data});expect(response.ok(),await response.text()).toBe(true);const value=await response.json() as Reply;
  const s=value.session;expect(validStudioSettlement(s.gameId as StudioGameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.studio)).toBe(true);
  const again=await request.post(endpoint,{headers,data});expect(again.ok()).toBe(true);const replay=await again.json() as Reply;expect(replay.replayed).toBe(true);expect(replay.session).toEqual(s);return value;
}
test('all 35 native games settle through one wallet and replay every operation once',async({request})=>{
  const headers=await apiAccount(request),proof=[];
  for(const gameId of STUDIO_GAMES){
    const id=crypto.randomUUID();let value=await operation(request,headers,{id,gameId,action:'start',stakeUnits:'1000',settings:STUDIO_DEFAULTS[gameId]});
    for(let turn=0;value.session.state==='active';turn++){
      expect(turn).toBeLessThan(4);const session=value.session,kind=STUDIO_INFO[gameId].kind;
      const move=kind==='slot'?'studio-spin':session.view.actions.some(action=>action.move==='cashout')?'cashout':kind==='mines'?'reveal':'studio-advance';
      value=await operation(request,headers,{id:crypto.randomUUID(),gameId,action:'move',sessionId:session.id,move,...(move==='reveal'?{picks:[0]}:{})});
    }
    expect(value.wallet.entries.filter(entry=>entry.operationId===id&&entry.kind==='bet')).toHaveLength(1);
    const wallet=await(await request.get('/api/demo-wallet',{headers})).json();expect(wallet.balance).toBe(value.wallet.balance);
    proof.push({gameId,sessionId:id,stakeUnits:value.session.stakeUnits,returnedUnits:value.session.returnedUnits,state:value.session.state});
  }
  const saved=await(await request.get(endpoint,{headers})).json();expect(saved.sessions.filter((session:ExpansionSession)=>STUDIO_GAMES.includes(session.gameId as StudioGameId)&&session.state==='active')).toHaveLength(0);
  writeFileSync(directory+'/'+(process.env.ROYAL_STUDIO_URL?'public':'local')+'-all-games.json',JSON.stringify(proof,null,2)+'\n');
});
async function joined(page:Page){await page.bringToFront();await expect(page.locator('#join-dialog')).toBeHidden({timeout:15000});if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();}
async function login(page:Page){
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?room='+room);await page.getByLabel('Почта',{exact:true}).fill(`royalstudio-${crypto.randomUUID()}@example.test`);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await joined(page);
  record((await(await page.request.get('/api/auth/me')).json()).account);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
}
async function open(page:Page,game:StudioGameId){
  if(!await page.locator('[data-studio-filter="all"]').isVisible())await page.locator('#games-tab').click();await page.locator('[data-studio-filter="all"]').click();await page.locator(`[data-studio="${game}"]`).click();
  await expect(page.locator(`[data-studio-game="${game}"]`)).toBeVisible({timeout:60000});await expect(page.locator('[data-refresh]')).toBeEnabled();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();}
test('illustrated catalog, physical wing and shared balance work on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await login(page);await expect(page.locator('#games-tab')).toHaveText('Игры · 94');expect(await page.evaluate(()=>(window as any).royalDemo.getState().world.width)).toBe(4260);
  await page.locator('#games-tab').click();await expect(page.locator('[data-studio]')).toHaveCount(35);await page.locator('[data-studio-filter="slot"]').click();await expect(page.locator('[data-studio]')).toHaveCount(23);
  for(const game of ['studio-neon-crown','studio-caramel-carnival','studio-rivet-rally','studio-ember-vault','studio-mosaic-muse','studio-obsidian-drop','studio-signal-fox','studio-saffron-spin'] as const){
    await open(page,game);expect(await page.evaluate(()=>(window as any).royalDemo.getState().x)).toBeGreaterThan(2900);
    const request=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await page.locator('[data-start]').click();let value=await(await request).json() as Reply;
    while(value.session.state==='active'){const wait=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await page.locator('[data-move="studio-spin"]').click();value=await(await wait).json();}
    expect(value.session.gameId).toBe(game);await expect(page.locator('.studio-error')).toBeEmpty();await expect(page.locator('[data-studio-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}));
    if(game==='studio-neon-crown')await expect(page.locator('[data-neon-slot] .neon-reel')).toHaveCount(3);
    else expect(await page.locator('.studio-world').evaluate((element:HTMLImageElement)=>element.complete&&element.naturalWidth>0)).toBe(true);
    await page.screenshot({path:`${directory}/${game}.png`});await close(page);
  }
  await page.setViewportSize({width:390,height:844});await open(page,'studio-blazing-orchard');expect(await page.locator('#mini-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+2)).toBe(true);await expect(page.locator('[data-slot-cell]')).toHaveCount(20);await page.getByText('Правила, символы и линии',{exact:true}).click();await expect(page.locator('.studio-rule-line')).toHaveCount(40);await page.screenshot({path:directory+'/mobile-slot.png'});await close(page);expect(errors).toEqual([]);
});
test('a lost bonus reply restores the same round after reload without another charge',async({page})=>{
  await login(page);await open(page,'studio-ember-vault');let active:Reply|undefined;
  for(let attempt=0;attempt<20;attempt++){const wait=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await page.locator('[data-start]').click();const result=await(await wait).json() as Reply;if(result.session.state==='active'){active=result;break;}}
  expect(active).toBeDefined();let committed:Reply|undefined,operationId='';
  await page.route('**/api/demo-wallet/expansion',async route=>{if(route.request().method()!=='POST')return route.continue();const operation=route.request().postDataJSON();if(!committed){operationId=operation.id;const response=await route.fetch();expect(response.ok()).toBe(true);committed=await response.json();await route.abort('failed');}else{expect(operation.id).toBe(operationId);await route.continue();}});
  await page.locator('[data-move="studio-spin"]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await close(page);await page.reload();await joined(page);await open(page,'studio-ember-vault');
  const wait=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await page.locator('[data-retry]').click();const restored=await(await wait).json() as Reply;expect(restored.replayed).toBe(true);expect(restored.session).toEqual(committed!.session);expect(restored.wallet.entries.filter(entry=>entry.operationId===active!.session.id&&entry.kind==='bet')).toHaveLength(1);await page.unroute('**/api/demo-wallet/expansion');
  if(restored.session.state==='active'){const finish=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await page.locator('[data-move="studio-spin"]').click();expect((await(await finish).json()).session.state).toBe('settled');}await close(page);
});
test('an impossible but internally consistent reel response keeps the original operation for retry',async({page})=>{
  await login(page);await open(page,'studio-neon-crown');let committed:Reply|undefined,id='';
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();const operation=route.request().postDataJSON();
    if(committed){expect(operation.id).toBe(id);return route.continue();}
    id=operation.id;const response=await route.fetch();expect(response.ok()).toBe(true);committed=await response.json();const corrupted=structuredClone(committed!) as any;
    const grid=Array(9).fill(3),wins=studioScore('studio-neon-crown',grid),frame=studioPayFrame('studio-neon-crown',{stage:'base',grid,wins,raw:wins.reduce((sum,win)=>sum+win.raw,0),held:[]},'1000');
    const studio={kind:'slot',cols:3,rows:3,grid,wins:frame.wins,history:[frame],stage:'base',step:0,remaining:0,maxSteps:3,held:[],totalPayoutUnits:frame.payoutUnits};
    corrupted.session.returnedUnits=frame.payoutUnits;corrupted.session.view.studio=studio;
    for(const session of corrupted.sessions)if(session.id===corrupted.session.id){session.returnedUnits=frame.payoutUnits;session.view.studio=studio;}
    await route.fulfill({response,json:corrupted});
  });
  await page.locator('[data-start]').click();await expect(page.locator('[data-retry]')).toBeEnabled();
  const wait=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await page.locator('[data-retry]').click();const restored=await(await wait).json() as Reply;
  expect(restored.replayed).toBe(true);expect(restored.session).toEqual(committed!.session);expect(restored.wallet.entries.filter(entry=>entry.operationId===id&&entry.kind==='bet')).toHaveLength(1);await expect(page.locator('[data-retry]')).toHaveCount(0);await page.unroute('**/api/demo-wallet/expansion');await close(page);
});
