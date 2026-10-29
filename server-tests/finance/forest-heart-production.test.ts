import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pvpFixture} from './helpers/nile-pvp-fixture';
import {block} from './helpers/nile-play-fixture';
import {NileGameRuntime,type NativeCommand} from '../../server/finance/nile-game-runtime';
import {FOREST_HEART_GAME,validForestHeartSession} from '../../src/shared/forestHeart';
import {FOREST_HEART_STAKES} from '../../src/shared/forestHeartMath';

const command=(body:unknown=null,version:0|1=1):NativeCommand=>({path:'/expansion',method:body===null?'GET':'POST',body,flags:[true,true,true,true,true,true,true,true,2],rules:2,query:{},neopolisRules:4,forestHeartRules:version});

test('composed production finance settles every Forest Heart stake and choice once and restores bonuses',{timeout:120000},async()=>{
 let cases=0;
 for(const stake of FOREST_HEART_STAKES){
  const c=await pvpFixture();
  try{
  // Entirely synthetic credits in the disposable PostgreSQL database.
  await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));
  await c.source.ingest(block(103,'100000000000',c.config.source.addresses.find(a=>a.userId==='player')!.address));
  await c.ledger.sync(c.source,await c.reconciliation());
  let program:number[]=[],draws=0;
  const draw=(max:number)=>{draws++;const value=program.shift();assert(value!==undefined&&value>=0&&value<max);return value;};
  let games=new NileGameRuntime(c.ledger,draw);await games.ready;
  let expected=BigInt((await c.ledger.wallet(c.a)as any).balanceUnits);
  for(let choice=-2;choice<12;choice++){
   const start={id:randomUUID(),action:'start',gameId:FOREST_HEART_GAME,stakeUnits:String(stake),settings:{forestHeart:{mode:'normal'}}};
   program=choice===-2?[4095,0,1,1]:[0,0,0,0,...Array(4).fill([132,0]).flat()];
   const beforeDraws=draws;
   await assert.rejects(games.run(c.a,command(start,0)),/Обнови/);assert.equal(draws,beforeDraws);
   let reply:any=await games.run(c.a,command(start));assert(validForestHeartSession(reply.session));
   expected-=BigInt(stake)*10000n;
   const replay:any=await games.run(c.a,command(start));assert(replay.replayed);assert.deepEqual(replay.session,reply.session);
   if(reply.session.state==='active'){
    const hidden:any=await games.run(c.a,command(null,0));assert(!hidden.sessions.some((s:any)=>s.id===start.id));
    games=new NileGameRuntime(c.ledger,draw);await games.ready;
    const restored:any=await games.run(c.a,command());assert.deepEqual(restored.sessions.find((s:any)=>s.id===start.id),reply.session);
    await assert.rejects(games.run(c.b,command({id:randomUUID(),action:'move',gameId:FOREST_HEART_GAME,sessionId:start.id,move:'forest-pass',revision:1})));
   }
   let last:unknown=start;
   while(reply.session.state==='active'){
    const v=reply.session.view.forestHeart;
    const move=v.stage==='choice'?(choice<0?'forest-pass':'forest-turn-'+choice):'forest-spin';
    last={id:randomUUID(),action:'move',gameId:FOREST_HEART_GAME,sessionId:start.id,move,revision:v.revision};
    reply=await games.run(c.a,command(last));assert(validForestHeartSession(reply.session));
    if(reply.session.state==='active')assert.equal(reply.wallet.balanceUnits,String(expected));
   }
   expected+=BigInt(reply.session.returnedUnits)*10000n;
   assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');
   const settled:any=await games.run(c.a,command(last));assert(settled.replayed);assert.equal(settled.wallet.balanceUnits,String(expected));
   assert.equal(program.length,0);cases++;
  }
   await c.ledger.audit();
  }finally{await c.close();}
 }
 assert.equal(cases,84);
});
