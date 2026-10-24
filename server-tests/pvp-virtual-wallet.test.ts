import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {VirtualPvpLedger} from '../server/pvp/virtual-wallet';
import {PvpStore} from '../server/pvp/store';
import {virtualPvpCommand} from '../server/pvp/virtual-service';
import {demoBalanceUnits,saveDemoUnits,MAX_DEMO_UNITS,demoReservedUnits} from '../server/demoWalletAmounts';
import {CommonSkinPayments} from '../server/skinPayments';
import {validVirtualPvpWallet,VIRTUAL_PVP_SCOPE} from '../src/shared/pvp';

async function fixture(amount=200){
 const db=new PostgresDatabase(':memory:'),a=randomUUID(),b=randomUUID();
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');for(const id of[a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
 const common=new DemoWalletStore(db);await common.ready;
 for(const id of[a,b])await common.operate(id,{id:randomUUID(),kind:'deposit',amount});
 const ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger);await store.ready;
 const aa={accountId:a,name:'Анна',roomId:'virtual-test'},bb={accountId:b,name:'Борис',roomId:'virtual-test'},now=Date.now();
 const people=[aa,bb].map(p=>({accountId:p.accountId,name:p.name,connected:true,available:true}));await store.syncRoom(aa.roomId,people,now);
 const match=(gameId='chess',stakeUnits='50000000')=>({matchId:randomUUID(),gameId,stakeUnits});
 return{db,a,b,aa,bb,now,people,common,ledger,store,match,close:()=>db.close(),balance:(id:string)=>demoBalanceUnits(db,id)};
}
test('PvP and slots spend the same top-up; 50+50 returns 95 with a single 5 USDT fee',async()=>{
 const c=await fixture();try{
  const m=c.match();await c.ledger.pvpHold(c.a,m);await c.ledger.pvpHold(c.b,m);
  await c.ledger.pvpHold(c.a,m);assert.equal((await c.common.snapshot(c.a)).balance,150);
  const finish={matchId:m.matchId,winnerId:c.a,reason:'win'};
  await Promise.all([c.ledger.pvpFinish(c.a,finish),c.ledger.pvpFinish(c.a,finish)]);
  assert.equal(await c.balance(c.a),24500);assert.equal(await c.balance(c.b),15000);
  assert.equal(Number((await c.db.prepare('SELECT fee_units FROM virtual_pvp_banks').get())!.fee_units),500);
  await assert.rejects(c.ledger.pvpFinish(c.a,{...finish,winnerId:c.b}));
  const result=await c.common.operate(c.a,{id:randomUUID(),kind:'spin',amount:10});
  assert.equal(result.wallet.balance,235+result.round!.payout);
  assert(validVirtualPvpWallet(await c.ledger.wallet(c.a)));
 }finally{await c.close();}
});
test('the real room service requires the new wallet scope, preserves private hands and settles once',async()=>{
 const c=await fixture();try{
  const service=virtualPvpCommand(c.store),request={id:randomUUID(),action:'create',gameId:'durak',stakeUnits:'50000000',targetId:c.b};
  assert.equal((await service(c.a,'pvp-command',{...c.aa,request})).status,409);
  const created=await service(c.a,'pvp-command',{...c.aa,request:{...request,walletScope:VIRTUAL_PVP_SCOPE}});assert.equal(created.status,200);
  const id=created.value.active.id;await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:id},c.now);
  for(const actor of[c.aa,c.bb])await c.store.command(actor,{id:randomUUID(),action:'ready',challengeId:id},c.now);
  const snapshot=await c.store.snapshot(c.aa);assert(snapshot.cards);assert(!('hands'in snapshot.cards!));assert.equal(snapshot.wallet.state,'assigned');
  const op={id:randomUUID(),action:'resign',challengeId:id};await c.store.command(c.bb,op,c.now);await c.store.command(c.bb,op,c.now);
  assert.equal(await c.balance(c.a),24500);assert.equal(await c.balance(c.b),15000);
 }finally{await c.close();}
});
test('draws, expired invites and lost game servers refund the original balance without commission',async()=>{
 const c=await fixture();try{
  for(const reason of ['draw','cancel','server']){
   const m=c.match();await c.ledger.pvpHold(c.a,m);if(reason!=='cancel')await c.ledger.pvpHold(c.b,m);
   await c.ledger.pvpFinish(c.a,{matchId:m.matchId,winnerId:null,reason});
   assert.equal(await c.balance(c.a),20000);assert.equal(await c.balance(c.b),20000);
  }
  const invite=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'pool',stakeUnits:'50000000',targetId:null},c.now);
  await c.store.sweep(c.now+120001);assert.equal((await c.store.snapshot(c.aa)).active!.id,invite.active!.id);assert.equal(await c.balance(c.a),20000);
  assert.equal(Number((await c.db.prepare('SELECT sum(fee_units) AS n FROM virtual_pvp_banks').get())!.n),0);
 }finally{await c.close();}
});
test('simultaneous slot spending and PvP funding cannot spend the same money twice',async()=>{
 const c=await fixture(50);try{
  const results=await Promise.allSettled([c.ledger.pvpHold(c.a,c.match()),c.common.operate(c.a,{id:randomUUID(),kind:'spin',amount:50})]);
  assert(results.some(r=>r.status==='fulfilled'));assert(await c.balance(c.a)>=0);
  const entries=await c.db.prepare('SELECT amount_units,balance_units FROM demo_ledger WHERE account_id=? ORDER BY id').all(c.a);
  let balance=0;for(const e of entries){balance+=Number(e.amount_units);assert.equal(Number(e.balance_units),balance);assert(balance>=0);}assert.equal(balance,await c.balance(c.a));
 }finally{await c.close();}
});
test('reserved payout capacity survives reloads and prevents top-ups from blocking settlement',async()=>{
 const c=await fixture();try{
  await saveDemoUnits(c.db,c.a,MAX_DEMO_UNITS-5000);const m=c.match();await c.ledger.pvpHold(c.a,m);await c.ledger.pvpHold(c.b,m);
  assert.equal(await demoReservedUnits(c.db,c.a),9500);
  await assert.rejects(c.common.operate(c.a,{id:randomUUID(),kind:'deposit',amount:100}));
  const restarted=new VirtualPvpLedger(c.db,c.common);await restarted.pvpFinish(c.a,{matchId:m.matchId,winnerId:c.a,reason:'win'});
  assert.equal(await c.balance(c.a),MAX_DEMO_UNITS-500);assert.equal(await demoReservedUnits(c.db,c.a),0);
 }finally{await c.close();}
});
test('fractional stakes pay exact cents, and unsupported precision never creates a hold',async()=>{
 const c=await fixture();try{
  await assert.rejects(c.ledger.pvpHold(c.a,c.match('durak','1010000')),/0,10/);
  const m=c.match('durak','1100000');await c.ledger.pvpHold(c.a,m);await c.ledger.pvpHold(c.b,m);
  await c.ledger.pvpFinish(c.a,{matchId:m.matchId,winnerId:c.a,reason:'win'});
  assert.equal(await c.balance(c.a),20099);assert.equal(await c.balance(c.b),19890);
  assert.equal(Number((await c.db.prepare('SELECT fee_units FROM virtual_pvp_banks').get())!.fee_units),11);
 }finally{await c.close();}
});
test('atelier and a PvP reservation use one balance and failed generation refunds only its own debit',async()=>{
 const c=await fixture();try{
  const payments=new CommonSkinPayments(c.db,c.common.ready),id=randomUUID(),m=c.match();
  await c.ledger.pvpHold(c.a,m);await payments.skinPurchase(c.a,id,'reserve');assert.equal(await c.balance(c.a),14000);
  await payments.skinPurchase(c.a,id,'refund');await payments.skinPurchase(c.a,id,'refund');assert.equal(await c.balance(c.a),15000);
  await c.ledger.pvpFinish(c.a,{matchId:m.matchId,winnerId:null,reason:'cancel'});assert.equal(await c.balance(c.a),20000);
 }finally{await c.close();}
});
