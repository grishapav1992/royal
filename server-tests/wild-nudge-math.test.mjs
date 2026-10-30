import test from 'node:test';
import assert from 'node:assert/strict';
import {WILD_NUDGE_DATA as R,WILD_NUDGE_STAKES,wildNudgeReel,scoreWildNudgeLine,scoreWildNudgeGrid,wildNudgeSpin,drawWildNudgeSpin,wildNudgeRound,settleWildNudgePoints,wildNudgePointBound} from '../src/shared/wildNudgeMath.ts';
import {referenceNudgeReel,referenceNudgeLine,referenceNudgeSpin} from '../scripts/game-math/wild-nudge-reference.mjs';
import {nudgeSeeded,replayWildNudgeModel} from '../scripts/game-math/wild-nudge-characterize.mjs';

test('every cyclic stop, both docking directions and every intermediate step match an independent strip implementation',()=>{
  for(const mode of ['base','bonus'])for(let column=0;column<5;column++)for(let stop=0;stop<64;stop++){
    const frame=wildNudgeReel(column,stop,mode);assert.deepEqual(frame,referenceNudgeReel(R.reels[column],stop,mode,R));
    assert.deepEqual(frame.before,frame.path[0].cells);assert.deepEqual(frame.after,frame.path.at(-1).cells);assert.equal(frame.path.length,frame.steps+1);
    assert(frame.steps<=2);if(frame.before.includes(6))assert.deepEqual(frame.after,[6,6,6]);
    for(let i=1;i<frame.path.length;i++)assert.equal((frame.path[i-1].stop+frame.direction+64)%64,frame.path[i].stop);
  }
  for(const [stop,direction,steps,multiplier]of [[0,0,0,1],[1,-1,1,2],[2,-1,2,3],[63,1,1,2],[62,1,2,3]]){
    const frame=wildNudgeReel(0,stop,'base');assert.deepEqual([frame.direction,frame.steps,frame.multiplier],[direction,steps,multiplier]);
  }
  assert.equal(wildNudgeReel(0,2,'bonus').multiplier,5);assert.equal(wildNudgeReel(0,63,'bonus').multiplier,3);
});
test('all 200000 effective line states agree with the independent leading-WILD oracle',()=>{
  let comparisons=0;
  for(const mode of ['base','bonus']){
    const increment=mode==='base'?1:2,states=[...Array.from({length:6},(_,symbol)=>[symbol,1]),[7,1],[6,1],[6,1+increment],[6,1+2*increment]],symbols=Array(5),multipliers=Array(5);
    const walk=column=>{if(column===5){assert.deepEqual(scoreWildNudgeLine(symbols,multipliers),referenceNudgeLine(symbols,multipliers,R));comparisons++;return;}for(const [symbol,multiplier]of states){symbols[column]=symbol;multipliers[column]=multiplier;walk(column+1);}};walk(0);
  }
  assert.equal(comparisons,200000);
});
test('only the best left prefix pays once and only its participating WILD increments add',()=>{
  assert.deepEqual(scoreWildNudgeLine([6,6,6,0,7],[3,3,3,1,1]),{symbol:5,count:3,multiplier:7,points:266});
  assert.deepEqual(scoreWildNudgeLine([6,6,5,5,5],[3,2,1,1,1]),{symbol:5,count:5,multiplier:4,points:1020});
  assert.deepEqual(scoreWildNudgeLine([5,5,5,7,6],[1,1,1,1,5]),{symbol:5,count:3,multiplier:1,points:38});
  assert.equal(scoreWildNudgeLine([7,5,5,5,5],[1,1,1,1,1]),null);
  assert.equal(scoreWildNudgeLine([5,7,5,5,5],[1,1,1,1,1]),null);
  assert.equal(scoreWildNudgeGrid(Array(15).fill(6),Array(5).fill(3)).reduce((n,w)=>n+w.points,0),56100);
});
test('three, four and five SCATTER reels award exactly eight spins; bonus SCATTER never retriggers',()=>{
  for(const count of [3,4,5]){
    const stops=Array.from({length:5},(_,i)=>i<count?16:30),base=wildNudgeSpin(stops,'base');assert.equal(base.awardedSpins,8);assert.equal(base.scatterReels.length,count);assert.equal(wildNudgeSpin(stops,'bonus').awardedSpins,0);
    assert.deepEqual(base,referenceNudgeSpin(stops,'base',R));
  }
  assert.equal(wildNudgeSpin([16,16,30,30,30],'base').awardedSpins,0);
});
test('the complete round preserves one paid cost and exact integer scaling on all six stakes',()=>{
  const baseStops=[2,45,2,16,14],bonusStops=Array.from({length:8},()=>[2,2,2,2,2]);
  for(const stakeUnits of WILD_NUDGE_STAKES){const round=wildNudgeRound({stakeUnits,baseStops,bonusStops});assert.equal(round.costUnits,stakeUnits);assert.equal(round.bonus.length,8);assert.equal(round.payoutUnits,String(BigInt(stakeUnits)*860790n/100n));}
  assert.throws(()=>wildNudgeRound({stakeUnits:'100',baseStops,bonusStops:bonusStops.slice(1)}),/complete round/);
  assert.throws(()=>wildNudgeRound({stakeUnits:'100',baseStops:[30,30,30,30,30],bonusStops}),/complete round/);
});
test('deterministic full-round replay covers both independent streams and every stake',()=>{
  const result=replayWildNudgeModel([2026103031,2026103047],64);assert.equal(result.checks,768);assert.equal(result.coverage.length,12);assert(result.bonusRounds>0);
});
test('the entropy boundary consumes exactly five bounded tickets and rejects malformed randomness',()=>{
  const maxima=[],spin=drawWildNudgeSpin('base',max=>{maxima.push(max);return 2;});assert.deepEqual(maxima,[64,64,64,64,64]);assert.equal(spin.points,56100);
  for(const value of [-1,64,.5,NaN,Infinity])assert.throws(()=>drawWildNudgeSpin('base',()=>value),/invalid stop/);
  assert.throws(()=>drawWildNudgeSpin('unknown',()=>{throw Error('RNG must not run');}),/Invalid mode/);
  const random=nudgeSeeded(911);for(let i=0;i<1000;i++){const n=random(7);assert(Number.isInteger(n)&&n>=0&&n<7);}
});
test('invalid stakes, stops, grids and amounts are rejected without mutating inputs or global parameters',()=>{
  for(const stake of ['0','1','99','100.0','-100','100000000000000000000'])assert.throws(()=>settleWildNudgePoints(1,stake),/Unsupported/);
  for(const points of [-1,.5,NaN,Infinity,wildNudgePointBound('bonus')+1])assert.throws(()=>settleWildNudgePoints(points,'100'),/Invalid spin points/);
  for(const stop of [-1,64,.5,NaN,Infinity])assert.throws(()=>wildNudgeReel(0,stop,'base'),/Invalid stop/);
  assert.throws(()=>wildNudgeReel(5,0,'base'),/Invalid reel/);assert.throws(()=>wildNudgeSpin([0,0,0,0],'base'),/Five stops/);
  assert.throws(()=>scoreWildNudgeGrid(Array(14).fill(0),[1,1,1,1,1]),/Invalid grid/);
  assert.throws(()=>scoreWildNudgeLine([0,0,0,0,0],[0,1,1,1,1]),/Invalid WILD/);
  assert.throws(()=>{R.paytable[0][0]=999;},TypeError);
  const stops=[62,63,0,1,2],before=stops.slice(),frame=wildNudgeSpin(stops,'base');frame.grid[0]=7;assert.deepEqual(stops,before);assert.notEqual(wildNudgeSpin(stops,'base').grid[0],7);
});
