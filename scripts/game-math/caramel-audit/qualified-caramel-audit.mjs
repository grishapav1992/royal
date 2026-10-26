// Independent complete paid rounds. This audit does not qualify or change game rules.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CARAMEL_MATH,startCaramel,moveCaramel,caramelSymbol} from '../../../server/games/caramelCarnival.ts';
import {CARAMEL_BETS,CARAMEL_PAYTABLE,CARAMEL_ENERGY,CARAMEL_MAX_WIN,CARAMEL_MAX_CASCADES,CARAMEL_MAX_FREE_SPINS,caramelPayout,validCaramelSettlement} from '../../../src/shared/caramelCarnival.ts';
const outputFolder=new URL('../../../artifacts/work/caramel-audit-20261026/',import.meta.url);
mkdirSync(outputFolder,{recursive:true});
try{writeFileSync(new URL('OWNER.txt',outputFolder),"Owner: Caramel audit runner\nPurpose: generated current-rules Caramel audit output\nCleanup: preserve compact results in GitHub when needed, then remove obsolete task-owned diagnostics; source and tracked evidence are never written here\n",{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}


const root=fileURLToPath(new URL('../../../',import.meta.url)),folder=outputFolder;
const args=process.argv.slice(2),option=(key,fallback)=>args.includes('--'+key)?args[args.indexOf('--'+key)+1]:fallback;
const normalRounds=Number(option('normal-rounds',2000000)),festivalRounds=Number(option('festival-rounds',500000));
const seeds=String(option('seeds','260102601,260102623,260102647,260102671')).split(',').map(Number);
const replayRounds=Number(option('replays',64));
assert([normalRounds,festivalRounds,replayRounds,...seeds].every(Number.isSafeInteger));
assert(normalRounds>1&&festivalRounds>1&&replayRounds>0&&new Set(seeds).size===seeds.length);
const model={version:1,ordinaryWeights:[1,1,1,1,1,1,1],baseSpinnerPerMillion:15450,freeSpinnerPerMillion:68500,baseTicketPerMillion:22000,freeTicketPerMillion:12000,energyWeights:[52,25,18,5]};
const paytable=[[19,38,75],[23,45,94],[28,56,119],[35,69,150],[44,88,200],[56,113,263],[75,150,375]],energy=[2,3,5,10];
assert.deepEqual(CARAMEL_MATH,model);assert.deepEqual(CARAMEL_PAYTABLE,paytable);assert.deepEqual(CARAMEL_ENERGY,energy);
assert.equal(CARAMEL_MAX_WIN,5000);assert.equal(CARAMEL_MAX_CASCADES,20);assert.equal(CARAMEL_MAX_FREE_SPINS,30);
assert(CARAMEL_BETS.every(stake=>BigInt(stake)%100n===0n));
const sourceFiles=['server/games/caramelCarnival.ts','src/shared/caramelCarnival.ts','src/modules/GameModuleCatalog.ts'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(root+path).toString().replace(/\r\n/g,'\n')).digest('hex')]));
const initialHashes=sourceHashes();

