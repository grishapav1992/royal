import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startTemple,moveTemple,TempleMoveError} from '../server/games/floodedTemple';
import {validTempleView,validTempleSettings,validTempleStake,TEMPLE_GAME} from '../src/shared/floodedTemple';
import {templeWeightedIndex,templeAllBaseCases,templeAllBonusCases,templeBaseMap,templeBonusMap,validateTempleMap} from '../src/shared/floodedTempleMath';
import {validExpansionAction} from '../src/shared/casinoExpansion';
const settings={temple:{mode:'normal'}};
function bonus(){const draws=[0,0,0,98,0,0];return startTemple(settings,'1000',max=>{const n=draws.shift()!;assert(n>=0&&n<max);return n;});}

test('every finite map has reciprocal adjacent doors and valid distinct contents',()=>{
  for(const c of templeAllBaseCases())validateTempleMap(templeBaseMap(c));
  for(const c of templeAllBonusCases())validateTempleMap(templeBonusMap(c));
});
test('weighted draws use exact half-open intervals and reject broken entropy',()=>{
  assert.equal(templeWeightedIndex([3,2,1],()=>0),0);assert.equal(templeWeightedIndex([3,2,1],()=>2),0);
  assert.equal(templeWeightedIndex([3,2,1],()=>3),1);assert.equal(templeWeightedIndex([3,2,1],()=>4),1);assert.equal(templeWeightedIndex([3,2,1],()=>5),2);
  for(const n of [-1,6,1.5,NaN,Infinity])assert.throws(()=>templeWeightedIndex([3,2,1],()=>n));
  for(const weights of [[0,1],[-1,2],[Number.MAX_SAFE_INTEGER,1]])assert.throws(()=>templeWeightedIndex(weights,()=>0));
});
test('settings and stakes reject extra costs, fractional units and alternate modes',()=>{
  assert(validTempleSettings(settings));for(const v of [{},{temple:{mode:'buy'}},{temple:{mode:'normal',cost:0}},{...settings,bonus:true}])assert(!validTempleSettings(v));
  for(const s of ['0','01000','1001','99999999999',1000])assert(!validTempleStake(s));
  assert.throws(()=>startTemple(settings,'1001'),TempleMoveError);
});
test('a blank paid board settles immediately and a rare relic starts exactly one bonus',()=>{
  const empty=startTemple(settings,'1000',()=>0);assert.equal(empty.ended,true);assert.equal(empty.credit,0);assert.equal(empty.view.bonusMap,null);assert(validTempleView('1000',empty.view));
  const b=bonus();assert.equal(b.ended,false);assert.equal(b.view.bonusState!.left,6);assert.equal(b.view.bonusState!.ropeAvailable,true);assert.equal(b.credit,0);
});
test('the sixth step collects the last chest; a used bridge remains open without another charge',()=>{
  let result=bonus();
  for(const [to,rope]of [[6,false],[11,false],[12,true],[13,false],[8,false],[9,false]] as const)result=moveTemple(result.view,'1000',result.view.revision,rope?'temple-rope':'temple-step',[to]);
  assert.equal(result.ended,true);assert.equal(result.credit,1750);assert.equal(result.view.bonusState!.left,0);assert.equal(result.view.bonusState!.ropeAvailable,false);
  assert.throws(()=>moveTemple(result.view,'1000',result.view.revision,'temple-finish'),TempleMoveError);
  let crossing=bonus();for(const [to,rope]of [[6,false],[11,false],[12,true],[11,false],[12,false],[13,false]]as const)crossing=moveTemple(crossing.view,'1000',crossing.view.revision,rope?'temple-rope':'temple-step',[to]);
  assert.equal(crossing.credit,750);
});
test('walls, diagonal moves, stale revision and implicit rope use cannot mutate the snapshot',()=>{
  let result=bonus();const first=JSON.stringify(result.view);
  for(const [move,picks,revision]of [['temple-step',[11],1],['temple-rope',[6],1],['temple-step',[6],0],['temple-finish',[],1]]as const)assert.throws(()=>moveTemple(result.view,'1000',revision,move,picks?Array.from(picks):undefined),TempleMoveError);
  assert.equal(JSON.stringify(result.view),first);
  for(const to of[6,11])result=moveTemple(result.view,'1000',result.view.revision,'temple-step',[to]);
  assert.throws(()=>moveTemple(result.view,'1000',result.view.revision,'temple-step',[12]),TempleMoveError);
});
test('the saved history is replayed instead of trusting amended payout, map, steps or stake',()=>{
  const view=bonus().view;
  for(const mutate of [(v:any)=>v.totalPayoutUnits='1000',(v:any)=>v.baseResult.payoutUnits='1000',(v:any)=>v.bonusState.left=99,(v:any)=>v.bonusState.ropeAvailable=false,(v:any)=>v.bonusMap.treasures[9]=99999,(v:any)=>v.history.push({kind:'rope',to:19})]){
    const altered=structuredClone(view);mutate(altered);assert(!validTempleView('1000',altered));assert.throws(()=>moveTemple(altered,'1000',1,'temple-finish'),TempleMoveError);
  }
  assert(!validTempleView('2000',view));
  const restored=JSON.parse(JSON.stringify(view));assert.deepEqual(moveTemple(restored,'1000',1,'temple-step',[6]),moveTemple(view,'1000',1,'temple-step',[6]));
});
test('room picking has a strict operation shape and cannot be sent as a different game move',()=>{
  const action={id:randomUUID(),gameId:TEMPLE_GAME,action:'move',sessionId:randomUUID(),move:'temple-step',picks:[6],revision:1};
  assert(validExpansionAction(action));assert(validExpansionAction({...action,move:'temple-rope'}));
  for(const bad of [{...action,picks:[6,7]},{...action,picks:[1.5]},{...action,picks:[20]},{...action,revision:0},{...action,revision:7},{...action,amount:0},{...action,gameId:'github-diamonds'},{...action,move:'temple-finish'}])assert(!validExpansionAction(bad));
  const {picks:_,...finish}=action;assert(validExpansionAction({...finish,move:'temple-finish'}));
});
