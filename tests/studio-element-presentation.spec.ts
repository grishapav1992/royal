import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult,type StudioState} from '../server/games/studioGames';
import {STUDIO_DEFAULTS,STUDIO_INFO,validStudioSlotPresentation,validStudioSettlement,validStudioEnvelope,type StudioSlotView,type StudioPresentationGameId,type StudioSlotPresentation} from '../src/shared/studioGames';
import type {ExpansionAction,ExpansionSession} from '../src/shared/casinoExpansion';
import type {DemoWallet} from '../src/shared/demoWallet';

const accountA='11111111-1111-4111-8111-111111111111',accountB='22222222-2222-4222-8222-222222222222';
const directory='artifacts/studio-wave5-20261012/tests';
type Game='studio-stormforge-duel'|'studio-saffron-cipher'|'studio-beacon-bay';
type Golden={name:string;gameId:Game;stops:number[];seeds:number[];results:StudioResult[]};
const golden=JSON.parse(readFileSync(new URL('../server-tests/fixtures/studio-element-presentation-v1.json',import.meta.url),'utf8')) as Golden[];
type Kind='maximum'|'minimum'|'noBonus'|'zeroBase'|'bonusExample'|'destroyedScatter'|'transformedWithoutLine'|'wildFactor2'|'wildFactor3'|'wildFactor4'|'zeroFinalFree'|'chosenFallback'|'chosenTwo'|'chosenThree'|'nativeWildWithoutBeam';
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
const p={client,demoWallet,audio:gameAudio,events:[],mount(){ui?.destroy();ui=new StudioGamesUI(document.getElementById('host'),'${game}');},close(){ui?.destroy();ui=undefined;},visibility(value){hidden=value;document.dispatchEvent(new Event('visibilitychange'));},switchAccount(id){demoWallet.setAccount(id);},capture(){const root=document.querySelector('[data-element-slot]');if(!root)return;const pay=root.querySelector('[data-element-payout]');p.events.push({at:performance.now(),phase:root.dataset.phase,token:root.dataset.animationToken,session:root.dataset.sessionId,step:Number(root.dataset.step),presentation:root.dataset.presentation,reels:[...root.querySelectorAll('[data-element-reel]')].map(reel=>reel.dataset.state),tracks:[...root.querySelectorAll('[data-element-track]')].map(track=>track.style.transform),payout:Number(pay.dataset.units),target:Number(pay.dataset.targetUnits),grid:[...root.querySelectorAll('[data-element-cell]')].sort((a,b)=>Number(a.dataset.elementCell)-Number(b.dataset.elementCell)).map(cell=>Number(cell.dataset.symbol)),activeLine:root.dataset.activeLine??'',multiplier:root.dataset.multiplierFactor??'',multiplierWin:root.dataset.multiplierWinIndex??'',chosen:root.dataset.chosen?JSON.parse(root.dataset.chosen):null,transformEvents:root.dataset.transformEvents?JSON.parse(root.dataset.transformEvents):[],collected:[...root.querySelectorAll('[data-element-collected-seed]')].map(node=>({position:Number(node.dataset.clusterCollectedSeed),collector:Number(node.dataset.collector)})),values:[...root.querySelectorAll('[data-element-value]')].map(node=>({position:Number(node.dataset.elementValue),value:Number(node.dataset.value)})),trace:root.dataset.elementTrace?JSON.parse(root.dataset.elementTrace):null});},reset(){p.events=[];p.capture();},state(){return{account:client.accountId,busy:client.busy,pending:client.pending,error:client.error,sessions:client.sessions,audio:gameAudio.getState(),events:p.events};}};
new MutationObserver(()=>p.capture()).observe(document.getElementById('host'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase','data-state','data-units','data-target-units','data-session-id','data-animation-token','data-step','data-active-line','data-symbol','data-chosen','data-multiplier-factor','data-active-column','class','style']});window.slotProbe=p;document.getElementById('mini-dialog').showModal();demoWallet.setAccount('${accountA}');
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
  await expect(page.locator('[data-studio-slot]')).toBeVisible();await expect(page.locator('[data-element-spin]')).toBeEnabled();await page.evaluate(()=>document.fonts.ready);
  await page.locator('#qa-unlock').click();await expect.poll(()=>page.evaluate(()=>(window as any).slotProbe.audio.getState().context)).toBe('running');await page.locator('#qa-unlock').evaluate(element=>element.remove());return {casino,errors};
}
async function audio(page:Page,game:Game){return page.evaluate(game=>{const state=(window as any).slotProbe.audio.getState().slot.byGame[game];return{activeSources:0,loopOwners:0,...state,played:{...Object.fromEntries(['click','reel-stop','line','group','expand','multiplier','chosen','beam','free-stage','return','win','bigwin','loss'].map(cue=>[cue,0])),...state?.played}};},game);}
async function events(page:Page){return page.evaluate(()=>(window as any).slotProbe.events as {at:number;phase:string;token:string;session:string;step:number;reels:string[];tracks:string[];payout:number;target:number;grid:number[];activeLine:string;multiplier:string;multiplierWin:string;chosen:any;transformEvents:any[];collected:{position:number;collector:number}[];values:{position:number;value:number}[];trace:any}[]);}
async function done(page:Page,casino:Casino,account=accountA){const saved=casino.states.get(account)!.sessions[0],view=saved.view.studio as StudioSlotView;
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id',saved.id);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step',String(view.step));
  await expect(page.locator('[data-element-payout]')).toHaveAttribute('data-units',view.totalPayoutUnits);await expect(page.locator('[data-element-payout]')).toHaveAttribute('data-target-units',view.totalPayoutUnits);
  await expect(page.locator('[data-element-spin]')).toBeEnabled();await expect(page.locator('[data-element-reel][data-state="stopped"]')).toHaveCount(5);
  expect(await page.locator('[data-element-cell]').evaluateAll(elements=>elements.toSorted((a,b)=>Number((a as HTMLElement).dataset.elementCell)-Number((b as HTMLElement).dataset.elementCell)).map(element=>Number((element as HTMLElement).dataset.symbol)))).toEqual(view.grid);
  await expect(page.locator('[data-element-balance]')).toHaveText(casino.states.get(account)!.wallet.balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}));return saved;
}
async function geometry(page:Page,label:string){const bounds=await page.evaluate(()=>{const d=document.querySelector('dialog')!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dialog:{top:d.top,bottom:d.bottom},core:['[data-element-reels]','[data-element-stake]','[data-element-spin]'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});
  for(const r of bounds.core){expect(r.left,label).toBeGreaterThanOrEqual(0);expect(r.right,label).toBeLessThanOrEqual(bounds.width);expect(r.top,label).toBeGreaterThanOrEqual(Math.max(0,bounds.dialog.top));expect(r.bottom,label).toBeLessThanOrEqual(Math.min(bounds.height,bounds.dialog.bottom));}
  writeFileSync(`${directory}/${label}-geometry.json`,JSON.stringify(bounds,null,2));return bounds;
}

const games=['studio-stormforge-duel','studio-saffron-cipher','studio-beacon-bay'] as const;
for(const game of games){
  test(`${game} maximum paid and free frames use real reels, exact transforms and one bet`,async({page})=>{
    const {casino,errors}=await ready(page,game),release=casino.holdPost();
    await geometry(page,game+'-initial');await page.evaluate(()=>(window as any).originalSlot=document.querySelector('[data-studio-slot]'));
    await page.locator('[data-element-spin]').dblclick({force:true});await expect.poll(()=>casino.posts.length).toBe(1);await expect(page.locator('[data-element-reel][data-state="moving"]')).toHaveCount(5);
    const original=await page.locator('[data-element-track]').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).transform));
    await expect.poll(()=>page.locator('[data-element-track]').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).transform))).not.toEqual(original);release();
    let saved=await done(page,casino);const traces=[];
    while(true){
      const view=saved.view.studio as StudioSlotView,metadata=currentStudioSlotPresentation(game,casino.states.get(accountA)!.engine);
      expect(await page.locator('[data-studio-slot]').getAttribute('data-presentation')).toBe('available');
      traces.push({step:view.step,metadata,saved});
      const stream=await events(page),stops:{index:number;at:number}[]=[],seen=new Set<number>();
      for(const e of stream)for(let index=0;index<5;index++)if(e.token&&e.reels[index]==='stopped'&&!seen.has(index)){seen.add(index);stops.push({index,at:e.at});}
      expect(stops.map(stop=>stop.index)).toEqual([0,1,2,3,4]);for(let index=1;index<5;index++)expect(stops[index].at-stops[index-1].at).toBeGreaterThan(70);
      expect(stream.some(e=>e.phase==='transforming'&&JSON.stringify(e.grid)===JSON.stringify(metadata.beforeGrid))).toBe(true);
      expect(stream.filter(e=>e.phase==='result').every(e=>e.payout<=Number(view.totalPayoutUnits))).toBe(true);
      if(game==='studio-saffron-cipher')expect(JSON.parse((await page.locator('[data-studio-slot]').getAttribute('data-chosen'))!)).toEqual(metadata.chosen);
      if(saved.state==='settled')break;
      await expect(page.locator('[data-element-bigwin]')).toBeHidden();expect((await audio(page,game)).played.bigwin).toBe(0);
      if(game==='studio-stormforge-duel'&&view.step===1)expect(view.totalPayoutUnits).toBe('4358');
      await page.evaluate(()=>(window as any).slotProbe.reset());await page.locator('[data-element-spin]').click();saved=await done(page,casino);
    }
    const view=saved.view.studio as StudioSlotView,cues=await audio(page,game),maximum=golden.find(item=>item.gameId===game&&item.name==='maximum')!.results.at(-1)!;
    expect(saved.returnedUnits).toBe(String(maximum.credit));expect(cues.played.click).toBe(1);expect(cues.played['reel-stop']).toBe(view.history.length*5);expect(cues.played.line).toBe(view.history.reduce((sum,frame)=>sum+frame.wins.length,0));expect(cues.played.bigwin).toBe(1);
    expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(1);expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='win')).toHaveLength(1);expect(casino.posts.slice(1).every(({op})=>op.action==='move'&&!('stakeUnits'in op))).toBe(true);
    expect(await page.evaluate(()=>document.querySelector('[data-studio-slot]')===(window as any).originalSlot)).toBe(true);await geometry(page,game+'-maximum');await page.screenshot({path:`${directory}/${game}-maximum.png`});
    const before=cues.played,postCount=casino.posts.length,metadataCount=casino.metadata.length;
    for(let index=0;index<view.history.length;index++){
      if(view.history.length>1)await page.locator(`[data-element-frame="${index}"]`).click();
      expect(await page.locator('[data-element-cell]').evaluateAll(nodes=>nodes.toSorted((a,b)=>Number((a as HTMLElement).dataset.elementCell)-Number((b as HTMLElement).dataset.elementCell)).map(node=>Number((node as HTMLElement).dataset.symbol)))).toEqual(view.history[index].grid);
      if(game==='studio-saffron-cipher')expect(JSON.parse((await page.locator('[data-studio-slot]').getAttribute('data-chosen'))!)).toEqual(traces[index].metadata.chosen);
    }
    await page.locator('[data-element-refresh]').click();await page.evaluate(()=>(window as any).slotProbe.mount());await expect(page.locator('[data-element-spin]')).toBeEnabled();
    expect((await audio(page,game)).played).toEqual(before);expect(casino.posts.length).toBe(postCount);expect(casino.metadata.length).toBe(metadataCount);expect(await page.locator('[data-studio-slot]').getAttribute('data-chosen')).toBeNull();
    if(game==='studio-saffron-cipher')await expect(page.locator('[data-element-key]')).toHaveText('Сохранённый результат');
    writeFileSync(`${directory}/${game}-maximum-proof.json`,JSON.stringify({traces,cues,postCount,metadataCount,oneBet:true,staticHistoryAndReopen:true},null,2));expect(errors).toEqual([]);
  });
}

