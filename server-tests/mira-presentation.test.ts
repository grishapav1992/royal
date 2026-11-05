import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MiraRoutine, MIRA_HOME, miraSeatAmount } from '../src/shared/miraRoutine';
import { BAR_APPROACH } from '../src/shared/world';
import { Bartender } from '../server/bartender';
import { LobbyState, Player } from '../server/state';

test('an uninterrupted shift reaches seated rest after the first job and completes the ordinary work cycle',()=>{
  const routine=new MiraRoutine(),seen=new Set<string>();let firstSit=Infinity;
  for(let tick=0;tick<1600;tick++){
    routine.tick(.05);seen.add(routine.state.action);
    if(routine.state.action==='sit')firstSit=Math.min(firstSit,(tick+1)*.05);
  }
  assert.ok(firstSit>7&&firstSit<=12,'First seated rest must be visible after the first job, within the designed 12-second window');
  for(const action of ['polish','walk','sit-down','sit','stand-up','wipe','stock'])assert.ok(seen.has(action),action);
});

test('seated rest rises before service, keeps its position and resumes the staff routine', () => {
  const r=new MiraRoutine();
  for(let n=0;n<2200&&r.state.action!=='sit';n++)r.tick(.05);
  assert.equal(r.state.action,'sit'); const x=r.state.x,y=r.state.y;
  r.tick(.05,true); assert.equal(r.state.action,'stand-up');assert.equal(miraSeatAmount(r.state.action,r.state.progress),1);
  let previous=1;
  for(let n=0;n<16;n++) {r.tick(.05,true);const seat=miraSeatAmount(r.state.action,r.state.progress);assert.ok(seat<=previous);previous=seat;assert.equal(r.state.x,x);assert.equal(r.state.y,y);}
  for(let n=0;n<80;n++)r.tick(.05,true);
  assert.equal(r.state.action,'serve');assert.equal(r.state.x,MIRA_HOME.x);
  const p=r.state.progress;r.tick(.05,true);assert.ok(r.state.progress>=p);
  for(let n=0;n<100;n++)r.tick(.05,true);assert.equal(r.state.progress,1);
  for(let n=0;n<300;n++)r.tick(.05);assert.notEqual(r.state.action,'serve');
});

test('partial sit reverses continuously when a visitor arrives',()=>{
  const r=new MiraRoutine();
  for(let n=0;n<2300&&r.state.action!=='sit-down';n++)r.tick(.05);
  assert.equal(r.state.action,'sit-down');for(let n=0;n<5;n++)r.tick(.05);
  const amount=miraSeatAmount(r.state.action,r.state.progress);r.tick(.05,false,false,'listen');
  assert.equal(r.state.action,'stand-up');assert.ok(Math.abs(miraSeatAmount(r.state.action,r.state.progress)-amount)<1e-9);
});

test('accepted service finishes its handover after walking even when the sip has ended',()=>{
  const r=new MiraRoutine();for(let n=0;n<2300&&r.state.action!=='sit';n++)r.tick(.05);
  for(let n=0;n<10;n++)r.tick(.05,true);
  let handedOver=false;
  for(let n=0;n<200;n++){r.tick(.05);if(r.state.action==='serve'&&r.state.progress===1)handedOver=true;}
  assert.ok(handedOver);assert.notEqual(r.state.action,'serve');
});

test('greeting survives the walk to the visitor and heartbeats do not replay it',()=>{
  const r=new MiraRoutine();
  for(let n=0;n<2300&&r.state.action!=='sit';n++)r.tick(.05);
  const seen=new Set<string>();
  for(let n=0;n<180;n++){r.tick(.05,false,false,'listen');seen.add(r.state.action);}
  for(const action of ['stand-up','walk','greet','listen'])assert.ok(seen.has(action),action);
  for(let n=0;n<120;n++){r.tick(.05,false,false,'listen');assert.equal(r.state.action,'listen');}
  r.tick(.05,false,false,'speak');assert.equal(r.state.action,'chat');
  r.tick(.05,false,false,'closed');assert.notEqual(r.state.action,'chat');
});

test('attention accepts only nearby visitors and expires or clears on departure',()=>{
  const state=new LobbyState(),bar=new Bartender(state),p=new Player();
  state.players.set('one',p);p.hall='arcade';p.connected=true;
  bar.attend('one',{phase:'speak'});bar.tick(.05);assert.equal(state.mira.action,'polish');
  Object.assign(p,BAR_APPROACH);bar.attend('one',{phase:'listen'});
  for(let n=0;n<40;n++)bar.tick(.05);assert.equal(state.mira.action,'listen');
  bar.attend('one',{phase:'not-an-action'});bar.tick(.05);assert.equal(state.mira.action,'listen');
  bar.attend('one',{phase:'speak'});bar.tick(.05);assert.equal(state.mira.action,'chat');
  bar.forget('one');bar.tick(.05);assert.notEqual(state.mira.action,'chat');
  bar.attend('one',{phase:'speak'},Date.now()-6000);bar.tick(.05);assert.notEqual(state.mira.action,'chat');
  bar.attend('one',{phase:'listen'});p.hall='tables';bar.tick(.05);assert.notEqual(state.mira.action,'listen');
});