// xoshiro128** plus splitmix32 seed expansion; rejection gives uniform integer draws.
function random(seed){
 let z=seed>>>0;
 const split=()=>{z=(z+0x9e3779b9)>>>0;let a=z;a=Math.imul(a^(a>>>16),0x21f0aaad);a=Math.imul(a^(a>>>15),0x735a2d97);return (a^(a>>>15))>>>0;};
 let a=split(),b=split(),c=split(),d=split(),calls=0;
 const word=()=>{const x=Math.imul(b,5),result=Math.imul((x<<7)|(x>>>25),9)>>>0,t=b<<9;c^=a;d^=b;b^=c;a^=d;c^=t;d=(d<<11)|(d>>>21);return result;};
 const draw=max=>{assert(Number.isInteger(max)&&max>0&&max<=0x100000000);const limit=Math.floor(0x100000000/max)*max;let value;do{value=word();calls++;}while(value>=limit);return value%max;};
 draw.calls=()=>calls;return draw;
}
function symbol(free,draw){
 const roll=draw(1000000),ticket=free?12000:22000,spinner=free?68500:15450;
 if(roll<ticket)return 7;
 if(roll>=ticket+spinner)return draw(7);
 const value=draw(100);return value<52?8:value<77?9:value<95?10:11;
}
function independentFrame(counts,before,room){
 let n=0,e=0,sum=0;
 for(let s=0;s<7;s++)if(counts[s]>=8)n++;
 if(n)for(let s=8;s<12;s++)e+=counts[s]*energy[s-8];
 const multiplier=Math.min(50,before+e),wins=[];
 for(let s=0;s<7;s++)if(counts[s]>=8){const coefficient=paytable[s][counts[s]>=12?2:counts[s]>=10?1:0],raw=coefficient*multiplier,paid=Math.min(raw,room-sum);sum+=paid;wins.push({symbol:s,count:counts[s],coefficient,raw,paid});}
 return {multiplier,energy:e,wins,paid:sum,raw:wins.reduce((sum,w)=>sum+w.raw,0)};
}
function round(mode,draw,trace=false){
 let remaining=mode==='festival'?10:0,bonus=remaining>0,multiplier=1,total=0,base=0,spins=0,awarded=remaining,free=0;
 const counters={frames:0,retriggers:0,energyEvents:0,multiplierCaps:0,cascadeLimits:0,naturalBonuses:0,firstFrame:0,firstFrameWin:0,initialTickets:0};
 const history=trace?[]:null;
 do{
  const freeSpin=bonus,before=multiplier,counts=Array(12).fill(0),frames=trace?[]:null;
  for(let i=0;i<30;i++)counts[symbol(freeSpin,draw)]++;
  const initialTickets=counts[7];let paid=0,raw=0;
  for(let step=0;step<20;step++){
   const payment=independentFrame(counts,multiplier,500000-total-paid);
   multiplier=payment.multiplier;paid+=payment.paid;raw+=payment.raw;counters.frames++;
   counters.energyEvents+=Number(payment.energy>0);counters.multiplierCaps+=Number(payment.energy>0&&multiplier===50);
   if(step===0){counters.firstFrame+=payment.paid;counters.firstFrameWin+=Number(payment.wins.length>0);}
   const stop=total+paid===500000?'win-cap':!payment.wins.length?'no-win':step===19?'cascade-limit':'continue';
   if(trace)frames.push({beforeCounts:[...counts],multiplier,energy:payment.energy,wins:payment.wins,paid:payment.paid,raw:payment.raw,stop});
   if(total+paid===500000||!payment.wins.length)break;
   // Positions and gravity do not affect counts: all paid ordinary symbols and all spinners are removed.
   let removed=0;
   for(const win of payment.wins){removed+=counts[win.symbol];counts[win.symbol]=0;}
   for(let s=8;s<12;s++){removed+=counts[s];counts[s]=0;}
   for(let i=0;i<removed;i++)counts[symbol(freeSpin,draw)]++;
   if(step===19)counters.cascadeLimits++;
  }
  const tickets=counts[7];let grant=0;
  total+=paid;spins++;
  if(freeSpin){free++;remaining--;if(total===500000)remaining=0;else if(tickets>=3){grant=Math.min(3,30-awarded);remaining+=grant;awarded+=grant;counters.retriggers+=Number(grant>0);}}
  else{base=paid;counters.initialTickets=initialTickets;if(total<500000&&tickets>=4){bonus=true;grant=10;remaining=10;awarded=10;counters.naturalBonuses++;}}
  if(trace)history.push({free:freeSpin,before,multiplier,tickets,initialTickets,grant,paid,raw,frames});
  if(!freeSpin&&bonus)multiplier=1;
  if(total===500000)break;
 }while(remaining);
 assert(spins<=(mode==='normal'?31:30));assert(free<=30);assert(total<=500000);
 return {total,base,spins,free,awarded,multiplier,history,counters};
}

