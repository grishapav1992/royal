import assert from 'node:assert/strict';
import {GAME_STAKE_CENTS} from '../../src/shared/gameStakes.ts';
import {penaltyPathQuote} from '../../src/shared/crLeo.ts';
import {forestHeartFlowerPayout} from '../../src/shared/forestHeartMath.ts';

// An impact audit, never RTP qualification. Exact path probabilities expose
// rounding loss before any new paid denomination is published.
const chances=[75,60,45],risks=['safe','sharp','extreme'];
const series=GAME_STAKE_CENTS.map(stake=>{
 let min=1,max=0,paths=0,worst=[];
 function visit(path,probabilityNumerator,probabilityDenominator){
  if(path.length){
   const expected=BigInt(stake)*99n*probabilityDenominator/(100n*probabilityNumerator);
   assert.equal(penaltyPathQuote(String(stake),path),String(expected));
   const rtp=Number(expected*probabilityNumerator)/Number(BigInt(stake)*probabilityDenominator);
   if(rtp<min){min=rtp;worst=path;}max=Math.max(max,rtp);paths++;
  }
  if(path.length<5)for(let i=0;i<risks.length;i++)visit([...path,risks[i]],probabilityNumerator*BigInt(chances[i]),probabilityDenominator*100n);
 }
 visit([],1n,1n);assert.equal(paths,363);
 return {stakeUnits:String(stake),successfulRiskPaths:paths,exactMinimumRtp:min,exactMaximumRtp:max,worstRiskPath:worst,withinExistingBudget:min>=.99-.0003&&max<=.99+1e-12};
});
const forest=GAME_STAKE_CENTS.map(stake=>{
 try{return{stakeUnits:String(stake),energyOnePayoutUnits:String(forestHeartFlowerPayout(stake,1)),accepted:true};}
 catch(error){return{stakeUnits:String(stake),accepted:false,reason:error.message};}
});
console.log(JSON.stringify({status:'not-qualified',series,forest,
 blockers:['Forest Heart rejects denominations that need sub-cent settlement. A deliberate new rule and independent qualification are required.',
 'The series games lose more RTP to integer rounding at low stakes than their existing approved tolerance. Their payout policy must be redesigned and independently qualified.',
 'Other affected games require complete paid-round, bonus, player-choice and wallet qualification for the new stake domain.'],
 research:{totalBet:'The player-facing stake is the complete normal-round price; line denomination is an internal calculation.',sources:['https://beta.netent.com/games/starburst','https://www.pokerstars.com/help/articles/slots-coins-bet-levels/229726/']}},null,2));
