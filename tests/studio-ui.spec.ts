import { test, expect, type Page } from '@playwright/test';
import { STUDIO_GAMES, STUDIO_INFO, STUDIO_DEFAULTS, studioBaseFrame, studioSlotHasBonus, type StudioGameId } from '../src/shared/studioGames';
import { startStudioGame, moveStudioGame, type StudioResult } from '../server/games/studioGames';

function bonus(game:StudioGameId) {
  const cols=STUDIO_INFO[game].cols;
  for(let code=0;code<6**cols;code++){
    let rest=code;const stops=Array.from({length:cols},()=>{const value=rest%6;rest=Math.floor(rest/6);return value;});
    if(!studioSlotHasBonus(game,studioBaseFrame(game,stops)))continue;
    const draws=[...stops,0,5];return startStudioGame(game,STUDIO_DEFAULTS[game],'1000',()=>draws.shift()!);
  }
  throw Error('Missing real bonus fixture');
}
const activeBonus=bonus('studio-cosmic-escape'),nextBonus=moveStudioGame('studio-cosmic-escape',activeBonus.engine,'studio-spin',undefined,'1000'),finalBonus=moveStudioGame('studio-cosmic-escape',nextBonus.engine,'studio-spin',undefined,'1000');
const fixtures={activeBonus,nextBonus,finalBonus,caramelBonus:bonus('studio-caramel-carnival'),neon:startStudioGame('studio-neon-crown',STUDIO_DEFAULTS['studio-neon-crown'],'1000',()=>0),mines:startStudioGame('studio-fossil-trail',STUDIO_DEFAULTS['studio-fossil-trail'],'1000',()=>0),keno:startStudioGame('studio-mosaic-muse',STUDIO_DEFAULTS['studio-mosaic-muse'],'1000',()=>0),diceWon:startStudioGame('studio-signal-fox',STUDIO_DEFAULTS['studio-signal-fox'],'1000',()=>0),diceLost:startStudioGame('studio-signal-fox',STUDIO_DEFAULTS['studio-signal-fox'],'1000',()=>99)};

Object.assign(fixtures,{diceAlternate:startStudioGame('studio-signal-fox',{studio:{chance:75,direction:'over'}},'1000',()=>99),diceLarger:startStudioGame('studio-signal-fox',STUDIO_DEFAULTS['studio-signal-fox'],'5000',()=>0),kenoAlternate:startStudioGame('studio-mosaic-muse',{studio:{numbers:[2,4,6,8,10],target:3}},'1000',()=>0),plinko:startStudioGame('studio-obsidian-drop',STUDIO_DEFAULTS['studio-obsidian-drop'],'1000',()=>0),plinkoAlternate:startStudioGame('studio-obsidian-drop',{studio:{risk:'high'}},'1000',()=>0),wheel:startStudioGame('studio-lucky-spotlight',STUDIO_DEFAULTS['studio-lucky-spotlight'],'1000',()=>0),wheelAlternate:startStudioGame('studio-lucky-spotlight',{studio:{target:2}},'1000',()=>0)});

