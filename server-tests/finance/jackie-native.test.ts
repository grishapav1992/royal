import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pvpFixture } from './helpers/nile-pvp-fixture';
import { block } from './helpers/nile-play-fixture';
import { NileGameRuntime, type NativeCommand } from '../../server/finance/nile-game-runtime';
import { JACKIE_GAME, validJackieSession } from '../../src/shared/jackieChan';
const command=(body:unknown=null,capability=true):NativeCommand=>({path:'/expansion',body,method:body===null?'GET':'POST',flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{},jackieRules:capability?2:0});
test('Jackie restores and pays mixed groups once through the real Nile journal with shared reserves',async()=>{
  const c=await pvpFixture();try{
    await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());
    let games=new NileGameRuntime(c.ledger,()=>0);
    const start={id:randomUUID(),gameId:JACKIE_GAME,action:'start',stakeUnits:'1000',settings:{jackie:{risk:'safe',costume:'master',location:'harbor'}}};
    await assert.rejects(games.run(c.a,command(start,false)),/Обнови/);
    let r:any=await games.run(c.a,command(start));assert(validJackieSession(r.session));assert.equal(r.wallet.balanceUnits,'190000000');
    games=new NileGameRuntime(c.ledger,()=>0);
    assert(!(await games.run(c.a,command(null,false))as any).sessions.some((s:any)=>s.gameId===JACKIE_GAME));
    r=await games.run(c.a,command());assert.equal(r.sessions.find((s:any)=>s.gameId===JACKIE_GAME).id,start.id);
    let last:unknown;
    for(let revision=1;revision<5;revision++){
      last={id:randomUUID(),gameId:JACKIE_GAME,action:'move',sessionId:start.id,move:'jackie-fight',revision,penaltyRisk:revision%2?'extreme':'sharp'};
      r=await games.run(c.a,command(last));assert(validJackieSession(r.session));
    }
    assert.equal(r.session.state,'settled');assert.equal(r.wallet.reservedUnits,'0');assert.equal(r.session.view.jackie.collectionUnits,1000);
    const expected=190000000n+BigInt(r.session.returnedUnits)*10000n;assert.equal(r.wallet.balanceUnits,String(expected));
    const replay:any=await games.run(c.a,command(last));assert(replay.replayed);assert.equal(replay.wallet.balanceUnits,String(expected));assert.equal(replay.session.view.jackie.collectionUnits,1000);
    await c.ledger.audit();
  }finally{await c.close();}
});
