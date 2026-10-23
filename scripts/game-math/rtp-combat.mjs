import assert from 'node:assert/strict';
import {applyPvpMoneyEvent} from '../../server/finance/pvp-money.ts';
import {COMBAT_USDT_STAKES} from '../../src/shared/combatEscrow.ts';

/** Exhaustive journal replay, not a probabilistic estimate of player skill. */
export function qualifyCombat(policy) {
 assert.deepEqual(policy.stakes,COMBAT_USDT_STAKES.map(n=>n*1000000));
 const accounts=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 const participants=accounts.map((accountId,i)=>({accountId,userId:'fighter'+i}));
 const results=[];
 for(const stakeUnits of policy.stakes)for(const choice of policy.choices){
  const matches=new Map(),balances=new Map();
  const apply=event=>{for(const line of applyPvpMoneyEvent(event,matches))balances.set(line.account,(balances.get(line.account)??0n)+BigInt(line.units));};
  const base={version:1,matchId:'33333333-3333-4333-8333-333333333333',gameId:'mortal-kombat',stakeUnits:String(stakeUnits),createdAt:1};
  for(const owner of participants)apply({...base,action:'hold',participants:[owner],winnerId:null,reason:'hold'});
  const index=choice==='right-win'||choice==='disconnect-right'?1:0;
  const decisive=choice.includes('win')||choice.startsWith('disconnect');
  apply({...base,action:decisive?'settle':'refund',participants,winnerId:decisive?accounts[index]:null,
   reason:choice.startsWith('disconnect')?'disconnect':decisive?'win':choice});
  const stake=BigInt(stakeUnits),pot=stake*2n;
  const credits=participants.map(p=>(balances.get('player:'+p.userId)??0n)+stake);
  const fee=balances.get('house')??0n;
  assert.equal(credits[0]+credits[1]+fee,pot);
  for(const [account,value]of balances)if(account.startsWith('pvp:'))assert.equal(value,0n);
  results.push({choice,stakeUnits,potUnits:String(pot),playerUnits:credits.map(String),feeUnits:String(fee),
   returnedUnits:String(credits[0]+credits[1]),returnRatio:decisive?0.95:1});
 }
 return {method:'exhaustive-pvp-journal',results,serverReplayChecks:results.length*3,
  interpretation:'Exact aggregate pot return: 95% for decisive fights, 100% for refunds. Individual return depends on skill and outcome; no RNG, seed or statistical confidence interval applies.'};
}
