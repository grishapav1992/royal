import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { startBatchVariant, moveBatchVariant } from '../server/games/casinoBatchVariants';
import {
  BATCH_VARIANT_GAMES, BATCH_VARIANT_DEFAULTS, BATCH_VARIANT_MAX, BATCH_VARIANT_NAMES,
  POKER_TARGET_COUNTS, BLACKJACK_TARGET_COUNTS, validBatchVariantView, validBatchVariantSettlement,
  type BatchVariantGameId, type BatchVariantSettings, type PlinkoTarget, type PokerTarget, type BlackjackTarget, type StreakThreshold,
} from '../src/shared/casinoBatchVariants';
import { validVariantView } from '../src/shared/casinoVariants';

const stakes = [1000,5000,10000,50000];
const weights = [30n,25n,20n,15n,8n,2n];
const report: {game:string;mode:string;stakeUnits:number;rtp:number;probability:number;multiplier:number;maxReserve:number;outcomes:number;method:string}[] = [];
let starts = 0, moves = 0;
const begin = (...args:Parameters<typeof startBatchVariant>) => { starts++;return startBatchVariant(...args); };
const act = (...args:Parameters<typeof moveBatchVariant>) => { moves++;return moveBatchVariant(...args); };
const fixedMultiplier = (total:bigint,wins:bigint) => 9800n*total/wins;
const paid = (stake:number,fixed:bigint) => Number(BigInt(stake)*fixed/10000n);
function* combinations(size:number,count:number,start=0,prefix:number[]=[]):Generator<number[]> {
  if(!count){yield prefix;return;}
  for(let n=start;n<=size-count;n++)yield* combinations(size,count-1,n+1,[...prefix,n]);
}
function* product(size:number,count:number,prefix:number[]=[]):Generator<number[]> {
  if(!count){yield prefix;return;}
  for(let n=0;n<size;n++)yield* product(size,count-1,[...prefix,n]);
}
function poolDraw(ids:number[],size:number) {
  const pool = Array.from({length:size},(_,n)=>n), queue=[...ids];
  return (maximum:number) => {assert.equal(maximum,pool.length);const index=pool.indexOf(queue.shift()!);assert(index>=0);pool.splice(index,1);return index;};
}
function sequenceDraw(values:number[],maximum:number) {
  let index=0;return (max:number) => {assert.equal(max,maximum);assert(index<values.length);return values[index++];};
}
function reserve(game:BatchVariantGameId,stake:number,credit:number) {
  assert(Number.isSafeInteger(credit)&&credit>=0);
  assert(credit<=stake*BATCH_VARIANT_MAX[game],game+' exceeds its reserved wallet amount');
}
function record(game:BatchVariantGameId,mode:string,wins:bigint,total:bigint,method:string,winningSettings:BatchVariantSettings,winningDraw:()=>((max:number)=>number)) {
  const fixed=fixedMultiplier(total,wins);
  for(const stake of stakes) {
    const result=begin(game,winningSettings,String(stake),winningDraw());
    assert.equal(result.credit,paid(stake,fixed));reserve(game,stake,result.credit);
    assert(validBatchVariantView(result.variant,game,true));
    const rtp=Number(wins)*result.credit/Number(total)/stake;
    assert(rtp<=.98+1e-12,game+' exceeds calibrated return');
    report.push({game,mode,stakeUnits:stake,rtp,probability:Number(wins)/Number(total),multiplier:Number(fixed)/10000,maxReserve:BATCH_VARIANT_MAX[game],outcomes:Number(total),method});
  }
}

