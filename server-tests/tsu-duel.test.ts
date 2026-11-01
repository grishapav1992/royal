import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {VirtualPvpLedger} from '../server/pvp/virtual-wallet';
import {PvpStore} from '../server/pvp/store';
import {createTsuDuel,lockTsuDuel,advanceTsuDuel,publicTsuDuel} from '../server/pvp/tsu-duel';
import {TSU_DUEL_STAKES,tsuDuelPayout} from '../src/shared/tsuDuel';
import {type PvpRequest,validPvpRequest} from '../src/shared/pvp';

export async function duelFixture(amounts=[200,200],rulesVersion:3|4=4){
  const db=new PostgresDatabase(':memory:');await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  const ids=[randomUUID(),randomUUID()];for(const id of ids)await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
  const common=new DemoWalletStore(db);await common.ready;for(const [i,id]of ids.entries())if(amounts[i])await common.operate(id,{id:randomUUID(),kind:'deposit',amount:amounts[i]});
  const ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger);await store.ready;
  const actors=ids.map((accountId,i)=>({accountId,name:['Анна','Борис'][i],roomId:'duel-test'}));
  const people=actors.map(a=>({...a,connected:true,available:true}));let now=Date.now();await store.syncRoom('duel-test',people,now);
  const command=(i:number,op:Omit<PvpRequest,'id'>|any)=>store.command(actors[i],{...op,id:op.id??randomUUID()},now);
  const invite=await command(0,{action:'invite',gameId:'tsu-e-fa',targetId:ids[1]}),id=invite.active!.id;
  if(rulesVersion===3){
    const row=await db.prepare('SELECT payload FROM pvp_matches WHERE id=?').get(id),saved=JSON.parse(String(row!.payload));
    saved.challenge.rulesVersion=3;saved.challenge.targetWins=3;
    await db.prepare('UPDATE pvp_matches SET payload=? WHERE id=?').run(JSON.stringify(saved),id);
  }
  const step=async(ms:number)=>{const until=now+ms;while(now<until){now=Math.min(until,now+10000);await store.syncRoom('duel-test',people,now);}};
  const accept=()=>command(1,{action:'accept',challengeId:id});
  const ready=(side:number,termsRevision=0)=>command(side,{action:'duel-ready',challengeId:id,termsRevision});
  const snapshot=(side=0)=>store.snapshot(actors[side],now);
  const start=async()=>{await accept();await ready(0);await ready(1);};
  const choose=async(side:number,choice='rock')=>{const v=(await snapshot(side)).tsuEFa!;return command(side,{action:'move',challengeId:id,revision:v.revision,move:{kind:'choose',round:v.round,choice}});};
  return {db,common,ledger,store,actors,people,id,command,step,accept,ready,snapshot,start,choose,now:()=>now};
}

test('new invitations are unpriced consent, historical free creation is unavailable, all common stakes settle in exact cents',async()=>{
  for(const units of TSU_DUEL_STAKES){const payout=tsuDuelPayout(units);assert.equal(BigInt(payout.payoutUnits)+BigInt(payout.feeUnits),BigInt(units)*2n);assert.equal(BigInt(payout.payoutUnits)%10000n,0n);}
  assert.deepEqual(tsuDuelPayout('100000'),{potUnits:'200000',payoutUnits:'190000',feeUnits:'10000'});
  const invitation={id:randomUUID(),action:'invite',gameId:'tsu-e-fa',targetId:randomUUID()};assert(validPvpRequest(invitation));assert(!validPvpRequest({...invitation,mode:'free'}));
  const c=await duelFixture();try{
    await assert.rejects(c.command(1,{action:'create',gameId:'tsu-e-fa',mode:'free',targetWins:3,stakeUnits:'0',targetId:c.actors[0].accountId}),/сначала пригласи/);
    assert.equal((await c.snapshot()).active!.rulesVersion,4);assert.equal((await c.snapshot()).active!.targetWins,2);
    assert.equal(Number((await c.db.prepare('SELECT count(*) AS n FROM virtual_pvp_holds').get())!.n),0);
    await c.command(1,{action:'cancel',challengeId:c.id});assert.equal((await c.snapshot()).active!.status,'cancelled');
    for(const a of c.actors)assert.equal((await c.common.snapshot(a.accountId)).balance,200);
  }finally{await c.db.close();}
});

