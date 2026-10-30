import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { CommonSkinPayments } from '../server/skinPayments';
import { SkinStudioStore } from '../server/skinStudio';
import { FreeSkinGenerations } from '../server/progression/skinGenerations';
import { ProgressionStore } from '../server/progression/store';
import { LEGACY_PROGRESSION_POLICY, validProgressionSnapshot } from '../src/shared/progression';
import { demoBalanceUnits, saveDemoUnits } from '../server/demoWalletAmounts';

async function fixture() {
  const db=new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,skin BIGINT DEFAULT 0,appearance JSONB); INSERT INTO accounts(id) VALUES ('alice'),('bob')");
  const wallet=new DemoWalletStore(db);await wallet.ready;await saveDemoUnits(db,'alice',0);
  const progression=new ProgressionStore(db,{now:()=>1000});await progression.ready;
  const rights=new FreeSkinGenerations(db,progression.ready);await rights.ready;
  const paid=new CommonSkinPayments(db,wallet.ready);
  let now=1000,calls=0,failImage=false,loseCapture=false;
  const store=new SkinStudioStore(db,{skinPurchase:async(account,id,action)=>{
    const job=await db.prepare('SELECT reward_grant_id FROM skin_jobs WHERE id=?').get(id);
    const result=await (job?.reward_grant_id?rights:paid).skinPurchase(account,id,action);
    if(action==='capture'&&loseCapture){loseCapture=false;throw Error('lost capture reply');}return result;
  }},{available:()=>true,generate:async()=>{calls++;if(failImage)throw Error('provider failed');return Buffer.from('test skin');}},()=>true,()=>{},rights.ready,()=>now,undefined,rights);
  await store.ready;
  async function earn(amount='65960000',accountId='alice',engine=progression){const sourceId=randomUUID();await engine.acceptRound({sourceType:'paid-game',sourceId,accountId,
    locationId:'south-park',gameId:'royal-coins',environment:'VIRTUAL_USD',fundingSource:'cash',acceptedAt:1000});
    await engine.recordSettled({sourceType:'paid-game',sourceId,accountId,paidUnits:amount,refundedUnits:'0',settledAt:1100,outcome:'settled'});return engine.snapshot(accountId);}
  return {db,wallet,progression,rights,store,earn,calls:()=>calls,fail:()=>{failImage=true;},loseCapture:()=>{loseCapture=true;},advance:()=>{now+=601000;},
    request:(grantId:string)=>({id:randomUUID(),prompt:'Костюм космонавта',rewardGrantId:grantId})};
}

