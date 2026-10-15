import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { minesOdds, getMinesRtp } from '../src/shared/originalGames';
import { MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
const status = (code: number) => (error: unknown) => error instanceof WalletError && error.status === code;
function choose(n: number, k: number): bigint {
  let value = 1n;
  for (let i = 1; i <= k; i++) value = value * BigInt(n - i + 1) / BigInt(i);
  return value;
}
async function fixture(amount = 1000) {
  const db = new PostgresDatabase(':memory:');
  (await db.exec(" CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob');"));
  let draws = 0;
  const wallet = new DemoWalletStore(db, () => { draws++; return 0; });
  (await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount }));
  return { db, wallet, draws: () => draws };
}

test('all 300 Mines multipliers match independently rounded inverse survival and expose upstream rounding variance', () => {
  let checked = 0;
  for (let mines = 1; mines <= 24; mines++) for (let revealed = 1; revealed <= 25 - mines; revealed++) {
    const numerator = 98n * choose(25, revealed);
    const denominator = choose(25 - mines, revealed);
    const roundedMinor = (numerator + denominator / 2n) / denominator;
    assert.equal(minesOdds.getMultiplier(mines, revealed), Number(roundedMinor) / 100);
    checked++;
  }
  assert.equal(checked, 300);
  assert.equal(minesOdds.getMultiplier(5, 1), 1.23);
  assert.equal(1.23 * 0.8, 0.984);
  assert.equal(getMinesRtp(5, 1), 0.984);
  assert.throws(() => getMinesRtp(5, 0));
  assert.equal(minesOdds.getMultiplier(12, 13), 5096294);
});

test('Mines persists the hidden session, debits once, reveals stepwise and cashes out once after reopening', async () => {
  const { db, wallet, draws } = (await fixture());
  try {
    assert.equal((await wallet.mines.active('alice')).session, null);
    const start = { id: randomUUID(), action: 'start', amount: 100, mineCount: 3 };
    const first = (await wallet.mines.operate('alice', start));
    assert.equal(first.wallet.balance, 900);
    assert.equal(first.session!.state, 'active');
    assert.equal(Object.hasOwn(first.session!, 'mineCells'), false);
    assert.equal(first.session!.payout, 100);
    assert.deepEqual(first.session!.revealed, []);
    assert.equal(draws(), 3);
    const reopened = new DemoWalletStore(db, () => { throw new Error('Layout must persist'); });
    assert.deepEqual((await reopened.mines.active('alice')), first);
    assert.deepEqual((await reopened.mines.operate('alice', start)), first);
    const reveal = { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 4 };
    const revealed = (await reopened.mines.operate('alice', reveal));
    assert.deepEqual(revealed.session!.revealed, [4]);
    assert.equal(revealed.session!.multiplier, minesOdds.getMultiplier(3, 1));
    assert.equal(Object.hasOwn(revealed.session!, 'mineCells'), false);
    assert.deepEqual((await reopened.mines.operate('alice', reveal)), revealed);
    (await assert.rejects(async () => (await reopened.mines.operate('bob', { ...reveal, id: randomUUID() })), status(404)));
    (await assert.rejects(async () => (await reopened.mines.operate('alice', { ...reveal, id: randomUUID() })), status(409)));
    const cashout = { id: randomUUID(), action: 'cashout', sessionId: start.id };
    const cashed = (await reopened.mines.operate('alice', cashout));
    assert.equal(cashed.session!.state, 'cashed_out');
    assert.equal(cashed.session!.payout, 111);
    assert.equal(cashed.wallet.balance, 1011);
    assert.deepEqual(cashed.session!.mineCells, [0, 1, 2]);
    assert.equal((await reopened.mines.reservedUnits('alice')), 0);
    assert.equal((await reopened.mines.active('alice')).session, null);
    assert.deepEqual((await reopened.mines.operate('alice', cashout)), cashed);
    assert.deepEqual((await reopened.mines.operate('alice', start)), cashed);
    assert.deepEqual((await reopened.mines.operate('alice', reveal)), cashed);
    (await assert.rejects(async () => (await reopened.mines.operate('alice', { ...cashout, id: randomUUID() })), status(409)));
    assert.equal(cashed.wallet.entries.filter(entry => entry.source === 'royal-mines').length, 2);
    assert.equal(cashed.wallet.entries.filter(entry => entry.operationId === start.id).length, 2);
  } finally { (await db.close()); }
});