function replay(){
 const coverage=[],totals={paidRounds:0,freeSpins:0,naturalBonuses:0,retriggers:0,energyEvents:0,cascadeLimits:0,multiplierCaps:0};
 for(const mode of ['normal','festival'])for(const stake of CARAMEL_BETS){
  const slow=random(260102701+(mode==='festival'?104729:0)),fast=random(260102701+(mode==='festival'?104729:0));
  const hash=createHash('sha256');
  for(let index=0;index<replayRounds;index++){
   const actual=round(mode,fast,true);let server=startCaramel({caramel:{mode}},stake,slow);
   while(!server.ended)server=moveCaramel(server.view,stake,server.view.revision,slow);
   assert.equal(server.credit,actual.total*(Number(stake)/100));assert.equal(server.view.history.length,actual.spins);
   assert(validCaramelSettlement('settled',stake,String(BigInt(stake)*BigInt(mode==='festival'?35:1)),String(server.credit),server.view));
   for(const [spinIndex,spin]of server.view.history.entries()){
    const expected=actual.history[spinIndex];assert.equal(spin.kind,expected.free?'free':'base');assert.equal(spin.multiplierBefore,expected.before);
    assert.equal(spin.multiplierAfter,expected.multiplier);assert.equal(spin.tickets,expected.tickets);assert.equal(spin.freeAward,expected.grant);
    assert.equal(Number(spin.payoutUnits),expected.paid*(Number(stake)/100));assert.equal(spin.frames.length,expected.frames.length);
    for(const [frameIndex,frame]of spin.frames.entries()){
     const check=expected.frames[frameIndex],counts=Array(12).fill(0);for(const s of frame.before)counts[s]++;
     assert.deepEqual(counts,check.beforeCounts);assert.equal(frame.multiplierAfter,check.multiplier);assert.equal(frame.energy,check.energy);assert.equal(frame.stop,check.stop);
     assert.deepEqual(frame.wins.map(w=>[w.symbol,w.positions.length,w.payHundredths,Number(w.payoutUnits)]),check.wins.map(w=>[w.symbol,w.count,w.coefficient,w.paid*(Number(stake)/100)]));
    }
   }
   assert.equal(slow.calls(),fast.calls());assert.equal(slow(1000000000),fast(1000000000));
   hash.update(JSON.stringify([actual.total,actual.spins,actual.awarded,actual.multiplier,slow.calls()])+'\n');
   totals.paidRounds++;totals.freeSpins+=actual.free;for(const key of ['naturalBonuses','retriggers','energyEvents','cascadeLimits','multiplierCaps'])totals[key]+=actual.counters[key];
  }
  coverage.push({mode,stakeUnits:Number(stake),paidRounds:replayRounds,sha256:hash.digest('hex')});
 }
 return {coverage,totals,note:'The same normalized paths across stakes are cross-checks and are not additional independent statistical samples.'};
}

function scorerChecks(){
 let checks=0;
 for(let count=0;count<=30;count++)for(let s=0;s<7;s++)for(const multiplier of [1,2,17,49,50])for(const stake of CARAMEL_BETS){
  const grid=Array(count).fill(s);while(grid.length<30)grid.push(7);const counts=Array(12).fill(0);for(const n of grid)counts[n]++;
  const expected=independentFrame(counts,multiplier,500000),actual=caramelPayout(grid,multiplier,stake,BigInt(stake)*5000n);
  assert.equal(actual.paid,BigInt(expected.paid)*BigInt(stake)/100n);assert.equal(actual.multiplier,expected.multiplier);checks++;
 }
 for(let i=0;i<10000;i++){
  const draw=random(260103000+i),grid=Array.from({length:30},()=>symbol(i%2===0,draw)),counts=Array(12).fill(0);for(const n of grid)counts[n]++;
  const m=1+i%50,room=i%7===0?i%1000:500000,expected=independentFrame(counts,m,room),actual=caramelPayout(grid,m,'100',BigInt(room));
  assert.equal(actual.paid,BigInt(expected.paid));assert.equal(actual.raw,BigInt(expected.raw));assert.equal(actual.multiplier,expected.multiplier);assert.equal(actual.energy,expected.energy);checks++;
 }
 // Equal entropy, independent category implementation, including every threshold boundary.
 let symbolChecks=0;
 for(const free of [false,true])for(const first of [0,11999,12000,21999,22000,37449,37450,80499,80500,999999])for(const second of [0,1,4,6,51,52,76,77,94,95,99]){
  const slow=[first,second],fast=[first,second];assert.equal(caramelSymbol(free,max=>slow.shift()%max),symbol(free,max=>fast.shift()%max));assert.equal(slow.length,fast.length);symbolChecks++;
 }
 return {scorerChecks:checks,symbolChecks};
}

