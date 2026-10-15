import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import express from 'express';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { flightCrashCents } from '../server/demoFlight';
import { DemoCapacityError, demoBalanceUnits, MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
import { CasinoApiProWallet, ProviderWalletError } from '../server/casinoApiProWallet';
import { prepareGame, verifyGameRound } from '../server/games/core';
import { DEMO_BETS } from '../src/shared/demoWallet';
import { WHEEL_MULTIPLIER_CENTS, WHEEL_RISKS, WHEEL_SEGMENT_COUNT } from '../src/shared/themedGames';
import { FLIGHT_ENTROPY_SIZE, flightAutoCashoutCents, flightMultiplierCentsAt, flightTimeForCents } from '../src/shared/flightGame';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

const status = (code: number) => (error: unknown) => error instanceof WalletError && error.status === code;
async function fixture(draw: (max: number) => number = () => 0, path = ':memory:') {
  const db = new PostgresDatabase(path);
  (await db.exec(" CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob') ON CONFLICT DO NOTHING;"));
  let now = 1_800_000_000_000, draws = 0;
  const wallet = new DemoWalletStore(db, max => { draws++; return draw(max); }, () => now);
  await wallet.ready;
  if ((await demoBalanceUnits(db, 'alice')) === 0) (await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1000 }));
  return { db, wallet, now: () => now, time: (value: number) => { now = value; }, draws: () => draws };
}
const start = (autoCashout = 2, amount = 10) => ({ id: randomUUID(), action: 'start', amount, autoCashout });

test('all Wheel outcomes and permitted stakes have exact 98% RTP and verified integer payouts', () => {
  for (const risk of WHEEL_RISKS) {
    assert.equal(WHEEL_MULTIPLIER_CENTS[risk].length, WHEEL_SEGMENT_COUNT);
    assert.equal(WHEEL_MULTIPLIER_CENTS[risk].reduce((sum, value) => sum + value, 0), 4900);
    const prepared = prepareGame('royal-wheel', 1, { risk });
    assert.equal(prepared.maxMultiplier, risk === 'low' ? 2 : risk === 'medium' ? 5 : 49);
    for (const stake of DEMO_BETS) {
      let total = 0n;
      for (let segment = 0; segment < 50; segment++) {
        const round = prepared.play(BigInt(stake * 100), max => { assert.equal(max, 50); return segment; });
        assert.equal(verifyGameRound(round), true);
        assert.equal(round.payoutUnits, String(BigInt(stake) * BigInt(WHEEL_MULTIPLIER_CENTS[risk][segment])));
        assert.equal(verifyGameRound({ ...round, payoutUnits: String(BigInt(round.payoutUnits) + 1n) }), false);
        assert.equal(verifyGameRound({ ...round, outcome: { segment, payout: 1 } }), false);
        assert.equal(verifyGameRound({ ...round, outcome: { segment: 50 } }), false);
        total += BigInt(round.payoutUnits);
      }
      assert.equal(total * 100n, BigInt(stake * 100) * 50n * 98n);
    }
  }
});

test('Wheel rejects forged risk, extra properties, prototype objects and invalid entropy', () => {
  for (const input of [null, [], {}, { risk: 'constructor' }, { risk: 'classic' }, { risk: 'low', outcome: 1 },
    JSON.parse('{"risk":"low","__proto__":{"polluted":true}}'), Object.create({ risk: 'low' }), { risk: 'low', [Symbol('hidden')]: 1 }]) {
    assert.throws(() => prepareGame('royal-wheel', 1, input));
  }
  for (const draw of [-1, 50, NaN, 0.5, Infinity]) assert.throws(() => prepareGame('royal-wheel', 1, { risk: 'high' }).play(1000n, () => draw));
  assert.throws(() => prepareGame('royal-wheel', 2, { risk: 'low' }));
});

test('Wheel wallet replay preserves the drawn segment, exact cents and final game name', async () => {
  const f = (await fixture(() => 9));
  try {
    const operation = { id: randomUUID(), kind: 'play', amount: 10, gameId: 'royal-wheel', rulesVersion: 1, input: { risk: 'low' } };
    const result = (await f.wallet.operate('alice', operation));
    assert.equal(result.wallet.balance, 1008);
    assert.equal(result.gameRound?.gameId, 'royal-wheel');
    assert.equal(result.gameRound?.payoutUnits, '1800');
    assert.deepEqual((await f.wallet.operate('alice', operation)), result);
    assert.equal(f.draws(), 1);
    assert.equal(result.wallet.entries[0].gameName, 'Royal Fortune');
    (await assert.rejects(async () => (await f.wallet.operate('alice', { ...operation, input: { risk: 'high' } })), status(409)));
  } finally { (await f.db.close()); }
});

