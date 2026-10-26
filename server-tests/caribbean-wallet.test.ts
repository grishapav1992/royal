import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { CARIBBEAN_GAME, caribbeanInitialCost, type CaribbeanStartMode } from '../src/shared/caribbeanTreasures';
import { caribbeanMaximumFactor, validCaribbeanSession } from '../src/shared/caribbeanTransport';
import { validExpansionAction, type ExpansionSession } from '../src/shared/casinoExpansion';
import type { CaribbeanLineCount } from '../src/shared/caribbeanTreasuresMath';

async function fixture(zero = false) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet = new DemoWalletStore(db,() => 0);
  await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:10000});
  let draws = 0, clock = 0;
  const createStore = () => new DemoExpansionStore(db,id => wallet.snapshot(id),wallet.ready,async () => {},
    maximum => { draws++; return zero ? 0 : maximum - 1; },() => { clock += 1000; return clock; });
  const store = createStore(); await store.ready;
  const start = (lines:CaribbeanLineCount = 20,stakeUnits = '100',mode:CaribbeanStartMode = 'normal') =>
    ({id:randomUUID(),gameId:CARIBBEAN_GAME,action:'start' as const,stakeUnits,settings:{caribbean:{lines,mode}}});
  return {db,wallet,store,createStore,start,draws:() => draws};
}
async function complete(f:Awaited<ReturnType<typeof fixture>>,session:ExpansionSession,tactic = 'raid') {
  let last:unknown;
  while (session.state === 'active') {
    const view = session.view.caribbean!;
    last = {id:randomUUID(),gameId:CARIBBEAN_GAME,action:'move',sessionId:session.id,
      move:view.phase === 'choice' ? 'caribbean-choose-' + tactic : 'caribbean-spin',revision:view.revision};
    const before = await demoBalanceUnits(f.db,'alice');
    const reply = await f.store.operate('alice',last);
    session = reply.session; assert(validCaribbeanSession(session));
    const credit = session.state === 'settled' ? Number(session.returnedUnits) : 0;
    assert.equal(await demoBalanceUnits(f.db,'alice'),before + credit);
  }
  return {session,last};
}
test('every line, line stake and paid mode uses the qualified price, integer credit and exact reserve',async () => {
  const f = await fixture();
  try {
    for (const lines of [1,5,10,20] as const) for (const stake of ['100','200','500','1000'])
      for (const mode of ['normal','buy-raid','buy-flagship'] as const) {
        const operation = f.start(lines,stake,mode), before = await demoBalanceUnits(f.db,'alice');
        const reply = await f.store.operate('alice',operation);
        assert(validCaribbeanSession(reply.session));
        const cost = caribbeanInitialCost(operation.settings.caribbean,stake);
        assert.equal(reply.session.spentUnits,cost);
        assert.equal(await demoBalanceUnits(f.db,'alice'),before - Number(cost) + Number(reply.session.returnedUnits));
        assert.equal(await demoReservedUnits(f.db,'alice'),reply.session.state === 'active'
          ? Number(stake) * caribbeanMaximumFactor(operation.settings) : 0);
        const end = await complete(f,reply.session);
        assert(validCaribbeanSession(end.session)); assert.equal(end.session.spentUnits,cost);
        assert.equal(await demoReservedUnits(f.db,'alice'),0);
        assert.equal(await demoBalanceUnits(f.db,'alice'),before - Number(cost) + Number(end.session.returnedUnits));
      }
  } finally { await f.db.close(); }
});
test('concurrent identical starts debit once and a lost reply is recovered using the same operation',async () => {
  const f = await fixture(true);
  try {
    const op = f.start(), before = await demoBalanceUnits(f.db,'alice');
    const replies = await Promise.all(Array.from({length:4},() => f.store.operate('alice',op)));
    assert.equal(replies.filter(reply => !reply.replayed).length,1);
    assert(replies.every(reply => validCaribbeanSession(reply.session)));
    assert.equal(await demoBalanceUnits(f.db,'alice'),before - 2000);
    const draws = f.draws(), retry = await f.createStore().operate('alice',op);
    assert(retry.replayed); assert.equal(f.draws(),draws); assert.deepEqual(retry.session,replies[0].session);
    await assert.rejects(f.store.operate('alice',{...op,settings:{caribbean:{lines:1,mode:'normal'}}}));
    assert.equal(await demoBalanceUnits(f.db,'alice'),before - 2000);
    assert.equal(Number((await f.db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE account_id='alice' AND kind='bet'").get())!.n),1);
  } finally { await f.db.close(); }
});
test('natural series survives reopening, locks settings, rejects stale moves and settles exactly once',async () => {
  const f = await fixture(true);
  try {
    const before = await demoBalanceUnits(f.db,'alice'), start = await f.store.operate('alice',f.start());
    const restored = f.createStore(), session = (await restored.active('alice')).sessions.find(s => s.gameId === CARIBBEAN_GAME)!;
    assert(validCaribbeanSession(session)); assert.deepEqual(session,start.session);
    assert.equal(session.view.caribbean!.phase,'choice');
    await assert.rejects(restored.operate('alice',f.start(1,'1000')));
    const action = {id:randomUUID(),gameId:CARIBBEAN_GAME,action:'move' as const,sessionId:session.id,move:'caribbean-choose-raid',revision:1};
    await assert.rejects(restored.operate('bob',action));
    const selected = await restored.operate('alice',action);
    await assert.rejects(restored.operate('alice',{...action,id:randomUUID()}));
    const end = await complete({...f,store:restored},selected.session);
    const balance = await demoBalanceUnits(f.db,'alice'), draws = f.draws();
    const replay = await restored.operate('alice',end.last);
    assert(replay.replayed); assert.equal(await demoBalanceUnits(f.db,'alice'),balance); assert.equal(f.draws(),draws);
    assert.equal(balance,before - 2000 + Number(end.session.returnedUnits));
    assert.equal(await demoReservedUnits(f.db,'alice'),0);
    assert.equal(Number((await f.db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE account_id='alice' AND kind='win'").get())!.n),1);
  } finally { await f.db.close(); }
});
test('insufficient balance rejects the purchase before any random draw or debit',async () => {
  const f = await fixture(true);
  try {
    const balance = await demoBalanceUnits(f.db,'alice');
    const op = f.start(20,'1000','buy-raid');
    const poor = await f.wallet.snapshot('bob');
    assert.equal(poor.balance,0);
    const before = f.draws(); await assert.rejects(f.store.operate('bob',op));
    assert.equal(f.draws(),before); assert.equal((await f.wallet.snapshot('bob')).balance,0);
    assert(balance > 0);
  } finally { await f.db.close(); }
});
test('malformed actions and forged saved state cannot alter the ledger',async () => {
  const f = await fixture(true);
  try {
    const malformed = {...f.start(),settings:{caribbean:{lines:20,mode:'normal',payout:'1000000'}}};
    assert(!validExpansionAction(malformed)); await assert.rejects(f.store.operate('alice',malformed));
    const start = await f.store.operate('alice',f.start());
    const row = await f.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get('alice',start.session.id);
    const corrupt = JSON.parse(row!.payload); corrupt.view.caribbean.totalPayoutUnits = '9999999';
    await f.db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?').run(JSON.stringify(corrupt),'alice',start.session.id);
    const balance = await demoBalanceUnits(f.db,'alice'), draws = f.draws();
    await assert.rejects(f.store.operate('alice',{id:randomUUID(),gameId:CARIBBEAN_GAME,action:'move',sessionId:start.session.id,move:'caribbean-choose-raid',revision:1}));
    assert.equal(await demoBalanceUnits(f.db,'alice'),balance); assert.equal(f.draws(),draws);
  } finally { await f.db.close(); }
});
