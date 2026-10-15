import {test,expect,type Page,type Route} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult,type StudioState} from '../server/games/studioGames';
import {STUDIO_DEFAULTS,STUDIO_INFO,validStudioSlotPresentation,validStudioSettlement,validStudioEnvelope,type StudioSlotView,type StudioPresentationGameId,type StudioSlotPresentation} from '../src/shared/studioGames';
import type {ExpansionAction,ExpansionSession} from '../src/shared/casinoExpansion';
import type {DemoWallet} from '../src/shared/demoWallet';

const accountA='11111111-1111-4111-8111-111111111111',accountB='22222222-2222-4222-8222-222222222222';
const directory=process.env.ROYAL_STUDIO_ARTIFACT_DIR??'artifacts/game-presentation-goal-20261012/tests/wave2';
type Kind='base'|'plain'|'loss'|'big'|'bonus'|'bonus-big';
type State={wallet:DemoWallet;sessions:ExpansionSession[];engine?:StudioState;ids:Map<string,Reply>};
type Reply={wallet:DemoWallet;sessions:ExpansionSession[];session:ExpansionSession;replayed:boolean};
const vectors=new Map<string,number[]>();
function fixture(game:StudioPresentationGameId,kind:Kind,stake='1000'):StudioResult {
  if(kind==='bonus-big'){
    if(game!=='studio-velvet-reign')throw Error('This reachable bonus fixture belongs to Velvet');
    const values=[0,3,2,0,0,1,1];return startStudioGame(game,STUDIO_DEFAULTS[game],stake,()=>values.shift()!);
  }
  let stops=vectors.get(game+kind);
  if(!stops)for(let value=0;value<6**5;value++){
    const choices=Array.from({length:5},(_,col)=>Math.floor(value/6**col)%6),values=[...choices,0,5];
    const candidate=startStudioGame(game,STUDIO_DEFAULTS[game],'1000',()=>values.shift()!);
    const metadata=currentStudioSlotPresentation(game,candidate.engine),view=candidate.studio as StudioSlotView;
    const match=kind==='bonus'?!candidate.ended&&Number(view.totalPayoutUnits)>0:kind==='loss'?candidate.ended&&!candidate.credit:
      kind==='big'?candidate.ended&&candidate.credit>=4000:kind==='plain'?candidate.ended&&candidate.credit>0&&!metadata.multipliers.length:
      candidate.ended&&candidate.credit>0&&(game==='studio-cosmic-escape'?metadata.events.some(event=>event.kind==='expand-wild'):metadata.multipliers.length>0);
    if(match){stops=choices;vectors.set(game+kind,choices);break;}
  }
  if(!stops)throw Error(`Missing reachable ${game} ${kind} fixture`);
  const values=[...stops,0,5];return startStudioGame(game,STUDIO_DEFAULTS[game],stake,()=>values.shift()!);
}
function session(game:StudioPresentationGameId,id:string,stake:string,result:StudioResult):ExpansionSession {
  const studio=result.studio as StudioSlotView;
  const saved:ExpansionSession={id,gameId:game,rulesVersion:1,state:result.ended?'settled':'active',stakeUnits:stake,spentUnits:stake,returnedUnits:String(result.credit),
    view:{studio,player:[],dealer:[],community:[],actions:result.ended?[]:[{move:'studio-spin',label:'Бесплатное вращение',cost:0}],phase:result.ended?1:studio.step+1,ended:result.ended,message:result.message}};
  expect(validStudioSettlement(game,saved.state,stake,stake,saved.returnedUnits,studio)).toBe(true);
  expect(validStudioEnvelope(game,saved.state,saved.view)).toBe(true);return saved;
}
function probe(game:StudioPresentationGameId){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>#host{width:min(100%,680px);margin:auto}#qa-unlock{position:fixed;bottom:8px;right:8px;z-index:100000}</style></head><body><dialog id="mini-dialog" class="mini-dialog originals-mode wallet-game-mode"><div class="mini-top"><div><span class="eyebrow">НОВЫЕ МИРЫ / ЭТАЖ 1</span><h2>${STUDIO_INFO[game].name}</h2></div><button class="icon-button" aria-label="Вернуться в зал">×</button></div><div class="mini-stage"><div id="mini-game"><div id="host"></div></div></div><div class="mini-bottom"><span>Общий тестовый кошелёк клуба</span></div><button id="qa-unlock">Проверка звука</button></dialog><script type="module">
import {StudioGamesUI} from '/src/ui/StudioGamesUI.ts';import {expansionClient as client} from '/src/wallet/ExpansionClient.ts';import {demoWallet} from '/src/wallet/WalletClient.ts';import {gameAudio} from '/src/game/GameAudio.ts';import '/src/wallet.css';import '/src/style.css';import '/src/paper-theme.css';import '/src/own-cabinets.css';
let ui,hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
gameAudio.install();gameAudio.setGame('${game}');document.getElementById('qa-unlock').onclick=()=>gameAudio.unlock();
const p={client,demoWallet,audio:gameAudio,events:[],mount(){ui?.destroy();ui=new StudioGamesUI(document.getElementById('host'),'${game}');},close(){ui?.destroy();ui=undefined;},visibility(value){hidden=value;document.dispatchEvent(new Event('visibilitychange'));},switchAccount(id){demoWallet.setAccount(id);},capture(){const root=document.querySelector('[data-studio-slot]');if(!root)return;const pay=root.querySelector('[data-slot-payout]');p.events.push({at:performance.now(),phase:root.dataset.phase,token:root.dataset.animationToken,session:root.dataset.sessionId,step:Number(root.dataset.step),presentation:root.dataset.presentation,reels:[...root.querySelectorAll('[data-slot-reel]')].map(reel=>reel.dataset.state),payout:Number(pay.dataset.units),target:Number(pay.dataset.targetUnits),pins:[...root.querySelectorAll('[data-slot-pin]')].map(pin=>Number(pin.dataset.slotPin)).sort((a,b)=>a-b),grid:[...root.querySelectorAll('[data-slot-cell]')].sort((a,b)=>Number(a.dataset.slotCell)-Number(b.dataset.slotCell)).map(cell=>Number(cell.dataset.symbol)),multiplier:root.dataset.multiplierFactor});},reset(){p.events=[];p.capture();},state(){return{account:client.accountId,busy:client.busy,pending:client.pending,error:client.error,sessions:client.sessions,audio:gameAudio.getState(),events:p.events};}};
new MutationObserver(()=>p.capture()).observe(document.getElementById('host'),{subtree:true,childList:true,attributes:true,attributeFilter:['data-phase','data-state','data-units','data-target-units','data-session-id','data-animation-token','data-step','data-multiplier-factor']});window.slotProbe=p;document.getElementById('mini-dialog').showModal();demoWallet.setAccount('${accountA}');
</script></body></html>`;}

class Casino {
  states=new Map<string,State>([[accountA,{wallet:{balance:1000,entries:[]},sessions:[],ids:new Map()}],[accountB,{wallet:{balance:2000,entries:[]},sessions:[],ids:new Map()}]]);
  posts:{account:string;op:ExpansionAction}[]=[];metadata:{account:string;query:Record<string,string>}[]=[];gets=0;kind:Kind='base';
  postHandler?:(route:Route,reply:Reply,index:number)=>Promise<void>;
  metadataHandler?:(route:Route,value:StudioSlotPresentation,index:number)=>Promise<void>;
  constructor(private page:Page,readonly game:StudioPresentationGameId){}
  saved(kind:Kind='bonus',finish=false){const result=fixture(this.game,kind),state=this.states.get(accountA)!;let current=result;
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
async function ready(page:Page,game:StudioPresentationGameId,options:{saved?:Kind;finish?:boolean;mobile?:boolean;reduced?:boolean;muted?:boolean}={}){
  mkdirSync(directory,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const casino=new Casino(page,game);if(options.saved)casino.saved(options.saved,options.finish);await casino.install();
  if(options.mobile)await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:options.reduced?'reduce':'no-preference'});
  await page.addInitScript(muted=>{localStorage.setItem('royal-muted',muted?'1':'0');localStorage.setItem('royal-volume','.12');localStorage.setItem('royal-casino-ambience','0');},!!options.muted);
  await page.route('**/studio-slot-probe',route=>route.fulfill({status:200,contentType:'text/html',body:probe(game)}));await page.goto('/studio-slot-probe');
  await page.waitForFunction(()=>{const p=(window as any).slotProbe;return p&&!p.client.loading&&p.demoWallet.wallet;});await page.evaluate(()=>(window as any).slotProbe.mount());
  await expect(page.locator('[data-studio-slot]')).toBeVisible();await expect(page.locator('[data-slot-spin]')).toBeEnabled();await page.evaluate(()=>document.fonts.ready);
  await page.locator('#qa-unlock').click();await expect.poll(()=>page.evaluate(()=>(window as any).slotProbe.audio.getState().context)).toBe('running');await page.locator('#qa-unlock').evaluate(element=>element.remove());return {casino,errors};
}
async function audio(page:Page,game:StudioPresentationGameId){return page.evaluate(game=>(window as any).slotProbe.audio.getState().slot.byGame[game],game);}
async function events(page:Page){return page.evaluate(()=>(window as any).slotProbe.events as {at:number;phase:string;token:string;session:string;step:number;reels:string[];payout:number;target:number;pins:number[];grid:number[];multiplier?:string}[]);}
async function done(page:Page,casino:Casino,account=accountA){const saved=casino.states.get(account)!.sessions[0],view=saved.view.studio as StudioSlotView;
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id',saved.id);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step',String(view.step));
  await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units',view.totalPayoutUnits);await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-target-units',view.totalPayoutUnits);
  await expect(page.locator('[data-slot-spin]')).toBeEnabled();await expect(page.locator('[data-slot-reel][data-state="stopped"]')).toHaveCount(5);
  expect(await page.locator('[data-slot-cell]').evaluateAll(elements=>elements.toSorted((a,b)=>Number((a as HTMLElement).dataset.slotCell)-Number((b as HTMLElement).dataset.slotCell)).map(element=>Number((element as HTMLElement).dataset.symbol)))).toEqual(view.grid);
  await expect(page.locator('[data-slot-balance]')).toHaveText(casino.states.get(account)!.wallet.balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}));return saved;
}
async function geometry(page:Page,label:string){const bounds=await page.evaluate(()=>{const d=document.querySelector('dialog')!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dialog:{top:d.top,bottom:d.bottom},core:['[data-slot-reels]','[data-slot-stake]','[data-slot-spin]'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});
  for(const r of bounds.core){expect(r.left,label).toBeGreaterThanOrEqual(0);expect(r.right,label).toBeLessThanOrEqual(bounds.width);expect(r.top,label).toBeGreaterThanOrEqual(Math.max(0,bounds.dialog.top));expect(r.bottom,label).toBeLessThanOrEqual(Math.min(bounds.height,bounds.dialog.bottom));}
  writeFileSync(`${directory}/${label}-geometry.json`,JSON.stringify(bounds,null,2));return bounds;
}

for(const game of ['studio-cosmic-escape','studio-velvet-reign'] as const){
  test(`${game} moves five strips and shows only confirmed transforms, lines and amounts`,async({page})=>{
    const {casino,errors}=await ready(page,game);const release=casino.holdPost();await geometry(page,game+'-desktop-initial');
    await page.evaluate(()=>(window as any).originalSlot=document.querySelector('[data-studio-slot]'));await page.locator('[data-slot-spin]').dblclick({force:true});await expect.poll(()=>casino.posts.length).toBe(1);
    await expect(page.locator('[data-slot-reel][data-state="moving"]')).toHaveCount(5);const movement=await page.locator('[data-slot-track]').evaluateAll(async nodes=>{const a=nodes.map(node=>getComputedStyle(node).transform);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return{a,b:nodes.map(node=>getComputedStyle(node).transform)};});expect(movement.a).not.toEqual(movement.b);
    await expect(page.locator('[data-slot-spin]')).toBeDisabled();release();const saved=await done(page,casino),view=saved.view.studio as StudioSlotView,metadata=currentStudioSlotPresentation(game,casino.states.get(accountA)!.engine);
    await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation','available');const stream=await events(page),stops:{index:number;at:number}[]=[];const seen=new Set<number>();
    for(const e of stream)for(let i=0;i<5;i++)if(e.token&&e.reels[i]==='stopped'&&!seen.has(i)){seen.add(i);stops.push({index:i,at:e.at});}
    expect(stops.map(s=>s.index)).toEqual([0,1,2,3,4]);for(let i=1;i<5;i++)expect(stops[i].at-stops[i-1].at).toBeGreaterThan(70);
    expect(await page.evaluate(()=>document.querySelector('[data-studio-slot]')===(window as any).originalSlot)).toBe(true);
    const cues=await audio(page,game);expect(cues.played.click).toBe(1);expect(cues.played['reel-stop']).toBe(5);expect(cues.played.line).toBe(view.wins.length);
    if(game==='studio-cosmic-escape'){expect(cues.played.expand).toBe(metadata.events.length);expect(stream.some(e=>e.phase==='transforming'&&JSON.stringify(e.grid)===JSON.stringify(metadata.beforeGrid))).toBe(true);}
    else{expect(cues.played.multiplier).toBe(metadata.multipliers.length);const allowed=metadata.multipliers.map(m=>String(m.factor));expect(stream.filter(e=>e.multiplier).every(e=>allowed.includes(e.multiplier!))).toBe(true);}
    expect(casino.states.get(accountA)!.wallet.entries.filter(entry=>entry.kind==='bet')).toHaveLength(1);expect(casino.metadata[0].query).toEqual({sessionId:saved.id,phase:String(saved.view.phase),step:String(view.step)});
    await geometry(page,game+'-desktop-result');await page.setViewportSize({width:1280,height:720});await geometry(page,game+'-laptop-result');await page.screenshot({path:`${directory}/${game}-desktop.png`,fullPage:true});
    writeFileSync(`${directory}/${game}-confirmed-proof.json`,JSON.stringify({saved,metadata,cues,stops,stream},null,2));expect(errors).toEqual([]);
  });

  test(`${game} free stages reuse one paid round, keep saved pins and monotonic accumulation`,async({page})=>{
    const {casino,errors}=await ready(page,game,{mobile:true});casino.kind='bonus';await page.locator('[data-slot-spin]').click();let saved=await done(page,casino);expect(saved.state).toBe('active');
    const tokens:string[]=[];for(let step=1;step<=2;step++){
      const old=saved.view.studio as StudioSlotView,prior=Number(old.totalPayoutUnits),held=old.held;await page.evaluate(()=>(window as any).slotProbe.reset());const release=casino.holdPost();
      await page.locator('[data-slot-spin]').click();await expect.poll(()=>casino.posts.length).toBe(step+1);await expect(page.locator('[data-slot-stake]')).toBeDisabled();
      if(game==='studio-velvet-reign'){expect(await page.locator('[data-slot-pin]').evaluateAll(nodes=>nodes.map(node=>Number((node as HTMLElement).dataset.slotPin)).sort((a,b)=>a-b))).toEqual(held);await expect(page.locator('[data-slot-reel][data-state="moving"]')).toHaveCount(5);}
      release();saved=await done(page,casino);const stream=await events(page);tokens.push(...new Set(stream.filter(e=>e.token).map(e=>e.token)));
      writeFileSync(`${directory}/${game}-bonus-step-${step}-events.json`,JSON.stringify({prior,saved,stream},null,2));
      expect(stream.filter(e=>e.phase==='result'&&e.token).every(e=>e.payout>=prior)).toBe(true);
      if(game==='studio-velvet-reign')expect(await page.locator('[data-slot-pin]').evaluateAll(nodes=>nodes.map(node=>Number((node as HTMLElement).dataset.slotPin)).sort((a,b)=>a-b))).toEqual((saved.view.studio as StudioSlotView).held);
      await geometry(page,game+'-mobile-bonus-'+step);
    }
    expect(new Set(tokens).size).toBe(2);expect(saved.state).toBe('settled');const entries=casino.states.get(accountA)!.wallet.entries;
    expect(entries.filter(e=>e.kind==='bet')).toHaveLength(1);expect(entries.filter(e=>e.kind==='win')).toHaveLength(1);expect(casino.posts.slice(1).every(({op})=>op.action==='move'&&!('stakeUnits'in op))).toBe(true);
    const cues=await audio(page,game);expect(cues.played.click).toBe(3);expect(cues.played['reel-stop']).toBe(15);expect(cues.played['free-stage']).toBe(2);
    await page.screenshot({path:`${directory}/${game}-mobile-bonus.png`,fullPage:true});writeFileSync(`${directory}/${game}-bonus-proof.json`,JSON.stringify({saved,cues,posts:casino.posts,entries},null,2));expect(errors).toEqual([]);
  });

  test(`${game} saved stages, history, refresh and reopen stay static without metadata or cue replay`,async({page})=>{
    const {casino,errors}=await ready(page,game,{saved:'bonus',finish:true});const saved=await done(page,casino),view=saved.view.studio as StudioSlotView;
    expect(casino.metadata).toHaveLength(0);expect((await audio(page,game)).played).toEqual({});await expect(page.locator('[data-slot-frame]')).toHaveCount(3);
    await page.locator('[data-slot-frame="0"]').click();expect(await page.locator('[data-slot-cell]').evaluateAll(nodes=>nodes.toSorted((a,b)=>Number((a as HTMLElement).dataset.slotCell)-Number((b as HTMLElement).dataset.slotCell)).map(node=>Number((node as HTMLElement).dataset.symbol)))).toEqual(view.history[0].grid);
    await page.locator('[data-slot-refresh]').click();await expect.poll(()=>casino.gets).toBeGreaterThan(1);await page.evaluate(()=>(window as any).slotProbe.close());expect((await audio(page,game)).owners).toBe(0);
    await page.evaluate(()=>(window as any).slotProbe.mount());await done(page,casino);expect((await audio(page,game)).played).toEqual({});expect(casino.posts).toHaveLength(0);expect(casino.metadata).toHaveLength(0);expect(errors).toEqual([]);
  });

  test(`${game} lost reply to a free stage retries the same UUID without another stake or presentation`,async({page})=>{
    const {casino,errors}=await ready(page,game,{saved:'bonus'});let fail!:()=>void;const wait=new Promise<void>(resolve=>{fail=resolve;});
    casino.postHandler=async(route,reply,index)=>{if(index===1){await wait;await route.abort('failed');}else await route.fulfill({status:200,json:reply});};
    await page.locator('[data-slot-spin]').dblclick({force:true});await expect.poll(()=>casino.posts.length).toBe(1);const id=casino.posts[0].op.id;fail();await expect(page.locator('[data-slot-retry]')).toBeEnabled();
    await expect.poll(async()=>(await audio(page,game)).loopOwners).toBe(0);const played=(await audio(page,game)).played;await page.locator('[data-slot-retry]').click();const saved=await done(page,casino);
    expect((saved.view.studio as StudioSlotView).step).toBe(1);expect(casino.posts[1].op.id).toBe(id);expect(casino.posts.every(({op})=>op.action==='move')).toBe(true);
    expect((await audio(page,game)).played).toEqual(played);expect(casino.metadata).toHaveLength(0);expect(casino.states.get(accountA)!.wallet.entries).toHaveLength(0);expect(errors).toEqual([]);
  });

  test(`${game} rejected or forged metadata cannot create expansion, holdings or multiplier claims`,async({page})=>{
    for(const invalid of ['reject','forged'] as const){
      const {casino,errors}=await ready(page,game);casino.kind='plain';casino.metadataHandler=(route,value)=>invalid==='reject'?route.fulfill({status:409,json:{error:'Этап уже изменился'}}):route.fulfill({status:200,json:{...value,multipliers:[{winIndex:0,line:0,factor:4,positions:[0]}]}});
      await page.locator('[data-slot-spin]').click();await done(page,casino);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation','static');
      const cues=await audio(page,game);expect(cues.played.expand??0).toBe(0);expect(cues.played.sticky??0).toBe(0);expect(cues.played.multiplier??0).toBe(0);
      expect(await page.locator('[data-studio-slot]').getAttribute('data-multiplier-factor')).toBeNull();expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
    }
  });

  test(`${game} reduced motion and global mute have no strips, effects, metadata or sound`,async({page})=>{
    const {casino,errors}=await ready(page,game,{mobile:true,reduced:true,muted:true});casino.kind=game==='studio-cosmic-escape'?'big':'base';await page.locator('[data-slot-spin]').click();await done(page,casino);
    expect((await events(page)).filter(e=>['accelerating','stopping','transforming'].includes(e.phase))).toEqual([]);expect((await audio(page,game)).played).toEqual({});expect((await audio(page,game)).activeSources).toBe(0);expect(casino.metadata).toHaveLength(0);
    await geometry(page,game+'-reduced-mobile');expect(errors).toEqual([]);
  });
}

test('metadata fetch cancellation on close, hidden view and account switch cannot show a late frame',async({page})=>{
  const game='studio-velvet-reign' as const;
  for(const action of ['close','hidden','account'] as const){
    const {casino,errors}=await ready(page,game);const release=casino.holdMetadata();await page.locator('[data-slot-spin]').click();await expect.poll(()=>casino.metadata.length).toBe(1);
    await page.evaluate(action=>{const p=(window as any).slotProbe;if(action==='close')p.close();else if(action==='hidden')p.visibility(true);else p.switchAccount('22222222-2222-4222-8222-222222222222');},action);
    await expect.poll(async()=>(await audio(page,game)).activeSources).toBe(0);release();
    if(action==='close'){await page.evaluate(()=>(window as any).slotProbe.mount());await done(page,casino);}
    else if(action==='hidden'){await page.evaluate(()=>(window as any).slotProbe.visibility(false));await done(page,casino);}
    else{await page.waitForFunction(()=>(window as any).slotProbe.client.accountId==='22222222-2222-4222-8222-222222222222'&&!(window as any).slotProbe.client.loading);await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id','');await expect(page.locator('[data-slot-payout]')).toHaveAttribute('data-units','0');}
    const cues=await audio(page,game);expect(cues.played['reel-stop']??0).toBe(0);expect(cues.played.multiplier??0).toBe(0);expect(cues.played.win??0).toBe(0);expect(cues.played.bigwin??0).toBe(0);expect(casino.posts).toHaveLength(1);expect(errors).toEqual([]);
  }
});

test('Velvet celebrates a real 4x bonus only after the whole saved round is settled',async({page})=>{
  const game='studio-velvet-reign' as const,{casino,errors}=await ready(page,game);casino.kind='bonus-big';
  await page.locator('[data-slot-spin]').click();let saved=await done(page,casino);
  expect(saved.state).toBe('active');expect((await audio(page,game)).played.bigwin??0).toBe(0);await expect(page.locator('[data-slot-bigwin]')).toBeHidden();
  for(let step=1;step<=2;step++){await page.locator('[data-slot-spin]').click();saved=await done(page,casino);if(step===1){expect(saved.state).toBe('active');expect((await audio(page,game)).played.bigwin??0).toBe(0);}}
  expect(saved.state).toBe('settled');expect(saved.returnedUnits).toBe('4178');await expect(page.locator('[data-slot-bigwin]')).toBeVisible();expect((await audio(page,game)).played.bigwin).toBe(1);
  expect(casino.states.get(accountA)!.wallet.balance).toBe(1031.78);expect(casino.states.get(accountA)!.wallet.entries.filter(e=>e.kind==='bet')).toHaveLength(1);
  writeFileSync(`${directory}/velvet-true-bigwin.json`,JSON.stringify({saved,cues:await audio(page,game),posts:casino.posts},null,2));expect(errors).toEqual([]);
});

test('an unavailable metadata response times out and restores the confirmed result without a second action',async({page})=>{
  const game='studio-cosmic-escape' as const,{casino,errors}=await ready(page,game),release=casino.holdMetadata();
  await page.locator('[data-slot-spin]').click();await expect.poll(()=>casino.metadata.length).toBe(1);const saved=casino.states.get(accountA)!.sessions[0];
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id',saved.id,{timeout:10000});await done(page,casino);release();
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation','static');expect(casino.posts).toHaveLength(1);expect((await audio(page,game)).played.expand??0).toBe(0);expect(errors).toEqual([]);
});
