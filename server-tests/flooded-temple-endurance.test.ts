import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {DemoExpansionStore} from '../server/demoExpansion';
import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts';
import {NileGameRuntime,type NativeCommand} from '../server/finance/nile-game-runtime';
import {pvpFixture} from './finance/helpers/nile-pvp-fixture';
import {block} from './finance/helpers/nile-play-fixture';
import {CASCADE_DATA} from '../src/shared/floodedTempleCascadeMath';
import {validCascadeSession} from '../src/shared/floodedTempleCascade';
// @ts-ignore Independently implemented complete-round oracle.
import {cascadeRandom,independentCascadeRound} from '../scripts/game-math/rtp-temple-cascade-model.mjs';

const scope='artifacts/work/temple-endurance';
const start=(stake:number)=>({id:randomUUID(),gameId:'studio-flooded-temple',action:'start',stakeUnits:String(stake),settings:{temple:{mode:'cascades'}}});
const move=(s:any)=>({id:randomUUID(),gameId:s.gameId,action:'move',sessionId:s.id,revision:s.view.templeCascade.revision,move:'temple-cascade'});
// xoshiro128 seed 183 gives 35 falls and 20 free spins. Preview seed 118 uses another generator.
const seedFor=(i:number)=>i%8===0?183:Math.imul(i+1,2654435761)>>>0;
async function report(name:string,value:unknown){await mkdir(scope,{recursive:true});await writeFile(`${scope}/${name}.json`,JSON.stringify(value,null,2)+'\n');}

test('1024 paid rounds retain exact integer settlement across stakes, repeated requests and store recovery',{timeout:360000},async()=>{
  const db=new PostgresDatabase(':memory:');
  try{
    await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('stress')");
    const wallet=new DemoWalletStore(db);
    for(let i=0;i<64;i++)await wallet.operate('stress',{id:randomUUID(),kind:'deposit',amount:10000});
    await wallet.expansion.ready;
    let random=cascadeRandom(1),draws=0,clock=Date.now();
    const create=()=>new DemoExpansionStore(db,async()=>({balance:await demoBalanceUnits(db,'stress')/100,entries:[]}),wallet.ready,async()=>{},max=>{draws++;return random(max);},()=>clock);
    let store=create(),expected=await demoBalanceUnits(db,'stress'),totalSpent=0,totalReturned=0,bonuses=0,continuations=0,retries=0,restarts=0;
    const run=(op:unknown)=>store.operate('stress',op,2,true,true,true,true,true,true,true,true,2,4,true,false,2,false,2);
    for(let i=0;i<1024;i++){
      clock+=1000; // Financial endurance uses virtual time, below the real 120/minute guard.
      const stake=CASCADE_DATA.stakes[i%CASCADE_DATA.stakes.length],seed=seedFor(i),oracle=independentCascadeRound(cascadeRandom(seed));random=cascadeRandom(seed);
      const op=start(stake);let reply=await run(op),s=reply.session;
      assert(validCascadeSession(s));expected-=stake;totalSpent+=stake;
      if(s.state==='active')assert.equal(await demoBalanceUnits(db,'stress'),expected);
      if(i%17===0){const before=draws;const repeats=await Promise.all([run(op),run(op),run(op)]);assert(repeats.every(r=>r.replayed));assert.equal(draws,before);retries+=3;}
      let last=op as any;
      while(s.state==='active'){
        assert.equal(s.returnedUnits,'0');assert.equal(s.spentUnits,String(stake));
        if(i%13===0){store=create();restarts++;const active=await store.active('stress',true,true,true,true,true,true,true,2,4,true,false,2,false,2);assert.deepEqual(active.sessions.find(v=>v.id===s.id),s);}
        last=move(s);reply=await run(last);s=reply.session;continuations++;assert(validCascadeSession(s));
      }
      const payout=oracle.points*(stake/20);assert.equal(s.returnedUnits,String(payout));assert.equal(s.view.templeCascade.state.falls,oracle.falls);
      bonuses+=Number(oracle.played>0);expected+=payout;totalReturned+=payout;
      if(i%11===0){const before=draws;const retry=await run(last);assert(retry.replayed);assert.equal(draws,before);retries++;}
      assert.equal(await demoBalanceUnits(db,'stress'),expected);assert.equal(await demoReservedUnits(db,'stress'),0);
    }
    const rows=await db.prepare("SELECT kind,count(*) AS n,sum(amount_units::bigint) AS total FROM demo_ledger WHERE account_id='stress' AND kind IN ('bet','win') GROUP BY kind ORDER BY kind").all();
    assert.deepEqual(rows.map(r=>[r.kind,Number(r.n)]),[['bet',1024],['win',1024]]);
    assert.equal(Number(rows[0].total),-totalSpent);assert.equal(Number(rows[1].total),totalReturned);
    assert(bonuses>=128&&continuations>=256&&restarts>0,JSON.stringify({bonuses,continuations,restarts}));
    await report('store',{paidRounds:1024,clock:'virtual, 1000 ms per paid round',stakes:CASCADE_DATA.stakes,bonuses,continuations,retries,restarts,totalSpent,totalReturned,finalBalanceUnits:expected,draws,ledger:rows});
  }finally{await db.close();}
});