test('shared terms reset both ready flags, stale confirmation cannot start or charge, refusal remains free',async()=>{
  const c=await duelFixture();try{
    await c.accept();assert((await c.snapshot()).tsuEFa);
    await c.ready(0);assert.equal((await c.common.snapshot(c.actors[0].accountId)).balance,200);
    await c.command(1,{action:'terms',challengeId:c.id,termsRevision:0,stakeUnits:'200000'});
    const changed=(await c.snapshot()).active!;assert.deepEqual(changed.ready,[]);assert.equal(changed.termsRevision,1);
    await assert.rejects(c.ready(0,0),/Условия изменились/);
    await c.ready(0,1);await c.command(0,{action:'unready',challengeId:c.id,termsRevision:1});assert.deepEqual((await c.snapshot()).active!.ready,[]);
    await c.command(1,{action:'cancel',challengeId:c.id});
    assert.equal(Number((await c.db.prepare('SELECT count(*) AS n FROM virtual_pvp_banks').get())!.n),0);
  }finally{await c.db.close();}
});

test('second readiness atomically funds both sides; insufficient balance leaves no partial bank',async()=>{
  const c=await duelFixture([200,0]);try{
    await c.accept();await c.ready(0);await assert.rejects(c.ready(1),/insufficient/);
    assert.equal((await c.snapshot()).active!.status,'arriving');
    assert.equal((await c.common.snapshot(c.actors[0].accountId)).balance,200);
    assert.equal((await c.common.snapshot(c.actors[1].accountId)).balance,0);
    assert.equal(Number((await c.db.prepare('SELECT count(*) AS n FROM virtual_pvp_holds').get())!.n),0);
  }finally{await c.db.close();}
});

test('all paired signs and pre-round scores remain secret until the final beat, including both submission orders',()=>{
  const signs=['rock','scissors','paper'],wins=[[null,0,1],[1,null,0],[0,1,null]];
  for(const rules of [3,4]as const){const target=rules===3?3:2;
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let x=0;x<target;x++)for(let y=0;y<target;y++)for(const first of [0,1]as const){
    let s=createTsuDuel(1000,rules);s.score=[x,y];const choices=[signs[a],signs[b]];
    s=lockTsuDuel(s,first,{kind:'choose',round:1,choice:choices[first]},1001);
    assert.equal(publicTsuDuel(s,first===0?1:0,false).choice,null);
    s=lockTsuDuel(s,first===0?1:0,{kind:'choose',round:1,choice:choices[first===0?1:0]},1002);
    assert.equal(s.stage,'countdown');assert.equal(s.last,null);assert.deepEqual(s.score,[x,y]);
    assert.equal(advanceTsuDuel(s,s.endsAt-1),s);
    assert.throws(()=>lockTsuDuel(s,first,{kind:'choose',round:1,choice:'paper'},1003));
    const result=advanceTsuDuel(s,s.endsAt),expected=[x,y],winner=wins[a][b];if(winner!==null)expected[winner]++;
    assert.deepEqual(result.score,expected);assert.deepEqual(result.last!.choices,choices);assert.equal(result.phase,expected.includes(target)?'finished':'playing');assert.equal(result.rulesVersion,rules);
  }
  }
});

