import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { JACKIE_GAME, validJackieSession, validJackieSettings, JACKIE_COSTUMES, JACKIE_LOCATIONS, JACKIE_COLLECTION_MAX, type JackieCostume, type JackieLocation } from '../src/shared/jackieChan';
import { startJackie, moveJackie } from '../server/games/jackieChan';
import { startPenalty, movePenalty } from '../server/games/crLeo';
import { JackieCollectionStore } from '../server/jackieCollection';
import { validExpansionAction } from '../src/shared/casinoExpansion';
import type { PenaltyRisk } from '../src/shared/crLeo';

const settings=(risk:PenaltyRisk='safe',costume:JackieCostume='master',location:JackieLocation='restaurant')=>({jackie:{risk,costume,location}});
const start=(costume:JackieCostume='master')=>({id:randomUUID(),gameId:JACKIE_GAME,action:'start' as const,stakeUnits:'50000',settings:settings('safe',costume)});
async function setup(){
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet=new DemoWalletStore(db,()=>0);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:10000});
  let success=true,draws=0;const store=new DemoExpansionStore(db,async id=>({balance:await demoBalanceUnits(db,id)/100,entries:[]}),wallet.ready,async()=>{},max=>{if(max===100){draws++;return success?0:99;}return 0;});await store.ready;
  const act=(account:string,value:unknown)=>store.operate(account,value,2,true,true,true,true,true,true,true,true,2,4,true,2);
  return{db,wallet,store,act,draws:()=>draws,success:(v:boolean)=>success=v};
}
test('all cosmetic choices preserve the exact original CR vs Leo outcome, cost and payout at every step',()=>{
  for(const costume of JACKIE_COSTUMES)for(const location of JACKIE_LOCATIONS)for(const lossAt of [0,1,2,3,4,5]){
    const draw=()=>{let index=0;return(max:number)=>max===100?(index++===lossAt?99:0):0;};
    let jackie=startJackie(settings('safe',costume.id,location.id),'1000',JACKIE_COLLECTION_MAX,draw()),penalty=startPenalty({penalty:{hero:'cr',risk:'safe'}},'1000',draw());
    const jd=draw(),pd=draw();
    while(jackie.combat.status==='playing'){
      assert.deepEqual(jackie.combat,penalty);const risk=(['extreme','sharp','safe'] as const)[jackie.combat.revision%3];
      jackie=moveJackie(jackie,'1000','jackie-fight',jackie.combat.revision,jd,risk);penalty=movePenalty(penalty,'1000','penalty-kick',penalty.revision,pd,risk);
    }
    assert.deepEqual(jackie.combat,penalty);
  }
});
test('only declared settings and versioned actions are accepted',()=>{
  assert(validJackieSettings(settings()));assert(validExpansionAction(start()));
  for(const extra of [{opponents:0},{chance:100},{collectionUnits:90000},{hero:'leo'}])assert(!validJackieSettings({jackie:{...settings().jackie,...extra}}));
  assert(!validExpansionAction({...start(),settings:{penalty:{hero:'cr',risk:'safe'}}}));
  assert(!validExpansionAction({id:randomUUID(),gameId:JACKIE_GAME,action:'move',sessionId:randomUUID(),move:'jackie-fight'}));
});
test('one paid series credits collection once for either outcome; continuations and replays never add progress',async()=>{
  const f=await setup();try{
    await assert.rejects(f.act('alice',start('hawk')),/не открыт/);assert.equal(f.draws(),0);
    const op=start(),before=await demoBalanceUnits(f.db,'alice');const first=await f.act('alice',op);assert(validJackieSession(first.session));
    assert.equal(first.session.view.jackie!.collectionUnits,0);assert.equal(await demoBalanceUnits(f.db,'alice'),before-50000);
    await f.act('alice',op);assert.equal(f.draws(),1);
    const move={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:op.id,move:'jackie-fight',revision:1,penaltyRisk:'extreme' as const};
    const parallel=await Promise.allSettled([f.act('alice',move),f.act('alice',{...move,id:randomUUID()})]);assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(await f.store.jackieCollection.read('alice'),0);
    const bank={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:op.id,move:'cashout',revision:2};
    const replies=await Promise.all([f.act('alice',bank),f.act('alice',bank)]);assert(replies.every(r=>validJackieSession(r.session)));assert.equal(await f.store.jackieCollection.read('alice'),50000);assert.equal(await demoReservedUnits(f.db,'alice'),0);
    f.success(false);const failed=await f.act('alice',start('police'));assert.equal(failed.session.returnedUnits,'0');assert.equal(failed.session.view.jackie!.collectionUnits,100000);
    const all=await f.act('alice',start('hawk'));assert.equal(all.session.view.jackie!.costume,'hawk');assert.equal(await f.store.jackieCollection.read('alice'),150000);
    assert.equal(await f.store.jackieCollection.read('bob'),0);
  }finally{await f.db.close();}
});
test('old clients cannot start the new game or receive its sessions; accounts and pending rounds stay isolated',async()=>{
  const f=await setup();try{
    const op=start();await assert.rejects(f.store.operate('alice',op),/Обнови/);assert.equal(f.draws(),0);
    const initial=await f.act('alice',op);assert(!((await f.store.active('alice')).sessions.some(s=>s.gameId===JACKIE_GAME)));
    const move={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:op.id,move:'cashout',revision:1};await assert.rejects(f.act('bob',move));
    const resumed=await f.act('alice',move);assert(validJackieSession(resumed.session));assert.equal(resumed.session.returnedUnits,initial.session.view.jackie!.combat.availableUnits);
    assert(!validJackieSession({...initial.session,view:{...initial.session.view,actions:[{move:'penalty-kick',cost:0,label:'x'},{move:'cashout',cost:0,label:'x'}]}}));
  }finally{await f.db.close();}
});

