import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';
import { BASE_VARIANT_GAMES, VARIANT_DEFAULTS, VARIANT_MAX } from '../src/shared/casinoVariants';
import { NEXT_VARIANT_GAMES } from '../src/shared/casinoNextVariants';
import type { ExpansionAction, ExpansionSession } from '../src/shared/casinoExpansion';

// Keep the historical fault audit on its original twelve rulesets.
const VARIANT_GAMES = [...BASE_VARIANT_GAMES, ...NEXT_VARIANT_GAMES] as const;
type VariantGameId = typeof VARIANT_GAMES[number];
const ACTIVE_GAMES = ['variant-mines', 'variant-color', 'variant-keys'] as const;
type ActiveGame = typeof ACTIVE_GAMES[number];
const start = (gameId: VariantGameId, id = randomUUID()): ExpansionAction => ({
  id, gameId, action: 'start', stakeUnits: '1000', settings: structuredClone(VARIANT_DEFAULTS[gameId]),
});
const move = (session: Pick<ExpansionSession, 'id' | 'gameId'>, name: string, picks?: number[], id = randomUUID()): ExpansionAction => ({
  id, gameId: session.gameId, action: 'move', sessionId: session.id, move: name, ...(picks === undefined ? {} : { picks }),
});
const safeMove = (session: Pick<ExpansionSession, 'id' | 'gameId'>, step = 1, id = randomUUID()) =>
  session.gameId === 'variant-mines' ? move(session, 'reveal', [step + 2], id)
    : session.gameId === 'variant-color' ? move(session, 'black', undefined, id) : move(session, 'unlock', [1, 2], id);
const lossMove = (session: Pick<ExpansionSession, 'id' | 'gameId'>) =>
  session.gameId === 'variant-mines' ? move(session, 'reveal', [0])
    : session.gameId === 'variant-color' ? move(session, 'red') : move(session, 'unlock', [0, 1]);
const status = (code: number) => (error: unknown) => error instanceof WalletError && error.status === code;

async function fixture(now: () => number = Date.now) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  let draws = 0;
  let randomValue: (max: number) => number = () => 0;
  const draw = (max: number) => { draws++; return randomValue(max); };
  const wallet = new DemoWalletStore(db, draw, now);
  await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 100000 });
  await wallet.operate('bob', { id: randomUUID(), kind: 'deposit', amount: 100000 });
  const peerDb = new PostgresDatabase(db.schema);
  const peerWallet = new DemoWalletStore(peerDb, draw, now);
  await peerWallet.ready;
  const store = new DemoExpansionStore(db, id => wallet.snapshot(id), wallet.ready, async () => {}, draw, now);
  const peer = new DemoExpansionStore(peerDb, id => peerWallet.snapshot(id), peerWallet.ready, async () => {}, draw, now);
  return { db, peerDb, wallet, peerWallet, store, peer, draws: () => draws, setRandom: (random: (max: number) => number) => { randomValue = random; },
    close: async () => { await peerDb.close(); await db.close(); } };
}

async function durableState(db: PostgresDatabase) {
  return {
    wallets: await db.prepare('SELECT * FROM demo_wallets ORDER BY account_id').all(),
    sessions: await db.prepare('SELECT * FROM demo_casino_sessions ORDER BY account_id,id').all(),
    requests: await db.prepare('SELECT * FROM demo_casino_requests ORDER BY account_id,id').all(),
    ledger: await db.prepare('SELECT * FROM demo_ledger ORDER BY id').all(),
  };
}

async function ledgerIsExact(db: PostgresDatabase, account = 'alice') {
  const rows = await db.prepare('SELECT amount_units,balance_units,amount,balance,entry_type FROM demo_ledger WHERE account_id=? ORDER BY id').all(account);
  let balance = 0;
  for (const row of rows) {
    assert(Number.isSafeInteger(row.amount_units));
    balance += row.amount_units;
    assert.equal(row.balance_units, balance);
    assert.equal(row.amount, Math.trunc(row.amount_units / 100) || 0);
    assert.equal(row.balance, Math.floor(balance / 100));
    assert(balance >= 0 && balance <= MAX_DEMO_UNITS);
  }
  assert.equal(await demoBalanceUnits(db, account), balance);
}