test('Forge shows each actual line factor 2, 3 and 4 without multiplying the round again',async({page})=>{
  for(const kind of ['wildFactor2','wildFactor3','wildFactor4'] as const){
    const {casino,errors}=await ready(page,'studio-stormforge-duel');casino.kind=kind;await page.locator('[data-element-spin]').click();const saved=await done(page,casino),metadata=currentStudioSlotPresentation(casino.game,casino.states.get(accountA)!.engine),stream=await events(page);
    for(const multiplier of metadata.multipliers)expect(stream.some(e=>Number(e.multiplierWin)===multiplier.winIndex&&Number(e.multiplier)===multiplier.factor&&Number(e.activeLine)===multiplier.line)).toBe(true);
    expect((await audio(page,casino.game)).played.multiplier).toBe(metadata.multipliers.length);expect(saved.view.studio!.totalPayoutUnits).toBe(fixture(casino.game,kind).studio!.kind==='slot'?(fixture(casino.game,kind).studio as StudioSlotView).totalPayoutUnits:'');expect(errors).toEqual([]);
  }
});

test('Cipher reveals two versus three columns and the fallback key without a player choice',async({page})=>{
  for(const kind of ['chosenTwo','chosenThree','chosenFallback'] as const){
    const {casino,errors}=await ready(page,'studio-saffron-cipher');casino.kind=kind;await page.locator('[data-element-spin]').click();await done(page,casino);const metadata=currentStudioSlotPresentation(casino.game,casino.states.get(accountA)!.engine);
    expect(JSON.parse((await page.locator('[data-studio-slot]').getAttribute('data-chosen'))!)).toEqual(metadata.chosen);expect((await audio(page,casino.game)).played.chosen).toBe(1);expect(await page.locator('[data-element-key-panel] button').count()).toBe(0);
    if(kind==='chosenTwo'){expect(metadata.chosen!.matchingColumns).toHaveLength(2);expect(metadata.chosen!.active).toBe(false);expect(metadata.events).toEqual([]);}
    if(kind==='chosenThree'){expect(metadata.chosen!.matchingColumns).toHaveLength(3);expect(metadata.chosen!.active).toBe(true);expect(metadata.events).toHaveLength(3);}
    if(kind==='chosenFallback'){expect(metadata.chosen!.sourceSymbol).toBeGreaterThan(2);expect(metadata.chosen!.symbol).toBe(0);}expect(errors).toEqual([]);
  }
});

