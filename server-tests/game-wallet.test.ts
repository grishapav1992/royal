import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { CasinoApiProWallet } from '../server/casinoApiProWallet';
import { demoBalanceUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';

async function database(path = ':memory:') {
  const db = new PostgresDatabase(path);
  (await db.exec("  CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('alice'),('bob') ON CONFLICT DO NOTHING;"));
  return db;
}

const deposit = (amount = 1000) => ({ id: randomUUID(), kind: 'deposit', amount });
const roulette = (input: unknown = { bet: 'red' }, amount = 100) => ({
  id: randomUUID(), kind: 'play', amount, gameId: 'royal-roulette', rulesVersion: 1, input,
});
const status = (expected: number) => (error: unknown) => error instanceof WalletError && error.status === expected;
const operationCount = async (db: PostgresDatabase) => Number((await db.prepare('SELECT COUNT(*) AS n FROM demo_operations').get())!.n);

test('roulette replay after restart preserves the committed outcome and returns the current shared balance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royal-game-restart-')), path = join(dir, 'wallet.sqlite');
  let db = (await database(path)), draws = 0;
  let wallet = new DemoWalletStore(db, max => { assert.equal(max, 37); draws++; return 7; });
  const request = roulette({ bet: 'number', number: 7 });
  try {
    (await wallet.operate('alice', deposit()));
    const first = (await wallet.operate('alice', request));
    assert.deepEqual(first.gameRound, {
      gameId: 'royal-roulette', rulesVersion: 1, stakeUnits: '10000', payoutUnits: '360000',
      input: { bet: 'number', number: 7 }, multiplier: 36, outcome: { number: 7 },
    });
    assert.equal(first.wallet.balance, 4500);
    assert.equal(first.round, undefined);
    (await wallet.operate('alice', deposit(50)));
    (await db.close());
    db = (await database(path));
    wallet = new DemoWalletStore(db, () => { throw new Error('A committed game must not draw again'); });
    const replay = (await wallet.operate('alice', { ...request, input: { number: 7, bet: 'number' } }));
    assert.deepEqual(replay.gameRound, first.gameRound);
    assert.equal(replay.wallet.balance, 4550);
    assert.equal(replay.wallet.entries.length, 4);
    assert.equal(draws, 1);
    assert.equal((await operationCount(db)), 3);
    assert.equal((await wallet.snapshot('bob')).balance, 0);
  } finally { (await db.close()); rmSync(dir, { recursive: true, force: true }); }
});

test('operation identity includes the game and bet, and malformed rules cannot change a funded wallet', async () => {
  const db = (await database()); let draws = 0;
  const wallet = new DemoWalletStore(db, () => { draws++; return 1; });
  try {
    (await wallet.operate('alice', deposit()));
    const request = roulette();
    (await wallet.operate('alice', request));
    const before = (await wallet.snapshot('alice'));
    for (const changed of [
      { ...request, input: { bet: 'black' } },
      { ...request, input: { bet: 'number', number: 1 } },
      { ...request, gameId: 'royal-coins', input: {} },
      { ...request, amount: 50 },
      { id: request.id, kind: 'spin', amount: request.amount },
    ]) (await assert.rejects(async () => (await wallet.operate('alice', changed)), status(409)));

    for (const invalid of [
      { ...request, rulesVersion: 2 },
      { ...roulette(), rulesVersion: '1' },
      { ...roulette(), gameId: 'missing-game' },
      roulette({ bet: 'number', number: 37 }),
      roulette({ bet: 'number', number: -1 }),
      roulette({ bet: 'number', number: 1.5 }),
      roulette({ bet: 'number' }),
      roulette({ bet: 'red', number: 1 }),
      roulette({ bet: 'red', payoutUnits: '99999999' }),
      roulette(null),
      { ...roulette(), payoutUnits: '99999999' },
      { ...roulette(), gameId: 'royal-coins', input: { symbols: [0, 0, 0] } },
    ]) (await assert.rejects(async () => (await wallet.operate('alice', invalid)), status(400)));
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal((await operationCount(db)), 2);
    assert.equal(draws, 1);
  } finally { (await db.close()); }
});

