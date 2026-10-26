// Complete-round screening, not RTP qualification. Run with node --import tsx.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {NITRO_BETS, NITRO_MAX_WIN, NITRO_MAX_FREE, NITRO_MAX_FRAMES, nitroDecision, nitroSurvivors, nitroFreeAward} from '../../src/shared/nitroRun.ts';
import {nitroRandomSymbol, startNitro, moveNitro} from '../../server/games/nitroRun.ts';
import {AFTER_MAX_WIN, AFTER_MAX_FREE, AFTER_MAX_FRAMES, afterDecision, afterSurvivors, afterCells} from '../../src/shared/afterglow.ts';
import {afterRandomSymbol, startAfter, moveAfter} from '../../server/games/afterglow.ts';
import {convoyPayout, convoyPins, convoySurvivors, convoyFreeAward} from '../../src/shared/lastConvoy.ts';
import {CONVOY_MATH, startConvoy, moveConvoy} from '../../server/games/lastConvoy.ts';

const args=process.argv.slice(2), option=(key,fallback)=>args.includes('--'+key)?args[args.indexOf('--'+key)+1]:fallback;
const rounds=Number(option('rounds',100000)), crosscheck=Number(option('crosscheck',1000));
const seeds=option('seeds','28102026,9217431,18254161').split(',').map(Number);
const output=resolve(option('output','docs/game-math/native-bonus-audit-20261024.json'));
const selected=option('games','nitro,afterglow,convoy').split(',');
assert(Number.isSafeInteger(rounds)&&rounds>1&&Number.isSafeInteger(crosscheck)&&crosscheck>=0);
assert(seeds.length>1&&seeds.every(n=>Number.isSafeInteger(n)&&n>0&&n<2**32));
function seeded(seed){let state=seed>>>0,calls=0;const draw=max=>{state^=state<<13;state^=state>>>17;state^=state<<5;calls++;return Math.floor((state>>>0)/4294967296*max);};draw.calls=()=>calls;return draw;}

function simulate(id,stake,draw,onSpin){
 const cap=BigInt(stake)*BigInt(id==='nitro'?NITRO_MAX_WIN:id==='afterglow'?AFTER_MAX_WIN:5000);
 let total=0n,base=0n,bonus=null,free=0,frames=0,maximumPins=0;
 do{
  const isFree=!!bonus,pinsBefore=[...(bonus?.pins??[])];let pinCount=pinsBefore.length;
  const sample=id==='nitro'?()=>nitroRandomSymbol(draw):id==='afterglow'?()=>afterRandomSymbol(draw):()=>{
   const n=draw(1000000),beacon=isFree?CONVOY_MATH.freeBeacon:CONVOY_MATH.baseBeacon,barrier=isFree?CONVOY_MATH.freeBarrier:CONVOY_MATH.baseBarrier;
   if(n<beacon)return 7;if(pinCount<6&&n<beacon+barrier){pinCount++;return 8;}return draw(7);
  };
  let grid=Array.from({length:30},(_,p)=>pinsBefore.includes(p)?id==='afterglow'?6:8:sample());
  let paid=0n,gear=isFree?2:1,charge=0,used=false,pins=pinsBefore,cells=[...(bonus?.cells??afterCells())],locked=[];
  const maxFrames=id==='nitro'?NITRO_MAX_FRAMES:id==='afterglow'?AFTER_MAX_FRAMES:20;
  for(let index=0;index<maxFrames;index++){
   frames++;
   let decision,gravity,continuing=false;
   if(id==='nitro'){
    decision=nitroDecision(grid,gear,charge,used,index,stake,cap-total-paid);
    gear=decision.gear;charge=decision.charge;used=decision.used;
    continuing=decision.stop==='continue'||decision.stop==='nitro';
    if(continuing)gravity=nitroSurvivors(grid,decision.removed);
   }else if(id==='afterglow'){
    decision=afterDecision(grid,cells,pins,locked,isFree,index,stake,cap-total-paid);
    pins=decision.pins;cells=decision.cells;locked=decision.locked;continuing=decision.stop==='continue';
    if(continuing)gravity=afterSurvivors(grid,decision.removed,pins);
   }else{
    decision=convoyPayout(grid,stake,cap-total-paid);pins=convoyPins(grid);
    continuing=total+paid+decision.paid<cap&&decision.wins.length>0&&index<19;
    if(continuing)gravity=convoySurvivors(grid,decision.wins.flatMap(w=>w.positions).sort((a,b)=>a-b));
   }
   paid+=decision.paid;maximumPins=Math.max(maximumPins,pins.length);
   if(!continuing)break;
   const next=Array(30).fill(-1);for(const drop of gravity.drops)next[drop.to]=drop.symbol;for(const p of gravity.empty)next[p]=sample();grid=next;
  }
  total+=paid;const capped=total===cap,scatters=grid.filter(n=>n===7).length;let award=0;
  if(bonus){
   free++;bonus.played++;bonus.remaining--;
   if(id!=='nitro')bonus.pins=pins;
   if(id==='afterglow')bonus.cells=cells;
   if(id==='convoy')bonus.multiplier=1+pins.length;
   if(!capped&&scatters>=3){award=Math.min(2,(id==='afterglow'?AFTER_MAX_FREE:NITRO_MAX_FREE)-bonus.awarded);bonus.awarded+=award;bonus.remaining+=award;}
   if(capped)bonus.remaining=0;
  }else{
   base=paid;
   award=capped?0:id==='nitro'?nitroFreeAward(scatters):id==='convoy'?convoyFreeAward(scatters):scatters>=5?12:scatters===4?10:scatters>=3?8:0;
   if(award)bonus={awarded:award,played:0,remaining:award,...(id==='nitro'?{}:id==='convoy'?{pins:[],multiplier:1}:{pins:[],cells:afterCells()})};
  }
  onSpin?.({paid,total,grid,bonus:structuredClone(bonus),capped});
  assert(free<=20&&total<=cap);
 }while(bonus?.remaining);
 return{payout:Number(total),base:Number(base),free,bonus:!!bonus,capped:total===cap,frames,maximumPins};
}

