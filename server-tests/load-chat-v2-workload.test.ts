import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatV2WorkloadLedger, ChatV2WorkloadPlan, type ChatV2WorkloadProfile } from '../scripts/load-chat-v2-workload';
import { createChatMessageId, type ChatV2Send } from '../src/shared/chat';

const roomEpoch = '70826a90-25d0-4f02-91e0-8c630f490055';
const publicationId = 'bcf0f919-3c62-4307-b61b-530f8559f2c2';
const envelope = (text = 'Test message'): ChatV2Send => ({ messageId: createChatMessageId(1_800_000_000_000), roomEpoch, visitId: 1, text });

test('the mixed plan has exact per-second cadence and a one-second burst across disjoint shards', () => {
  const profile = { clients: 10_000, seconds: 1_800, steadyPerSecond: 333, movingClients: 1_000, burst: { count: 10_000, atSecond: 700 } };
  const steadySeen = new Uint8Array(599_400), burstSeen = new Uint8Array(10_000);
  const steadySeconds = new Uint16Array(profile.seconds), burstFrames = new Uint16Array(50);
  let assignedMovers = 0;
  for (let index = 0; index < 13; index++) {
    const plan = new ChatV2WorkloadPlan(profile, { index, count: 13 });
    let previousDue = -1, steady = 0, burst = 0, observedMovers = 0;
    for (const slot of plan.slots()) {
      assert(slot.dueAtMs >= previousDue && slot.dueAtMs < slot.offerBeforeMs);
      assert.equal(slot.accountIndex % 13, index);
      previousDue = slot.dueAtMs;
      if (slot.cohort === 'burst') {
        assert.equal(slot.accountIndex, slot.index);
        assert(slot.dueAtMs >= 700_000 && slot.offerBeforeMs === 701_000);
        assert.equal(slot.dueAtMs % 20, 0);
        burstFrames[(slot.dueAtMs - 700_000) / 20]++;
        assert.equal(burstSeen[slot.index]++, 0);
        assert.equal(plan.moves(slot.accountIndex), slot.accountIndex < profile.movingClients);
        observedMovers += Number(plan.moves(slot.accountIndex));
        burst++;
      } else {
        assert.equal(slot.accountIndex, slot.index % profile.clients);
        assert.equal(steadySeen[slot.index]++, 0);
        steadySeconds[Math.floor(slot.dueAtMs / 1_000)]++;
        steady++;
      }
    }
    assert.deepEqual(plan.planned, { steady, burst });
    assert.equal(plan.clientsInShard, burst);
    assert.equal(plan.movingClients, observedMovers);
    assert(!plan.moves((index + 1) % 13));
    assignedMovers += observedMovers;
  }
  assert(steadySeen.every(count => count === 1));
  assert(burstSeen.every(count => count === 1));
  assert(steadySeconds.every(count => count === 333));
  assert(burstFrames.every(count => count === 200));
  assert.equal(assignedMovers, 1_000);
});

test('invalid profile, shard, and slot are rejected and empty local cohorts are valid', () => {
  const profile = { clients: 4, seconds: 1, steadyPerSecond: 1, burst: { count: 1, atSecond: 0 } };
  const plan = new ChatV2WorkloadPlan(profile, { count: 4, index: 3 });
  assert.deepEqual(plan.planned, { steady: 0, burst: 0 });
  assert.deepEqual([...plan.slots()], []);
  assert.throws(() => plan.slot('burst', 0), /does not belong/);
  assert.throws(() => new ChatV2WorkloadPlan(profile, { count: 4, index: 4 }), RangeError);
  assert.equal(plan.movingClients, 1);
  assert(plan.moves(3));
  const chatOnly = new ChatV2WorkloadPlan({ ...profile, movingClients: 0 });
  assert.equal(chatOnly.movingClients, 0);
  assert(!chatOnly.moves(0));
  assert.deepEqual(chatOnly.planned, { steady: 1, burst: 1 });
  const invalid: Partial<ChatV2WorkloadProfile>[] = [{ clients: 10_001 }, { seconds: 1_801 }, { steadyPerSecond: 334 },
    { movingClients: -1 }, { movingClients: 1.5 }, { movingClients: 5 },
    { burst: { count: 5, atSecond: 0 } }, { burst: { count: 4, atSecond: 1 } }];
  for (const override of invalid) assert.throws(() => new ChatV2WorkloadPlan({ ...profile, ...override }), RangeError);
});

