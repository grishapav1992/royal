import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOREST_HEART_STAKES,forestHeartBoard,forestHeartFlow,forestHeartBase,
  forestHeartBonus,forestHeartHeld,forestHeartHeldState,forestHeartFlowerPayout,forestHeartRound,
} from '../src/shared/forestHeartMath';
// Independent connectivity implementation, used as an oracle on arbitrary small graphs.
// @ts-expect-error The independent verifier is intentionally standalone JavaScript.
import {referenceFlow,referenceBoard,referenceHeld,referenceNextState,countFlowers} from '../scripts/game-math/forest-heart-reference.mjs';

test('all 65,536 small networks agree with independent union-find, including cycles and mismatched ports',()=>{
  for(let code=0;code<65536;code++){
    const board=Array(25).fill(0);let remaining=code;
    for(const pos of [10,11,15,16]){board[pos]=remaining%16;remaining=Math.floor(remaining/16);}
    const actual=forestHeartFlow(board),expected=referenceFlow(board);
    assert.deepEqual([...actual.reachedCells].sort((a,b)=>a-b),expected.reachedCells);
    assert.equal(actual.receiverMask,expected.receiverMask);
  }
});
test('multiple paths and cycles pay each terminal once, and rotation cannot take back an already paid flower',()=>{
  const full=forestHeartFlow(Array(25).fill(15));
  assert.equal(full.receiverMask,7);assert.equal(full.reachedCells.length,25);
  for(let bits=0;bits<4096;bits++)for(let rotation=0;rotation<12;rotation++){
    const result=forestHeartBase(bits,true,rotation);
    assert.equal(result.newReceiverMask&result.firstReceiverMask,0);
    assert.equal(result.paidReceiverMask,result.firstReceiverMask|result.newReceiverMask);
    assert(result.flowers>=0&&result.flowers<=3);
  }
});
test('held roots survive every subsequent random field and are monotone within the bonus',()=>{
  for(let state=0;state<243;state++){
    const held=forestHeartHeld(state);assert.equal(forestHeartHeldState(held),state);
    for(const bits of [0,4095,1365,2730]){
      const result=forestHeartBonus(state,bits),after=forestHeartHeld(result.nextState);
      assert.equal(result.bits&held.mask,held.values);
      assert.equal(after.mask&held.mask,held.mask);
      assert.equal(after.values&held.mask,held.values);
    }
  }
});
test('whole paid rounds settle in integer units on every stake and attain the derived 946.5x maximum',()=>{
  const allFlowers=Array.from({length:4096},(_,i)=>i).find(bits=>forestHeartFlow(forestHeartBoard(bits)).receiverMask===7)!;
  for(const stakeUnits of FOREST_HEART_STAKES){
    const input={stakeUnits,bits:allFlowers,energy:100,ability:true,rotation:null,bonusAwarded:true,
      bonus:Array.from({length:4},()=>({bits:allFlowers,energy:100}))};
    const round=forestHeartRound(input);
    assert.equal(BigInt(round.payoutUnits)*2n,BigInt(stakeUnits)*1893n);
    assert.equal(round.bonus.length,4);
    assert.deepEqual(forestHeartRound(JSON.parse(JSON.stringify(input))),round);
    for(const energy of [1,2,5,20,100])
      assert.equal(forestHeartFlowerPayout(stakeUnits,energy)*1000n,BigInt(stakeUnits)*631n*BigInt(energy));
  }
});
test('complete varied paid series match the independent oracle for all stakes and all visible actions',()=>{
  const flows=Array.from({length:4096},(_,bits)=>referenceFlow(referenceBoard(bits)));
  for(const seed of [834527,674909]){
    let randomState=seed;
    const draw=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState;};
    for(let sample=0;sample<128;sample++){
      const bits=draw()%4096,energy=[1,2,5,20,100][draw()%5],bonusAwarded=sample%2===0;
      const bonus=bonusAwarded?Array.from({length:4},()=>({bits:draw()%4096,energy:[1,2,5,20,100][draw()%5]})):[];
      let bestRotation:number|null=null,bestCount=countFlowers(flows[bits].receiverMask);
      for(let turn=0;turn<12;turn++){
        const count=countFlowers(flows[bits].receiverMask|flows[bits^(1<<turn)].receiverMask);
        if(count>bestCount){bestCount=count;bestRotation=turn;}
      }
      for(const rotation of [null,bestRotation,...Array.from({length:12},(_,i)=>i)])for(const stakeUnits of FOREST_HEART_STAKES){
        const input={stakeUnits,bits,energy,ability:true,rotation,bonusAwarded,bonus};
        const actual=forestHeartRound(input);
        const rotated=rotation===null?bits:bits^(1<<rotation);
        const baseCount=countFlowers(flows[bits].receiverMask|flows[rotated].receiverMask);
        let expected=BigInt(stakeUnits)*631n*BigInt(energy*baseCount)/1000n,state=0;
        for(const [i,spin]of bonus.entries()){
          const held=referenceHeld(state),effective=(spin.bits&~held.mask)|held.values;
          const flow=flows[effective],amount=BigInt(stakeUnits)*631n*BigInt(spin.energy*countFlowers(flow.receiverMask))/1000n;
          state=referenceNextState(state,effective,flow.terminalRootMask);
          assert.equal(actual.bonus[i].payoutUnits,String(amount));assert.equal(actual.bonus[i].nextState,state);
          expected+=amount;
        }
        assert.equal(actual.payoutUnits,String(expected));
      }
    }
  }
});
test('invalid inputs, unavailable turns, invalid held roots and unbounded continuations are rejected',()=>{
  for(const bits of [-1,4096,NaN,1.2])assert.throws(()=>forestHeartBoard(bits));
  for(const board of [Array(24).fill(0),Array(25).fill(16),new Array(25)])assert.throws(()=>forestHeartFlow(board));
  for(const rotation of [-1,12,1.1,NaN])assert.throws(()=>forestHeartBase(0,true,rotation));
  assert.throws(()=>forestHeartBase(0,false,0));
  for(const state of [-1,243,NaN])assert.throws(()=>forestHeartHeld(state));
  assert.throws(()=>forestHeartHeldState({mask:0,values:1}));
  assert.throws(()=>forestHeartHeldState({mask:1,values:0}));
  for(const stake of [0,1,999,1001,Number.MAX_SAFE_INTEGER])assert.throws(()=>forestHeartFlowerPayout(stake,1));
  assert.throws(()=>forestHeartFlowerPayout(1000,3));
  const valid={stakeUnits:1000,bits:0,energy:1,ability:false,rotation:null,bonusAwarded:false,bonus:[]};
  assert.throws(()=>forestHeartRound({...valid,bonusAwarded:true}));
  assert.throws(()=>forestHeartRound({...valid,bonus:[{bits:0,energy:1}]}));
  assert.throws(()=>forestHeartRound({...valid,bonusAwarded:true,bonus:Array(5).fill({bits:0,energy:1})}));
});
