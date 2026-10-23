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
import {seededRandom} from '../src/shared/draconaMath';
import {NEOPOLIS_GAME,NEOPOLIS_HEADER,validNeopolisSession} from '../src/shared/neopolis';
import {DRACONA_GAME,DRACONA_CLIENT_HEADER,validDraconaSession} from '../src/shared/dracona';
process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installDemoWallet}=await import('../server/demoWalletRoutes');
const {installGameWallet}=await import('../server/gameWalletRoutes');
test.after(async()=>{await accounts.close();});

test('real wallet HTTP negotiates new rules, protects old clients and settles both complete bonuses once',{timeout:45000},async()=>{
  const app=express();installDemoWallet(app);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/api/demo-wallet/expansion`;
  try {
    const login=await accounts.login('rtp-http-'+randomUUID()+'@example.test','Rtp-http-test-42!');
    await accounts.wallet.operate(login.account.id,{id:randomUUID(),kind:'deposit',amount:10000});
    const base={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json','X-Royal-Card-Rules':'2'};
    for(const game of [NEOPOLIS_GAME,DRACONA_GAME]) {
      const neopolis=game===NEOPOLIS_GAME, header=neopolis?NEOPOLIS_HEADER:DRACONA_CLIENT_HEADER;
      const current=neopolis?'3':'2', old=neopolis?'2':'1', random=seededRandom(neopolis?95:1);
      Reflect.set(accounts.wallet.expansion,'draw',(max:number)=>Math.floor(random()*max));
      const post=(body:unknown,version=current)=>fetch(url,{method:'POST',headers:{...base,[header]:version},body:JSON.stringify(body)});
      const start=()=>({id:randomUUID(),action:'start',gameId:game,stakeUnits:'10000',settings:neopolis?{neopolis:{hero:'granite'}}:{dracona:{mode:'normal'}}});
      const before=await accounts.wallet.snapshot(login.account.id);
      assert.equal((await post(start(),old)).status,409);
      assert.deepEqual(await accounts.wallet.snapshot(login.account.id),before);
      let reply:any;
      for(let i=0;i<35;i++) {
        const op=start(),response=await post(op);assert.equal(response.status,200);reply=await response.json();
        assert.equal(reply.session.rulesVersion,3);assert((neopolis?validNeopolisSession:validDraconaSession)(reply.session));
        assert.equal((await post(op,old)).status,409,'Old clients cannot replay a new-rules receipt');
        if(reply.session.state==='active')break;
      }
      assert.equal(reply.session.state,'active');
      const get=async(version:string)=>(await fetch(url,{headers:{...base,[header]:version}})).json();
      assert.equal((await get(old)).sessions.some((s:any)=>s.gameId===game),false);
      assert.equal((await get(current)).sessions.find((s:any)=>s.gameId===game).id,reply.session.id);
      const bonusBalance=reply.wallet.balance, id=reply.session.id;
      let op:any;
      while(reply.session.state==='active') {
        const view=reply.session.view[neopolis?'neopolis':'dracona'];
        op={id:randomUUID(),action:'move',gameId:game,sessionId:id,move:neopolis?'neopolis-spin':'dracona-spin',revision:view.revision};
        assert.equal((await post(op,old)).status,409);
        const response=await post(op);assert.equal(response.status,200);reply=await response.json();
        assert((neopolis?validNeopolisSession:validDraconaSession)(reply.session));
        if(reply.session.state==='active')assert.equal(reply.wallet.balance,bonusBalance);
      }
      assert.equal(reply.wallet.balance,bonusBalance+Number(reply.session.returnedUnits)/100);
      const repeat=await (await post(op)).json();assert.equal(repeat.replayed,true);assert.deepEqual(repeat.session,reply.session);assert.equal(repeat.wallet.balance,reply.wallet.balance);
    }
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('current USDT HTTP route forwards Dracona rules through its financial socket and leaves the prototype unpublished',{timeout:45000},async()=>{
  const login=await accounts.login('nile-slot-http-'+randomUUID()+'@example.test','Rtp-http-test-42!');
  const c=await pvpFixture([login.account.id,randomUUID()]);
  const socket=process.platform==='win32'?'\\\\.\\pipe\\royal-slot-http-'+randomUUID():join(tmpdir(),'royal-slot-'+randomUUID()+'.sock');
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  const finance=createNilePlayServer(c.ledger);await new Promise<void>(resolve=>finance.listen(socket,resolve));
  const app=express();installGameWallet(app,socket);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/api/game-wallet/expansion`;
  const base={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json','X-Royal-Card-Rules':'2'};
  const post=(body:unknown,version='2')=>fetch(url,{method:'POST',headers:{...base,[DRACONA_CLIENT_HEADER]:version},body:JSON.stringify(body)});
  try {
    const action={id:randomUUID(),action:'start',gameId:DRACONA_GAME,stakeUnits:'1000',settings:{dracona:{mode:'normal'}}};
    assert.equal((await post(action,'1')).status,409);
    const response=await post(action);assert.equal(response.status,200);let reply=await response.json();
    assert.equal(reply.wallet.asset,'USDT_NILE_TEST');assert.equal(reply.session.rulesVersion,3);assert(validDraconaSession(reply.session));
    assert.equal((await post(action,'1')).status,409);
    const initial=reply.wallet.balance;let last:unknown=action;
    while(reply.session.state==='active') {
      last={id:randomUUID(),action:'move',gameId:DRACONA_GAME,sessionId:reply.session.id,move:'dracona-spin',revision:reply.session.view.dracona.revision};
      const next=await post(last);assert.equal(next.status,200);reply=await next.json();assert(validDraconaSession(reply.session));
      if(reply.session.state==='active')assert.equal(reply.wallet.balance,initial);
    }
    assert.equal(reply.wallet.balanceUnits,String(200000000n-10000000n+BigInt(reply.session.returnedUnits)*10000n));
    const repeat=await(await post(last)).json();assert.equal(repeat.replayed,true);assert.equal(repeat.wallet.balanceUnits,reply.wallet.balanceUnits);
    assert.equal((await post({...action,id:randomUUID(),gameId:NEOPOLIS_GAME,settings:{neopolis:{hero:'granite'}}})).status,409);
    assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,reply.wallet.balanceUnits);await c.ledger.audit();
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>finance.close(()=>resolve()));await c.close();}
});
