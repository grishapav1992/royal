import { test,expect,type Page,type APIRequestContext,type Response as PlaywrightResponse } from '@playwright/test';
import { appendFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { Client,type Room } from '@colyseus/sdk';
import { CARD_GAME_IDS,dealerForGame,type CardGameId } from '../src/shared/cardTables';
import { CABINETS } from '../src/shared/cabinets';
import { isExpansionGame,type ExpansionSession } from '../src/shared/casinoExpansion';
import { VARIANT_DEFAULTS,isVariantGame } from '../src/shared/casinoVariants';
import { validCasinoSession,type CasinoSession } from '../src/shared/casinoSessions';
import { worldPoint } from './room-ui';

const directory='artifacts/card-floor-20261011',password='Royal-card-floor-isolated-password!';
const expansionEndpoint='/api/demo-wallet/expansion',casinoEndpoint='/api/demo-wallet/casino-sessions';
const expansionGames=CARD_GAME_IDS.filter(isExpansionGame);
type Wallet={balance:number;entries:{operationId:string;kind:string;amount:number}[]};
type ExpansionReply={session:ExpansionSession;wallet:Wallet;replayed:boolean};
type CasinoReply={session:CasinoSession;wallet:Wallet;replayed:boolean};
let host:Room,room='';
const accountByPage=new WeakMap<Page,string>();
const record=(account:{id:string;email:string})=>{if(process.env.ROYAL_CARD_URL)appendFileSync(directory+'/public-created-accounts.jsonl',JSON.stringify({id:account.id,email:account.email})+'\n');};
const email=(host=false)=>`royalcardfloor-${host?'host-':''}${crypto.randomUUID()}@example.test`;
test.beforeAll(async({request})=>{
  mkdirSync(directory,{recursive:true});
  const auth=await request.post('/api/auth/login',{data:{email:email(true),password}});expect(auth.ok()).toBe(true);record((await auth.json()).account);
  expect((await request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
  host=await new Client(process.env.ROYAL_CARD_URL||'http://127.0.0.1:2696',{headers:{Cookie:auth.headers()['set-cookie'].split(';')[0]},fetchFn:async(url,options)=>{
    const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
    return new Response(await response.body(),{status:response.status(),headers:response.headers()});
  }}).create('lobby');room=host.roomId;
  for(const type of ['chat','activities','piano-note','notice'])host.onMessage(type,()=>{});
});
test.afterAll(async()=>{await host?.leave();});

async function apiAccount(request:APIRequestContext){
  const auth=await request.post('/api/auth/login',{data:{email:email(),password}});expect(auth.ok()).toBe(true);const account=(await auth.json()).account;record(account);
  const headers={'X-Royal-Account-Id':account.id as string};
  expect((await request.post('/api/demo-wallet/operations',{headers,data:{id:crypto.randomUUID(),kind:'deposit',amount:1000}})).ok()).toBe(true);return headers;
}
async function postReplay<T extends {session:unknown;wallet:Wallet;replayed:boolean}>(request:APIRequestContext,headers:Record<string,string>,endpoint:string,data:unknown):Promise<T>{
  const response=await request.post(endpoint,{headers,data});expect(response.ok(),await response.text()).toBe(true);const result=await response.json() as T;
  const again=await request.post(endpoint,{headers,data});expect(again.ok(),await again.text()).toBe(true);const replay=await again.json() as T;
  expect(replay.replayed).toBe(true);expect(replay.session).toEqual(result.session);expect(replay.wallet.balance).toBe(result.wallet.balance);return result;
}
function nextMove(session:ExpansionSession){
  const actions=session.view.actions;
  return ['cashout','auto','hold','pull','no-insurance','keep','stand','play1','play','check','decline','andar','red'].find(move=>actions.some(action=>action.move===move))??actions[0]?.move;
}
test('all 28 wallet card games and Hi-Lo settle, replay each request and retain their sessions',async({request})=>{
  expect(expansionGames).toHaveLength(28);const headers=await apiAccount(request),proof=[];
  for(const gameId of expansionGames){
    const before=(await(await request.get('/api/demo-wallet',{headers})).json()).balance as number,id=crypto.randomUUID();
    const settings=isVariantGame(gameId)?VARIANT_DEFAULTS[gameId]:['github-three-card','github-ultimate'].includes(gameId)?{side:false}:gameId==='github-dragon-tiger'?{bet:'dragon'}:{};
    let reply=await postReplay<ExpansionReply>(request,headers,expansionEndpoint,{id,gameId,action:'start',stakeUnits:'1000',settings});
    expect(reply.session).not.toHaveProperty('engine');
    for(let step=0;reply.session.state==='active';step++){
      expect(step).toBeLessThan(20);const move=nextMove(reply.session);expect(move).toBeTruthy();
      reply=await postReplay<ExpansionReply>(request,headers,expansionEndpoint,{id:crypto.randomUUID(),gameId,action:'move',sessionId:reply.session.id,move,...(move==='hold'?{picks:[]}:{})});
    }
    expect(Math.round(reply.wallet.balance*100)).toBe(Math.round(before*100)-Number(reply.session.spentUnits)+Number(reply.session.returnedUnits));
    expect(reply.wallet.entries.filter(entry=>entry.operationId===id&&entry.kind==='bet')).toHaveLength(1);
    const saved=await(await request.get(expansionEndpoint,{headers})).json();expect(saved.sessions.find((s:ExpansionSession)=>s.gameId===gameId)).toEqual(reply.session);
    proof.push({gameId,sessionId:reply.session.id,state:reply.session.state,spentUnits:reply.session.spentUnits,returnedUnits:reply.session.returnedUnits});
  }
  const before=(await(await request.get('/api/demo-wallet',{headers})).json()).balance as number;
  let hilo=await postReplay<CasinoReply>(request,headers,casinoEndpoint,{id:crypto.randomUUID(),gameId:'github-hilo',action:'start',stakeUnits:'1000',settings:{}});
  const direction=hilo.session.cards![0].rank<=7?'higher':'lower';
  hilo=await postReplay<CasinoReply>(request,headers,casinoEndpoint,{id:crypto.randomUUID(),gameId:'github-hilo',action:'pick',sessionId:hilo.session.id,choice:direction});
  if(hilo.session.state==='active')hilo=await postReplay<CasinoReply>(request,headers,casinoEndpoint,{id:crypto.randomUUID(),gameId:'github-hilo',action:'cashout',sessionId:hilo.session.id});
  expect(validCasinoSession(hilo.session)).toBe(true);expect(hilo.session.state).not.toBe('active');
  expect(Math.round(hilo.wallet.balance*100)).toBe(Math.round(before*100)-1000+Number(hilo.session.payoutUnits));
  const saved=await(await request.get(casinoEndpoint,{headers})).json();expect(saved.sessions.some((s:CasinoSession)=>s.gameId==='github-hilo'&&s.state==='active')).toBe(false);
  proof.push({gameId:'github-hilo',sessionId:hilo.session.id,state:hilo.session.state,spentUnits:hilo.session.stakeUnits,returnedUnits:hilo.session.payoutUnits});
  writeFileSync(directory+'/'+(process.env.ROYAL_CARD_URL?'public':'local')+'-wallet-games.json',JSON.stringify(proof,null,2)+'\n');
});

async function joined(page:Page){
  await page.bringToFront();await expect(page.locator('#join-dialog')).toBeHidden({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo?.getState().online)).toBe(true);
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();
}
async function login(page:Page,reduced=false){
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await page.goto('/?room='+room);
  await page.getByLabel('Почта',{exact:true}).fill(email());await page.getByLabel('Пароль',{exact:true}).fill(password);
  const auth=page.waitForResponse(response=>response.url().endsWith('/api/auth/login')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();const account=(await(await auth).json()).account;record(account);accountByPage.set(page,account.id);
  await expect(page.locator('#character-step')).toBeVisible();await page.getByRole('button',{name:'Войти в зал',exact:true}).click();await joined(page);
  await page.getByRole('button',{name:'Открыть демокошелёк'}).click();await page.getByRole('button',{name:'Пополнить демобаланс',exact:true}).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/);await page.getByRole('button',{name:'Закрыть кошелёк'}).click();
}
async function hall(page:Page,target:'arcade'|'tables'|'github'){
  for(let step=0;step<2;step++){
    const current=await page.evaluate(()=>(window as any).royalDemo.getState().hall);if(current===target)return;
    const next=current==='arcade'||current==='github'?'tables':target;
    await page.locator(`[data-floor-target="${next}"]`).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().hall),{timeout:45000}).toBe(next);
  }
  expect(await page.evaluate(()=>(window as any).royalDemo.getState().hall)).toBe(target);
}
async function catalog(page:Page){if(!await page.locator('#card-tables-catalog').isVisible())await page.locator('#games-tab').click();}
async function open(page:Page,id:CardGameId){
  await hall(page,'github');await catalog(page);await page.locator(`[data-card-table="${id}"]`).click();
  await expect(page.locator('#mini-dialog')).toBeVisible({timeout:60000});await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game',id);
  await expect(page.locator(`[data-card-dealer="${id}"]`)).toBeVisible();await expect(page.locator('.card-dealer-caption strong')).toHaveText(dealerForGame(id)!.name);
  const cabinet=CABINETS.find(c=>c.id===id)!;
  const state=await page.evaluate(()=>(window as any).royalDemo.getState());expect(state.hall).toBe('github');expect(state.near).toBe(id);expect(Math.hypot(state.x-cabinet.x,state.y-(cabinet.y+25))).toBeLessThan(80);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().playing)).toBe(true);
  await expect(page.locator('#mini-game')).not.toBeEmpty();
}
async function close(page:Page){await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();await expect.poll(()=>page.evaluate(()=>{const state=(window as any).royalDemo.getState();return state.playing||state.locked;})).toBe(false);}
async function physicallyOpen(page:Page,id:CardGameId){
  const c=CABINETS.find(c=>c.id===id)!,point=await worldPoint(page,c.x,c.y-55);await page.mouse.click(point.x,point.y);
  await expect(page.locator('#mini-dialog')).toBeVisible({timeout:10000});await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game',id);
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().playing)).toBe(true);
}
async function uiReply(page:Page,endpoint:string,action:()=>Promise<unknown>){
  const wait=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');await action();const response=await wait;
  expect(response.ok(),await response.text()).toBe(true);return {response,value:await response.json()};
}
async function replayUI(page:Page,response:PlaywrightResponse,expected:any){
  const originalHeaders=await response.request().allHeaders(),account=originalHeaders['x-royal-account-id'];expect(account).toBeTruthy();
  const replay=await page.request.post(new URL(response.url()).pathname,{headers:{'X-Royal-Account-Id':account},data:response.request().postDataJSON()});expect(replay.ok(),await replay.text()).toBe(true);const value=await replay.json();expect(value.replayed).toBe(true);expect(value.session).toEqual(expected.session);expect(value.wallet.balance).toBe(expected.wallet.balance);
}
async function walletGet(page:Page,endpoint='/api/demo-wallet'){
  const account=accountByPage.get(page);expect(account).toBeTruthy();
  const response=await page.request.get(endpoint,{headers:{'X-Royal-Account-Id':account!}});expect(response.ok(),await response.text()).toBe(true);return response.json();
}
async function expansionParty(page:Page,id:CardGameId){
  await expect(page.locator('[data-start]')).toBeEnabled();let result=await uiReply(page,expansionEndpoint,()=>page.locator('[data-start]').click());await replayUI(page,result.response,result.value);
  for(let step=0;result.value.session.state==='active';step++){
    expect(step).toBeLessThan(20);const move=nextMove(result.value.session);await expect(page.locator(`[data-move="${move}"]`)).toBeEnabled();
    result=await uiReply(page,expansionEndpoint,()=>page.locator(`[data-move="${move}"]`).click());await replayUI(page,result.response,result.value);
  }
  await expect(page.locator('#mini-game [role="alert"]')).toBeEmpty();return result.value as ExpansionReply;
}