test('Flight discrete entropy proves the 98% upper bound at every permitted target and exact cutoff', () => {
  const n = BigInt(FLIGHT_ENTROPY_SIZE);
  for (let target = 110; target <= 10_000; target++) {
    const survivors = 98n * n / BigInt(target);
    assert(BigInt(target) * survivors <= 98n * n);
    assert.equal(flightCrashCents(Number(survivors - 1n)) >= target, true);
    assert.equal(flightCrashCents(Number(survivors)) < target, true);
    assert.equal(flightAutoCashoutCents(target / 100), target);
  }
  assert.equal(flightCrashCents(0), 10000);
  assert.equal(flightCrashCents(FLIGHT_ENTROPY_SIZE - 1), 98);
  for (const draw of [-1, FLIGHT_ENTROPY_SIZE, NaN, 0.5, Infinity]) assert.throws(() => flightCrashCents(draw));
});

test('Flight growth steps agree with deadline boundaries and clamp instant crashes', () => {
  const start = 5000;
  assert.equal(flightTimeForCents(98), 0);
  assert.equal(flightTimeForCents(99), 0);
  assert.equal(flightTimeForCents(100), 0);
  for (let cents = 101; cents <= 10000; cents++) {
    const time = flightTimeForCents(cents);
    assert.equal(flightMultiplierCentsAt(start, start + time), cents);
    assert.equal(flightMultiplierCentsAt(start, start + time - 1), cents - 1);
    assert(flightTimeForCents(cents + 1) > time);
  }
  assert.equal(flightMultiplierCentsAt(start, start - 10), 100);
  assert.equal(flightMultiplierCentsAt(start, start + 1000000), 10000);
});

