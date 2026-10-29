import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {DemoExpansionStore} from '../server/demoExpansion';
import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts';
import {CASCADE_DATA} from '../src/shared/floodedTempleCascadeMath';
import {validCascadeSession} from '../src/shared/floodedTempleCascade';
// @ts-ignore independent mathematical fixture source.
import {cascadeRandom} from '../scripts/game-math/rtp-temple-cascade-model.mjs';

const start=(stake='1000')=>({id:randomUUID(),action:'start',gameId:'studio-flooded-temple',stakeUnits:stake,settings:{temple:{mode:'cascades'}}});
const next=(s:any)=>({id:randomUUID(),action:'move',gameId:s.gameId,sessionId:s.id,revision:s.view.templeCascade.revision,move:'temple-cascade'});
async function fixture(){
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('a'),('b')");
  const wallet=new DemoWalletStore(db);await wallet.operate('a',{id:randomUUID(),kind:'deposit',amount:10000});await wallet.expansion.ready;
  let count=0,queue:number[]=[],random=cascadeRandom(713029);
  const draw=(max:number)=>{count++;const value=queue.length?queue.shift()!:random(max);assert(value<max);return value;};
  const create=()=>new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},draw);
  const run=(s:DemoExpansionStore,op:unknown,cap:boolean|2=2,account='a')=>s.operate(account,op,2,true,true,true,true,true,true,true,true,2,4,true,false,cap);
  const bonus=()=>{queue=[];for(let c=0;c<5;c++)for(let r=2;r>=0;r--){const symbol=c<3?8:(c*3+r)%7;queue.push(CASCADE_DATA.baseReels[c].slice(0,symbol).reduce((a,b)=>a+b,0));}};
  return {db,wallet,create,run,bonus,count:()=>count,set:(values:number[])=>{queue=values.slice();}};
}
test('v2 bonus restores across stores, hides from legacy readers, retries once and settles through the common wallet',async()=>{
  const f=await fixture();try{
    const store=f.create(),before=await demoBalanceUnits(f.db,'a'),op=start();f.bonus();
    await assert.rejects(f.run(store,op,true));assert.equal(f.count(),0);
    const replies=await Promise.all(Array.from({length:4},()=>f.run(store,op)));let s=replies[0].session;
    assert(replies.every(r=>validCascadeSession(r.session)));assert.equal(s.state,'active');assert.equal(await demoBalanceUnits(f.db,'a'),before-1000);assert(await demoReservedUnits(f.db,'a')>0);
    const draws=f.count();await f.run(store,op);assert.equal(f.count(),draws);
    const restored=f.create();assert(!(await restored.active('a',true,true,true,true,true,true,true,2,4,true,false,true)).sessions.some(s=>s.id===op.id));
    s=(await restored.active('a',true,true,true,true,true,true,true,2,4,true,false,2)).sessions.find(s=>s.id===op.id)!;assert(validCascadeSession(s));
    await assert.rejects(f.run(restored,start()));await assert.rejects(f.run(restored,next(s),true));await assert.rejects(f.run(restored,next(s),2,'b'));assert.equal(f.count(),draws);
    const first=next(s),racing=await Promise.allSettled([f.run(restored,first),f.run(restored,{...first,id:randomUUID()})]);assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);
    s=(racing.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value.session;
    let last=first;
    while(s.state==='active'){last=next(s);s=(await f.run(restored,last)).session;assert(validCascadeSession(s));}
    const final=before-1000+Number(s.returnedUnits);assert.equal(await demoBalanceUnits(f.db,'a'),final);assert.equal(await demoReservedUnits(f.db,'a'),0);
    const replay=await f.run(restored,last);assert(replay.replayed);assert.equal(await demoBalanceUnits(f.db,'a'),final);
    const ledger=await f.db.prepare("SELECT kind,count(*) AS n FROM demo_ledger WHERE account_id='a' AND kind IN ('bet','win') GROUP BY kind").all();
    assert.deepEqual(ledger.map(r=>[r.kind,Number(r.n)]).sort(),[['bet',1],['win',1]]);
  }finally{await f.db.close();}
});
test('all v2 stakes cap and credit once; invalid settings and amended UUIDs never redraw',async()=>{
  const f=await fixture();try{
    const store=f.create();let expected=await demoBalanceUnits(f.db,'a');
    await assert.rejects(f.run(store,{...start(),settings:{temple:{mode:'cascades',buy:true}}}));assert.equal(f.count(),0);
    for(const stake of CASCADE_DATA.stakes){
      f.set(Array(15).fill(0));const op=start(String(stake)),reply=await f.run(store,op);assert(validCascadeSession(reply.session));assert.equal(reply.session.returnedUnits,String(stake*500));expected+=stake*499;
      const count=f.count();await f.run(store,op);assert.equal(f.count(),count);assert.equal(await demoBalanceUnits(f.db,'a'),expected);await assert.rejects(f.run(store,{...op,stakeUnits:'2000',settings:{temple:{mode:'normal'}}}));assert.equal(f.count(),count);
    }
  }finally{await f.db.close();}
});
test('a v2-capable reader finishes an accepted v1 expedition and a financial failure leaves v2 recoverable',async()=>{
  const f=await fixture();try{
    const store=f.create();f.set([0,0,0,98,0,0]);
    const legacy=await f.run(store,{...start(),settings:{temple:{mode:'normal'}}},true);
    const visible=await store.active('a',true,true,true,true,true,true,true,2,4,true,false,2);assert(visible.sessions.some(s=>s.id===legacy.session.id&&s.rulesVersion===1));
    await f.run(store,{id:randomUUID(),action:'move',gameId:'studio-flooded-temple',sessionId:legacy.session.id,revision:1,move:'temple-finish'});
    f.bonus();let s=(await f.run(store,start())).session;
    while(s.state==='active'){
      const op=next(s),before=await demoBalanceUnits(f.db,'a');
      await f.db.exec("CREATE OR REPLACE FUNCTION reject_cascade_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='win' THEN RAISE EXCEPTION 'cascade final credit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_cascade BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_cascade_fn()");
      try{s=(await f.run(store,op)).session;await f.db.exec('DROP TRIGGER reject_cascade ON demo_ledger');}
      catch(error){assert.match(String(error),/cascade final credit failure/);assert.equal(await demoBalanceUnits(f.db,'a'),before);const active=await store.active('a',true,true,true,true,true,true,true,2,4,true,false,2);assert.equal(active.sessions.find(x=>x.id===s.id)!.view.templeCascade!.revision,s.view.templeCascade!.revision);await f.db.exec('DROP TRIGGER reject_cascade ON demo_ledger');s=(await f.run(store,op)).session;assert((await f.run(store,op)).replayed);while(s.state==='active')s=(await f.run(store,next(s))).session;break;}
    }
    assert.equal(s.state,'settled');assert.equal(await demoReservedUnits(f.db,'a'),0);
  }finally{await f.db.close();}
});