test('Mines loses on the actual hidden mine and reveals layout only after termination', async () => {
  const { db, wallet } = (await fixture());
  try {
    const start = { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 };
    (await wallet.mines.operate('alice', start));
    (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 3 }));
    const loss = (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 0 }));
    assert.equal(loss.wallet.balance, 990);
    assert.equal(loss.session!.state, 'lost');
    assert.equal(loss.session!.multiplier, 0);
    assert.equal(loss.session!.payout, 0);
    assert.deepEqual(loss.session!.revealed, [3, 0]);
    assert.deepEqual(loss.session!.mineCells, [0]);
    assert.equal((await wallet.mines.reservedUnits('alice')), 0);
  } finally { (await db.close()); }
});

test('cashout requires a safe reveal and full-board automatic cashout is exact', async () => {
  const { db, wallet } = (await fixture());
  try {
    const refund = { id: randomUUID(), action: 'start', amount: 50, mineCount: 3 };
    (await wallet.mines.operate('alice', refund));
    (await assert.rejects(async () => (await wallet.mines.operate('alice', { id: randomUUID(), action: 'cashout', sessionId: refund.id })), status(400)));
    assert.equal((await wallet.snapshot('alice')).balance, 950);
    (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: refund.id, cell: 0 }));
    const start = { id: randomUUID(), action: 'start', amount: 10, mineCount: 24 };
    (await wallet.mines.operate('alice', start));
    const complete = (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 24 }));
    assert.equal(complete.session!.state, 'cashed_out');
    assert.equal(complete.session!.multiplier, 24.5);
    assert.equal(complete.session!.payout, 245);
    assert.equal(complete.wallet.balance, 1185);
  } finally { (await db.close()); }
});

test('Mines refuses mutations and concurrent second sessions, and operation identities cannot be changed', async () => {
  const { db, wallet } = (await fixture());
  try {
    for (const input of [null, {}, { id: randomUUID(), action: 'start', amount: 10, mineCount: 0 },
      { id: randomUUID(), action: 'start', amount: 10, mineCount: 25 }, { id: randomUUID(), action: 'start', amount: 1, mineCount: 3 },
      { id: randomUUID(), action: 'start', amount: 10, mineCount: 3, mineCells: [0] }]) (await assert.rejects(async () => (await wallet.mines.operate('alice', input)), status(400)));
    const start = { id: randomUUID(), action: 'start', amount: 10, mineCount: 3 };
    (await wallet.mines.operate('alice', start));
    (await assert.rejects(async () => (await wallet.mines.operate('alice', { ...start, id: randomUUID() })), status(409)));
    (await assert.rejects(async () => (await wallet.mines.operate('alice', { ...start, mineCount: 4 })), status(409)));
    (await assert.rejects(async () => (await wallet.operate('alice', { id: start.id, kind: 'deposit', amount: 10 })), status(409)));
    for (const cell of [-1, 25, 0.5, NaN]) (await assert.rejects(async () => (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell })), status(400)));
  } finally { (await db.close()); }
});

test('Mines future payout headroom is checked before RNG and preserved across deposits and instant wagers', async () => {
  const { db, wallet, draws } = (await fixture());
  try {
    (await saveDemoUnits(db, 'alice', MAX_DEMO_UNITS - 23500));
    const start = { id: randomUUID(), action: 'start', amount: 10, mineCount: 24 };
    (await wallet.mines.operate('alice', start));
    assert.equal((await wallet.mines.reservedUnits('alice')), 24500);
    assert.equal(draws(), 24);
    const before = (await wallet.snapshot('alice'));
    (await assert.rejects(async () => (await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1 })), status(400)));
    (await assert.rejects(async () => (await wallet.operate('alice', { id: randomUUID(), kind: 'spin', amount: 10 })), status(400)));
    assert.equal(draws(), 24);
    assert.deepEqual((await wallet.snapshot('alice')), before);
    const complete = (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 24 }));
    assert.equal(complete.wallet.balance, MAX_DEMO_UNITS / 100);
    assert.equal((await wallet.mines.reservedUnits('alice')), 0);
  } finally { (await db.close()); }
  const second = (await fixture());
  try {
    (await saveDemoUnits(second.db, 'alice', MAX_DEMO_UNITS - 23499));
    (await assert.rejects(async () => (await second.wallet.mines.operate('alice', { id: randomUUID(), action: 'start', amount: 10, mineCount: 24 })), status(400)));
    assert.equal(second.draws(), 0);
    assert.equal((await second.wallet.mines.active('alice')).session, null);
  } finally { (await second.db.close()); }
});

