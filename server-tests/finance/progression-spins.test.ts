import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RewardSpinResult } from '../../src/shared/progression';
import { PostgresDatabase } from '../../server/database';
import { DemoWalletStore } from '../../server/demoWallet';
import { MAX_DEMO_UNITS, demoBalanceUnits, saveDemoUnits } from '../../server/demoWalletAmounts';
import { FreeSpinService, LiveFreeSpinService } from '../../server/progression/freeSpins';
import { ProgressionStore } from '../../server/progression/store';
import { validProgressionSnapshot } from '../../src/shared/progression';
import { pvpFixture } from './helpers/nile-pvp-fixture';
import { block } from './helpers/nile-play-fixture';

function balance(result: RewardSpinResult) { assert('balance' in result.wallet); return result.wallet.balance; }

async function live(draw: (max: number) => number = () => 0) {
  const db = new PostgresDatabase(':memory:');
  const account = randomUUID(), other = randomUUID();
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts(id) VALUES(?),(?)').run(account, other);
  const wallet = new DemoWalletStore(db);
  const progression = new ProgressionStore(db);
  const service = new LiveFreeSpinService(db, wallet, progression, draw);
  await service.ready;
  return { db, account, other, wallet, progression, service, close: () => db.close() };
}
async function grant(db: PostgresDatabase, account: string, options: { count?: number; game?: string; nominal?: string; currency?: string } = {}) {
  const id = randomUUID(), count = options.count ?? 1;
  await db.prepare(`INSERT INTO progression_rewards(id,account_id,location_id,milestone_id,level,policy_version,type,
    game_id,count,remaining,nominal_units,currency,rules_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, account, 'south-park', id, 5, '1', 'free_spins', options.game ?? 'royal-coins', count, count,
      options.nominal ?? '100000', options.currency ?? 'VIRTUAL_USD', 1, Date.now());
  return id;
}
async function remaining(db: PostgresDatabase, id: string) {
  return Number((await db.prepare('SELECT remaining FROM progression_rewards WHERE id=?').get(id))!.remaining);
}
const rows = async (db: PostgresDatabase, table: string) => Number((await db.prepare('SELECT count(*) AS n FROM ' + table).get())!.n);

test('imported account identifiers retain access to progression and their own reward receipts',async()=>{
  const f=await live();try{
    const id='imported-account';await f.db.prepare('INSERT INTO accounts VALUES(?)').run(id);
    assert(validProgressionSnapshot(await f.progression.snapshot(id)));
    const grantId=await grant(f.db,id);
    const reply=await f.service.spin(id,{id:randomUUID(),grantId});
    assert.equal(reply.remaining,0);assert.equal(balance(reply),1.2);
  }finally{await f.close();}
});

test('a free Coins or Fruits spin needs no cash and credits the unchanged full game payout once', async () => {
  const f = await live();
  try {
    for (const [game, payout, total] of [['royal-coins', '1200000', 1.2], ['royal-fruits', '500000', 1.7]] as const) {
      const grantId = await grant(f.db, f.account, { game });
      const request = { id: randomUUID(), grantId };
      const result = await f.service.spin(f.account, request);
      assert.equal(result.gameRound.gameId, game);
      assert.equal(result.gameRound.stakeUnits, '10');
      assert.equal(result.payoutUnits, payout);
      assert.equal(balance(result), total);
      assert.equal(result.remaining, 0);
      assert.equal(result.replayed, false);
      const replay = await new LiveFreeSpinService(f.db, f.wallet, f.progression, () => { throw Error('must not draw again'); }).spin(f.account, request);
      assert.deepEqual(replay.gameRound, result.gameRound);
      assert.equal(balance(replay), total);
      assert.equal(replay.replayed, true);
      assert.equal(await remaining(f.db, grantId), 0);
    }
    assert.equal(await rows(f.db, 'progression_spin_uses'), 2);
    const money = await f.db.prepare('SELECT entry_type,source,amount_units FROM demo_ledger ORDER BY id').all();
    assert.deepEqual(money.map(r => [r.entry_type, r.source, r.amount_units]), [['win','reward:royal-coins',120],['win','reward:royal-fruits',50]]);
  } finally { await f.close(); }
});

test('zero payout still consumes one right, persists one financial record and remains replayable while paused', async () => {
  let i = 0;
  const f = await live(() => i++ % 3);
  try {
    const grantId = await grant(f.db, f.account);
    const request = { id: randomUUID(), grantId };
    const result = await f.service.spin(f.account, request);
    assert.equal(result.payoutUnits, '0'); assert.equal(balance(result), 0);
    assert.equal(i, 3); assert.equal(await remaining(f.db, grantId), 0);
    const paused = new LiveFreeSpinService(f.db, f.wallet, { ready: f.progression.ready, spinsEnabled: async () => false }, () => { throw Error('no redraw'); });
    const replay = await paused.spin(f.account, request);
    assert.equal(replay.payoutUnits, '0'); assert.equal(replay.replayed, true);
    assert.equal(await rows(f.db, 'progression_spin_uses'), 1);
    assert.equal(await rows(f.db, 'demo_ledger'), 1);
    const newGrant = await grant(f.db, f.account);
    await assert.rejects(paused.spin(f.account, { id: randomUUID(), grantId: newGrant }), /reward_spins_paused/);
    assert.equal(await remaining(f.db, newGrant), 1);
  } finally { await f.close(); }
});

test('parallel requests cannot exceed a packet and identical requests share one outcome', async () => {
  let draws = 0;
  const f = await live(() => { draws++; return 0; });
  try {
    const grantId = await grant(f.db, f.account, { count: 2 });
    const request = { id: randomUUID(), grantId };
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => f.service.spin(f.account, request)));
    assert.equal(duplicates.filter(r => !r.replayed).length, 1); assert.equal(draws, 3);
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.spin(f.account, { id: randomUUID(), grantId })));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(draws, 6); assert.equal(await remaining(f.db, grantId), 0);
    assert.equal(await demoBalanceUnits(f.db, f.account), 240);
    assert.equal(await rows(f.db, 'progression_spin_uses'), 2);
  } finally { await f.close(); }
});

test('grant ownership, immutable request binding, currency and frozen nominal reject without RNG', async () => {
  let draws = 0;
  const f = await live(() => { draws++; return 0; });
  try {
    const grantId = await grant(f.db, f.account);
    await assert.rejects(f.service.spin(f.other, { id: randomUUID(), grantId }), /reward_unavailable/);
    for (const options of [{ currency: 'USDT_NILE_TEST' }, { nominal: '100001' }, { nominal: '10000' }, { nominal: '2500000' }, { nominal:'50010000' }, { game: 'royal-roulette' }]) {
      const bad = await grant(f.db, f.account, options);
      await assert.rejects(f.service.spin(f.account, { id: randomUUID(), grantId: bad }), /reward_rules_unavailable/);
      assert.equal(await remaining(f.db, bad), 1);
    }
    await assert.rejects(f.service.spin(f.account, { id: randomUUID(), grantId, nominalUnits: '2000000' }), /invalid_reward_spin_request/);
    assert.equal(draws, 0);
    const request = { id: randomUUID(), grantId };
    await f.service.spin(f.account, request);
    const another = await grant(f.db, f.account);
    await assert.rejects(f.service.spin(f.account, { ...request, grantId: another }), /play_idempotency_conflict/);
    assert.equal(draws, 3); assert.equal(await remaining(f.db, another), 1);
  } finally { await f.close(); }
});

test('a ledger append failure rolls back the consumed right and wallet before retry', async () => {
  const f = await live();
  try {
    const grantId = await grant(f.db, f.account), request = { id: randomUUID(), grantId };
    await f.db.exec(`CREATE FUNCTION reject_reward_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.source LIKE 'reward:%' THEN RAISE EXCEPTION 'injected reward failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_reward BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_reward_fn()`);
    await assert.rejects(f.service.spin(f.account, request), /injected reward failure/);
    assert.equal(await remaining(f.db, grantId), 1);
    assert.equal(await demoBalanceUnits(f.db, f.account), 0);
    assert.equal(await rows(f.db, 'progression_spin_uses'), 0);
    await f.db.exec('DROP TRIGGER reject_reward ON demo_ledger');
    assert.equal((await f.service.spin(f.account, request)).payoutUnits, '1200000');
    assert.equal(await remaining(f.db, grantId), 0);
  } finally { await f.close(); }
});