for(const [group,ids] of [CARD_GAME_IDS.slice(0,17),CARD_GAME_IDS.slice(17)].entries()){
  test(`real hall, unique dealers and physical tables open every card game, group ${group+1}`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await login(page,group===1);
    await expect(page.locator('#games-tab')).toHaveText('Игры · 61');await page.locator('#games-tab').click();
    await expect(page.locator('[data-card-table]:visible')).toHaveCount(0);await expect(page.locator('[data-cabinet]:visible')).toHaveCount(13);
    await expect(page.locator('[data-variant]:visible')).toHaveCount(13);await expect(page.locator('#studio-catalog')).toBeVisible();
    await hall(page,'github');await expect(page.locator('h1')).toContainText('Карточный салон');await expect(page.locator('#games-tab')).toHaveText('Игры · 33');
    await catalog(page);await expect(page.locator('[data-card-table]:visible')).toHaveCount(33);
    const names=await page.locator('.card-table-copy small').allTextContents();expect(new Set(names).size).toBe(33);
    const portraits=await page.locator('.card-table-portrait').evaluateAll(elements=>elements.map(element=>(element as HTMLCanvasElement).toDataURL()));expect(new Set(portraits).size).toBe(33);
    await page.screenshot({path:directory+`/card-floor-catalog-${group+1}.png`});
    await page.locator('#panel-close').click();await expect(page.locator('#card-tables-catalog')).toBeHidden();
    await page.screenshot({path:directory+`/card-floor-hall-${group+1}.png`});
    for(const id of ids){
      await open(page,id);
      if(['github-three-card','github-spanish','github-pai-gow','variant-blackjack-target','variant-war'].includes(id))await expansionParty(page,id);
      if(['github-blackjack','github-poker','github-video-poker','github-baccarat'].includes(id)){
        const wallet=await walletGet(page);expect(typeof wallet.balance).toBe('number');await page.locator('.github-game [data-action="start"]').click();
        await expect(page.locator('.github-game .github-card img:not([src$="cardBack.svg"])')).not.toHaveCount(0);
        if(id==='github-blackjack' && await page.locator('[data-action="stand"]').count())await expect(page.locator('[data-action="stand"]')).toBeEnabled();
        expect((await walletGet(page)).balance).toBe(wallet.balance);
      }
      if(id===ids[0])await page.screenshot({path:directory+`/card-dealer-group-${group+1}.png`});
      await close(page);
      if(['github-blackjack','variant-war'].includes(id)){await physicallyOpen(page,id);await close(page);}
    }
    await hall(page,'tables');await expect(page.locator('h1')).toContainText('Игры на двоих');await hall(page,'arcade');
    await expect(page.locator('#games-tab')).toHaveText('Игры · 61');await page.locator('#games-tab').click();await expect(page.locator('#studio-catalog')).toBeVisible();
    await page.locator('[data-studio-filter="all"]').click();await expect(page.locator('[data-studio]')).toHaveCount(35);expect(errors).toEqual([]);
  });
}