const games={
 nitro:{game:'studio-nitro-run',aliases:['studio-meme-overload'],start:(stake,draw)=>startNitro({nitro:{mode:'normal'}},stake,draw),move:moveNitro},
 afterglow:{game:'studio-afterglow',aliases:['GIRLHUB'],start:(stake,draw)=>startAfter({afterglow:{mode:'normal'}},stake,0,draw),move:moveAfter},
 convoy:{game:'studio-last-convoy',aliases:[],start:(stake,draw)=>startConvoy({convoy:{mode:'normal'}},stake,draw),move:moveConvoy},
};
function crosscheckRound(id,stake,seed){
 const draw=seeded(seed),referenceDraw=seeded(seed),expected=[];
 const fast=simulate(id,stake,draw,s=>expected.push(s)),game=games[id];
 let reference=game.start(stake,referenceDraw),cursor=0;
 for(;;){
  const spin=expected[cursor++];assert(spin);
  assert.equal(reference.view.spin.payoutUnits,String(spin.paid));assert.equal(reference.view.totalPayoutUnits,String(spin.total));
  assert.deepEqual(reference.view.spin.finalGrid,spin.grid);assert.deepEqual(reference.view.bonus,spin.bonus);assert.equal(reference.view.capped,spin.capped);
  if(reference.ended)break;
  reference=game.move(reference.view,stake,reference.view.revision,referenceDraw);
 }
 assert.equal(cursor,expected.length);assert.equal(reference.credit,fast.payout);assert.equal(draw.calls(),referenceDraw.calls());
 return{...fast,seed};
}
const stats=()=>({rounds:0,totalDebitUnits:0,totalCreditUnits:0,sumSquaredReturn:0,baseCreditUnits:0,bonusCreditUnits:0,bonusRounds:0,freeSpins:0,frames:0,cappedRounds:0,maximumReturn:0,maximumPins:0});
function add(s,r,stake){s.rounds++;s.totalDebitUnits+=Number(stake);s.totalCreditUnits+=r.payout;s.sumSquaredReturn+=(r.payout/Number(stake))**2;s.baseCreditUnits+=r.base;s.bonusCreditUnits+=r.payout-r.base;s.bonusRounds+=Number(r.bonus);s.freeSpins+=r.free;s.frames+=r.frames;s.cappedRounds+=Number(r.capped);s.maximumReturn=Math.max(s.maximumReturn,r.payout/Number(stake));s.maximumPins=Math.max(s.maximumPins,r.maximumPins);}
function finish(s){const rtp=s.totalCreditUnits/s.totalDebitUnits,n=s.rounds,variance=(s.sumSquaredReturn-n*rtp*rtp)/(n-1),halfWidth95=1.96*Math.sqrt(Math.max(0,variance)/n);return{...s,rtp,interval95:[rtp-halfWidth95,rtp+halfWidth95],halfWidth95,baseRtp:s.baseCreditUnits/s.totalDebitUnits,bonusRtp:s.bonusCreditUnits/s.totalDebitUnits,bonusRate:s.bonusRounds/n,flag:rtp-halfWidth95>1?'positive_player_expectation':'not_flagged_by_screening'};}
const sourcePaths=['src/shared/nitroRun.ts','src/shared/memeOverload.ts','server/games/nitroRun.ts','src/shared/lastConvoy.ts','server/games/lastConvoy.ts','src/shared/afterglow.ts','server/games/afterglow.ts','server/demoExpansion.ts','server/afterglowProgress.ts'];
const report={generatedAt:new Date().toISOString(),commit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'Independent complete paid rounds including all free continuations. Integer settlement uses unchanged shared decision functions. Optimized entropy loop is cross-checked spin by spin against actual server start/move, including final grid, total credit, bonus state and random sample consumption. Sample-variance normal 95% confidence intervals divide all payout by actual total debit. Screening, not qualification; no multiple-comparison adjustment and rare-tail confidence is approximate.',rng:'xorshift32 with floor scaling to server draw ranges',seeds,mode:'normal',stakeUnits:'10000',allStakes:NITRO_BETS,stakeScaling:'All supported stakes are multiples of 100 and every line payment is stake*integer/100, so integer settlement and caps scale exactly with stake. Paired exact server replays below cover every stake.',sourceHashes:Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')]))),results:[]};
for(const id of args.includes('--wallet-only')||args.includes('--demo-wallet-only')?[]:selected){
 assert(games[id]);const aggregate=stats(),samples=[],checks=[];
 for(const seed of seeds){
  let checkedBonuses=0,checkedFreeSpins=0;
  for(let i=0;i<crosscheck;i++){const r=crosscheckRound(id,'10000',(seed+i*7919)>>>0||1);checkedBonuses+=Number(r.bonus);checkedFreeSpins+=r.free;}
  checks.push({seed,rounds:crosscheck,bonusRounds:checkedBonuses,freeSpins:checkedFreeSpins});
  const draw=seeded(seed),s=stats();
  for(let i=0;i<rounds;i++){const r=simulate(id,'10000',draw);add(s,r,'10000');add(aggregate,r,'10000');}
  const summary={seed,...finish(s)};samples.push(summary);console.log(JSON.stringify({game:games[id].game,...summary}));
 }
 const stakeChecks=[];
 for(const stake of NITRO_BETS){for(const seed of seeds){for(let i=0;i<5;i++)crosscheckRound(id,stake,(seed+i*7919)>>>0||1);}stakeChecks.push({stake,rounds:seeds.length*5});}
 const result={game:games[id].game,aliases:games[id].aliases,modes:[{mode:'normal',costMultiplier:1,paidBonusPurchase:false,freeContinuationCostUnits:0}],...finish(aggregate),seeds:samples,serverCrosschecks:checks,allStakeServerCrosschecks:stakeChecks};
 report.results.push(result);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({complete:games[id].game,rtp:result.rtp,interval95:result.interval95,output}));
}

