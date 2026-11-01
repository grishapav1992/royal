import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {demoBalanceUnits,saveDemoUnits,recordDemoUnits} from '../server/demoWalletAmounts';
import {ProgressionStore} from '../server/progression/store';
import {instrumentProgressionWallet,instrumentProgressionPvpLedger,NativeProgressionSources} from '../server/progression/sources';
import {VirtualPvpLedger} from '../server/pvp/virtual-wallet';
import {PvpStore} from '../server/pvp/store';
import {WILD_NUDGE_GAME} from '../src/shared/wildNudge';

async function fixture(draw:(max:number)=>number=()=>0){
 const db=new PostgresDatabase(':memory:');await db.ready;
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
 const clock={value:Date.now()-1000},raw=new DemoWalletStore(db,draw,()=>clock.value);await raw.ready;
 const a=randomUUID(),b=randomUUID();
 for(const id of [a,b]){await db.prepare('INSERT INTO accounts VALUES(?)').run(id);await saveDemoUnits(db,id,1000000);}
 const progression=new ProgressionStore(db,{now:()=>clock.value});await progression.ready;
 const wallet=instrumentProgressionWallet(db,raw,progression);await wallet.ready;
 const events=async()=>{const rows=await db.prepare('SELECT payload FROM progression_outbox ORDER BY created_at,id').all();return rows.map(r=>JSON.parse(r.payload));};
 return{db,clock,raw,wallet,progression,a,b,events,close:()=>db.close()};
}

test('live shared wallet captures full paid stake even at a zero balance delta and replays once',async()=>{
 let n=0;const c=await fixture(()=>[0,0,1][n++%3]);
 try{
  const before=await demoBalanceUnits(c.db,c.a),op={id:randomUUID(),kind:'spin' as const,amount:10};
  await c.wallet.operate(c.a,op);assert.equal(await demoBalanceUnits(c.db,c.a),before);
  await c.wallet.operate(c.a,op);await c.wallet.snapshot(c.a);
  const events=await c.events();assert.equal(events.length,1);assert.equal(events[0].paidUnits,'10000000');
  assert.equal(events[0].refundedUnits,'0');assert.equal(events[0].sourceId,'native:instant:'+op.id);
  const context=JSON.parse((await c.db.prepare('SELECT context_json FROM progression_rounds').get())!.context_json);
  assert.equal(context.environment,'VIRTUAL_USD');assert.equal(context.locationId,'south-park');
  assert.equal((await c.progression.snapshot(c.a)).xp,'1000');
 }finally{await c.close();}
});

test('Mines and progressive games give one fact only after their full paid round finishes',async()=>{
 const c=await fixture();try{
  const mineId=randomUUID();await c.wallet.mines.operate(c.a,{id:mineId,action:'start',amount:10,mineCount:1});
  assert.equal((await c.events()).length,0);
  await c.wallet.mines.operate(c.a,{id:randomUUID(),action:'reveal',sessionId:mineId,cell:0});
  assert.equal((await c.events())[0].sourceId,'native:mines:'+mineId);
  const start={id:randomUUID(),action:'start' as const,gameId:'original-cr-vs-leo' as const,stakeUnits:'1000',settings:{penalty:{hero:'cr' as const,risk:'safe' as const}}};
  await c.wallet.expansion.operate(c.a,start);assert.equal((await c.events()).length,1);
  await c.wallet.expansion.operate(c.a,{id:randomUUID(),action:'move',gameId:start.gameId,sessionId:start.id,move:'penalty-kick',revision:1});
  assert.equal((await c.events()).length,1);
  const end={id:randomUUID(),action:'move' as const,gameId:start.gameId,sessionId:start.id,move:'cashout',revision:2};
  await c.wallet.expansion.operate(c.a,end);await c.wallet.expansion.operate(c.a,end);
  const events=await c.events();assert.equal(events.length,2);
  assert.equal(events.find(e=>e.sourceId==='native:casino:'+start.id).paidUnits,'10000000');
 }finally{await c.close();}
});

test('an unrelated GET finishes Flight and Crash and captures both persistent rounds',async()=>{
 const c=await fixture();try{
  const flight=randomUUID();await c.wallet.flight.operate(c.a,{id:flight,action:'start',amount:10,autoCashout:1.1});
  const crash=randomUUID();await c.wallet.expansion.operate(c.a,{id:crash,action:'start',gameId:'github-crash',stakeUnits:'1000',settings:{}});
  assert.equal((await c.events()).length,0);
  c.clock.value+=100000000;await c.wallet.snapshot(c.a);await c.wallet.snapshot(c.a);
  const events=await c.events();assert.equal(events.length,2);
  assert.deepEqual(new Set(events.map(e=>e.sourceId)),new Set(['native:flight:'+flight,'native:casino:'+crash]));
  assert(events.every(e=>e.paidUnits==='10000000'));
 }finally{await c.close();}
});

