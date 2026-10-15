import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TableGame} from '../server/tableGames';
import {Activities} from '../server/activities';
import {ACTIVITIES} from '../src/shared/activities';
import {findPath,walkable} from '../src/game/navigation';
import {activityHall,hallObstacles} from '../src/shared/world';
import {defaultCuePosition} from '../src/shared/pool';
const run=(g:TableGame,seconds:number)=>{for(let i=0;i<seconds*60;i++)g.tick(1/60);};
test('hockey limits seats, paddle speed and halves; goals count to seven and rematch needs both',()=>{
 const g=new TableGame('hockey');assert(g.join('a'));assert(g.join('b'));assert(!g.join('c'));
 g.move('a',Infinity,200);run(g,1);assert.equal(g.state.paddles[0].x,100);
 g.move('a',900,900);g.tick(.01);assert(g.state.paddles[0].x<=112.001);run(g,1);assert.equal(g.state.paddles[0].x,328);assert.equal(g.state.paddles[0].y,346);
 for(let n=0;n<7;n++){run(g,1);Object.assign(g.state.balls[0],{x:694,y:200,vx:900,vy:0});g.tick(.02);assert.equal(g.state.score[0],n+1);}
 assert.equal(g.state.phase,'finished');assert.equal(g.state.winner,'a');g.rematch('c');g.rematch('a');assert.equal(g.state.phase,'finished');g.rematch('b');assert.equal(g.state.phase,'playing');assert.deepEqual(g.state.score,[0,0]);
 g.leave('a');assert.equal(g.state.phase,'waiting');assert.deepEqual(g.state.players,['b']);
});
const pool=()=>{const g=new TableGame('pool');g.join('a');g.join('b');return g;};
const corner=(g:TableGame,id:number)=>{g.state.breaking=false;Object.assign(g.state.balls[0],{x:120,y:120});Object.assign(g.state.balls.find(b=>b.id===id)!,{x:80,y:80});};
test('a waiting pool host breaks first, both players regain control after fouls and default placement is legal',()=>{
 const g=new TableGame('pool');g.join('a');assert(!g.shoot('a',0,80));g.join('b');assert(!g.shoot('b',0,80));assert(g.shoot('a',0,80));run(g,12);
 assert.equal(g.state.turn,1);assert.equal(g.state.ballInHand,'kitchen');const point=defaultCuePosition(g.state)!;assert(point.x<=180);assert(g.place('b',point.x,point.y));assert(g.shoot('b',Math.PI,80));run(g,12);
 assert.equal(g.state.turn,0);assert.equal(g.state.ballInHand,'table');const next=defaultCuePosition(g.state)!;assert(g.place('a',next.x,next.y));assert(g.shoot('a',0,80));
});
test('eight-ball rack, real break and illegal input',()=>{
 const g=pool();assert.equal(g.state.balls.length,16);assert.equal(new Set(g.state.balls.map(b=>b.id)).size,16);assert.equal(g.state.balls.find(b=>b.id===8)!.x,508.4);
 assert(!g.shoot('b',0,600));assert(!g.shoot('a',NaN,600));assert(g.shoot('a',0,850));assert(!g.shoot('a',0,850));run(g,12);assert(!g.state.moving);assert.deepEqual(g.state.groups,['open','open']);assert(g.state.balls.some(b=>b.id>0&&b.x<450));
});
test('first legal pocket assigns groups, a miss awards ball in hand and placement is validated',()=>{
 const g=pool();corner(g,1);assert(g.shoot('a',Math.PI*1.25,300));run(g,12);assert(!g.state.balls.find(b=>b.id===1)!.active);assert.deepEqual(g.state.groups,['solid','stripe']);assert.equal(g.state.turn,0);assert.equal(g.state.score[0],1);
 Object.assign(g.state.balls[0],{x:150,y:200});assert(g.shoot('a',Math.PI,80));run(g,12);assert.equal(g.state.turn,1);assert.equal(g.state.ballInHand,'table');assert(!g.shoot('b',0,400));assert(!g.place('a',150,200));assert(!g.place('b',NaN,200));assert(!g.place('b',470,200));assert(g.place('b',150,200));assert.equal(g.state.ballInHand,'none');
});
test('eight wins only after the group is cleared and in the called pocket; early eight loses',()=>{
 for(const [cleared,pocket,winner] of [[true,0,'a'],[true,2,'b'],[false,0,'b']] as const){
  const g=pool();g.state.groups=['solid','stripe'];if(cleared)g.state.balls.filter(b=>b.id>0&&b.id<8).forEach(b=>b.active=false);
  corner(g,8);assert(g.shoot('a',Math.PI*1.25,300,pocket));run(g,12);assert.equal(g.state.phase,'finished');assert.equal(g.state.winner,winner);
 }
});
test('scratch and wrong group transfer the turn, eight on the break is re-spotted',()=>{
 const g=pool();g.state.breaking=false;g.state.groups=['solid','stripe'];corner(g,9);assert(g.shoot('a',Math.PI*1.25,300));run(g,12);assert.equal(g.state.turn,1);assert.equal(g.state.ballInHand,'table');assert.equal(g.state.groups[0],'solid');
 const scratch=pool();scratch.state.breaking=false;Object.assign(scratch.state.balls[0],{x:60,y:60});scratch.shoot('a',Math.PI*1.25,200);run(scratch,12);assert(scratch.state.balls[0].active);assert.equal(scratch.state.ballInHand,'table');assert.equal(scratch.state.turn,1);
 const breaking=pool();corner(breaking,8);breaking.state.breaking=true;breaking.shoot('a',Math.PI*1.25,300);run(breaking,12);assert.equal(breaking.state.phase,'playing');assert(breaking.state.balls.find(b=>b.id===8)!.active);assert.deepEqual(breaking.state.groups,['open','open']);
});
test('piano ownership, invalid notes, listener mute and disconnect release are enforced',()=>{
 const player=()=>({x:120,y:340,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'down',moving:false});
 const people=new Map([['a',player()],['b',player()]]);const events:{type:string;value:any}[]=[];
 const a=new Activities(id=>people.get(id),()=>{},(type,value)=>events.push({type,value}),()=>{});
 a.handle('a',{type:'join',id:'piano'});assert.equal(a.pianist,'a');a.handle('b',{type:'join',id:'piano'});assert.equal(a.pianist,'a');
 a.handle('b',{type:'note',note:60,down:true});a.handle('a',{type:'note',note:100000,down:true});assert.equal(events.filter(e=>e.type==='piano-note').length,0);
 a.handle('a',{type:'note',note:60,down:true});assert.deepEqual(a.snapshot().notes,[60]);a.handle('b',{type:'ears',muted:true});assert(people.get('b')!.ears);assert(!people.get('a')!.ears);
 a.leave('a');assert.equal(a.pianist,'');assert.deepEqual(a.snapshot().notes,[]);assert(!people.get('a')!.playing);assert.equal(events.filter(e=>e.type==='piano-note').at(-1)!.value.down,false);
 a.handle('b',{type:'join',id:'piano'});assert.equal(a.pianist,'b');
});
test('all social activity approaches remain reachable around furniture',()=>{
 for(const [id,activity] of Object.entries(ACTIVITIES)){const obstacles=hallObstacles(activityHall(id));assert(walkable(activity.entry.x,activity.entry.y,obstacles,16));assert(findPath({x:540,y:570},activity.entry,obstacles).length>0,activity.name);}
});
