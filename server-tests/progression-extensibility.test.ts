import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { ProgressionStore, type RoundContext, type SettledExperience } from '../server/progression/store';
import { DEFAULT_PROGRESSION_HANDLERS, type ExperienceHandler, type ProgressionHandlers, type RewardHandler } from '../server/progression/handlers';
import { DEFAULT_PROGRESSION_POLICY, type ExperienceSource, type FreeSpinReward, type ProgressionPolicy } from '../src/shared/progression';
import { instrumentProgressionWallet } from '../server/progression/sources';
import { DemoWalletStore } from '../server/demoWallet';
import { saveDemoUnits } from '../server/demoWalletAmounts';

type Source = ExperienceSource | 'test-discovery';
type Badge = { kind: 'test-badge'; badgeId: string };
type Reward = FreeSpinReward | Badge;
const discovery: ExperienceHandler<'test-discovery'> = {
  eligible: c => c.fundingSource === 'none',
  valid: e => typeof e.valueUnits === 'string' && /^[1-9]\d{0,5}$/.test(e.valueUnits),
  basisUnits: e => e.outcome === 'refunded' ? 0n : BigInt(e.valueUnits) * 10000n,
  identity: e => JSON.stringify([e.valueUnits, e.outcome]),
};
async function fixture() {
  const db = new PostgresDatabase(':memory:'), account = randomUUID();
  await db.exec('CREATE TABLE test_badges(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,badge_id TEXT NOT NULL)');
  let rejectIssue = false;
  const badge: RewardHandler<Badge> = {
    valid: r => r.kind === 'test-badge' && r.badgeId === 'explorer',
    async issue(db, c, r) {
      await db.prepare('INSERT INTO test_badges VALUES(?,?,?)').run(c.id, c.accountId, r.badgeId);
      if (rejectIssue) throw Error('injected badge delivery failure');
    },
    async audit(db, c, r) {
      const row = await db.prepare('SELECT * FROM test_badges WHERE id=?').get(c.id);
      return row?.account_id === c.accountId && row?.badge_id === r.badgeId;
    },
  };
  const handlers: ProgressionHandlers<Source, Reward> = {
    sources: { ...DEFAULT_PROGRESSION_HANDLERS.sources, 'test-discovery': discovery },
    rewards: { ...DEFAULT_PROGRESSION_HANDLERS.rewards, 'test-badge': badge },
  };
  const policy: ProgressionPolicy<Source, Reward> = { version: 'extensibility-test-v1',
    coefficients: { ...DEFAULT_PROGRESSION_POLICY.coefficients, 'test-discovery': { numerator: 1, denominator: 3 } },
    levels: Array.from({ length: 100 }, (_, i) => ({ level: i + 1, xp: String(i), ...(i === 4 ? { reward: { kind: 'test-badge', badgeId: 'explorer' } as Badge } : {}) })),
  };
  const store = new ProgressionStore(db, { policy, handlers, now: () => 1000 }); await store.ready;
  const event = () => {
    const context: RoundContext<'test-discovery'> = { sourceType: 'test-discovery', sourceId: randomUUID(), accountId: account,
      locationId: 'south-park', gameId: 'location-discovery', environment: 'VIRTUAL_USD', fundingSource: 'none', acceptedAt: 1000 };
    const settlement: SettledExperience<'test-discovery'> = { sourceType: context.sourceType, sourceId: context.sourceId,
      accountId: account, valueUnits: '1', settledAt: 1100, outcome: 'settled' };
    return { context, settlement };
  };
  return { db, account, policy, handlers, store, event, reject: (value: boolean) => { rejectIssue = value; } };
}

test('an explicit non-monetary source and a new reward kind reuse the unchanged level and outbox engine', async () => {
  const f = await fixture();
  try {
    let last = f.event();
    for (let i = 0; i < 12; i++) {
      last = f.event(); await f.store.acceptRound(last.context); await f.store.recordSettled(last.settlement);
    }
    await Promise.all([f.store.processPending(), f.store.processPending()]);
    const result = await f.store.snapshot(f.account);
    assert.equal(result.level, 5); assert.equal(result.xp, '4'); assert.equal(result.grants.length, 0);
    const claim = await f.db.prepare('SELECT * FROM progression_milestones WHERE account_id=?').get(f.account);
    assert.equal(claim?.kind, 'test-badge'); assert.equal(claim?.milestone_id, 'level:5');
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM test_badges').get())!.n, 1);
    await f.store.acceptRound(last.context); await f.store.recordSettled({ ...last.settlement, settledAt: 1200 });
    const restarted = new ProgressionStore(f.db, { policy: f.policy, handlers: f.handlers, now: () => 2000 }); await restarted.ready;
    assert.deepEqual(await restarted.snapshot(f.account), result);
    assert.equal((await restarted.audit()).ok, true);
    await f.db.prepare("UPDATE progression_milestones SET definition_json=? WHERE id=?").run(JSON.stringify({ kind: 'test-badge', badgeId: 'changed' }), claim!.id);
    assert.equal((await restarted.audit()).ok, false);
  } finally { await f.db.close(); }
});

