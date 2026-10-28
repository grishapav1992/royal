import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pvpFixture } from './helpers/nile-pvp-fixture';
import { block } from './helpers/nile-play-fixture';
import { NileGameRuntime, type NativeCommand } from '../../server/finance/nile-game-runtime';
import { FLAG_GAME, validFlagSession } from '../../src/shared/flagBattle';
const command=(body:unknown=null):NativeCommand=>({path:'/expansion',flagRules:1,body,method:body===null?'GET':'POST',flags:Array(9).fill(true),rules:2,query:{}});
test('Flag Battle uses the Nile journal with exact integer settlement, capability filtering and replay after restart',async()=>{
  const c=await pvpFixture();
  try{
    await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));
    await c.ledger.sync(c.source,await c.reconciliation());
    let draws=0;const create=()=>new NileGameRuntime(c.ledger,()=>{draws++;return 0;});let runtime=create();
    const op={id:randomUUID(),gameId:FLAG_GAME,action:'start',stakeUnits:'100',settings:{flags:{country:'RU'}}};
    const before=BigInt((await c.ledger.wallet(c.a)as any).balanceUnits);
    await assert.rejects(runtime.run(c.a,{...command(op),flagRules:0}));assert.equal(draws,0);
    const r:any=await runtime.run(c.a,command(op));assert(validFlagSession(r.session));
    assert.equal(r.wallet.balanceUnits,String(before+10520000n));assert.equal(r.wallet.reservedUnits,'0');
    const count=draws;runtime=create();const retry:any=await runtime.run(c.a,command(op));
    assert(retry.replayed);assert.equal(draws,count);assert.equal(retry.wallet.balanceUnits,r.wallet.balanceUnits);
    const restored:any=await runtime.run(c.a,command());assert.deepEqual(restored.sessions.find((s:any)=>s.gameId===FLAG_GAME),r.session);
    const old:any=await runtime.run(c.a,{...command(),flagRules:undefined});assert(!old.sessions.some((s:any)=>s.gameId===FLAG_GAME));
    const other:any=await runtime.run(c.b,command());assert(!other.sessions.some((s:any)=>s.id===op.id));
    await assert.rejects(runtime.run(c.a,command({...op,settings:{flags:{country:'JP'}}})));
    const lost:any=await runtime.run(c.a,command({...op,id:randomUUID(),settings:{flags:{country:'JP'}}}));
    assert(validFlagSession(lost.session));assert.equal(lost.session.returnedUnits,'0');assert.equal(lost.wallet.balanceUnits,String(before+9520000n));
    await c.ledger.audit();
  }finally{await c.close();}
});
