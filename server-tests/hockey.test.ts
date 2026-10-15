import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TableGame} from '../server/tableGames';
import {clampPaddle,stepPaddle,collidePaddle,stepHockeyPuck,HOCKEY_PADDLE_RADIUS,HOCKEY_PUCK_RADIUS,HOCKEY_PADDLE_SPEED} from '../src/shared/hockey';
test('larger hockey paddles collide with the puck at their visible edge',()=>{
 const g=new TableGame('hockey');g.join('a');g.join('b');g.tick(.1);for(let i=0;i<9;i++)g.tick(.1);
 Object.assign(g.state.balls[0],{x:140,y:200,vx:-100,vy:0});g.tick(.001);
 assert(g.state.balls[0].vx>0);assert.equal(g.state.balls[0].x-g.state.paddles[0].x,HOCKEY_PADDLE_RADIUS+HOCKEY_PUCK_RADIUS);
});
test('both paddles stay fully within their half, and invalid or spectator input cannot move them',()=>{
 const g=new TableGame('hockey');g.join('a');g.join('b');
 g.move('c',300,300);g.move('a',Infinity,NaN);g.tick(.1);assert.deepEqual(g.state.paddles,[{x:100,y:200},{x:620,y:200}]);
 g.move('a',9999,-100);g.move('b',-100,9999);for(let i=0;i<5;i++)g.tick(.1);
 assert.deepEqual(g.state.paddles,[clampPaddle({x:9999,y:-100},0),clampPaddle({x:-100,y:9999},1)]);
 assert(g.state.paddles[0].x+HOCKEY_PADDLE_RADIUS<=360);assert(g.state.paddles[1].x-HOCKEY_PADDLE_RADIUS>=360);
 assert(g.state.paddles[0].y-HOCKEY_PADDLE_RADIUS>=22);assert(g.state.paddles[1].y+HOCKEY_PADDLE_RADIUS<=378);
});
test('local prediction and server use the same bounded movement regardless of frame rate',()=>{
 const target={x:328,y:346};
 for(const hz of [30,60,144,240]){
  const p={x:100,y:200};for(let i=0;i<hz;i++){const before={...p};stepPaddle(p,target,1/hz);assert(Math.hypot(p.x-before.x,p.y-before.y)<=HOCKEY_PADDLE_SPEED/hz+.00001);}
  assert.deepEqual(p,target);
 }
 const a={x:100,y:200},b={...a};stepPaddle(a,target,.1);for(let i=0;i<24;i++)stepPaddle(b,target,.1/24);assert(Math.hypot(a.x-b.x,a.y-b.y)<.000001);
});
test('puck hits the visible paddle rim head-on and diagonally, including a moving paddle, without overlap',()=>{
 for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI]){
  const nx=Math.cos(angle),ny=Math.sin(angle),p={x:200,y:200},b={x:p.x+nx*43,y:p.y+ny*43,vx:-nx*300,vy:-ny*300};
  assert(collidePaddle(b,p,{vx:nx*600,vy:ny*600},0));assert(Math.abs(Math.hypot(b.x-p.x,b.y-p.y)-44)<.000001);assert(b.vx*nx+b.vy*ny>0);assert(Math.hypot(b.vx,b.vy)<=1000.000001);
 }
 const b={x:244,y:200,vx:-800,vy:0},p={x:200,y:200};const result=stepHockeyPuck(b,[p],[{vx:0,vy:0}],1/240);assert(result.hit);assert.equal(b.x,244);assert.equal(b.vx,800);
});
test('puck cannot overlap either paddle when both press it at the middle line',()=>{
 const b={x:360,y:200,vx:180,vy:0},paddles=[{x:328,y:200},{x:392,y:200}];stepHockeyPuck(b,paddles,[{vx:0,vy:0},{vx:0,vy:0}],1/240);
 for(const p of paddles)assert(Math.hypot(b.x-p.x,b.y-p.y)>=44-.000001);assert(Math.abs(b.vy)>=180);
 const g=new TableGame('hockey');g.join('a');g.join('b');g.move('a',328,200);g.move('b',392,200);for(let i=0;i<7;i++)g.tick(.1);
 assert(g.state.serveDelay>0);for(const p of g.state.paddles)assert(Math.hypot(g.state.balls[0].x-p.x,g.state.balls[0].y-p.y)>=44-.000001);
});