test('Flight persists hidden entropy and resolves automatic cashout once after a true database restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'royal-flight-'));
  const path = join(directory, 'wallet.sqlite');
  const f = (await fixture(() => 0, path));
  const operation = start(2, 100), started = f.now();
  try {
    const result = (await f.wallet.flight.operate('alice', operation));
    assert.equal(result.wallet.balance, 900);
    assert.equal(result.session!.state, 'active');
    assert.equal(result.session!.multiplier, 1);
    assert.equal(result.session!.cashoutValue, 100);
    assert.equal(result.session!.payout, 0);
    assert.equal(result.session!.settledAt, null);
    assert.equal(result.session!.reason, null);
    assert.deepEqual(Object.keys(result.session!).sort(), ['amount','autoCashout','cashoutValue','id','multiplier','payout','reason','settledAt','startedAt','state']);
    assert.doesNotMatch(JSON.stringify(result), /crash_cents|crashCents|crashPoint|deadline|death|endTime/);
    assert.equal((await f.wallet.flight.reservedUnits('alice')), 1_000_000);
    assert.deepEqual((await f.wallet.flight.operate('alice', operation)), result);
    assert.equal(f.draws(), 1);
    (await f.db.close());
    const db = new PostgresDatabase(path);
    let now = started + flightTimeForCents(200) - 1;
    const reopened = new DemoWalletStore(db, () => { throw new Error('A persisted flight must never redraw'); }, () => now);
    try {
      assert.equal((await reopened.flight.snapshot('alice')).session!.state, 'active');
      now++;
      const cashed = (await reopened.flight.snapshot('alice'));
      assert.equal(cashed.serverNow, now);
      assert.equal(cashed.session!.state, 'cashed_out');
      assert.equal(cashed.session!.reason, 'auto');
      assert.equal(cashed.session!.multiplier, 2);
      assert.equal(cashed.session!.payout, 200);
      assert.equal(cashed.session!.settledAt, started + flightTimeForCents(200));
      assert.equal(cashed.wallet.balance, 1100);
      assert.equal((await reopened.flight.reservedUnits('alice')), 0);
      assert.deepEqual((await reopened.flight.operate('alice', operation)), cashed);
      now += 100000;
      assert.equal((await reopened.flight.snapshot('alice')).wallet.balance, 1100);
      const late = (await reopened.flight.operate('alice', { id: randomUUID(), action: 'cashout', sessionId: operation.id }));
      assert.equal(late.session!.reason, 'auto');
      assert.equal(late.wallet.entries.filter(entry => entry.source === 'royal-flight' && entry.kind === 'win').length, 1);
      assert.equal(late.wallet.entries.find(entry => entry.source === 'royal-flight')!.gameName, 'Royal Orbit');
    } finally { (await db.close()); }
  } finally { await f.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('manual Flight cashout uses the server step, exact units and current replay truth', async () => {
  const f = (await fixture());
  try {
    const operation = start(100, 10), started = f.now();
    (await f.wallet.flight.operate('alice', operation));
    f.time(started + flightTimeForCents(123));
    const cashout = { id: randomUUID(), action: 'cashout', sessionId: operation.id };
    const result = (await f.wallet.flight.operate('alice', cashout));
    assert.equal(result.session!.reason, 'manual');
    assert.equal(result.session!.multiplier, 1.23);
    assert.equal(result.session!.payout, 12.3);
    assert.equal(result.wallet.balance, 1002.3);
    assert.deepEqual((await f.wallet.flight.operate('alice', cashout)), result);
    assert.deepEqual((await f.wallet.flight.operate('alice', operation)), result);
    f.time(f.now() + 100000);
    assert.equal((await f.wallet.snapshot('alice')).balance, 1002.3);
    assert.equal((await f.wallet.flight.snapshot('alice')).session!.reason, 'manual');
    assert.equal((await f.wallet.snapshot('alice')).entries.filter(entry => entry.source === 'royal-flight').length, 2);
  } finally { (await f.db.close()); }
});

test('Flight loses at the first unreachable step, including immediate 0.98x and 0.99x outcomes', async () => {
  for (const crash of [98, 99, 110, 200, 9999]) {
    const draw = crash === 98 ? FLIGHT_ENTROPY_SIZE - 1 : Number(98n * BigInt(FLIGHT_ENTROPY_SIZE) / BigInt(crash + 1));
    assert.equal(flightCrashCents(draw), crash);
    const f = (await fixture(() => draw));
    try {
      const operation = start(100), began = f.now();
      const initial = (await f.wallet.flight.operate('alice', operation));
      assert.equal(initial.session!.state, crash < 100 ? 'lost' : 'active');
      if (crash >= 100) {
        f.time(began + flightTimeForCents(crash + 1) - 1);
        const active = (await f.wallet.flight.snapshot('alice'));
        assert.equal(active.session!.state, 'active');
        assert.equal(active.session!.multiplier, crash / 100);
      }
      f.time(began + flightTimeForCents(crash + 1));
      const result = (await f.wallet.flight.operate('alice', { id: randomUUID(), action: 'cashout', sessionId: operation.id }));
      assert.equal(result.session!.state, 'lost');
      assert.equal(result.session!.reason, 'crash');
      assert.equal(result.session!.payout, 0);
      assert.equal(result.session!.cashoutValue, 0);
      assert.equal(result.wallet.balance, 990);
      assert.equal((await f.wallet.flight.reservedUnits('alice')), 0);
      assert.equal(result.wallet.entries.filter(entry => entry.source === 'royal-flight' && entry.kind === 'win').length, 1);
    } finally { (await f.db.close()); }
  }
});

test('Flight survives an exact target and auto cashout wins at the 100x cap before terminal crash', async () => {
  for (const target of [110, 200, 10000]) {
    const draw = Number(98n * BigInt(FLIGHT_ENTROPY_SIZE) / BigInt(target) - 1n);
    assert.equal(flightCrashCents(draw), target);
    const f = (await fixture(() => draw));
    try {
      const operation = start(target / 100), began = f.now();
      (await f.wallet.flight.operate('alice', operation));
      f.time(began + flightTimeForCents(target));
      const result = (await f.wallet.flight.operate('alice', { id: randomUUID(), action: 'cashout', sessionId: operation.id }));
      assert.equal(result.session!.reason, 'auto');
      assert.equal(result.session!.payout, target / 10);
      assert.equal(result.wallet.balance, 990 + target / 10);
    } finally { (await f.db.close()); }
  }
});

test('Flight strictly validates operations, never accepts client clocks or outcomes, and isolates accounts', async () => {
  const f = (await fixture());
  try {
    const valid = start();
    const before = (await f.wallet.snapshot('alice'));
    for (const value of [null, [], {}, { ...valid, id: '-'.repeat(36) }, { ...valid, amount: 1 },
      { ...valid, startedAt: f.now() }, { ...valid, multiplier: 10 }, { ...valid, payout: 100000 },
      { ...valid, crashPoint: 100 }, { ...valid, [Symbol('hidden')]: true }, Object.create(valid),
      JSON.parse(JSON.stringify(valid).slice(0, -1) + ',"__proto__":{"polluted":true}}')]) (await assert.rejects(async () => (await f.wallet.flight.operate('alice', value)), status(400)));
    for (const autoCashout of [1, 1.09, 100.01, 2.001, 1.1 + Number.EPSILON, '2', null, NaN, Infinity]) {
      (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...valid, autoCashout })), status(400)));
    }
    assert.deepEqual((await f.wallet.snapshot('alice')), before);
    assert.equal(f.draws(), 0);
    (await f.wallet.flight.operate('alice', valid));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...valid, id: randomUUID() })), status(409)));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...valid, autoCashout: 3 })), status(409)));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...valid, amount: 50 })), status(409)));
    (await assert.rejects(async () => (await f.wallet.flight.operate('bob', { id: randomUUID(), action: 'cashout', sessionId: valid.id })), status(404)));
    assert.equal((await f.wallet.flight.snapshot('bob')).session, null);
    (await f.wallet.operate('bob', { id: randomUUID(), kind: 'deposit', amount: 100 }));
    assert.equal((await f.wallet.flight.operate('bob', valid)).session!.id, valid.id);
    const cashout = { id: randomUUID(), action: 'cashout', sessionId: valid.id };
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...cashout, multiplier: 100 })), status(400)));
    (await f.wallet.flight.operate('alice', cashout));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...cashout, sessionId: randomUUID() })), status(409)));
  } finally { (await f.db.close()); }
});