test('saved legacy spins migrate without a request key and still replay without generating a new outcome', async () => {
  const db = (await database()), id = randomUUID();
  const round = { symbols: [2, 2, 2], bet: 100, payout: 1200, multiplier: 12 };
  (await db.exec(`CREATE TABLE demo_wallets(account_id TEXT PRIMARY KEY REFERENCES accounts(id), balance INTEGER NOT NULL);
    CREATE TABLE demo_operations(account_id TEXT NOT NULL, operation_id TEXT NOT NULL, kind TEXT NOT NULL,
      amount INTEGER NOT NULL, result TEXT NOT NULL, PRIMARY KEY(account_id,operation_id));
    CREATE TABLE demo_ledger(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, account_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('deposit','bet','win')), amount INTEGER NOT NULL, balance INTEGER NOT NULL, created_at INTEGER NOT NULL);
    INSERT INTO demo_wallets VALUES('alice',2100);
    INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at) VALUES
      ('alice','funding','deposit',1000,1000,1), ('alice','old-bet','bet',-100,900,2), ('alice','old-bet','win',1200,2100,2);`));
  (await db.prepare('INSERT INTO demo_operations VALUES (?,?,?,?,?)').run('alice', id, 'spin', 100, JSON.stringify({ round })));
  try {
    let wallet = new DemoWalletStore(db, () => { throw new Error('Legacy replay must not draw'); });
    await wallet.ready;
    wallet = new DemoWalletStore(db, () => { throw new Error('Repeated migration must not draw'); });
    const replay = (await wallet.operate('alice', { id, kind: 'spin', amount: 100 }));
    assert.deepEqual(replay.round, round);
    assert.equal(replay.gameRound, undefined);
    assert.equal(replay.wallet.balance, 2100);
    assert.equal(replay.wallet.entries.length, 3);
    assert.equal((await db.prepare('SELECT request_key FROM demo_operations WHERE operation_id=?').get(id))!.request_key, null);
    (await assert.rejects(async () => (await wallet.operate('alice', { id, kind: 'play', amount: 100, gameId: 'royal-coins', rulesVersion: 1, input: {} })), status(409)));
    (await assert.rejects(async () => (await wallet.operate('alice', { id, kind: 'spin', amount: 500 })), status(409)));
    assert.equal((await operationCount(db)), 1);
  } finally { (await db.close()); }
});

test('provider fractions, roulette, slots and refunds settle into one exact wallet without changing provider replay semantics', async () => {
  const db = (await database()), wallet = new DemoWalletStore(db, () => 0), provider = new CasinoApiProWallet(db);
  const playerId = (await provider.player('alice'));
  const debit = { playerId, currency: 'USD', transactionId: 'fractional-bet', amount: '0.20', roundId: 'external-round' };
  try {
    (await wallet.operate('alice', deposit()));
    const originalDebit = (await provider.callback('debit', debit, 'USD'));
    (await provider.callback('credit', { ...debit, transactionId: 'fractional-win', amount: '0.55' }, 'USD'));
    assert.equal((await wallet.operate('alice', roulette())).wallet.balance, 900.35);
    const slots = (await wallet.operate('alice', { ...roulette(), gameId: 'royal-coins', input: {} }));
    assert.equal(slots.gameRound?.payoutUnits, '120000');
    assert.equal(slots.wallet.balance, 2000.35);
    (await provider.callback('refund', { ...debit, transactionId: 'fractional-refund', referenceTransactionId: debit.transactionId }, 'USD'));
    assert.equal((await demoBalanceUnits(db, 'alice')), 200055);
    assert.deepEqual((await provider.callback('debit', debit, 'USD')), { ...originalDebit, duplicate: true });
    assert.equal((await demoBalanceUnits(db, 'alice')), 200055);
    let total = 0;
    for (const entry of (await wallet.snapshot('alice')).entries.reverse()) {
      total += Math.round(entry.amount * 100);
      assert.equal(Math.round(entry.balance * 100), total);
    }
    assert.equal(total, 200055);
    assert.equal((await wallet.snapshot('alice')).entries.filter(entry => entry.source === 'royal-roulette').length, 2);
    assert.equal((await wallet.snapshot('alice')).entries.filter(entry => entry.source === 'casinoapipro').length, 3);
    assert.equal((await wallet.snapshot('bob')).balance, 0);
  } finally { (await db.close()); }
});

test('a failure storing the finished game rolls back both ledger entries and the wallet, then the same operation can succeed', async () => {
  const db = (await database()), wallet = new DemoWalletStore(db, () => 7), request = roulette({ bet: 'number', number: 7 });
  try {
    (await wallet.operate('alice', deposit()));
    const before = (await wallet.snapshot('alice'));
    (await db.exec("CREATE OR REPLACE FUNCTION reject_game_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='play' THEN RAISE EXCEPTION 'Game storage interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_game BEFORE INSERT ON demo_operations FOR EACH ROW EXECUTE FUNCTION reject_game_fn();"));
    (await assert.rejects(async () => (await wallet.operate('alice', request)), /Game storage interrupted/));
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal((await operationCount(db)), 1);
    (await db.exec('DROP TRIGGER reject_game ON demo_operations'));
    assert.equal((await wallet.operate('alice', request)).wallet.balance, 4500);
    assert.equal((await wallet.snapshot('alice')).entries.length, 3);
    assert.equal((await operationCount(db)), 2);
  } finally { (await db.close()); }
});

