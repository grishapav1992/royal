import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {VirtualPvpLedger} from '../server/pvp/virtual-wallet';
import {PvpStore} from '../server/pvp/store';
import {virtualPvpCommand} from '../server/pvp/virtual-service';
import {demoBalanceUnits,saveDemoUnits,MAX_DEMO_UNITS,demoReservedUnits} from '../server/demoWalletAmounts';
import {CommonSkinPayments} from '../server/skinPayments';
import {NileCombatEscrow} from '../server/finance/combat-escrow';
import {saveProviderPendingUnits} from '../server/providerPending';
import {PVP_GAMES,PVP_INVITE_MS,STANDARD_PVP_RULES_VERSION,isStandardPvpGame,validVirtualPvpWallet,VIRTUAL_PVP_SCOPE} from '../src/shared/pvp';
import {savedTower,seedDemoTower} from './helpers/removed-tower';

async function fixture(amount=200){
 const db=new PostgresDatabase(':memory:'),a=randomUUID(),b=randomUUID();
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');for(const id of[a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
 const common=new DemoWalletStore(db);await common.ready;
 for(const id of[a,b])await common.operate(id,{id:randomUUID(),kind:'deposit',amount});
 const ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger);await store.ready;
 const aa={accountId:a,name:'Анна',roomId:'virtual-test'},bb={accountId:b,name:'Борис',roomId:'virtual-test'},now=Date.now();
 const people=[aa,bb].map(p=>({accountId:p.accountId,name:p.name,connected:true,available:true}));await store.syncRoom(aa.roomId,people,now);
 const match=(gameId='chess',stakeUnits='50000000')=>({matchId:randomUUID(),gameId,stakeUnits});
 return{db,a,b,aa,bb,now,people,common,ledger,store,match,close:()=>db.close(),balance:(id:string)=>demoBalanceUnits(db,id)};
}

