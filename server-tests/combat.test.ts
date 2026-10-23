import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { CombatGame } from '../server/combatGame';
import { CombatRoom } from '../server/combatRoom';
import { neutralCombatInput } from '../src/shared/combat';
import { CombatEscrowStore } from '../server/combatEscrow';

async function setup(){
 const db=new PostgresDatabase(':memory:');
 await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('a'),('b'),('c');");
 const wallet=new DemoWalletStore(db);
 for(const id of ['a','b','c'])await wallet.operate(id,{id:randomUUID(),kind:'deposit',amount:1000});
 return {db,wallet};
}
test('equal stakes debit atomically; 95% of the pot pays once and the fee is durable',async()=>{
 const {db,wallet}=await setup();try{
  const id=randomUUID();
  await Promise.all([wallet.combat.fund(id,['a','b'],100),wallet.combat.fund(id,['a','b'],100)]);
  assert.equal((await wallet.snapshot('a')).balance,900);assert.equal((await wallet.snapshot('b')).balance,900);
  const results=await Promise.all([wallet.combat.settle(id,'a'),wallet.combat.settle(id,'a')]);
  assert.deepEqual(results,[{winner:'a',fee:10,payout:190},{winner:'a',fee:10,payout:190}]);
  assert.equal((await wallet.snapshot('a')).balance,1090);assert.equal((await wallet.snapshot('b')).balance,900);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM combat_reservations').get())!.n,0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE source='mortal-kombat'").get())!.n,3);
 }finally{await db.close();}
});
test('insufficient balance rolls back both stakes; self play and tampered stakes are rejected',async()=>{
 const {db,wallet}=await setup();try{
  await db.prepare('UPDATE demo_wallets SET balance=0 WHERE account_id=?').run('b');
  await assert.rejects(()=>wallet.combat.fund(randomUUID(),['a','b'],100),/недостаточно/);
  assert.equal((await wallet.snapshot('a')).balance,1000);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM combat_matches').get())!.n,0);
  await assert.rejects(()=>wallet.combat.fund(randomUUID(),['a','a'],100));
  await assert.rejects(()=>wallet.combat.fund(randomUUID(),['a','b'],100.01));
  await assert.rejects(()=>wallet.combat.fund(randomUUID(),['a','b'],NaN));
 }finally{await db.close();}
});
test('draw and expired orphan matches refund exact stakes after service restart without a fee',async()=>{
 const {db,wallet}=await setup();try{
  let now=1000;const escrow=new CombatEscrowStore(db,wallet.ready,()=>now);
  const id=randomUUID();await escrow.fund(id,['a','b'],50);
  now=122000;const restarted=new CombatEscrowStore(db,wallet.ready,()=>now);
  await Promise.all([restarted.recoverExpired(),restarted.recoverExpired()]);
  assert.equal((await wallet.snapshot('a')).balance,1000);assert.equal((await wallet.snapshot('b')).balance,1000);
  assert.deepEqual(await restarted.settle(id,'a'),{winner:'',fee:0,payout:0});
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE source='mortal-kombat' AND entry_type='refund'").get())!.n,2);
 }finally{await db.close();}
});
test('one account cannot fund concurrent fights in different rooms',async()=>{
 const {db,wallet}=await setup();try{
  const results=await Promise.allSettled([wallet.combat.fund(randomUUID(),['a','b'],100),wallet.combat.fund(randomUUID(),['a','c'],100)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await wallet.snapshot('a')).balance,900);
 }finally{await db.close();}
});
test('payout failure rolls back both balances and reservations, then retries safely',async()=>{
 const {db,wallet}=await setup();try{
  const id=randomUUID();await wallet.combat.fund(id,['a','b'],100);
  await db.exec("CREATE FUNCTION reject_combat_win() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entry_type='win' AND NEW.source='mortal-kombat' THEN RAISE EXCEPTION 'payment failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER combat_fail BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_combat_win();");
  await assert.rejects(()=>wallet.combat.settle(id,'a'),/payment failed/);
  assert.equal((await wallet.snapshot('a')).balance,900);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM combat_reservations').get())!.n,2);
  await db.exec('DROP TRIGGER combat_fail ON demo_ledger');
  await wallet.combat.settle(id,'a');
  assert.equal((await wallet.snapshot('a')).balance,1090);
 }finally{await db.close();}
});
test('reserved payout capacity protects the winner against other wallet credits',async()=>{
 const {db,wallet}=await setup();try{
  const max=1000000000;
  await db.prepare('UPDATE demo_wallets SET balance=? WHERE account_id=?').run(max-100,'a');
  const id=randomUUID();await wallet.combat.fund(id,['a','b'],100);
  await assert.rejects(()=>wallet.operate('a',{id:randomUUID(),kind:'deposit',amount:100}));
  await wallet.combat.settle(id,'a');assert.equal((await wallet.snapshot('a')).balance,max-10);
 }finally{await db.close();}
});
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