test('custom resource failure rolls back its milestone, XP and acknowledgment and can be retried', async () => {
  const f = await fixture();
  try {
    const e = f.event(); e.settlement.valueUnits = '12';
    await f.store.acceptRound(e.context); await f.store.recordSettled(e.settlement);
    f.reject(true); await assert.rejects(f.store.processPending(), /badge delivery failure/);
    for (const table of ['test_badges', 'progression_milestones', 'progression_xp'])
      assert.equal((await f.db.prepare('SELECT count(*) AS n FROM ' + table).get())!.n, 0);
    assert.equal((await f.db.prepare('SELECT processed FROM progression_outbox').get())!.processed, false);
    f.reject(false); await f.store.processPending();
    assert.equal((await f.store.snapshot(f.account)).level, 5);
    assert.equal((await f.store.audit()).ok, true);
  } finally { await f.db.close(); }
});

test('registering an extension never makes paid-game or PvP reward-funded rounds eligible', async () => {
  const f = await fixture();
  try {
    for (const sourceType of ['paid-game', 'pvp'] as const) {
      const context: RoundContext<Source> = { ...f.event().context, sourceType, fundingSource: 'reward' };
      assert.equal(await f.store.acceptRound(context), false);
    }
    const c = f.event().context;
    assert.equal(await f.store.acceptRound({ ...c, fundingSource: 'cash' }), false);
    await assert.rejects(f.store.recordSettled({ ...f.event().settlement, valueUnits: '-1' }), /Invalid settled experience/);
    assert.throws(() => new ProgressionStore(f.db, { policy: f.policy }), /Unregistered reward kind|Unregistered experience source/);
    assert.equal((await f.store.snapshot(f.account)).xp, '0');
  } finally { await f.db.close(); }
});

test('upgrading pre-registry free-spin grants preserves their identity and remaining rights', async () => {
  const db = new PostgresDatabase(':memory:'), account = randomUUID();
  const store = new ProgressionStore(db, { now: () => 1000 }); await store.ready;
  try {
    const sourceId = randomUUID();
    await store.acceptRound({ sourceType: 'paid-game', sourceId, accountId: account, gameId: 'royal-coins',
      locationId: 'south-park', environment: 'VIRTUAL_USD', fundingSource: 'cash', acceptedAt: 1000 });
    await store.recordSettled({ sourceType: 'paid-game', sourceId, accountId: account, paidUnits: '100000000',
      refundedUnits: '0', settledAt: 1100, outcome: 'settled' });
    await store.processPending();
    await db.prepare('UPDATE progression_rewards SET remaining=4 WHERE account_id=?').run(account);
    const before = await store.snapshot(account);
    await db.exec('DROP TABLE progression_milestones');
    const upgraded = new ProgressionStore(db, { now: () => 2000 }); await upgraded.ready;
    assert.deepEqual(await upgraded.snapshot(account), before);
    const claim = await db.prepare('SELECT * FROM progression_milestones WHERE account_id=?').get(account);
    assert.equal(claim?.id, before.grants[0].id);
    assert.equal(claim?.policy_version, before.policyVersion);
    assert.equal((await upgraded.audit()).ok, true);
  } finally { await db.close(); }
});

test('the extended registry still instruments existing paid wallet sources without an engine change', async () => {
  const f = await fixture();
  try {
    await f.db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
    await f.db.prepare('INSERT INTO accounts VALUES(?)').run(f.account);
    const wallet = instrumentProgressionWallet(f.db, new DemoWalletStore(f.db, () => 0), f.store);
    await wallet.ready; await saveDemoUnits(f.db, f.account, 10000);
    const extension = f.event(); await f.store.acceptRound(extension.context);
    await wallet.operate(f.account, { id: randomUUID(), kind: 'spin', amount: 10 });
    assert.equal((await f.store.snapshot(f.account)).xp, '1000');
    await f.store.recordSettled({ ...extension.settlement, valueUnits: '3' });
    assert.equal((await f.store.snapshot(f.account)).xp, '1001');
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM test_badges').get())!.n, 1);
    assert.equal((await f.store.audit()).ok, true);
  } finally { await f.db.close(); }
});

test('a newly registered source cannot poison an existing player pinned to a policy without that source', async () => {
  const f = await fixture();
  try {
    const original = new ProgressionStore(f.db, { now: () => 1000 }); await original.ready;
    const oldCash: RoundContext = { ...f.event().context, sourceType: 'paid-game', fundingSource: 'cash' };
    await original.acceptRound(oldCash);
    const policy = structuredClone(f.policy); policy.version = 'extensibility-test-v2';
    const next = new ProgressionStore(f.db, { policy, handlers: f.handlers, now: () => 2000 }); await next.ready;
    assert.equal(await next.acceptRound(f.event().context), false);
    assert.equal((await next.pendingRounds(f.account, 'test-discovery')).length, 0);
    const added = f.event(), newAccount = randomUUID();
    added.context.accountId = newAccount; added.settlement.accountId = newAccount; added.settlement.valueUnits = '3';
    assert.equal(await next.acceptRound(added.context), true);
    await next.recordSettled(added.settlement);
    assert.equal((await next.snapshot(newAccount)).xp, '1');
    await next.recordSettled({ sourceType: 'paid-game', sourceId: oldCash.sourceId, accountId: f.account,
      paidUnits: '1000000', refundedUnits: '0', settledAt: 3000, outcome: 'settled' });
    const old = await next.snapshot(f.account);
    assert.equal(old.policyVersion, DEFAULT_PROGRESSION_POLICY.version); assert.equal(old.xp, '100');
    assert.equal((await next.audit()).ok, true);
  } finally { await f.db.close(); }
});