test('Beacon native top or bottom WILD does not invent a middle-row beam',async({page})=>{
  const {casino,errors}=await ready(page,'studio-beacon-bay');casino.kind='nativeWildWithoutBeam';await page.locator('[data-element-spin]').click();await done(page,casino);const metadata=currentStudioSlotPresentation(casino.game,casino.states.get(accountA)!.engine);
  expect(metadata.beforeGrid.some((symbol,position)=>symbol===3&&(position<5||position>=10))).toBe(true);expect(metadata.events).toEqual([]);expect((await audio(page,casino.game)).played.beam).toBe(0);expect((await events(page)).every(e=>!e.transformEvents.length)).toBe(true);expect(errors).toEqual([]);
});

for(const game of ['studio-stormforge-duel','studio-beacon-bay'] as const)test(`${game} confirmed column transform remains distinct from a zero award`,async({page})=>{
  const {casino,errors}=await ready(page,game);casino.kind='transformedWithoutLine';await page.locator('[data-element-spin]').click();const saved=await done(page,casino),metadata=currentStudioSlotPresentation(game,casino.states.get(accountA)!.engine);
  expect(metadata.events.length).toBeGreaterThan(0);expect(saved.view.studio!.kind).toBe('slot');expect((saved.view.studio as StudioSlotView).wins).toEqual([]);expect((await audio(page,game)).played.line).toBe(0);await expect(page.locator('[data-element-bigwin]')).toBeHidden();expect(errors).toEqual([]);
});

