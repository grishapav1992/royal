import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createECDH } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { AccountStore,cookieToken,accounts } from '../server/accounts';
import { PostgresDatabase } from '../server/database';
import { CryptoStore } from '../server/crypto/store';
import { cryptoConfig } from '../server/crypto/config';
import { createPaymentApp } from '../server/payments/app';
import { PaymentOutbox } from '../server/payments/outbox';
import { PaymentClient } from '../server/payments/client';
import { installPaymentCredits } from '../server/payments/credits';
import { paymentFinanceReport } from '../server/admin/paymentFinance';
import { financeFilters } from '../server/admin/validation';
import { installFinanceAdmin } from '../server/admin/routes';
import { playTestSetup } from './finance/helpers/nile-play-fixture';
import { MainnetLedger } from '../server/finance/mainnet-ledger';
import { MAINNET_GENESIS,MAINNET_USDT_TOKEN } from '../server/finance/mainnet-config';
import { nileBase58,nileHex,nilePublicKeyAddress } from '../server/finance/nile-address';
import { createNilePlayServer } from '../server/finance/nile-play-service';

const listen=async(app:express.Application)=>{
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  return{url:'http://127.0.0.1:'+(server.address() as any).port,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
};
const provider=(treasury='1000')=>({balance:async()=>({usdttrc20:{amount:treasury}})} as any);

test('filters reject injection, unsafe amounts, unknown fields and reversed periods',()=>{
  for(const value of [{game:"x' OR true --"},{page:-1},{size:10000},{playerIds:['alice']},{from:4,to:2},{minUnits:'1e9'},{mode:'demo'},{password:'secret'}])
    assert.throws(()=>financeFilters(value));
  assert.deepEqual(financeFilters({playerIds:[],from:0,to:100}),{page:1,size:25,from:0,to:100,playerIds:[]});
});

test('real adjustments conserve backing, reject overdraft, replay once and reach the signed credit outbox',async()=>{
  const db=new PostgresDatabase(':memory:'),actor=randomUUID(),id=randomUUID(),requestSecret='a'.repeat(64),eventSecret='b'.repeat(64);
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
  const outbox=new PaymentOutbox(db,'http://unused/internal/payments/events',eventSecret);
  const store=new CryptoStore(db,{...cryptoConfig({}),enabled:true},provider('100'),outbox.ready,undefined,undefined,v=>outbox.record(v));
  await store.ready;const allow=new Set([actor]),op={id:randomUUID(),actorId:actor,playerId:id,deltaUnits:'25000000',reason:'Проверка начисления из резерва'};
  try{
    await Promise.all([store.adminAdjust(op,allow),store.adminAdjust(op,allow)]);
    assert.equal((await store.snapshot(id) as any).balanceUnits,'25000000');
    assert.equal((await db.prepare('SELECT count(*)::int AS n FROM crypto_ledger').get())!.n,1);
    assert.equal((await db.prepare('SELECT count(*)::int AS n FROM payment_outbox').get())!.n,1);
    const event=JSON.parse((await db.prepare('SELECT body FROM payment_outbox').get())!.body);
    assert.equal(event.kind,'adjustment');assert.equal(event.available_delta_units,'25000000');assert.equal(event.deposit_amount,'0');
    await assert.rejects(()=>store.adminAdjust({...op,deltaUnits:'1'},allow),/номер действия/);
    await assert.rejects(()=>store.adminAdjust({...op,id:randomUUID(),deltaUnits:'100000000'},allow),/резерва/);
    await assert.rejects(()=>store.adminAdjust({...op,id:randomUUID(),deltaUnits:'-26000000'},allow),/Недостаточно/);
    await assert.rejects(()=>store.adminAdjust({...op,id:randomUUID()},new Set()),/закрыт/);
    await store.adminAdjust({...op,id:randomUUID(),deltaUnits:'-5000000'},allow);
    assert.equal((await store.snapshot(id) as any).balanceUnits,'20000000');assert.equal((await store.audit()).ok,true);
    await assert.rejects(()=>db.exec('DELETE FROM finance_adjustments'),/immutable/);
    const report=await paymentFinanceReport(store,{});assert.equal(report.totals.deposits,'0');assert.equal(report.totals.adjustments,'20000000');
    assert.equal(report.balances.house,'80000000');assert.equal(report.wallets[id].available,'20000000');
    assert(!JSON.stringify(report).includes('apiKey'));
  }finally{await db.close();}
});

test('Nile adjustments keep the sealed journal auditable and tests never appear as real money',async()=>{
  const c=await playTestSetup(),actor=randomUUID(),player=randomUUID();
  try{
    await c.ledger.claim(player,await c.ledger.invite('player'));const allow=new Set([actor]);
    const op={id:randomUUID(),actorId:actor,playerId:player,deltaUnits:'10000000',reason:'Тестовое начисление из резерва'};
    await Promise.all([c.ledger.adminAdjust(op,allow),c.ledger.adminAdjust(op,allow)]);
    let audit=await c.ledger.audit();assert.equal(audit.totalUnits,'1000000000');assert.equal(audit.houseUnits,'790000000');
    assert.equal((await c.ledger.wallet(player) as any).balanceUnits,'210000000');
    const report=await c.ledger.adminReport({});assert.equal(report.environment,'test');assert.equal(report.totals.adjustments,'10000000');
    assert.equal(report.totals.deposits,'200000000');assert.equal(report.totals.undated,1);assert.equal(report.wallets[player].available,'210000000');
    const filtered=await c.ledger.adminReport({from:1,kind:'adjustment',playerIds:[player]});assert.equal(filtered.rows.length,1);
    assert.equal((await c.ledger.adminReport({mode:'pvp'})).totals.count,0);
    assert.equal((await c.ledger.adminReport({playerIds:[]})).totals.count,0);
    await assert.rejects(()=>c.ledger.adminAdjust({...op,id:randomUUID(),deltaUnits:'800000000'},allow));
    await assert.rejects(()=>c.ledger.adminAdjust({...op,id:randomUUID(),deltaUnits:'-211000000'},allow));
    audit=await c.ledger.audit();assert.equal(audit.totalUnits,'1000000000');
  }finally{await c.close();}
});

test('payment report filters across full history, excludes pending payouts from cash flow and does not sum demo tables',async()=>{
  const db=new PostgresDatabase(':memory:'),id=randomUUID();await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts VALUES(?)').run(id);const store=new CryptoStore(db,cryptoConfig({}),provider());await store.ready;
  try{
    for(let i=0;i<32;i++)await db.prepare('INSERT INTO crypto_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),id,'deposit','key-'+i,i%2?'waiting':'finished',1000000,i%2?0:900000,null,null,null,null,JSON.stringify({currency:'usdttrc20',address:'public'}),1000+i,1000+i);
    await db.prepare('INSERT INTO crypto_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,'withdrawal','w','queued',5000000,0,null,null,null,null,'{}',5000,5000);
    await db.exec('CREATE TABLE demo_wallets(balance_units BIGINT); INSERT INTO demo_wallets VALUES(999999999999)');
    const r=await paymentFinanceReport(store,{});assert.equal(r.rows.length,25);assert.equal(r.totals.count,33);
    assert.equal(r.totals.deposits,'14400000');assert.equal(r.totals.withdrawals,'0');assert.equal(r.totals.pending,17);
    assert.equal(r.balances.treasury,null);assert.equal(r.enabled,false);
    const f=await paymentFinanceReport(store,{kind:'deposit',status:'finished',from:1004,to:1010,minUnits:'1000000',maxUnits:'1000000'});
    assert.equal(f.totals.count,3);assert.equal(f.totals.deposits,'2700000');
    assert.equal((await paymentFinanceReport(store,{page:2})).rows.length,8);
  }finally{await db.close();}
});

test('signed admin adjustment crosses payment service and reaches game credit mirror once',async()=>{
  const game=new AccountStore(':memory:'),db=new PostgresDatabase(':memory:');await game.ready;
  const owner=await game.login('signed-owner@example.test','correct-password'),player=await game.login('signed-player@example.test','correct-password');
  const old=process.env.FINANCE_ADMIN_ACCOUNT_IDS;process.env.FINANCE_ADMIN_ACCOUNT_IDS=owner.account.id;
  const secret='c'.repeat(64),eventSecret='d'.repeat(64),app=express();installPaymentCredits(app,game.paymentCredits,eventSecret);
  const gameServer=await listen(app);await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');await db.prepare('INSERT INTO accounts VALUES(?)').run(player.account.id);
  const outbox=new PaymentOutbox(db,gameServer.url+'/internal/payments/events',eventSecret),cash=new CryptoStore(db,{...cryptoConfig({}),enabled:true},provider(),outbox.ready,undefined,undefined,v=>outbox.record(v));
  await cash.ready;const paymentServer=await listen(createPaymentApp(cash,secret)),client=new PaymentClient({url:paymentServer.url,requestSecret:secret,eventSecret},game.paymentCredits);
  const op={id:randomUUID(),actorId:owner.account.id,playerId:player.account.id,deltaUnits:'15000000',reason:'Начисление с проверкой доставки'};
  try{
    await Promise.all([client.admin('adjust',owner.account.id,op),client.admin('adjust',owner.account.id,op)]);
    await outbox.flush();assert.equal((await game.paymentCredits.snapshot(player.account.id)).balanceUnits,'15000000');
    assert.equal((await client.admin('report',owner.account.id,{})).totals.adjustments,'15000000');
    await assert.rejects(()=>client.admin('report',player.account.id,{}),(e:any)=>e.status===403);
    await assert.rejects(()=>client.admin('adjust',owner.account.id,{...op,actorId:player.account.id}),(e:any)=>e.status===403);
    assert.equal((await cash.audit()).ok,true);
  }finally{
    if(old===undefined)delete process.env.FINANCE_ADMIN_ACCOUNT_IDS;else process.env.FINANCE_ADMIN_ACCOUNT_IDS=old;
    await paymentServer.close();await gameServer.close();await game.close();await db.close();
  }
});

test('mainnet reports one logical progressive game, uses actual paid payout and reserves coverage during adjustments',async()=>{
  const address=(n:number)=>{const e=createECDH('secp256k1');e.setPrivateKey(Buffer.from(n.toString(16).padStart(64,'0'),'hex'));return nileBase58(nilePublicKeyAddress(e.getPublicKey('hex','uncompressed')));};
  const hash=(n:number)=>n.toString(16).padStart(16,'0')+'a'.repeat(48),player=randomUUID(),actor=randomUUID();
  const ledger=new MainnetLedger(':memory:',{version:1,network:'tron-mainnet',token:MAINNET_USDT_TOKEN,genesis:MAINNET_GENESIS,accountId:player,
    playerAddress:address(41),serviceAddress:address(42),anchorHeight:100,anchorHash:hash(100),openingReserveUnits:'500000000'},()=>0);
  await ledger.ready;const tx='1'.repeat(64);
  try{
    await ledger.ingest({height:101,hash:hash(101),parentHash:hash(100),timestamp:Date.now(),txIds:[tx],outcomes:[{txId:tx,status:'SUCCESS'}],
      transfers:[{txId:tx,logIndex:0,contract:MAINNET_USDT_TOKEN,from:nileHex(address(41)),to:nileHex(address(42)),amountUnits:'10000000'}]});
    await ledger.reconcile(101,'510000000');
    const start={id:randomUUID(),action:'start' as const,gameId:'github-tower' as const,stakeUnits:'1000000',settings:{difficulty:'easy' as const}};
    await ledger.casinoPlay(player,start);
    let report=await ledger.adminReport({kind:'game'});assert.equal(report.totals.count,1);assert.equal(report.totals.ggr,'0');assert.equal(report.rows[0].status,'pending');
    await ledger.casinoPlay(player,{id:randomUUID(),action:'pick',gameId:start.gameId,sessionId:start.id,choice:1});
    const paid=await ledger.casinoPlay(player,{id:randomUUID(),action:'cashout',gameId:start.gameId,sessionId:start.id});
    report=await ledger.adminReport({kind:'game'});assert.equal(report.totals.count,1);assert.equal(report.totals.stakes,'1000000');
    assert.equal(report.totals.payouts,paid.session.payoutUnits);assert.equal(report.totals.ggr,(1000000n-BigInt(paid.session.payoutUnits)).toString());
    const op={id:randomUUID(),actorId:actor,playerId:player,deltaUnits:'2000000',reason:'Корректировка прямого баланса'};
    await ledger.adminAdjust(op,new Set([actor]));await ledger.adminAdjust(op,new Set([actor]));assert.equal((await ledger.adminReport({kind:'adjustment'})).totals.count,1);
    const b=await ledger.audit();assert.equal(b.external,-510000000n);assert.equal(b.house+b.player,510000000n);
  }finally{await ledger.close();}
});

test('admin API requires owner, current account header, same origin and password; controls and audit are durable',async()=>{
  const store=new AccountStore(':memory:');await store.ready;
  const owner=await store.login('owner@example.test','correct-password'),other=await store.login('other@example.test','correct-password');
  const app=express();installFinanceAdmin(app,store,{FINANCE_ADMIN_ACCOUNT_IDS:owner.account.id});
  app.post('/api/nile-play/rounds',(_req,res)=>res.json({ok:true}));const server=await listen(app);
  const call=(path:string,body?:unknown,token=owner.token,headers:Record<string,string>={})=>fetch(server.url+'/api/admin/'+path,{method:body===undefined?'GET':'POST',
    headers:{Cookie:'royal_session='+token,'Content-Type':'application/json',Origin:'http://localhost:5173','x-royal-admin-account':owner.account.id,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await call('session')).status,200);assert.equal((await call('session',undefined,other.token)).status,403);
    assert.equal((await call('session',undefined,'')).status,401);assert.equal((await call('search',{query:'other'},owner.token,{'x-royal-admin-account':other.account.id})).status,403);
    assert.equal((await call('search',{query:'other'},owner.token,{Origin:'https://evil.example'})).status,403);
    const op={id:randomUUID(),source:'nile',action:'block',playerId:other.account.id,reason:'Проверка денежных операций',password:'wrong-password'};
    assert.equal((await call('actions',op)).status,401);op.password='correct-password';
    assert.equal((await call('actions',op)).status,200);assert.equal((await call('actions',op)).status,200);
    assert.equal((await store.financeAdmin.player(other.account.id))!.blocked,true);
    const response=await fetch(server.url+'/api/nile-play/rounds',{method:'POST',headers:{Cookie:'royal_session='+other.token}});assert.equal(response.status,403);
    for(const path of ['/api/nile-play/ROUNDS','/api/nile-play/rounds/'])assert.equal((await fetch(server.url+path,{method:'POST',headers:{Cookie:'royal_session='+other.token}})).status,403);
    const history=await(await call('audit',{page:1,playerId:other.account.id})).json();assert.equal(history.count,2);assert(!JSON.stringify(history).includes('correct-password'));
    await assert.rejects(()=>store.financeAdmin.db.exec('DELETE FROM finance_admin_audit'),/immutable/);
    assert.equal((await call('actions',{...op,id:randomUUID(),action:'unblock'})).status,200);
    assert.equal((await store.financeAdmin.player(other.account.id))!.blocked,false);
    assert.equal((await call('actions',{...op,reason:'Изменённая причина'})).status,409);
  }finally{await server.close();await store.close();}
});