test('expanding the collection preserves old progress and round credits while each new costume unlocks at its threshold',async()=>{
  const db=new PostgresDatabase(':memory:');try{
    await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'); CREATE TABLE demo_jackie_collection(account_id TEXT PRIMARY KEY REFERENCES accounts(id),units INTEGER NOT NULL CHECK(units BETWEEN 0 AND 90000)); INSERT INTO demo_jackie_collection VALUES('alice',90000)");
    let collection=new JackieCollectionStore(db,Promise.resolve());await collection.ready;assert.equal(await collection.read('alice'),90000);
    for(const costume of JACKIE_COSTUMES.slice(4)){
      await db.prepare('UPDATE demo_jackie_collection SET units=? WHERE account_id=?').run(costume.target-1000,'alice');
      assert.throws(()=>startJackie(settings('safe',costume.id),'1000',costume.target-1,()=>0));
      const round={id:randomUUID(),gameId:JACKIE_GAME,stakeUnits:'1000',state:'settled'};
      assert.equal(await collection.complete('alice',round),costume.target);assert.equal(await collection.complete('alice',round),costume.target);
      const accepted=startJackie(settings('safe',costume.id),'1000',costume.target,()=>0);assert.equal(accepted.version,2);
      collection=new JackieCollectionStore(db,Promise.resolve());await collection.ready;assert.equal(await collection.read('alice'),costume.target);
    }
    assert.equal(await collection.complete('alice',{id:randomUUID(),gameId:JACKIE_GAME,stakeUnits:'50000',state:'settled'}),JACKIE_COLLECTION_MAX);
  }finally{await db.close();}
});

test('legacy clients can finish their original series while new collection sessions stay filtered and reject stale moves',async()=>{
  const f=await setup();try{
    const legacy=(value:unknown)=>f.store.operate('alice',value,2,true,true,true,true,true,true,true,true,2,4,true,true);
    await f.db.prepare('INSERT INTO demo_jackie_collection(account_id,units) VALUES(?,?)').run('alice',90000);
    const old=start('hawk'),accepted=await legacy(old);assert.equal(accepted.session.view.jackie!.version,1);
    await f.db.prepare('UPDATE demo_jackie_collection SET units=? WHERE account_id=?').run(140000,'alice');
    const cashout={id:randomUUID(),gameId:JACKIE_GAME,action:'move' as const,sessionId:old.id,move:'cashout',revision:1};
    const settled=await legacy(cashout);assert(validJackieSession(settled.session));assert.equal(settled.session.view.jackie!.version,1);assert.equal(settled.session.view.jackie!.collectionUnits,90000);assert.equal(await f.store.jackieCollection.read('alice'),190000);
    assert.deepEqual((await legacy(cashout)).session,settled.session);
    const modern=start('rush'),current=await f.act('alice',modern);assert.equal(current.session.view.jackie!.version,2);
    const list=await f.store.active('alice',true,true,true,true,true,true,true,2,4,true,true);assert(!list.sessions.some(s=>s.id===modern.id));
    const next={...cashout,id:randomUUID(),sessionId:modern.id};await assert.rejects(legacy(next),/Обнови/);assert.equal(f.draws(),2);
    assert.equal((await f.act('alice',next)).session.view.jackie!.costume,'rush');
    await assert.rejects(legacy(modern),/Обнови/);await assert.rejects(legacy(start('mentor')),/Выбери/);
  }finally{await f.db.close();}
});
