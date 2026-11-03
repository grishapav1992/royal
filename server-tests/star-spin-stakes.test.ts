import test from 'node:test';
import assert from 'node:assert/strict';
import {startStarSpin,moveStarSpin,validStarSpinView,validWildNudgeSession} from '../src/shared/wildNudgeStakes';
import {startWildNudgeRound,moveWildNudgeRound} from '../src/shared/wildNudge';
import {GAME_STAKE_UNITS} from '../src/shared/gameStakes';
import {expansionExactAward,makeRoundPrecision,validRoundPrecision} from '../src/shared/roundPrecision';
import {WILD_NUDGE_DATA} from '../src/shared/wildNudgeMath';
test('every common stake keeps the exact complete nine-spin award and an unbiased final cent',()=>{
 assert.equal(WILD_NUDGE_DATA.lines.length*WILD_NUDGE_DATA.payDenominator,100);
 for(const stake of GAME_STAKE_UNITS){let tickets=[2,45,2,16,14,...Array(40).fill(2)],r=startStarSpin({wildNudge:{mode:'normal'}},stake,()=>tickets.shift()!);assert.equal(r.view.remaining,8);
  while(!r.ended){assert.equal(r.creditUnits,'0');r=moveStarSpin(r.view,stake,r.view.revision,'wild-nudge-spin',()=>tickets.shift()!);assert(validStarSpinView(r.view));}
  assert.equal(tickets.length,0);assert.equal(r.view.spins.length,9);assert.equal(r.view.spins.reduce((n,s)=>n+s.points,0),860790);
  const exact=expansionExactAward({gameId:'studio-wild-nudge',stakeUnits:stake,returnedUnits:r.creditUnits,view:{wildNudge:r.view}});let sum=0n;
  for(let i=0n;i<exact.denominator;i++){const receipt=makeRoundPrecision(exact,r.creditUnits,()=>Number(i));assert(validRoundPrecision(receipt,exact,receipt.creditedUnits));sum+=BigInt(receipt.creditedUnits);}
  assert.equal(sum,exact.numerator);assert.equal(r.creditUnits,String(BigInt(stake)*860790n/100n));
 }
});
test('rules 1 accepted bonus transcripts keep the original settlement',()=>{
 let tape=[2,45,2,16,14,...Array(40).fill(2)],r=startWildNudgeRound({wildNudge:{mode:'normal'}},'100',()=>tape.shift()!);const saved=JSON.parse(JSON.stringify(r.view));r=moveWildNudgeRound(saved,'100',saved.revision,'wild-nudge-spin',()=>tape.shift()!);while(!r.ended)r=moveWildNudgeRound(r.view,'100',r.view.revision,'wild-nudge-spin',()=>tape.shift()!);assert.equal(r.view.version,1);assert.equal(r.creditUnits,'860790');
});
test('a fractional ten-cent award uses every final-ticket outcome without a rounding loss',()=>{
 let tape=[0,0,30,30,30];const r=startStarSpin({wildNudge:{mode:'normal'}},'10',()=>tape.shift()!);assert(r.ended);assert.equal(r.view.spins[0].points,331);assert.equal(r.creditUnits,'33');
 const exact=expansionExactAward({gameId:'studio-wild-nudge',stakeUnits:'10',returnedUnits:r.creditUnits,view:{wildNudge:r.view}});assert.deepEqual(exact,{numerator:331n,denominator:10n});
 const outcomes=Array.from({length:10},(_,i)=>makeRoundPrecision(exact,r.creditUnits,()=>i));assert.equal(outcomes.filter(p=>p.creditedUnits==='34').length,1);assert.equal(outcomes.filter(p=>p.creditedUnits==='33').length,9);assert.equal(outcomes.reduce((n,p)=>n+BigInt(p.creditedUnits),0n),331n);
});
test('tampered precise transcripts, wrong revisions and unsupported stakes are rejected',()=>{
 const r=startStarSpin({wildNudge:{mode:'normal'}},'10',()=>16);assert(validStarSpinView(r.view));assert(!validStarSpinView({...r.view,totalPayoutUnits:'99999999'}));assert.throws(()=>moveStarSpin(r.view,'10',2,'wild-nudge-spin',()=>0));assert.throws(()=>startStarSpin({wildNudge:{mode:'normal'}},'1',()=>0));assert(!validWildNudgeSession({}));
});