test('operation UUIDs cannot be repurposed across Flight, Mines and instant wallet requests', async () => {
  const f = (await fixture());
  try {
    const flight = start();
    (await f.wallet.flight.operate('alice', flight));
    (await assert.rejects(async () => (await f.wallet.operate('alice', { id: flight.id, kind: 'deposit', amount: 10 })), status(409)));
    (await assert.rejects(async () => (await f.wallet.mines.operate('alice', { id: flight.id, action: 'start', amount: 10, mineCount: 1 })), status(409)));
    const mines = { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 };
    (await f.wallet.mines.operate('alice', mines));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...flight, id: mines.id })), status(409)));
    const deposited = randomUUID();
    (await f.wallet.operate('alice', { id: deposited, kind: 'deposit', amount: 10 }));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', { ...flight, id: deposited })), status(409)));
    const cashout = randomUUID();
    (await f.wallet.flight.operate('alice', { id: cashout, action: 'cashout', sessionId: flight.id }));
    (await assert.rejects(async () => (await f.wallet.operate('alice', { id: cashout, kind: 'spin', amount: 10 })), status(409)));
    (await assert.rejects(async () => (await f.wallet.mines.operate('alice', { id: cashout, action: 'reveal', sessionId: mines.id, cell: 1 })), status(409)));
  } finally { (await f.db.close()); }
});