function scriptedDraw(prefix,repeat){
 let cursor=0,pending=null;
 return max=>{
  if(pending!==null){const symbol=pending;pending=null;if(symbol<7){assert.equal(max,7);return symbol;}assert.equal(max,100);return [0,52,77,95][symbol-8];}
  assert.equal(max,1000000);const symbol=cursor<prefix.length?prefix[cursor]:repeat[(cursor-prefix.length)%repeat.length];cursor++;
  if(symbol===7)return 0;pending=symbol;return symbol<7?999999:30000;
 };
}
function forcedBranches(){
 const miss=[7,7,7,...Array.from({length:27},(_,i)=>i%7)],big=[...Array(12).fill(6),...Array(12).fill(5),...Array(6).fill(11)];
 const natural=[...Array(8).fill(6),7,7,7,...Array.from({length:18},(_,i)=>i%6),11,7,0,1,2,3,4,5,0,1];
 const cascade=[...Array(600).fill(6),7,7,7,7,...Array.from({length:26},(_,i)=>i%7)];
 const cases=[{id:'whole-round-cap',mode:'festival',prefix:[],repeat:big},
  {id:'retrigger-ceiling',mode:'festival',prefix:[],repeat:miss},
  {id:'natural-entry-reset-and-final-tickets',mode:'normal',prefix:natural,repeat:miss},
  {id:'cascade-limit-unscored-refill-tickets',mode:'normal',prefix:cascade,repeat:miss}];
 const results=[];
 for(const scenario of cases)for(const stake of CARAMEL_BETS){
  const slow=scriptedDraw(scenario.prefix,scenario.repeat),fast=scriptedDraw(scenario.prefix,scenario.repeat),expected=round(scenario.mode,fast,true);
  let actual=startCaramel({caramel:{mode:scenario.mode}},stake,slow);
  while(!actual.ended)actual=moveCaramel(actual.view,stake,actual.view.revision,slow);
  assert.equal(actual.credit,expected.total*Number(stake)/100);assert.equal(actual.view.history.length,expected.spins);
  if(scenario.id==='whole-round-cap'){assert(actual.view.capped);assert.equal(actual.credit,Number(stake)*5000);assert.equal(actual.view.bonus.remaining,0);assert.equal(actual.view.history[0].frames.length,16);}
  else if(scenario.id==='retrigger-ceiling'){assert.equal(actual.view.history.length,30);assert.equal(actual.view.bonus.awarded,30);assert.equal(actual.credit,0);assert(actual.view.history.some(s=>s.freeAward===2));}
  else if(scenario.id==='natural-entry-reset-and-final-tickets'){assert.equal(actual.view.history[0].initialGrid.filter(s=>s===7).length,3);assert.equal(actual.view.history[0].tickets,4);assert.equal(actual.view.history[0].multiplierAfter,11);assert.equal(actual.view.history[1].multiplierBefore,1);assert.equal(actual.view.history.length,31);}
  else{assert.equal(actual.view.history[0].frames.length,20);assert.equal(actual.view.history[0].frames.at(-1).stop,'cascade-limit');assert.equal(actual.view.history[0].tickets,4);assert.equal(actual.view.history[0].freeAward,10);assert.equal(actual.view.history.length,31);}
  results.push({id:scenario.id,mode:scenario.mode,stakeUnits:Number(stake),creditUnits:actual.credit,spins:actual.view.history.length,capped:actual.view.capped});
 }
 return {checks:results.length,results,note:'Forced trajectories test branch arithmetic and cap behavior, and are not random RTP samples.'};
}