test('256 native paid rounds and long bonuses survive runtime replacement and concurrent retries with a clean journal audit',{timeout:240000},async()=>{
  const c=await pvpFixture();
  const realNow=Date.now;let clock=realNow();
  try{
    await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));
    await c.source.ingest(block(103,'1000000000000',c.config.source.addresses.find(a=>a.userId==='player')!.address));
    await c.ledger.sync(c.source,await c.reconciliation());
    Date.now=()=>clock; // This test file runs in its own process; timers retain real time.
    let random=cascadeRandom(1),draws=0;
    const create=()=>new NileGameRuntime(c.ledger,max=>{draws++;return random(max);});let runtime=create();
    const command=(body:unknown=null):NativeCommand=>({path:'/expansion',method:body===null?'GET':'POST',body,flags:Array(9).fill(true),rules:2,query:{},templeRules:2});
    const run=async(op:unknown)=>await runtime.run(c.a,command(op)) as any;
    let expected=BigInt((await c.ledger.wallet(c.a) as any).balanceUnits),continuations=0,retries=0,restarts=0,bonuses=0;
    for(let i=0;i<256;i++){
      clock+=1000;
      if(i%32===0){await c.source.success();await c.ledger.sync(c.source,await c.reconciliation());}
      const stake=CASCADE_DATA.stakes[i%6],seed=seedFor(i),oracle=independentCascadeRound(cascadeRandom(seed));random=cascadeRandom(seed);
      const op=start(stake);let last=op as any,reply=await run(op),s=reply.session;assert(validCascadeSession(s));expected-=BigInt(stake)*10000n;
      while(s.state==='active'){
        assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(s.returnedUnits,'0');runtime=create();restarts++;
        const restored=await run(null);assert.deepEqual(restored.sessions.find((v:any)=>v.id===s.id),s);
        last=move(s);reply=await run(last);s=reply.session;assert(validCascadeSession(s));continuations++;
      }
      assert.equal(s.returnedUnits,String(oracle.points*(stake/20)));assert.equal(s.spentUnits,String(stake));bonuses+=Number(oracle.played>0);
      expected+=BigInt(s.returnedUnits)*10000n;assert.equal(reply.wallet.balanceUnits,String(expected));assert.equal(reply.wallet.reservedUnits,'0');
      if(i%7===0){const before=draws;const repeated=await Promise.all([run(last),run(last),run(last)]);assert(repeated.every(r=>r.replayed&&r.wallet.balanceUnits===String(expected)));assert.equal(draws,before);retries+=3;}
      if(i%32===31)await c.ledger.audit();
    }
    await c.ledger.audit();assert(continuations>=16&&bonuses>=16);
    await report('native',{paidRounds:256,clock:'virtual, 1000 ms per paid round',stakes:CASCADE_DATA.stakes,bonuses,continuations,retries,restarts,draws,finalBalanceUnits:String(expected),reservedUnits:'0',journalAudits:9});
  }finally{Date.now=realNow;await c.close();}
});
