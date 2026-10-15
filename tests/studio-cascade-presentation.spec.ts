import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult,type StudioState} from '../server/games/studioGames';
import {STUDIO_DEFAULTS,STUDIO_INFO,validStudioSlotPresentation,validStudioSettlement,validStudioEnvelope,type StudioSlotView,type StudioPresentationGameId,type StudioSlotPresentation} from '../src/shared/studioGames';
import type {ExpansionAction,ExpansionSession} from '../src/shared/casinoExpansion';
import type {DemoWallet} from '../src/shared/demoWallet';

const accountA='11111111-1111-4111-8111-111111111111',accountB='22222222-2222-4222-8222-222222222222';
const directory='artifacts/game-presentation-goal-20261012/tests/wave3';
type Game='studio-caramel-carnival'|'studio-starfall-oracle';
type Golden={name:string;gameId:Game;stops:number[];seeds:number[];results:StudioResult[]};
const golden=[...JSON.parse(readFileSync('artifacts/studio-wave3-20261012/golden-legacy-fixtures.json','utf8')),...JSON.parse(readFileSync('artifacts/studio-wave3-20261012/maximum-fixtures.json','utf8')).map((item:Golden)=>({...item,name:'maximum'}))] as Golden[];
type Kind='both-cascades'|'early-end-after-first-cascade'|'first-cascade-three-groups'|'maximum-orb-factor-with-paid-groups'|'base-multiple-groups'|'maximum';
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
const p={client,demoWallet,audio:gameAudio,events:[],mount(){ui?.destroy();ui=new StudioGamesUI(document.getElementById('host'),'${game}');},close(){ui?.destroy();ui=undefined;},visibility(value){hidden=value;document.dispatchEvent(new Event('visibilitychange'));},switchAccount(id){demoWallet.setAccount(id);},capture(){const root=document.querySelector('[data-studio-slot]');if(!root)return;const pay=root.querySelector('[data-slot-payout]');p.events.push({at:performance.now(),phase:root.dataset.phase,token:root.dataset.animationToken,session:root.dataset.sessionId,step:Number(root.dataset.step),presentation:root.dataset.presentation,reels:[...root.querySelectorAll('[data-cascade-reel]')].map(reel=>reel.dataset.state),payout:Number(pay.dataset.units),target:Number(pay.dataset.targetUnits),removed:[...root.querySelectorAll('[data-cascade-cell].removing')].map(cell=>Number(cell.dataset.cascadeCell)).sort((a,b)=>a-b),drops:[...root.querySelectorAll('[data-cascade-drop]')].map(node=>({from:Number(node.dataset.from),to:Number(node.dataset.to),symbol:Number(node.dataset.symbol),transform:node.style.transform})),refills:[...root.querySelectorAll('[data-cascade-refill]')].map(node=>({position:Number(node.dataset.to),symbol:Number(node.dataset.symbol),transform:node.style.transform})),grid:[...root.querySelectorAll('[data-slot-cell]')].sort((a,b)=>Number(a.dataset.slotCell)-Number(b.dataset.slotCell)).map(cell=>Number(cell.dataset.symbol)),orbFactor:Number(root.dataset.orbFactor||1),trace:root.dataset.cascadeTrace?JSON.parse(root.dataset.cascadeTrace):null});},reset(){p.events=[];p.capture();},state(){return{account:client.accountId,busy:client.busy,pending:client.pending,error:client.error,sessions:client.sessions,audio:gameAudio.getState(),events:p.events};}};
new MutationObserver(()=>p.capture()).observe(document.getElementById('host'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase','data-state','data-units','data-target-units','data-session-id','data-animation-token','data-step','data-orb-factor','data-symbol','class','style']});window.slotProbe=p;document.getElementById('mini-dialog').showModal();demoWallet.setAccount('${accountA}');
</script></body></html>`;}

class Casino {
  states=new Map<string,State>([[accountA,{wallet:{balance:1000,entries:[]},sessions:[],ids:new Map()}],[accountB,{wallet:{balance:2000,entries:[]},sessions:[],ids:new Map()}]]);
  posts:{account:string;op:ExpansionAction}[]=[];metadata:{account:string;query:Record<string,string>}[]=[];gets=0;kind:Kind='both-cascades';
  postHandler?:(route:Route,reply:Reply,index:number)=>Promise<void>;
  metadataHandler?:(route:Route,value:StudioSlotPresentation,index:number)=>Promise<void>;
  constructor(private page:Page,readonly game:Game){}
  saved(kind:Kind='both-cascades',finish=false){const result=fixture(this.game,kind),state=this.states.get(accountA)!;let current=result;
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
  await expect(page.locator('[data-studio-slot]')).toBeVisible();await expect(page.locator('[data-slot-spin]')).toBeEnabled();await page.evaluate(()=>document.fonts.ready);
  await page.locator('#qa-unlock').click();await expect.poll(()=>page.evaluate(()=>(window as any).slotProbe.audio.getState().context)).toBe('running');await page.locator('#qa-unlock').evaluate(element=>element.remove());return {casino,errors};
}
async function audio(page:Page,game:Game){return page.evaluate(game=>(window as any).slotProbe.audio.getState().slot.byGame[game],game);}
async function events(page:Page){return page.evaluate(()=>(window as any).slotProbe.events as {at:number;phase:string;token:string;session:string;step:number;reels:string[];payout:number;target:number;removed:number[];drops:{from:number;to:number;symbol:number;transform:string}[];refills:{position:number;symbol:number;transform:string}[];grid:number[];orbFactor:number;trace:any}[]);}
async function done(page:Page,casino:Casino,account=accountA){const saved=casino.states.get(account)!.sessions[0],view=saved.view.studio as StudioSlotView;
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id',saved.id);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step',String(view.step));
  await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units',view.totalPayoutUnits);await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-target-units',view.totalPayoutUnits);
  await expect(page.locator('[data-slot-spin]')).toBeEnabled();await expect(page.locator('[data-cascade-reel][data-state="stopped"]')).toHaveCount(6);
  expect(await page.locator('[data-slot-cell]').evaluateAll(elements=>elements.toSorted((a,b)=>Number((a as HTMLElement).dataset.slotCell)-Number((b as HTMLElement).dataset.slotCell)).map(element=>Number((element as HTMLElement).dataset.symbol)))).toEqual(view.grid);
  await expect(page.locator('[data-slot-balance]')).toHaveText(casino.states.get(account)!.wallet.balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}));return saved;
}
async function geometry(page:Page,label:string){const bounds=await page.evaluate(()=>{const d=document.querySelector('dialog')!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dialog:{top:d.top,bottom:d.bottom},core:['[data-slot-reels]','[data-slot-stake]','[data-slot-spin]'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});
  for(const r of bounds.core){expect(r.left,label).toBeGreaterThanOrEqual(0);expect(r.right,label).toBeLessThanOrEqual(bounds.width);expect(r.top,label).toBeGreaterThanOrEqual(Math.max(0,bounds.dialog.top));expect(r.bottom,label).toBeLessThanOrEqual(Math.min(bounds.height,bounds.dialog.bottom));}
  writeFileSync(`${directory}/${label}-geometry.json`,JSON.stringify(bounds,null,2));return bounds;
}

function assertMonotonic(stream:Awaited<ReturnType<typeof events>>,step:number,from=0){
  const values=stream.filter(e=>e.token&&e.phase==='result'&&e.step===step).map(e=>e.payout);expect(values.length).toBeGreaterThan(0);
  expect(values.every(value=>Number.isInteger(value)&&value>=from)).toBe(true);for(let i=1;i<values.length;i++)expect(values[i]).toBeGreaterThanOrEqual(values[i-1]);
}
for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
  test(`${game} base uses six physical strips, sequential stops and confirmed anywhere groups`,async({page})=>{
    const {casino,errors}=await ready(page,game),release=casino.holdPost();await geometry(page,game+'-desktop');
    await page.evaluate(()=>(window as any).originalSlot=document.querySelector('[data-studio-slot]'));
    await page.locator('[data-slot-spin]').dblclick({force:true});await expect.poll(()=>casino.posts.length).toBe(1);await expect(page.locator('[data-cascade-reel][data-state="moving"]')).toHaveCount(6);
    const moving=await page.locator('[data-cascade-track]').evaluateAll(async tracks=>{const first=tracks.map(node=>getComputedStyle(node).transform);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {first,last:tracks.map(node=>getComputedStyle(node).transform)};});expect(moving.first).not.toEqual(moving.last);
    // Delayed metadata keeps every strip cycling, including the former five-row overflow boundary.
    await page.waitForTimeout(1550);release();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView;
    const stream=await events(page),seen=new Set<number>(),stops:{index:number;at:number}[]=[];
    for(const e of stream)for(let i=0;i<6;i++)if(e.token&&e.reels[i]==='stopped'&&!seen.has(i)){seen.add(i);stops.push({index:i,at:e.at});}
    expect(stops.map(stop=>stop.index)).toEqual([0,1,2,3,4,5]);for(let i=1;i<stops.length;i++)expect(stops[i].at-stops[i-1].at).toBeGreaterThan(70);
    expect(await page.evaluate(()=>document.querySelector('[data-studio-slot]')===(window as any).originalSlot)).toBe(true);
    const cues=await audio(page,game);expect(cues.played.click).toBe(1);expect(cues.played['reel-stop']).toBe(6);expect(cues.played.group).toBe(view.wins.length);expect(cues.played.line??0).toBe(0);expect(cues.played.return).toBe(1);expect(cues.played.bigwin??0).toBe(0);
    await expect(page.locator('[data-cascade-group-button]')).toHaveCount(view.wins.length);for(let i=0;i<view.wins.length;i++){await page.locator(`[data-cascade-group-button="${i}"]`).click();expect(await page.locator('[data-slot-cell].active-win').evaluateAll(cells=>cells.map(cell=>Number((cell as HTMLElement).dataset.slotCell)).sort((a,b)=>a-b))).toEqual(view.wins[i].positions);}
    expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(1);expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='win')).toHaveLength(0);assertMonotonic(stream,0);
    await page.screenshot({path:`${directory}/${game}-base-desktop.png`});writeFileSync(`${directory}/${game}-base.json`,JSON.stringify({saved,cues,stream},null,2));expect(errors).toEqual([]);
  });
  test(`${game} two confirmed cascades use exact removal, gravity and refill without extra bets or reel sounds`,async({page})=>{
    const {casino,errors}=await ready(page,game,{saved:'both-cascades',mobile:true});await geometry(page,game+'-mobile');
    for(let step=1;step<=2;step++){
      const prior=casino.states.get(accountA)!.sessions[0].view.studio as StudioSlotView,before=await audio(page,game),release=casino.holdPost();
      await page.evaluate(()=>(window as any).slotProbe.reset());await page.locator('[data-slot-spin]').click();await expect.poll(()=>casino.posts.length).toBe(step);
      await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-phase','waiting');expect(await page.locator('[data-cascade-track]').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).visibility==='hidden'))).toBe(true);
      expect((await audio(page,game)).activeSources).toBe(0);expect((await audio(page,game)).played).toEqual(before.played);release();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView;
      const metadata=currentStudioSlotPresentation(game,casino.states.get(accountA)!.engine),cascade=metadata.cascade!,stream=await events(page),after=await audio(page,game);
      expect(stream.some(e=>e.phase==='removing'&&JSON.stringify(e.removed)===JSON.stringify(cascade.removedPositions))).toBe(true);
      expect(stream.some(e=>e.phase==='dropping'&&JSON.stringify(e.drops.map(({transform,...drop})=>drop))===JSON.stringify(cascade.drops))).toBe(true);
      expect(stream.some(e=>e.phase==='refilling'&&JSON.stringify(e.refills.map(({transform,...refill})=>refill))===JSON.stringify(cascade.refills))).toBe(true);
      expect(stream.some(e=>e.drops.some(drop=>drop.transform.includes('translate3d')&&drop.transform!=='translate3d(0,0,0)'))).toBe(true);
      expect(stream.filter(e=>['removing','dropping','refilling'].includes(e.phase)).every(e=>JSON.stringify(e.grid)===JSON.stringify(prior.grid))).toBe(true);
      for(const kind of ['collapse','drop','refill'])expect(after.played[kind]-(before.played[kind]??0)).toBe(1);expect(after.played.group-(before.played.group??0)).toBe(view.wins.length);
      expect(after.played.click??0).toBe(0);expect(after.played['reel-stop']??0).toBe(0);expect(after.played.line??0).toBe(0);expect(after.played.bigwin??0).toBe(0);
      assertMonotonic(stream,step,Number(prior.totalPayoutUnits));expect(casino.metadata.at(-1)!.query).toEqual({sessionId:saved.id,phase:String(saved.view.phase),step:String(step)});
      await geometry(page,`${game}-mobile-step${step}`);await page.screenshot({path:`${directory}/${game}-mobile-step${step}.png`});writeFileSync(`${directory}/${game}-cascade${step}.json`,JSON.stringify({metadata,saved,stream,cues:after},null,2));
    }
    const state=casino.states.get(accountA)!;expect(state.sessions[0].state).toBe('settled');expect(state.sessions[0].returnedUnits).toBe(game==='studio-caramel-carnival'?'1260':'1240');expect(state.wallet.entries.filter(e=>e.kind==='bet')).toHaveLength(0);expect(state.wallet.entries.filter(e=>e.kind==='win')).toHaveLength(1);expect(errors).toEqual([]);
  });
  test(`${game} early end retains accrued payout and never requests a second cascade`,async({page})=>{
    const {casino,errors}=await ready(page,game,{saved:'early-end-after-first-cascade'});await page.locator('[data-slot-spin]').click();const saved=await done(page,casino);
    expect(saved.state).toBe('settled');expect(saved.returnedUnits).toBe(game==='studio-caramel-carnival'?'510':'376');expect((saved.view.studio as StudioSlotView).history).toHaveLength(2);await expect(page.locator('[data-slot-spin]')).toHaveAttribute('data-start','');await expect(page.locator('[data-slot-bonus]')).toHaveText('Совпадения от восьми');
    expect((await audio(page,game)).played.group??0).toBe(0);expect((await audio(page,game)).played.return).toBe(1);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
  });
}
test('three groups and Starfall factor16 represent actual group payouts and a subdued 830-unit return',async({page})=>{
  const game='studio-starfall-oracle' as const,{casino,errors}=await ready(page,game,{saved:'maximum-orb-factor-with-paid-groups'});
  for(let step=1;step<=2;step++){await page.locator('[data-slot-spin]').click();await done(page,casino);}
  const saved=casino.states.get(accountA)!.sessions[0],view=saved.view.studio as StudioSlotView;
  expect(saved.returnedUnits).toBe('830');expect(view.history.map(frame=>1+frame.grid.filter(symbol=>symbol===5).length)).toEqual([7,13,16]);await expect(page.locator('[data-cascade-factor]')).toHaveText('×16');await expect(page.locator('[data-slot-bigwin]')).toBeHidden();
  const cues=await audio(page,game);expect(cues.played.return).toBe(2);expect(cues.played.win??0).toBe(0);expect(cues.played.bigwin??0).toBe(0);expect(cues.played.orb).toBe(2);
  await page.locator('[data-slot-frame="0"]').click();await expect(page.locator('[data-cascade-factor]')).toHaveText('×7');await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units','830');expect((await audio(page,game)).played).toEqual(cues.played);
  writeFileSync(`${directory}/starfall-factor16-partial.json`,JSON.stringify({saved,cues},null,2));expect(errors).toEqual([]);
});
for(const game of ['studio-caramel-carnival','studio-starfall-oracle'] as const)test(`${game} real maximum complete round debits one stake and credits only the canonical per-group total`,async({page})=>{
  const {casino,errors}=await ready(page,game);casino.kind='maximum';await page.locator('[data-slot-spin]').click();let saved=await done(page,casino);
  for(let step=1;step<=2;step++){expect(saved.state).toBe('active');expect((await audio(page,game)).played.win??0).toBe(0);await page.locator('[data-slot-spin]').click();saved=await done(page,casino);}
  const credit=game==='studio-caramel-carnival'?'2190':'1573';expect(saved.returnedUnits).toBe(credit);expect(saved.state).toBe('settled');
  const state=casino.states.get(accountA)!,cues=await audio(page,game);expect(state.wallet.entries.filter(e=>e.kind==='bet')).toHaveLength(1);expect(state.wallet.entries.filter(e=>e.kind==='win')).toHaveLength(1);expect(state.wallet.balance).toBe(990+Number(credit)/100);
  expect(casino.posts.filter(entry=>entry.op.action==='start')).toHaveLength(1);expect(casino.posts.filter(entry=>entry.op.action==='move')).toHaveLength(2);expect(cues.played.click).toBe(1);expect(cues.played['reel-stop']).toBe(6);expect(cues.played.win).toBe(1);expect(cues.played.bigwin??0).toBe(0);await expect(page.locator('[data-slot-bigwin]')).toBeHidden();
  writeFileSync(`${directory}/${game}-maximum.json`,JSON.stringify({saved,cues,posts:casino.posts,wallet:state.wallet},null,2));expect(errors).toEqual([]);
});
test('three reachable paid groups each get their own highlight and one musical cue',async({page})=>{
  const game='studio-caramel-carnival' as const,{casino,errors}=await ready(page,game,{saved:'first-cascade-three-groups'});await page.locator('[data-slot-spin]').click();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView;
  expect(view.wins).toHaveLength(3);await expect(page.locator('[data-cascade-group-button]')).toHaveCount(3);expect((await audio(page,game)).played.group).toBe(3);expect((await audio(page,game)).played.win??0).toBe(0);expect((await audio(page,game)).played.return).toBe(1);expect(errors).toEqual([]);
});
test('a lost committed cascade retries the same UUID once, then restores silently without a second stake',async({page})=>{
  const game='studio-caramel-carnival' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades'});casino.postHandler=async(route,reply,index)=>index===1?route.abort('failed'):route.fulfill({status:200,json:reply});
  await page.locator('[data-slot-spin]').click();await expect(page.locator('[data-slot-retry]')).toBeVisible();const first=casino.posts[0].op;
  await page.evaluate(()=>{(window as any).slotProbe.close();(window as any).slotProbe.mount();});await page.locator('[data-slot-retry]').click();await done(page,casino);
  expect(casino.posts).toHaveLength(2);expect(casino.posts[1].op).toEqual(first);expect(first.action).toBe('move');expect(first).not.toHaveProperty('stakeUnits');expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});expect(casino.states.get(accountA)!.wallet.entries).toHaveLength(0);expect(errors).toEqual([]);
});
test('lost base reply survives reopening and retries its original UUID with exactly one debit',async({page})=>{
  const game='studio-starfall-oracle' as const,{casino,errors}=await ready(page,game);casino.postHandler=async(route,reply,index)=>index===1?route.abort('failed'):route.fulfill({status:200,json:reply});
  await page.locator('[data-slot-spin]').click();await expect(page.locator('[data-slot-retry]')).toBeVisible();const first=casino.posts[0].op;await page.evaluate(()=>{(window as any).slotProbe.close();(window as any).slotProbe.mount();});await page.locator('[data-slot-retry]').click();await done(page,casino);
  expect(first.action).toBe('start');expect(casino.posts[1].op).toEqual(first);expect(casino.posts).toHaveLength(2);expect(casino.states.get(accountA)!.wallet.entries.filter(e=>e.kind==='bet')).toHaveLength(1);expect(casino.states.get(accountA)!.wallet.balance).toBe(990);expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played['reel-stop']??0).toBe(0);expect((await audio(page,game)).played.group??0).toBe(0);expect(errors).toEqual([]);
});
test('saved round, history and refresh remain static without metadata or repeat sounds',async({page})=>{
  const game='studio-starfall-oracle' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades',finish:true});await done(page,casino);
  for(let step=0;step<3;step++){await page.locator(`[data-slot-frame="${step}"]`).click();const view=casino.states.get(accountA)!.sessions[0].view.studio as StudioSlotView;expect(await page.locator('[data-slot-cell]').evaluateAll(nodes=>nodes.toSorted((a,b)=>Number((a as HTMLElement).dataset.slotCell)-Number((b as HTMLElement).dataset.slotCell)).map(node=>Number((node as HTMLElement).dataset.symbol)))).toEqual(view.history[step].grid);}
  await page.locator('[data-slot-refresh]').click();await expect.poll(()=>casino.gets).toBeGreaterThan(1);expect(casino.posts).toHaveLength(0);expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});expect(errors).toEqual([]);
});
test('forged or unavailable metadata falls back to saved symbols with no transform or false orb claim',async({page})=>{
  const game='studio-starfall-oracle' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades'});
  casino.metadataHandler=async(route,value)=>route.fulfill({status:200,json:{...value,cascade:{...value.cascade,orbFactor:999}}});await page.locator('[data-slot-spin]').click();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView;
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation','static');await expect(page.locator('[data-cascade-factor]')).toHaveText(`×${1+view.grid.filter(symbol=>symbol===5).length}`);const cues=await audio(page,game);for(const kind of ['collapse','drop','refill','orb','bigwin'])expect(cues.played[kind]??0).toBe(0);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
});
test('a stalled presentation request times out without losing a committed cascade',async({page})=>{
  const game='studio-caramel-carnival' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades'}),release=casino.holdMetadata();await page.locator('[data-slot-spin]').click();await expect.poll(()=>casino.metadata.length).toBe(1);await done(page,casino);release();await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation','static');for(const kind of ['collapse','drop','refill'])expect((await audio(page,game)).played[kind]??0).toBe(0);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
});
test('reduced motion and mute preserve confirmed amounts with zero voices and no gravity animation',async({page})=>{
  const game='studio-starfall-oracle' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades',reduced:true,muted:true});await page.locator('[data-slot-spin]').click();await done(page,casino);
  expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});expect((await audio(page,game)).activeSources).toBe(0);expect((await events(page)).some(e=>['removing','dropping','refilling'].includes(e.phase))).toBe(false);await expect(page.locator('[data-cascade-drop]')).toHaveCount(0);expect(errors).toEqual([]);
});
for(const action of ['close','hidden','account'] as const)test(`${action} while awaiting cascade metadata cancels late effects and preserves account isolation`,async({page})=>{
  const game='studio-starfall-oracle' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades'}),release=casino.holdMetadata();await page.locator('[data-slot-spin]').click();await expect.poll(()=>casino.metadata.length).toBe(1);
  await page.evaluate(action=>{const p=(window as any).slotProbe;if(action==='close')p.close();else if(action==='hidden')p.visibility(true);else p.switchAccount('22222222-2222-4222-8222-222222222222');},action);release();
  if(action==='close'){await page.evaluate(()=>(window as any).slotProbe.mount());await done(page,casino);}else if(action==='hidden'){await page.evaluate(()=>(window as any).slotProbe.visibility(false));await done(page,casino);}else{await page.waitForFunction(()=>(window as any).slotProbe.client.accountId==='22222222-2222-4222-8222-222222222222'&&!(window as any).slotProbe.client.loading);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id','');await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units','0');await expect(page.locator('[data-cascade-factor]')).toHaveText('×1');}
  const cues=await audio(page,game);expect(cues.activeSources).toBe(0);expect(cues.played).toEqual({});expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
});
test('hiding during gravity animation cancels notes and settles the saved stage statically',async({page})=>{
  const game='studio-caramel-carnival' as const,{casino,errors}=await ready(page,game,{saved:'both-cascades'});await page.locator('[data-slot-spin]').click();await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-phase','removing');await page.evaluate(()=>(window as any).slotProbe.visibility(true));
  await expect.poll(async()=>(await audio(page,game)).activeSources).toBe(0);const prior=(await audio(page,game)).played;await page.waitForTimeout(1500);expect((await audio(page,game)).played).toEqual(prior);await page.evaluate(()=>(window as any).slotProbe.visibility(false));await done(page,casino);await expect(page.locator('[data-cascade-drop]')).toHaveCount(0);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
});
test('base and cascade count-up clamp an early RAF at their saved lower bound',async({page})=>{
  await page.addInitScript(()=>{const original=requestAnimationFrame;const applied=new Set<string>();window.requestAnimationFrame=callback=>original.call(window,time=>{const root=document.querySelector('[data-cascade-game]') as HTMLElement|null,token=root?.dataset.animationToken;if(token&&root?.dataset.phase==='result'&&!applied.has(token)){applied.add(token);callback(time-80);}else callback(time);});});
  const game='studio-caramel-carnival' as const,{casino,errors}=await ready(page,game);await page.locator('[data-slot-spin]').click();await done(page,casino);assertMonotonic(await events(page),0,0);
  const from=Number((casino.states.get(accountA)!.sessions[0].view.studio as StudioSlotView).totalPayoutUnits);await page.evaluate(()=>(window as any).slotProbe.reset());await page.locator('[data-slot-spin]').click();await done(page,casino);const stream=await events(page);assertMonotonic(stream,1,from);writeFileSync(`${directory}/early-raf-counter.json`,JSON.stringify(stream,null,2));expect(errors).toEqual([]);
});
test('minimum phone and desktop heights keep the board, stake and spin accessible',async({page})=>{
  const game='studio-starfall-oracle' as const,{errors}=await ready(page,game,{saved:'both-cascades'});for(const viewport of [{width:1280,height:720},{width:375,height:667}]){await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);await geometry(page,`starfall-${viewport.width}x${viewport.height}`);await page.screenshot({path:`${directory}/starfall-${viewport.width}x${viewport.height}.png`});}expect(errors).toEqual([]);
});

