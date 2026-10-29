import test from 'node:test';
import assert from 'node:assert/strict';
import {CASCADE_DATA,initialCascadeState,advanceCascade,scoreCascadeGrid,simulateCascadeRound} from '../src/shared/floodedTempleCascadeMath';
import {validCascadeView,validCascadeSettings,validCascadeStake,replayCascadeOperations,cascadeResult} from '../src/shared/floodedTempleCascade';
import {startTempleCascade,moveTempleCascade} from '../server/games/floodedTempleCascade';
// @ts-ignore independent qualification module intentionally has no runtime-engine import.
import {cascadeRandom,independentCascadeRound} from '../scripts/game-math/rtp-temple-cascade-model.mjs';

const blank=()=>Array.from({length:15},(_,i)=>i%7);
const stop=(column:number,symbol:number)=>CASCADE_DATA.baseReels[column].slice(0,symbol).reduce((a,b)=>a+b,0);
function boardDraw(board:number[]){const tape:number[]=[];for(let c=0;c<5;c++)for(let r=2;r>=0;r--)tape.push(stop(c,board[c*3+r]));return ()=>{const v=tape.shift();assert.notEqual(v,undefined);return v!;};}
test('cascade inputs freeze twenty distinct lines, seven ordinary symbols and legal special columns',()=>{
  assert.equal(new Set(CASCADE_DATA.paylines.map(l=>l.join(','))).size,20);
  assert(CASCADE_DATA.paylines.every(l=>l.length===5&&l.every(r=>r>=0&&r<3)));
  assert.equal(CASCADE_DATA.paytable.length,7);assert.equal(CASCADE_DATA.baseReels[0][7],0);assert.equal(CASCADE_DATA.baseReels[4][7],0);
  for(const reels of[CASCADE_DATA.baseReels,CASCADE_DATA.freeReels]){assert.equal(reels[3][8],0);assert.equal(reels[4][8],0);}
  for(const n of CASCADE_DATA.stakes){assert(validCascadeStake(String(n)));assert.equal(n%20,0);}
  assert(validCascadeSettings({temple:{mode:'cascades'}}));assert(!validCascadeSettings({temple:{mode:'cascades',buy:true}}));assert(!validCascadeStake('1001'));
});
test('twenty overlapping wins pay once per line and remove the union once; bonus lines have no cash award',()=>{
  const wins=scoreCascadeGrid(Array(15).fill(0));assert.equal(wins.wins.length,20);assert.equal(wins.points,20*CASCADE_DATA.paytable[0][2]);assert.equal(wins.removeMask,32767);
  const bonus=Array(15).fill(0);for(let c=0;c<3;c++)for(let r=0;r<3;r++)bonus[c*3+r]=c===1?7:8;
  const scored=scoreCascadeGrid(bonus);assert.equal(scored.points,0);assert.equal(scored.bonusCount,20);assert.equal(scored.removeMask,511);
});
test('gravity preserves column order, draws only vacancies, and empty base rounds finish',()=>{
  const state=initialCascadeState();state.grid=blank();state.next='collapse';state.removeMask=2;
  let draws=0;advanceCascade(state,()=>{draws++;return stop(0,3);});assert.equal(draws,1);assert.deepEqual(state.grid.slice(0,3),[3,0,2]);
  const empty=initialCascadeState(),frame=advanceCascade(empty,boardDraw(blank()))!;assert.equal(frame.awardedPoints,0);assert.equal(empty.next,'done');
});
test('bonus saves the base chain, retriggers add ten per line and each new free spin resets to three',()=>{
  const grid=blank();grid[1]=8;grid[4]=8;grid[7]=8;
  const state=initialCascadeState(),base=advanceCascade(state,boardDraw(grid))!;
  assert.equal(base.addedFreeSpins,10);assert.equal(state.next,'free-spin');assert.equal(state.parent!.cascade,1);
  const saved=structuredClone(state.parent),free=advanceCascade(state,boardDraw(blank()))!;
  assert.equal(free.multiplier,3);assert.equal(state.remainingFreeSpins,9);assert.equal(state.next,'free-spin');
  const retrigger=advanceCascade(state,boardDraw(grid))!;assert.equal(retrigger.multiplier,3);assert.equal(retrigger.addedFreeSpins,10);assert.equal(state.remainingFreeSpins,18);assert.deepEqual(state.parent,saved);assert.equal(state.next,'collapse');
  state.cascade=20;assert.equal(advanceCascade(state,()=>0)!.multiplier,15);assert.equal(state.cascade,21);
  const baseHeld=initialCascadeState();baseHeld.grid=blank();baseHeld.next='collapse';baseHeld.cascade=20;assert.equal(advanceCascade(baseHeld,()=>0)!.multiplier,5);
});
test('all stakes settle as integers at the same whole-round cap and changed state or unused stops is rejected',()=>{
  for(const stake of CASCADE_DATA.stakes){
    const result=startTempleCascade({temple:{mode:'cascades'}},String(stake),()=>0);
    assert(result.ended);assert.equal(result.credit,stake*500);assert.equal(result.view.revision,1);assert(validCascadeView(String(stake),result.view));
    const changed=structuredClone(result.view);changed.state.totalPoints--;assert(!validCascadeView(String(stake),changed));
    const extra=structuredClone(result.view.operations);extra[0][0].push(0);assert.throws(()=>replayCascadeOperations(String(stake),extra));
    assert.throws(()=>moveTempleCascade(result.view,String(stake),1,'temple-cascade',()=>0));
    assert.equal(cascadeResult(result.view).actions.length,0);
  }
});
test('independent row-major model agrees with every fall and complete server round across independent seeds',()=>{
  let long=0,bonus=0;
  for(const seed of[19770203,19840117]){
    const production=cascadeRandom(seed),model=cascadeRandom(seed);
    for(let round=0;round<5000;round++){
      const expected:any[]=[],score=independentCascadeRound(model,expected),s=initialCascadeState();let i=0;
      while(s.next!=='done'){
        const frame=advanceCascade(s,production)!;const {wins:_wins,bonusLines:_bonus,...actual}=frame;
        assert.deepEqual(actual,expected[i++]);
      }
      assert.equal(s.totalPoints,score.points);assert.equal(i,score.falls);bonus+=score.bonuses>0?1:0;long+=i>16?1:0;
    }
  }
  assert(bonus>0);assert(long>0,'A bonus must survive the transport batch boundary');
});
test('server continuations preserve accepted history, use bounded batches and reject stale moves before entropy',()=>{
  let result:any;for(let seed=1;seed<10000;seed++){const draw=cascadeRandom(seed);const started=startTempleCascade({temple:{mode:'cascades'}},'1000',draw);if(!started.ended){result={value:started,draw};break;}}
  assert(result);let current=result.value,checks=0;
  while(!current.ended){
    const before=structuredClone(current.view.operations);assert.throws(()=>moveTempleCascade(current.view,'1000',current.view.revision-1,'temple-cascade',()=>{throw Error('must not draw');}));
    const next=moveTempleCascade(current.view,'1000',current.view.revision,'temple-cascade',result.draw);assert.deepEqual(next.view.operations.slice(0,-1),before);assert.equal(next.view.revision,current.view.revision+1);assert(validCascadeView('1000',next.view));current=next;checks++;
  }
  assert(checks>0);assert(Number.isSafeInteger(current.credit));
});
