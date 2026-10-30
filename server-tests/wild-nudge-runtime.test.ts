import test from 'node:test';
import assert from 'node:assert/strict';
import {startWildNudge,moveWildNudge} from '../server/games/wildNudge';
import {validWildNudgeView,validWildNudgeSession,wildNudgeExpansionView,validWildNudgeReply,WILD_NUDGE_GAME} from '../src/shared/wildNudge';
import {validExpansionAction} from '../src/shared/casinoExpansion';
import {qualifyWildNudgeWallet,NUDGE_WALLET_CASES} from '../scripts/game-math/wild-nudge-wallet';
const id='fd39aaf8-d8f7-4d44-a897-0bd0a4a3db8c';
test('versioned round is strictly validated, contains only consumed entropy and settles once after eight moves',()=>{
 const tickets=[16,16,16,30,30];let draws=0;const rng=(max:number)=>{assert.equal(max,64);draws++;return tickets.length?tickets.shift()!:2;};
 let round=startWildNudge({wildNudge:{mode:'normal'}},'100',rng);assert.equal(draws,5);assert.equal(round.view.remaining,8);assert.equal(round.creditUnits,'0');
 const session=()=>({id,gameId:WILD_NUDGE_GAME,rulesVersion:1,state:round.ended?'settled':'active',stakeUnits:'100',spentUnits:'100',returnedUnits:round.creditUnits,view:wildNudgeExpansionView(round.view)});
 assert(validWildNudgeSession(session()));assert(validWildNudgeReply(session(),{id,gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}},false));
 const saved=structuredClone(round.view);for(const field of ['revision','remaining','totalPayoutUnits','version']){const bad:any=structuredClone(saved);bad[field]=999;assert.equal(validWildNudgeView(bad),false);}
 const bad=structuredClone(saved);bad.spins[0].points++;assert.equal(validWildNudgeView(bad),false);
 for(let i=0;i<8;i++){assert.throws(()=>moveWildNudge(round.view,'100',round.view.revision+1,'wild-nudge-spin',rng));round=moveWildNudge(round.view,'100',round.view.revision,'wild-nudge-spin',rng);assert(validWildNudgeSession(session()));}
 assert(round.ended);assert.equal(draws,45);assert.equal(round.view.spins.length,9);assert.throws(()=>moveWildNudge(round.view,'100',9,'wild-nudge-spin',rng));assert.equal(draws,45);
});
test('shared action boundary rejects unrecognized settings, stake fields and free-move revisions',()=>{
 const start={id,gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}};assert(validExpansionAction(start));assert.equal(validExpansionAction({...start,settings:{wildNudge:{mode:'buy'}}}),false);assert.equal(validExpansionAction({...start,payoutUnits:'100'}),false);
 const move={id,gameId:WILD_NUDGE_GAME,action:'move',sessionId:id,move:'wild-nudge-spin',revision:1};assert(validExpansionAction(move));for(const revision of [0,9,.5,'1',NaN])assert.equal(validExpansionAction({...move,revision}),false);
});
test('real PostgreSQL wallet qualifies every stake, concurrent UUIDs, rollback, replay, ownership and reserve',{timeout:90000},async()=>{const evidence=await qualifyWildNudgeWallet();assert.deepEqual(evidence.cases,NUDGE_WALLET_CASES);assert.equal(evidence.stakeRows.length,6);});
