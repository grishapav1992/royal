import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {block} from './helpers/nile-play-fixture';
import {NileGameRuntime,type NativeCommand} from '../../server/finance/nile-game-runtime';
import {WILD_NUDGE_GAME,validWildNudgeSession} from '../../src/shared/wildNudge';
test('Galactic Reactor native compatibility shares the exact ledger, reserves once and survives recovery',async()=>{
 const c=await pvpFixture();try{
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
  let calls=0,tickets=[16,16,16,30,30],runtime=new NileGameRuntime(c.ledger,()=>{calls++;return tickets.length?tickets.shift()!:2;});
  const command=(body:unknown=null):NativeCommand=>({path:'/expansion',wildNudgeRules:1,method:body===null?'GET':'POST',body,flags:Array(9).fill(true),rules:2,query:{}});
  const op={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:'100',settings:{wildNudge:{mode:'normal'}}},before=BigInt((await c.ledger.wallet(c.a) as any).balanceUnits);
  await assert.rejects(runtime.run(c.a,{...command(op),wildNudgeRules:0}));assert.equal(calls,0);
  let reply:any=await runtime.run(c.a,command(op));assert(validWildNudgeSession(reply.session));assert.equal(BigInt(reply.wallet.balanceUnits),before-1000000n);assert.equal(reply.wallet.reservedUnits,String(8608n*100n*10000n));
  assert((await runtime.run(c.a,command(op)) as any).replayed);assert.equal(calls,5);
  runtime=new NileGameRuntime(c.ledger,()=>{calls++;return 2;});assert.deepEqual((await runtime.run(c.a,command()) as any).sessions.find((s:any)=>s.id===op.id),reply.session);
  let last:any;while(reply.session.state==='active'){last={id:randomUUID(),gameId:WILD_NUDGE_GAME,action:'move',sessionId:op.id,revision:reply.session.view.wildNudge.revision,move:'wild-nudge-spin'};reply=await runtime.run(c.a,command(last));assert(validWildNudgeSession(reply.session));}
  const expected=before-1000000n+BigInt(reply.session.returnedUnits)*10000n;assert.equal(BigInt(reply.wallet.balanceUnits),expected);assert.equal(reply.wallet.reservedUnits,'0');assert.equal(calls,45);assert((await runtime.run(c.a,command(last)) as any).replayed);assert.equal(calls,45);await c.ledger.audit();
 }finally{await c.close();}
});
