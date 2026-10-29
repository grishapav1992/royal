import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pvpFixture} from './finance/helpers/nile-pvp-fixture';
import {block} from './finance/helpers/nile-play-fixture';
import {createNilePlayServer} from '../server/finance/nile-play-service';
import {NileGameRuntime} from '../server/finance/nile-game-runtime';
import {TEMPLE_GAME,TEMPLE_CLIENT_HEADER,validTempleSession} from '../src/shared/floodedTemple';
import {validCascadeSession} from '../src/shared/floodedTempleCascade';
import {CASCADE_DATA} from '../src/shared/floodedTempleCascadeMath';
process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installGameWallet}=await import('../server/gameWalletRoutes');
test.after(async()=>{await accounts.close();});

test('the real common-wallet HTTP route restores the Temple and preserves protocol, money and operation identity',{timeout:45000},async()=>{
  const login=await accounts.login('temple-http-'+randomUUID()+'@example.test','Temple-local-test-42!');
  const c=await pvpFixture([login.account.id,randomUUID()]);
  const socket=process.platform==='win32'?'\\\\.\\pipe\\royal-temple-http-'+randomUUID():join(tmpdir(),'royal-temple-'+randomUUID()+'.sock');
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  // Seed one accepted bonus through the real runtime; HTTP then resumes it without future entropy.
  const values=[0,0,0,98,0,0];const seeded=new NileGameRuntime(c.ledger,()=>values.shift()!);
  const start={id:randomUUID(),action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'normal'}}};
  await seeded.run(c.a,{path:'/expansion',body:start,method:'POST',flags:Array(9).fill(false),rules:2,query:{},templeRules:1});
  const finance=createNilePlayServer(c.ledger);await new Promise<void>(resolve=>finance.listen(socket,resolve));
  const app=express();installGameWallet(app,socket);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/game-wallet/expansion`;
  const headers={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json',[TEMPLE_CLIENT_HEADER]:'1'};
  const post=(body:unknown,current=true)=>fetch(url,{method:'POST',headers:current?headers:{...headers,[TEMPLE_CLIENT_HEADER]:'0'},body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{...headers,'X-Royal-Account-Id':randomUUID()}})).status,401);
    assert.equal((await post(start,false)).status,409);
    const hidden=await(await fetch(url,{headers:{...headers,[TEMPLE_CLIENT_HEADER]:'0'}})).json();assert(!hidden.sessions.some((s:any)=>s.gameId===TEMPLE_GAME));
    const active=await(await fetch(url,{headers})).json();let session=active.sessions.find((s:any)=>s.id===start.id);assert(validTempleSession(session));
    let last:any,reply:any;
    for(const [to,rope]of [[6,false],[11,false],[12,true],[13,false],[8,false],[9,false]]as const){
      last={id:randomUUID(),action:'move',gameId:TEMPLE_GAME,sessionId:start.id,revision:session.view.temple.revision,move:rope?'temple-rope':'temple-step',picks:[to]};
      const response=await post(last);assert.equal(response.status,200);reply=await response.json();session=reply.session;assert(validTempleSession(session));
    }
    assert.equal(reply.wallet.asset,'USDT_NILE_TEST');assert.equal(reply.wallet.balanceUnits,'207500000');assert.equal(reply.wallet.reservedUnits,'0');
    const repeated=await(await post(last)).json();assert(repeated.replayed);assert.deepEqual(repeated.session,session);assert.equal(repeated.wallet.balanceUnits,reply.wallet.balanceUnits);
    const fresh={...start,id:randomUUID()},response=await post(fresh);assert.equal(response.status,200);let freshReply=await response.json();assert(validTempleSession(freshReply.session));
    if(freshReply.session.state==='active')freshReply=await(await post({id:randomUUID(),action:'move',gameId:TEMPLE_GAME,sessionId:fresh.id,revision:1,move:'temple-finish'})).json();
    const expected=207500000n-10000000n+BigInt(freshReply.session.returnedUnits)*10000n;
    assert.equal(freshReply.wallet.balanceUnits,String(expected));assert(validTempleSession(freshReply.session));await c.ledger.audit();
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>finance.close(()=>resolve()));await c.close();}
});

test('cascade rules 2 resume through real HTTP and the common financial service without leaking to rules 1',{timeout:60000},async()=>{
  const login=await accounts.login('temple-cascade-http-'+randomUUID()+'@example.test','Temple-local-test-42!'),c=await pvpFixture([login.account.id,randomUUID()]);
  const socket=process.platform==='win32'?'\\\\.\\pipe\\royal-cascade-http-'+randomUUID():join(tmpdir(),'royal-cascade-'+randomUUID()+'.sock');
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  const stops:number[]=[];for(let col=0;col<5;col++)for(let row=2;row>=0;row--){const symbol=col<3?8:(col*3+row)%7;stops.push(CASCADE_DATA.baseReels[col].slice(0,symbol).reduce((a,b)=>a+b,0));}
  let v=73191;const seeded=new NileGameRuntime(c.ledger,max=>stops.length?stops.shift()!:(v=(Math.imul(v,1664525)+1013904223)>>>0)%max);
  const op={id:randomUUID(),action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'cascades'}}};
  const initial=BigInt((await c.ledger.wallet(c.a)as any).balanceUnits);
  await seeded.run(c.a,{path:'/expansion',body:op,method:'POST',flags:Array(9).fill(false),rules:2,query:{},templeRules:2});
  const finance=createNilePlayServer(c.ledger);await new Promise<void>(resolve=>finance.listen(socket,resolve));
  const app=express();installGameWallet(app,socket);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/game-wallet/expansion`;
  const headers={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json',[TEMPLE_CLIENT_HEADER]:'2'};
  const post=(body:unknown,version='2')=>fetch(url,{method:'POST',headers:{...headers,[TEMPLE_CLIENT_HEADER]:version},body:JSON.stringify(body)});
  try{
    const hidden=await(await fetch(url,{headers:{...headers,[TEMPLE_CLIENT_HEADER]:'1'}})).json();assert(!hidden.sessions.some((s:any)=>s.id===op.id));
    assert.equal((await post(op,'1')).status,409);
    let s=(await(await fetch(url,{headers})).json()).sessions.find((s:any)=>s.id===op.id);assert(validCascadeSession(s));assert.equal(s.state,'active');
    let last:any,reply:any;
    while(s.state==='active'){
      last={id:randomUUID(),action:'move',gameId:TEMPLE_GAME,sessionId:op.id,revision:s.view.templeCascade.revision,move:'temple-cascade'};
      const response=await post(last);assert.equal(response.status,200);reply=await response.json();s=reply.session;assert(validCascadeSession(s));
    }
    assert.equal(reply.wallet.balanceUnits,String(initial-10000000n+BigInt(s.returnedUnits)*10000n));assert.equal(reply.wallet.reservedUnits,'0');
    const repeated=await(await post(last)).json();assert(repeated.replayed);assert.deepEqual(repeated.session,s);assert.equal(repeated.wallet.balanceUnits,reply.wallet.balanceUnits);
    await c.ledger.audit();
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>finance.close(()=>resolve()));await c.close();}
});