test('sessions started before progression was instrumented are not imported on settlement',async()=>{
 const c=await fixture();try{
  const id=randomUUID();await c.raw.flight.operate(c.a,{id,action:'start',amount:10,autoCashout:1.1});
  c.clock.value+=100000000;await c.wallet.snapshot(c.a);
  assert.equal((await c.events()).length,0);
  await c.wallet.flight.operate(c.a,{id,action:'start',amount:10,autoCashout:1.1});
  assert.equal((await c.events()).length,0);
 }finally{await c.close();}
});

test('full bonus continuations retain one accepted source and one original paid amount',async()=>{
 let seed=5;const c=await fixture(max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;});
 try{
  const start={id:randomUUID(),action:'start' as const,gameId:'studio-afterglow' as const,stakeUnits:'100',settings:{afterglow:{mode:'normal' as const}},appearance:{girl:1,look:0,revision:0}};
  let reply=await c.wallet.expansion.operate(c.a,start);assert.equal(reply.session.state,'active');
  assert.equal((await c.events()).length,0);let last:unknown;
  for(let i=0;reply.session.state==='active'&&i<100;i++){
   last={id:randomUUID(),action:'move',gameId:start.gameId,sessionId:start.id,move:'afterglow-spin',revision:reply.session.view.afterglow!.revision};
   reply=await c.wallet.expansion.operate(c.a,last);
  }
  assert.equal(reply.session.state,'settled');await c.wallet.expansion.operate(c.a,last);
  const events=await c.events();assert.equal(events.length,1);assert.equal(events[0].paidUnits,'1000000');
 }finally{await c.close();}
});

test('a purchased festival counts its full paid cost once rather than one nominal spin',async()=>{
 const c=await fixture();try{
  const start={id:randomUUID(),action:'start' as const,gameId:'studio-caramel-carnival' as const,stakeUnits:'100',settings:{caramel:{mode:'festival' as const}}};
  let reply=await c.wallet.expansion.operate(c.a,start);assert.equal(reply.session.spentUnits,'3500');
  for(let i=0;reply.session.state==='active'&&i<100;i++)reply=await c.wallet.expansion.operate(c.a,
   {id:randomUUID(),action:'move',gameId:start.gameId,sessionId:start.id,move:'caramel-spin',revision:reply.session.view.caramel!.revision});
  assert.equal(reply.session.state,'settled');const events=await c.events();
  assert.equal(events.length,1);assert.equal(events[0].paidUnits,'35000000');
 }finally{await c.close();}
});

test('source storage contracts include additional paid actions and explicit partial refunds without unrelated entries',async()=>{
 const c=await fixture();try{
  const collector=new NativeProgressionSources(c.db,c.progression,c.raw.ready);await collector.ready;
  const id=randomUUID(),paidMove=randomUUID(),refundMove=randomUUID(),otherId=randomUUID(),gameId='storage-contract-game';
  const request=async(op:string,session:string)=>c.db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(c.a,op,'{}',session,Date.now());
  await c.db.transaction(async()=>{
   await c.db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run(c.a,id,gameId,'active','{}',0);
   await c.db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run(c.a,otherId,gameId,'settled','{}',0);
   await request(id,id);await request(otherId,otherId);
   await recordDemoUnits(c.db,c.a,id,'bet',-1000,999000,gameId);
   await collector.afterCommand(c.a,{path:'/expansion',method:'POST',body:{id,action:'start'}},false);
   await request(paidMove,id);await recordDemoUnits(c.db,c.a,paidMove,'bet',-2000,997000,gameId);
   await request(refundMove,id);await recordDemoUnits(c.db,c.a,refundMove,'refund',500,997500,gameId);
   await recordDemoUnits(c.db,c.a,otherId,'bet',-700,996800,gameId);
   await c.db.prepare("UPDATE demo_casino_sessions SET state='settled' WHERE account_id=? AND id=?").run(c.a,id);
   await collector.afterCommand(c.a,{path:'/',method:'GET',body:null},false);
  },{lockKey:'account:'+c.a});
  const events=await c.events();assert.equal(events.length,1);assert.equal(events[0].paidUnits,'30000000');
  assert.equal(events[0].refundedUnits,'5000000');assert.equal((await c.progression.snapshot(c.a)).xp,'2500');
 }finally{await c.close();}
});