test('wallet capacity is checked before randomness or packet consumption', async () => {
  const f = await live(() => { throw Error('must reject before drawing'); });
  try {
    const grantId = await grant(f.db, f.account);
    await saveDemoUnits(f.db, f.account, MAX_DEMO_UNITS);
    await assert.rejects(f.service.spin(f.account, { id: randomUUID(), grantId }), /reward_wallet_capacity/);
    assert.equal(await remaining(f.db, grantId), 1);
    assert.equal(await rows(f.db, 'progression_spin_uses'), 0);
  } finally { await f.close(); }
});

test('a paid round and a reward spin update the same balance without losing concurrent credits', async () => {
  const f = await live();
  try {
    await saveDemoUnits(f.db, f.account, 10000);
    const paid = new DemoWalletStore(f.db, () => 0);
    const grantId = await grant(f.db, f.account);
    await Promise.all([
      paid.operate(f.account, { id: randomUUID(), kind: 'spin', amount: 10 }),
      f.service.spin(f.account, { id: randomUUID(), grantId }),
    ]);
    assert.equal(await demoBalanceUnits(f.db, f.account), 21120);
    const records = await f.db.prepare('SELECT entry_type,source FROM demo_ledger ORDER BY id').all();
    assert.equal(records.filter(r => r.entry_type === 'bet').length, 1);
    assert.equal(records.filter(r => r.source === 'reward:royal-coins').length, 1);
    assert.equal(await rows(f.db, 'progression_spin_uses'), 1);
  } finally { await f.close(); }
});

test('Nile reward payouts use the common audited journal and require full house coverage before drawing', async () => {
  const f = await pvpFixture();
  try {
    const progression = new ProgressionStore(f.ledger.db, { environment: 'USDT_NILE_TEST', prerequisite: f.ledger.ready });
    let draws = 0;
    const service = new FreeSpinService(f.ledger, progression, () => { draws++; return 0; });
    await service.ready;
    const grantId = await grant(f.ledger.db, f.a, { currency: 'USDT_NILE_TEST' });
    const request = { id: randomUUID(), grantId };
    await assert.rejects(service.spin(f.a, request), /play_reserve_insufficient/);
    assert.equal(draws, 0); assert.equal(await remaining(f.ledger.db, grantId), 1);
    await f.source.ingest(block(102, '100000000', f.config.source.addresses.find(a => a.userId === 'reserve')!.address));
    await f.ledger.sync(f.source, await f.reconciliation());
    const result = await service.spin(f.a, request);
    assert.equal(result.payoutUnits, '1200000');
    assert.equal((result.wallet as any).balanceUnits, '201200000');
    const replay = await service.spin(f.a, request);
    assert.equal(replay.replayed, true); assert.equal(draws, 3);
    assert.equal((await f.ledger.audit()).ok, true);
  } finally { await f.close(); }
});
