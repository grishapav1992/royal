import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FOREST_HEART_GAME,FOREST_HEART_CLIENT_HEADER,validForestHeartSession} from '../src/shared/forestHeart';
import {createNilePlayServer} from '../server/finance/nile-play-service';
import {pvpFixture} from './finance/helpers/nile-pvp-fixture';
import {block} from './finance/helpers/nile-play-fixture';
process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installDemoWallet}=await import('../server/demoWalletRoutes');
const {installGameWallet}=await import('../server/gameWalletRoutes');
test.after(async()=>{await accounts.close();});

test('real common-wallet HTTP binds the account, negotiates rules and restores a complete Forest Heart series once',{timeout:45000},async()=>{
  const app=express();installDemoWallet(app);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');
  const url='http://127.0.0.1:'+address.port+'/api/demo-wallet/expansion';
  try{
    const login=await accounts.login('forest-http-'+randomUUID()+'@example.test','Forest-http-test-42!');
    const other=await accounts.login('forest-other-'+randomUUID()+'@example.test','Forest-http-test-42!');
    await accounts.wallet.operate(login.account.id,{id:randomUUID(),kind:'deposit',amount:10000});
    const headers={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json',[FOREST_HEART_CLIENT_HEADER]:'1'};
    const action={id:randomUUID(),action:'start',gameId:FOREST_HEART_GAME,stakeUnits:'1000',settings:{forestHeart:{mode:'normal'}}};
    const post=(body:unknown,extra:Record<string,string>={})=>fetch(url,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
    let count=0;const values=[0,0,0,0,...Array.from({length:4},()=>[132,0]).flat()];
    Reflect.set(accounts.wallet.expansion,'draw',(max:number)=>{count++;const value=values.shift();assert(value!==undefined&&value>=0&&value<max);return value;});
    assert.equal((await post(action,{'Cookie':''})).status,401);
    assert.equal((await post(action,{'X-Royal-Account-Id':other.account.id})).status,401);
    assert.equal((await post(action,{'Origin':'https://attacker.invalid'})).status,403);
    assert.equal((await post(action,{[FOREST_HEART_CLIENT_HEADER]:'0'})).status,409);
    assert.equal((await post({...action,payoutUnits:'99999999'})).status,400);assert.equal(count,0);
    // First accepted response is deliberately not consumed before its retry.
    const accepted=await post(action);assert.equal(accepted.status,200);
    let reply=await(await post(action)).json();assert(reply.replayed);assert.equal(count,4);
    assert(validForestHeartSession(reply.session));assert.equal(reply.wallet.balance,9990);
    assert.equal(reply.session.view.forestHeart.stage,'choice');assert.deepEqual(reply.session.view.forestHeart.bonus,[]);
    assert.equal('engine'in reply.session,false);
    const hidden=await(await fetch(url,{headers:{...headers,[FOREST_HEART_CLIENT_HEADER]:'0'}})).json();
    assert(!hidden.sessions.some((s:any)=>s.id===action.id));
    const restored=await(await fetch(url,{headers})).json();assert.deepEqual(restored.sessions.find((s:any)=>s.id===action.id),reply.session);
    const choose={id:randomUUID(),action:'move',gameId:FOREST_HEART_GAME,sessionId:action.id,move:'forest-turn-2',revision:1};
    assert.equal((await post(choose,{'Cookie':'royal_session='+other.token,'X-Royal-Account-Id':other.account.id})).status,404);
    reply=await(await post(choose)).json();assert(validForestHeartSession(reply.session));assert.equal(count,4);
    assert.equal((await post({...choose,id:randomUUID()})).status,409);
    let last:any=choose;
    while(reply.session.state==='active'){
      last={id:randomUUID(),action:'move',gameId:FOREST_HEART_GAME,sessionId:action.id,move:'forest-spin',revision:reply.session.view.forestHeart.revision};
      const response=await post(last);assert.equal(response.status,200);reply=await response.json();assert(validForestHeartSession(reply.session));
      if(reply.session.state==='active')assert.equal(reply.wallet.balance,9990);
    }
    assert.equal(reply.session.returnedUnits,'8834');assert.equal(reply.wallet.balance,10078.34);assert.equal(count,12);
    const repeat=await(await post(last)).json();assert(repeat.replayed);assert.equal(repeat.wallet.balance,10078.34);assert.equal(count,12);
    assert.equal((await post(last,{[FOREST_HEART_CLIENT_HEADER]:'0'})).status,409);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('financial-socket HTTP preserves old command compatibility and exact common cents for Forest Heart',{timeout:45000},async()=>{
  const login=await accounts.login('forest-finance-'+randomUUID()+'@example.test','Forest-http-test-42!');
  const c=await pvpFixture([login.account.id,randomUUID()]);
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));
  await c.ledger.sync(c.source,await c.reconciliation());
  const socket=process.platform==='win32'?'\\\\.\\pipe\\royal-forest-'+randomUUID():join(tmpdir(),'royal-forest-'+randomUUID()+'.sock');
  const finance=createNilePlayServer(c.ledger);await new Promise<void>(resolve=>finance.listen(socket,resolve));
  const app=express();installGameWallet(app,socket);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');
  const url='http://127.0.0.1:'+address.port+'/api/game-wallet/expansion';
  const headers={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json',[FOREST_HEART_CLIENT_HEADER]:'1'};
  const post=(body:unknown,version='1')=>fetch(url,{method:'POST',headers:{...headers,[FOREST_HEART_CLIENT_HEADER]:version},body:JSON.stringify(body)});
  try{
    const action={id:randomUUID(),action:'start',gameId:FOREST_HEART_GAME,stakeUnits:'1000',settings:{forestHeart:{mode:'normal'}}};
    assert.equal((await post(action,'0')).status,409);
    const response=await post(action);assert.equal(response.status,200);let reply=await response.json(),last:any=action;
    assert(validForestHeartSession(reply.session));assert.equal(reply.wallet.asset,'USDT_NILE_TEST');
    const old=await(await fetch(url,{headers:{...headers,[FOREST_HEART_CLIENT_HEADER]:'0'}})).json();assert(!old.sessions.some((s:any)=>s.id===action.id));
    while(reply.session.state==='active'){
      const view=reply.session.view.forestHeart;
      last={id:randomUUID(),action:'move',gameId:FOREST_HEART_GAME,sessionId:action.id,move:view.stage==='choice'?'forest-pass':'forest-spin',revision:view.revision};
      const next=await post(last);assert.equal(next.status,200);reply=await next.json();assert(validForestHeartSession(reply.session));
    }
    const expected=200000000n-10000000n+BigInt(reply.session.returnedUnits)*10000n;
    assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');
    const replay=await(await post(last)).json();assert(replay.replayed);assert.equal(replay.wallet.balanceUnits,String(expected));
    assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,String(expected));await c.ledger.audit();
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>finance.close(()=>resolve()));await c.close();
  }
});
