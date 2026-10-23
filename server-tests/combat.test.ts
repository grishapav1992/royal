import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CombatGame} from '../server/combatGame';
import {CombatRoom} from '../server/combatRoom';
import {neutralCombatInput} from '../src/shared/combat';

test('authoritative combat ignores spectators and invalid input; cooldown limits repeated attacks',()=>{
 const game=new CombatGame('match');game.state.players=['a','b'];game.start();game.tick(3,10000);
 const [a,b]=game.state.fighters;a.x=330;b.x=390;
 game.input('spectator',{...neutralCombatInput(),punch:true},10000);game.tick(.1,10000);assert.equal(b.health,100);
 game.input('a',{...neutralCombatInput(),punch:true,health:0},10000);game.tick(.1,10000);assert.equal(b.health,100);
 game.input('a',{...neutralCombatInput(),punch:true},10000);
 for(let i=0;i<10;i++)game.tick(.01,10000);
 assert.equal(b.health,92);
 for(let i=0;i<10;i++)game.tick(.01,10000);
 assert.equal(b.health,92);
});
test('blocking, timeout draw and mutual knockout have server outcomes',()=>{
 const game=new CombatGame('match');game.state.players=['a','b'];game.start();game.tick(3,1000);
 const [a,b]=game.state.fighters;a.x=330;b.x=390;
 game.input('a',{...neutralCombatInput(),kick:true},1000);game.input('b',{...neutralCombatInput(),block:true},1000);
 game.tick(.1,1000);assert.equal(b.health,98);
 a.health=100;b.health=100;game.state.remaining=.01;game.tick(.1,1000);
 assert.equal(game.state.phase,'settling');assert.equal(game.state.winner,'');
 const second=new CombatGame('ko');second.state.players=['a','b'];second.start();second.tick(3,1000);
 second.state.fighters.forEach((f,i)=>{f.x=330+i*60;f.health=8;});
 for(const id of ['a','b'])second.input(id,{...neutralCombatInput(),punch:true},1000);
 second.tick(.1,1000);assert.equal(second.state.phase,'settling');assert.equal(second.state.winner,'');
});
test('readiness requires both players, matching stake and current match identity',async()=>{
 let funds=0;
 const room=new CombatRoom({escrow:{recoverExpired:async()=>{},fund:async()=>{funds++;},settle:async()=>({winner:'',fee:0,payout:0})} as any,account:id=>id,name:id=>id},()=>{});
 room.join('a');room.join('b');assert.equal(room.join('c'),false);
 const command={type:'combat-ready',match:room.state.id,stake:room.state.stake};
 room.handle('a',command);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(funds,0);
 room.handle('b',{...command,match:'old'});assert.equal(funds,0);
 room.handle('b',{...command,stake:500});assert.equal(funds,0);
 room.handle('b',command);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(funds,1);assert.equal(room.state.phase,'countdown');
 room.handle('a',command);room.handle('b',command);assert.equal(funds,1);
});

test('disconnect grace allows a return; two disconnected players refund, and funding cancellation refunds',async context=>{
 let now=1000;context.mock.method(Date,'now',()=>now);
 let settleWinner:string|undefined;
 const dependencies={escrow:{recoverExpired:async()=>{},fund:async()=>{},settle:async(_id:string,winner:string)=>{settleWinner=winner;return{winner,fee:winner?10:0,payout:winner?190:0};}} as any,account:(id:string)=>id,name:(id:string)=>id,now:()=>now};
 const room=new CombatRoom(dependencies,()=>{});room.join('a');room.join('b');
 const ready={type:'combat-ready',match:room.state.id,stake:room.state.stake};room.handle('a',ready);room.handle('b',ready);
 await new Promise(resolve=>setTimeout(resolve,0));room.disconnect('a');now+=10000;room.tick(.1);assert.equal(settleWinner,undefined);
 room.reconnect('a');now+=15000;room.tick(.1);assert.equal(settleWinner,undefined);
 room.disconnect('a');room.disconnect('b');now+=20001;room.tick(.1);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(settleWinner,'');assert.equal(room.state.players.length,0);
 let release!:()=>void;
 const second=new CombatRoom({...dependencies,escrow:{...dependencies.escrow,fund:()=>new Promise<void>(resolve=>{release=resolve;})}},()=>{});
 second.join('a');second.join('b');const confirmation={...ready,match:second.state.id};second.handle('a',confirmation);second.handle('b',confirmation);
 await new Promise(resolve=>setTimeout(resolve,0));second.leave('a');release();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(second.state.phase,'settling');second.tick(.01);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(second.state.phase,'finished');assert.equal(second.state.payout,0);
});