function gcd(a,b){while(b){const t=a%b;a=b;b=t;}return a;}
function fraction(n,d){const common=gcd(n,d);n/=common;d/=common;return {numerator:String(n),denominator:String(d),value:Number(n)/Number(d)};}
function choose(n,k){let v=1n;for(let i=1;i<=k;i++)v=v*BigInt(n-i+1)/BigInt(i);return v;}
function exactInitial(free,before=1){
 const ticket=free?12000:22000,spinner=free?68500:15450,den=700000000n,ordinary=BigInt(100*(1000000-ticket-spinner));
 const spinnerWeights=model.energyWeights.map(w=>BigInt(spinner*w*7)),other=den-ordinary-spinnerWeights.reduce((a,b)=>a+b,0n),clip=50-before;
 let dist=Array.from({length:31},()=>Array(clip+1).fill(0n));dist[0][0]=1n;
 for(let cells=0;cells<30;cells++){
  const next=Array.from({length:31},()=>Array(clip+1).fill(0n));
  for(let k=0;k<=cells;k++)for(let e=0;e<=clip;e++)if(dist[k][e]){
   const p=dist[k][e];next[k][e]+=p*other;next[k+1][e]+=p*ordinary;
   for(let type=0;type<4;type++)next[k][Math.min(clip,e+energy[type])]+=p*spinnerWeights[type];
  }
  dist=next;
 }
 let payment=0n;
 for(let k=8;k<=30;k++){
  const coefficient=paytable.reduce((sum,row)=>sum+row[k>=12?2:k>=10?1:0],0);
  for(let e=0;e<=clip;e++)payment+=dist[k][e]*BigInt(coefficient*(before+e));
 }
 // Exact complementary event: each of the seven ordinary symbol counts is at most seven.
 let bounded=Array(31).fill(0n);bounded[0]=1n;
 for(let s=0;s<7;s++){
  const next=Array(31).fill(0n);
  for(let n=0;n<=30;n++)if(bounded[n])for(let add=0;add<=7&&n+add<=30;add++)next[n+add]+=bounded[n]*choose(n+add,add)*ordinary**BigInt(add);
  bounded=next;
 }
 const total=den**30n,nonOrdinary=den-7n*ordinary;
 const noWin=bounded.reduce((sum,v,n)=>sum+choose(30,n)*v*nonOrdinary**BigInt(30-n),0n);
 let ticketAtLeast=0n;
 for(let k=free?3:4;k<=30;k++)ticketAtLeast+=choose(30,k)*BigInt(ticket)**BigInt(k)*BigInt(1000000-ticket)**BigInt(30-k);
 return {free,before,initialFramePayoutInStakes:fraction(payment,total*100n),initialWinProbability:fraction(total-noWin,total),initialTicketThresholdProbability:fraction(ticketAtLeast,1000000n**30n),note:'Only the initial frame is integrated exactly. Cascade refills enrich final tickets; this initial ticket probability is not the full bonus/retrigger probability.'};
}

function empty(){return {n:0,sum:0,sq:0,base:0,profit:0,caps:0,max:0,freeSpins:0,awarded:0,frames:0,retriggers:0,energyEvents:0,multiplierCaps:0,cascadeLimits:0,naturalBonuses:0,zero:0};}
function summary(s,cost){
 assert(Number.isSafeInteger(s.sum)&&Number.isSafeInteger(s.sq));
 const mean=s.sum/s.n/100,variance=Math.max(0,(s.sq-s.sum*s.sum/s.n)/(s.n-1))/10000,se=Math.sqrt(variance/s.n),half=1.96*se/cost;
 return {...s,costMultiplier:cost,rtp:mean/cost,interval95:[mean/cost-half,mean/cost+half],standardDeviationInStakes:Math.sqrt(variance),meanPayoutInStakes:mean,baseRtp:s.base/s.n/100/cost,bonusRtp:(s.sum-s.base)/s.n/100/cost,profitProbability:s.profit/s.n,zeroProbability:s.zero/s.n,capProbability:s.caps/s.n};
}