test('v2 awards the entire higher-denomination track and twenty independent atelier rights exactly once',async()=>{
  const f=await fixture();try{const s=await f.earn('1000000000000');assert(validProgressionSnapshot(s));assert.equal(s.grants.length,20);assert.equal(s.skinGrants?.length,20);
    assert.deepEqual(s.grants.slice(0,5).map(g=>g.stakeUnits),['500000','1000000','2000000','3000000','5000000']);
    assert.equal(s.grants.at(-1)?.stakeUnits,'50000000');assert.equal((await f.progression.report()).expectedIssuedPayoutUnits,'4671800000');
    assert.equal((await f.progression.report()).issuedSkinGenerations,20);assert.equal((await f.progression.audit()).ok,true);
    await f.progression.processPending();assert.equal((await f.rights.available('alice')).length,20);
  }finally{await f.db.close();}
});
test('one free right creates two choices at zero balance, survives duplicate requests and grants ownership of exactly one',async()=>{
  const f=await fixture();try{const s=await f.earn(),request=f.request(s.skinGrants![0].id);
    await Promise.all([f.store.create('alice',request),f.store.create('alice',request)]);await Promise.all([f.store.tick(),f.store.tick()]);
    const ready=await f.store.snapshot('alice');assert.equal(ready.job?.state,'ready');assert.equal(ready.job?.funding,'reward');assert.equal(ready.job?.variants.length,2);assert.equal(f.calls(),2);
    assert.equal(await demoBalanceUnits(f.db,'alice'),0);assert.equal((await f.wallet.snapshot('alice')).entries.length,0);
    const skin=ready.job!.variants[0];await f.store.choose('alice',request.id,skin.id);assert.equal((await f.store.snapshot('alice')).wardrobe.length,1);
    await assert.rejects(f.store.choose('alice',request.id,ready.job!.variants[1].id));
    await assert.rejects(f.store.create('alice',f.request(request.rewardGrantId)),/уже использована/);assert.equal(f.calls(),2);
    assert.equal((await f.progression.audit()).ok,true);
  }finally{await f.db.close();}
});
test('failed and interrupted generations restore the same right once and never make a cash refund',async()=>{
  const f=await fixture();try{const s=await f.earn(),id=s.skinGrants![0].id;f.fail();const r=f.request(id);await f.store.create('alice',r);await f.store.tick();
    assert.equal((await f.store.snapshot('alice')).job?.state,'failed');assert.equal((await f.rights.available('alice'))[0].remaining,1);
    await f.rights.skinPurchase('alice',r.id,'refund');assert.equal((await f.rights.available('alice'))[0].remaining,1);
    const interrupted=f.request(id);await f.store.create('alice',interrupted);await f.db.prepare("UPDATE skin_jobs SET state='generating',lease_until=0 WHERE id=?").run(interrupted.id);
    const calls=f.calls();await f.store.tick();assert.equal(f.calls(),calls);assert.equal((await f.rights.available('alice'))[0].remaining,1);
    assert.equal(await demoBalanceUnits(f.db,'alice'),0);assert.equal((await f.progression.audit()).ok,true);
  }finally{await f.db.close();}
});
test('a lost capture reply replays the original funding receipt without another generation or right',async()=>{
  const f=await fixture();try{const s=await f.earn(),r=f.request(s.skinGrants![0].id);f.loseCapture();await f.store.create('alice',r);await f.store.tick();
    assert.equal((await f.store.snapshot('alice')).job?.state,'capturing');f.advance();await f.store.tick();
    assert.equal((await f.store.snapshot('alice')).job?.state,'ready');assert.equal(f.calls(),2);assert.equal((await f.rights.available('alice')).length,0);
    assert.equal((await f.progression.audit()).ok,true);
  }finally{await f.db.close();}
});
test('ownership, request binding, concurrent jobs and paused starts reject without taking a right or charging money',async()=>{
  const f=await fixture();try{const s=await f.earn(),r=f.request(s.skinGrants![0].id);
    await assert.rejects(f.store.create('bob',r),/не найдена/);assert.equal((await f.rights.available('alice'))[0].remaining,1);
    await f.progression.setSwitches({skinsEnabled:false});await assert.rejects(f.store.create('alice',r),/приостановлены/);
    await f.progression.setSwitches({skinsEnabled:true});await f.store.create('alice',r);
    await assert.rejects(f.store.create('alice',{...r,rewardGrantId:randomUUID()}),/Нельзя изменить/);
    await assert.rejects(f.store.create('alice',f.request(r.rewardGrantId)),/Сначала дождись/);
    await f.progression.setSwitches({skinsEnabled:false});await f.store.tick();assert.equal((await f.store.snapshot('alice')).job?.state,'ready');
    assert.equal(await demoBalanceUnits(f.db,'alice'),0);assert.equal((await f.progression.audit()).ok,true);
  }finally{await f.db.close();}
});
test('failed bundle delivery rolls back XP, the spin packet and the skin right together',async()=>{
  const f=await fixture();try{await f.db.exec("CREATE FUNCTION fail_skin_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected grant failure'; END $$; CREATE TRIGGER fail_skin_reward BEFORE INSERT ON progression_skin_rewards FOR EACH ROW EXECUTE FUNCTION fail_skin_reward()");
    await assert.rejects(f.earn(),/injected grant failure/);assert.equal(Number((await f.db.prepare('SELECT count(*) AS n FROM progression_rewards').get())!.n),0);
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS n FROM progression_xp').get())!.n),0);
    await f.db.exec('DROP TRIGGER fail_skin_reward ON progression_skin_rewards; DROP FUNCTION fail_skin_reward()');
    const s=await f.progression.snapshot('alice');assert.equal(s.grants.length,1);assert.equal(s.skinGrants?.length,1);
  }finally{await f.db.close();}
});
test('accepted legacy policy and issued nominal remain unchanged when v2 becomes available',async()=>{
  const f=await fixture();try{const old=new ProgressionStore(f.db,{policy:LEGACY_PROGRESSION_POLICY,now:()=>1000});await old.ready;
    const before=await f.earn('65960000','bob',old);assert.equal(before.policyVersion,'location-levels-v1');
    const retained=await f.progression.snapshot('bob');assert.deepEqual(retained,before);assert.equal(retained.grants[0].stakeUnits,'100000');assert.equal(retained.skinGrants?.length,0);
    const current=await f.earn();assert.equal(current.policyVersion,'location-levels-v2');assert.equal(current.skinGrants?.length,1);
  }finally{await f.db.close();}
});
test('a reservation storage failure rolls back the atelier job and leaves its free right available',async()=>{
  const f=await fixture();try{const s=await f.earn(),r=f.request(s.skinGrants![0].id);
    await f.db.exec("CREATE FUNCTION fail_skin_use() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER fail_skin_use BEFORE INSERT ON progression_skin_uses FOR EACH ROW EXECUTE FUNCTION fail_skin_use()");
    await assert.rejects(f.store.create('alice',r),/injected reservation failure/);
    assert.equal(await f.db.prepare('SELECT id FROM skin_jobs WHERE id=?').get(r.id),undefined);
    assert.equal((await f.rights.available('alice'))[0].remaining,1);assert.equal(await demoBalanceUnits(f.db,'alice'),0);
    await f.db.exec('DROP TRIGGER fail_skin_use ON progression_skin_uses; DROP FUNCTION fail_skin_use()');
    await f.store.create('alice',r);await f.store.tick();assert.equal((await f.store.snapshot('alice')).job?.state,'ready');assert.equal(f.calls(),2);
  }finally{await f.db.close();}
});
