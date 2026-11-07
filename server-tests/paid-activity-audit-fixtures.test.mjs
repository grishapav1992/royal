import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSourceKey, isAuditRecord } from '../server/audit/contract.ts';
import { fixtureClock, fixtureOracles, fixtureRecords } from './audit/fixtures/scenarios.ts';

const sameAsset = (a, b) => a.contour === b.contour && a.code === b.code && a.scale === b.scale;
const sumAvailable = records => records.reduce((sum, record) => sum + BigInt(record.availableDeltaUnits), 0n);

for (const [name, records] of Object.entries(fixtureRecords)) {
  test(name + ' has valid isolated records and the labelled financial evidence', () => {
    const oracle = fixtureOracles[name];
    const scope = records[0].scope;
    assert.equal(scope.environment, 'test');
    assert.match(scope.datasetId, /^test-paid-activity-fixture-/);
    for (const record of records) {
      assert.ok(isAuditRecord(record), JSON.stringify(record));
      assert.deepEqual(record.scope, scope);
      assert.equal(Object.hasOwn(record, 'behavior'), false);
      assert.equal(Object.hasOwn(record, 'settlementFinding'), false);
    }

    const postings = records.filter(record => record.type === 'posting');
    const postingsBySource = new Map(postings.map(posting => [auditSourceKey(posting.source), posting]));
    assert.equal(postings.length, oracle.expectedPostingCount);
    assert.equal(postingsBySource.size, postings.length);
    const events = records.filter(record => record.type === 'event');
    assert.equal(new Set(events.map(event => event.eventId)).size, events.length);
    for (const event of events) {
      for (const source of event.postings) {
        const posting = postingsBySource.get(auditSourceKey(source));
        assert.ok(posting, 'event posting must exist in the same dataset');
        assert.equal(auditSourceKey(posting.entity.source), auditSourceKey(event.entity.source));
      }
    }

    let coveredPostings = 0;
    for (const expected of oracle.balances) {
      const matching = postings.filter(posting => posting.accountId === expected.accountId && sameAsset(posting.asset, expected.asset));
      assert.ok(matching.length > 0);
      coveredPostings += matching.length;
      let available = BigInt(expected.opening);
      let reserved = expected.openingReserved === undefined ? null : BigInt(expected.openingReserved);
      for (const posting of matching) {
        available += BigInt(posting.availableDeltaUnits);
        assert.equal(posting.availableAfterUnits, String(available));
        if (reserved !== null) {
          reserved += BigInt(posting.reservedDeltaUnits);
          assert.equal(posting.reservedAfterUnits, String(reserved));
        }
      }
      assert.equal(String(available), expected.closing);
      if (reserved !== null) assert.equal(String(reserved), expected.closingReserved);
    }
    assert.equal(coveredPostings, postings.length);

    const attempts = records.filter(record => record.type === 'attempt');
    assert.equal(new Set(attempts.map(attempt => attempt.attemptId)).size, attempts.length);
    const responseMismatches = [];
    for (const attempt of attempts) {
      if (attempt.balance.state !== 'value') continue;
      const snapshot = postingsBySource.get(auditSourceKey(attempt.balance.snapshot));
      assert.ok(snapshot, 'fixture with an observed balance must provide the referenced snapshot');
      assert.equal(snapshot.accountId, attempt.accountId);
      assert.ok(sameAsset(snapshot.asset, attempt.balance.asset));
      if (attempt.balance.units !== snapshot.availableAfterUnits) responseMismatches.push(attempt.attemptId);
    }
    assert.deepEqual(responseMismatches, oracle.responseMismatches);
  });
}

test('lost answer and changed intent are separate from the single committed stake', () => {
  const attempts = fixtureRecords.casinoRetry.filter(record => record.type === 'attempt');
  const postings = fixtureRecords.casinoRetry.filter(record => record.type === 'posting');
  assert.deepEqual(attempts.map(attempt => [attempt.decision, attempt.response, attempt.statusCode]), [
    ['accepted', 'not-observed', null],
    ['replayed', 'formed', 200],
    ['rejected', 'formed', 409],
  ]);
  assert.equal(new Set([...attempts, ...postings].map(record => record.operationId)).size, 1);
  assert.deepEqual(postings.map(posting => posting.movement), ['stake', 'payout']);
  assert.equal(sumAvailable(postings), -100n);
});