test('Destroyed raw scatters never promise an unpaid bonus',async({page})=>{
  for(const game of games){const {casino,errors}=await ready(page,game);casino.kind='destroyedScatter';await page.locator('[data-element-spin]').click();const saved=await done(page,casino),metadata=currentStudioSlotPresentation(game,casino.states.get(accountA)!.engine);expect(metadata.beforeGrid.filter(symbol=>symbol===4).length).toBeGreaterThanOrEqual(3);expect(metadata.afterGrid.filter(symbol=>symbol===4).length).toBeLessThan(3);expect(saved.state).toBe('settled');expect((saved.view.studio as StudioSlotView).remaining).toBe(0);await expect(page.locator('[data-element-spin-label]')).toHaveText('ВРАЩАТЬ');expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);}
});

test('Cipher zero final free frame preserves its canonical accumulated 28 units',async({page})=>{
  const {casino,errors}=await ready(page,'studio-saffron-cipher');casino.kind='zeroFinalFree';await page.locator('[data-element-spin]').click();let saved=await done(page,casino);while(saved.state==='active'){await page.locator('[data-element-spin]').click();saved=await done(page,casino);}const view=saved.view.studio as StudioSlotView;
  expect(view.step).toBe(2);expect(view.history[2].payoutUnits).toBe('0');expect(saved.returnedUnits).toBe('28');expect(casino.posts).toHaveLength(3);expect((await audio(page,casino.game)).played['reel-stop']).toBe(15);expect(errors).toEqual([]);
});