test('Flight reserve joins Mines capacity in deposits, wagers, provider credits and either start order', async () => {
  for (const flightFirst of [true, false]) {
    const f = (await fixture());
    try {
      const flight = start(100), mines = { id: randomUUID(), action: 'start', amount: 10, mineCount: 24 };
      const flightReserve = 100000, minesReserve = 24500;
      (await saveDemoUnits(f.db, 'alice', MAX_DEMO_UNITS - flightReserve - minesReserve + 2000));
      if (flightFirst) { (await f.wallet.flight.operate('alice', flight)); (await f.wallet.mines.operate('alice', mines)); }
      else { (await f.wallet.mines.operate('alice', mines)); (await f.wallet.flight.operate('alice', flight)); }
      assert.equal((await demoBalanceUnits(f.db, 'alice')) + (await f.wallet.flight.reservedUnits('alice')) + (await f.wallet.mines.reservedUnits('alice')), MAX_DEMO_UNITS);
      const before = (await f.wallet.snapshot('alice')), draws = f.draws();
      (await assert.rejects(async () => (await saveDemoUnits(f.db, 'alice', (await demoBalanceUnits(f.db, 'alice')) + 1)), DemoCapacityError));
      (await assert.rejects(async () => (await f.wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1 })), status(400)));
      (await assert.rejects(async () => (await f.wallet.operate('alice', { id: randomUUID(), kind: 'play', gameId: 'royal-wheel', rulesVersion: 1, amount: 10, input: { risk: 'low' } })), status(400)));
      assert.equal(f.draws(), draws);
      const provider = new CasinoApiProWallet(f.db);
      const request = { playerId: (await provider.player('alice')), currency: 'USD', transactionId: `flight-credit-${flightFirst}`, amount: '0.01', roundId: 'external' };
      (await assert.rejects(async () => (await provider.callback('credit', request, 'USD')), error => error instanceof ProviderWalletError && error.code === 'BALANCE_LIMIT'));
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM capro_transactions').get())!.n, 0);
      assert.deepEqual((await f.wallet.snapshot('alice')), before);
      (await f.wallet.mines.operate('alice', { id: randomUUID(), action: 'reveal', sessionId: mines.id, cell: 24 }));
      f.time(f.now() + flightTimeForCents(10000));
      assert.equal((await f.wallet.snapshot('alice')).balance, MAX_DEMO_UNITS / 100);
      assert.equal((await f.wallet.flight.reservedUnits('alice')), 0);
      assert.equal((await f.wallet.mines.reservedUnits('alice')), 0);
    } finally { (await f.db.close()); }
  }
});

test('combined reserve overflow rejects the second game before drawing and leaves the first playable', async () => {
  for (const flightFirst of [true, false]) {
    const f = (await fixture());
    try {
      const flight = start(100), mines = { id: randomUUID(), action: 'start', amount: 10, mineCount: 24 };
      (await saveDemoUnits(f.db, 'alice', MAX_DEMO_UNITS - 100000 - 24500 + 2001));
      if (flightFirst) (await f.wallet.flight.operate('alice', flight)); else (await f.wallet.mines.operate('alice', mines));
      const before = (await f.wallet.snapshot('alice')), draws = f.draws();
      (await assert.rejects(async () => flightFirst ? (await f.wallet.mines.operate('alice', mines)) : (await f.wallet.flight.operate('alice', flight)), status(400)));
      assert.equal(f.draws(), draws);
      assert.deepEqual((await f.wallet.snapshot('alice')), before);
    } finally { (await f.db.close()); }
  }
});

test('failed Flight persistence and cashout roll back balance, reservation, request and ledger atomically', async () => {
  const f = (await fixture());
  try {
    const operation = start();
    (await f.db.exec("CREATE OR REPLACE FUNCTION reject_flight_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_flight BEFORE INSERT ON demo_flight_requests FOR EACH ROW EXECUTE FUNCTION reject_flight_fn();"));
    const before = (await f.wallet.snapshot('alice'));
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', operation)), /interrupted/));
    assert.deepEqual((await f.wallet.snapshot('alice')), before);
    assert.equal((await f.wallet.flight.snapshot('alice')).session, null);
    assert.equal((await f.wallet.flight.reservedUnits('alice')), 0);
    (await f.db.exec('DROP TRIGGER reject_flight ON demo_flight_requests'));
    const active = (await f.wallet.flight.operate('alice', operation));
    (await f.db.exec("CREATE OR REPLACE FUNCTION reject_flight_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_flight BEFORE INSERT ON demo_flight_requests FOR EACH ROW EXECUTE FUNCTION reject_flight_fn();"));
    const cashout = { id: randomUUID(), action: 'cashout', sessionId: operation.id };
    (await assert.rejects(async () => (await f.wallet.flight.operate('alice', cashout)), /interrupted/));
    assert.deepEqual((await f.wallet.flight.snapshot('alice')), active);
    assert.equal((await f.wallet.flight.reservedUnits('alice')), 100000);
    (await f.db.exec('DROP TRIGGER reject_flight ON demo_flight_requests'));
    assert.equal((await f.wallet.flight.operate('alice', cashout)).wallet.balance, 1000);
  } finally { (await f.db.close()); }
  for (const draw of [NaN, -1, 0.5, FLIGHT_ENTROPY_SIZE]) {
    const f = (await fixture(() => draw));
    try {
      const before = (await f.wallet.snapshot('alice'));
      (await assert.rejects(async () => (await f.wallet.flight.operate('alice', start()))));
      assert.deepEqual((await f.wallet.snapshot('alice')), before);
      assert.equal((await f.wallet.flight.snapshot('alice')).session, null);
    } finally { (await f.db.close()); }
  }
});

