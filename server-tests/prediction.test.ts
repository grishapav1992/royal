import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MovementInputs } from '../server/movementInputs';
import { MovementPrediction } from '../src/network/MovementPrediction';
import { applyMovementInput, type MovementBody, type MovementInput } from '../src/shared/movement';
import { FURNITURE, furnitureBounds } from '../src/shared/furniture';
import { BAR_APPROACH } from '../src/shared/world';
const body = (): MovementBody => ({x:420,y:570,facing:'down',moving:false,seat:'',action:'idle',drink:'',actionUntil:0});

test('delayed acknowledgements replay only outstanding steps, including release and reverse', () => {
  const prediction = new MovementPrediction(), local = body(), server = body(), inputs: MovementInput[] = [];
  for(let i=0;i<12;i++)prediction.step(local,1,0,16);
  prediction.flush(batch=>inputs.push(...batch));
  const firstX=local.x; assert(firstX>440);
  for(const input of inputs.slice(0,5))applyMovementInput(server,input);
  assert.equal(prediction.reconcile(server,5).x,local.x);
  prediction.step(local,0,0,0);
  assert.equal(prediction.reconcile(server,5).moving,false);
  prediction.step(local,-1,0,16);
  const replayed=prediction.reconcile(server,5);
  assert.equal(replayed.x,local.x); assert.equal(replayed.facing,'left');
  prediction.flush(batch=>inputs.push(...batch));
  for(const input of inputs.slice(5))applyMovementInput(server,input);
  assert.equal(prediction.reconcile(server,14).x,local.x); assert.equal(prediction.pendingCount,0);
  prediction.reset(); assert.equal(prediction.active,false);
});

test('server limits elapsed movement time and ignores duplicate, malformed and oversized inputs', () => {
  const limiter = new MovementInputs(0), player = body();
  const batch=Array.from({length:20},(_,i)=>({seq:i+1,x:1,y:0,ms:50}));
  limiter.accept(player,batch,0); assert(Math.abs(player.x-435.5)<1e-6);
  limiter.accept(player,batch,500); assert(Math.abs(player.x-435.5)<1e-6);
  assert.equal(limiter.accept(player,[{seq:21,x:Infinity,y:0,ms:50}],500),false);
  assert.equal(limiter.accept(player,[{seq:21,x:1,y:0,ms:500}],500),false);
  assert.equal(limiter.accept(player,[...batch,...batch],500),false);
  assert.equal(limiter.sequence,2);
  assert.equal(limiter.pendingCount,18);
  limiter.accept(player,[{seq:21,x:1,y:0,ms:50}],50); assert(Math.abs(player.x-443.25)<1e-6);
  assert.equal(limiter.takeDuration(100,50),0);
});

test('a delayed sprint burst keeps every step pending until fully executed, including the final stop', () => {
  const local=body(), server=body(), prediction=new MovementPrediction(), limiter=new MovementInputs(0);
  for(let i=0;i<15;i++) prediction.step(local,1,0,16,true);
  prediction.step(local,0,0,0);
  prediction.flush(batch=>limiter.accept(server,batch,240));
  assert.equal(limiter.sequence,6);
  assert(limiter.pendingCount>0);
  const stoppedX=local.x;
  for(let now=240;now<=440;now+=10) {
    limiter.advance(server,now);
    const replayed=prediction.reconcile(server,limiter.sequence);
    assert(Math.abs(replayed.x-stoppedX)<1e-6, 'acknowledgements must never pull the stopped player back');
    assert.equal(replayed.moving,false);
    assert(server.x-420 <= 155*1.75*(100+now-240)/1000+1e-6, 'server still enforces elapsed time');
  }
  assert.equal(limiter.pendingCount,0);
  assert.equal(prediction.pendingCount,0);
  assert.deepEqual(server,local);
});