test('maximum possible payout is checked before randomness, while the exact wallet limit and completed replays are allowed', async () => {
  const db = (await database()); let draws = 0;
  const wallet = new DemoWalletStore(db, () => { draws++; return 7; });
  await wallet.ready;
  const request = roulette({ bet: 'number', number: 7 });
  const capacityForNetWin = 35 * request.amount * 100;
  try {
    (await saveDemoUnits(db, 'alice', MAX_DEMO_UNITS - capacityForNetWin + 1));
    (await assert.rejects(async () => (await wallet.operate('alice', request)), status(400)));
    assert.equal(draws, 0);
    assert.equal((await operationCount(db)), 0);
    assert.equal((await wallet.snapshot('alice')).entries.length, 0);
    assert.equal((await demoBalanceUnits(db, 'alice')), MAX_DEMO_UNITS - capacityForNetWin + 1);
    (await saveDemoUnits(db, 'alice', MAX_DEMO_UNITS - capacityForNetWin));
    const first = (await wallet.operate('alice', request));
    assert.equal((await demoBalanceUnits(db, 'alice')), MAX_DEMO_UNITS);
    assert.deepEqual((await wallet.operate('alice', request)).gameRound, first.gameRound);
    assert.equal(draws, 1);
    assert.equal((await operationCount(db)), 1);
  } finally { (await db.close()); }
});

test('roulette reserves the selected bet payout and allows a red win that reaches the wallet limit exactly', async () => {
  const db = (await database()); let draws = 0;
  const wallet = new DemoWalletStore(db, () => { draws++; return 7; });
  await wallet.ready;
  try {
    (await saveDemoUnits(db, 'alice', 999999900 * 100));
    const before = (await wallet.snapshot('alice'));
    (await assert.rejects(async () => (await wallet.operate('alice', roulette({ bet: 'number', number: 7 }, 100))), status(400)));
    assert.deepEqual((await wallet.snapshot('alice')), before);
    assert.equal((await operationCount(db)), 0);
    assert.equal(draws, 0);

    const result = (await wallet.operate('alice', roulette({ bet: 'red' }, 100)));
    assert.equal(result.gameRound?.multiplier, 2);
    assert.equal(result.gameRound?.payoutUnits, '20000');
    assert.equal(result.wallet.balance, 1000000000);
    assert.equal((await demoBalanceUnits(db, 'alice')), MAX_DEMO_UNITS);
    assert.equal(result.wallet.entries.length, 2);
    assert.equal((await operationCount(db)), 1);
    assert.equal(draws, 1);
  } finally { (await db.close()); }
});

test('independent PostgreSQL connections serialize overlapping game wagers and cannot spend the same funds twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royal-game-concurrent-')), path = join(dir, 'wallet.sqlite');
  const db = (await database(path)), wallet = new DemoWalletStore(db);
  (await wallet.operate('alice', deposit(100)));
  const moduleUrl = new URL('../server/demoWallet.ts', import.meta.url).href;
  const children: ReturnType<typeof spawn>[] = [];
  async function contender(request: ReturnType<typeof roulette>) {
    const source = `import { PostgresDatabase } from ${JSON.stringify(new URL('../server/database.ts', import.meta.url).href)};
      import { DemoWalletStore } from ${JSON.stringify(moduleUrl)};
      const db = new PostgresDatabase(${JSON.stringify(path)});
      const wallet = new DemoWalletStore(db, () => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
        return 0;
      });
      await wallet.ready;
      console.log(JSON.stringify({ ready: true }));
      process.stdin.once('data', async () => {
        try { const result = await wallet.operate('alice', ${JSON.stringify(request)});
          console.log(JSON.stringify({ ok: true, balance: result.wallet.balance }));
        } catch (error) { console.log(JSON.stringify({ ok: false, status: error.status, message: error.message })); }
        finally { await db.close(); process.stdin.pause(); }
      });`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    let resolveResult!: (value: { ok: boolean; status?: number; balance?: number }) => void, rejectResult!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const result = new Promise<{ ok: boolean; status?: number; balance?: number }>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    // Attach rejection handlers before either process can fail during startup.
    void ready.catch(() => {}); void result.catch(() => {});
    let stderr = '', received = false;
    child.stderr!.on('data', chunk => { stderr += chunk; });
    const fail = (error: Error) => { rejectReady(error); rejectResult(error); };
    const timer = setTimeout(() => { child.kill(); fail(new Error('Concurrent wager process timed out')); }, 15000);
    createInterface({ input: child.stdout! }).on('line', line => {
      try {
        const value = JSON.parse(line);
        if (value.ready) resolveReady();
        else { received = true; resolveResult(value); }
      } catch { fail(new Error('Unexpected concurrent wager output')); }
    });
    child.on('error', fail);
    child.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0 || !received) fail(new Error(`Concurrent wager process exited (${code}): ${stderr}`));
    });
    return { ready, result, start: () => child.stdin!.end('play\n') };
  }
  try {
    const a = (await contender(roulette())), b = (await contender(roulette()));
    await Promise.all([a.ready, b.ready]);
    a.start(); b.start();
    const results = await Promise.all([a.result, b.result]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(results.find(result => !result.ok)?.status, 400);
    assert.equal((await wallet.snapshot('alice')).balance, 0);
    assert.equal((await wallet.snapshot('alice')).entries.length, 3);
    assert.equal((await operationCount(db)), 2);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    (await db.close()); rmSync(dir, { recursive: true, force: true });
  }
});