async function holdSchemaLock(db: PostgresDatabase) {
  const holder = await db.pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [db.schema]);
  } catch (error) {
    holder.release(true);
    throw error;
  }
  return {
    async expectWaiter() {
      const deadline = performance.now() + 2000;
      do {
        const { rows: [result] } = await holder.query<{ waiting: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_locks l WHERE l.locktype='advisory' AND NOT l.granted
            AND pg_backend_pid()=ANY(pg_blocking_pids(l.pid))) AS waiting`);
        if (result.waiting) return;
        await delay(10);
      } while (performance.now() < deadline);
      assert.fail('Expected a transaction to wait on the fixture schema lock');
    },
    async release() {
      try {
        await holder.query('ROLLBACK');
      } catch (error) {
        holder.release(true);
        throw error;
      }
      holder.release();
    },
  };
}

async function syncWaitingForSchema<T>(db: PostgresDatabase, startSync: () => Promise<T>) {
  const blocker = await holdSchemaLock(db);
  try {
    const syncing = startSync();
    void syncing.catch(() => {});
    await blocker.expectWaiter();
    return syncing;
  } finally {
    await blocker.release();
  }
}

function lockedWalletReference(db: PostgresDatabase, common: DemoWalletStore, accountId: string) {
  return db.transaction(async () => {
    const wallet = await common.snapshotInTransaction(accountId);
    const held = await db.prepare("SELECT coalesce(sum(stake_units),0) AS n FROM virtual_pvp_holds WHERE account_id=? AND state='held'")
      .get(accountId);
    return { scope: VIRTUAL_PVP_SCOPE, state: 'assigned', ready: true, wallet,
      balanceUnits: String(Math.round(wallet.balance * 100) * 10000), reservedUnits: String(Number(held!.n) * 10000) };
  }, { lockKey: 'account:' + accountId });
}

test('idle virtual room sync bypasses the schema lock while live sync keeps it', { timeout: 10000 }, async () => {
  const c = await fixture();
  try {
    await c.common.operate(c.a, { id: randomUUID(), kind: 'spin', amount: 10 });
    await saveProviderPendingUnits(c.db, c.a, 'capro:' + randomUUID(), 123n, 123n, 'credit');
    const expected = await Promise.all([c.a, c.b].map(id => lockedWalletReference(c.db, c.common, id)));
    assert.equal(expected[0].wallet.pendingBalance, '1.23');
    const blocker = await holdSchemaLock(c.db);
    try {
      const idle = await Promise.race([c.store.syncRoomState(c.aa.roomId, c.people, c.now), delay(2000, null, { ref: false })]);
      assert(idle, 'Idle projection must finish before the schema lock is released');
      assert.deepEqual(idle.matches, []);
      assert.deepEqual(idle.snapshots.map(row => row.accountId), [c.a, c.b]);
      assert.deepEqual(idle.snapshots.map(row => row.snapshot.wallet), expected);
    } finally {
      await blocker.release();
    }

    const opened = await c.store.command(c.aa, {
      id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.b,
    }, c.now);
    assert(opened.active);
    const live = await syncWaitingForSchema(c.db, () => c.store.syncRoomState(c.aa.roomId, c.people, c.now));
    assert.deepEqual(live.matches, [opened.active]);
    assert.equal(live.snapshots[0].snapshot.active?.id, opened.active.id);
    assert.deepEqual(live.snapshots.map(row => row.snapshot.wallet),
      await Promise.all([c.a, c.b].map(id => lockedWalletReference(c.db, c.common, id))));
  } finally {
    await c.close();
  }
});

test('idle virtual room with a retained casino round settles under the schema lock', { timeout: 10000 }, async () => {
  const c = await fixture();
  try {
    const historical = await seedDemoTower(c.db, c.a, savedTower([]));
    assert.equal(await c.balance(c.a), 19000);
    const result = await syncWaitingForSchema(c.db, () => c.store.syncRoomState(c.aa.roomId, c.people, c.now));
    assert.deepEqual(result.matches, []);
    const wallet = result.snapshots[0].snapshot.wallet;
    assert(validVirtualPvpWallet(wallet));
    assert.equal(wallet.balanceUnits, '200000000');
    assert.deepEqual(wallet.wallet.entries.filter(entry => entry.operationId === historical.id).map(entry => entry.kind), ['refund', 'bet']);
    assert.equal((await c.db.prepare('SELECT reason FROM removed_casino_settlements WHERE account_id=? AND session_id=?')
      .get(c.a, historical.id))?.reason, 'refund');
    assert.deepEqual(wallet, await lockedWalletReference(c.db, c.common, c.a));
  } finally {
    await c.close();
  }
});

test('idle virtual room sync keeps one snapshot when a paid match opens during projection', { timeout: 10000 }, async t => {
  const c = await fixture();
  const probed = Promise.withResolvers<boolean>(), resume = Promise.withResolvers<void>();
  try {
    const expected = await lockedWalletReference(c.db, c.common, c.a);
    const db = c.db as unknown as { query(sql: string, values?: unknown[]): Promise<unknown> };
    const query = db.query.bind(db);
    let first = true;
    t.mock.method(db, 'query', async (sql: string, values?: unknown[]) => {
      const result = await query(sql, values);
      if (first && /SELECT 1 FROM pvp_matches WHERE room_id=/i.test(sql)) {
        first = false;
        probed.resolve(true);
        await resume.promise;
      }
      return result;
    });
    const syncing = c.store.syncRoomState(c.aa.roomId, c.people, c.now);
    void syncing.catch(() => {});
    try {
      assert(await Promise.race([probed.promise, delay(2000, false, { ref: false })]));
      const created = await c.store.command(c.aa, {
        id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.b,
      }, c.now + 1);
      assert.equal(created.active?.status, 'open');
      assert(validVirtualPvpWallet(created.wallet));
      assert.equal(created.wallet.reservedUnits, '50000000');
    } finally {
      resume.resolve();
    }
    const idle = await syncing;
    assert.deepEqual(idle.matches, []);
    assert.equal(idle.snapshots[0].snapshot.active, null);
    assert.deepEqual(idle.snapshots[0].snapshot.wallet, expected);
  } finally {
    await c.close();
  }
});
test('PvP and slots spend the same top-up; 50+50 returns 95 with a single 5 USDT fee',async()=>{
 const c=await fixture();try{
  const m=c.match();await c.ledger.pvpHold(c.a,m);await c.ledger.pvpHold(c.b,m);
  await c.ledger.pvpHold(c.a,m);assert.equal((await c.common.snapshot(c.a)).balance,150);
  const finish={matchId:m.matchId,winnerId:c.a,reason:'win'};
  await Promise.all([c.ledger.pvpFinish(c.a,finish),c.ledger.pvpFinish(c.a,finish)]);
  assert.equal(await c.balance(c.a),24500);assert.equal(await c.balance(c.b),15000);
  assert.equal(Number((await c.db.prepare('SELECT fee_units FROM virtual_pvp_banks').get())!.fee_units),500);
  await assert.rejects(c.ledger.pvpFinish(c.a,{...finish,winnerId:c.b}));
  const result=await c.common.operate(c.a,{id:randomUUID(),kind:'spin',amount:10});
  assert.equal(result.wallet.balance,235+result.round!.payout);
  assert(validVirtualPvpWallet(await c.ledger.wallet(c.a)));
 }finally{await c.close();}
});
test('virtual PvP batches hold admission and finish metadata without changing receipt precedence', async t => {
  const c = await fixture();
  try {
    const other = randomUUID();
    await c.db.prepare('INSERT INTO accounts VALUES (?)').run(other);
    await c.common.operate(other, { id: randomUUID(), kind: 'deposit', amount: 200 });
    const queries = t.mock.method(c.db as unknown as { query(sql: string, values?: unknown[]): Promise<unknown> }, 'query');
    const takeQueries = () => {
      const calls = queries.mock.calls.map(call => call.arguments);
      queries.mock.resetCalls();
      return calls;
    };
    const bankOrHold = /\b(?:from|join)\s+virtual_pvp_(?:banks|holds)\b/i;
    const match = c.match();
    const holdReads: string[][] = [];
    for (const accountId of [c.a, c.b]) {
      const accepted = await c.ledger.pvpHold(accountId, match, c.now);
      assert.equal(accepted.replayed, false);
      assert.equal(accepted.wallet.balanceUnits, '150000000');
      assert.equal(accepted.wallet.reservedUnits, '50000000');
      const calls = takeQueries();
      const balance = calls.findIndex(([sql]) => /\bselect\s+balance,fraction_units\s+from\s+demo_wallets\b/i.test(sql));
      const capacity = calls.findIndex(([sql]) => /\bfrom\s+demo_mines_sessions\b/i.test(sql));
      const firstWrite = calls.findIndex(([sql]) => /\binsert\s+into\s+virtual_pvp_(?:banks|holds)\b/i.test(sql));
      assert(balance >= 0 && balance < capacity && capacity < firstWrite, 'balance and capacity checks precede the hold write');
      holdReads.push(calls.slice(0, balance).map(([sql]) => sql).filter(sql => bankOrHold.test(sql)));
    }

    await assert.rejects(c.ledger.pvpHold(other, match, c.now), { code: 'pvp_unavailable' });
    await c.ledger.pvpHold(other, c.match(), c.now);
    await assert.rejects(c.ledger.pvpHold(other, match, c.now), { code: 'Сначала заверши текущую ставку.' });
    await assert.rejects(c.ledger.pvpHold(c.a, { ...match, stakeUnits: '60000000' }, c.now), { code: 'play_idempotency_conflict' });
    const initialReplay = await c.ledger.pvpHold(c.a, match, c.now);
    assert.equal(initialReplay.replayed, true);
    assert.equal(initialReplay.wallet.balanceUnits, '150000000');

    const finish = { matchId: match.matchId, winnerId: c.a, reason: 'win' };
    await assert.rejects(c.ledger.pvpFinish(other, finish, c.now + 1), { code: 'pvp_unavailable' });
    takeQueries();
    const settled = await c.ledger.pvpFinish(c.a, finish, c.now + 1);
    assert.equal(settled.replayed, false);
    assert.equal(settled.wallet.balanceUnits, '245000000');
    assert.equal(settled.wallet.reservedUnits, '0');
    const finishCalls = takeQueries();
    const lock = /\bpg_advisory_xact_lock\b/;
    const firstLock = finishCalls.findIndex(([sql]) => lock.test(sql));
    const firstWrite = finishCalls.findIndex(([sql]) => /\bupdate\s+virtual_pvp_(?:banks|holds)\b/i.test(sql));
    assert(firstLock >= 0 && firstLock < firstWrite, 'finish acquires participant account locks after reading the bank and before writes');
    const finishReads = finishCalls.slice(0, firstLock).map(([sql]) => sql).filter(sql => bankOrHold.test(sql));
    assert.deepEqual(finishCalls.slice(firstLock, firstWrite).filter(([sql]) => lock.test(sql)).map(([, values]) => values?.[0]),
      [c.a, c.b].sort().map(id => c.db.schema + ':key:account:' + id));

    await assert.rejects(c.ledger.pvpHold(other, match, c.now + 2), { code: 'pvp_unavailable' });
    await c.ledger.pvpHold(c.a, c.match(), c.now + 2);
    const priorHold = await c.ledger.pvpHold(c.a, match, c.now + 2);
    const priorFinish = await c.ledger.pvpFinish(c.a, finish, c.now + 2);
    assert.equal(priorHold.replayed, true);
    assert.equal(priorFinish.replayed, true);
    assert.equal(priorHold.wallet.balanceUnits, '195000000');
    assert.equal(priorHold.wallet.reservedUnits, '50000000');
    assert.deepEqual(priorFinish.wallet, priorHold.wallet);
    await assert.rejects(c.ledger.pvpHold(c.a, { ...match, stakeUnits: '60000000' }, c.now + 2), { code: 'play_idempotency_conflict' });
    await assert.rejects(c.ledger.pvpFinish(c.a, { ...finish, winnerId: c.b }, c.now + 2), { code: 'play_idempotency_conflict' });
    const bank = await c.db.prepare('SELECT state,winner_id,fee_units FROM virtual_pvp_banks WHERE match_id=?').get(match.matchId);
    assert.deepEqual(bank, { state: 'settled', winner_id: c.a, fee_units: 500 });
    const postings = await c.db.prepare('SELECT account_id,entry_type,amount_units FROM demo_ledger WHERE operation_id IN (?,?) ORDER BY id')
      .all('pvp:' + match.matchId + ':hold', 'pvp:' + match.matchId + ':final');
    assert.deepEqual(postings.map(row => [row.account_id, row.entry_type, row.amount_units]),
      [[c.a, 'bet', -5000], [c.b, 'bet', -5000], [c.a, 'win', 9500]]);
    assert.deepEqual([...holdReads, finishReads].map(reads => reads.length), [1, 1, 1]);
    for (const [sql] of [...holdReads, finishReads]) {
      assert.match(sql, /\bvirtual_pvp_banks\b/);
      assert.match(sql, /\bvirtual_pvp_holds\b/);
    }
  } finally {
    await c.close();
  }
});
test('the real room service requires the new wallet scope, preserves private hands and settles once',async()=>{
 const c=await fixture();try{
  const service=virtualPvpCommand(c.store),request={id:randomUUID(),action:'create',gameId:'durak',stakeUnits:'50000000',targetId:c.b};
  assert.equal((await service(c.a,'pvp-command',{...c.aa,request})).status,409);
  const created=await service(c.a,'pvp-command',{...c.aa,request:{...request,walletScope:VIRTUAL_PVP_SCOPE}});assert.equal(created.status,200);
  const id=created.value.active.id;await c.store.command(c.bb,{id:randomUUID(),action:'accept',challengeId:id},c.now);
  for(const actor of[c.aa,c.bb])await c.store.command(actor,{id:randomUUID(),action:'ready',challengeId:id},c.now);
  const snapshot=await c.store.snapshot(c.aa);assert(snapshot.cards);assert(!('hands'in snapshot.cards!));assert.equal(snapshot.wallet.state,'assigned');
  const op={id:randomUUID(),action:'resign',challengeId:id};await c.store.command(c.bb,op,c.now);await c.store.command(c.bb,op,c.now);
  assert.equal(await c.balance(c.a),24500);assert.equal(await c.balance(c.b),15000);
 }finally{await c.close();}
});
test('standard paid PvP pins server rules on acceptance and preserves unpinned historical matches', async () => {
  const c = await fixture();
  try {
    const hold = { action: 'create', stakeUnits: '50000000', targetId: c.b };
    await assert.rejects(c.store.command(c.aa, { ...hold, id: randomUUID(), gameId: 'pool', rulesVersion: 4 }, c.now),
      { status: 400 });
    for (const gameId of Object.keys(PVP_GAMES).filter(isStandardPvpGame)) {
      const created = await c.store.command(c.aa, { ...hold, id: randomUUID(), gameId }, c.now);
      assert(created.active);
      const { id: challengeId, rulesVersion, mode } = created.active;
      assert.equal(rulesVersion, STANDARD_PVP_RULES_VERSION);
      assert.equal(mode, 'stake');
      const accepted = await c.store.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);
      assert.equal(accepted.active?.rulesVersion, rulesVersion);
      const row = await c.db.prepare('SELECT payload FROM pvp_matches WHERE id=?').get(challengeId);
      assert.equal(JSON.parse(String(row?.payload)).challenge.rulesVersion, rulesVersion);
      assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), [15000, 15000]);
      await c.store.command(c.aa, { id: randomUUID(), action: 'cancel', challengeId }, c.now);
    }
    const legacy = await c.store.command(c.aa, { ...hold, id: randomUUID(), gameId: 'chess' }, c.now);
    assert(legacy.active);
    const challengeId = legacy.active.id;
    await c.db.prepare(`UPDATE pvp_matches SET payload=(payload::jsonb #- '{challenge,rulesVersion}' #- '{challenge,mode}')::text
      WHERE id=?`).run(challengeId);
    const restored = new PvpStore(c.ledger);
    await restored.syncRoom(c.aa.roomId, c.people, c.now);
    const accepted = await restored.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);
    assert.equal(accepted.active?.id, challengeId);
    assert.equal(accepted.active?.rulesVersion, undefined);
    assert.equal(accepted.active?.mode, undefined);
    assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), [15000, 15000]);
  } finally { await c.close(); }
});

test('trusted idle adjudication settles only a playing pool match for a participant', async () => {
  const c = await fixture();
  try {
    const roomId = c.aa.roomId;
    const playing = async (gameId: 'pool' | 'chess') => {
      const created = await c.store.command(c.aa, {
        id: randomUUID(), action: 'create', gameId, stakeUnits: '50000000', targetId: c.b,
      }, c.now);
      assert(created.active);
      const challengeId = created.active.id;
      await c.store.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);
      for (const actor of [c.aa, c.bb]) await c.store.command(actor, { id: randomUUID(), action: 'ready', challengeId }, c.now);
      return challengeId;
    };
    const pool = await playing('pool');
    for (const invalid of [null, randomUUID()]) await assert.rejects(c.store.adjudicate(roomId, pool, invalid, 'timeout', c.now),
      { status: 409 });
    assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), [15000, 15000]);
    await c.store.adjudicate(roomId, pool, c.a, 'timeout', c.now);
    await assert.rejects(c.store.adjudicate(roomId, pool, c.a, 'timeout', c.now), { status: 409 });
    const result = (await c.store.snapshot(c.aa, c.now)).challenges.find(challenge => challenge.id === pool);
    assert.equal(result?.status, 'finished');
    assert.equal(result?.reason, 'timeout');
    assert.equal(result?.winnerId, c.a);
    assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), [24500, 15000]);
    const chess = await playing('chess');
    await assert.rejects(c.store.adjudicate(roomId, chess, c.a, 'timeout', c.now), { status: 409 });
    assert.equal((await c.store.snapshot(c.aa, c.now)).active?.status, 'playing');
  } finally { await c.close(); }
});

test('fresh paid create and accept read the wallet once and retries read the settled wallet', async t => {
  const c = await fixture();
  try {
    const historical = await seedDemoTower(c.db, c.a, savedTower([]));
    const walletReads = t.mock.method(c.ledger, 'wallet');
    const create = { id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.b };
    const created = await c.store.command(c.aa, create, c.now);
    assert.deepEqual(walletReads.mock.calls.map(call => call.arguments[0]), [c.a]);
    assert(validVirtualPvpWallet(created.wallet));
    assert.equal(created.wallet.balanceUnits, '150000000');
    assert.equal(created.wallet.reservedUnits, '50000000');
    assert.equal(created.wallet.wallet.entries.filter(entry => entry.operationId === historical.id && entry.kind === 'refund').length, 1);
    const retirement = await c.db.prepare('SELECT reason FROM removed_casino_settlements WHERE account_id=? AND session_id=?')
      .get(c.a, historical.id);
    assert.equal(retirement?.reason, 'refund');
    assert.deepEqual(created.wallet, await c.ledger.wallet(c.a));

    assert(created.active);
    const challengeId = created.active.id;
    const accept = { id: randomUUID(), action: 'accept', challengeId };
    walletReads.mock.resetCalls();
    const accepted = await c.store.command(c.bb, accept, c.now);
    assert.deepEqual(walletReads.mock.calls.map(call => call.arguments[0]), [c.b]);
    assert(validVirtualPvpWallet(accepted.wallet));
    assert.equal(accepted.wallet.balanceUnits, '150000000');
    assert.equal(accepted.wallet.reservedUnits, '50000000');
    assert.deepEqual(accepted.wallet, await c.ledger.wallet(c.b));

    for (const actor of [c.aa, c.bb]) {
      await c.store.command(actor, { id: randomUUID(), action: 'ready', challengeId }, c.now);
    }
    await c.store.command(c.bb, { id: randomUUID(), action: 'resign', challengeId }, c.now);
    for (const [actor, original, balance] of [[c.aa, create, '245000000'], [c.bb, accept, '150000000']] as const) {
      walletReads.mock.resetCalls();
      const retried = await c.store.command(actor, original, c.now);
      assert.deepEqual(walletReads.mock.calls.map(call => call.arguments[0]), [actor.accountId]);
      assert.equal(retried.requestId, original.id);
      assert.equal(Object.getOwnPropertyDescriptor(retried, 'replayed')?.value, true);
      assert(validVirtualPvpWallet(retried.wallet));
      assert.equal(retried.wallet.balanceUnits, balance);
      assert.equal(retried.wallet.reservedUnits, '0');
      assert.deepEqual(retried.wallet, await c.ledger.wallet(actor.accountId));
    }
  } finally {
    await c.close();
  }
});
for (const scenario of ['cancel', 'creator-resigns', 'opponent-resigns'] as const) test(`direct PvP ${scenario} reads only the required wallets`, async t => {
  const c = await fixture();
  try {
    const opened = await c.store.command(c.aa, {
      id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.b,
    }, c.now);
    assert(opened.active);
    const challengeId = opened.active.id;
    await c.store.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);
    if (scenario !== 'cancel') for (const actor of [c.aa, c.bb]) {
      await c.store.command(actor, { id: randomUUID(), action: 'ready', challengeId }, c.now);
    }
    const historical = scenario === 'cancel' ? await seedDemoTower(c.db, c.a, savedTower([])) : null;
    const actor = scenario === 'opponent-resigns' ? c.bb : c.aa;
    const command = { id: randomUUID(), action: scenario === 'cancel' ? 'cancel' : 'resign', challengeId };
    const walletReads = t.mock.method(c.ledger, 'wallet');
    const settled = await c.store.command(actor, command, c.now + 1);
    const reads = walletReads.mock.calls.map(call => call.arguments[0]);
    assert(validVirtualPvpWallet(settled.wallet));
    assert.equal(settled.wallet.balanceUnits, scenario === 'cancel' ? '200000000' : '150000000');
    assert.equal(settled.wallet.reservedUnits, '0');
    assert.equal(settled.active?.reason, command.action);
    if (historical) {
      assert.equal(settled.wallet.wallet.entries.filter(entry => entry.operationId === historical.id && entry.kind === 'refund').length, 1);
      assert.equal((await c.db.prepare('SELECT reason FROM removed_casino_settlements WHERE account_id=? AND session_id=?')
        .get(actor.accountId, historical.id))?.reason, 'refund');
    }
    assert.deepEqual(settled.wallet, await c.ledger.wallet(actor.accountId));

    await c.common.operate(actor.accountId, { id: randomUUID(), kind: 'deposit', amount: 1 });
    walletReads.mock.resetCalls();
    const retried = await c.store.command(actor, command, c.now + 2);
    assert.deepEqual(walletReads.mock.calls.map(call => call.arguments[0]), [actor.accountId]);
    assert.equal(Object.getOwnPropertyDescriptor(retried, 'replayed')?.value, true);
    assert(validVirtualPvpWallet(retried.wallet));
    assert.equal(retried.wallet.balanceUnits, scenario === 'cancel' ? '201000000' : '151000000');
    assert.deepEqual(retried.wallet, await c.ledger.wallet(actor.accountId));
    assert.deepEqual(reads, actor.accountId === c.a ? [c.a] : [c.a, c.b]);
  } finally {
    await c.close();
  }
});
for (const action of ['cancel', 'resign'] as const) test(`PvP ${action} saves match and receipt in one query and rolls back a failed receipt`, async t => {
  const c = await fixture();
  try {
    const queries = t.mock.method(c.db as unknown as { query(sql: string): Promise<unknown> }, 'query');
    const matchWrite = /\b(?:insert\s+into|update)\s+pvp_matches\b/i;
    const receiptWrite = /\binsert\s+into\s+pvp_requests\b/i;
    const takeWrites = () => {
      const writes = queries.mock.calls.map(call => call.arguments[0]).filter(sql => matchWrite.test(sql) || receiptWrite.test(sql));
      queries.mock.resetCalls();
      return writes;
    };

    const create = { id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.b };
    const opened = await c.store.command(c.aa, create, c.now);
    const createWrites = takeWrites();
    assert(opened.active);
    const challengeId = opened.active.id;
    const receipt = (accountId: string, id: string) => c.db.prepare('SELECT match_id,request_key,created_at FROM pvp_requests WHERE account_id=? AND id=?')
      .get(accountId, id);
    assert.equal((await receipt(c.a, create.id))?.match_id, challengeId);
    await c.store.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);
    if (action === 'resign') for (const actor of [c.aa, c.bb]) {
      await c.store.command(actor, { id: randomUUID(), action: 'ready', challengeId }, c.now);
    }
    const actor = action === 'cancel' ? c.aa : c.bb;
    const command = { id: randomUUID(), action, challengeId };
    const matchRow = () => c.db.prepare('SELECT status,payload,updated_at FROM pvp_matches WHERE id=?').get(challengeId);
    const bankRow = () => c.db.prepare('SELECT state,winner_id,reason,fee_units,updated_at FROM virtual_pvp_banks WHERE match_id=?').get(challengeId);
    const holdRows = () => c.db.prepare('SELECT account_id,state FROM virtual_pvp_holds WHERE match_id=? ORDER BY account_id').all(challengeId);
    const finalEntries = () => c.db.prepare('SELECT account_id,entry_type,amount_units FROM demo_ledger WHERE operation_id=? ORDER BY account_id')
      .all('pvp:' + challengeId + ':final');
    const before = await c.store.snapshot(actor, c.now);
    assert(before.active);
    const [beforeMatch, beforeBank, beforeHolds] = await Promise.all([matchRow(), bankRow(), holdRows()]);
    assert.equal(beforeBank?.state, 'open');
    await c.db.exec(`CREATE FUNCTION reject_pvp_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM virtual_pvp_banks WHERE match_id=NEW.match_id AND state IN ('settled','refunded')) THEN
          RAISE EXCEPTION 'PvP receipt arrived before settlement';
        END IF;
        RAISE EXCEPTION 'PvP test receipt rejected';
      END $$;
      CREATE TRIGGER reject_pvp_receipt BEFORE INSERT ON pvp_requests FOR EACH ROW EXECUTE FUNCTION reject_pvp_receipt()`);
    takeWrites();

    await assert.rejects(c.store.command(actor, command, c.now + 1), /PvP test receipt rejected/);
    const rejectedWrites = takeWrites();
    assert.deepEqual(await matchRow(), beforeMatch);
    assert.deepEqual(await bankRow(), beforeBank);
    assert.deepEqual(await holdRows(), beforeHolds);
    assert.deepEqual(await finalEntries(), []);
    assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), [15000, 15000]);
    assert.equal(await receipt(actor.accountId, command.id), undefined);
    await c.db.exec('DROP TRIGGER reject_pvp_receipt ON pvp_requests');

    const settled = await c.store.command(actor, command, c.now + 1);
    const settlementWrites = takeWrites();
    assert.equal(Object.getOwnPropertyDescriptor(settled, 'replayed')?.value, false);
    assert.equal(settled.active?.status, action === 'cancel' ? 'cancelled' : 'finished');
    assert.equal(settled.active?.reason, action);
    assert.equal(settled.active?.revision, before.active.revision + 2);
    const savedReceipt = await receipt(actor.accountId, command.id);
    assert.equal(savedReceipt?.match_id, challengeId);
    const payouts = await finalEntries();
    const expected = action === 'cancel' ? [[c.a, 'refund', 5000], [c.b, 'refund', 5000]] : [[c.a, 'win', 9500]];
    assert.deepEqual(payouts.map(row => [row.account_id, row.entry_type, Number(row.amount_units)]).sort(), expected.sort());
    const balances = action === 'cancel' ? [20000, 20000] : [24500, 15000];
    assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), balances);

    const retried = await c.store.command(actor, command, c.now + 2);
    assert.deepEqual(takeWrites(), []);
    assert.equal(Object.getOwnPropertyDescriptor(retried, 'replayed')?.value, true);
    assert.equal(retried.active?.revision, settled.active?.revision);
    assert.deepEqual(await receipt(actor.accountId, command.id), savedReceipt);
    assert.deepEqual(await finalEntries(), payouts);
    assert.deepEqual(await Promise.all([c.balance(c.a), c.balance(c.b)]), balances);

    const writes = [createWrites, rejectedWrites, settlementWrites];
    assert.deepEqual(writes.map(statements => statements.length), [1, 1, 1]);
    for (const [sql] of writes) {
      assert.match(sql, matchWrite);
      assert.match(sql, receiptWrite);
    }
  } finally {
    await c.close();
  }
});
test('room sync reads one batch of bounded player histories and preserves private views', async t => {
  const c = await fixture();
  try {
    const roomId = c.aa.roomId;
    const guest = { accountId: randomUUID(), name: 'Сергей', roomId };
    const people = [...c.people, { accountId: guest.accountId, name: guest.name, connected: true, available: true }];
    await c.db.prepare('INSERT INTO accounts VALUES(?)').run(guest.accountId);
    await c.common.operate(guest.accountId, { id: randomUUID(), kind: 'deposit', amount: 200 });
    await c.store.syncRoom(roomId, people, c.now);

    const opened = await c.store.command(c.aa, {
      id: randomUUID(), action: 'create', gameId: 'durak', stakeUnits: '50000000', targetId: c.b,
    }, c.now);
    assert(opened.active);
    const challengeId = opened.active.id;
    await c.store.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);
    for (const actor of [c.aa, c.bb]) {
      await c.store.command(actor, { id: randomUUID(), action: 'ready', challengeId }, c.now);
    }
    const invite = await c.store.command(guest, {
      id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.a,
    }, c.now);
    assert(invite.active);
    const inviteId = invite.active.id;
    const cardRow = await c.db.prepare('SELECT payload FROM pvp_matches WHERE id=?').get(challengeId);
    assert(cardRow);
    const { cards } = JSON.parse(String(cardRow.payload)) as { cards: { hands: [number[], number[]] } };

    const pastOpponent = randomUUID();
    const template = opened.active;
    const histories = [c.aa, c.bb].map((actor, side) => Array.from({ length: 101 }, (_, rank) => {
      const updatedAt = c.now - (rank * 2 + side + 1);
      const challenge = {
        ...template, id: randomUUID(), gameId: 'chess', creatorId: actor.accountId, creatorName: actor.name,
        targetId: pastOpponent, opponentId: pastOpponent, opponentName: 'Бывший соперник',
        status: 'finished', winnerId: actor.accountId, reason: 'resign', createdAt: updatedAt - 1, expiresAt: updatedAt,
      };
      return { id: challenge.id, creatorId: challenge.creatorId, updatedAt,
        payload: JSON.stringify({ challenge, roomId, cards: null, lastMoveAt: updatedAt, roomSeenAt: updatedAt }) };
    }));
    const historyRows = histories.flat();
    await c.db.prepare(`INSERT INTO pvp_matches(id,room_id,creator_id,opponent_id,status,payload,updated_at)
      SELECT id,?,creator_id,?,'finished',payload,updated_at
      FROM unnest(?::text[],?::text[],?::text[],?::bigint[]) AS history(id,creator_id,payload,updated_at)`)
      .run(roomId, pastOpponent, historyRows.map(row => row.id), historyRows.map(row => row.creatorId),
        historyRows.map(row => row.payload), historyRows.map(row => row.updatedAt));

    const queries = t.mock.method(c.db as unknown as { query(sql: string): Promise<unknown> }, 'query');
    const snapshots = await c.store.syncRoom(roomId, people, c.now);
    const candidateReads = queries.mock.calls.filter(({ arguments: [sql] }) =>
      /\bfrom\s+pvp_matches\b/i.test(sql) && /\border\s+by\s+(?:\w+\.)?updated_at\s+desc\b/i.test(sql)).length;
    queries.mock.restore();
    assert.deepEqual(snapshots.map(row => row.accountId), [c.a, c.b, guest.accountId]);
    const [left, right, guestView] = snapshots.map(row => row.snapshot);
    for (const [side, snapshot] of [left, right].entries()) {
      assert.equal(snapshot.active?.id, challengeId);
      assert(snapshot.cards);
      assert.deepEqual(snapshot.cards.hand, cards.hands[side]);
      assert.equal(Object.hasOwn(snapshot.cards, 'hands'), false);
      assert.deepEqual(snapshot.challenges.filter(challenge => challenge.status === 'finished').map(challenge => challenge.id),
        histories[side].slice(0, 98).map(row => row.id));
    }
    assert.equal(left.challenges.some(challenge => challenge.id === inviteId), true);
    assert.equal(right.challenges.some(challenge => challenge.id === inviteId), false);
    assert.equal(right.people.find(person => person.accountId === guest.accountId)?.available, false);
    assert.deepEqual(guestView.challenges.map(challenge => challenge.id), [inviteId]);
    assert.equal(guestView.cards, null);

    const afterExpiry = await c.store.syncRoom(roomId, people, c.now + PVP_INVITE_MS);
    for (const { accountId, snapshot } of afterExpiry) {
      const invited = accountId === guest.accountId;
      assert.equal(snapshot.active?.id, invited ? inviteId : challengeId);
      assert.equal(snapshot.active?.status, 'cancelled');
      assert.equal(snapshot.active?.reason, invited ? 'expired' : 'server');
      assert(validVirtualPvpWallet(snapshot.wallet));
      assert.equal(snapshot.wallet.balanceUnits, '200000000');
      assert.equal(snapshot.wallet.reservedUnits, '0');
    }
    assert.equal(candidateReads, 1, 'read all candidate histories in one database query');
  } finally {
    await c.close();
  }
});
test('command admission reads receipt and rate together while preserving the exact cutoff', async t => {
  const c = await fixture();
  try {
    const create = { id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '50000000', targetId: c.b };
    const opened = await c.store.command(c.aa, create, c.now);
    assert(opened.active);
    const challengeId = opened.active.id;
    await c.store.command(c.bb, { id: randomUUID(), action: 'accept', challengeId }, c.now);

    const cutoff = c.now - 60_000;
    const updated = await c.db.prepare('UPDATE pvp_requests SET created_at=? WHERE account_id=? AND id=?')
      .run(cutoff, c.a, create.id);
    assert.equal(updated.changes, 1);
    const recentIds = Array.from({ length: 119 }, () => randomUUID());
    await c.db.prepare(`INSERT INTO pvp_requests(account_id,id,request_key,match_id,created_at)
      SELECT ?,id,request_key,?,? FROM unnest(?::text[],?::text[]) AS history(id,request_key)`)
      .run(c.a, challengeId, cutoff + 1, recentIds, recentIds.map(id => JSON.stringify({ action: 'ready', challengeId, id })));

    const queries = t.mock.method(c.db as unknown as { query(sql: string): Promise<unknown> }, 'query');
    const admissionReads = () => {
      const count = queries.mock.calls.filter(({ arguments: [sql] }) => /\bfrom\s+pvp_requests\b/i.test(sql)).length;
      queries.mock.resetCalls();
      return count;
    };
    const ready = { id: randomUUID(), action: 'ready', challengeId };
    const accepted = await c.store.command(c.aa, ready, c.now);
    const freshReads = admissionReads();
    assert.equal(accepted.requestId, ready.id);
    assert.equal(Object.getOwnPropertyDescriptor(accepted, 'replayed')?.value, false);
    assert.deepEqual(accepted.active?.ready, [c.a]);

    const cancel = { id: randomUUID(), action: 'cancel', challengeId };
    await assert.rejects(c.store.command(c.aa, cancel, c.now), { status: 429 });
    const deniedReads = admissionReads();
    const replayed = await c.store.command(c.aa, create, c.now);
    const replayReads = admissionReads();
    assert.equal(replayed.requestId, create.id);
    assert.equal(Object.getOwnPropertyDescriptor(replayed, 'replayed')?.value, true);
    assert(replayed.active);
    assert.equal(replayed.active.id, challengeId);
    assert.equal(replayed.active.status, 'arriving');
    assert.deepEqual(replayed.active.ready, [c.a]);

    await assert.rejects(c.store.command(c.aa, { ...create, stakeUnits: '60000000' }, c.now),
      { status: 409, code: 'Нельзя изменить отправленное действие.' });
    const conflictReads = admissionReads();
    queries.mock.restore();
    assert.equal(await c.db.prepare('SELECT 1 FROM pvp_requests WHERE account_id=? AND id=?').get(c.a, cancel.id), undefined);
    assert.equal(await c.balance(c.a), 15000);
    assert.equal(await c.balance(c.b), 15000);
    assert.deepEqual([freshReads, deniedReads, replayReads, conflictReads], [1, 1, 1, 1]);
  } finally {
    await c.close();
  }
});
test('draws, expired invites and lost game servers refund the original balance without commission',async()=>{
 const c=await fixture();try{
  for(const reason of ['draw','cancel','server']){
   const m=c.match();await c.ledger.pvpHold(c.a,m);if(reason!=='cancel')await c.ledger.pvpHold(c.b,m);
   await c.ledger.pvpFinish(c.a,{matchId:m.matchId,winnerId:null,reason});
   assert.equal(await c.balance(c.a),20000);assert.equal(await c.balance(c.b),20000);
  }
  const invite=await c.store.command(c.aa,{id:randomUUID(),action:'create',gameId:'pool',stakeUnits:'50000000',targetId:null},c.now);
  await c.store.sweep(c.now+120001);assert.equal((await c.store.snapshot(c.aa)).active!.id,invite.active!.id);assert.equal(await c.balance(c.a),20000);
  const cancel = { id: randomUUID(), action: 'cancel', challengeId: invite.active!.id };
  const terminal = await c.store.command(c.aa, cancel, c.now + 120002);
  assert.equal(terminal.requestId, cancel.id);
  assert.equal(Object.hasOwn(terminal, 'replayed'), false);
  assert.equal(await c.db.prepare('SELECT 1 FROM pvp_requests WHERE account_id=? AND id=?').get(c.a, cancel.id), undefined);
  assert.equal(Number((await c.db.prepare('SELECT sum(fee_units) AS n FROM virtual_pvp_banks').get())!.n),0);
 }finally{await c.close();}
});
test('simultaneous slot spending and PvP funding cannot spend the same money twice',async()=>{
 const c=await fixture(50);try{
  const results=await Promise.allSettled([c.ledger.pvpHold(c.a,c.match()),c.common.operate(c.a,{id:randomUUID(),kind:'spin',amount:50})]);
  assert(results.some(r=>r.status==='fulfilled'));assert(await c.balance(c.a)>=0);
  const entries=await c.db.prepare('SELECT amount_units,balance_units FROM demo_ledger WHERE account_id=? ORDER BY id').all(c.a);
  let balance=0;for(const e of entries){balance+=Number(e.amount_units);assert.equal(Number(e.balance_units),balance);assert(balance>=0);}assert.equal(balance,await c.balance(c.a));
 }finally{await c.close();}
});
test('reserved payout capacity survives reloads and prevents top-ups from blocking settlement',async()=>{
 const c=await fixture();try{
  await saveDemoUnits(c.db,c.a,MAX_DEMO_UNITS-5000);const m=c.match();await c.ledger.pvpHold(c.a,m);await c.ledger.pvpHold(c.b,m);
  assert.equal(await demoReservedUnits(c.db,c.a),9500);
  await assert.rejects(c.common.operate(c.a,{id:randomUUID(),kind:'deposit',amount:100}));
  const restarted=new VirtualPvpLedger(c.db,c.common);await restarted.pvpFinish(c.a,{matchId:m.matchId,winnerId:c.a,reason:'win'});
  assert.equal(await c.balance(c.a),MAX_DEMO_UNITS-500);assert.equal(await demoReservedUnits(c.db,c.a),0);
 }finally{await c.close();}
});
test('fractional stakes pay exact cents, and unsupported precision never creates a hold',async()=>{
 const c=await fixture();try{
  await assert.rejects(c.ledger.pvpHold(c.a,c.match('durak','1010000')),/0,10/);
  const m=c.match('durak','1100000');await c.ledger.pvpHold(c.a,m);await c.ledger.pvpHold(c.b,m);
  await c.ledger.pvpFinish(c.a,{matchId:m.matchId,winnerId:c.a,reason:'win'});
  assert.equal(await c.balance(c.a),20099);assert.equal(await c.balance(c.b),19890);
  assert.equal(Number((await c.db.prepare('SELECT fee_units FROM virtual_pvp_banks').get())!.fee_units),11);
 }finally{await c.close();}
});
test('combat shares the virtual journal, rolls back partial funding and recovers expired banks',async()=>{
 const c=await fixture();let now=c.now;try{
  const combat=new NileCombatEscrow(c.ledger,()=>now);await combat.ready;
  await saveDemoUnits(c.db,c.b,0);const m={id:randomUUID(),accounts:[c.a,c.b],stakeUnits:'50000000'};
  await assert.rejects(combat.fund(c.a,m));assert.equal(await c.balance(c.a),20000);
  assert.equal(Number((await c.db.prepare('SELECT count(*) AS n FROM virtual_pvp_holds').get())!.n),0);
  await c.common.operate(c.b,{id:randomUUID(),kind:'deposit',amount:200});await combat.fund(c.a,m);
  now+=150001;await combat.recoverExpired();assert.equal(await c.balance(c.a),20000);assert.equal(await c.balance(c.b),20000);
 }finally{await c.close();}
});
test('atelier and a PvP reservation use one balance and failed generation refunds only its own debit',async()=>{
 const c=await fixture();try{
  const payments=new CommonSkinPayments(c.db,c.common.ready),id=randomUUID(),m=c.match();
  await c.ledger.pvpHold(c.a,m);await payments.skinPurchase(c.a,id,'reserve');assert.equal(await c.balance(c.a),14000);
  await payments.skinPurchase(c.a,id,'refund');await payments.skinPurchase(c.a,id,'refund');assert.equal(await c.balance(c.a),15000);
  await c.ledger.pvpFinish(c.a,{matchId:m.matchId,winnerId:null,reason:'cancel'});assert.equal(await c.balance(c.a),20000);
 }finally{await c.close();}
});
