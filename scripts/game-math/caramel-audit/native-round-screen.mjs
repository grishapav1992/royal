import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const outputFolder=new URL('../../../artifacts/work/caramel-audit-20261026/',import.meta.url);
mkdirSync(outputFolder,{recursive:true});
try{writeFileSync(new URL('OWNER.txt',outputFolder),"Owner: Caramel audit runner\nPurpose: generated current-rules Caramel audit output\nCleanup: preserve compact results in GitHub when needed, then remove obsolete task-owned diagnostics; source and tracked evidence are never written here\n",{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}

const folder=dirname(fileURLToPath(import.meta.url)),root=resolve(folder,'../../..');
const {startCaramel,moveCaramel,CARAMEL_MATH:M}=await import(pathToFileURL(resolve(root,'server/games/caramelCarnival.ts')));
const {CARAMEL_BETS,CARAMEL_PAYTABLE:PAY}=await import(pathToFileURL(resolve(root,'src/shared/caramelCarnival.ts')));
const args=process.argv.slice(2),option=(name,fallback)=>args.includes('--'+name)?args[args.indexOf('--'+name)+1]:fallback;
const counts={normal:Number(option('normal-rounds',300000)),festival:Number(option('festival-rounds',100000))};
const seeds=String(option('seeds','10500193,20800487,31100779')).split(',').map(Number),replays=Number(option('replays',16));
assert(Object.values(counts).every(n=>Number.isSafeInteger(n)&&n>1));assert(seeds.length>=2&&seeds.every(Number.isSafeInteger));
function rng(seed){let state=seed>>>0;return max=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return Math.floor((((t^(t>>>14))>>>0)/4294967296)*max);};}
function weighted(weights,draw){let roll=draw(weights.reduce((a,b)=>a+b,0));for(let i=0;i<weights.length;i++){if(roll<weights[i])return i;roll-=weights[i];}throw Error('Invalid weights');}
function symbol(free,draw){const roll=draw(1000000),tickets=free?M.freeTicketPerMillion:M.baseTicketPerMillion,spinner=free?M.freeSpinnerPerMillion:M.baseSpinnerPerMillion;
 return roll<tickets?7:roll<tickets+spinner?8+weighted(M.energyWeights,draw):weighted(M.ordinaryWeights,draw);}
function round(mode,stake,draw,trace=false){
 const cap=stake*5000;let total=0,bonus=mode==='festival'?{awarded:10,played:0,remaining:10,multiplier:1}:null;
 let spins=0,freeSpins=0,retriggerSpins=0,basePayout=0,maxFrames=0,maxMultiplier=1;const history=[];
 do{
  const free=bonus!==null,initial=Array.from({length:30},()=>symbol(free,draw));let grid=initial,multiplier=bonus?.multiplier??1,paid=0,raw=0;
  const multiplierBefore=multiplier,frames=[];
  for(let step=0;step<20;step++){
   const counts=Array(12).fill(0);for(const s of grid)counts[s]++;
   const winning=[];for(let s=0;s<7;s++)if(counts[s]>=8)winning.push(s);
   let energy=0;if(winning.length)for(let s=8;s<12;s++)energy+=counts[s]*[2,3,5,10][s-8];
   const before=multiplier;multiplier=Math.min(50,multiplier+energy);maxMultiplier=Math.max(maxMultiplier,multiplier);
   let framePaid=0,frameRaw=0;const wins=[];
   for(const s of winning){
    const payHundredths=PAY[s][counts[s]>=12?2:counts[s]>=10?1:0],amount=Math.floor(stake*payHundredths*multiplier/100),award=Math.min(cap-total-paid-framePaid,amount);
    framePaid+=award;frameRaw+=amount;
    if(trace)wins.push({symbol:s,positions:grid.flatMap((v,i)=>v===s?[i]:[]),payHundredths,factor:multiplier,payoutUnits:String(award),uncappedPayoutUnits:String(amount)});
   }
   paid+=framePaid;raw+=frameRaw;const capped=total+paid===cap;
   const stop=capped?'win-cap':!winning.length?'no-win':step===19?'cascade-limit':'continue';
   let after=grid,removed=[],drops=[],refills=[];
   if(!capped&&winning.length){
    const gone=Array(30).fill(false);for(let i=0;i<30;i++)if(grid[i]>=8||winning.includes(grid[i])){gone[i]=true;if(trace)removed.push(i);}
    after=Array(30).fill(-1);
    for(let col=0;col<6;col++){
     const keep=[];for(let row=0;row<5;row++){const pos=row*6+col;if(!gone[pos])keep.push(pos);}
     const offset=5-keep.length;
     for(let row=0;row<keep.length;row++){const from=keep[row],to=(row+offset)*6+col;after[to]=grid[from];if(trace)drops.push({from,to,symbol:grid[from]});}
     for(let row=0;row<offset;row++){const position=row*6+col,s=symbol(free,draw);after[position]=s;if(trace)refills.push({position,symbol:s});}
    }
   }
   if(trace)frames.push({index:step,before:[...grid],after:[...after],wins,energy,multiplierBefore:before,multiplierAfter:multiplier,removed,drops,refills,payoutUnits:String(framePaid),uncappedPayoutUnits:String(frameRaw),stop});
   maxFrames=Math.max(maxFrames,step+1);grid=after;if(stop!=='continue')break;
  }
  const ticketCount=grid.filter(s=>s===7).length,capped=total+paid===cap;let award=0;
  if(bonus){bonus.played++;bonus.remaining--;bonus.multiplier=multiplier;if(!capped&&ticketCount>=3){award=Math.min(3,30-bonus.awarded);bonus.awarded+=award;bonus.remaining+=award;if(award)retriggerSpins++;}if(capped)bonus.remaining=0;}
  else if(!capped&&ticketCount>=4){award=10;bonus={awarded:10,played:0,remaining:10,multiplier:1};}
  if(trace)history.push({index:spins,kind:free?'free':'base',initialGrid:initial,frames,finalGrid:grid,multiplierBefore,multiplierAfter:multiplier,tickets:ticketCount,freeAward:award,payoutUnits:String(paid),uncappedPayoutUnits:String(raw)});
  total+=paid;spins++;if(free)freeSpins++;else basePayout=paid;
  assert(spins<=31);assert(total>=0&&total<=cap);
 }while(bonus?.remaining);
 return {total,spins,freeSpins,bonus,basePayout,retriggerSpins,maxFrames,maxMultiplier,capped:total===cap,history};
}
const sources=['server/games/caramelCarnival.ts','src/shared/caramelCarnival.ts'];
const report={generatedAt:new Date().toISOString(),gameId:'studio-caramel-carnival',mathVersion:M.version,
 method:'Independent complete-round sampler with its own count scorer, integer award/cap, gravity and bonus transitions; fixed probability and paytable inputs imported from actual sources. Full receipts and random-consumption crosschecked against actual server. Approximate marginal 95% normal intervals of independent complete paid rounds; observed screening, not formal RTP qualification.',
 prng:'Mulberry32, uint32 state increment 0x6d2b79f5',seeds,roundsPerSeed:counts,stakes:CARAMEL_BETS,sourceHashes:Object.fromEntries(sources.map(file=>[file,createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')])),crosschecks:[],results:[]};
const output=fileURLToPath(new URL('native-round-results.json',outputFolder));
function stats(){return {n:0,mean:0,m2:0,totalGrossUnits:0,totalDebitUnits:0,basePayoutUnits:0,profitableRounds:0,zeroPayoutRounds:0,cappedRounds:0,bonusRounds:0,freeSpins:0,retriggerSpins:0,maxPayoutUnits:0,maxFrames:0,maxMultiplier:0,maxAwarded:0};}
function add(stat,sample,stake,cost){const normalized=sample.total/(stake*cost);stat.n++;const delta=normalized-stat.mean;stat.mean+=delta/stat.n;stat.m2+=delta*(normalized-stat.mean);
 stat.totalGrossUnits+=sample.total;stat.totalDebitUnits+=stake*cost;stat.basePayoutUnits+=sample.basePayout;stat.profitableRounds+=Number(sample.total>stake*cost);stat.zeroPayoutRounds+=Number(sample.total===0);stat.cappedRounds+=Number(sample.capped);stat.bonusRounds+=Number(sample.freeSpins>0);stat.freeSpins+=sample.freeSpins;stat.retriggerSpins+=sample.retriggerSpins;stat.maxPayoutUnits=Math.max(stat.maxPayoutUnits,sample.total);stat.maxFrames=Math.max(stat.maxFrames,sample.maxFrames);stat.maxMultiplier=Math.max(stat.maxMultiplier,sample.maxMultiplier);stat.maxAwarded=Math.max(stat.maxAwarded,sample.bonus?.awarded??0);}
function merge(a,b){const n=a.n+b.n,delta=b.mean-a.mean;a.m2+=b.m2+delta*delta*a.n*b.n/n;a.mean+=delta*b.n/n;
 for(const key of Object.keys(a))if(!['mean','m2','n'].includes(key))a[key]=key.startsWith('max')?Math.max(a[key],b[key]):a[key]+b[key];a.n=n;}
function summarize(s){const se=Math.sqrt(s.m2/(s.n-1)/s.n);return {...s,rtp:s.totalGrossUnits/s.totalDebitUnits,interval95:[s.mean-1.96*se,s.mean+1.96*se],meanGrossUnits:s.totalGrossUnits/s.n,meanNetUnits:(s.totalGrossUnits-s.totalDebitUnits)/s.n,profitProbability:s.profitableRounds/s.n};}
for(const mode of ['normal','festival']){
 let verified=0;const replayDigest=createHash('sha256');
 for(const stake of CARAMEL_BETS)for(const seed of [630109,790129]){
  const fast=rng(seed),slow=rng(seed);
  for(let i=0;i<replays;i++){
   const expected=round(mode,Number(stake),fast,true);let actual=startCaramel({caramel:{mode}},stake,slow);
   while(!actual.ended)actual=moveCaramel(actual.view,stake,actual.view.revision,slow);
   assert.equal(actual.credit,expected.total);assert.deepEqual(actual.view.history,expected.history);assert.deepEqual(actual.view.bonus,expected.bonus);
   assert.equal(actual.view.capped,expected.capped);assert.equal(fast(1000000000),slow(1000000000),'RNG consumption mismatch');
   replayDigest.update(JSON.stringify({stake,seed,index:i,history:actual.view.history,bonus:actual.view.bonus,total:actual.credit}));verified++;
  }
 }
 report.crosschecks.push({mode,fullServerRounds:verified,allAllowedStakes:CARAMEL_BETS,receiptAndEntropyExact:true,sha256:replayDigest.digest('hex')});
 console.log(JSON.stringify({mode,crosschecked:verified}));
 const all=stats(),streams=[],cost=mode==='festival'?35:1;
 for(const baseSeed of seeds){const seed=baseSeed+(mode==='festival'?7411:0),draw=rng(seed),stat=stats();
  for(let i=0;i<counts[mode];i++)add(stat,round(mode,100,draw),100,cost);
  merge(all,stat);streams.push({seed,...summarize(stat)});console.log(JSON.stringify({mode,seed,...summarize(stat)}));
 }
 report.results.push({mode,costMultiplier:cost,stakeUnits:100,...summarize(all),streams});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({output,results:report.results.map(({mode,n,rtp,interval95,meanNetUnits})=>({mode,n,rtp,interval95,meanNetUnits}))}));
