import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreetLife } from '../src/game/StreetLife';
import { STREET_OBSTACLES } from '../src/shared/street';
import { walkable } from '../src/game/navigation';

test('street pedestrians stay on the pavement and traffic stays in separate road lanes', () => {
  const life=new StreetLife(),visibility=new Map<string,Set<boolean>>();
  for(let tick=0;tick<10000;tick++){
    const state=life.advance(50);
    for(const person of state.pedestrians)assert(walkable(person.x,person.y,STREET_OBSTACLES,16),person.id+' has a safe walking route');
    for(const car of state.cars){
      assert(car.y-78>=1210,'car artwork stays below the kerb');
      const seen=visibility.get(car.id)??new Set<boolean>();seen.add(car.visible);visibility.set(car.id,seen);
    }
    const lane=state.cars.filter(car=>car.visible&&car.direction===1);
    if(lane.length===2)assert(Math.abs(lane[0].x-lane[1].x)>190,'same-lane cars never overlap');
    assert(state.sign.sheen>=0&&state.sign.sheen<=.24);
    assert(state.sign.sparkle>=0&&state.sign.sparkle<=.72);
  }
  for(const seen of visibility.values())assert.deepEqual(seen,new Set([true,false]),'cars periodically leave the scene');
});

test('hidden and reduced-motion street ambience freezes without queued travel or light effects', () => {
  const life=new StreetLife();
  const before=life.advance(50);
  for(const options of [{paused:true},{reducedMotion:true}]){
    const paused=life.advance(60000,options);
    assert.equal(paused.time,before.time);
    assert.deepEqual(paused.cars,before.cars);
    assert.deepEqual(paused.pedestrians.map(p=>[p.x,p.y]),before.pedestrians.map(p=>[p.x,p.y]));
    assert(paused.pedestrians.every(p=>!p.moving));
    assert.equal(paused.sign.sheen,0);assert.equal(paused.sign.sparkle,0);
  }
  assert.equal(life.advance(60000).time,before.time+50,'resume never catches up a wall-clock gap');
  const time=life.snapshot().time;
  for(const delta of [NaN,Infinity,-1])life.advance(delta);
  assert.equal(life.snapshot().time,time);
});