// Optional local journal check. Run through scripts/database-test.ts with --wallet-only.
if(args.includes('--wallet-only')||args.includes('--demo-wallet-only')){
 const demoOnly=args.includes('--demo-wallet-only');
 const {randomUUID}=await import('node:crypto');
 const {pvpFixture}=await import('../../server-tests/finance/helpers/nile-pvp-fixture.ts');
 const {block}=await import('../../server-tests/finance/helpers/nile-play-fixture.ts');
 const {NileGameRuntime}=await import('../../server/finance/nile-game-runtime.ts');
 const command=(body=null)=>({path:'/expansion',body,method:body===null?'GET':'POST',flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{}});
 const configs=[
  {id:'studio-nitro-run',engine:'nitro',settings:{nitro:{mode:'normal'}},key:'nitro',move:'nitro-spin'},
  {id:'studio-meme-overload',engine:'nitro',settings:{nitro:{mode:'normal'}},key:'nitro',move:'nitro-spin'},
  {id:'studio-afterglow',engine:'afterglow',settings:{afterglow:{mode:'normal'}},key:'afterglow',move:'afterglow-spin'},
  {id:'studio-last-convoy',engine:'convoy',settings:{convoy:{mode:'normal'}},key:'convoy',move:'convoy-spin'},
 ];
 const checks=[];
 let fixture,createRuntime,audit;
 if(demoOnly){
  const {PostgresDatabase}=await import('../../server/database.ts'),{DemoWalletStore}=await import('../../server/demoWallet.ts');
  const {demoBalanceUnits,demoReservedUnits}=await import('../../server/demoWalletAmounts.ts');
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('native-audit')");
  const wallet=new DemoWalletStore(db);await wallet.operate('native-audit',{id:randomUUID(),kind:'deposit',amount:200});
  fixture={a:'native-audit',close:()=>db.close()};
  createRuntime=draw=>{const store=new DemoWalletStore(db,draw);return{ready:store.ready,run:async(account,cmd)=>{
   const value=cmd.method==='GET'?await store.expansion.active(account):await store.expansion.operate(account,cmd.body);
   value.wallet.balanceUnits=String(BigInt(await demoBalanceUnits(db,account))*10000n);value.wallet.reservedUnits=String(BigInt(await demoReservedUnits(db,account))*10000n);return value;
  }};};
  audit=async()=>{const row=await db.prepare('SELECT COALESCE(SUM(amount_units),0) AS total FROM demo_ledger WHERE account_id=?').get(fixture.a);assert.equal(Number(row.total),await demoBalanceUnits(db,fixture.a));};
 }else{
  fixture=await pvpFixture();createRuntime=draw=>new NileGameRuntime(fixture.ledger,draw);audit=()=>fixture.ledger.audit();
 }
 try{
  if(!demoOnly){await fixture.source.ingest(block(102,'1000000000000',fixture.config.source.addresses.find(a=>a.userId==='reserve').address));await fixture.ledger.sync(fixture.source,await fixture.reconciliation());}
  let balance=200000000n;
  for(const game of configs){
   const engine=games[game.engine];let seed=1;
   for(;seed<10000;seed++)if(!engine.start('100',seeded(seed)).ended)break;
   assert(seed<10000);const expectedDraw=seeded(seed);let expected=engine.start('100',expectedDraw);
   while(!expected.ended)expected=engine.move(expected.view,'100',expected.view.revision,expectedDraw);
   const draw=seeded(seed);let runtime=createRuntime(draw);await runtime.ready;
   const badSettings=structuredClone(game.settings);Object.values(badSettings)[0].mode='buy-free';
   await assert.rejects(runtime.run(fixture.a,command({id:randomUUID(),action:'start',gameId:game.id,stakeUnits:'100',settings:badSettings})));assert.equal(draw.calls(),0);
   const start={id:randomUUID(),action:'start',gameId:game.id,stakeUnits:'100',settings:game.settings};
   let reply=await runtime.run(fixture.a,command(start));assert.equal(reply.session.state,'active');assert.equal(reply.wallet.balanceUnits,String(balance-1000000n));
   const afterStartCalls=draw.calls(),replay=await runtime.run(fixture.a,command(start));assert.equal(replay.replayed,true);assert.equal(draw.calls(),afterStartCalls);assert.equal(replay.wallet.balanceUnits,String(balance-1000000n));
   runtime=createRuntime(draw);const restored=await runtime.run(fixture.a,command());assert.deepEqual(restored.sessions.find(s=>s.id===start.id),reply.session);
   let free=0,last;
   while(reply.session.state==='active'){
    const view=reply.session.view[game.key],op={id:randomUUID(),action:'move',gameId:game.id,sessionId:start.id,move:game.move,revision:view.revision};
    const before=draw.calls();await assert.rejects(runtime.run(fixture.a,command({...op,id:randomUUID(),revision:view.revision+1})));assert.equal(draw.calls(),before);
    await assert.rejects(runtime.run(fixture.a,command({...op,id:randomUUID(),stakeUnits:'100000'})));assert.equal(draw.calls(),before);
    last=op;reply=await runtime.run(fixture.a,command(op));free++;
    if(reply.session.state==='active')assert.equal(reply.wallet.balanceUnits,String(balance-1000000n));
   }
   assert.equal(reply.session.spentUnits,'100');assert.equal(reply.session.returnedUnits,String(expected.credit));assert.equal(draw.calls(),expectedDraw.calls());
   balance=balance-1000000n+BigInt(expected.credit)*10000n;assert.equal(reply.wallet.balanceUnits,String(balance));assert.equal(reply.wallet.reservedUnits,'0');
   const before=draw.calls(),repeat=await runtime.run(fixture.a,command(last));assert.equal(repeat.replayed,true);assert.equal(repeat.wallet.balanceUnits,String(balance));assert.equal(draw.calls(),before);
   await assert.rejects(runtime.run(fixture.a,command({...last,id:randomUUID()})));assert.equal(draw.calls(),before);await audit();
   checks.push({game:game.id,walletPath:demoOnly?'DemoWalletStore':'NileGameRuntime',seed,stakeUnits:'100',freeSpins:free,returnedUnits:String(expected.credit),restored:true,invalidPurchaseRejected:true,duplicateStartReplayedWithoutDraw:true,staleRevisionRejected:true,stakeChangeRejected:true,duplicateFinalMoveReplayedWithoutDraw:true,newMoveAfterSettlementRejected:true,ledgerReconciled:true});
  }
  const existing=JSON.parse(await readFile(output,'utf8'));existing[demoOnly?'demoWalletChecks':'walletChecks']=checks;await writeFile(output,JSON.stringify(existing,null,2)+'\n');console.log(JSON.stringify({walletChecks:checks}));
 }finally{await fixture.close();}
}
