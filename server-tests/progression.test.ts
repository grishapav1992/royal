import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { ProgressionStore } from '../server/progression/store';
import { LEGACY_PROGRESSION_POLICY as DEFAULT_PROGRESSION_POLICY, validProgressionSnapshot } from '../src/shared/progression';

function testPolicy() { const p=structuredClone(DEFAULT_PROGRESSION_POLICY);p.version='test-policy-v1';p.levels.forEach((l,i)=>l.xp=String(i*100));return p; }
async function fixture(policy=testPolicy()) {
  const db=new PostgresDatabase(':memory:'),account=randomUUID();
  const store=new ProgressionStore(db,{policy,now:()=>1000});await store.ready;
  const context=(id=randomUUID(),sourceType:'paid-game'|'pvp'='paid-game')=>({sourceType,sourceId:id,accountId:account,locationId:'south-park',gameId:'royal-coins',environment:'VIRTUAL_USD',fundingSource:'cash' as const,acceptedAt:1000});
  const earn=async(paid:string,id=randomUUID(),sourceType:'paid-game'|'pvp'='paid-game')=>{
    const c=context(id,sourceType);await store.acceptRound(c);
    await store.recordSettled({sourceType,sourceId:id,accountId:account,paidUnits:paid,refundedUnits:'0',settledAt:1100,outcome:'settled'});
    return c;
  };
  return {db,store,account,context,earn,close:()=>db.close()};
}
test('all players start at 1; multi-level settlement grants each milestone exactly once across retries and restart',async()=>{
  const f=await fixture();try{
    assert.equal((await f.store.snapshot(f.account)).level,1);
    const c=await f.earn('10000000');
    const first=await f.store.snapshot(f.account);
    assert.equal(first.xp,'1000');assert.equal(first.level,11);assert.deepEqual(first.grants.map(g=>g.level),[5,10]);
    assert(validProgressionSnapshot(first));
    await f.store.acceptRound(c);
    await f.store.recordSettled({sourceType:c.sourceType,sourceId:c.sourceId,accountId:f.account,paidUnits:'10000000',refundedUnits:'0',settledAt:1200,outcome:'settled'});
    const reopened=new ProgressionStore(f.db,{policy:testPolicy(),now:()=>9999});await reopened.ready;
    assert.deepEqual(await reopened.snapshot(f.account),first);
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS n FROM progression_xp').get())!.n),1);
  }finally{await f.close();}
});
test('tiny stakes accumulate exact fractional XP across differently weighted sources',async()=>{
  const policy=testPolicy();policy.coefficients.pvp={numerator:1,denominator:3};
  const f=await fixture(policy);try{
    for(let i=0;i<3;i++)await f.earn('10000',randomUUID(),'pvp');
    await f.earn('9999');
    assert.equal((await f.store.snapshot(f.account)).xp,'1');
    await f.earn('1');assert.equal((await f.store.snapshot(f.account)).xp,'2');
  }finally{await f.close();}
});
test('reward funding, wrong locations/environments, old rounds and deposits cannot create XP',async()=>{
  const f=await fixture();try{
    for(const changes of [{fundingSource:'reward' as const},{locationId:'other-place'},{environment:'USDT_NILE_TEST'},{acceptedAt:999}])
      assert.equal(await f.store.acceptRound({...f.context(),...changes}),false);
    assert.equal(await f.store.recordSettled({sourceType:'paid-game',sourceId:randomUUID(),accountId:f.account,paidUnits:'10000000',refundedUnits:'0',settledAt:1100,outcome:'settled'}),false);
    assert.equal((await f.store.snapshot(f.account)).xp,'0');
  }finally{await f.close();}
});
test('refunds remove only cancelled paid value, not ordinary winning returns; conflicting settlements are rejected',async()=>{
  const f=await fixture();try{
    const c=f.context();await f.store.acceptRound(c);
    const e={sourceType:c.sourceType,sourceId:c.sourceId,accountId:f.account,paidUnits:'10000000',refundedUnits:'2000000',settledAt:1100,outcome:'settled' as const};
    await f.store.recordSettled(e);assert.equal((await f.store.snapshot(f.account)).xp,'800');
    await assert.rejects(f.store.recordSettled({...e,paidUnits:'20000000'}),/conflict/);
    await assert.rejects(f.store.recordSettled({...e,refundedUnits:'20000000'}),/Invalid/);
    const cancelled=f.context();await f.store.acceptRound(cancelled);
    await f.store.recordSettled({...e,sourceId:cancelled.sourceId,refundedUnits:e.paidUnits,outcome:'refunded'});
    assert.equal((await f.store.snapshot(f.account)).xp,'800');
  }finally{await f.close();}
});
test('concurrent consumers preserve XP and grant identity; failed processing rolls back XP and delivery acknowledgment',async()=>{
  const f=await fixture();try{
    await Promise.all(Array.from({length:8},()=>f.earn('1000000')));
    await Promise.all([f.store.processPending(),f.store.processPending(),f.store.processPending()]);
    assert.equal((await f.store.snapshot(f.account)).xp,'800');
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS n FROM progression_rewards').get())!.n),1);
    await f.earn('1000000');
    await f.db.exec(`CREATE FUNCTION fail_progression_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected XP failure'; END $$;
      CREATE TRIGGER fail_progression_test BEFORE INSERT ON progression_xp FOR EACH ROW EXECUTE FUNCTION fail_progression_test();`);
    await assert.rejects(f.store.processPending(),/injected XP failure/);
    assert.equal((await f.db.prepare('SELECT xp FROM progression_players').get())!.xp,'800');
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS n FROM progression_outbox WHERE NOT processed').get())!.n),1);
    await f.db.exec('DROP TRIGGER fail_progression_test ON progression_xp; DROP FUNCTION fail_progression_test()');
    assert.equal((await f.store.snapshot(f.account)).xp,'900');
  }finally{await f.close();}
});
test('published policy cannot change in place; old progress and already issued rewards retain their rules',async()=>{
  const f=await fixture();try{
    await f.earn('10000000');const before=await f.store.snapshot(f.account);
    const changed=testPolicy();changed.levels[4].reward!.count=99;
    const invalid=new ProgressionStore(f.db,{policy:changed,now:()=>2000});await assert.rejects(invalid.ready,/without version/);
    changed.version='test-policy-v2';const next=new ProgressionStore(f.db,{policy:changed,now:()=>2000});await next.ready;
    const after=await next.snapshot(f.account);assert.deepEqual(after,before);
    const account=randomUUID();assert.equal((await next.snapshot(account)).policyVersion,'test-policy-v2');
  }finally{await f.close();}
});
test('the policy is pinned at acceptance even if its first round finishes after a rollout',async()=>{
  const f=await fixture();try{
    const c=f.context();await f.store.acceptRound(c);
    const nextPolicy=testPolicy();nextPolicy.version='test-policy-v2';nextPolicy.coefficients['paid-game']={numerator:2,denominator:1};
    const next=new ProgressionStore(f.db,{policy:nextPolicy,now:()=>2000});await next.ready;
    const second=f.context();await next.acceptRound(second);
    for(const context of[c,second])await next.recordSettled({sourceType:context.sourceType,sourceId:context.sourceId,accountId:f.account,paidUnits:'1000000',refundedUnits:'0',settledAt:3000,outcome:'settled'});
    const result=await next.snapshot(f.account);assert.equal(result.policyVersion,'test-policy-v1');assert.equal(result.xp,'200');
  }finally{await f.close();}
});
test('report distinguishes expected promotional payouts from actual payouts and audit detects a broken projection',async()=>{
  const f=await fixture();try{
    await f.earn('10000000');await f.store.processPending();
    const report=await f.store.report();assert.equal(report.issuedSpins,10);assert.equal(report.actualPayoutUnits,'0');
    assert.equal(report.expectedIssuedPayoutUnits,'965000');assert.equal(report.expectedOutstandingPayoutUnits,'965000');
    assert.equal((await f.store.audit()).ok,true);
    await f.db.prepare("UPDATE progression_players SET xp='1001' WHERE account_id=?").run(f.account);
    const bad=await f.store.audit();assert.equal(bad.ok,false);assert.equal(bad.xpMismatches,1);
  }finally{await f.close();}
});
test('level 100 equals one million qualified units; new locations have independent progress',async()=>{
  const f=await fixture(structuredClone(DEFAULT_PROGRESSION_POLICY));try{
    await f.earn('1000000000000');const top=await f.store.snapshot(f.account);
    assert.equal(top.level,100);assert.equal(top.grants.length,20);
    const elsewhere=new ProgressionStore(f.db,{locationId:'new-world',policy:structuredClone(DEFAULT_PROGRESSION_POLICY),now:()=>1000});await elsewhere.ready;
    assert.equal((await elsewhere.snapshot(f.account)).level,1);
  }finally{await f.close();}
});
