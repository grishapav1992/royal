import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { ProgressionStore } from '../server/progression/store';
import { validProgressionSnapshot } from '../src/shared/progression';

async function fixture() {
  const db = new PostgresDatabase(':memory:'), account = randomUUID();
  const store = new ProgressionStore(db, { now: () => 1000 });
  await store.ready;
  const context = () => ({ sourceType: 'paid-game' as const, sourceId: randomUUID(), accountId: account,
    locationId: 'south-park', gameId: 'royal-coins', environment: 'VIRTUAL_USD', fundingSource: 'cash' as const, acceptedAt: 1000 });
  const earn = async (amount: string) => {
    const c = context(); await store.acceptRound(c);
    await store.recordSettled({ sourceType: c.sourceType, sourceId: c.sourceId, accountId: account,
      paidUnits: amount, refundedUnits: '0', settledAt: 1100, outcome: 'settled' });
    return store.snapshot(account);
  };
  return { db, account, store, context, earn };
}

test('one micro-unit below a million cannot reach 100; its final micro-unit grants the last milestone once', async () => {
  const f = await fixture();
  try {
    const below = await f.earn('999999999999');
    assert.equal(below.xp, '99999999'); assert.equal(below.level, 99); assert.equal(below.grants.length, 19);
    assert(!below.grants.some(g => g.level === 100));
    const reached = await f.earn('1');
    assert.equal(reached.xp, '100000000'); assert.equal(reached.level, 100); assert.equal(reached.grants.length, 20);
    const final = reached.grants.find(g => g.level === 100)!;
    assert.equal(final.poolId, 'royal-slots-v1'); assert.equal(final.count, 40); assert.equal(final.remaining, 40); assert.equal(final.stakeUnits, '50000000');
    await f.earn('10000');
    assert.equal((await f.store.snapshot(f.account)).grants.filter(g => g.level === 100).length, 1);
    const report = await f.store.report();
    assert.equal(report.issuedSpins, 260);
    assert.equal(report.expectedIssuedPayoutUnits, '4687525000');
    assert.equal(report.expectedOutstandingPayoutUnits, '4687525000');
    assert.equal((await f.store.audit()).ok, true);
  } finally { await f.db.close(); }
});

test('a store cannot settle an accepted source belonging to another currency scope', async () => {
  const f = await fixture();
  try {
    const c = f.context(); await f.store.acceptRound(c);
    const other = new ProgressionStore(f.db, { environment: 'USDT_NILE_TEST', now: () => 1000 }); await other.ready;
    const result = await other.recordSettled({ sourceType: c.sourceType, sourceId: c.sourceId, accountId: f.account,
      paidUnits: '1000000000000', refundedUnits: '0', settledAt: 1100, outcome: 'settled' });
    assert.equal(result, false);
    assert.equal((await f.store.snapshot(f.account)).xp, '0');
  } finally { await f.db.close(); }
});

test('audit rejects a level that does not match its qualified experience', async () => {
  const f = await fixture();
  try {
    await f.earn('100000000');
    assert.equal((await f.store.audit()).ok, true);
    await f.db.prepare('UPDATE progression_players SET level=100 WHERE account_id=?').run(f.account);
    assert.equal((await f.store.audit()).ok, false);
  } finally { await f.db.close(); }
});

test('audit rejects a missing earned milestone even when the XP projection remains correct', async () => {
  const f = await fixture();
  try {
    const before = await f.earn('100000000'); assert.equal(before.grants.length, 1);
    await f.db.prepare('DELETE FROM progression_rewards WHERE account_id=?').run(f.account);
    assert.equal((await f.store.audit()).ok, false);
  } finally { await f.db.close(); }
});

test('client snapshot validation rejects a claimed maximum level with zero experience', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.store.snapshot(f.account); assert(validProgressionSnapshot(snapshot));
    assert.equal(validProgressionSnapshot({ ...snapshot, level: 100 }), false);
  } finally { await f.db.close(); }
});

test('audit rejects an issued nominal changed after its milestone was earned', async () => {
  const f = await fixture();
  try {
    await f.earn('100000000');
    await f.db.prepare("UPDATE progression_rewards SET nominal_units='2000000' WHERE account_id=?").run(f.account);
    assert.equal((await f.store.audit()).ok, false);
  } finally { await f.db.close(); }
});
