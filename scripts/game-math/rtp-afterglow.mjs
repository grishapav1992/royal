import assert from 'node:assert/strict';
import {afterInitial,afterNext,AFTER_BETS,AFTER_MAX_WIN} from '../../src/shared/afterglow.ts';
import {afterRandomSymbol,startAfter,moveAfter} from '../../server/games/afterglow.ts';
import {seededRandom} from '../../src/shared/draconaMath.ts';

const drawFor=seed=>{const random=seededRandom(seed);return max=>Math.floor(random()*max);};
function complete(stake,album,draw){
 let view=afterNext(afterInitial(album),stake,()=>afterRandomSymbol(draw));
 while(view.bonus?.remaining&&!view.capped)view=afterNext(view,stake,()=>afterRandomSymbol(draw));
 return view;
}

/** All accepted stakes are integer multiples of 100, so line-level settlement scales exactly. */
export function preflightAfterglow(policy){
 assert.deepEqual(policy.stakes,AFTER_BETS.map(Number));assert.deepEqual(policy.choices,['normal']);
 let checks=0;
 for(const stake of policy.stakes)for(const album of [0,45]){
  const actual=drawFor(664921),model=drawFor(664921),scaled=drawFor(664921);
  for(let round=0;round<64;round++){
   let result=startAfter({afterglow:{mode:'normal'}},String(stake),album,actual);
   while(!result.ended)result=moveAfter(result.view,String(stake),result.view.revision,actual);
   const view=complete(String(stake),album,model),base=complete('100',album,scaled);
   assert.deepEqual(result.view,view);
   assert.equal(BigInt(result.credit),BigInt(view.totalPayoutUnits));
   assert.equal(BigInt(view.totalPayoutUnits),BigInt(base.totalPayoutUnits)*BigInt(stake/100));
   assert.equal(view.history.length,base.history.length);
   assert(BigInt(view.totalPayoutUnits)<=BigInt(stake)*BigInt(AFTER_MAX_WIN));checks++;
  }
 }
 return checks;
}

/** Independent complete paid rounds, including every free continuation and integer line payout. */
export function simulateAfterglow(policy,progress=()=>{}){
 let paidRounds=0,reward=0,rewardSquared=0,freeSpins=0,bonuses=0,capped=0;
 const streams=[];
 for(const seed of policy.seeds){
  const draw=drawFor(seed);
  for(let round=0;round<policy.qualificationRoundsPerSeed;round++){
   const view=complete('100',0,draw),value=Number(BigInt(view.totalPayoutUnits))/100;
   paidRounds++;reward+=value;rewardSquared+=value*value;
   freeSpins+=view.history.length-1;bonuses+=Number(view.history.length>1);capped+=Number(view.capped);
   if((round+1)%1000000===0)progress({game:'studio-afterglow',seed,paidRounds,rtp:reward/paidRounds});
  }
  streams.push({choice:'normal',seed,paidRounds:policy.qualificationRoundsPerSeed});
 }
 const rtp=reward/paidRounds,half=1.96*Math.sqrt(paidRounds*Math.max(0,rewardSquared-2*rtp*reward+rtp*rtp*paidRounds)/(paidRounds-1))/paidRounds;
 return{method:'independent complete paid rounds; exact integer scaling for every allowed stake',streams,
  results:policy.stakes.map(stakeUnits=>({choice:'normal',stakeUnits,cycles:0,samples:paidRounds,paidRounds,cost:paidRounds,reward,rewardSquared,
   rewardCost:reward,costSquared:paidRounds,rtp,interval95:[rtp-half,rtp+half],freeSpins,bonuses,capped}))};
}
