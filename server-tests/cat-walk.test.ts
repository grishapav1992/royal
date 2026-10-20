import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatWalkCycle } from '../src/game/CatWalkCycle';

test('a stride visits its eight phases in order as the cat covers ground',()=>{
  const cycle=new CatWalkCycle();
  assert.equal(cycle.update({x:0,y:0},true),0);
  for(let step=1;step<8;step++)assert.equal(cycle.update({x:step*6,y:0},true),step);
  assert.equal(cycle.update({x:48,y:0},true),0);
});

test('standing still never cycles paws even if the network moving flag remains set',()=>{
  const cycle=new CatWalkCycle();cycle.update({x:0,y:0},true);
  assert.equal(cycle.update({x:12,y:0},true),2);
  for(let i=0;i<120;i++)assert.equal(cycle.update({x:12,y:0},true),2);
  assert.equal(cycle.update({x:12,y:0},false),0);
});

test('frame rate and direction do not change the distance of a stride',()=>{
  for(const samples of [20,60,144]) {
    const cycle=new CatWalkCycle();cycle.update({x:0,y:0},true);
    let frame=0;
    for(let i=1;i<=samples;i++)frame=cycle.update({x:18*i/samples,y:24*i/samples},true);
    assert.equal(frame,5);
  }
});

test('hall changes, jumps and a new walk cannot carry a stale foot phase',()=>{
  const cycle=new CatWalkCycle();cycle.update({x:0,y:0},true);cycle.update({x:18,y:0},true);
  assert.equal(cycle.update({x:900,y:500},true,true),0);
  assert.equal(cycle.update({x:910,y:510},false),0);
  assert.equal(cycle.update({x:920,y:520},true),0);
  assert.equal(cycle.update({x:926,y:520},true),1);
});
