import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits } from '../server/demoWalletAmounts';
import { ProgressionStore } from '../server/progression/store';
import { LiveFreeSpinService } from '../server/progression/freeSpins';
import { DEFAULT_PROGRESSION_POLICY, SECOND_PROGRESSION_POLICY, rewardGames, validProgressionSnapshot } from '../src/shared/progression';

async function fixture() {
  const db = new PostgresDatabase(':memory:'), account = randomUUID(), other = randomUUID();
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts VALUES(?),(?)').run(account, other);
  const wallet = new DemoWalletStore(db), progression = new ProgressionStore(db, { now: () => 1000 });
  let now = 1000, draws = 0;
  const draw = () => { draws++; return 0; };
  const service = new LiveFreeSpinService(db, wallet, progression, draw, () => now); await service.ready;
  const second = new PostgresDatabase(db.schema, { existingSchema: true });
  const secondWallet = new DemoWalletStore(second);
  const otherService = new LiveFreeSpinService(second, secondWallet, progression, draw, () => now); await otherService.ready;
  async function grant(count = 10, nominal = '500000') {
    const id = randomUUID();
    await db.prepare(`INSERT INTO progression_rewards(id,account_id,location_id,milestone_id,policy_version,type,level,game_id,count,remaining,nominal_units,currency,rules_version,created_at,pool_id)
      VALUES(?,?,?,?,?,'free_spins',5,'',?,?,?,'VIRTUAL_USD',1,1000,'royal-slots-v1')`).run(id, account, 'south-park', id, DEFAULT_PROGRESSION_POLICY.version, count, count, nominal);
    return id;
  }
  return { db, account, other, wallet, progression, service, otherService, grant, draws: () => draws,
    advance: () => { now += 60001; }, close: async () => { await second.close(); await db.close(); } };
}

test('one nominal balance follows 3 Coins, 2 Fruits and 5 Coins rounds without cash stakes or XP', async () => {
  const f = await fixture(); try {
    const grantId = await f.grant();
    const games = [...Array(3).fill('royal-coins'), ...Array(2).fill('royal-fruits'), ...Array(5).fill('royal-coins')];
    for (const [i, gameId] of games.entries()) {
      const result = await f.service.spin(f.account, { id: randomUUID(), grantId, gameId });
      assert.equal(result.remaining, 9 - i); assert.equal(result.gameRound.gameId, gameId);
      assert.equal(result.gameRound.stakeUnits, '50');
    }
    assert.equal(await demoBalanceUnits(f.db, f.account), 5300);
    const snapshot = await f.progression.snapshot(f.account); assert(validProgressionSnapshot(snapshot));
    assert.equal(snapshot.xp, '0'); assert.equal(snapshot.grants[0].remaining, 0);
    const ledger = await f.db.prepare('SELECT entry_type,source FROM demo_ledger').all();
    assert.equal(ledger.length, 10); assert(ledger.every(r => r.entry_type === 'win' && String(r.source).startsWith('reward:')));
    await assert.rejects(f.service.spin(f.account, { id: randomUUID(), grantId, gameId: 'royal-fruits' }), /exhausted/);
    assert.equal((await f.progression.audit()).ok, true);
  } finally { await f.close(); }
});

test('two backend connections and both games can accept the final shared right only once', async () => {
  const f = await fixture(); try {
    const grantId = await f.grant(1);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? f.service : f.otherService)
      .spin(f.account, { id: randomUUID(), grantId, gameId: i % 2 ? 'royal-coins' : 'royal-fruits' })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 19); assert.equal(f.draws(), 3);
    assert.equal(Number((await f.db.prepare('SELECT count(*) AS n FROM progression_spin_uses').get())!.n), 1);
    assert.equal((await f.progression.audit()).ok, true);
  } finally { await f.close(); }
});

test('original results survive service restart and pause; changing game, grant or request shape cannot reroll', async () => {
  const f = await fixture(); try {
    const grantId = await f.grant(1), request = { id: randomUUID(), grantId, gameId: 'royal-fruits' as const };
    const first = await f.service.spin(f.account, request); await f.progression.setSwitches({ spinsEnabled: false });
    const replay = await f.otherService.spin(f.account, request);
    assert(replay.replayed); assert.deepEqual(replay.gameRound, first.gameRound); assert.equal(f.draws(), 3);
    for (const changed of [{ ...request, gameId: 'royal-coins' }, { id: request.id, grantId }, { ...request, grantId: randomUUID() }])
      await assert.rejects(f.otherService.spin(f.account, changed), /idempotency_conflict/);
    assert.equal(f.draws(), 3); assert.equal((await f.progression.audit()).ok, true);
  } finally { await f.close(); }
});