test('cancelling queued movement prevents old steps from resuming after a new action', () => {
  const server=body(), limiter=new MovementInputs(0);
  limiter.accept(server,Array.from({length:10},(_,i)=>({seq:i+1,x:1,y:0,ms:50})),0);
  limiter.cancel();
  const stoppedX=server.x;
  limiter.advance(server,1000);
  assert.equal(server.x,stoppedX); assert.equal(limiter.pendingCount,0); assert.equal(limiter.sequence,10);
  assert.equal(limiter.accept(server,[{seq:10,x:1,y:0,ms:50}],1000),false);
  limiter.accept(server,[{seq:11,x:-1,y:0,ms:50}],1000);
  assert(server.x<stoppedX);
});

test('repeated bursts cannot grow the queue or exceed the movement time budget', () => {
  const server=body(), limiter=new MovementInputs(0);
  for(let batch=0;batch<30;batch++) {
    limiter.accept(server,Array.from({length:20},(_,i)=>({seq:batch*20+i+1,x:1,y:0,ms:50,sprint:true})),0);
  }
  assert.equal(limiter.pendingCount,20);
  assert(Math.abs(server.x-420-155*1.75*.1)<1e-6);
  limiter.advance(server,50);
  assert(Math.abs(server.x-420-155*1.75*.15)<1e-6);
});

test('prediction and server agree at table furniture and when leaving the standing bar', () => {
  const local=body(), server=body(), limiter=new MovementInputs(0);
  local.hall=server.hall='tables'; local.x=server.x=540;
  for(let seq=1;seq<=80;seq++){
    const input={seq,x:0,y:-1,ms:16};applyMovementInput(local,input);limiter.accept(server,[input],seq*16);
  }
  const pool=furnitureBounds(FURNITURE.pool), edge=pool.y+pool.h+12;
  assert.equal(local.y,server.y); assert(local.y>=edge); assert(local.y<edge+4); assert.equal(local.moving,false);
  Object.assign(local,{hall:'arcade',...BAR_APPROACH,seat:'',action:'drink',drink:'beer',actionUntil:10000});
  Object.assign(server,local);
  const input={seq:81,x:1,y:0,ms:16};applyMovementInput(local,input);limiter.accept(server,[input],81*16);
  assert.equal(local.x,server.x); assert.equal(local.y,BAR_APPROACH.y);
  assert(Math.abs(local.x-BAR_APPROACH.x-155*.016)<1e-6,'movement starts where the standing guest is');
  assert.equal(local.seat,''); assert.equal(local.action,'idle'); assert.equal(local.drink,'');
});

test('sprint toggles replay consistently and keeps diagonal speed normalized', () => {
  const prediction = new MovementPrediction(), local = body(), server = body(), limiter = new MovementInputs(0);
  for (let i = 0; i < 12; i++) {
    prediction.step(local, 1, 1, 16, i >= 3 && i < 9);
    if (i === 5) prediction.flush(batch => limiter.accept(server, batch, 96));
  }
  const expected = 155 * .016 * (6 + 6 * 1.75);
  assert(Math.abs(Math.hypot(local.x-420, local.y-570)-expected) < 1e-6);
  assert.deepEqual(prediction.reconcile(server, limiter.sequence), local);
  prediction.flush(batch => limiter.accept(server, batch, 192));
  assert.deepEqual(server, local);
  prediction.step(local, 0, 0, 0, true);
  prediction.flush(batch => limiter.accept(server, batch, 192));
  assert.equal(server.moving, false);
});

test('sprint cannot bypass the time budget, furniture or input validation', () => {
  const limiter = new MovementInputs(0), player = body();
  for (const sprint of [2, 'true', null, {}]) {
    assert.equal(limiter.accept(player, [{seq:1,x:1,y:0,ms:50,sprint}], 0), false);
  }
  limiter.accept(player, Array.from({length:20}, (_,i) => ({seq:i+1,x:1,y:0,ms:50,sprint:true})), 0);
  assert(Math.abs(player.x-420-155*1.75*.1) < 1e-6);
  limiter.cancel();
  player.hall = 'tables'; player.x = 540;
  for (let seq = 21; seq <= 100; seq++) limiter.accept(player, [{seq,x:0,y:-1,ms:50,sprint:true}], (seq-20)*50);
  const pool = furnitureBounds(FURNITURE.pool);
  assert(player.y >= pool.y+pool.h+12);
  assert.equal(player.moving, false);
});

