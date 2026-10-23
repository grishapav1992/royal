import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatGame } from '../server/combatGame';
import { CombatRoom } from '../server/combatRoom';
import { neutralCombatInput } from '../src/shared/combat';

const input=(extra={})=>({...neutralCombatInput(),...extra});
async function room(){
 let now=10000,funds=0,settlements=0;
 const bindings:Record<string,string>={a:'account-a',b:'account-b',c:'account-c'};
 const r=new CombatRoom({account:id=>bindings[id],name:id=>id,now:()=>now,escrow:{
  fund:async()=>{funds++;},recoverExpired:async()=>{},settle:async(_id,winner='')=>{settlements++;return{winner,fee:0,payout:0};},
 }},()=>{});
 r.join('a');r.join('b');
 for(const id of ['a','b'])r.handle(id,{type:'combat-ready',match:r.state.id,stake:r.state.stake});
 await new Promise(resolve=>setTimeout(resolve,0));r.tick(3);
 return {r,bindings,advance:(ms:number)=>{now+=ms;r.tick(ms/1000);},counts:()=>({funds,settlements})};
}
test('console result claims, forged actors, positions, damage, clock and payout fields cannot change the fight',async()=>{
 const {r,counts}=await room();const before=structuredClone(r.state);
 const payloads=[
  {type:'combat-win',winner:'a'},{type:'combat-settle',winner:'a',payout:1000000},
  {type:'combat-input',seq:1,input:input({punch:true}),player:'b'},
  {type:'combat-input',seq:1,input:input({damage:10000})},
  {type:'combat-input',seq:1,input:input(),x:600,health:0},
  {type:'combat-input',seq:1,input:input(),dt:90,time:0},
  {type:'combat-ready',stake:1,winner:'a'},
 ];
 for(const value of payloads)r.handle('a',{match:r.state.id,...value});
 r.handle('c',{type:'combat-input',match:r.state.id,seq:1,input:input({kick:true})});
 assert.deepEqual(r.state,before);assert.deepEqual(counts(),{funds:1,settlements:0});
 assert.equal(r.diagnostics().schema,payloads.length);assert.equal(r.diagnostics().identity,1);
});
test('stale and duplicate packets cannot roll controls back or leak into another match',async()=>{
 const {r,advance}=await room(),match=r.state.id;
 r.handle('a',{type:'combat-input',match,seq:1,input:input({right:true})});
 r.handle('a',{type:'combat-input',match,seq:2,input:input()});
 r.handle('a',{type:'combat-input',match,seq:1,input:input({kick:true})});
 r.handle('a',{type:'combat-input',match:'previous-match',seq:3,input:input({kick:true})});
 assert.equal(r.state.fighters[0].inputSequence,2);
 assert.deepEqual(r.state.fighters[0].input,input());
 advance(100);assert.equal(r.state.fighters[1].health,100);
 assert.equal(r.diagnostics().sequence,1);assert.equal(r.diagnostics().match,1);
});
test('session-account binding and connection state prevent controlling another player',async()=>{
 const {r,bindings}=await room();bindings.a='account-c';
 r.handle('a',{type:'combat-input',match:r.state.id,seq:1,input:input({right:true})});
 assert.equal(r.state.fighters[0].inputSequence,0);
 r.disconnect('b');r.handle('b',{type:'combat-input',match:r.state.id,seq:1,input:input({left:true})});
 assert.equal(r.state.fighters[1].inputSequence,0);assert.equal(r.diagnostics().identity,2);
});
test('flooding cannot accelerate movement, cooldowns or damage and does not consume the opponent budget',async()=>{
 const {r,advance}=await room();const match=r.state.id;
 r.state.fighters[0].x=330;r.state.fighters[1].x=390;
 for(let seq=1;seq<=10000;seq++)r.handle('a',{type:'combat-input',match,seq,input:input({punch:true})});
 assert.equal(r.state.fighters[1].health,100);
 assert.ok((r.diagnostics().rate??0)>9900);
 r.handle('b',{type:'combat-input',match,seq:1,input:input({block:true})});
 assert.equal(r.state.fighters[1].inputSequence,1);
 advance(100);assert.equal(r.state.fighters[1].health,98);
 advance(100);assert.equal(r.state.fighters[1].health,98);
});
test('server recovery and stun prevent instant attack-to-block exploits',()=>{
 const g=new CombatGame('m');g.state.players=['a','b'];g.start();g.tick(3,1000);
 const [a,b]=g.state.fighters;a.x=330;b.x=390;
 g.input('a',input({punch:true}),1000);g.tick(1/60,1000);assert.equal(b.health,92);
 g.input('b',input({block:true}),1017);
 g.input('a',input(),1017);b.cooldown=0;g.tick(1/60,1017);
 assert.equal(b.action,'endure');
 a.actionTime=.2;a.stun=0;g.input('a',input({block:true}),1034);g.tick(1/60,1034);
 assert.notEqual(a.action,'blocking');
});
test('lost funding response stays locked and retries the same match, cancellation cannot start a new debit',async()=>{
 let calls=0,cancels=0;
 const r=new CombatRoom({account:id=>id,name:id=>id,now:()=>10000,escrow:{
  fund:async()=>{calls++;throw Object.assign(Error('uncertain'),{status:503});},
  recoverExpired:async()=>{},settle:async()=>({winner:'',fee:0,payout:0}),
  cancel:async()=>{cancels++;},
 }},()=>{});
 r.join('a');r.join('b');const match=r.state.id;
 for(const id of ['a','b'])r.handle(id,{type:'combat-ready',match,stake:r.state.stake});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(r.state.phase,'funding');assert.equal(r.state.id,match);r.leave('a');
 // Move the retry clock forward without accepting client timestamps.
 (r as any).retryAt=0;r.tick(.1);await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls,1);assert.equal(cancels,1);assert.equal(r.state.phase,'finished');
});

test('a missing funding response reaches a server deadline and cancels without fresh readiness or another debit',async()=>{
 let now=10000,cancels=0;
 const r=new CombatRoom({account:id=>id,name:id=>id,now:()=>now,escrow:{
  fund:async()=>{throw Object.assign(Error('lost response'),{status:503});},recoverExpired:async()=>{},
  settle:async()=>({winner:'',fee:0,payout:0}),cancel:async()=>{cancels++;},
 }},()=>{});
 r.join('a');r.join('b');for(const id of ['a','b'])r.handle(id,{type:'combat-ready',match:r.state.id,stake:r.state.stake});
 await new Promise(resolve=>setTimeout(resolve,0));now+=20001;r.tick(.1);await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(cancels,1);assert.equal(r.state.phase,'finished');assert.equal(r.state.pot,0);
});