test('active card parties restore after reload, lost reply retries once, and mobile reduced-motion fits',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await login(page,true);await open(page,'github-let-it-ride');
  let committed:ExpansionReply|undefined,operationId='';
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.continue();const operation=route.request().postDataJSON();
    if(committed){expect(operation.id).toBe(operationId);return route.continue();}
    operationId=operation.id;const response=await route.fetch();expect(response.ok()).toBe(true);committed=await response.json();await route.abort('failed');
  });
  await page.locator('[data-start]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await close(page);await page.reload();await joined(page);await open(page,'github-let-it-ride');
  const retry=await uiReply(page,expansionEndpoint,()=>page.locator('[data-retry]').click());expect(retry.value.replayed).toBe(true);expect(retry.value.session).toEqual(committed!.session);
  expect(retry.value.wallet.entries.filter((entry:any)=>entry.operationId===operationId&&entry.kind==='bet')).toHaveLength(1);await page.unroute('**/api/demo-wallet/expansion');
  let reply=retry.value as ExpansionReply;
  while(reply.session.state==='active')reply=(await uiReply(page,expansionEndpoint,()=>page.locator('[data-move="pull"]').click())).value;
  await close(page);await open(page,'github-hilo');await expect(page.locator('[data-asset]')).toHaveValue('demo');
  const start=await uiReply(page,casinoEndpoint,()=>page.locator('[data-start]').click());await replayUI(page,start.response,start.value);await close(page);
  await page.reload();await joined(page);await open(page,'github-hilo');await expect(page.locator('[data-pick]')).toHaveCount(2);
  const saved=await walletGet(page,casinoEndpoint);expect(saved.sessions.find((s:CasinoSession)=>s.gameId==='github-hilo')).toEqual(start.value.session);
  const direction=start.value.session.cards[0].rank<=7?'higher':'lower';let hilo=await uiReply(page,casinoEndpoint,()=>page.locator(`[data-pick="${direction}"]`).click());await replayUI(page,hilo.response,hilo.value);
  if(hilo.value.session.state==='active'){hilo=await uiReply(page,casinoEndpoint,()=>page.locator('[data-cashout]').click());await replayUI(page,hilo.response,hilo.value);}
  expect(hilo.value.wallet.entries.filter((entry:any)=>entry.operationId===start.value.session.id&&entry.kind==='bet')).toHaveLength(1);
  await page.setViewportSize({width:390,height:844});expect(await page.locator('#mini-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth+2)).toBe(true);
  expect(await page.locator('.card-dealer-stage').evaluate(element=>element.scrollWidth<=element.clientWidth+2)).toBe(true);
  await expect(page.locator('.card-dealer-stage')).toHaveAttribute('data-dealer-action',/idle|win|lose/);await page.screenshot({path:directory+'/card-dealer-mobile.png'});await close(page);expect(errors).toEqual([]);
});

test('rapid physical card-table close keeps the latest staircase choice',async({page})=>{
  await login(page,true);await open(page,'variant-war');
  const stairs=await page.locator('[data-floor-target="tables"]').boundingBox();
  expect(stairs).toBeTruthy();await close(page);
  const c=CABINETS.find(c=>c.id==='variant-war')!,point=await worldPoint(page,c.x,c.y-55);
  await page.evaluate(()=>{
    const events:{kind:string;type:string;at:number}[]=[];(window as any).royalCardFloorTestPointerEvents=events;
    const record=(event:Event)=>{const element=event.target as Element;const kind=element.closest('[data-floor-target]')?'stairs':element.closest('#mini-dialog .mini-top [data-close]')?'close':element.closest('#game')?'canvas':'';if(kind)events.push({kind,type:event.type,at:performance.now()});};
    document.addEventListener('pointerdown',record,{capture:true,passive:true});document.addEventListener('click',record,{capture:true,passive:true});
  });
  await page.mouse.click(point.x,point.y);await expect(page.locator('#mini-dialog')).toBeVisible();
  await page.locator('#mini-dialog .mini-top [data-close]').click();await expect(page.locator('#mini-dialog')).toBeHidden();
  await page.waitForFunction(()=>!(window as any).royalDemo.getState().locked);
  await page.mouse.click(stairs!.x+stairs!.width/2,stairs!.y+stairs!.height/2);
  const events=await page.evaluate(()=>(window as any).royalCardFloorTestPointerEvents as {kind:string;type:string;at:number}[]);
  const tableAt=events.find(event=>event.kind==='canvas'&&event.type==='pointerdown')!.at;
  const stairsAt=events.find(event=>event.kind==='stairs'&&event.type==='click')!.at,elapsed=stairsAt-tableAt;
  await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().hall),{timeout:45000}).toBe('tables');
  writeFileSync(directory+'/'+(process.env.ROYAL_CARD_URL?'public':'local')+'-rapid-staircase.json',JSON.stringify({gameId:c.id,elapsedAtStaircaseClickMs:elapsed,hall:'tables',events},null,2)+'\n');
  expect(elapsed,'Physical-table and staircase dispatch must exercise the 150 ms target cooldown').toBeLessThan(150);
  await hall(page,'arcade');await expect(page.locator('#games-tab')).toHaveText('Игры · 61');
});