test('failed Mines persistence rolls back debit and failed cashout rolls back credit and session state', async () => {
  const { db, wallet } = (await fixture());
  try {
    const start = { id: randomUUID(), action: 'start', amount: 10, mineCount: 3 };
    (await db.exec("CREATE OR REPLACE FUNCTION reject_mines_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_mines BEFORE INSERT ON demo_mines_requests FOR EACH ROW EXECUTE FUNCTION reject_mines_fn();"));
    const before = (await wallet.snapshot('alice'));
    (await assert.rejects(async () => (await wallet.mines.operate('alice', start)), /interrupted/));
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal((await wallet.mines.active('alice')).session, null);
    (await db.exec('DROP TRIGGER reject_mines ON demo_mines_requests'));
    (await wallet.mines.operate('alice', start));
    (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 3 }));
    const active = (await wallet.mines.active('alice'));
    (await db.exec("CREATE OR REPLACE FUNCTION reject_mines_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_mines BEFORE INSERT ON demo_mines_requests FOR EACH ROW EXECUTE FUNCTION reject_mines_fn();"));
    const cashout = { id: randomUUID(), action: 'cashout', sessionId: start.id };
    (await assert.rejects(async () => (await wallet.mines.operate('alice', cashout)), /interrupted/));
    assert.deepEqual((await wallet.mines.active('alice')), active);
    (await db.exec('DROP TRIGGER reject_mines ON demo_mines_requests'));
    assert.equal((await wallet.mines.operate('alice', cashout)).wallet.balance, 1001.1);
  } finally { (await db.close()); }
});

test('Mines indexes the recent account window and preserves the 120-action limit across reopening', async () => {
  const { db, wallet, draws } = (await fixture());
  try {
    const query = 'SELECT COUNT(*) AS n FROM demo_mines_requests WHERE account_id=? AND created_at>?';
    const assertIndexedWindow = async () => {
      const details = await db.transaction(async () => {
        await db.exec('SET LOCAL enable_seqscan=off');
        return (await db.prepare('EXPLAIN ' + query).all('alice', Date.now() - 60000)).map(row => String(row['QUERY PLAN'])).join('\n');
      });
      assert.match(details, /demo_mines_requests_time/);
      assert.match(details, /account_id.*alice/);
      assert.match(details, /created_at >/);
    };
    (await assertIndexedWindow());
    let first: { id: string; action: 'start'; amount: number; mineCount: number } | undefined;
    for (let i = 0; i < 60; i++) {
      const start = { id: randomUUID(), action: 'start' as const, amount: 10, mineCount: 24 };
      first ??= start;
      (await wallet.mines.operate('alice', start));
      (await wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: start.id, cell: 24 }));
    }
    const before = (await wallet.snapshot('alice')), drawsBefore = draws();
    const next = { id: randomUUID(), action: 'start', amount: 10, mineCount: 24 };
    (await assert.rejects(async () => (await wallet.mines.operate('alice', next)), status(429)));
    assert.equal(draws(), drawsBefore);
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal((await wallet.mines.operate('alice', first!)).session!.state, 'cashed_out');
    assert.deepEqual((await wallet.snapshot('alice')), before);
    const reopened = new DemoWalletStore(db, () => 0);
    (await assertIndexedWindow());
    assert.equal((await db.prepare("SELECT indexname AS name FROM pg_indexes WHERE schemaname=current_schema() AND tablename='demo_mines_requests'").all()).filter(row => row.name === 'demo_mines_requests_time').length, 1);
    (await assert.rejects(async () => (await reopened.mines.operate('alice', next)), status(429)));
    (await reopened.operate('bob', { id: randomUUID(), kind: 'deposit', amount: 1000 }));
    assert.equal((await reopened.mines.operate('bob', { ...next, id: randomUUID() })).session!.state, 'active');
    (await db.prepare('UPDATE demo_mines_requests SET created_at=? WHERE account_id=? AND id=?').run(Date.now() - 60001, 'alice', first!.id));
    assert.equal((await reopened.mines.operate('alice', next)).session!.state, 'active');
    assert.equal(Number((await db.prepare(query).get('alice', Date.now() - 60000))!.n), 120);
  } finally { (await db.close()); }
});
