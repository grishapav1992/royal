import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PvpStore} from '../../server/pvp/store';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {createCardGame} from '../../server/pvp/cards';

async function setup(){
 const c=await pvpFixture(),store=new PvpStore(c.ledger),now=Date.now();await store.ready;
 const aa={accountId:c.a,name:'Анна',roomId:'pvp-test'},bb={accountId:c.b,name:'Борис',roomId:'pvp-test'};
 const people=[{accountId:c.a,name:aa.name,connected:true,available:true},{accountId:c.b,name:bb.name,connected:true,available:true}];
 await store.syncRoom('pvp-test',people,now);
 return{...c,store,aa,bb,now,people};
}
test('private and public challenges reserve funds once and require both players to be ready',async()=>{
 const c=await setup();try{
  const op={id:randomUUID(),action:'create',gameId:'durak',stakeUnits:'50000000',targetId:c.b};
  const created=await c.store.command(c.aa,op,c.now),id=created.active!.id;
  assert.equal(created.active!.status,'open');assert.equal((created.wallet as any).balanceUnits,'150000000');
  const replay=await c.store.command(c.aa,{...op},c.now);assert.equal(replay.active!.id,id);
  await assert.rejects(c.store.command(c.aa,{...op,stakeUnits:'1000000'},c.now),/Нельзя изменить/);
  const third={accountId:randomUUID(),name:'Виктор',roomId:'pvp-test'};
  assert.equal((await c.store.snapshot(third,c.now)).challenges.length,0);
  await assert.rejects(c.store.command(third,{id:randomUUID(),action:'accept',challengeId:id},c.now),/недоступен/);
  const accepted=await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:id},c.now);assert.equal(accepted.active!.status,'arriving');
  await c.store.command(c.aa,{id:randomUUID(),action:'ready',challengeId:id},c.now);assert.equal((await c.store.snapshot(c.aa,c.now)).cards,null);
  const started=await c.store.command(c.bb,{id:randomUUID(),action:'ready',challengeId:id},c.now);assert.equal(started.active!.status,'playing');assert(started.cards);assert(!('hands'in started.cards!));
  const done=await c.store.command(c.bb,{id:randomUUID(),action:'resign',challengeId:id},c.now);
  assert.equal(done.active!.winnerId,c.a);assert.equal((await c.store.snapshot(c.aa,c.now)).wallet.state,'assigned');
  assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'245000000');assert.equal((await c.ledger.audit()).houseUnits,'5000000');
 }finally{await c.close();}
});
test('expired invites and arrival cancellation refund every hold without a fee',async()=>{
 const c=await setup();try{
  let s=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'pool',stakeUnits:'50000000',targetId:null},c.now);
  await c.store.sweep(c.now+120001);assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');
  await c.store.syncRoom('pvp-test',c.people,c.now+120002);
  await c.ledger.sync(c.source,await c.reconciliation(),c.now+120002);
  s=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'pool',stakeUnits:'50000000',targetId:null},c.now+120002);
  await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:s.active!.id},c.now+120002);
  await c.store.command(c.bb,{id:randomUUID(),action:'cancel',challengeId:s.active!.id},c.now+120002);
  assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');assert.equal((await c.ledger.wallet(c.b)as any).balanceUnits,'200000000');assert.equal((await c.ledger.audit()).houseUnits,'0');
 }finally{await c.close();}
});
test('disconnect deadline cannot be bypassed by reconnecting late; a lost physics server refunds the pot',async()=>{
 const c=await setup();try{
  const s=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'chess',stakeUnits:'50000000',targetId:null},c.now),id=s.active!.id;
  await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:id},c.now);for(const actor of[c.aa,c.bb])await c.store.command(actor,{id:randomUUID(),action:'ready',challengeId:id},c.now);
  await c.store.syncRoom('pvp-test',[c.people[0],{...c.people[1],connected:false}],c.now+1);
  for(let dt=10000;dt<=60000;dt+=10000)await c.store.syncRoom('pvp-test',[c.people[0],{...c.people[1],connected:false}],c.now+dt);
  await c.store.syncRoom('pvp-test',c.people,c.now+60002);
  assert.equal((await c.store.snapshot(c.aa,c.now+60002)).active!.winnerId,c.a);
  await c.store.syncRoom('pvp-test',c.people,c.now+60003);
  const next=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'pool',stakeUnits:'50000000',targetId:null},c.now+60003);
  await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:next.active!.id},c.now+60003);
  for(const actor of[c.aa,c.bb])await c.store.command(actor,{id:randomUUID(),action:'ready',challengeId:next.active!.id},c.now+60003);
  await c.store.sweep(c.now+76004);assert.equal((await c.store.snapshot(c.aa,c.now+76004)).active!.reason,'server');
  assert.equal((await c.ledger.audit()).houseUnits,'5000000');
 }finally{await c.close();}
});
test('a persisted last-card move settles once, and the same UUID with another move conflicts',async()=>{
 const c=await setup();try{
  const start=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'crazy-eights',stakeUnits:'50000000',targetId:null},c.now),id=start.active!.id;
  await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:id},c.now);for(const actor of[c.aa,c.bb])await c.store.command(actor,{id:randomUUID(),action:'ready',challengeId:id},c.now);
  const row=await c.ledger.db.prepare('SELECT payload FROM pvp_matches WHERE id=?').get(id),saved=JSON.parse(String(row!.payload));
  saved.cards={...createCardGame('crazy-eights'),hands:[[0],[13]],stock:[3,4],discard:[1],suit:0,actor:0};
  await c.ledger.db.prepare('UPDATE pvp_matches SET payload=? WHERE id=?').run(JSON.stringify(saved),id);
  const op={id:randomUUID(),action:'move',challengeId:id,revision:saved.cards.revision,move:{kind:'play',card:0}};
  const result=await c.store.command(c.aa,op,c.now);assert.equal(result.active!.winnerId,c.a);assert.equal((await c.ledger.audit()).houseUnits,'5000000');
  await c.store.command(c.aa,op,c.now);assert.equal((await c.ledger.audit()).houseUnits,'5000000');
  await assert.rejects(c.store.command(c.aa,{...op,move:{kind:'draw'}},c.now),/Нельзя изменить/);
 }finally{await c.close();}
});