test('independent math: target Plinko enumerates all 4096 paths and three zones',()=>{
  const targets:PlinkoTarget[]=['center','corridor','edges'],counts={center:0n,corridor:0n,edges:0n},first=new Map<PlinkoTarget,number[]>(),credits={center:new Set<number>(),corridor:new Set<number>(),edges:new Set<number>()};
  for(const path of product(2,12)) {
    const bucket=path.filter(turn=>turn===1).length;
    for(const target of targets) {
      const won=target==='center'?bucket===6:target==='corridor'?bucket>=4&&bucket<=8:bucket<=2||bucket>=10;
      const result=begin('variant-target-plinko',{variant:{target}},'1000',sequenceDraw(path,2));
      assert.equal(result.variant.kind,'target-plinko');if(result.variant.kind!=='target-plinko')throw Error('Wrong Plinko view');
      assert.equal(result.variant.bucket,bucket);assert.equal(result.variant.won,won);assert(validVariantView(result.variant,'variant-target-plinko',true));
      if(won){counts[target]++;credits[target].add(result.credit);if(!first.has(target))first.set(target,path);}else assert.equal(result.credit,0);
    }
  }
  assert.deepEqual(counts,{center:924n,corridor:3498n,edges:158n});
  for(const target of targets){assert.deepEqual([...credits[target]],[paid(1000,fixedMultiplier(4096n,counts[target]))]);record('variant-target-plinko',target,counts[target],4096n,'Every binary path through 12 rows',{variant:{target}},()=>sequenceDraw(first.get(target)!,2));}
});

const pokerTargets:PokerTarget[]=['pair','flush','straight'];
const blackjackTargets:BlackjackTarget[]=['17-18','19-20','21'];
const pokerCounts={pair:0n,flush:0n,straight:0n},blackjackCounts={'17-18':0n,'19-20':0n,'21':0n};
const pokerFirst=new Map<PokerTarget,number[]>(),blackjackFirst=new Map<BlackjackTarget,number[]>();
const pokerCredits={pair:new Set<number>(),flush:new Set<number>(),straight:new Set<number>()},blackjackCredits={'17-18':new Set<number>(),'19-20':new Set<number>(),'21':new Set<number>()};

test('independent math: every 22100 three-card hand validates poker targets and Ace-aware 21 totals',()=>{
  let totalHands=0;
  for(const ids of combinations(52,3)) {
    totalHands++;
    const ranks=ids.map(id=>id%13+1).sort((a,b)=>a-b),suits=ids.map(id=>Math.floor(id/13));
    const hits={pair:ranks[0]===ranks[1]||ranks[1]===ranks[2],flush:suits[0]===suits[1]&&suits[1]===suits[2],straight:ranks[0]!==ranks[1]&&ranks[1]!==ranks[2]&&((ranks[1]===ranks[0]+1&&ranks[2]===ranks[1]+1)||(ranks[0]===1&&ranks[1]===12&&ranks[2]===13))};
    const hardTotal=ranks.reduce((sum,rank)=>sum+(rank===1?1:rank>=10?10:rank),0),total=hardTotal<=11&&ranks.includes(1)?hardTotal+10:hardTotal;
    for(const target of pokerTargets) {
      const result=begin('variant-triple-poker',{variant:{target}},'1000',poolDraw(ids,52));
      if(result.variant.kind!=='triple-poker')throw Error('Wrong poker view');
      assert.equal(result.variant.won,hits[target]);assert(validVariantView(result.variant,'variant-triple-poker',true));
      if(hits[target]){pokerCounts[target]++;pokerCredits[target].add(result.credit);if(!pokerFirst.has(target))pokerFirst.set(target,ids);}else assert.equal(result.credit,0);
    }
    for(const target of blackjackTargets) {
      const won=target==='21'?total===21:target==='17-18'?total===17||total===18:total===19||total===20;
      const result=begin('variant-blackjack-target',{variant:{target}},'1000',poolDraw(ids,52));
      if(result.variant.kind!=='blackjack-target')throw Error('Wrong 21 view');
      assert.equal(result.variant.total,total);assert.equal(result.variant.won,won);assert(validVariantView(result.variant,'variant-blackjack-target',true));
      if(won){blackjackCounts[target]++;blackjackCredits[target].add(result.credit);if(!blackjackFirst.has(target))blackjackFirst.set(target,ids);}else assert.equal(result.credit,0);
    }
  }
  assert.equal(totalHands,22100);
  for(const target of pokerTargets){assert.equal(BigInt(POKER_TARGET_COUNTS[target]),pokerCounts[target]);assert.deepEqual([...pokerCredits[target]],[paid(1000,fixedMultiplier(22100n,pokerCounts[target]))]);record('variant-triple-poker',target,pokerCounts[target],22100n,'Every unordered hand from a 52-card deck',{variant:{target}},()=>poolDraw(pokerFirst.get(target)!,52));}
  for(const target of blackjackTargets){assert.equal(BigInt(BLACKJACK_TARGET_COUNTS[target]),blackjackCounts[target]);assert.deepEqual([...blackjackCredits[target]],[paid(1000,fixedMultiplier(22100n,blackjackCounts[target]))]);record('variant-blackjack-target',target,blackjackCounts[target],22100n,'Every unordered hand; Ace promotion from 1 to 11 when possible',{variant:{target}},()=>poolDraw(blackjackFirst.get(target)!,52));}
});

