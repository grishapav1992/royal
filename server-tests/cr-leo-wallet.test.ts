import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { PENALTY_GAME, penaltyQuote, penaltyPathQuote, type PenaltyRisk } from '../src/shared/crLeo';

async function setup() {
  const db = new PostgresDatabase(':memory:'); await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet = new DemoWalletStore(db, () => 0); await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 10000 }); await wallet.expansion.ready;
  let goal = true, draws = 0;
  const store = new DemoExpansionStore(db, async id => ({ balance: await demoBalanceUnits(db, id) / 100, entries: [] }), wallet.ready, async () => {}, max => { if (max === 100) draws++; return max === 100 && !goal ? 99 : 0; });
  const start = () => ({ id: randomUUID(), gameId: PENALTY_GAME, action: 'start' as const, stakeUnits: '50000', settings: { penalty: { hero: 'leo' as const, risk: 'sharp' as const } } });
  return { db, wallet, store, start, goal: (v: boolean) => goal = v, draws: () => draws };
}
test('start debits once, concurrent duplicate cashouts credit once and release the reserve', async () => {
  const f = await setup(); try {
    const before = await demoBalanceUnits(f.db, 'alice'), action = f.start();
    const first = await f.store.operate('alice', action); assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 50000); assert(await demoReservedUnits(f.db, 'alice') > 0);
    assert.equal(first.session.view.penalty?.availableUnits, '82500');
    await f.store.operate('alice', action); assert.equal(f.draws(), 1); assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 50000);
    const bank = { id: randomUUID(), gameId: PENALTY_GAME, action: 'move' as const, sessionId: action.id, move: 'cashout', revision: 1 };
    const replies = await Promise.all(Array.from({ length: 6 }, () => f.store.operate('alice', bank)));
    assert(replies.every(r => r.session.returnedUnits === '82500')); assert.equal(f.draws(), 1);
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before + 32500); assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    await assert.rejects(f.store.operate('alice', { ...bank, id: randomUUID() }));
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before + 32500);
  } finally { await f.db.close(); }
});
test('series survives store reload, fifth goal auto-pays and stale parallel commands cannot add shots', async () => {
  const f = await setup(); try {
    const action = f.start(), before = await demoBalanceUnits(f.db, 'alice'); await f.store.operate('alice', action);
    const move = { id: randomUUID(), gameId: PENALTY_GAME, action: 'move' as const, sessionId: action.id, move: 'penalty-kick', revision: 1 };
    const parallel = await Promise.allSettled([f.store.operate('alice', move), f.store.operate('alice', { ...move, id: randomUUID() })]); assert.equal(parallel.filter(r => r.status === 'fulfilled').length, 1);
    const reloaded = new DemoExpansionStore(f.db, async id => ({ balance: await demoBalanceUnits(f.db, id) / 100, entries: [] }), f.wallet.ready, async () => {}, () => 0);
    const saved = (await reloaded.active('alice')).sessions.find(s => s.id === action.id)!; assert.equal(saved.view.penalty?.shots.length, 2);
    for (let revision = 2; revision <= 4; revision++) await reloaded.operate('alice', { ...move, id: randomUUID(), revision });
    const final = (await reloaded.active('alice')).sessions.find(s => s.id === action.id)!; assert.equal(final.state, 'settled'); assert.equal(final.returnedUnits, penaltyQuote('50000', 'sharp', 5));
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 50000 + Number(final.returnedUnits)); assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
  } finally { await f.db.close(); }
});
test('a miss after goals loses the entire stake; other accounts cannot access or finish the series', async () => {
  const f = await setup(); try {
    const before = await demoBalanceUnits(f.db, 'alice'), action = f.start(); await f.store.operate('alice', action);
    const move = { id: randomUUID(), gameId: PENALTY_GAME, action: 'move' as const, sessionId: action.id, move: 'penalty-kick', revision: 1 };
    await assert.rejects(f.store.operate('bob', move)); f.goal(false);
    const result = await f.store.operate('alice', move); assert.equal(result.session.state, 'settled'); assert.equal(result.session.returnedUnits, '0');
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 50000); assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    await f.store.operate('alice', move); assert.equal(f.draws(), 2);
    assert.equal(JSON.stringify(result).includes('crashPoint'), false);
  } finally { await f.db.close(); }
});
test('mixed-risk attempts survive reload and retry, reject changed retry payloads and settle the exact path once',async()=>{
  const f=await setup();try{
    const before=await demoBalanceUnits(f.db,'alice'),start=f.start();await f.store.operate('alice',start);
    const next={id:randomUUID(),gameId:PENALTY_GAME,action:'move' as const,sessionId:start.id,move:'penalty-kick',revision:1,penaltyRisk:'safe' as const};
    const results=await Promise.all(Array.from({length:4},()=>f.store.operate('alice',next)));
    assert(results.every(r=>r.session.view.penalty?.availableUnits==='110000'));assert.equal(f.draws(),2);
    await assert.rejects(f.store.operate('alice',{...next,penaltyRisk:'extreme'}));assert.equal(f.draws(),2);
    const reloaded=new DemoExpansionStore(f.db,async id=>({balance:await demoBalanceUnits(f.db,id)/100,entries:[]}),f.wallet.ready,async()=>{},()=>0);
    const path:PenaltyRisk[]=['sharp','safe','extreme','safe','sharp'];
    for(let revision=2;revision<5;revision++)await reloaded.operate('alice',{...next,id:randomUUID(),revision,penaltyRisk:path[revision]});
    const final=(await reloaded.active('alice')).sessions.find(s=>s.id===start.id)!;
    assert.deepEqual(final.view.penalty?.shots.map(s=>s.risk),path);assert.equal(final.returnedUnits,penaltyPathQuote('50000',path));
    assert.equal(await demoBalanceUnits(f.db,'alice'),before-50000+Number(final.returnedUnits));assert.equal(await demoReservedUnits(f.db,'alice'),0);
  }finally{await f.db.close();}
});