async function setAuditedBalance(db: PostgresDatabase, units: number) {
  await db.transaction(async () => {
    const before = await demoBalanceUnits(db, 'alice');
    await recordDemoUnits(db, 'alice', randomUUID(), 'rollback', units - before, units, 'audit-fixture');
    await saveDemoUnits(db, 'alice', units);
  }, { lockKey: 'account:alice' });
}

async function injectFailure(db: PostgresDatabase, table: string, event: 'INSERT' | 'UPDATE' = 'INSERT') {
  await db.exec("CREATE OR REPLACE FUNCTION audit_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit persistence failure'; END $$");
  await db.exec(`CREATE TRIGGER audit_reject_write BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION audit_reject_write()`);
}
async function removeFailure(db: PostgresDatabase, table: string) { await db.exec(`DROP TRIGGER audit_reject_write ON ${table}`); }

test('eight simultaneous identical starts across two PostgreSQL pools debit and draw once in all twelve variants', async () => {
  const f = await fixture();
  try {
    for (const gameId of VARIANT_GAMES) {
      const op = start(gameId), before = await demoBalanceUnits(f.db, 'alice'), beforeDraws = f.draws();
      const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? f.peer : f.store).operate('alice', structuredClone(op))));
      assert.equal(replies.filter(r => !r.replayed).length, 1, gameId);
      for (const result of replies) assert.deepEqual(result.session, replies[0].session, gameId);
      assert(f.draws() > beforeDraws, gameId);
      const afterDraws = f.draws();
      await f.peer.operate('alice', structuredClone(op));
      assert.equal(f.draws(), afterDraws, 'A replay must not draw a fresh outcome');
      const ledger = await f.db.prepare('SELECT entry_type,amount_units FROM demo_ledger WHERE account_id=? AND operation_id=? ORDER BY id').all('alice', op.id);
      assert.equal(ledger.filter(r => r.entry_type === 'bet').length, 1, gameId);
      assert.equal(ledger[0].amount_units, -1000, gameId);
      assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 1000 + Number(replies[0].session.returnedUnits), gameId);
      if (replies[0].session.state === 'active') await f.peer.operate('alice', lossMove(replies[0].session));
      await ledgerIsExact(f.db);
    }
    assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
  } finally { await f.close(); }
});

