import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyPvpMoneyEvent} from '../../server/finance/pvp-money.ts';
import {pvpPayout,validVirtualPvpStake} from '../../src/shared/pvp.ts';

/** Every allowed stake and settlement choice, using the production money functions. */
export function qualifyVirtualPvp(gameId,policy){
 const accounts=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 const participants=accounts.map((accountId,i)=>({accountId,userId:'player'+i}));
 const results=[];let serverReplayChecks=0;
 for(const choice of policy.choices){
  const hash=createHash('sha256');let cases=0,potTotal=0n,feeTotal=0n,returnTotal=0n;
  for(let stake=policy.stakeRange.min;stake<=policy.stakeRange.max;stake+=policy.stakeRange.step){
   assert(validVirtualPvpStake(String(stake)));
   const matches=new Map(),balances=new Map();
   const apply=event=>{for(const line of applyPvpMoneyEvent(event,matches))balances.set(line.account,(balances.get(line.account)??0n)+BigInt(line.units));serverReplayChecks++;};
   const base={version:1,matchId:'33333333-3333-4333-8333-333333333333',gameId,stakeUnits:String(stake),createdAt:1};
   for(const owner of participants)apply({...base,action:'hold',participants:[owner],winnerId:null,reason:'hold'});
   const decisive=choice.includes('win')||choice.startsWith('disconnect'),winner=choice==='right-win'||choice==='disconnect-right'?1:0;
   apply({...base,action:decisive?'settle':'refund',participants,winnerId:decisive?accounts[winner]:null,reason:choice.startsWith('disconnect')?'disconnect':decisive?'win':choice});
   const credits=participants.map(p=>(balances.get('player:'+p.userId)??0n)+BigInt(stake)),fee=balances.get('house')??0n,pot=BigInt(stake)*2n;
   const payout=pvpPayout(String(stake));
   assert.equal(fee,decisive?BigInt(payout.feeUnits):0n);assert.equal(credits[0]+credits[1]+fee,pot);
   for(const value of [...credits,fee])assert.equal(value%10000n,0n,'All settlements fit the common wallet cents');
   for(const [account,value]of balances)if(account.startsWith('pvp:'))assert.equal(value,0n);
   hash.update(JSON.stringify([stake,credits.map(String),String(fee)])+'\n');cases++;potTotal+=pot;feeTotal+=fee;returnTotal+=credits[0]+credits[1];
  }
  results.push({choice,cases,potUnits:String(potTotal),feeUnits:String(feeTotal),returnedUnits:String(returnTotal),sha256:hash.digest('hex')});
 }
 return {method:'exhaustive-virtual-pvp-pot',results,serverReplayChecks,
  interpretation:'Exact aggregate pot return for all 4991 allowed stakes and all eight settlement outcomes: 95% after a decisive result, 100% on refund. Individual return depends on the players. No probabilistic RTP estimate or confidence interval is asserted.'};
}