test('owner, allowed game, fixed nominal and extra client fields are checked before randomness', async () => {
  const f = await fixture(); try {
    const grantId = await f.grant(), request = { id: randomUUID(), grantId, gameId: 'royal-coins' };
    await assert.rejects(f.service.spin(f.other, request), /reward_unavailable/);
    await assert.rejects(f.service.spin(f.account, { id: randomUUID(), grantId }), /reward_game_unavailable/);
    await assert.rejects(f.service.spin(f.account, { ...request, gameId: 'royal-roulette' }), /invalid_reward_spin_request/);
    for (const field of ['stakeUnits', 'count', 'accountId', 'poolId', 'rulesVersion', 'outcome'])
      await assert.rejects(f.service.spin(f.account, { ...request, [field]: '999' }), /invalid_reward_spin_request/);
    const bad = await f.grant(1, '100001');
    await assert.rejects(f.service.spin(f.account, { ...request, grantId: bad }), /rules_unavailable/);
    assert.equal(f.draws(), 0);
  } finally { await f.close(); }
});

test('the durable account rate bound spans backend connections and games and still permits receipt recovery', async () => {
  const f = await fixture(); try {
    const grantId = await f.grant(121); let first: any;
    for (let i = 0; i < 120; i++) {
      const request = { id: randomUUID(), grantId, gameId: i % 2 ? 'royal-coins' : 'royal-fruits' };
      await f.service.spin(f.account, request); if (!i) first = request;
    }
    await assert.rejects(f.otherService.spin(f.account, { id: randomUUID(), grantId, gameId: 'royal-coins' }), /rate_limit/);
    assert((await f.otherService.spin(f.account, first)).replayed); assert.equal(f.draws(), 360);
    f.advance(); assert.equal((await f.otherService.spin(f.account, { id: randomUUID(), grantId, gameId: 'royal-coins' })).remaining, 0);
  } finally { await f.close(); }
});

test('v3 pools keep v2 accepted sources and already issued game-specific rights under their original terms', async () => {
  const f = await fixture(); try {
    const old = new ProgressionStore(f.db, { policy: SECOND_PROGRESSION_POLICY, now: () => 1000 }); await old.ready;
    const context = { sourceType: 'paid-game' as const, sourceId: randomUUID(), accountId: f.account, gameId: 'royal-coins',
      locationId: 'south-park', environment: 'VIRTUAL_USD', fundingSource: 'cash' as const, acceptedAt: 1000 };
    await old.acceptRound(context);
    await f.progression.recordSettled({ sourceType: context.sourceType, sourceId: context.sourceId, accountId: f.account,
      paidUnits: '65960000', refundedUnits: '0', outcome: 'settled', settledAt: 1100 });
    const retained = await f.progression.snapshot(f.account); assert.equal(retained.policyVersion, 'location-levels-v2');
    assert.equal(retained.grants[0].gameId, 'royal-coins'); assert.equal(retained.grants[0].poolId, undefined);
    assert.deepEqual(rewardGames(retained.grants[0]), ['royal-coins']);
    assert.equal((await f.service.spin(f.account, { id: randomUUID(), grantId: retained.grants[0].id })).gameRound.gameId, 'royal-coins');
    await assert.rejects(f.service.spin(f.account, { id: randomUUID(), grantId: retained.grants[0].id, gameId: 'royal-fruits' }), /game_unavailable/);
    assert.equal((await f.progression.audit()).ok, true);
  } finally { await f.close(); }
});

test('audit identifies receipt choice or outcome tampering even when the remaining count is unchanged', async () => {
  const f = await fixture(); try {
    const grantId = await f.grant(); await f.service.spin(f.account, { id: randomUUID(), grantId, gameId: 'royal-coins' });
    assert.equal((await f.progression.audit()).ok, true);
    await f.db.prepare(`UPDATE progression_spin_uses SET result_json=jsonb_set(result_json::jsonb,'{gameId}','"royal-fruits"')::text WHERE grant_id=?`).run(grantId);
    const audit = await f.progression.audit(); assert.equal(audit.ok, false); assert.equal(audit.receiptMismatches, 1); assert.equal(audit.rewardMismatches, 0);
  } finally { await f.close(); }
});
