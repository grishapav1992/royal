import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { FlagToteStore, drawToteOrder } from '../server/flagTote';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
import { settleFlagTote, validToteSnapshot, TOTE_LIMITS, TOTE_TIMING, type ToteMathTicket } from '../src/shared/flagTote';
import { FLAG_COUNTRIES, type FlagCountry } from '../src/shared/flagBattle';

const countries = FLAG_COUNTRIES.map(c => c.id);
const ticket = (country: FlagCountry, stakeUnits = '100', accountId = randomUUID()): ToteMathTicket => ({ id: randomUUID(), accountId, country, stakeUnits });
const podium = (ids: FlagCountry[]) => [...countries.filter(c => !ids.includes(c)), ...[...ids].reverse()];
async function fixture(draw: (max: number) => number = max => max - 1) {
  const db = new PostgresDatabase(':memory:');
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  for (const id of ids) await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
  let now = 900001, calls = 0;
  const common = new DemoWalletStore(db);
  await common.ready;
  for (const id of ids) await common.operate(id, { id: randomUUID(), kind: 'deposit', amount: 1000 });
  const create = () => new FlagToteStore(db, id => common.snapshotInTransaction(id), common.ready, () => now, max => { calls++; return draw(max); });
  const store = create(); const round = (await store.snapshot(ids[0])).round;
  const bet = (country: FlagCountry, stakeUnits = '100') => ({ id: randomUUID(), roundId: round.id, rulesVersion: 1 as const, country, stakeUnits });
  return { db, ids, common, store, create, round, bet, clock: (v: number) => { now = v; }, calls: () => calls };
}
test('backed winner takes 95%; unbacked winner pays the nearest three backed flags 60/30/10', () => {
  const t = [ticket('FR', '10000' as any), ticket('BR'), ticket('RU')];
  // Actual allowed individual tickets, including supporters with unequal stakes.
  const tickets = [ticket('FR','100'), ticket('FR','200'), ticket('BR','500'), ticket('RU','200')];
  const result = settleFlagTote(tickets, podium(['JP','FR','BR','CN','RU']));
  assert.equal(result.potUnits, '1000'); assert.equal(result.feeUnits,'50');
  assert.deepEqual(result.awards, [{country:'FR',place:2,units:'570'},{country:'BR',place:3,units:'285'},{country:'RU',place:5,units:'95'}]);
  assert.deepEqual(result.payouts.map(p=>p.units),['190','380','285','95']);
  const direct = settleFlagTote(tickets,podium(['FR'])); assert.deepEqual(direct.awards,[{country:'FR',place:1,units:'950'}]);
  assert.equal(direct.payouts.reduce((n,p)=>n+BigInt(p.units),0n),950n);
  assert.throws(()=>settleFlagTote(t,podium(['FR'])));
});
test('rounding allocates every cent deterministically; fewer than three backed countries or two accounts fully refund',()=>{
  const a=randomUUID(),tickets=[ticket('FR','100',a),ticket('FR','200'),ticket('BR','100'),ticket('RU','100')];
  const result=settleFlagTote(tickets,podium(['JP','FR','BR','RU']));
  assert.equal(result.payouts.reduce((n,p)=>n+BigInt(p.units),0n)+BigInt(result.feeUnits),500n);
  assert.deepEqual(settleFlagTote(tickets,podium(['JP','FR','BR','RU'])),result);
  for(const incomplete of [tickets.slice(0,3),tickets.map(t=>({...t,accountId:a}))]){
    const refund=settleFlagTote(incomplete,countries);assert.equal(refund.state,'refunded');assert.equal(refund.feeUnits,'0');assert.deepEqual(refund.payouts.map(t=>t.units),incomplete.map(t=>t.stakeUnits));
  }
});
test('common wallet serializes concurrent tickets, replays exactly once, isolates ownership and never draws while open',async()=>{
  const f=await fixture();try{
    const op=f.bet('FR','500');const replies=await Promise.all(Array.from({length:8},()=>f.store.bet(f.ids[0],op)));
    assert.equal(replies.filter(r=>!r.replayed).length,1);assert.equal(await demoBalanceUnits(f.db,f.ids[0]),99500);assert.equal(await demoReservedUnits(f.db,f.ids[0]),TOTE_LIMITS.maxBank);assert.equal(f.calls(),0);
    assert(validToteSnapshot(replies[0]));assert.equal(replies[0].round.order,undefined);assert.equal(replies[0].round.seed,undefined);
    assert.equal((await f.store.snapshot(f.ids[1])).tickets.length,0);
    await assert.rejects(f.store.bet(f.ids[1],op));
    await assert.rejects(f.store.bet(f.ids[0],{...op,country:'BR'}));await assert.rejects(f.store.bet(f.ids[0],{...op,stakeUnits:'100'}));
    for(const extra of [{winner:'FR'},{seed:1},{order:countries}])await assert.rejects(f.store.bet(f.ids[0],{...f.bet('BR'),...extra}));
    assert.equal(await demoBalanceUnits(f.db,f.ids[0]),99500);
    await f.store.bet(f.ids[1],f.bet('BR','200'));await f.store.bet(f.ids[2],f.bet('RU','100'));
    f.clock(f.round.closesAt);await f.store.advance();assert.equal(f.calls(),48);
    const race=await f.store.snapshot(f.ids[0]);assert(validToteSnapshot(race));assert.equal(race.round.state,'racing');assert.equal(await demoBalanceUnits(f.db,f.ids[0]),99500);
    await assert.rejects(f.store.bet(f.ids[3],f.bet('JP')));assert.equal(await demoBalanceUnits(f.db,f.ids[3]),100000);
    const originalOrder=race.round.order;
    f.clock(f.round.finishesAt);await Promise.all([f.create().advance(),f.store.advance(),f.create().advance()]);
    const settled=await f.create().snapshot(f.ids[0]);assert(validToteSnapshot(settled));assert.equal(settled.round.state,'settled');assert.deepEqual(settled.round.order,originalOrder);assert.equal(f.calls(),48);
    const total=await Promise.all(f.ids.map(id=>demoBalanceUnits(f.db,id)));assert.equal(total.reduce((a,b)=>a+b,0),400000-40);
    assert.equal(await demoReservedUnits(f.db,f.ids[0]),0);const before=await demoBalanceUnits(f.db,f.ids[0]);
    const replay=await f.create().bet(f.ids[0],op);assert(replay.replayed);assert.equal(await demoBalanceUnits(f.db,f.ids[0]),before);
    const finals=await f.db.prepare("SELECT * FROM demo_ledger WHERE source='flag-tote' AND entry_type='win'").all();assert.equal(finals.length,3);
    const roundIds=JSON.stringify(await f.db.prepare('SELECT * FROM flag_tote_rounds').all());
    await f.create().advance();assert.equal(JSON.stringify(await f.db.prepare('SELECT * FROM flag_tote_rounds').all()),roundIds);
  }finally{await f.db.close();}
});
test('insufficient rounds fully refund without entropy; old ticket replay cannot move a stake to the new round',async()=>{
  const f=await fixture();try{
    const op=f.bet('FR','200');await f.store.bet(f.ids[0],op);f.clock(f.round.closesAt);await f.create().advance();
    assert.equal(f.calls(),0);assert.equal(await demoBalanceUnits(f.db,f.ids[0]),100000);assert.equal(await demoReservedUnits(f.db,f.ids[0]),0);
    const refund=await f.store.snapshot(f.ids[0]);assert(validToteSnapshot(refund));assert.equal(refund.round.state,'refunded');assert.equal(refund.tickets[0].payoutUnits,'200');
    f.clock(f.round.openedAt+TOTE_TIMING.period+1);const next=await f.store.snapshot(f.ids[0]);assert.notEqual(next.round.id,f.round.id);
    assert((await f.create().bet(f.ids[0],op)).replayed);await assert.rejects(f.store.bet(f.ids[0],{...op,roundId:next.round.id}));assert.equal(await demoBalanceUnits(f.db,f.ids[0]),100000);
  }finally{await f.db.close();}
});
test('wallet capacity is reserved before debit, protects later deposits and releases on refund',async()=>{
  const f=await fixture();try{
    await saveDemoUnits(f.db,f.ids[0],MAX_DEMO_UNITS-TOTE_LIMITS.maxBank+100);
    await f.store.bet(f.ids[0],f.bet('FR'));
    await assert.rejects(f.common.operate(f.ids[0],{id:randomUUID(),kind:'deposit',amount:1}));
    f.clock(f.round.closesAt);await f.store.advance();assert.equal(await demoReservedUnits(f.db,f.ids[0]),0);
    assert.equal(await demoBalanceUnits(f.db,f.ids[0]),MAX_DEMO_UNITS-TOTE_LIMITS.maxBank+100);
    await saveDemoUnits(f.db,f.ids[1],MAX_DEMO_UNITS);
    f.clock(f.round.openedAt+TOTE_TIMING.period+1);const next=await f.store.snapshot(f.ids[1]);
    await assert.rejects(f.store.bet(f.ids[1],{...f.bet('BR'),roundId:next.round.id}));assert.equal(await demoBalanceUnits(f.db,f.ids[1]),MAX_DEMO_UNITS);
  }finally{await f.db.close();}
});
test('a queued ticket rechecks the authoritative cutoff after taking its account lock',async()=>{
  const f=await fixture();try{
    let locked!:()=>void,release!:()=>void;const acquired=new Promise<void>(r=>locked=r),gate=new Promise<void>(r=>release=r);
    const blocker=f.db.transaction(async()=>{locked();await gate;},{lockKey:'account:'+f.ids[0]});await acquired;
    const pending=f.store.bet(f.ids[0],f.bet('FR'));await new Promise(r=>setTimeout(r,40));f.clock(f.round.closesAt);release();await blocker;
    await assert.rejects(pending);assert.equal(await demoBalanceUnits(f.db,f.ids[0]),100000);assert.equal((await f.store.snapshot(f.ids[0])).tickets.length,0);
  }finally{await f.db.close();}
});
test('invalid entropy rolls back the closed draw and a retry preserves all held stakes',async()=>{
  const f=await fixture(()=>-1);try{
    for(let i=0;i<3;i++)await f.store.bet(f.ids[i],f.bet(countries[i]));f.clock(f.round.closesAt);
    await assert.rejects(f.store.advance());assert.equal((await f.db.prepare('SELECT state FROM flag_tote_rounds WHERE id=?').get(f.round.id))!.state,'open');
    for(let i=0;i<3;i++){assert.equal(await demoBalanceUnits(f.db,f.ids[i]),99900);assert.equal(await demoReservedUnits(f.db,f.ids[i]),TOTE_LIMITS.maxBank);}
    const recovered=new FlagToteStore(f.db,id=>f.common.snapshotInTransaction(id),f.common.ready,()=>f.round.finishesAt,max=>max-1);await recovered.advance();
    assert.equal((await recovered.snapshot(f.ids[0])).round.state,'settled');
  }finally{await f.db.close();}
});
test('all 48 countries can win through the production shuffle; invalid bounds are rejected',()=>{
  for(let winner=0;winner<48;winner++){let first=true;const r=drawToteOrder(max=>{if(first){first=false;return winner;}return max-1;});assert.equal(r.order.at(-1),countries[winner]);assert.equal(new Set(r.order).size,48);}
  for(const value of [-1,48,NaN,Infinity,0.5])assert.throws(()=>drawToteOrder(()=>value));
});