const report={generatedAt:new Date().toISOString(),sourceCommit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:initialHashes,
 method:'Independent count-state full-round simulator with independent random category thresholds and pay scorer; exact initial-frame integrations; exact server replay per mode/stake; fresh fixed seeds. Approximate normal 95% intervals use complete independent paid rounds. No formal target policy exists for Caramel. Not formal RTP qualification.',
 inventory:{gameId:'studio-caramel-carnival',rulesVersion:2,progressVersion:1,math:model,stakes:CARAMEL_BETS.map(Number),modes:[{id:'normal',cost:1},{id:'festival',cost:35,initialFreeSpins:10}],paytable,energy,maxMultiplier:50,roundCapInStakes:5000,cascadeLimit:20,maxAwardedFreeSpins:30,retriggerTicketThreshold:3,retriggerAward:3,baseTicketThreshold:4,ordinaryWinningThresholds:[8,10,12],targetRtp:null,tolerance:null,targetNote:'The registered RTP policy has no Caramel profile; approximately 96% in previous screening is an observation, not an explicit approved target.',stakeScaling:'All 13 stake values are multiples of 100. Every group award, the 5000x cap and paid costs scale pointwise exactly, without rounding loss. Identical random paths across stakes do not add independent samples.'},
 seeds,normalRoundsPerSeed:normalRounds,festivalRoundsPerSeed:festivalRounds,checks:scorerChecks(),forcedBranches:forcedBranches(),serverReplay:replay(),exactInitial:[exactInitial(false),exactInitial(true)],
 concentrationBound:{method:'Maurer and Pontil 2009, Theorem 4, empirical Bernstein with unbiased sample variance; both tails for both modes, each tail failure probability 0.0025, union bound 0.01.',source:'https://arxiv.org/pdf/0907.3740',formula:'radius = sqrt(2 * sampleVariance * log(800) / n) + 7 * payoutRange * log(800) / (3 * (n - 1))',assumption:'The theorem assumes iid complete-round samples. The reproducible seeded pseudorandom generator models independent uniform draws; this is statistical evidence, not a deterministic proof of exact RTP. All sample sizes and seeds were fixed before the full run.'},results:[]};
console.log(JSON.stringify({stage:'checks-complete',checks:report.checks,replays:report.serverReplay.totals,exactInitial:report.exactInitial.map(r=>({free:r.free,payout:r.initialFramePayoutInStakes.value,win:r.initialWinProbability.value,tickets:r.initialTicketThresholdProbability.value}))}));
if(args.includes('--checks-only')){
 const {generatedAt,sourceCommit,sourceHashes,checks,forcedBranches,serverReplay,exactInitial}=report;
 writeFileSync(new URL('qualified-caramel-checks.json',folder),JSON.stringify({generatedAt,sourceCommit,sourceHashes,checks,forcedBranches,serverReplay,exactInitial},null,2)+'\n');
 process.exit(0);
}
for(const mode of ['normal','festival']){
 const all=empty(),streams=[],cost=mode==='festival'?35:1;
 for(const seed of seeds){
  const draw=random(seed+(mode==='festival'?104729:0)),s=empty(),n=mode==='festival'?festivalRounds:normalRounds;
  for(let i=0;i<n;i++){
   const actual=round(mode,draw);s.n++;s.sum+=actual.total;s.sq+=actual.total*actual.total;s.base+=actual.base;s.profit+=Number(actual.total>cost*100);s.zero+=Number(actual.total===0);s.caps+=Number(actual.total===500000);s.max=Math.max(s.max,actual.total);s.freeSpins+=actual.free;s.awarded+=actual.awarded;
   for(const key of ['frames','retriggers','energyEvents','multiplierCaps','cascadeLimits','naturalBonuses'])s[key]+=actual.counters[key];
  }
  for(const key of Object.keys(all))all[key]=key==='max'?Math.max(all[key],s[key]):all[key]+s[key];
  streams.push({seed:seed+(mode==='festival'?104729:0),...summary(s,cost)});
  console.log(JSON.stringify({stage:'stream',mode,...streams.at(-1)}));
 }
 const summed=summary(all,cost),variance=summed.standardDeviationInStakes**2/cost**2;
 const radius=Math.sqrt(2*variance*Math.log(800)/all.n)+7*(5000/cost)*Math.log(800)/(3*(all.n-1));
 report.results.push({mode,...summed,empiricalBernstein99SimultaneousInterval:[Math.max(0,summed.rtp-radius),Math.min(5000/cost,summed.rtp+radius)],streams});
 assert.deepEqual(sourceHashes(),initialHashes,'Caramel inputs changed during the audit');
 writeFileSync(new URL('qualified-caramel-audit.json',folder),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({stage:'complete',results:report.results.map(r=>({mode:r.mode,n:r.n,rtp:r.rtp,interval95:r.interval95,caps:r.caps,maxPayoutInStakes:r.max/100}))}));