test('progression capture failure rolls back the shared wallet and permits an exact retry',async()=>{
 const c=await fixture();try{
  const op={id:randomUUID(),kind:'spin' as const,amount:10},before=await demoBalanceUnits(c.db,c.a);
  await c.db.exec("CREATE FUNCTION reject_progression_source_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected source failure'; END $$; CREATE TRIGGER reject_progression_source BEFORE INSERT ON progression_outbox FOR EACH ROW EXECUTE FUNCTION reject_progression_source_fn()");
  await assert.rejects(c.wallet.operate(c.a,op),/injected source failure/);
  assert.equal(await demoBalanceUnits(c.db,c.a),before);assert.equal((await c.events()).length,0);
  assert.equal(await c.db.prepare('SELECT 1 FROM demo_operations WHERE operation_id=?').get(op.id),undefined);
  await c.db.exec('DROP TRIGGER reject_progression_source ON progression_outbox');
  await c.wallet.operate(c.a,op);await c.wallet.operate(c.a,op);assert.equal((await c.events()).length,1);
 }finally{await c.close();}
});

test('virtual PvP and combat use the paid stake of both participants and exclude refunded matches',async()=>{
 const c=await fixture();try{
  const pvp=instrumentProgressionPvpLedger(c.db,new VirtualPvpLedger(c.db,c.wallet),c.progression);
  for(const gameId of ['durak','mortal-kombat']){
   const matchId=randomUUID();for(const account of [c.a,c.b])await pvp.pvpHold(account,{matchId,gameId,stakeUnits:'50000000'});
   await pvp.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'});await pvp.pvpFinish(c.a,{matchId,winnerId:c.a,reason:'win'});
  }
  let events=await c.events();assert.equal(events.length,4);assert(events.every(e=>e.paidUnits==='50000000'&&e.refundedUnits==='0'));
  const matchId=randomUUID();for(const account of [c.a,c.b])await pvp.pvpHold(account,{matchId,gameId:'durak',stakeUnits:'10000000'});
  await pvp.pvpFinish(c.a,{matchId,winnerId:null,reason:'draw'});
  events=await c.events();assert.equal(events.length,6);assert.equal(events.filter(e=>e.outcome==='refunded'&&e.paidUnits===e.refundedUnits).length,2);
  assert.equal((await c.progression.snapshot(c.a)).xp,'10000');assert.equal((await c.progression.snapshot(c.b)).xp,'10000');
 }finally{await c.close();}
});

test('new Wild Nudge registration earns XP once after its whole paid round and bonus continuation',async()=>{
 const stops=[16,16,16,30,30],c=await fixture(()=>stops.length?stops.shift()!:2);
 try{
  const capabilities=[2,true,true,true,true,true,true,true,true,2,4,true,false,2,2,2,true] as const;
  const play=(op:unknown)=>c.wallet.expansion.operate(c.a,op,...capabilities);
  const start={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}};
  let reply=await play(start);assert.equal(reply.session.state,'active');assert.equal((await c.events()).length,0);
  await play(start);let last:unknown=start;
  while(reply.session.state==='active'){
   last={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'move',sessionId:start.id,revision:reply.session.view.wildNudge!.revision,move:'wild-nudge-spin'};
   reply=await play(last);
  }
  await play(last);const events=await c.events();assert.equal(events.length,1);
  assert.equal(events[0].sourceId,'native:casino:'+start.id);assert.equal(events[0].paidUnits,'1000000');
  assert.equal(events[0].refundedUnits,'0');assert.equal((await c.progression.snapshot(c.a)).xp,'100');
 }finally{await c.close();}
});

test('new Tsu-e-fa registration earns the same own-stake XP for both settled PvP participants',async()=>{
 const c=await fixture();try{
  const ledger=instrumentProgressionPvpLedger(c.db,new VirtualPvpLedger(c.db,c.wallet),c.progression),store=new PvpStore(ledger);
  const now=Date.now(),actors=[c.a,c.b].map((accountId,i)=>({accountId,name:'Player '+i,roomId:'progression-tsu'}));
  await store.syncRoom('progression-tsu',actors.map(a=>({...a,connected:true,available:true})),now);
  const created=await store.command(actors[0],{id:randomUUID(),action:'create',gameId:'tsu-e-fa',stakeUnits:'1100000',targetId:c.b},now);
  const challengeId=created.active!.id;
  await store.command(actors[1],{id:randomUUID(),action:'accept',challengeId},now);
  for(const actor of actors)await store.command(actor,{id:randomUUID(),action:'ready',challengeId},now);
  assert.equal((await c.events()).length,0);
  const finish={id:randomUUID(),action:'resign' as const,challengeId};await store.command(actors[1],finish,now);await store.command(actors[1],finish,now);
  const events=await c.events();assert.equal(events.length,2);assert.deepEqual(new Set(events.map(e=>e.accountId)),new Set([c.a,c.b]));
  assert(events.every(e=>e.sourceId===challengeId&&e.paidUnits==='1100000'&&e.refundedUnits==='0'));
  assert.equal((await c.progression.snapshot(c.a)).xp,'110');assert.equal((await c.progression.snapshot(c.b)).xp,'110');
 }finally{await c.close();}
});