test('independent math: weighted gem hands verify every one of the 20 collections',()=>{
  const collections=[...combinations(6,3)],winning=collections.map(()=>0n),first=collections.map(()=>undefined as number[]|undefined),credits=collections.map(()=>new Set<number>()),stops=[0,30,55,75,90,98];
  let total=0n,handCount=0;
  for(const hand of product(6,5)) {
    handCount++;const weight=hand.reduce((value,gem)=>value*weights[gem],1n);total+=weight;
    for(let index=0;index<collections.length;index++) {
      const gems=collections[index],won=gems.every(gem=>hand.includes(gem)),result=begin('variant-gem-collection',{variant:{gems}},'1000',sequenceDraw(hand.map(gem=>stops[gem]),100));
      if(result.variant.kind!=='gem-collection')throw Error('Wrong collection view');
      assert.equal(result.variant.won,won);assert.deepEqual(result.variant.matches,gems.map(gem=>hand.filter(symbol=>symbol===gem).length));
      assert(validVariantView(result.variant,'variant-gem-collection',true));
      if(won){winning[index]+=weight;credits[index].add(result.credit);first[index]??=hand;}else assert.equal(result.credit,0);
    }
  }
  assert.equal(handCount,7776);assert.equal(total,100n**5n);assert.equal(collections.length,20);
  for(let index=0;index<collections.length;index++){assert.deepEqual([...credits[index]],[paid(1000,fixedMultiplier(total,winning[index]))]);record('variant-gem-collection',collections[index].join(','),winning[index],total,'Every weighted five-symbol hand, all 20 three-gem choices',{variant:{gems:collections[index]}},()=>sequenceDraw(first[index]!.map(gem=>stops[gem]),100));}
});

test('independent math: all 1820 paired-mine layouts validate each stopping stage at every stake',()=>{
  const layouts=[...combinations(16,4)],survived=[0n,0n,0n,0n,0n];assert.equal(layouts.length,1820);
  for(const mines of layouts)for(let step=1;step<=5;step++)if(!mines.some(cell=>cell<step*2))survived[step-1]++;
  assert.deepEqual(survived,[1001n,495n,210n,70n,15n]);
  for(const stake of stakes)for(const mines of layouts) {
    const initial=begin('variant-double-mines',{variant:{}},String(stake),poolDraw(mines,16));
    if(initial.variant.kind!=='double-mines')throw Error('Wrong paired mines view');
    assert(initial.variant.cells.every(cell=>cell==='hidden'));assert(validVariantView(initial.variant,'variant-double-mines',false));
    let engine=initial.engine!;
    for(let step=1;step<=5;step++) {
      const pair=[step*2-2,step*2-1],lost=pair.some(cell=>mines.includes(cell)),result=act('variant-double-mines',engine,'reveal',pair,String(stake));
      if(result.variant.kind!=='double-mines')throw Error('Wrong paired mines view');
      const fixed=fixedMultiplier(1820n,survived[step-1]),expected=lost?0:paid(stake,fixed);
      assert.equal(result.variant.cashoutUnits,String(expected));assert.equal(result.credit,result.ended?expected:0);reserve('variant-double-mines',stake,result.credit);
      assert(validVariantView(result.variant,'variant-double-mines',result.ended));
      if(lost){assert(result.ended);break;}
      assert.equal(result.variant.steps,step);assert.equal(result.variant.multiplier,Number(fixed)/10000);
      if(step<5) {
        const cashout=act('variant-double-mines',result.engine,'cashout',undefined,String(stake));
        assert.equal(cashout.credit,expected);assert(cashout.ended);reserve('variant-double-mines',stake,cashout.credit);
        assert(validVariantView(cashout.variant,'variant-double-mines',true));
      }
      engine=result.engine!;
    }
  }
  for(let step=1;step<=5;step++)for(const stake of stakes){const fixed=fixedMultiplier(1820n,survived[step-1]),rtp=Number(survived[step-1])*paid(stake,fixed)/1820/stake;assert(rtp<=.98+1e-12);report.push({game:'variant-double-mines',mode:String(step)+' safe pairs',stakeUnits:stake,rtp,probability:Number(survived[step-1])/1820,multiplier:Number(fixed)/10000,maxReserve:BATCH_VARIANT_MAX['variant-double-mines'],outcomes:1820,method:'Every four-trap arrangement and each stopping stage'});}
});