test('Beacon bonus uses two new complete five-reel fields with no second stake',async({page})=>{
  const {casino,errors}=await ready(page,'studio-beacon-bay');casino.kind='bonusExample';await page.locator('[data-element-spin]').click();let saved=await done(page,casino);while(saved.state==='active'){await page.locator('[data-element-spin]').click();saved=await done(page,casino);}expect((saved.view.studio as StudioSlotView).history).toHaveLength(3);expect((await audio(page,casino.game)).played['reel-stop']).toBe(15);expect((await audio(page,casino.game)).played.click).toBe(1);expect((await audio(page,casino.game)).played['free-stage']).toBe(2);expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(1);expect(errors).toEqual([]);
});

for(const game of games)test(`${game} reachable complete zero remains a loss`,async({page})=>{
  const {casino,errors}=await ready(page,game);casino.kind='minimum';await page.locator('[data-element-spin]').click();const saved=await done(page,casino);expect(saved.state).toBe('settled');expect(saved.returnedUnits).toBe('0');expect((await audio(page,game)).played.loss).toBe(1);expect((await audio(page,game)).played.bigwin).toBe(0);expect(errors).toEqual([]);
});

for(const action of ['start','move'] as const)test(`Lost ${action} reply retries original UUID statically with one debit`,async({page})=>{
  const {casino,errors}=await ready(page,'studio-saffron-cipher',action==='move'?{saved:'maximum'}:{});casino.postHandler=async route=>route.abort('failed');await page.locator('[data-element-spin]').click();await expect(page.locator('[data-element-retry]')).toBeVisible();const id=casino.posts[0].op.id,played=(await audio(page,casino.game)).played;
  await page.evaluate(()=>(window as any).slotProbe.mount());await expect(page.locator('[data-element-retry]')).toBeVisible();casino.postHandler=undefined;await page.locator('[data-element-retry]').click();await done(page,casino);expect(casino.posts.map(({op})=>op.id)).toEqual([id,id]);expect((await audio(page,casino.game)).played).toEqual(played);expect(casino.metadata).toEqual([]);expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(action==='start'?1:0);expect(errors).toEqual([]);
});

for(const failure of ['missing','forged','slow'] as const)test(`${failure} metadata keeps exact saved grid without invented events`,async({page})=>{
  const {casino,errors}=await ready(page,'studio-beacon-bay');casino.kind='maximum';casino.metadataHandler=async(route,value)=>failure==='missing'?route.fulfill({status:404,json:{error:'Нет метаданных'}}):failure==='forged'?route.fulfill({status:200,json:{...value,events:[],afterGrid:Array(15).fill(3)}}):new Promise<void>(resolve=>setTimeout(()=>{void route.fulfill({status:200,json:value}).catch(()=>{}).then(()=>resolve());},4300));
  await page.locator('[data-element-spin]').click();await done(page,casino);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation','static');expect((await audio(page,casino.game)).played.beam).toBe(0);expect((await audio(page,casino.game)).played.line).toBe(0);expect((await events(page)).every(e=>!e.transformEvents.length)).toBe(true);expect(errors).toEqual([]);
});

test('Reduced motion and mute keep all three confirmed fields static',async({page})=>{
  for(const game of games){const {casino,errors}=await ready(page,game,{reduced:true,muted:true});await page.locator('[data-element-spin]').click();await done(page,casino);expect(casino.metadata).toEqual([]);const cues=await audio(page,game);expect(Object.values(cues.played).every(count=>count===0)).toBe(true);expect(cues.activeSources).toBe(0);expect(cues.loopOwners).toBe(0);expect((await events(page)).every(e=>e.reels.every(state=>state==='stopped'))).toBe(true);expect(errors).toEqual([]);}
});

