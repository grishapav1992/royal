import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult,type StudioState} from '../server/games/studioGames';
import {STUDIO_DEFAULTS,STUDIO_INFO,validStudioSlotPresentation,validStudioSettlement,validStudioEnvelope,type StudioSlotView,type StudioPresentationGameId,type StudioSlotPresentation} from '../src/shared/studioGames';
import type {ExpansionAction,ExpansionSession} from '../src/shared/casinoExpansion';
import type {DemoWallet} from '../src/shared/demoWallet';

const accountA='11111111-1111-4111-8111-111111111111',accountB='22222222-2222-4222-8222-222222222222';
const directory='artifacts/studio-wave4-20261012/tests';
type Game='studio-lumen-grove'|'studio-prism-atelier';
type Golden={name:string;gameId:Game;stops:number[];seeds:number[];results:StudioResult[]};
const golden=JSON.parse(readFileSync(new URL('../server-tests/fixtures/studio-cluster-presentation-v1.json',import.meta.url),'utf8')) as Golden[];
type Kind='maximum'|'minimum'|'noBonus'|'noCluster'|'multipleClusters'|'fourClusters';
type State={wallet:DemoWallet;sessions:ExpansionSession[];engine?:StudioState;ids:Map<string,Reply>};
type Reply={wallet:DemoWallet;sessions:ExpansionSession[];session:ExpansionSession;replayed:boolean};
function fixture(game:Game,kind:Kind,stake='1000'):StudioResult {
  const item=golden.find(row=>row.gameId===game&&row.name===kind);if(!item)throw Error('Missing frozen reachable fixture');
  const values=[...item.stops,...item.seeds],result=startStudioGame(game,STUDIO_DEFAULTS[game],stake,()=>values.shift()!);
  if(stake==='1000')expect(result).toEqual(item.results[0]);return result;
}
test.beforeAll(()=>{for(const item of golden){const values=[...item.stops,...item.seeds];let result=startStudioGame(item.gameId,STUDIO_DEFAULTS[item.gameId],'1000',()=>values.shift()!);expect(result).toEqual(item.results[0]);for(const expected of item.results.slice(1)){result=moveStudioGame(item.gameId,result.engine,'studio-spin',undefined,'1000');expect(result).toEqual(expected);}}});
function session(game:Game,id:string,stake:string,result:StudioResult):ExpansionSession {
  const studio=result.studio as StudioSlotView;
  const saved:ExpansionSession={id,gameId:game,rulesVersion:1,state:result.ended?'settled':'active',stakeUnits:stake,spentUnits:stake,returnedUnits:String(result.credit),
    view:{studio,player:[],dealer:[],community:[],actions:result.ended?[]:[{move:'studio-spin',label:'Бесплатное вращение',cost:0}],phase:result.ended?1:studio.step+1,ended:result.ended,message:result.message}};
  expect(validStudioSettlement(game,saved.state,stake,stake,saved.returnedUnits,studio)).toBe(true);
  expect(validStudioEnvelope(game,saved.state,saved.view)).toBe(true);return saved;
}
function probe(game:Game){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>#host{width:min(100%,680px);margin:auto}#qa-unlock{position:fixed;bottom:8px;right:8px;z-index:100000}</style></head><body><dialog id="mini-dialog" class="mini-dialog originals-mode wallet-game-mode"><div class="mini-top"><div><span class="eyebrow">НОВЫЕ МИРЫ / ЭТАЖ 1</span><h2>${STUDIO_INFO[game].name}</h2></div><button class="icon-button" aria-label="Вернуться в зал">×</button></div><div class="mini-stage"><div id="mini-game"><div id="host"></div></div></div><div class="mini-bottom"><span>Общий тестовый кошелёк клуба</span></div><button id="qa-unlock">Проверка звука</button></dialog><script type="module">
import {StudioGamesUI} from '/src/ui/StudioGamesUI.ts';import {expansionClient as client} from '/src/wallet/ExpansionClient.ts';import {demoWallet} from '/src/wallet/WalletClient.ts';import {gameAudio} from '/src/game/GameAudio.ts';import '/src/wallet.css';import '/src/style.css';import '/src/paper-theme.css';import '/src/own-cabinets.css';
let ui,hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
gameAudio.install();gameAudio.setGame('${game}');document.getElementById('qa-unlock').onclick=()=>gameAudio.unlock();
const p={client,demoWallet,audio:gameAudio,events:[],mount(){ui?.destroy();ui=new StudioGamesUI(document.getElementById('host'),'${game}');},close(){ui?.destroy();ui=undefined;},visibility(value){hidden=value;document.dispatchEvent(new Event('visibilitychange'));},switchAccount(id){demoWallet.setAccount(id);},capture(){const root=document.querySelector('[data-cluster-slot]');if(!root)return;const pay=root.querySelector('[data-cluster-payout]');p.events.push({at:performance.now(),phase:root.dataset.phase,token:root.dataset.animationToken,session:root.dataset.sessionId,step:Number(root.dataset.step),presentation:root.dataset.presentation,reels:[...root.querySelectorAll('[data-cluster-reel]')].map(reel=>reel.dataset.state),tracks:[...root.querySelectorAll('[data-cluster-track]')].map(track=>track.style.transform),payout:Number(pay.dataset.units),target:Number(pay.dataset.targetUnits),grid:[...root.querySelectorAll('[data-cluster-cell]')].sort((a,b)=>Number(a.dataset.clusterCell)-Number(b.dataset.clusterCell)).map(cell=>Number(cell.dataset.symbol)),activeGroup:root.dataset.activeGroup??'',activeCollector:root.dataset.activeCollector??'',collected:[...root.querySelectorAll('[data-cluster-collected-seed]')].map(node=>({position:Number(node.dataset.clusterCollectedSeed),collector:Number(node.dataset.collector)})),values:[...root.querySelectorAll('[data-cluster-value]')].map(node=>({position:Number(node.dataset.clusterValue),value:Number(node.dataset.value)})),trace:root.dataset.clusterTrace?JSON.parse(root.dataset.clusterTrace):null});},reset(){p.events=[];p.capture();},state(){return{account:client.accountId,busy:client.busy,pending:client.pending,error:client.error,sessions:client.sessions,audio:gameAudio.getState(),events:p.events};}};
new MutationObserver(()=>p.capture()).observe(document.getElementById('host'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase','data-state','data-units','data-target-units','data-session-id','data-animation-token','data-step','data-active-group','data-symbol','data-active-collector','class','style']});window.slotProbe=p;document.getElementById('mini-dialog').showModal();demoWallet.setAccount('${accountA}');
</script></body></html>`;}

class Casino {
  states=new Map<string,State>([[accountA,{wallet:{balance:1000,entries:[]},sessions:[],ids:new Map()}],[accountB,{wallet:{balance:2000,entries:[]},sessions:[],ids:new Map()}]]);
  posts:{account:string;op:ExpansionAction}[]=[];metadata:{account:string;query:Record<string,string>}[]=[];gets=0;kind:Kind='maximum';
  postHandler?:(route:Route,reply:Reply,index:number)=>Promise<void>;
  metadataHandler?:(route:Route,value:StudioSlotPresentation,index:number)=>Promise<void>;
  constructor(private page:Page,readonly game:Game){}
  saved(kind:Kind='maximum',finish=false){const result=fixture(this.game,kind),state=this.states.get(accountA)!;let current=result;
    if(finish)while(!current.ended)current=moveStudioGame(this.game,current.engine,'studio-spin',undefined,'1000');
    state.engine=current.engine;state.sessions=[session(this.game,'33333333-3333-4333-8333-333333333333','1000',current)];state.wallet.balance=1000-10+current.credit/100;
  }
  async install(){
    await this.page.route('**/api/demo-wallet',route=>route.fulfill({status:200,json:this.states.get(route.request().headers()['x-royal-account-id'])!.wallet}));
    await this.page.route('**/api/demo-wallet/expansion',async route=>{
      const account=route.request().headers()['x-royal-account-id'],state=this.states.get(account)!;expect(state).toBeDefined();
      if(route.request().method()==='GET'){this.gets++;return route.fulfill({status:200,json:{wallet:state.wallet,sessions:state.sessions}});}
      const op=route.request().postDataJSON() as ExpansionAction;expect(op.gameId).toBe(this.game);this.posts.push({account,op});
      let reply=state.ids.get(op.id);
      if(reply)reply={...structuredClone(reply),replayed:true};
      else{
        const prior=state.sessions[0];expect(op.action==='start'||op.action==='move').toBe(true);
        if(op.action==='move'){expect(op.move).toBe('studio-spin');expect(op.sessionId).toBe(prior.id);expect(op).not.toHaveProperty('stakeUnits');}
        const stake=op.action==='start'?op.stakeUnits:prior.stakeUnits,result=op.action==='start'?fixture(this.game,this.kind,stake):moveStudioGame(this.game,state.engine,'studio-spin',undefined,stake);
        const saved=session(this.game,op.action==='start'?op.id:prior.id,stake,result),entries=state.wallet.entries,newest=entries.reduce((n,e)=>Math.max(n,e.id),0);
        let balance=state.wallet.balance;if(op.action==='start'){balance-=Number(stake)/100;entries.push({id:newest+1,kind:'bet',amount:-Number(stake)/100,balance,operationId:op.id,createdAt:newest+1});}
        if(result.ended){balance+=result.credit/100;entries.push({id:newest+2,kind:'win',amount:result.credit/100,balance,operationId:op.id,createdAt:newest+2});}
        state.wallet={balance,entries};state.sessions=[saved];state.engine=result.engine;
        reply={wallet:structuredClone(state.wallet),sessions:[structuredClone(saved)],session:structuredClone(saved),replayed:false};state.ids.set(op.id,reply);
      }
      if(this.postHandler)return this.postHandler(route,reply,this.posts.length);return route.fulfill({status:200,json:reply});
    });
    await this.page.route('**/api/demo-wallet/expansion/presentation?*',async route=>{
      expect(route.request().method()).toBe('GET');const account=route.request().headers()['x-royal-account-id'],state=this.states.get(account)!;
      const query=Object.fromEntries(new URL(route.request().url()).searchParams);expect(Object.keys(query).sort()).toEqual(['phase','sessionId','step']);this.metadata.push({account,query});
      const saved=state.sessions[0];if(!saved||saved.id!==query.sessionId)return route.fulfill({status:404,json:{error:'Партия не найдена'}});
      if(saved.view.phase!==Number(query.phase)||(saved.view.studio as StudioSlotView).step!==Number(query.step))return route.fulfill({status:409,json:{error:'Этап уже изменился'}});
      const value={version:1 as const,sessionId:saved.id,phase:saved.view.phase,...currentStudioSlotPresentation(this.game,state.engine)};
      expect(validStudioSlotPresentation(value,this.game,saved.id,saved.view.phase,saved.view.studio as StudioSlotView)).toBe(true);
      if(this.metadataHandler)return this.metadataHandler(route,value,this.metadata.length);return route.fulfill({status:200,json:value});
    });
  }
  holdPost(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});this.postHandler=async(route,reply)=>{await promise;await route.fulfill({status:200,json:reply});};return release;}
  holdMetadata(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});this.metadataHandler=async(route,value)=>{await promise;await route.fulfill({status:200,json:value}).catch(()=>{});};return release;}
}
async function ready(page:Page,game:Game,options:{saved?:Kind;finish?:boolean;mobile?:boolean;reduced?:boolean;muted?:boolean}={}){
  mkdirSync(directory,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const casino=new Casino(page,game);if(options.saved)casino.saved(options.saved,options.finish);await casino.install();
  if(options.mobile)await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:options.reduced?'reduce':'no-preference'});
  await page.addInitScript(muted=>{localStorage.setItem('royal-muted',muted?'1':'0');localStorage.setItem('royal-volume','.12');localStorage.setItem('royal-casino-ambience','0');},!!options.muted);
  await page.route('**/studio-slot-probe',route=>route.fulfill({status:200,contentType:'text/html',body:probe(game)}));await page.goto('/studio-slot-probe');
  await page.waitForFunction(()=>{const p=(window as any).slotProbe;return p&&!p.client.loading&&p.demoWallet.wallet;});await page.evaluate(()=>(window as any).slotProbe.mount());
  await expect(page.locator('[data-studio-slot]')).toBeVisible();await expect(page.locator('[data-cluster-spin]')).toBeEnabled();await page.evaluate(()=>document.fonts.ready);
  await page.locator('#qa-unlock').click();await expect.poll(()=>page.evaluate(()=>(window as any).slotProbe.audio.getState().context)).toBe('running');await page.locator('#qa-unlock').evaluate(element=>element.remove());return {casino,errors};
}
async function audio(page:Page,game:Game){return page.evaluate(game=>(window as any).slotProbe.audio.getState().slot.byGame[game],game);}
async function events(page:Page){return page.evaluate(()=>(window as any).slotProbe.events as {at:number;phase:string;token:string;session:string;step:number;reels:string[];tracks:string[];payout:number;target:number;grid:number[];activeGroup:string;activeCollector:string;collected:{position:number;collector:number}[];values:{position:number;value:number}[];trace:any}[]);}
async function done(page:Page,casino:Casino,account=accountA){const saved=casino.states.get(account)!.sessions[0],view=saved.view.studio as StudioSlotView;
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id',saved.id);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step',String(view.step));
  await expect(page.locator('[data-cluster-payout]')).toHaveAttribute('data-units',view.totalPayoutUnits);await expect(page.locator('[data-cluster-payout]')).toHaveAttribute('data-target-units',view.totalPayoutUnits);
  await expect(page.locator('[data-cluster-spin]')).toBeEnabled();await expect(page.locator('[data-cluster-reel][data-state="stopped"]')).toHaveCount(6);
  expect(await page.locator('[data-cluster-cell]').evaluateAll(elements=>elements.toSorted((a,b)=>Number((a as HTMLElement).dataset.clusterCell)-Number((b as HTMLElement).dataset.clusterCell)).map(element=>Number((element as HTMLElement).dataset.symbol)))).toEqual(view.grid);
  await expect(page.locator('[data-cluster-balance]')).toHaveText(casino.states.get(account)!.wallet.balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}));return saved;
}
async function geometry(page:Page,label:string){const bounds=await page.evaluate(()=>{const d=document.querySelector('dialog')!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dialog:{top:d.top,bottom:d.bottom},core:['[data-cluster-reels]','[data-cluster-stake]','[data-cluster-spin]'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});
  for(const r of bounds.core){expect(r.left,label).toBeGreaterThanOrEqual(0);expect(r.right,label).toBeLessThanOrEqual(bounds.width);expect(r.top,label).toBeGreaterThanOrEqual(Math.max(0,bounds.dialog.top));expect(r.bottom,label).toBeLessThanOrEqual(Math.min(bounds.height,bounds.dialog.bottom));}
  writeFileSync(`${directory}/${label}-geometry.json`,JSON.stringify(bounds,null,2));return bounds;
}

function assertMonotonic(stream:Awaited<ReturnType<typeof events>>,step:number,from=0){
  const values=stream.filter(e=>e.token&&e.phase==='result'&&e.step===step).map(e=>e.payout);expect(values.length).toBeGreaterThan(0);
  expect(values.every(value=>Number.isInteger(value)&&value>=from)).toBe(true);for(let i=1;i<values.length;i++)expect(values[i]).toBeGreaterThanOrEqual(values[i-1]);
}

for(const game of ['studio-lumen-grove','studio-prism-atelier'] as const){
  test(`${game} real six-reel base and both free stages use exact groups with one bet`,async({page})=>{
    const {casino,errors}=await ready(page,game),release=casino.holdPost();await geometry(page,game+'-desktop');
    await page.locator('[data-cluster-spin]').click();await page.locator('[data-cluster-spin]').dispatchEvent('click');
    await expect(page.locator('[data-cluster-reel][data-state="moving"]')).toHaveCount(6);expect(casino.posts).toHaveLength(1);
    const first=await page.locator('[data-cluster-track]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).style.transform));await page.waitForTimeout(120);
    await expect.poll(()=>page.locator('[data-cluster-track]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).style.transform))).not.toEqual(first);
    await expect(page.locator('[data-cluster-track]')).toHaveCount(6);expect(await page.locator('[data-cluster-track]').first().locator('.cluster-track-symbol').count()).toBe(STUDIO_INFO[game].rows*2+12);
    release();casino.postHandler=undefined;let saved=await done(page,casino);await page.screenshot({path:`${directory}/${game}-base-desktop.png`});
    for(let step=1;step<=2;step++){const from=Number((saved.view.studio as StudioSlotView).totalPayoutUnits);await page.evaluate(()=>(window as any).slotProbe.reset());await page.locator('[data-cluster-spin]').click();await expect(page.locator('[data-cluster-reel][data-state="moving"]')).toHaveCount(6);saved=await done(page,casino);assertMonotonic(await events(page),step,from);}
    expect(saved.returnedUnits).toBe(game==='studio-lumen-grove'?'4347':'4518');await expect(page.locator('[data-cluster-bigwin]')).toBeVisible();
    const state=casino.states.get(accountA)!,cues=await audio(page,game);expect(state.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(1);expect(state.wallet.entries.filter(entry=>entry.kind==='win')).toHaveLength(1);
    expect(cues.played.click).toBe(1);expect(cues.played['reel-stop']).toBe(18);expect(cues.played['free-stage']).toBe(2);expect(cues.played.bigwin).toBe(1);expect(casino.posts).toHaveLength(3);expect(casino.metadata).toHaveLength(3);
    await page.screenshot({path:`${directory}/${game}-bigwin-desktop.png`});writeFileSync(`${directory}/${game}-full-round.json`,JSON.stringify({saved,posts:casino.posts,wallet:state.wallet,cues},null,2));expect(errors).toEqual([]);
  });
}
test('Lumen only first two real collectors gather all seeds without removing original symbols',async({page})=>{
  const game='studio-lumen-grove' as const,{casino,errors}=await ready(page,game);casino.kind='noCluster';await page.locator('[data-cluster-spin]').click();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView,stream=await events(page);
  const collects=view.wins.flatMap((win,winIndex)=>win.kind==='collect'?[{winIndex,collector:win.positions[0],coins:win.positions.slice(1)}]:[]);expect(collects).toHaveLength(2);
  expect(collects.map(item=>item.collector)).toEqual(view.grid.flatMap((symbol,i)=>symbol===4?[i]:[]).slice(0,2));
  for(const collect of collects){const frames=stream.filter(frame=>frame.activeCollector===String(collect.collector)&&frame.collected.length);expect(frames.length).toBeGreaterThan(0);expect(frames.some(frame=>frame.collected.map(item=>item.position).toSorted((a,b)=>a-b).join()===collect.coins.toSorted((a,b)=>a-b).join())).toBe(true);expect(frames.every(frame=>JSON.stringify(frame.grid)===JSON.stringify(view.grid))).toBe(true);}
  expect((await audio(page,game)).played.collect).toBe(2);await expect(page.locator('[data-cluster-collect-layer]')).toHaveCount(0);expect(errors).toEqual([]);
});
test('Prism four actual groups remain separate and all 36 cell values match confirmed sums',async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game);casino.kind='fourClusters';await page.locator('[data-cluster-spin]').click();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView;
  expect(view.wins).toHaveLength(4);await expect(page.locator('[data-cluster-group-button]')).toHaveCount(4);expect((await audio(page,game)).played.group).toBe(4);
  const values=await page.locator('[data-cluster-value]').evaluateAll(nodes=>nodes.map(node=>({position:Number((node as HTMLElement).dataset.clusterValue),value:Number((node as HTMLElement).dataset.value)})).toSorted((a,b)=>a.position-b.position));
  expect(values).toEqual(Array.from({length:36},(_,position)=>({position,value:1+position%3})));expect((await audio(page,game)).played['cell-values']).toBe(1);
  const stream=await events(page);for(let index=0;index<4;index++)expect(stream.some(frame=>frame.activeGroup===String(index))).toBe(true);
  expect(await page.locator('[data-cluster-paytable] .symbol-3').count()).toBe(0);await page.screenshot({path:`${directory}/prism-four-groups.png`});expect(errors).toEqual([]);
});
test('Prism three empty stages still spin six reels and keep an exact zero cumulative award',async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game);casino.kind='minimum';for(let step=0;step<3;step++){await page.locator('[data-cluster-spin]').click();const saved=await done(page,casino);expect((saved.view.studio as StudioSlotView).totalPayoutUnits).toBe('0');expect(saved.state).toBe(step===2?'settled':'active');}
  expect(casino.posts).toHaveLength(3);expect((await audio(page,game)).played['reel-stop']).toBe(18);expect((await audio(page,game)).played.click).toBe(1);expect((await audio(page,game)).played.group??0).toBe(0);expect((await audio(page,game)).played.loss).toBe(3);expect(errors).toEqual([]);
});
test('Lumen reachable no-bonus partial return ends after one round without extra stage',async({page})=>{
  const game='studio-lumen-grove' as const,{casino,errors}=await ready(page,game);casino.kind='minimum';await page.locator('[data-cluster-spin]').click();const saved=await done(page,casino);expect(saved.returnedUnits).toBe('78');expect(saved.state).toBe('settled');await expect(page.locator('[data-cluster-spin]')).toHaveAttribute('data-start','');expect(casino.posts).toHaveLength(1);expect((await audio(page,game)).played.return).toBe(1);expect(errors).toEqual([]);
});
for(const kind of ['start','move'] as const)test(`Lost committed ${kind} survives reopening and retries the same UUID without another debit or effects`,async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,kind==='move'?{saved:'maximum'}:{});casino.postHandler=async(route,reply,index)=>index===1?route.abort('failed'):route.fulfill({status:200,json:reply});
  await page.locator('[data-cluster-spin]').click();await expect(page.locator('[data-cluster-retry]')).toBeVisible();const first=casino.posts[0].op;expect(first.action).toBe(kind);
  await page.evaluate(()=>{(window as any).slotProbe.close();(window as any).slotProbe.mount();});await page.locator('[data-cluster-retry]').click();await done(page,casino);
  expect(casino.posts[1].op).toEqual(first);expect(casino.posts).toHaveLength(2);expect(casino.metadata).toHaveLength(0);expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(kind==='start'?1:0);
  for(const label of ['group','collect','cell-values','reel-stop','bigwin'])expect((await audio(page,game)).played[label]??0).toBe(0);expect(errors).toEqual([]);
});
test('Saved history, refresh and reopen show canonical fields with no repeated sounds or animation',async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,{saved:'maximum',finish:true});await done(page,casino);
  for(let step=0;step<3;step++){await page.locator(`[data-cluster-frame="${step}"]`).click();const view=casino.states.get(accountA)!.sessions[0].view.studio as StudioSlotView;expect(await page.locator('[data-cluster-cell]').evaluateAll(nodes=>nodes.toSorted((a,b)=>Number((a as HTMLElement).dataset.clusterCell)-Number((b as HTMLElement).dataset.clusterCell)).map(node=>Number((node as HTMLElement).dataset.symbol)))).toEqual(view.history[step].grid);}
  await page.locator('[data-cluster-refresh]').click();await expect.poll(()=>casino.gets).toBeGreaterThan(1);expect(casino.posts).toHaveLength(0);expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});expect(errors).toEqual([]);
});
for(const failure of ['missing','forged','slow'] as const)test(`${failure} metadata preserves the canonical result without fictitious group effects`,async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,{saved:'maximum'});let release:undefined|(()=>void);
  if(failure==='missing')casino.metadataHandler=async route=>route.fulfill({status:404,json:{error:'Показ недоступен'}});
  else if(failure==='forged')casino.metadataHandler=async(route,value)=>route.fulfill({status:200,json:{...value,cluster:{...value.cluster,groupFactors:[{winIndex:0,factor:999}]}}});else release=casino.holdMetadata();
  await page.locator('[data-cluster-spin]').click();await done(page,casino);release?.();await expect(page.locator('[data-cluster-slot]')).toHaveAttribute('data-presentation','static');await expect(page.locator('[data-cluster-value]')).toHaveCount(36);
  for(const label of ['group','collect','cell-values','free-stage','bigwin'])expect((await audio(page,game)).played[label]??0).toBe(0);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
});
test('Reduced motion and mute retain exact result, with no moving tracks or voices',async({page})=>{
  const game='studio-lumen-grove' as const,{casino,errors}=await ready(page,game,{saved:'maximum',reduced:true,muted:true});await page.locator('[data-cluster-spin]').click();await done(page,casino);expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});expect((await audio(page,game)).activeSources).toBe(0);expect((await events(page)).some(frame=>['revealing','collecting','stopping'].includes(frame.phase))).toBe(false);expect(errors).toEqual([]);
});
for(const action of ['close','hidden','account'] as const)test(`${action} cancels pending metadata and prevents late cross-account effects`,async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,{saved:'maximum'}),release=casino.holdMetadata();await page.locator('[data-cluster-spin]').click();await expect.poll(()=>casino.metadata.length).toBe(1);
  await page.evaluate(action=>{const p=(window as any).slotProbe;if(action==='close')p.close();else if(action==='hidden')p.visibility(true);else p.switchAccount('22222222-2222-4222-8222-222222222222');},action);release();
  if(action==='close'){await page.evaluate(()=>(window as any).slotProbe.mount());await done(page,casino);}else if(action==='hidden'){await page.evaluate(()=>(window as any).slotProbe.visibility(false));await done(page,casino);}else{await page.waitForFunction(()=>(window as any).slotProbe.client.accountId==='22222222-2222-4222-8222-222222222222'&&!(window as any).slotProbe.client.loading);await expect(page.locator('[data-cluster-slot]')).toHaveAttribute('data-session-id','');await expect(page.locator('[data-cluster-payout]')).toHaveAttribute('data-units','0');}
  await expect.poll(async()=>(await audio(page,game)).activeSources).toBe(0);for(const label of ['group','collect','cell-values','free-stage','bigwin'])expect((await audio(page,game)).played[label]??0).toBe(0);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
});
test('Core controls fit both fields on small phones and a 720px desktop',async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,{saved:'maximum'});for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:375,height:667}]){await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);await geometry(page,`prism-${viewport.width}x${viewport.height}`);await page.screenshot({path:`${directory}/prism-${viewport.width}x${viewport.height}.png`});}expect(casino.posts).toHaveLength(0);expect(errors).toEqual([]);
});
test('Early RAF timestamps clamp base and free cumulative counters at their saved lower bound',async({page})=>{
  await page.addInitScript(()=>{const original=requestAnimationFrame,applied=new Set<string>();window.requestAnimationFrame=callback=>original.call(window,time=>{const root=document.querySelector('[data-cluster-slot]') as HTMLElement|null,token=root?.dataset.animationToken;if(token&&root?.dataset.phase==='result'&&!applied.has(token)){applied.add(token);callback(time-80);}else callback(time);});});
  const game='studio-lumen-grove' as const,{casino,errors}=await ready(page,game);await page.locator('[data-cluster-spin]').click();let saved=await done(page,casino);assertMonotonic(await events(page),0,0);const from=Number((saved.view.studio as StudioSlotView).totalPayoutUnits);await page.evaluate(()=>(window as any).slotProbe.reset());await page.locator('[data-cluster-spin]').click();saved=await done(page,casino);assertMonotonic(await events(page),1,from);writeFileSync(`${directory}/early-raf-counter.json`,JSON.stringify(await events(page),null,2));expect(errors).toEqual([]);
});
async function exactValues(page:Page,step:number){const actual=await page.locator('[data-cluster-value]').evaluateAll(nodes=>nodes.map(node=>({position:Number((node as HTMLElement).dataset.clusterValue),value:Number((node as HTMLElement).dataset.value)})).toSorted((a,b)=>a.position-b.position));expect(actual).toEqual(Array.from({length:36},(_,position)=>({position,value:1+(position+step)%3})));}
test('Cold Prism reload and every saved history step retain exact static cell values without effects',async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,{saved:'maximum',finish:true});await done(page,casino);await exactValues(page,2);
  for(let step=0;step<3;step++){await page.locator(`[data-cluster-frame="${step}"]`).click();await exactValues(page,step);expect(await page.locator('[data-cluster-value]').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).animationName))).toEqual(Array(36).fill('none'));}
  await page.reload();await page.waitForFunction(()=>{const p=(window as any).slotProbe;return p&&!p.client.loading&&p.demoWallet.wallet;});await page.evaluate(()=>(window as any).slotProbe.mount());await done(page,casino);await exactValues(page,2);
  await page.locator('[data-cluster-frame="0"]').click();await exactValues(page,0);await page.locator('[data-cluster-group-button="0"]').click();const view=casino.states.get(accountA)!.sessions[0].view.studio as StudioSlotView,first=view.history[0].wins[0],factor=first.positions.reduce((sum,position)=>sum+1+position%3,0);await expect(page.locator('[data-cluster-feature]')).toContainText(`сила ${factor}`);
  expect(casino.posts).toHaveLength(0);expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});await page.screenshot({path:`${directory}/prism-cold-history-values.png`});expect(errors).toEqual([]);
});
test('Reduced Prism keeps current free-stage values and cumulative total static on a phone',async({page})=>{
  const game='studio-prism-atelier' as const,{casino,errors}=await ready(page,game,{saved:'maximum',reduced:true,muted:true,mobile:true});await exactValues(page,0);await page.locator('[data-cluster-spin]').click();await done(page,casino);await exactValues(page,1);
  await page.locator('[data-cluster-frame="0"]').click();await exactValues(page,0);await page.locator('[data-cluster-frame="1"]').click();await exactValues(page,1);expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});await geometry(page,'prism-reduced-static-phone');await page.screenshot({path:`${directory}/prism-reduced-static-phone.png`});expect(errors).toEqual([]);
});
