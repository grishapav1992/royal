import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { CasinoApiProWallet } from '../server/casinoApiProWallet';
import { demoBalanceUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
import { GAME_CATALOG } from '../src/shared/gameCore';
import { validUsdtRequest } from '../src/shared/usdtWallet';
import { validNileRoundRequest } from '../src/shared/nilePlay';

async function database(path = ':memory:') {
  const db = new PostgresDatabase(path);
  (await db.exec(" CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('alice'),('bob') ON CONFLICT DO NOTHING;"));
  return db;
}
const deposit = (amount = 1000) => ({ id: randomUUID(), kind: 'deposit', amount });
const fruits = (amount = 100) => ({ id: randomUUID(), kind: 'play', amount, gameId: 'royal-fruits', rulesVersion: 1, input: {} });
const status = (expected: number) => (error: unknown) => error instanceof WalletError && error.status === expected;
const operationCount = async (db: PostgresDatabase) => Number((await db.prepare('SELECT COUNT(*) AS n FROM demo_operations').get())!.n);

test('fruits shares exact provider cents and replays a committed round after restart without drawing again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royal-fruits-restart-')), path = join(dir, 'wallet.sqlite');
  let db = (await database(path)), draws = 0;
  let wallet = new DemoWalletStore(db, max => { assert.equal(max, 20); draws++; return 19; });
  let provider = new CasinoApiProWallet(db);
  const playerId = (await provider.player('alice'));
  const debit = { playerId, currency: 'USD', transactionId: 'fruits-provider-bet', amount: '0.20', roundId: 'external-round' };
  const request = fruits();
  try {
    (await wallet.operate('alice', deposit()));
    const originalDebit = (await provider.callback('debit', debit, 'USD'));
    (await provider.callback('credit', { ...debit, transactionId: 'fruits-provider-win', amount: '0.55' }, 'USD'));
    const first = (await wallet.operate('alice', request));
    assert.deepEqual(first.gameRound, {
      gameId: 'royal-fruits', rulesVersion: 1, stakeUnits: '10000', payoutUnits: '1400000',
      input: {}, multiplier: 140, outcome: { symbols: [3, 3, 3] },
    });
    assert.equal(first.round, undefined);
    assert.equal(first.wallet.balance, 14900.35);
    const entries = first.wallet.entries.filter(entry => entry.operationId === request.id);
    assert.deepEqual(entries.map(entry => [entry.kind, entry.amount]).reverse(), [['bet', -100], ['win', 14000]]);
    assert.ok(entries.every(entry => entry.source === 'royal-fruits' && entry.gameName === GAME_CATALOG.find(game => game.id === 'royal-fruits')?.name));
    (await wallet.operate('alice', deposit(50)));
    (await db.close()); db = (await database(path));
    wallet = new DemoWalletStore(db, () => { throw new Error('Committed fruits round must not draw again'); });
    provider = new CasinoApiProWallet(db);
    const replay = (await wallet.operate('alice', request));
    assert.deepEqual(replay.gameRound, first.gameRound);
    assert.equal(replay.round, undefined);
    assert.equal(replay.wallet.balance, 14950.35);
    assert.equal((await demoBalanceUnits(db, 'alice')), 1495035);
    assert.deepEqual((await provider.callback('debit', debit, 'USD')), { ...originalDebit, duplicate: true });
    assert.equal((await demoBalanceUnits(db, 'alice')), 1495035);
    assert.equal(draws, 3);
    assert.equal((await operationCount(db)), 3);
    assert.equal((await wallet.snapshot('bob')).balance, 0);
    let units = 0;
    for (const entry of (await wallet.snapshot('alice')).entries.reverse()) {
      units += Math.round(entry.amount * 100);
      assert.equal(Math.round(entry.balance * 100), units);
    }
    assert.equal(units, 1495035);
  } finally { (await db.close()); rmSync(dir, { recursive: true, force: true }); }
});

test('fruits rejects forged outcomes and conflicting operation identities before altering the wallet', async () => {
  const db = (await database()); let draws = 0;
  const wallet = new DemoWalletStore(db, max => { assert.equal(max, 20); draws++; return 0; });
  try {
    (await wallet.operate('alice', deposit()));
    const request = fruits(), first = (await wallet.operate('alice', request)), before = (await wallet.snapshot('alice'));
    assert.equal(first.gameRound?.multiplier, 5);
    for (const changed of [
      { ...request, amount: 50 },
      { ...request, gameId: 'royal-coins' },
      { ...request, gameId: 'royal-roulette', input: { bet: 'red' } },
      { id: request.id, kind: 'spin', amount: request.amount },
    ]) (await assert.rejects(async () => (await wallet.operate('alice', changed)), status(409)));
    for (const invalid of [
      { ...fruits(), input: { symbols: [3, 3, 3] } },
      { ...fruits(), input: { stops: [19, 19, 19] } },
      { ...fruits(), payoutUnits: '1400000' },
      { ...fruits(), multiplier: 140 },
      { ...fruits(), rulesVersion: 2 },
      { ...fruits(), input: null },
    ]) (await assert.rejects(async () => (await wallet.operate('alice', invalid)), status(400)));
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal(draws, 3);
    assert.equal((await operationCount(db)), 2);
    (await assert.rejects(async () => (await wallet.operate('bob', request)), status(400)));
    assert.equal((await wallet.snapshot('bob')).balance, 0);
    assert.equal(draws, 3);
  } finally { (await db.close()); }
});