test('wallet and Mines access settle overdue Flight without nested transactions or duplicate payout', async () => {
  for (const access of ['snapshot', 'deposit', 'mines-read', 'mines-start']) {
    const f = (await fixture());
    try {
      const operation = start(2), began = f.now();
      (await f.wallet.flight.operate('alice', operation));
      f.time(began + flightTimeForCents(200));
      if (access === 'snapshot') (await f.wallet.snapshot('alice'));
      else if (access === 'deposit') (await f.wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1 }));
      else if (access === 'mines-read') (await f.wallet.mines.active('alice'));
      else (await f.wallet.mines.operate('alice', { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 }));
      const result = (await f.wallet.flight.snapshot('alice'));
      assert.equal(result.session!.reason, 'auto');
      assert.equal(result.wallet.balance, access === 'deposit' ? 1011 : access === 'mines-start' ? 1000 : 1010);
      assert.equal(result.wallet.entries.filter(entry => entry.source === 'royal-flight' && entry.kind === 'win').length, 1);
    } finally { (await f.db.close()); }
  }
});

test('Flight durable action limit survives reopening, admits replays and resets with the server window', async () => {
  const f = (await fixture());
  try {
    const operation = start(100);
    const initial = (await f.wallet.flight.operate('alice', operation));
    const insert = f.db.prepare('INSERT INTO demo_flight_requests(account_id,id,request_key,session_id,created_at) VALUES (?,?,?,?,?)');
    for (let i = 1; i < 120; i++) (await insert.run('alice', randomUUID(), '{}', operation.id, f.now()));
    const reopened = new DemoWalletStore(f.db, () => 0, f.now);
    assert.deepEqual((await reopened.flight.operate('alice', operation)), initial);
    const cashout = { id: randomUUID(), action: 'cashout', sessionId: operation.id };
    (await assert.rejects(async () => (await reopened.flight.operate('alice', cashout)), status(429)));
    assert.equal((await reopened.flight.snapshot('alice')).session!.state, 'active');
    f.time(f.now() + 60000);
    assert.equal((await reopened.flight.operate('alice', cashout)).session!.reason, 'auto');
  } finally { (await f.db.close()); }
});

