import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { seededRandom } from '../src/shared/draconaMath';
import { NEOPOLIS_GAME, validNeopolisSession } from '../src/shared/neopolis';

async function setup() {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet = new DemoWalletStore(db, () => 0);
  await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 10000 });
  await wallet.expansion.ready;
  const random = seededRandom(42); let draws = 0;
  const draw = (max: number) => { draws++; return Math.floor(random() * max); };
  const createStore = () => new DemoExpansionStore(db, async account => ({ balance: await demoBalanceUnits(db, account) / 100, entries: [] }), wallet.ready, async () => {}, draw, () => 0);
  const start = () => ({ id: randomUUID(), gameId: NEOPOLIS_GAME, action: 'start' as const, stakeUnits: '10000', settings: { neopolis: { hero: 'granite' as const } } });
  return { db, store: createStore(), createStore, start, draws: () => draws };
}

test('paid spins preserve account-owned team progress and concurrent UUID retries settle once', async () => {
  const f = await setup();
  try {
    const before = await demoBalanceUnits(f.db, 'alice'), action = f.start();
    const replies = await Promise.all(Array.from({ length: 4 }, () => f.store.operate('alice', action)));
    assert(replies.every(reply => validNeopolisSession(reply.session)));
    assert.equal(replies.filter(reply => !reply.replayed).length, 1);
    const first = replies[0].session, draws = f.draws();
    await f.store.operate('alice', action); assert.equal(f.draws(), draws);
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 10000 + Number(first.returnedUnits));
    assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    await assert.rejects(f.store.operate('alice', { ...action, stakeUnits: '20000' }));
    await assert.rejects(f.store.operate('alice', { ...f.start(), stakeUnits: '20000' }));
    const restored = f.createStore(), next = await restored.operate('alice', f.start());
    assert.deepEqual(next.session.view.neopolis!.origin, first.view.neopolis!.team);
    const bob = await restored.operate('bob', f.start()).catch(() => null);
    assert.equal(bob, null);
    const legacy = await restored.active('alice', true, true, true, true, true, true, true, true, false);
    assert.equal(legacy.sessions.some(session => session.gameId === NEOPOLIS_GAME), false);
    await assert.rejects(restored.operate('alice', f.start(), 2, true, true, true, true, true, true, true, true, true, false));
  } finally { await f.db.close(); }
});

test('a saved bonus survives store recreation, rejects stale moves and credits the complete series once', async () => {
  const f = await setup();
  try {
    let paid = 0, returned = 0, first;
    for (let n = 0; n < 35; n++) {
      const reply = await f.store.operate('alice', f.start()); paid += 10000;
      assert(validNeopolisSession(reply.session));
      if (reply.session.state === 'active') { first = reply.session; break; }
      returned += Number(reply.session.returnedUnits);
    }
    assert(first); assert.equal(first.view.neopolis!.battle!.remaining, 10);
    assert(await demoReservedUnits(f.db, 'alice') > 0);
    await assert.rejects(f.store.operate('alice', f.start()));
    const restored = f.createStore();
    let session = (await restored.active('alice')).sessions.find(session => session.gameId === NEOPOLIS_GAME)!;
    assert.deepEqual(session, first);
    const move = { id: randomUUID(), gameId: NEOPOLIS_GAME, action: 'move' as const, sessionId: session.id, move: 'neopolis-spin', revision: session.view.neopolis!.revision };
    await assert.rejects(restored.operate('bob', move));
    const parallel = await Promise.allSettled([restored.operate('alice', move), restored.operate('alice', { ...move, id: randomUUID() })]);
    assert.equal(parallel.filter(reply => reply.status === 'fulfilled').length, 1);
    session = (await restored.active('alice')).sessions.find(session => session.gameId === NEOPOLIS_GAME)!;
    let last = move;
    while (session.state === 'active') {
      last = { ...move, id: randomUUID(), revision: session.view.neopolis!.revision };
      session = (await restored.operate('alice', last)).session;
      assert(validNeopolisSession(session));
      assert.equal(session.spentUnits, '10000');
    }
    returned += Number(session.returnedUnits);
    const balance = await demoBalanceUnits(f.db, 'alice');
    assert.equal(balance, 1000000 - paid + returned);
    assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    const draws = f.draws(); await restored.operate('alice', last);
    assert.equal(f.draws(), draws); assert.equal(await demoBalanceUnits(f.db, 'alice'), balance);
    await assert.rejects(restored.operate('alice', { ...last, id: randomUUID() }));
    const fresh = await restored.operate('alice', { ...f.start(), stakeUnits: '20000', settings: { neopolis: { hero: 'prism' } } });
    assert.equal(fresh.session.view.neopolis!.origin.starter, 'prism');
    assert.deepEqual(fresh.session.view.neopolis!.origin.charges, [0,0,3]);
  } finally { await f.db.close(); }
});