test('competing start IDs permit exactly one active party in each multi-step variant', async () => {
  const f = await fixture();
  try {
    for (const gameId of ACTIVE_GAMES) {
      const before = await demoBalanceUnits(f.db, 'alice');
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => (i % 2 ? f.peer : f.store).operate('alice', start(gameId))));
      const success = results.filter(r => r.status === 'fulfilled');
      assert.equal(success.length, 1, gameId);
      for (const result of results) if (result.status === 'rejected') assert(status(409)(result.reason), gameId);
      assert.equal(await demoBalanceUnits(f.db, 'alice'), before - 1000, gameId);
      assert.equal(await demoReservedUnits(f.db, 'alice'), 1000 * VARIANT_MAX[gameId], gameId);
      const session = (success[0] as PromiseFulfilledResult<Awaited<ReturnType<DemoExpansionStore['operate']>>>).value.session;
      await f.store.operate('alice', lossMove(session));
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('same UUID with competing move bodies commits one transition and rejects the changed request', async () => {
  const f = await fixture();
  try {
    for (const gameId of ACTIVE_GAMES) {
      const session = (await f.store.operate('alice', start(gameId))).session, id = randomUUID();
      const first = safeMove(session, 1, id);
      const second = gameId === 'variant-mines' ? move(session, 'reveal', [4], id)
        : gameId === 'variant-color' ? move(session, 'red', undefined, id) : move(session, 'unlock', [2, 3], id);
      const results = await Promise.allSettled([f.store.operate('alice', first), f.peer.operate('alice', second)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, gameId);
      const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      assert(status(409)(rejected.reason), gameId);
      const row = await f.db.prepare('SELECT request_key FROM demo_casino_requests WHERE account_id=? AND id=?').get('alice', id);
      const committed = JSON.parse(row!.request_key) as ExpansionAction;
      assert.equal((await f.peer.operate('alice', committed)).replayed, true, gameId);
      const current = (await f.store.active('alice')).sessions.find(s => s.id === session.id)!;
      if (current.state === 'active') {
        assert.equal(current.view.phase, 2, gameId);
        await f.store.operate('alice', move(current, 'cashout'));
      }
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('cashout racing with a losing move or automatic sixth win credits exactly one terminal result', async () => {
  const f = await fixture();
  try {
    for (const gameId of ACTIVE_GAMES) for (const terminal of ['loss', 'automatic'] as const) {
      let session = (await f.store.operate('alice', start(gameId))).session;
      const steps = terminal === 'automatic' ? 5 : 1;
      for (let step = 1; step <= steps; step++) session = (await f.store.operate('alice', safeMove(session, step))).session;
      const before = await demoBalanceUnits(f.db, 'alice');
      const cashout = move(session, 'cashout'), competitor = terminal === 'loss' ? lossMove(session) : safeMove(session, 6);
      const results = await Promise.allSettled([f.peer.operate('alice', competitor), f.store.operate('alice', cashout)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, gameId);
      for (const result of results) if (result.status === 'rejected') assert(status(409)(result.reason), gameId);
      const final = (await f.peer.active('alice')).sessions.find(s => s.id === session.id)!;
      assert.equal(final.state, 'settled');
      assert.equal(await demoBalanceUnits(f.db, 'alice'), before + Number(final.returnedUnits));
      assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
      const wins = await f.db.prepare("SELECT COUNT(*) AS n,SUM(amount_units) AS units FROM demo_ledger WHERE account_id=? AND operation_id IN (?,?) AND entry_type='win'").get('alice', cashout.id, competitor.id);
      assert.equal(wins!.n, 1);
      assert.equal(wins!.units, Number(final.returnedUnits));
      const winner = results[0].status === 'fulfilled' ? competitor : cashout;
      const state = await durableState(f.db);
      assert.equal((await f.peer.operate('alice', winner)).replayed, true);
      assert.deepEqual(await durableState(f.db), state);
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('failure after session, stake and payout writes rolls back every durable row for all twelve variants', async () => {
  const f = await fixture();
  try {
    for (const gameId of VARIANT_GAMES) {
      const op = start(gameId), before = await durableState(f.db);
      await injectFailure(f.db, 'demo_casino_requests');
      await assert.rejects(f.store.operate('alice', op), /audit persistence failure/, gameId);
      assert.deepEqual(await durableState(f.db), before, gameId);
      await removeFailure(f.db, 'demo_casino_requests');
      const recovered = await f.peer.operate('alice', op);
      assert.equal(recovered.replayed, false, gameId);
      assert.equal((await f.store.operate('alice', op)).replayed, true, gameId);
      if (recovered.session.state === 'active') await f.store.operate('alice', lossMove(recovered.session));
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('failed settlement at ledger, session, wallet and request persistence leaves each committed board recoverable', async () => {
  const f = await fixture();
  try {
    for (const gameId of ACTIVE_GAMES) for (const [table, event] of [
      ['demo_ledger', 'INSERT'], ['demo_casino_sessions', 'UPDATE'], ['demo_wallets', 'UPDATE'], ['demo_casino_requests', 'INSERT'],
    ] as const) {
      const session = (await f.store.operate('alice', start(gameId))).session;
      await f.store.operate('alice', safeMove(session));
      const op = move(session, 'cashout'), before = await durableState(f.db);
      await injectFailure(f.db, table, event);
      await assert.rejects(f.peer.operate('alice', op), /audit persistence failure/, gameId + ':' + table);
      assert.deepEqual(await durableState(f.db), before, gameId + ':' + table);
      await removeFailure(f.db, table);
      const result = await f.store.operate('alice', op);
      assert.equal(result.session.state, 'settled');
      assert.equal(result.session.returnedUnits, gameId === 'variant-mines' ? '1206' : '1960');
      assert.equal((await f.peer.operate('alice', op)).replayed, true);
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('maximum reserves combine across games and reject overflow before any fresh random draw', async () => {
  const f = await fixture();
  try {
    const allReserve = ACTIVE_GAMES.reduce((sum, game) => sum + 1000 * VARIANT_MAX[game], 0);
    await setAuditedBalance(f.db, MAX_DEMO_UNITS - allReserve + ACTIVE_GAMES.length * 1000);
    const sessions: ExpansionSession[] = [];
    for (const gameId of ACTIVE_GAMES) sessions.push((await f.store.operate('alice', start(gameId))).session);
    assert.equal(await demoBalanceUnits(f.db, 'alice') + await demoReservedUnits(f.db, 'alice'), MAX_DEMO_UNITS);
    const before = await durableState(f.db), draws = f.draws();
    await assert.rejects(f.peerWallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1 }), status(400));
    for (const gameId of VARIANT_GAMES) await assert.rejects(f.peer.operate('alice', start(gameId)), status(409), gameId);
    assert.equal(f.draws(), draws);
    assert.deepEqual(await durableState(f.db), before);
    for (const session of sessions) await f.peer.operate('alice', lossMove(session));
    assert.equal(await demoReservedUnits(f.db, 'alice'), 0);
    await ledgerIsExact(f.db);
  } finally { await f.close(); }
});

test('all game reserves accept the exact capacity boundary and reject one unit beyond it before drawing', async () => {
  const f = await fixture();
  try {
    for (const gameId of VARIANT_GAMES) {
      const capacityBalance = MAX_DEMO_UNITS - 1000 * VARIANT_MAX[gameId] + 1000;
      await setAuditedBalance(f.db, capacityBalance + 1);
      const before = await durableState(f.db), beforeDraws = f.draws();
      await assert.rejects(f.peer.operate('alice', start(gameId)), status(409), gameId);
      assert.equal(f.draws(), beforeDraws, gameId);
      assert.deepEqual(await durableState(f.db), before, gameId);
      await setAuditedBalance(f.db, capacityBalance);
      const result = await f.store.operate('alice', start(gameId));
      assert(Number(result.session.returnedUnits) <= 1000 * VARIANT_MAX[gameId], gameId);
      assert(await demoBalanceUnits(f.db, 'alice') + await demoReservedUnits(f.db, 'alice') <= MAX_DEMO_UNITS, gameId);
      if (result.session.state === 'active') await f.peer.operate('alice', lossMove(result.session));
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('wrong owner, mismatched game, altered stake/settings and reused wallet UUID never change money or parties', async () => {
  const f = await fixture();
  try {
    for (const gameId of VARIANT_GAMES) {
      const op = start(gameId), result = await f.store.operate('alice', op), before = await durableState(f.db);
      await assert.rejects(f.peer.operate('alice', { ...op, stakeUnits: '5000' }), status(409));
      await assert.rejects(f.peer.operate('alice', { ...op, settings: { variant: { ...VARIANT_DEFAULTS[gameId].variant, forged: true } } }), status(400));
      await assert.rejects(f.peer.operate('alice', { ...op, gameId: gameId === 'variant-dice' ? 'variant-sic-bo' : 'variant-dice', settings: VARIANT_DEFAULTS[gameId === 'variant-dice' ? 'variant-sic-bo' : 'variant-dice'] }), status(409));
      await assert.rejects(f.peerWallet.operate('alice', { id: op.id, kind: 'deposit', amount: 1 }), status(409));
      if (result.session.state === 'active') {
        await assert.rejects(f.peer.operate('bob', safeMove(result.session)), status(404));
        const incorrectGame: ActiveGame = gameId === 'variant-mines' ? 'variant-keys' : 'variant-mines';
        await assert.rejects(f.peer.operate('alice', safeMove({ id: result.session.id, gameId: incorrectGame })), status(404));
      }
      assert.deepEqual(await durableState(f.db), before, gameId);
      if (result.session.state === 'active') await f.store.operate('alice', lossMove(result.session));
    }
    const id = randomUUID();
    await f.wallet.operate('alice', { id, kind: 'deposit', amount: 1 });
    const before = await durableState(f.db);
    await assert.rejects(f.peer.operate('alice', start('variant-fruits', id)), status(409));
    assert.deepEqual(await durableState(f.db), before);
    await ledgerIsExact(f.db); await ledgerIsExact(f.db, 'bob');
  } finally { await f.close(); }
});

test('broken random generators cannot persist a debit or outcome, and the same UUID is safe to retry', async () => {
  const f = await fixture();
  try {
    for (const gameId of VARIANT_GAMES) {
      const op = start(gameId), before = await durableState(f.db);
      for (const invalid of [() => NaN, () => -1, (max: number) => max, () => 0.5]) {
        f.setRandom(invalid);
        await assert.rejects(f.store.operate('alice', op), /Invalid .*random value/, gameId);
        assert.deepEqual(await durableState(f.db), before, gameId);
      }
      f.setRandom(() => 0);
      const result = await f.peer.operate('alice', op);
      assert.equal(result.replayed, false);
      assert.equal((await f.store.operate('alice', op)).replayed, true);
      if (result.session.state === 'active') await f.store.operate('alice', lossMove(result.session));
      await ledgerIsExact(f.db);
    }
  } finally { await f.close(); }
});

test('closing both connection pools preserves committed parties and old UUIDs without redrawing on restart', async () => {
  const f = await fixture();
  let reopened: PostgresDatabase | undefined;
  try {
    const operations = VARIANT_GAMES.map(game => start(game)), last = [] as ExpansionSession[];
    for (const op of operations) {
      let result = await f.store.operate('alice', op);
      if (result.session.state === 'active') result = await f.store.operate('alice', safeMove(result.session));
      last.push(result.session);
    }
    const before = await durableState(f.db), schema = f.db.schema;
    await f.close();
    reopened = new PostgresDatabase(schema);
    const wallet = new DemoWalletStore(reopened, () => { throw Error('Restart must not redraw committed parties'); });
    await wallet.ready;
    const store = new DemoExpansionStore(reopened, id => wallet.snapshot(id), wallet.ready, async () => {}, () => { throw Error('Restart must not redraw committed parties'); });
    for (let i = 0; i < operations.length; i++) {
      const replay = await store.operate('alice', operations[i]);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.session, last[i]);
    }
    assert.deepEqual(await durableState(reopened), before);
    for (const session of last) if (session.state === 'active') await store.operate('alice', move(session, 'cashout'));
    await ledgerIsExact(reopened);
    assert.equal(await demoReservedUnits(reopened, 'alice'), 0);
  } finally { await reopened?.close(); await f.close(); }
});

test('a just-committed instant game remains the selected latest result when the clock ties or moves backwards', async () => {
  let clock = 1800000000000;
  const f = await fixture(() => clock);
  let reopened: PostgresDatabase | undefined;
  try {
    const expected = new Map<VariantGameId, string>();
    for (const [index, gameId] of VARIANT_GAMES.entries()) {
      const suffix = index.toString(16).padStart(4, '0');
      const old: ExpansionAction = { ...start(gameId, `ffff${suffix}-ffff-4fff-afff-ffffffffffff`),
        ...(gameId === 'variant-fruits' ? { settings: { variant: { lines: 2 as const } } } : {}) };
      const prior = await f.store.operate('alice', old);
      if (prior.session.state === 'active') await f.store.operate('alice', lossMove(prior.session));
      const latest: ExpansionAction = { ...start(gameId, `0000${suffix}-0000-4000-a000-000000000000`), stakeUnits: '5000' };
      const result = await f.peer.operate('alice', latest);
      assert.equal(result.session.id, latest.id);
      const selected = result.sessions.find(session => session.gameId === gameId)!;
      assert.equal(selected.id, latest.id, gameId + ': a timestamp tie must not display the previous round');
      assert.equal(selected.stakeUnits, '5000');
      if (selected.state === 'active') await f.peer.operate('alice', lossMove(selected));
      clock--;
      const rewind = start(gameId);
      const rewound = await f.store.operate('alice', rewind);
      assert.equal(rewound.sessions.find(session => session.gameId === gameId)!.id, rewind.id, gameId);
      const refreshed = await f.peer.active('alice');
      assert.equal(refreshed.sessions.find(session => session.gameId === gameId)!.id, rewind.id, gameId);
      if (rewound.session.state === 'active') await f.store.operate('alice', lossMove(rewound.session));
      expected.set(gameId, rewind.id);
    }
    await ledgerIsExact(f.db);
    const schema = f.db.schema;
    await f.close();
    reopened = new PostgresDatabase(schema);
    const wallet = new DemoWalletStore(reopened, () => { throw Error('Clock recovery must not redraw'); }, () => clock);
    await wallet.ready;
    const store = new DemoExpansionStore(reopened, id => wallet.snapshot(id), wallet.ready, async () => {}, () => { throw Error('Clock recovery must not redraw'); }, () => clock);
    const restored = await store.active('alice');
    for (const [gameId, id] of expected) assert.equal(restored.sessions.find(session => session.gameId === gameId)!.id, id, gameId);
    await ledgerIsExact(reopened);
  } finally { await reopened?.close(); await f.close(); }
});
