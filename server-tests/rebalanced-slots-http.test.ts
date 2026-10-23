import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {seededRandom} from '../src/shared/draconaMath';
import {NEOPOLIS_GAME,NEOPOLIS_HEADER,validNeopolisSession} from '../src/shared/neopolis';
import {DRACONA_GAME,DRACONA_CLIENT_HEADER,validDraconaSession} from '../src/shared/dracona';
process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installDemoWallet}=await import('../server/demoWalletRoutes');

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
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await accounts.close();}
});
