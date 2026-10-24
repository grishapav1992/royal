import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Activities} from '../server/activities';
import {ACTIVITIES} from '../src/shared/activities';
import {hallObstacles} from '../src/shared/world';
import {walkable} from '../src/game/navigation';

function setup(){
  const visitor=()=>({hall:'arcade',...ACTIVITIES.piano.entry,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'down',moving:true});
  const people=new Map([['a',visitor()],['b',visitor()]]);
  const events:{type:string;value:any}[]=[];
  const service=new Activities(id=>people.get(id),id=>{people.get(id)!.moving=false;},(type,value)=>events.push({type,value}),()=>{});
  return {service,people,events};
}

test('joining, leaving and reopening the piano keep the player at the rendered instrument',()=>{
  const {service,people}=setup(),player=people.get('a')!;
  const bounds=ACTIVITIES.piano.bounds;
  for(let attempt=0;attempt<2;attempt++){
    service.handle('a',{type:'join',id:'piano'});
    assert.equal(service.pianist,'a');
    assert(player.x>=bounds.x&&player.x<=bounds.x+bounds.w,'pianist must sit in front of the visible keyboard');
    assert(player.y>bounds.y+bounds.h&&player.y<=bounds.y+bounds.h+25,'pianist must sit at the visible bench');
    assert.equal(player.seat,'piano');assert.equal(player.action,'sit');assert.equal(player.facing,'up');assert.equal(player.moving,false);
    assert.equal(player.playing,true);assert.equal(player.activity,'piano');
    service.handle('a',{type:'leave'});
    assert.deepEqual({x:player.x,y:player.y},ACTIVITIES.piano.entry);
    assert(walkable(player.x,player.y,hallObstacles('arcade'),16),'exit must be clear of furniture');
    assert.equal(player.seat,'');assert.equal(player.action,'idle');assert.equal(player.playing,false);assert.equal(player.activity,'');
    assert.equal(service.pianist,'');
  }
});

test('disconnect releases held notes and returns the pianist to the current piano approach',()=>{
  const {service,people,events}=setup(),player=people.get('a')!;
  service.handle('a',{type:'join',id:'piano'});
  service.handle('a',{type:'note',note:60,down:true});
  player.connected=false;service.disconnect('a');
  assert.deepEqual({x:player.x,y:player.y},ACTIVITIES.piano.entry);
  assert.equal(player.seat,'');assert.equal(player.activity,'');assert.equal(player.playing,false);
  assert.deepEqual(service.snapshot().notes,[]);assert.equal(service.pianist,'');
  assert(events.some(event=>event.type==='piano-note'&&event.value.note===60&&event.value.down===false));
  service.handle('b',{type:'join',id:'piano'});assert.equal(service.pianist,'b');
});

test('an occupied piano and a join from its old position leave the visitor in place',()=>{
  const {service,people}=setup(),visitor=people.get('b')!;
  service.handle('a',{type:'join',id:'piano'});
  const before={...visitor};service.handle('b',{type:'join',id:'piano'});
  assert.deepEqual(visitor,before);assert.equal(service.pianist,'a');
  service.leave('a');Object.assign(visitor,{x:120,y:340});
  const oldPosition={...visitor};service.handle('b',{type:'join',id:'piano'});
  assert.deepEqual(visitor,oldPosition);assert.equal(service.pianist,'');
});