test('fruits keeps the legacy spin receipt attached to Royal Coins only', async () => {
  const db = (await database()), wallet = new DemoWalletStore(db, () => 0);
  try {
    (await wallet.operate('alice', deposit()));
    const fruitRound = (await wallet.operate('alice', fruits()));
    assert.equal(fruitRound.gameRound?.gameId, 'royal-fruits');
    assert.equal(fruitRound.round, undefined);
    assert.equal(fruitRound.wallet.balance, 1400);
    const oldSpin = (await wallet.operate('alice', { id: randomUUID(), kind: 'spin', amount: 100 }));
    assert.equal(oldSpin.gameRound?.gameId, 'royal-coins');
    assert.deepEqual(oldSpin.round, { symbols: [0, 0, 0], bet: 100, payout: 1200, multiplier: 12 });
    assert.equal(oldSpin.wallet.balance, 2500);
  } finally { (await db.close()); }
});

test('fruits covers the 140x payout before randomness and allows an exact-limit settlement and replay', async () => {
  const db = (await database()); let draws = 0;
  const wallet = new DemoWalletStore(db, max => { assert.equal(max, 20); draws++; return 19; });
  await wallet.ready;
  const request = fruits(), netCapacity = (140 - 1) * request.amount * 100;
  try {
    (await saveDemoUnits(db, 'alice', MAX_DEMO_UNITS - netCapacity + 1));
    (await assert.rejects(async () => (await wallet.operate('alice', request)), status(400)));
    assert.equal(draws, 0);
    assert.equal((await operationCount(db)), 0);
    assert.equal((await wallet.snapshot('alice')).entries.length, 0);
    assert.equal((await demoBalanceUnits(db, 'alice')), MAX_DEMO_UNITS - netCapacity + 1);
    (await saveDemoUnits(db, 'alice', MAX_DEMO_UNITS - netCapacity));
    const first = (await wallet.operate('alice', request));
    assert.equal((await demoBalanceUnits(db, 'alice')), MAX_DEMO_UNITS);
    assert.equal(first.gameRound?.payoutUnits, '1400000');
    assert.deepEqual((await wallet.operate('alice', request)).gameRound, first.gameRound);
    assert.equal(draws, 3);
    assert.equal((await operationCount(db)), 1);
    assert.equal((await wallet.snapshot('alice')).entries.length, 2);
  } finally { (await db.close()); }
});

test('fruits settlement interruption rolls back ledger and balance before retry', async () => {
  const db = (await database()), wallet = new DemoWalletStore(db, () => 0), request = fruits();
  try {
    (await wallet.operate('alice', deposit()));
    const before = (await wallet.snapshot('alice'));
    (await db.exec("CREATE OR REPLACE FUNCTION reject_fruits_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (NEW.result::jsonb #>> '{gameRound,gameId}')='royal-fruits' THEN RAISE EXCEPTION 'Fruits storage interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_fruits BEFORE INSERT ON demo_operations FOR EACH ROW EXECUTE FUNCTION reject_fruits_fn();"));
    (await assert.rejects(async () => (await wallet.operate('alice', request)), /Fruits storage interrupted/));
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal((await operationCount(db)), 1);
    (await db.exec('DROP TRIGGER reject_fruits ON demo_operations'));
    assert.equal((await wallet.operate('alice', request)).wallet.balance, 1400);
    assert.equal((await wallet.snapshot('alice')).entries.length, 3);
    assert.equal((await operationCount(db)), 2);
  } finally { (await db.close()); }
});

test('fruits is excluded by both USDT and Nile request contracts', () => {
  const request = { id: randomUUID(), gameId: 'royal-fruits', input: {}, stakeUnits: '1000000' };
  assert.equal(validUsdtRequest(request), false);
  assert.equal(validNileRoundRequest(request), false);
  assert.equal(validNileRoundRequest({ id: request.id, stakeUnits: request.stakeUnits }), true);
});