test('independent math: all 243 threshold sequences apply the house edge once and validate all earlier stops',()=>{
  for(const choices of product(3,5))for(const stake of stakes) {
    const thresholds=choices.map(choice=>choice+2) as StreakThreshold[],initial=begin('variant-dice-streak',{variant:{}},String(stake),()=>5);
    assert(validVariantView(initial.variant,'variant-dice-streak',false));
    let engine=initial.engine!,successful=1n;
    for(let step=1;step<=5;step++) {
      const threshold=thresholds[step-1];successful*=BigInt(7-threshold);
      const total=6n**BigInt(step),fixed=fixedMultiplier(total,successful),result=act('variant-dice-streak',engine,'roll',[threshold],String(stake)),expected=paid(stake,fixed);
      if(result.variant.kind!=='dice-streak')throw Error('Wrong streak view');
      assert.equal(result.variant.multiplier,Number(fixed)/10000);assert.equal(result.variant.cashoutUnits,String(expected));assert.equal(result.credit,step===5?expected:0);reserve('variant-dice-streak',stake,expected);
      assert(validVariantView(result.variant,'variant-dice-streak',step===5));
      if(step<5){const cashout=act('variant-dice-streak',result.engine,'cashout',undefined,String(stake));assert.equal(cashout.credit,expected);assert(validVariantView(cashout.variant,'variant-dice-streak',true));}
      // Continuing with any permitted next threshold has the same ideal conditional value.
      for(const next of [2,3,4]) {
        const nextWins=successful*BigInt(7-next),nextTotal=total*6n,nextFixed=fixedMultiplier(nextTotal,nextWins),nextQuote=paid(stake,nextFixed),conditional=nextQuote*(7-next)/6;
        const ideal=Number(9800n*total)*stake/Number(successful)/10000;
        assert(conditional<=ideal+1e-8);
        assert(ideal-conditional<=stake*.0001+1,'rounding has a bounded effect on continuing');
      }
      engine=result.engine!;
    }
    const fixed=fixedMultiplier(6n**5n,successful),rtp=Number(successful)*paid(stake,fixed)/6**5/stake;
    assert(rtp<=.98+1e-12);report.push({game:'variant-dice-streak',mode:thresholds.join(','),stakeUnits:stake,rtp,probability:Number(successful)/6**5,multiplier:Number(fixed)/10000,maxReserve:BATCH_VARIANT_MAX['variant-dice-streak'],outcomes:6**5,method:'Every threshold path; exact independent die probabilities and all early stopping quotes'});
  }
});

