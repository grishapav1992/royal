import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { PostgresDatabase } from '../server/database';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { PaymentOutbox } from '../server/payments/outbox';
import { PaymentCredits, installPaymentCredits } from '../server/payments/credits';
import { PaymentClient } from '../server/payments/client';
import { createPaymentApp } from '../server/payments/app';
import { validCombatEscrowReceipt } from '../src/shared/combatEscrow';

const requestSecret='a'.repeat(64),eventSecret='b'.repeat(64);
async function fixture(){
 const gameDb=new PostgresDatabase(':memory:'),db=new PostgresDatabase(':memory:');
 const a=randomUUID(),b=randomUUID(),c=randomUUID();let now=Date.now(),counter=100;
 await gameDb.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
 await gameDb.prepare('INSERT INTO accounts VALUES (?),(?),(?)').run(a,b,c);
 const credits=new PaymentCredits(gameDb);await credits.ready;
 const app=express();installPaymentCredits(app,credits,eventSecret);
 const listen=async(app:express.Express)=>{const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));return{server,url:'http://127.0.0.1:'+(server.address() as any).port};};
 const game=await listen(app);
 const outbox=new PaymentOutbox(db,game.url+'/internal/payments/events',eventSecret);
 const provider={currencies:async()=>[{code:'usdttrc20',name:'USDT',network:'trx',memo:false}],estimate:async(_a:string,_b:string,v:string)=>v,minimum:async()=>'0.001',
  balance:async()=>({usdttrc20:{amount:'1000000'}}),
  createPayment:async(id:string,currency:string,value:string)=>({payment_id:String(++counter),order_id:id,pay_currency:currency,price_currency:'usdttrc20',price_amount:value,pay_amount:value,pay_address:'T'+'A'.repeat(33),payment_status:'finished',outcome_currency:'usdttrc20',outcome_amount:value}),
 } as unknown as CryptoProvider;
 const config={...cryptoConfig({}),enabled:true,combat:true,games:false};
 const store=new CryptoStore(db,config,provider,outbox.ready,()=>now,undefined,change=>outbox.record(change));await store.ready;
 const payment=await listen(createPaymentApp(store,requestSecret));
 const client=new PaymentClient({url:payment.url,requestSecret,eventSecret},credits);
 for(const id of [a,b,c])await client.deposit(id,{id:randomUUID(),currency:'usdttrc20',amountUnits:'100000000'});
 await outbox.flush();await store.reconcile();
 const match=()=>({id:randomUUID(),accounts:[a,b],stakeUnits:'10000000'});
 return{db,gameDb,a,b,c,store,config,provider,client,credits,outbox,match,url:payment.url,advance:(ms:number)=>{now+=ms;},
  restart:()=>new CryptoStore(db,config,provider,outbox.ready,()=>now,undefined,change=>outbox.record(change)),
  close:async()=>{const stop=(server:Server)=>new Promise<void>(resolve=>server.close(()=>resolve()));await stop(payment.server);await stop(game.server);await db.close();await gameDb.close();}};
}
test('USDT stakes reserve both existing wallets atomically and pay 95% of the pot exactly once through signed ledger events',async()=>{
 const f=await fixture();try{
  const m=f.match(),fund=()=>f.client.combat('fund',f.a,m);
  const receipt=await fund();assert.equal(validCombatEscrowReceipt(receipt),true);
  assert.equal(receipt.state,'active');await fund();await f.outbox.flush();
  assert.deepEqual(await f.credits.snapshot(f.a),{balanceUnits:'90000000',reservedUnits:'10000000'});
  assert.deepEqual(await f.credits.snapshot(f.b),{balanceUnits:'90000000',reservedUnits:'10000000'});
  const settle=()=>f.client.combat('settle',f.a,{...m,winner:f.a});
  const r=await settle();await settle();await f.outbox.flush();
  assert.equal(r.feeUnits,'1000000');assert.equal(r.payoutUnits,'19000000');
  assert.deepEqual(await f.credits.snapshot(f.a),{balanceUnits:'109000000',reservedUnits:'0'});
  assert.deepEqual(await f.credits.snapshot(f.b),{balanceUnits:'90000000',reservedUnits:'0'});
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM crypto_ledger WHERE operation_id=?').get(m.id))!.n,4);
  assert.equal((await f.db.prepare('SELECT sum(counterparty_delta) AS fee FROM crypto_ledger WHERE operation_id=?').get(m.id))!.fee,1000000);
  assert.equal((await f.store.audit()).ok,true);
  assert.equal((await f.client.snapshot(f.a) as any).balanceUnits,'109000000');
 }finally{await f.close();}
});
test('browser calls cannot authorize cash results; forged actor, opponent, stake or winner requests fail without moving money',async()=>{
 const f=await fixture();try{
  const m=f.match();
  const response=await fetch(f.url+'/internal/users/'+f.a+'/combat/settle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...m,winner:f.a})});assert.equal(response.status,401);
  await assert.rejects(()=>f.client.combat('fund',f.c,m));
  await assert.rejects(()=>f.client.combat('fund',f.a,{...m,accounts:[f.a,f.a]}));
  await assert.rejects(()=>f.client.combat('fund',f.a,{...m,stakeUnits:'1'}));
  await assert.rejects(()=>f.client.combat('fund',f.a,{...m,winner:f.a}));
  await f.client.combat('fund',f.a,m);
  await assert.rejects(()=>f.client.combat('settle',f.a,{...m,winner:f.c}));
  await assert.rejects(()=>f.client.combat('fund',f.a,{...m,accounts:[f.a,f.c]}));
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM crypto_ledger WHERE operation_id=?').get(m.id))!.n,2);
 }finally{await f.close();}
});
test('failed fund or settlement rolls back both USDT accounts and durable notifications',async()=>{
 const f=await fixture();try{
  const m=f.match();
  await f.db.exec("CREATE FUNCTION fail_combat_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='"+f.b+"' AND NEW.entry_key LIKE 'combat-%' THEN RAISE EXCEPTION 'reject second ledger line'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_combat BEFORE INSERT ON crypto_ledger FOR EACH ROW EXECUTE FUNCTION fail_combat_entry();");
  await assert.rejects(()=>f.client.combat('fund',f.a,m));
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM crypto_combat_matches').get())!.n,0);
  assert.equal((await f.db.prepare('SELECT balance_units FROM crypto_wallets WHERE account_id=?').get(f.a))!.balance_units,100000000);
  await f.db.exec('DROP TRIGGER fail_combat ON crypto_ledger');
  await f.client.combat('fund',f.a,m);
  await f.db.exec("CREATE TRIGGER fail_combat BEFORE INSERT ON crypto_ledger FOR EACH ROW WHEN (NEW.entry_key LIKE 'combat-settle:%') EXECUTE FUNCTION fail_combat_entry();");
  await assert.rejects(()=>f.client.combat('settle',f.a,{...m,winner:f.a}));
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM crypto_combat_seats').get())!.n,2);
  await f.db.exec('DROP TRIGGER fail_combat ON crypto_ledger');
  await f.client.combat('settle',f.a,{...m,winner:f.a});await f.outbox.flush();
  assert.equal((await f.credits.snapshot(f.a)).balanceUnits,'109000000');assert.equal((await f.store.audit()).ok,true);
 }finally{await f.close();}
});
test('cancel-before-fund tombstones late requests; expiry after restart refunds once with the game service unavailable',async()=>{
 const f=await fixture();try{
  const cancelled=f.match();
  assert.equal((await f.client.combat('cancel',f.a,cancelled)).state,'cancelled');
  assert.equal((await f.client.combat('fund',f.a,cancelled)).state,'cancelled');
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM crypto_ledger WHERE operation_id=?').get(cancelled.id))!.n,0);
  const m=f.match();await f.client.combat('fund',f.a,m);f.advance(150001);
  const restarted=f.restart();await restarted.ready;await restarted.combat.recoverExpired();await restarted.combat.recoverExpired();
  await f.outbox.flush();
  assert.deepEqual(await f.credits.snapshot(f.a),{balanceUnits:'100000000',reservedUnits:'0'});
  const late=await f.client.combat('settle',f.a,{...m,winner:f.a});assert.equal(late.state,'refunded');assert.equal(late.feeUnits,'0');
  assert.equal((await f.store.audit()).ok,true);
 }finally{await f.close();}
});
test('cash wagering fails closed when disabled or custody data is stale, and one account cannot fund two rooms',async()=>{
 const f=await fixture();try{
  f.config.combat=false;await assert.rejects(()=>f.client.combat('fund',f.a,f.match()));f.config.combat=true;
  f.advance(45001);await assert.rejects(()=>f.client.combat('fund',f.a,f.match()));await f.store.reconcile();
  const a=f.match(),b={...f.match(),accounts:[f.a,f.c]};
  const results=await Promise.allSettled([f.client.combat('fund',f.a,a),f.client.combat('fund',f.a,b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM crypto_combat_seats WHERE account_id=?').get(f.a))!.n,1);
 }finally{await f.close();}
});
