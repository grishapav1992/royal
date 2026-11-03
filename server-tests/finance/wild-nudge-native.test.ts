import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {block} from './helpers/nile-play-fixture';
import {NileGameRuntime,type NativeCommand} from '../../server/finance/nile-game-runtime';
import {WILD_NUDGE_GAME,validWildNudgeSession} from '../../src/shared/wildNudge';
import {DemoWalletStore} from '../../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits,saveDemoUnits} from '../../server/demoWalletAmounts';
test('Star Spin requires common stake negotiation and preserves accepted historical rounds in the exact ledger',async()=>{
 const c=await pvpFixture();try{
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  let calls=0,tickets=[16,16,16,30,30];const draw=()=>{calls++;return tickets.length?tickets.shift()!:2;};let runtime=new NileGameRuntime(c.ledger,draw);
  const command=(body:unknown=null):NativeCommand=>({path:'/expansion',wildNudgeRules:1,method:body===null?'GET':'POST',body,flags:Array(9).fill(true),rules:2,query:{}});
  const op={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}},before=BigInt((await c.ledger.wallet(c.a) as any).balanceUnits);
  await assert.rejects(runtime.run(c.a,{...command(op),wildNudgeRules:0}));assert.equal(calls,0);
  await assert.rejects(runtime.run(c.a,command(op)),(error:any)=>error.status===409);assert.equal(calls,0);assert.equal(BigInt((await c.ledger.wallet(c.a) as any).balanceUnits),before);
  // Seed a round accepted under historical rules through the actual engine and
  // journal. Replaying it must retain the original rules and original stake.
  // Match the native adapter: the outer financial transaction owns its lock.
  const projection=new Proxy(c.ledger.db,{get(target,key){if(key==='transaction')return<T>(action:()=>Promise<T>)=>target.transaction(action);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const historical=new DemoWalletStore(projection,draw);await historical.ready;
  await c.ledger.nativeTransaction(c.a,async context=>{
   await c.ledger.db.prepare('INSERT INTO accounts(id) VALUES(?) ON CONFLICT DO NOTHING').run(c.a);
   await saveDemoUnits(c.ledger.db,c.a,Number(context.available/10000n));
   await historical.expansion.operate(c.a,op,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2,true);
   await context.post(BigInt(await demoBalanceUnits(c.ledger.db,c.a))*10000n,BigInt(await demoReservedUnits(c.ledger.db,c.a))*10000n,createHash('sha256').update('accepted-star-spin-fixture:'+op.id).digest('hex'));
  });
  let reply:any=await runtime.run(c.a,command(op));assert(reply.replayed);assert(validWildNudgeSession(reply.session));assert.equal(BigInt(reply.wallet.balanceUnits),before-1000000n);assert.equal(reply.wallet.reservedUnits,String(8608n*100n*10000n));
  assert((await runtime.run(c.a,command(op)) as any).replayed);assert.equal(calls,5);
  runtime=new NileGameRuntime(c.ledger,()=>{calls++;return 2;});assert.deepEqual((await runtime.run(c.a,command()) as any).sessions.find((s:any)=>s.id===op.id),reply.session);
  let last:any;while(reply.session.state==='active'){last={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'move',sessionId:op.id,revision:reply.session.view.wildNudge.revision,move:'wild-nudge-spin'};reply=await runtime.run(c.a,command(last));assert(validWildNudgeSession(reply.session));}
  const expected=before-1000000n+BigInt(reply.session.returnedUnits)*10000n;assert.equal(BigInt(reply.wallet.balanceUnits),expected);assert.equal(reply.wallet.reservedUnits,'0');assert.equal(calls,45);assert((await runtime.run(c.a,command(last)) as any).replayed);assert.equal(calls,45);await c.ledger.audit();
 }finally{await c.close();}
});
test('native minimum Star Spin debits ten cents and settles a fractional award exactly once',async()=>{
 const c=await pvpFixture();try{
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  let calls=0;const stops=[0,0,30,30,30],runtime=new NileGameRuntime(c.ledger,max=>{calls++;return max===64?stops.shift()!:0;});
  const op={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:'10',stakePolicyVersion:1,settings:{wildNudge:{mode:'normal'}}},command:NativeCommand={path:'/expansion',wildNudgeRules:1,method:'POST',body:op,flags:Array(9).fill(true),rules:2,query:{}};
  const before=BigInt((await c.ledger.wallet(c.a) as any).balanceUnits),reply:any=await runtime.run(c.a,command);assert.equal(reply.session.rulesVersion,2);assert.equal(reply.session.spentUnits,'10');assert.equal(reply.session.view.wildNudge.totalPayoutUnits,'33');assert.equal(reply.session.returnedUnits,'34');assert.equal(reply.wallet.balanceUnits,String(before-100000n+340000n));assert.equal(reply.wallet.reservedUnits,'0');assert.equal(calls,6);
  const retry:any=await runtime.run(c.a,command);assert(retry.replayed);assert.deepEqual(retry.session,reply.session);assert.equal(calls,6);await c.ledger.audit();
 }finally{await c.close();}
});