test('independent math: every 7776 die sequence validates an adaptive threshold and stopping policy',()=>{
  const returns=stakes.map(()=>0),startsAt=starts,movesAt=moves;
  for(const dice of product(6,5))for(let stakeIndex=0;stakeIndex<stakes.length;stakeIndex++) {
    const stake=stakes[stakeIndex],initial=begin('variant-dice-streak',{variant:{}},String(stake),sequenceDraw(dice,6));
    let engine=initial.engine!,successful=1n;
    for(let step=1;step<=5;step++) {
      // The policy uses only preceding public outcomes, never an unseen die.
      const threshold=(step===1?3:2+(dice[step-2]+step)%3) as StreakThreshold,won=dice[step-1]+1>=threshold;
      const result=act('variant-dice-streak',engine,'roll',[threshold],String(stake));
      if(result.variant.kind!=='dice-streak')throw Error('Wrong streak view');
      assert.equal(result.variant.history.at(-1)!.won,won);assert(validVariantView(result.variant,'variant-dice-streak',result.ended));
      if(!won){assert(result.ended);assert.equal(result.credit,0);break;}
      successful*=BigInt(7-threshold);const expected=paid(stake,fixedMultiplier(6n**BigInt(step),successful));
      assert.equal(result.variant.cashoutUnits,String(expected));reserve('variant-dice-streak',stake,expected);
      if(result.ended){assert.equal(result.credit,expected);returns[stakeIndex]+=expected;break;}
      if(dice[step-1]===5){const cashout=act('variant-dice-streak',result.engine,'cashout',undefined,String(stake));assert.equal(cashout.credit,expected);returns[stakeIndex]+=cashout.credit;break;}
      engine=result.engine!;
    }
  }
  assert.equal(starts-startsAt,7776*stakes.length);assert(moves>movesAt);
  for(let index=0;index<stakes.length;index++){const rtp=returns[index]/7776/stakes[index];assert(rtp<=.98+1e-12&&rtp>.979);report.push({game:'variant-dice-streak',mode:'adaptive threshold and stop after public six',stakeUnits:stakes[index],rtp,probability:0,multiplier:31.36,maxReserve:BATCH_VARIANT_MAX['variant-dice-streak'],outcomes:7776,method:'All five-die sequences; threshold depends on prior face, stop on a public six or step five'});}
});

test('public validation rejects impossible outcomes, unknown fields and future private state',()=>{
  for(const game of BATCH_VARIANT_GAMES) {
    const result=begin(game,BATCH_VARIANT_DEFAULTS[game],'1000',()=>0);
    assert(validBatchVariantView(result.variant,game,result.ended),game+' valid baseline');
    assert(!validBatchVariantView({...result.variant,multiplier:NaN},game,result.ended),game+' rejects non-finite multiplier');
    assert(!validBatchVariantView({...result.variant,multiplier:1},game,result.ended),game+' rejects changed multiplier');
    assert(!validBatchVariantView({...result.variant,engine:result.engine},game,result.ended),game+' rejects leaked engine');
    assert(!validBatchVariantView({...result.variant,dice:[6,6,6,6,6],mines:[0,1,2,3]},game,result.ended),game+' rejects private future data');
    if('won' in result.variant)assert(!validBatchVariantView({...result.variant,won:!result.variant.won},game,result.ended),game+' rejects changed outcome');
    if('cards' in result.variant)assert(!validBatchVariantView({...result.variant,cards:['A♠','A♠','2♠']},game,true),game+' rejects duplicate cards');
    if('cashoutUnits' in result.variant) {
      assert.equal(result.variant.cashoutUnits,'0');
      assert(!validBatchVariantView({...result.variant,cashoutUnits:'1'},game,false),game+' rejects payout before any success');
      assert(!validBatchVariantView({...result.variant,cashoutUnits:'-1'},game,false),game+' rejects negative payout');
    }
  }
  const mine=begin('variant-double-mines',{variant:{}},'1000',poolDraw([12,13,14,15],16));
  assert.throws(()=>act('variant-double-mines',mine.engine,'cashout',undefined,'1000'));
  assert.throws(()=>act('variant-double-mines',mine.engine,'reveal',[0,0],'1000'));
  assert.throws(()=>act('variant-double-mines',{kind:'double-mines',mines:[0,0,1,2],picks:[]},'reveal',[4,5],'1000'));
  const streak=begin('variant-dice-streak',{variant:{}},'1000',()=>5);
  assert.throws(()=>act('variant-dice-streak',streak.engine,'cashout',undefined,'1000'));
  assert.throws(()=>act('variant-dice-streak',streak.engine,'roll',[5],'1000'));
  assert.throws(()=>act('variant-dice-streak',{kind:'dice-streak',dice:[6,6,6,6,6],history:[{die:1,threshold:2,won:true}]},'roll',[2],'1000'));
});

