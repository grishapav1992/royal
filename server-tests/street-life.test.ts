import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreetLife } from '../src/game/StreetLife';
import { STREET_OBSTACLES } from '../src/shared/street';
import { walkable } from '../src/game/navigation';
import { findPath } from '../src/game/navigation';
import { STREET } from '../src/shared/street';
import { STREET_RESIDENTS, StreetConversations } from '../src/game/streetDetails';
import { parseAppearance } from '../src/shared/appearance';

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

test('each street resident has a valid outfit and a clear approach outside the perimeter lane',()=>{
  for(const person of STREET_RESIDENTS){
    assert(parseAppearance(person.appearance),person.id+' has a supported outfit');
    assert(walkable(person.x,person.y,STREET_OBSTACLES,16));
    const path=findPath(STREET.spawn,person.approach,STREET_OBSTACLES);
    assert(path.length,person.id+' can be reached without crossing the building or road');
    assert.deepEqual(path.at(-1),person.approach);
    assert(Math.hypot(person.approach.x-person.x,person.approach.y-person.y)<112);
  }
});

test('resident conversations require proximity and close on walking away or entering the casino',()=>{
  const dialogue=new StreetConversations(),person=STREET_RESIDENTS[0];
  assert(!dialogue.talk(person.id),'a hidden street cannot start a conversation');
  dialogue.update(STREET.spawn,true);assert(!dialogue.talk(person.id),'distant clicks must approach first');
  dialogue.update(person.approach,true);assert(dialogue.talk(person.id));
  assert.equal(dialogue.snapshot().line,0);dialogue.next();assert.equal(dialogue.snapshot().line,1);
  dialogue.next();dialogue.next();assert.equal(dialogue.snapshot().line,0,'short conversation wraps without new actions');
  dialogue.update({x:person.x+141,y:person.y},true);assert.equal(dialogue.snapshot().conversation,null);
  dialogue.update(person.approach,true);dialogue.talk(person.id);
  dialogue.update(person.approach,false);assert.equal(dialogue.snapshot().conversation,null);assert.equal(dialogue.snapshot().nearby,null);
});