const probe = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#151a30}#host{width:min(100%,660px);margin:auto}#catalog{width:min(100%,360px);margin:auto}</style></head><body><div id="host"></div><div id="catalog"></div><script type="module">
import {StudioGamesUI} from '/src/ui/StudioGamesUI.ts';
import {StudioCatalog} from '/src/ui/StudioCatalog.ts';
import {expansionClient as client} from '/src/wallet/ExpansionClient.ts';
import {demoWallet} from '/src/wallet/WalletClient.ts';
import {STUDIO_INFO,studioBaseFrame,studioPayFrame} from '/src/shared/studioGames.ts';
client.refresh=async()=>{};client.accountId='00000000-0000-4000-8000-000000000001';demoWallet.accountId=client.accountId;client.wallet={balance:1000,entries:[]};demoWallet.wallet=client.wallet;
let ui,catalog,resolve,reject;
const testProbe={client,demoWallet,fixtures:${JSON.stringify(fixtures)},operations:[],selected:[],mount(game){ui?.destroy();ui=new StudioGamesUI(document.getElementById('host'),game);},catalog(){catalog?.destroy();catalog=new StudioCatalog(document.getElementById('catalog'),game=>testProbe.selected.push(game));},destroy(){ui?.destroy();catalog?.destroy();},sessions(sessions){client.sessions=sessions;client.dispatchEvent(new Event('change'));},session(game,result,id='10000000-0000-4000-8000-000000000001'){const studio=result.studio;let actions=[],phase=1;if(!result.ended){if(studio.kind==='slot'){phase=studio.step+1;actions=[{move:'studio-spin',label:studio.stage==='hold'?'Бесплатный повтор':'Продолжить бесплатный бонус',cost:0}];}else if(studio.kind==='mines'){phase=studio.steps+1;actions=[{move:'reveal',label:'Открыть ячейку',cost:0,minPicks:1,maxPicks:1},...(studio.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}else{phase=studio.steps+1;actions=[{move:'studio-advance',label:'Следующий этап',cost:0},...(studio.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}}return{id,gameId:game,rulesVersion:1,state:result.ended?'settled':'active',stakeUnits:'1000',spentUnits:'1000',returnedUnits:String(result.credit),view:{studio,player:[],dealer:[],community:[],actions,phase,ended:result.ended,message:result.message}};},defer(){client.act=async operation=>{testProbe.operations.push(operation);await new Promise((yes,no)=>{resolve=yes;reject=no;});};},reject(message){reject(new Error(message));},resolve(){resolve();}};
window.studioProbe=testProbe;
</script></body></html>`;

async function ready(page:Page) {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/studio-ui-probe',route=>route.fulfill({status:200,contentType:'text/html',body:probe}));
  await page.goto('/studio-ui-probe');
  await page.waitForFunction(()=>!!(window as any).studioProbe);
}
const mount = (page:Page,id:string)=>page.evaluate(id=>(window as any).studioProbe.mount(id),id);

test('all 35 native games render original artwork, exact denominations and controls on a phone',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await ready(page);await page.setViewportSize({width:390,height:844});
  for(const game of STUDIO_GAMES){
    await mount(page,game);await expect(page.locator('[data-studio-game]')).toHaveAttribute('data-studio-game',game);
    await expect(page.locator('[data-studio-balance]')).toHaveText(/1\s000,00/);
    await expect(page.locator('[data-start]')).toBeEnabled();if(game!=='studio-neon-crown')await expect(page.locator('.studio-world')).toHaveJSProperty('naturalWidth',1536);
    await page.locator('summary').click();
    expect(await page.locator(game==='studio-neon-crown'?'[data-neon-slot]':'.studio-game').evaluate(element=>element.scrollWidth<=element.clientWidth+2),game).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=390),game).toBe(true);
    const info=STUDIO_INFO[game];
    if(info.kind==='slot'){await expect(page.locator('[data-slot-cell]')).toHaveCount(info.cols*info.rows);await expect(page.locator(game==='studio-neon-crown'?'[data-neon-paytable]':'.studio-paytable')).toBeVisible();expect(await page.locator(game==='studio-neon-crown'?'[data-neon-slot]':'.studio-game').textContent()).not.toContain('Карта');if(game==='studio-neon-crown'){await expect(page.locator('[data-neon-cell] .neon-sign')).toHaveCount(9);expect(await page.locator('[data-neon-cell] .neon-sign').first().evaluate(element=>element.getBoundingClientRect().width)).toBeGreaterThan(10);}else expect(await page.locator('.studio-cell .studio-symbol-atlas').first().evaluate(element=>Math.abs(element.getBoundingClientRect().width-element.getBoundingClientRect().height))).toBeLessThan(1);}
    if(info.kind==='mines')await expect(page.locator('[data-mine]')).toHaveCount(16);
  }
  expect(errors).toEqual([]);
});

test('catalogue lists 23 slots first and all 35 games with keyboard filters',async({page})=>{
  await ready(page);await page.evaluate(()=>(window as any).studioProbe.catalog());
  await expect(page.locator('[data-studio]')).toHaveCount(35);
  expect(await page.locator('[data-studio]').first().getAttribute('data-studio')).toBe('studio-cosmic-escape');
  await page.locator('[data-studio-filter="slot"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-studio]')).toHaveCount(23);await expect(page.locator('[data-studio-filter="slot"]')).toBeFocused();
  await page.locator('[data-studio-filter="risk"]').click();await expect(page.locator('[data-studio]')).toHaveCount(6);
  await page.locator('[data-studio-filter="other"]').click();await expect(page.locator('[data-studio]')).toHaveCount(6);
  await page.locator('[data-studio="studio-obsidian-drop"]').click();expect(await page.evaluate(()=>(window as any).studioProbe.selected)).toEqual(['studio-obsidian-drop']);
  await page.setViewportSize({width:390,height:844});expect(await page.locator('.studio-catalog').evaluate(element=>element.scrollWidth<=element.clientWidth+2)).toBe(true);
});

test('slot lines, bonuses and history use the saved result, next-round stake clears the preview',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{const probe=(window as any).studioProbe;probe.sessions([probe.session('studio-neon-crown',probe.fixtures.neon)]);probe.mount('studio-neon-crown');});
  await expect(page.locator('[data-neon-lines] polyline')).toHaveAttribute('points','50,50 150,150 250,250');
  await expect(page.locator('.neon-cell.win')).toHaveCount(3);await expect(page.locator('[data-neon-payout]')).toHaveAttribute('data-units','1263');await expect(page.locator('[data-neon-payout]')).toHaveText('12,63 монет');
  await page.evaluate(()=>{const probe=(window as any).studioProbe;probe.sessions([probe.session('studio-cosmic-escape',probe.fixtures.finalBonus)]);probe.mount('studio-cosmic-escape');});
  await expect(page.locator('[data-frame]')).toHaveCount(3);await page.locator('[data-frame="0"]').click();
  const base=fixtures.activeBonus.studio;if(base.kind!=='slot')throw Error();const payout=(Number(base.history[0].payoutUnits)/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});await expect(page.locator('.studio-stage-payout strong')).toHaveText(payout+' монет');await expect(page.locator('.studio-stage-title>span')).toHaveText('ОСНОВНОЙ СПИН');
  await page.locator('[data-stake]').selectOption('5000');await expect(page.locator('.studio-win-lines')).toHaveCount(0);await expect(page.locator('[data-start]')).toHaveText(/50,00 монет/);await expect(page.locator('.studio-status')).toHaveText(/следующего раунда/);await expect(page.locator('[data-studio-rtp]')).toHaveText(/50,00 монет.*97,/);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/royal-studio-20261011/ui-slot-mobile.png'});
});

test('active bonus locks the stake and sends a free continuation for the saved session',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{const probe=(window as any).studioProbe,game='studio-cosmic-escape';probe.sessions([probe.session(game,probe.fixtures.activeBonus)]);probe.defer();probe.mount(game);});
  await expect(page.locator('[data-stake]')).toBeDisabled();await expect(page.locator('[data-start]')).toHaveCount(0);
  await expect(page.locator('[data-move="studio-spin"]')).toHaveText(/без списания/);await page.locator('[data-move="studio-spin"]').click();
  expect(await page.evaluate(()=>(window as any).studioProbe.operations)).toEqual([{gameId:'studio-cosmic-escape',action:'move',sessionId:'10000000-0000-4000-8000-000000000001',move:'studio-spin'}]);
  await page.evaluate(()=>(window as any).studioProbe.resolve());
});

test('mine reveal uses its exact cell and a rejected late reply cannot overwrite another game',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{const probe=(window as any).studioProbe,game='studio-fossil-trail';probe.sessions([probe.session(game,probe.fixtures.mines)]);probe.defer();probe.mount(game);});
  await page.locator('[data-mine="7"]').click();
  expect(await page.evaluate(()=>(window as any).studioProbe.operations[0])).toEqual({gameId:'studio-fossil-trail',action:'move',sessionId:'10000000-0000-4000-8000-000000000001',move:'reveal',picks:[7]});
  await mount(page,'studio-caramel-carnival');await page.evaluate(()=>(window as any).studioProbe.reject('Поздний ответ теста'));await page.waitForTimeout(50);
  await expect(page.locator('[data-studio-game]')).toHaveAttribute('data-studio-game','studio-caramel-carnival');await expect(page.locator('.studio-error')).toBeEmpty();
});

test('keno and dice settings remain editable for the next round and retain keyboard focus',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{const probe=(window as any).studioProbe;probe.sessions([probe.session('studio-mosaic-muse',probe.fixtures.keno)]);probe.mount('studio-mosaic-muse');});
  await expect(page.locator('.studio-keno-grid .hit')).toHaveCount(2);
  await page.locator('[data-number="1"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-number="1"]')).toBeFocused();await expect(page.locator('[data-start]')).toBeDisabled();
  await page.locator('[data-number="2"]').click();await expect(page.locator('[data-start]')).toBeEnabled();await expect(page.locator('.studio-keno-grid .hit')).toHaveCount(0);
  await mount(page,'studio-signal-fox');await page.locator('[data-setting="chance"][data-value="25"]').click();await page.locator('[data-setting="direction"][data-value="over"]').click();await expect(page.locator('.studio-dice-sum')).toHaveText('Выигрышные числа: 75-99');
});

test('pending confirmation blocks new rounds and exposes one retry control',async({page})=>{
  await ready(page);await mount(page,'studio-cosmic-escape');
  await page.evaluate(()=>{const client=(window as any).studioProbe.client;client.pending={id:'20000000-0000-4000-8000-000000000001',gameId:'studio-cosmic-escape',action:'start',stakeUnits:'1000',settings:{studio:{}}};client.busy=false;client.dispatchEvent(new Event('change'));});
  await expect(page.locator('[data-start]')).toBeDisabled();await expect(page.locator('[data-stake]')).toBeDisabled();await expect(page.locator('[data-retry]')).toBeEnabled();await expect(page.locator('[data-retry]')).toHaveCount(1);
  await page.evaluate(()=>{const probe=(window as any).studioProbe;probe.client.retry=async()=>{probe.operations.push({id:probe.client.pending.id});};});await page.locator('[data-retry]').click();
  expect(await page.evaluate(()=>(window as any).studioProbe.operations)).toEqual([{id:'20000000-0000-4000-8000-000000000001'}]);
});

test('contradictory copies of one saved UUID keep pending until the same request is confirmed',async({page})=>{
  await ready(page);await mount(page,'studio-signal-fox');const ids:string[]=[];let calls=0;
  await page.route('**/api/demo-wallet/expansion',async route=>{
    if(route.request().method()!=='POST')return route.fulfill({status:500,json:{error:'Unexpected read'}});
    const operation=route.request().postDataJSON();ids.push(operation.id);calls++;
    const reply=await page.evaluate(({id,corrupt})=>{const probe=(window as any).studioProbe,won=probe.session('studio-signal-fox',probe.fixtures.diceWon,id),lost=probe.session('studio-signal-fox',probe.fixtures.diceLost,id);return{wallet:{balance:1009.60,entries:[{id:1,kind:'bet',amount:-10,balance:990,operationId:id,createdAt:1},{id:2,kind:'win',amount:19.60,balance:1009.60,operationId:id,createdAt:2}]},session:won,sessions:[corrupt?lost:won],replayed:!corrupt};},{id:operation.id,corrupt:calls===1});
    await route.fulfill({status:200,json:reply});
  });
  await page.locator('[data-start]').click();await expect(page.locator('[data-retry]')).toBeEnabled();
  const pending=await page.evaluate(()=>{const probe=(window as any).studioProbe;return{id:probe.client.pending?.id,saved:JSON.parse(sessionStorage.getItem('royal-expansion:'+probe.client.accountId)!).id,sessions:probe.client.sessions.length};});
  expect(pending).toEqual({id:ids[0],saved:ids[0],sessions:0});await expect(page.locator('[data-studio-balance]')).toHaveText(/1\s000,00/);
  await page.locator('[data-retry]').click();await expect(page.locator('[data-retry]')).toHaveCount(0);await expect(page.locator('[data-studio-balance]')).toHaveText(/1\s009,60/);
  expect(calls).toBe(2);expect(new Set(ids).size).toBe(1);
  expect(await page.evaluate(()=>{const probe=(window as any).studioProbe;return{won:probe.client.sessions[0].view.studio.won,pending:!!probe.client.pending,saved:sessionStorage.getItem('royal-expansion:'+probe.client.accountId),bets:probe.client.wallet.entries.filter((entry:any)=>entry.kind==='bet').length,wins:probe.client.wallet.entries.filter((entry:any)=>entry.kind==='win').length};})).toEqual({won:true,pending:false,saved:null,bets:1,wins:1});
});

test('incorrect outer phase, state and bonus actions keep one pending operation until a canonical snapshot',async({page})=>{
  await ready(page);await mount(page,'studio-caramel-carnival');const ids:string[]=[];let calls=0;
  await page.route('**/api/demo-wallet/expansion',async route=>{
    const operation=route.request().postDataJSON();ids.push(operation.id);const mutation=calls++;
    const reply=await page.evaluate(({id,mutation})=>{const probe=(window as any).studioProbe,session=probe.session('studio-caramel-carnival',probe.fixtures.caramelBonus,id);if(mutation===0)session.view.ended=true;if(mutation===1)session.view.phase=-1;if(mutation===2)session.view.phase=1.5;if(mutation===3)session.view.actions=[{move:'cashout',label:'Забрать',cost:0}];if(mutation===4)session.view.actions[0].cost=5000;return{wallet:{balance:990,entries:[{id:1,kind:'bet',amount:-10,balance:990,operationId:id,createdAt:1}]},session,sessions:[structuredClone(session)],replayed:mutation>0};},{id:operation.id,mutation});
    await route.fulfill({status:200,json:reply});
  });
  await page.locator('[data-start]').click();
  for(let mutation=0;mutation<5;mutation++){
    await expect(page.locator('[data-retry]')).toBeEnabled();
    expect(await page.evaluate(()=>(window as any).studioProbe.client.pending?.id)).toBe(ids[0]);
    await expect(page.locator('[data-studio-balance]')).toHaveText(/1\s000,00/);
    await page.locator('[data-retry]').click();
    await expect.poll(()=>calls).toBe(mutation+2);
  }
  await expect(page.locator('[data-retry]')).toHaveCount(0);await expect(page.locator('[data-move="studio-spin"]')).toBeEnabled();await expect(page.locator('[data-studio-balance]')).toHaveText('990,00');
  expect(calls).toBe(6);expect(new Set(ids).size).toBe(1);expect(await page.evaluate(()=>{const client=(window as any).studioProbe.client;return{bets:client.wallet.entries.filter((entry:any)=>entry.kind==='bet').length,pending:!!client.pending};})).toEqual({bets:1,pending:false});
});

test('fresh responses require their own saved UUID while a replay may show a newer legitimate round',async({page})=>{
  await ready(page);await mount(page,'studio-signal-fox');const ids:string[]=[];let calls=0;const newerId='30000000-0000-4000-8000-000000000005';
  await page.route('**/api/demo-wallet/expansion',async route=>{
    const operation=route.request().postDataJSON();ids.push(operation.id);calls++;
    const reply=await page.evaluate(({id,newerId,replayed})=>{const probe=(window as any).studioProbe,old=probe.session('studio-signal-fox',probe.fixtures.diceWon,id),latest=probe.session('studio-signal-fox',probe.fixtures.diceLost,newerId);return{wallet:{balance:999.60,entries:[{id:1,kind:'bet',amount:-10,balance:990,operationId:id,createdAt:1},{id:2,kind:'win',amount:19.60,balance:1009.60,operationId:id,createdAt:2},{id:3,kind:'bet',amount:-10,balance:999.60,operationId:newerId,createdAt:3},{id:4,kind:'win',amount:0,balance:999.60,operationId:newerId,createdAt:4}]},session:old,sessions:[latest],replayed};},{id:operation.id,newerId,replayed:calls>1});
    await route.fulfill({status:200,json:reply});
  });
  await page.locator('[data-start]').click();await expect(page.locator('[data-retry]')).toBeEnabled();await expect(page.locator('[data-studio-balance]')).toHaveText(/1\s000,00/);
  expect(await page.evaluate(()=>(window as any).studioProbe.client.pending?.id)).toBe(ids[0]);
  await page.locator('[data-retry]').click();await expect(page.locator('[data-retry]')).toHaveCount(0);await expect(page.locator('[data-studio-balance]')).toHaveText('999,60');
  expect(calls).toBe(2);expect(new Set(ids).size).toBe(1);
  expect(await page.evaluate(()=>{const client=(window as any).studioProbe.client;return{id:client.sessions[0].id,pending:!!client.pending};})).toEqual({id:newerId,pending:false});
});

test('a saved start must confirm its exact stake and choices for all four configurable families',async({page})=>{
  const examples=[
    {game:'studio-signal-fox',canonical:'diceWon',corrupt:['diceLarger','diceAlternate']},
    {game:'studio-mosaic-muse',canonical:'keno',corrupt:['kenoAlternate']},
    {game:'studio-obsidian-drop',canonical:'plinko',corrupt:['plinkoAlternate']},
    {game:'studio-lucky-spotlight',canonical:'wheel',corrupt:['wheelAlternate']},
  ];
  for(const example of examples){
    await ready(page);await mount(page,example.game);const ids:string[]=[];let calls=0;
    await page.route('**/api/demo-wallet/expansion',async route=>{
      const operation=route.request().postDataJSON();ids.push(operation.id);const mutation=calls++,fixture=example.corrupt[mutation]??example.canonical;
      const reply=await page.evaluate(({id,game,fixture,replayed})=>{const probe=(window as any).studioProbe,session=probe.session(game,probe.fixtures[fixture],id);if(fixture==='diceLarger'){session.stakeUnits='5000';session.spentUnits='5000';}const stake=Number(session.stakeUnits)/100,paid=Number(session.returnedUnits)/100;return{wallet:{balance:1000-stake+paid,entries:[{id:1,kind:'bet',amount:-stake,balance:1000-stake,operationId:id,createdAt:1},{id:2,kind:'win',amount:paid,balance:1000-stake+paid,operationId:id,createdAt:2}]},session,sessions:[structuredClone(session)],replayed};},{id:operation.id,game:example.game,fixture,replayed:mutation>0});
      await route.fulfill({status:200,json:reply});
    });
    await page.locator('[data-start]').click();
    for(let mutation=0;mutation<example.corrupt.length;mutation++){
      await expect(page.locator('[data-retry]')).toBeEnabled();await expect(page.locator('[data-studio-balance]')).toHaveText(/1\s000,00/);
      expect(await page.evaluate(()=>(window as any).studioProbe.client.pending?.id)).toBe(ids[0]);await page.locator('[data-retry]').click();await expect.poll(()=>calls).toBe(mutation+2);
    }
    await expect(page.locator('[data-retry]')).toHaveCount(0);expect(new Set(ids).size).toBe(1);
    expect(await page.evaluate(()=>{const client=(window as any).studioProbe.client;return{pending:!!client.pending,bets:client.wallet.entries.filter((entry:any)=>entry.kind==='bet').length,stake:client.sessions[0].stakeUnits};})).toEqual({pending:false,bets:1,stake:'1000'});
    await page.unroute('**/api/demo-wallet/expansion');
  }
});