test('recovery reuses the original send and publication while accounting for actual offers and deadlines', () => {
  const plan = new ChatV2WorkloadPlan({ clients: 4, seconds: 2, steadyPerSecond: 2, burst: { count: 2, atSecond: 1 } });
  const ledger = new ChatV2WorkloadLedger(plan);
  const [recovered, pending, rejected, late] = Array.from({ length: 4 }, () => envelope());

  ledger.offer('steady', 0, recovered, 10);
  ledger.observeResult(0, { messageId: recovered.messageId, status: 'retry_later', reasonCode: 'commit_unknown', retryAfterMs: 100 }, 12);
  ledger.observeResult(0, { messageId: recovered.messageId, status: 'not_found' }, 112);
  ledger.retry(0, { ...recovered }, 115);
  ledger.observePublication(0, { roomEpoch }, { publicationId, publicationSeq: 1 }, 120);
  const published = { messageId: recovered.messageId, status: 'published', publicationId } as const;
  ledger.observeResult(0, published, 122);
  ledger.observeResult(0, published, 123);
  ledger.observePublication(0, { roomEpoch }, { publicationId, publicationSeq: 1 }, 124);

  ledger.offer('steady', 1, pending, 500);
  ledger.observeResult(1, { messageId: pending.messageId, status: 'accepted' }, 507);
  ledger.offer('steady', 2, rejected, 1_000);
  ledger.observeResult(2, { messageId: rejected.messageId, status: 'rejected', reasonCode: 'profanity' }, 1_025);
  ledger.offer('burst', 0, late, 1_010);
  ledger.observeResult(0, { messageId: late.messageId, status: 'accepted' }, 1_020);
  ledger.observeResult(0, { messageId: late.messageId, status: 'cancelled', reasonCode: 'session_revoked' }, 7_001);

  const { steady, burst, unmatchedPublications } = ledger.summary();
  assert.equal(unmatchedPublications, 0);
  assert.equal(steady.planned, 4);
  assert.equal(steady.offered, 3);
  assert.equal(steady.missed, 1);
  assert.equal(steady.retryAttempts, 1);
  assert.equal(steady.firstResponseRetryLater, 1);
  assert.equal(steady.resumeMiss, 1);
  assert.equal(steady.acknowledgements, 1);
  assert.equal(steady.acknowledgement.p95, 7);
  assert.equal(steady.acceptanceConfirmed, 2);
  assert.equal(steady.acceptedWithoutTerminal, 1);
  assert.equal(steady.published, 1);
  assert.equal(steady.rejected, 1);
  assert.equal(steady.witnessed, 1);
  assert.equal(steady.delivery.p95, 110);
  assert.equal(burst.missed, 1);
  assert.equal(burst.cancelled, 1);
  assert.equal(burst.terminalByDeadline, 0);
  assert(!JSON.stringify({ steady, burst }).includes(recovered.messageId));
});

test('late offers, changed retries, unexpected receipts and conflicting publications fail closed', () => {
  const ledger = new ChatV2WorkloadLedger(new ChatV2WorkloadPlan({ clients: 2, seconds: 1, steadyPerSecond: 2 }));
  const original = envelope(), other = envelope();
  assert.throws(() => ledger.offer('steady', 0, original, 1_000), /outside its planned offer window/);
  ledger.offer('steady', 0, original, 0);
  assert.throws(() => ledger.offer('steady', 0, other, 1), /Duplicate first send/);
  assert.throws(() => ledger.retry(0, { ...original, visitId: 2 }, 10), /changed the original/);
  const published = { messageId: original.messageId, status: 'published', publicationId } as const;
  assert.throws(() => ledger.observeResult(1, published, 10), /does not match an offered send/);
  assert.throws(() => ledger.observeResult(0, { ...published, messageId: other.messageId }, 10), /does not match an offered send/);
  ledger.observePublication(0, { roomEpoch }, { publicationId, publicationSeq: 1 }, 10);
  assert.equal(ledger.summary().unmatchedPublications, 1);
  ledger.observeResult(0, published, 11);
  assert.throws(() => ledger.observeResult(0, { messageId: original.messageId, status: 'rejected', reasonCode: 'spam' }, 12),
    /Conflicting terminal/);
  assert.throws(() => ledger.observePublication(0, { roomEpoch: 'other-room' }, { publicationId, publicationSeq: 1 }, 13),
    /does not match its original send/);
  ledger.offer('steady', 1, other, 500);
  assert.throws(() => ledger.observeResult(1, { ...published, messageId: other.messageId }, 510), /assigned to multiple sends/);
  assert.throws(() => ledger.observeResult(1, { messageId: other.messageId, status: 'id_conflict', reasonCode: 'id_conflict' }, 511),
    /reported an ID conflict/);
});

test('audit enumerates the exact terminal publication IDs even when the sender did not observe its own batch', () => {
  const ledger = new ChatV2WorkloadLedger(new ChatV2WorkloadPlan({ clients: 2, seconds: 1, steadyPerSecond: 2 }));
  const sent = envelope(), pending = envelope();
  ledger.offer('steady', 0, sent, 0, 'arcade');
  ledger.offer('steady', 1, pending, 500, 'tables');
  const published = { messageId: sent.messageId, status: 'published', publicationId } as const;
  ledger.observeResult(0, published, 12);
  ledger.observeResult(0, published, 13);
  assert.deepEqual([...ledger.auditReceipts()], [{ publicationId, accountIndex: 0, roomEpoch, location: 'arcade', publicationSeq: null, offeredAtMs: 0 }]);
  ledger.observePublication(0, { roomEpoch }, { publicationId, publicationSeq: 7 }, 14);
  assert.deepEqual([...ledger.auditReceipts()], [{ publicationId, accountIndex: 0, roomEpoch, location: 'arcade', publicationSeq: 7, offeredAtMs: 0 }]);
});
