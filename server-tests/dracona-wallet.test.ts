import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { DRACONA_GAME, validDraconaSession } from '../src/shared/dracona';
import { seededRandom } from '../src/shared/draconaMath';
import { playSpin as playSpinV1 } from '../src/shared/draconaMathV1';
import type { DraconaView } from '../src/shared/dracona';

async function setup(seed = 1) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet = new DemoWalletStore(db, () => 0);
  await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 10000 });
  await wallet.expansion.ready;
  const rng = seededRandom(seed); let draws = 0;
  const draw = (max: number) => { draws++; return Math.floor(rng() * max); };
  const store = new DemoExpansionStore(db, async account => ({ balance: await demoBalanceUnits(db, account) / 100, entries: [] }), wallet.ready, async () => {}, draw);
  const start = () => ({ id: randomUUID(), gameId: DRACONA_GAME, action: 'start' as const, stakeUnits: '10000', settings: { dracona: { mode: 'normal' as const } } });
  return { db, wallet, store, draw, start, draws: () => draws };
}

test('a paid spin and concurrent retries debit and credit the shared wallet exactly once', async () => {
  const f = await setup(5);
  try {
    const before = await demoBalanceUnits(f.db, 'alice'), action = f.start();
    const replies = await Promise.all(Array.from({ length: 5 }, () => f.store.operate('alice', action)));
    assert(replies.every(reply => validDraconaSession(reply.session) && reply.session.returnedUnits === '11189'));
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 10000 + 11189);
    assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    const draws = f.draws();
    await f.store.operate('alice', action); assert.equal(f.draws(), draws);
    await assert.rejects(f.store.operate('alice', { ...action, stakeUnits: '20000' }));
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before + 1189);
  } finally { await f.db.close(); }
});

test('saved bonus survives reload, rejects stale parallel moves and pays the series once', async () => {
  const f = await setup();
  try {
    const before = await demoBalanceUnits(f.db, 'alice'), action = f.start();
    const first = await f.store.operate('alice', action);
    assert.equal(first.session.view.dracona!.remaining, 8);
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 10000);
    assert(await demoReservedUnits(f.db, 'alice') > 0);
    await assert.rejects(f.store.operate('alice', f.start()));
    const move = { id: randomUUID(), gameId: DRACONA_GAME, action: 'move' as const, sessionId: action.id, move: 'dracona-spin', revision: 1 };
    await assert.rejects(f.store.operate('bob', move));
    const parallel = await Promise.allSettled([f.store.operate('alice', move), f.store.operate('alice', { ...move, id: randomUUID() })]);
    assert.equal(parallel.filter(reply => reply.status === 'fulfilled').length, 1);
    const restored = new DemoExpansionStore(f.db, async account => ({ balance: await demoBalanceUnits(f.db, account) / 100, entries: [] }), f.wallet.ready, async () => {}, f.draw);
    let session = (await restored.active('alice')).sessions.find(session => session.id === action.id)!;
    assert.equal(session.view.dracona!.revision, 2);
    let last = move;
    while (session.state === 'active') {
      last = { ...move, id: randomUUID(), revision: session.view.dracona!.revision };
      session = (await restored.operate('alice', last)).session;
      assert(validDraconaSession(session));
    }
    const expected = before - 10000 + Number(session.returnedUnits);
    assert.equal(await demoBalanceUnits(f.db, 'alice'), expected);
    assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    await restored.operate('alice', last);
    assert.equal(await demoBalanceUnits(f.db, 'alice'), expected);
    await assert.rejects(restored.operate('alice', { ...last, id: randomUUID() }));
  } finally { await f.db.close(); }
});

test('older clients do not receive or start incompatible Dracona sessions', async () => {
  const f = await setup();
  try {
    const before = await demoBalanceUnits(f.db, 'alice');
    await assert.rejects(f.store.operate('alice', f.start(), 2, true, true, true, true, true, true, true, true, false));
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before);
    const action = f.start();
    const oldOperate = (op: Parameters<typeof f.store.operate>[1]) => f.store.operate('alice',op,2,true,true,true,true,true,true,true,true,true);
    await assert.rejects(oldOperate(action), /refresh|Обнови/);
    await f.store.operate('alice', action);
    await assert.rejects(oldOperate(action), /refresh|Обнови/);
    const legacy = await f.store.active('alice', true, true, true, true, true, true, true, false);
    assert.equal(legacy.sessions.some(session => session.gameId === DRACONA_GAME), false);
  } finally { await f.db.close(); }
});

test('a saved Dracona v1 bonus retains its old paytable and settles once through an older client', async () => {
  const f = await setup(1);
  try {
    const before = await demoBalanceUnits(f.db,'alice'), action = f.start();
    const current = (await f.store.operate('alice',action)).session;
    assert.equal(current.state,'active');
    const random = seededRandom(1), draws:number[]=[];
    const result = playSpinV1({bet:100,random:()=>{const draw=Math.floor(random()*4294967296);draws.push(draw);return draw/4294967296;}});
    const legacy:DraconaView={kind:'dracona',version:1,revision:1,history:[{draws,result}],totalPayoutUnits:String(result.payout*100),remaining:result.bonusAward,bonusAwarded:result.bonusAward,freePlayed:0};
    const row=await f.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get('alice',current.id);
    const saved=JSON.parse(row!.payload);saved.rulesVersion=2;saved.view.dracona=legacy;
    await f.db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?').run(JSON.stringify(saved),'alice',current.id);
    const restored=new DemoExpansionStore(f.db,async account=>({balance:await demoBalanceUnits(f.db,account)/100,entries:[]}),f.wallet.ready,async()=>{},f.draw);
    let session=(await restored.active('alice')).sessions.find(s=>s.id===current.id)!;
    let last:Parameters<typeof restored.operate>[1]=action;
    while(session.state==='active') {
      last={id:randomUUID(),action:'move',gameId:DRACONA_GAME,sessionId:session.id,move:'dracona-spin',revision:session.view.dracona!.revision};
      session=(await restored.operate('alice',last,2,true,true,true,true,true,true,true,true,true)).session;
      assert.equal(session.rulesVersion,2);assert.equal(session.view.dracona!.version,1);assert(validDraconaSession(session));
    }
    assert.equal(await demoBalanceUnits(f.db,'alice'),before-10000+Number(session.returnedUnits));
    const count=f.draws();await restored.operate('alice',last);assert.equal(f.draws(),count);
    assert.equal(await demoReservedUnits(f.db,'alice'),0);
    const fresh=(await restored.operate('alice',f.start())).session;
    assert.equal(fresh.rulesVersion,3);assert.equal(fresh.view.dracona!.version,2);
  } finally {await f.db.close();}
});

test('the largest declared stake persists its complete liability above a 32-bit integer', async () => {
  const f = await setup();
  try {
    const before = await demoBalanceUnits(f.db, 'alice');
    const result = await f.store.operate('alice', { ...f.start(), stakeUnits: '50000' });
    assert.equal(result.session.state, 'active');
    assert(validDraconaSession(result.session));
    assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 50000);
    assert.equal(await demoReservedUnits(f.db, 'alice'), 5000000000);
  } finally { await f.db.close(); }
});