test('independent PostgreSQL connections serialize competing Flight starts, replay and cashouts', { timeout: 25000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'royal-flight-concurrent-'));
  const path = join(directory, 'wallet.sqlite'), f = (await fixture(() => 0, path));
  const moduleUrl = new URL('../server/demoWallet.ts', import.meta.url).href;
  const loader = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).pathname;
  const children: ReturnType<typeof spawn>[] = [];
  async function contender(operation: unknown, now: number) {
    const source = `import { PostgresDatabase } from ${JSON.stringify(new URL('../server/database.ts', import.meta.url).href)};
      import { DemoWalletStore } from ${JSON.stringify(moduleUrl)};
      const db = new PostgresDatabase(${JSON.stringify(path)});
      const wallet = new DemoWalletStore(db, () => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50); return 0;
      }, () => ${now});
      await wallet.ready;
      console.log(JSON.stringify({ready:true}));
      process.stdin.once('data', async () => {
        try { const result = await wallet.flight.operate('alice',${JSON.stringify(operation)});
          console.log(JSON.stringify({ok:true,result})); }
        catch(error) { console.log(JSON.stringify({ok:false,status:error.status,message:error.message})); }
        finally { await db.close(); process.stdin.pause(); }
      });`;
    const child = spawn(process.execPath, ['--import', loader, '--input-type=module', '--eval', source], { stdio: ['pipe','pipe','pipe'], env: { ...process.env, AUTH_DB_PATH: ':memory:' } });
    children.push(child);
    let readyResolve!: () => void, readyReject!: (error: Error) => void;
    let resultResolve!: (value: { ok: boolean; status?: number; result?: { wallet: { balance: number }; session: { reason: string; payout: number } } }) => void, resultReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const result = new Promise<{ ok: boolean; status?: number; result?: { wallet: { balance: number }; session: { reason: string; payout: number } } }>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
    void ready.catch(() => {}); void result.catch(() => {});
    let stderr = '', received = false;
    const fail = (error: Error) => { readyReject(error); resultReject(error); };
    const timer = setTimeout(() => { child.kill(); fail(new Error('Concurrent Flight process timed out')); }, 10000);
    child.stderr!.on('data', chunk => { stderr += chunk; });
    createInterface({ input: child.stdout! }).on('line', line => {
      try { const value = JSON.parse(line); if (value.ready) readyResolve(); else { received = true; resultResolve(value); } }
      catch { fail(new Error('Unexpected concurrent Flight output')); }
    });
    child.on('error', fail);
    child.on('exit', code => { clearTimeout(timer); if (code !== 0 || !received) fail(new Error(`Concurrent Flight process exited (${code}): ${stderr}`)); });
    return { ready, result, start: () => child.stdin!.end('flight\n') };
  }
  async function race(a: unknown, b: unknown, now: number) {
    const first = (await contender(a, now)), second = (await contender(b, now));
    await Promise.all([first.ready, second.ready]); first.start(); second.start();
    return (await Promise.all([first.result, second.result]));
  }
  try {
    const operation = start(100), began = f.now();
    const replay = await race(operation, operation, began);
    assert.equal(replay.every(result => result.ok), true);
    assert.equal((await demoBalanceUnits(f.db, 'alice')), 99000);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE source='royal-flight' AND kind='bet'").get())!.n, 1);
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM demo_flight_requests').get())!.n, 1);
    const manualAt = began + flightTimeForCents(123);
    const cashouts = await race({ id: randomUUID(), action: 'cashout', sessionId: operation.id }, { id: randomUUID(), action: 'cashout', sessionId: operation.id }, manualAt);
    assert.equal(cashouts.every(result => result.ok && result.result!.session.payout === 12.3), true);
    assert.equal((await demoBalanceUnits(f.db, 'alice')), 100230);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE source='royal-flight' AND kind='win'").get())!.n, 1);
    const conflicting = await race(start(100), start(100), manualAt);
    assert.equal(conflicting.filter(result => result.ok).length, 1);
    assert.equal(conflicting.find(result => !result.ok)?.status, 409);
    const active = (await f.wallet.flight.snapshot('alice')).session!;
    const automatic = await race({ id: randomUUID(), action: 'cashout', sessionId: active.id }, { id: randomUUID(), action: 'cashout', sessionId: active.id }, manualAt + flightTimeForCents(10000));
    assert.equal(automatic.every(result => result.ok && result.result!.session.reason === 'auto' && result.result!.session.payout === 1000), true);
    assert.equal((await demoBalanceUnits(f.db, 'alice')), 199230);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM demo_ledger WHERE source='royal-flight' AND kind='win'").get())!.n, 2);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    (await f.db.close()); rmSync(directory, { recursive: true, force: true });
  }
});

