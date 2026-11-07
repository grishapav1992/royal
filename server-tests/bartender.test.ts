import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MiraRoutine, MIRA_HOME, MIRA_SEAT} from '../src/shared/miraRoutine';
import {barPoint} from '../src/shared/furniture';
import {Bartender} from '../server/bartender';
import {LobbyState, Player} from '../server/state';

test('Mira visits her work stations and returns to work after serving',()=>{
  const routine=new MiraRoutine(),seen=new Set<string>();
  for(let i=0;i<3600;i++){
    routine.tick(.05);seen.add(routine.state.action);
    if(routine.state.action==='sit')assert.deepEqual({x:routine.state.x,y:routine.state.y},MIRA_SEAT);
    if(['polish','wipe','stock'].includes(routine.state.action))assert.ok(routine.state.y>=barPoint(195,106).y&&routine.state.y<=MIRA_HOME.y);
  }
  for(const action of ['walk','polish','wipe','stock','sit','stand-up'])assert.ok(seen.has(action),action);
  for(let i=0;i<180;i++)routine.tick(.05,true,true);
  assert.equal(routine.state.action,'serve');assert.equal(routine.state.x,MIRA_HOME.x);
  routine.tick(.05,false,true);assert.equal(routine.state.action,'chat');
  for(let i=0;i<120;i++)routine.tick(.05);assert.notEqual(routine.state.action,'chat');
});

test('bartender state is isolated per room and ignores drinks in the other hall',()=>{
  const a=new LobbyState(),b=new LobbyState(),one=new Bartender(a),two=new Bartender(b);
  const player=new Player();player.action='drink';player.hall='tables';a.players.set('a',player);
  one.tick(.05);assert.equal(a.mira.action,'polish');
  player.hall='arcade';one.tick(.05);assert.equal(a.mira.action,'serve');
  two.tick(.05);assert.equal(b.mira.action,'polish');assert.notEqual(a.mira,b.mira);
});