for(const action of ['close','hidden','account'] as const)test(`${action} cancels late metadata, motion and future sounds`,async({page})=>{
  const {casino,errors}=await ready(page,'studio-saffron-cipher'),release=casino.holdMetadata();await page.locator('[data-element-spin]').click();await expect.poll(()=>casino.metadata.length).toBe(1);await page.evaluate(action=>{const p=(window as any).slotProbe;if(action==='close')p.close();else if(action==='hidden')p.visibility(true);else p.switchAccount('22222222-2222-4222-8222-222222222222');},action);release();await expect.poll(async()=>{const cues=await audio(page,casino.game);return[cues.activeSources,cues.loopOwners];}).toEqual([0,0]);expect((await audio(page,casino.game)).played.chosen).toBe(0);expect((await audio(page,casino.game)).played.line).toBe(0);if(action==='account')await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step','-1');expect(errors).toEqual([]);
});

test('Core reels, stake and spin fit all themes on phones and a 720px laptop',async({page})=>{
  for(const game of games)for(const size of [{width:375,height:667},{width:390,height:844},{width:1280,height:720}]){await page.setViewportSize(size);const {errors}=await ready(page,game,{saved:'maximum',finish:true});const label=`${game}-${size.width}x${size.height}`;await geometry(page,label);await page.screenshot({path:`${directory}/${label}.png`});expect(errors).toEqual([]);}
});

test('A definitive rejected start leaves no fabricated party, pending action or motion',async({page})=>{
  const {casino,errors}=await ready(page,'studio-saffron-cipher');await page.route('**/api/demo-wallet/expansion',route=>route.request().method()==='POST'?route.fulfill({status:400,json:{error:'Ставка отклонена'}}):route.fulfill({status:200,json:{wallet:casino.states.get(accountA)!.wallet,sessions:[]}}));await page.locator('[data-element-spin]').click();await expect(page.locator('[data-element-error]')).toContainText('Ставка отклонена');await expect(page.locator('[data-element-spin]')).toBeEnabled();await expect(page.locator('[data-element-retry]')).toBeHidden();await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-phase','idle');await expect(page.locator('[data-element-reel][data-state="stopped"]')).toHaveCount(5);expect(casino.states.get(accountA)!.wallet.balance).toBe(1000);expect(casino.states.get(accountA)!.sessions).toEqual([]);await expect.poll(async()=>{const cues=await audio(page,casino.game);return[cues.activeSources,cues.loopOwners];}).toEqual([0,0]);expect(errors).toEqual([]);
});

test('Early RAF base and free counters never move below the previous confirmed total',async({page})=>{
  await page.addInitScript(()=>{const original=requestAnimationFrame,applied=new Set<string>();window.requestAnimationFrame=callback=>original.call(window,time=>{const root=document.querySelector('[data-element-slot]') as HTMLElement|null,token=root?.dataset.animationToken;if(token&&root?.dataset.phase==='result'&&!applied.has(token)){applied.add(token);callback(time-80);}else callback(time);});});
  const {casino,errors}=await ready(page,'studio-saffron-cipher');await page.locator('[data-element-spin]').click();let saved=await done(page,casino);
  const assertCounter=async(step:number,from:number)=>{const samples=(await events(page)).filter(event=>event.phase==='result'&&event.step===step);expect(samples.length).toBeGreaterThan(0);for(const sample of samples)expect(sample.payout).toBeGreaterThanOrEqual(from);for(let index=1;index<samples.length;index++)expect(samples[index].payout).toBeGreaterThanOrEqual(samples[index-1].payout);};
  await assertCounter(0,0);const from=Number((saved.view.studio as StudioSlotView).totalPayoutUnits);await page.evaluate(()=>(window as any).slotProbe.reset());await page.locator('[data-element-spin]').click();saved=await done(page,casino);await assertCounter(1,from);writeFileSync(`${directory}/early-raf-counter.json`,JSON.stringify(await events(page),null,2));expect(errors).toEqual([]);
});

function assertMonotonic(stream:Awaited<ReturnType<typeof events>>,step:number,from=0){
  const values=stream.filter(e=>e.token&&e.phase==='result'&&e.step===step).map(e=>e.payout);expect(values.length).toBeGreaterThan(0);
  expect(values.every(value=>Number.isInteger(value)&&value>=from)).toBe(true);for(let i=1;i<values.length;i++)expect(values[i]).toBeGreaterThanOrEqual(values[i-1]);
}

