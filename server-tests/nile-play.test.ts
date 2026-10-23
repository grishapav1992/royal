import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accounts } from '../server/accounts';
import { installNilePlay,playCommand } from '../server/nilePlayRoutes';
import { createNilePlayServer } from '../server/finance/nile-play-service';
import { playTestSetup } from './finance/helpers/nile-play-fixture';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
import { NilePlayLedger } from '../server/finance/nile-play-ledger';
import { block,playTestConfig } from './finance/helpers/nile-play-fixture';
import { customerPool } from './finance/helpers/nile-pool-fixture';

test('real Unix socket bridge uses the session owner, claims once and settles an idempotent test wager',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'nile-play-api-')),socket=process.platform==='win32'?'\\\\.\\pipe\\royal-nile-'+randomUUID():join(directory,'play.sock'),context=(await playTestSetup());
  const financial=createNilePlayServer(context.ledger);await new Promise<void>(resolve=>financial.listen(socket,resolve));
  const app=express();installNilePlay(app,socket);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}/api/nile-play`;
  const owner=await accounts.login(`play-owner-${randomUUID()}@example.test`,'Play-test-password!'),other=await accounts.login(`play-other-${randomUUID()}@example.test`,'Play-test-password!');
  const headers={Cookie:'royal_session='+owner.token,'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:owner.account.id},otherHeaders={...headers,Cookie:'royal_session='+other.token,[WALLET_ACCOUNT_HEADER]:other.account.id},post=(path:string,value:unknown,h: Record<string,string>=headers)=>fetch(endpoint+path,{method:'POST',headers:h,body:JSON.stringify(value)});
  try{
    assert.equal((await fetch(endpoint+'/wallet')).status,401);
    assert.equal((await fetch(endpoint+'/wallet?userId=player',{headers})).status,400);
    assert.equal((await post('/rounds',{id:randomUUID(),stakeUnits:'1000000'},{...headers,Origin:'https://evil.example'})).status,403);
    const code=(await context.ledger.invite('player'));assert.equal((await post('/claim',{code,accountId:other.account.id})).status,400);
    const claim=await post('/claim',{code});assert.equal(claim.status,200);assert.equal((await claim.json()).balanceUnits,'200000000');
    const stolen=await post('/claim',{code},otherHeaders);assert.equal(stolen.status,400);
    const req={id:randomUUID(),stakeUnits:'1000000'};
    assert.equal((await post('/rounds',req,{...headers,Cookie:'royal_session='+other.token})).status,401);
    assert.equal((await context.ledger.audit()).rounds,0);
    assert.equal((await post('/rounds',{...req,payoutUnits:'999999999999'})).status,400);
    assert.equal((await post('/rounds',{...req,accountId:other.account.id})).status,400);
    const win=await post('/rounds',req);assert.equal(win.status,200);assert.equal(win.headers.get('cache-control'),'no-store');const first=await win.json();assert.equal(first.wallet.balanceUnits,'211000000');
    (await context.ledger.failure('source_offline'));const retry=await post('/rounds',req);assert.equal(retry.status,200);const replay=await retry.json();assert.equal(replay.replayed,true);assert.deepEqual(replay.round,first.round);
    assert.equal((await post('/rounds',{id:randomUUID(),stakeUnits:'1000000'})).status,503);
    assert.equal((await post('/rounds',{...req,stakeUnits:'2000000'})).status,409);
    assert.equal((await fetch(endpoint+'/wallet',{headers:otherHeaders})).status,200);
    assert.equal((await (await fetch(endpoint+'/wallet',{headers:otherHeaders})).json()).state,'unassigned');
    assert.equal((await playCommand(socket,owner.account.id,'deposit','100000000')).status,400);
    assert.equal((await playCommand(socket,owner.account.id,'payout','100000000')).status,400);
    assert.equal((await context.ledger.audit()).rounds,1);assert.equal((await context.ledger.audit()).totalUnits,'1000000000');assert.equal((await accounts.wallet.snapshot(owner.account.id)).balance,0);
    (await accounts.logout(owner.token));assert.equal((await fetch(endpoint+'/wallet',{headers})).status,401);
  }finally{(await accounts.logout(other.token));await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>financial.close(()=>resolve()));(await context.close());await rm(directory,{recursive:true,force:true});}
});

test('automatic deposits allocate distinct addresses using authenticated owners and reject caller-selected funding',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'nile-deposit-api-')),socket=process.platform==='win32'?'\\\\.\\pipe\\royal-nile-'+randomUUID():join(directory,'play.sock');
  const config={...playTestConfig,initialReserveUnits:'0'},source=new NileTestLedger(':memory:',config.source,false,customerPool),ledger=new NilePlayLedger(':memory:',config,false,()=>0,customerPool);
  const reconcile=async ()=>{(await source.success());const audit=(await source.audit());(await ledger.sync(source,{ok:true,checked_at:new Date().toISOString(),network:'nile',asset:'USDT_NILE_TEST',testOnly:true,spendable:false,poolSha256:audit.poolSha256??null,credits:audit.credits,liabilitiesUnits:audit.balances.reduce((s,a)=>s+BigInt(a.availableUnits),0n).toString(),deficitUnits:'0'}));};
  (await source.ingest(block(99),true));(await source.ingest(block(100)));(await reconcile());
  const financial=createNilePlayServer(ledger);await new Promise<void>(resolve=>financial.listen(socket,resolve));
  const app=express();installNilePlay(app,socket);const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}/api/nile-play`;
  const owner=await accounts.login(`deposit-owner-${randomUUID()}@example.test`,'Deposit-test-password!'),other=await accounts.login(`deposit-other-${randomUUID()}@example.test`,'Deposit-test-password!');
  const h=(session:typeof owner)=>({Cookie:'royal_session='+session.token,'Content-Type':'application/json',[WALLET_ACCOUNT_HEADER]:session.account.id});
  const post=(data:unknown,headers: Record<string,string>=h(owner))=>fetch(endpoint+'/deposit',{method:'POST',headers,body:JSON.stringify(data)});
  try{
    const attempts=await Promise.all(Array.from({length:8},()=>post({})));assert.ok(attempts.every(r=>r.status===200));
    const wallets=await Promise.all(attempts.map(r=>r.json()));assert.equal(new Set(wallets.map(w=>w.address)).size,1);assert.equal((await ledger.audit()).autoBindings,1);
    const otherWallet=await(await post({},h(other))).json();assert.notEqual(otherWallet.address,wallets[0].address);assert.equal(wallets[0].balanceUnits,'0');
    for(const data of [{amountUnits:'1000000000'},{userId:'player'},{accountId:other.account.id},{address:otherWallet.address}])assert.equal((await post(data)).status,400);
    assert.equal((await post({},{...h(owner),Cookie:'royal_session='+other.token})).status,401);
    assert.equal((await post({},{...h(owner),Origin:'https://evil.example'})).status,403);
    (await source.ingest(block(101,'1000000000',config.source.addresses[1].address)));(await source.ingest(block(102,'100000000',customerPool.addresses[0].address)));(await reconcile());(await reconcile());
    const wallet=await(await fetch(endpoint+'/wallet',{headers:h(owner)})).json();assert.equal(wallet.balanceUnits,'100000000');assert.equal(wallet.deposits.length,1);
    assert.equal((await(await fetch(endpoint+'/wallet',{headers:h(other)})).json()).balanceUnits,'0');
    const request={id:randomUUID(),stakeUnits:'1000000'},spin=()=>fetch(endpoint+'/rounds',{method:'POST',headers:h(owner),body:JSON.stringify(request)});
    assert.equal((await spin()).status,200);assert.equal((await(await spin()).json()).replayed,true);assert.equal((await ledger.audit()).rounds,1);
  }finally{(await accounts.logout(owner.token));(await accounts.logout(other.token));await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>financial.close(()=>resolve()));(await source.close());(await ledger.close());await rm(directory,{recursive:true,force:true});}
});