test('new first-to-two and accepted first-to-three matches pin their target through restart and settle exactly once',async()=>{
  for(const rules of [3,4]as const){const target=rules===3?3:2;
  const c=await duelFixture([200,200],rules);try{
    await c.start();for(const a of c.actors)assert.equal((await c.common.snapshot(a.accountId)).balance,199.9);
    for(let round=1;round<=target;round++){
      const first={id:randomUUID(),action:'move',challengeId:c.id,revision:0,move:{kind:'choose',round,choice:'rock'}};
      await c.command(0,first);await c.choose(1,'scissors');
      const restored=new PvpStore(c.ledger);await restored.ready;assert.equal((await restored.snapshot(c.actors[0],c.now())).tsuEFa!.choice,'rock');
      assert.equal((await c.snapshot(1)).tsuEFa!.last?.round??0,round-1);
      await c.step(4000);const result=await c.snapshot();assert.equal(result.tsuEFa!.score[0],round);
      await c.command(0,first);if(round<target){assert.equal(result.active!.status,'playing');await c.step(1600);}
    }
    assert.equal((await c.snapshot()).active!.status,'finished');
    assert.equal((await c.common.snapshot(c.actors[0].accountId)).balance,200.09);
    assert.equal((await c.common.snapshot(c.actors[1].accountId)).balance,199.9);
    const bank=await c.db.prepare('SELECT * FROM virtual_pvp_banks').get();assert.equal(Number(bank!.fee_units),1);
    assert.equal(Number((await c.db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE entry_type='bet'").get())!.n),2);
    assert.equal(Number((await c.db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE entry_type='win'").get())!.n),1);
  }finally{await c.db.close();}
  }
});

test('best of three replays ties and finishes at 2:1 without charging continuations',async()=>{
  const c=await duelFixture();try{
    await c.start();
    const pairs=[['rock','rock'],['rock','scissors'],['rock','paper'],['scissors','paper']],scores=[[0,0],[1,0],[1,1],[2,1]];
    for(let i=0;i<pairs.length;i++){
      await c.choose(0,pairs[i][0]);await c.choose(1,pairs[i][1]);await c.step(4000);
      const s=await c.snapshot();assert.deepEqual(s.tsuEFa!.score,scores[i]);assert.equal(s.tsuEFa!.target,2);
      assert.equal(s.active!.status,i===3?'finished':'playing');if(i<3)await c.step(1600);
    }
    assert.equal((await c.common.snapshot(c.actors[0].accountId)).balance,200.09);
    assert.equal((await c.common.snapshot(c.actors[1].accountId)).balance,199.9);
    await c.choose(1,'rock');
    assert.deepEqual((await c.snapshot()).tsuEFa!.score,[2,1]);
    assert.equal(Number((await c.db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE entry_type='bet'").get())!.n),2);
  }finally{await c.db.close();}
});

test('disconnect pauses selected signs and countdown, reconnection resumes remaining time without charging again',async()=>{
  const c=await duelFixture();try{
    await c.start();await c.choose(0,'paper');c.people[0].connected=false;await c.step(100);
    assert((await c.snapshot(1)).tsuEFa!.duel!.paused);assert.equal((await c.snapshot()).tsuEFa!.choice,'paper');
    await c.step(40000);assert.equal((await c.snapshot()).active!.status,'playing');
    c.people[0].connected=true;await c.step(1);assert(!(await c.snapshot()).tsuEFa!.duel!.paused);
    await assert.rejects(c.choose(0,'rock'),/недоступен/);await c.choose(1,'rock');
    await c.step(1000);c.people[1].connected=false;await c.step(100);const before=(await c.snapshot()).tsuEFa!.duel!.endsAt-c.now();
    await c.step(20000);assert.equal((await c.snapshot()).tsuEFa!.last,null);
    c.people[1].connected=true;await c.step(1);assert.equal((await c.snapshot()).tsuEFa!.duel!.endsAt-c.now(),before);
    await c.step(before);assert.deepEqual((await c.snapshot()).tsuEFa!.score,[1,0]);
    for(const a of c.actors)assert.equal((await c.common.snapshot(a.accountId)).balance,199.9);
  }finally{await c.db.close();}
});

for(const both of [false,true])test(`expired reconnect ${both?'both players refunds':'one player forfeits'} once`,async()=>{
  const c=await duelFixture();try{
    await c.start();c.people[1].connected=false;if(both)c.people[0].connected=false;await c.step(100);await c.step(60001);
    const final=await c.snapshot();assert.equal(final.active!.winnerId,both?null:c.actors[0].accountId);
    assert.equal((await c.common.snapshot(c.actors[0].accountId)).balance,both?200:200.09);
    assert.equal((await c.common.snapshot(c.actors[1].accountId)).balance,both?200:199.9);
    await c.store.sweep(c.now()+1000);assert.equal((await c.common.snapshot(c.actors[0].accountId)).balance,both?200:200.09);
  }finally{await c.db.close();}
});

test('mutual terms-ready race never charges an unconfirmed changed amount',async()=>{
  const c=await duelFixture();try{
    await c.accept();await Promise.allSettled([c.ready(0),c.command(1,{action:'terms',challengeId:c.id,termsRevision:0,stakeUnits:'500000'})]);
    const s=await c.snapshot();assert.equal(s.active!.status,'arriving');assert.equal(s.active!.stakeUnits,'500000');assert.deepEqual(s.active!.ready,[]);
    for(const a of c.actors)assert.equal((await c.common.snapshot(a.accountId)).balance,200);
  }finally{await c.db.close();}
});
