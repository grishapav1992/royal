import {installFlagToteRoutes} from '../server/flagToteRoutes';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { validToteSnapshot } from '../src/shared/flagTote';
process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { installDemoWallet } = await import('../server/demoWalletRoutes');
test.after(async () => { await accounts.close(); });

test('real wallet HTTP protects origin, cookie, account and rules; lost reply replays the same ticket and refund', async () => {
  let now=900001; Reflect.set(accounts.wallet.tote,'now',()=>now);
  const app=express();installDemoWallet(app);const stop=installFlagToteRoutes(app,accounts.wallet.tote),server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const url='http://127.0.0.1:'+address.port+'/api/demo-wallet/flag-tote';
  try{
    const a=await accounts.login('tote-'+randomUUID()+'@example.test','Royal-tote-test-42!');
    const b=await accounts.login('tote-'+randomUUID()+'@example.test','Royal-tote-test-42!');
    await accounts.wallet.operate(a.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
    const headers={'Cookie':'royal_session='+a.token,'X-Royal-Account-Id':a.account.id,'X-Royal-Flag-Tote':'1','Content-Type':'application/json'};
    const post=(op:unknown,extra:Record<string,string>={})=>fetch(url,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(op)});
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{...headers,'X-Royal-Account-Id':b.account.id}})).status,401);
    assert.equal((await fetch(url,{headers:{...headers,Origin:'https://attacker.invalid'}})).status,403);
    assert.equal((await fetch(url,{headers:{...headers,'X-Royal-Flag-Tote':'0'}})).status,409);
    assert.equal((await fetch(url+'?seed=1',{headers})).status,400);
    const snapshot=await(await fetch(url,{headers})).json();assert(validToteSnapshot(snapshot));
    const op={id:randomUUID(),roundId:snapshot.round.id,rulesVersion:1,country:'FR',stakeUnits:'100'};
    assert.equal((await post({...op,winner:'FR'})).status,400);
    assert.equal((await post(op)).status,200);
    const replay=await(await post(op)).json();assert(replay.replayed);assert(validToteSnapshot(replay));assert.equal(replay.wallet.balance,999);assert.equal(replay.tickets.length,1);
    assert.equal((await post({...op,country:'BR'})).status,409);
    const otherHeaders={...headers,Cookie:'royal_session='+b.token,'X-Royal-Account-Id':b.account.id};
    const other=await(await fetch(url,{headers:otherHeaders})).json();assert.equal(other.tickets.length,0);
    assert.equal((await post(op,otherHeaders)).status,409);
    now=snapshot.round.closesAt;
    const refund=await(await fetch(url,{headers})).json();assert(validToteSnapshot(refund));assert.equal(refund.round.state,'refunded');assert.equal(refund.wallet.balance,1000);assert.equal(refund.tickets[0].payoutUnits,'100');
    assert.equal((await post({...op,id:randomUUID()})).status,409);
    const settledReplay=await(await post(op)).json();assert(settledReplay.replayed);assert.equal(settledReplay.wallet.balance,1000);
    assert.equal(settledReplay.wallet.entries.filter((e:any)=>e.source==='flag-tote'&&e.kind==='bet').length,1);
  }finally{stop();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