test('PvP accounting anomalies and behavior labels are independent', () => {
  for (const name of ['pvpControl', 'pvpReview', 'pvpPayoutMismatch']) {
    const records = fixtureRecords[name];
    const terminals = records.filter(record => record.type === 'event' && record.event === 'forfeited');
    const bankRemainders = terminals.map(terminal => {
      const postings = records.filter(record => record.type === 'posting' &&
        auditSourceKey(record.entity.source) === auditSourceKey(terminal.entity.source));
      const holds = postings.filter(posting => posting.movement === 'reserve');
      assert.equal(holds.length, 2);
      assert.equal(holds[0].operationId, holds[1].operationId);
      assert.notEqual(holds[0].accountId, holds[1].accountId);
      return -sumAvailable(postings);
    });
    const expectedRemainder = name === 'pvpPayoutMismatch' ? 0n : 100n;
    assert.ok(bankRemainders.every(remainder => remainder === expectedRemainder));
    assert.equal(fixtureOracles[name].behavior, name === 'pvpReview' ? 'review' : 'control');
  }
  assert.equal(fixtureOracles.pvpPayoutMismatch.settlementFinding, 'pvp-payout-mismatch');
  const starts = fixtureRecords.pvpReview.filter(record => record.type === 'event' && record.event === 'reserved');
  const finishes = fixtureRecords.pvpReview.filter(record => record.type === 'event' && record.event === 'forfeited');
  assert.deepEqual(finishes.map((finish, index) => finish.occurredAtMs - starts[index].occurredAtMs), [4000, 3500, 4100]);
  assert.ok(finishes.every(finish => finish.accountId === 'fixture-a'));
});

test('pool cutoff, aggregate credit, duplicate credit, and full refund are distinct', () => {
  const cutoff = fixtureClock + 240_000;
  const records = fixtureRecords.poolCutoff;
  const accepted = records.filter(record => record.type === 'attempt' && record.decision === 'accepted');
  assert.equal(accepted.length, 4);
  assert.equal(accepted.at(-1).occurredAtMs, cutoff - 1);
  const rejected = records.find(record => record.type === 'attempt' && record.decision === 'rejected');
  assert.equal(rejected.occurredAtMs, cutoff);
  assert.equal(rejected.statusCode, 409);
  const postings = records.filter(record => record.type === 'posting');
  assert.ok(postings.every(posting => posting.operationId !== rejected.operationId));
  assert.equal(postings.filter(posting => posting.entity.ticketId && posting.accountId === 'fixture-a').length, 2);
  const credits = postings.filter(posting => posting.movement === 'payout');
  assert.equal(credits.length, 1);
  assert.equal(credits[0].entity.ticketId, null);
  assert.equal(credits[0].availableDeltaUnits, '380');
  assert.equal(sumAvailable(postings), -20n);
  const duplicates = fixtureRecords.poolDuplicateCredit.filter(record => record.type === 'posting' && record.movement === 'payout');
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].operationId, duplicates[1].operationId);
  assert.notEqual(auditSourceKey(duplicates[0].source), auditSourceKey(duplicates[1].source));
  assert.equal(fixtureOracles.poolDuplicateCredit.settlementFinding, 'pool-duplicate-credit');
  const refunded = fixtureRecords.poolRefund.filter(record => record.type === 'posting');
  assert.deepEqual(refunded.map(posting => posting.movement), ['stake', 'refund']);
  assert.equal(sumAvailable(refunded), 0n);
});

test('payment sources and test datasets are scoped independently', () => {
  const postings = fixtureRecords.payment.filter(record => record.type === 'posting');
  assert.equal(postings[0].source.rowId, postings[1].source.rowId);
  assert.notEqual(auditSourceKey(postings[0].source), auditSourceKey(postings[1].source));
  assert.equal(postings[0].asset.contour, 'virtual');
  assert.equal(postings[1].asset.contour, 'real');
  assert.equal(postings[1].scope.environment, 'test');
  assert.equal(postings[2].movement, 'withdrawal-paid');
  assert.equal(postings[2].availableDeltaUnits, '0');
  assert.equal(postings[2].reservedDeltaUnits, '-1000000');

  const first = fixtureRecords.casinoMismatch[0];
  const second = fixtureRecords.casinoRetry[0];
  assert.equal(first.occurredAtMs, second.occurredAtMs);
  assert.equal(auditSourceKey(first.source), auditSourceKey(second.source));
  assert.notEqual(first.scope.datasetId, second.scope.datasetId);
});