test('Flight and Wheel HTTP inherit account ownership, origin, bounded parsing and shared replay limits', { timeout: 25000 }, async () => {
  process.env.AUTH_DB_PATH = ':memory:';
  const { accounts } = await import('../server/accounts');
  const { installDemoWallet } = await import('../server/demoWalletRoutes');
  const alice = await accounts.login(`flight-alice-${randomUUID()}@example.test`, 'Flight-test-password!');
  const bob = await accounts.login(`flight-bob-${randomUUID()}@example.test`, 'Flight-test-password!');
  for (const owner of [alice, bob]) (await accounts.wallet.operate(owner.account.id, { id: randomUUID(), kind: 'deposit', amount: 1000 }));
  const app = express();
  installDemoWallet(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = (owner = alice) => ({ Cookie: `royal_session=${owner.token}`, [WALLET_ACCOUNT_HEADER]: owner.account.id, 'Content-Type': 'application/json' });
  const request = async (path: string, body?: unknown, owner = alice, extra: Record<string,string> = {}) => (await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers(owner), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }));
  try {
    const flight = start(100), wheel = { id: randomUUID(), kind: 'play', amount: 10, gameId: 'royal-wheel', rulesVersion: 1, input: { risk: 'high' } };
    const before = (await accounts.wallet.snapshot(alice.account.id));
    for (const action of [{ path: '/api/demo-wallet/flight' }, { path: '/api/demo-wallet/flight', body: flight },
      { path: '/api/demo-wallet/flight', body: { id: randomUUID(), action: 'cashout', sessionId: flight.id } },
      { path: '/api/demo-wallet/operations', body: wheel }]) {
      for (const extra of [{ Cookie: '' }, { [WALLET_ACCOUNT_HEADER]: '' }, { [WALLET_ACCOUNT_HEADER]: bob.account.id }]) {
        const response = await request(action.path, action.body, alice, extra as unknown as Record<string,string>);
        assert.equal(response.status, 401); await response.arrayBuffer();
      }
      for (const extra of [{ Origin: 'https://attacker.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
        const response = await request(action.path, action.body, alice, extra as unknown as Record<string,string>);
        assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.arrayBuffer();
      }
    }
    for (const body of [{ ...flight, startedAt: 0 }, { ...flight, multiplier: 100 }, { ...flight, amount: -10 },
      { ...flight, crashPoint: 100 }, { ...wheel, input: { risk: '__proto__' } }, { ...wheel, payout: 100000 }]) {
      const response = await request('kind' in body ? '/api/demo-wallet/operations' : '/api/demo-wallet/flight', body);
      assert.equal(response.status, 400); await response.arrayBuffer();
    }
    for (const [body, expected] of [['{"private_marker":',400], [JSON.stringify({ padding: 'x'.repeat(3000) }),413]] as const) {
      const response = await fetch(origin + '/api/demo-wallet/flight', { method: 'POST', headers: headers(), body });
      assert.equal(response.status, expected); const text = await response.text();
      assert.equal(Object.keys(JSON.parse(text)).join(','), 'error');
      assert.doesNotMatch(text, /private_marker|SyntaxError|node_modules|\/Users\/|at /);
    }
    assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), before);
    const responses = await Promise.all(Array.from({ length: 6 }, async () => (await request('/api/demo-wallet/flight', flight))));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.session.id, flight.id);
      assert.doesNotMatch(JSON.stringify(result), /crash_cents|crashCents|crashPoint|deadline|death|endTime/);
    }
    assert.equal((await accounts.wallet.snapshot(alice.account.id)).entries.filter(entry => entry.operationId === flight.id && entry.kind === 'bet').length, 1);
    const conflict = await request('/api/demo-wallet/flight', { ...flight, autoCashout: 2 });
    assert.equal(conflict.status, 409); await conflict.arrayBuffer();
    const foreign = await request('/api/demo-wallet/flight', { id: randomUUID(), action: 'cashout', sessionId: flight.id }, bob);
    assert.equal(foreign.status, 404); await foreign.arrayBuffer();
    const own = await request('/api/demo-wallet/flight', undefined, bob);
    assert.equal((await own.json()).session, null);

    let now = 0;
    const limitedApp = express();
    installDemoWallet(limitedApp, { limit: 3, windowMs: 1000, now: () => now });
    const limited = limitedApp.listen(0, '127.0.0.1');
    await once(limited, 'listening');
    const limitedAddress = limited.address(); assert(limitedAddress && typeof limitedAddress !== 'string');
    const limitedOrigin = `http://127.0.0.1:${limitedAddress.port}`;
    const get = async (path: string, body?: string) => (await fetch(limitedOrigin + path, { method: body === undefined ? 'GET' : 'POST', headers: headers(), body }));
    try {
      assert.equal((await get('/api/demo-wallet/flight')).status, 200);
      assert.equal((await get('/api/demo-wallet/flight', JSON.stringify(flight))).status, 200);
      assert.equal((await get('/api/demo-wallet/flight', '{')).status, 400);
      const rejected = await get('/api/demo-wallet/operations', JSON.stringify(wheel));
      assert.equal(rejected.status, 429); assert.equal(rejected.headers.get('retry-after'), '1'); await rejected.arrayBuffer();
      now = 1000;
      assert.equal((await get('/api/demo-wallet/flight', JSON.stringify(flight))).status, 200);
      assert.equal((await accounts.wallet.snapshot(alice.account.id)).entries.filter(entry => entry.operationId === flight.id && entry.kind === 'bet').length, 1);
    } finally { limited.closeAllConnections(); await new Promise<void>(resolve => limited.close(() => resolve())); }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); (await accounts.close()); }
});