test('all six RNG adapters reject invalid values without settling a fabricated result',()=>{
  for(const game of BATCH_VARIANT_GAMES)for(const value of [-1,.5,NaN,Infinity,1000])assert.throws(()=>begin(game,BATCH_VARIANT_DEFAULTS[game],'1000',()=>value),game+' rejects invalid randomness');
});

test('whole-session validation rejects changed money amounts and preserves exact staged cashouts',()=>{
  const examples: {game:BatchVariantGameId;settings:BatchVariantSettings;draw:()=>((max:number)=>number)}[] = [
    {game:'variant-target-plinko',settings:{variant:{target:'center'}},draw:()=>sequenceDraw([1,1,1,1,1,1,0,0,0,0,0,0],2)},
    {game:'variant-triple-poker',settings:{variant:{target:'pair'}},draw:()=>poolDraw([0,13,1],52)},
    {game:'variant-blackjack-target',settings:{variant:{target:'21'}},draw:()=>poolDraw([0,9,22],52)},
    {game:'variant-gem-collection',settings:{variant:{gems:[0,1,2]}},draw:()=>sequenceDraw([0,30,55,0,30],100)},
    {game:'variant-double-mines',settings:{variant:{}},draw:()=>poolDraw([12,13,14,15],16)},
    {game:'variant-dice-streak',settings:{variant:{}},draw:()=>()=>5},
  ];
  for(const {game,settings,draw} of examples)for(const stake of stakes) {
    const initial=begin(game,settings,String(stake),draw());
    const check=(result:ReturnType<typeof startBatchVariant>)=>{
      const state=result.ended?'settled':'active',returned=String(result.credit),amount=String(stake);
      assert(validBatchVariantSettlement(game,state,amount,amount,returned,result.variant),game+' exact settlement');
      assert(!validBatchVariantSettlement(game,state,amount,amount,String(result.credit+1),result.variant),game+' rejects changed returned money');
      assert(!validBatchVariantSettlement(game,state,amount,String(stake-1),returned,result.variant),game+' rejects changed spent money');
      assert(!validBatchVariantSettlement(game,state,String(stake+1),String(stake+1),returned,result.variant),game+' rejects unlisted stakes');
      if('cashoutUnits' in result.variant){const changed={...result.variant,cashoutUnits:String(BigInt(result.variant.cashoutUnits)+1n)};assert(!validBatchVariantSettlement(game,state,amount,amount,returned,changed),game+' rejects changed cashout quote');}
    };
    check(initial);
    if(!initial.ended) {
      const first=act(game,initial.engine,game==='variant-double-mines'?'reveal':'roll',game==='variant-double-mines'?[0,1]:[4],String(stake));check(first);
      assert(!first.ended);
      const fixed=game==='variant-double-mines'?fixedMultiplier(1820n,1001n):19600n;
      if(!('cashoutUnits' in first.variant))throw Error('Missing staged quote');
      assert.equal(first.variant.cashoutUnits,String(paid(stake,fixed)));
      check(act(game,first.engine,'cashout',undefined,String(stake)));
    }
  }
});

test('each advertised reserve covers the independent maximum across every mode',()=>{
  for(const game of BATCH_VARIANT_GAMES){const records=report.filter(row=>row.game===game);assert(records.length>0);const maximum=Math.max(...records.map(row=>row.multiplier));assert.equal(BATCH_VARIANT_MAX[game],Math.ceil(maximum),game+' reserves only the required integer maximum');}
});

after(()=>{
  const output=process.env.ROYAL_BATCH_MATH_REPORT;if(!output)return;
  mkdirSync(dirname(output),{recursive:true});
  const paths=['src/shared/casinoBatchVariants.ts','server/games/casinoBatchVariants.ts','src/shared/casinoVariants.ts','server/games/casinoVariants.ts','src/wallet/ExpansionClient.ts'];
  const sources=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
  writeFileSync(output,JSON.stringify({createdAt:new Date().toISOString(),sources,stakes,starts,moves,cardCounts:{poker:Object.fromEntries(Object.entries(pokerCounts).map(([key,value])=>[key,String(value)])),blackjack:Object.fromEntries(Object.entries(blackjackCounts).map(([key,value])=>[key,String(value)]))},names:BATCH_VARIANT_NAMES,records:report},null,2)+'\n');
});