test('a send window drains a long delayed burst without dropping movement or its final stop', () => {
  for (const [frames, ms] of [[75,16], [240,4], [300,50]]) {
    const prediction=new MovementPrediction(), limiter=new MovementInputs(0), local=body(), server=body();
    local.hall=server.hall='arcade'; local.x=server.x=300;
    const packets:MovementInput[][]=[];
    for(let i=0;i<frames;i++) {
      prediction.step(local,1,0,ms,true);
      if(i%3===0)prediction.flush(batch=>packets.push(batch));
    }
    prediction.finish(local); prediction.flush(batch=>packets.push(batch));
    const stopped={...local};
    assert(prediction.pendingCount<=240);
    for(const packet of packets) limiter.accept(server,packet,2000);
    assert(prediction.pendingCount>limiter.sequence+limiter.pendingCount, 'some steps must remain unsent until acknowledgement');
    for(let now=2000;now<18000&&prediction.active;now+=25) {
      limiter.advance(server,now);
      const replayed=prediction.reconcile(server,limiter.sequence);
      assert(Math.abs(replayed.x-stopped.x)<1e-6, 'reconciliation must preserve the stopping point');
      assert.equal(replayed.moving,false);
      prediction.flush(batch=>limiter.accept(server,batch,now));
    }
    assert.equal(prediction.pendingCount,0); assert.equal(limiter.pendingCount,0);
    assert.equal(prediction.active,false); assert.deepEqual(server,stopped);
    prediction.step(local,-1,0,16,true);
    prediction.flush(batch=>limiter.accept(server,batch,18000));
    assert.deepEqual(prediction.reconcile(server,limiter.sequence),local, 'the next key must not reveal a lost tail');
  }
});

test('finishing movement retains prediction until the server can start the next action at the same position', () => {
  const prediction=new MovementPrediction(), limiter=new MovementInputs(0), local=body(), server=body();
  for(let i=0;i<15;i++)prediction.step(local,1,0,16,true);
  prediction.finish(local); prediction.finish(local);
  assert.equal(prediction.pendingCount,16, 'repeated UI stop requests add only one stop');
  prediction.flush(batch=>limiter.accept(server,batch,240));
  for(let now=240;now<500;now+=25) {
    limiter.advance(server,now);
    const replayed=prediction.reconcile(server,limiter.sequence);
    assert(Math.abs(replayed.x-local.x)<1e-6);
    if(prediction.active)assert(limiter.pendingCount>0);
  }
  assert.equal(prediction.active,false); assert.equal(prediction.finishing,false);
  limiter.cancel();
  assert.deepEqual(server,local, 'an action may cancel only an already drained queue');
});

test('new keyboard input supersedes a pending handoff and a forced reset drops unsent work', () => {
  const prediction=new MovementPrediction(), local=body(), server=body();
  prediction.step(local,1,0,16,true); prediction.finish(local);
  assert.equal(prediction.finishing,true);
  prediction.step(local,-1,0,16,true);
  assert.equal(prediction.finishing,false);
  let acknowledged=0;
  prediction.flush(batch=>{for(const input of batch){applyMovementInput(server,input);acknowledged=input.seq;}});
  assert.deepEqual(prediction.reconcile(server,acknowledged),local);
  assert.equal(prediction.active,true);
  for(let i=0;i<75;i++)prediction.step(local,1,0,16,true);
  prediction.flush(()=>{});prediction.finish(local);prediction.reset();
  let sent=0;prediction.flush(batch=>sent+=batch.length);
  assert.equal(sent,0);assert.equal(prediction.pendingCount,0);assert.equal(prediction.active,false);
});
