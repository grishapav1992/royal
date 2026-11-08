import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatPublicationAudit } from '../scripts/load-chat-v2-audit';
import { CHAT_AUDIT_PAGE_SIZE, type AuditAccount, type AuditReceipt, type AuditWitness } from '../scripts/load-chat-v2-audit-types';

const room = '12345678-0000-4000-8000-000000000001', otherRoom = '12345678-0000-4000-8000-000000000002';
const id = (sequence: number) => '12345678-0000-4000-8000-' + String(sequence).padStart(12, '0');
const profile = { clients: 6, seconds: 2, steadyPerSecond: 3 };
const accounts: AuditAccount[] = Array.from({ length: profile.clients }, (_, accountIndex) => ({
  accountIndex, senderId: 'seat-' + accountIndex, roomEpoch: accountIndex === 5 ? otherRoom : room,
  location: accountIndex === 3 || accountIndex === 4 ? 'tables' : 'arcade',
}));
const rosters = [[accounts[3], accounts[0]], [accounts[4], accounts[1]], [accounts[5], accounts[2]]];

function receipt(index: number): AuditReceipt {
  const { accountIndex, roomEpoch, location } = accounts[index];
  return { publicationId: id(index + 1), accountIndex, roomEpoch, location, publicationSeq: index + 1, offeredAtMs: 100 + index };
}

function witness(sender: number, observer: number, delay = 30): AuditWitness {
  const original = receipt(sender);
  const { accountIndex, roomEpoch, location } = accounts[observer];
  return { publicationId: original.publicationId, accountIndex, roomEpoch, location,
    senderId: accounts[sender].senderId, publicationSeq: original.publicationSeq!, atMs: original.offeredAtMs + delay };
}

function addReceipts(audit: ChatPublicationAudit, rows = accounts.map((_, index) => receipt(index))) {
  for (let shard = 0; shard < rosters.length; shard++) audit.receipts(shard, rows.filter(row => row.accountIndex % rosters.length === shard));
}

test('designates distinct witnesses across workers in each prepared room and location', () => {
  const audit = new ChatPublicationAudit(rosters, profile);
  assert.deepEqual(audit.observers(0), [{ accountIndex: 0 }, { accountIndex: 3 }]);
  assert.deepEqual(audit.observers(1), [{ accountIndex: 1, senderId: 'seat-0' }, { accountIndex: 4, senderId: 'seat-3' }]);
  assert.deepEqual(audit.observers(2), []);
  addReceipts(audit);
  audit.witnesses(0, [witness(1, 0), witness(2, 0, -1), witness(4, 3, 70)]);
  audit.witnesses(1, [witness(0, 1), witness(3, 4)]);
  assert.deepEqual(audit.finish([2, 2, 2]), {
    receipts: 6, uniquePublications: 6, duplicatePublications: 0, eligiblePublications: 5,
    ineligiblePublications: 1, witnessedPublications: 5, unmatchedWitnesses: 0, mismatchedWitnesses: 0,
    changedVisits: 0, peerDeliveryP95Ms: 70,
  });
});

test('reports cross-shard duplicate IDs and rejects echoes, unrelated IDs and inconsistent publication fields', () => {
  const audit = new ChatPublicationAudit(rosters, profile);
  const receipts = accounts.map((_, index) => receipt(index));
  receipts[1].publicationId = receipts[0].publicationId;
  receipts[4].publicationSeq = null;
  addReceipts(audit, receipts);
  audit.witnesses(0, [witness(0, 0), { ...witness(2, 0), publicationSeq: 400 }, witness(4, 3), { ...witness(1, 0), publicationId: id(400) }]);
  audit.witnesses(1, [witness(0, 1), { ...witness(3, 4), senderId: 'other-seat' }]);
  const summary = audit.finish([2, 2, 2]);
  assert.equal(summary.receipts, 6);
  assert.equal(summary.uniquePublications, 5);
  assert.equal(summary.duplicatePublications, 1);
  assert.equal(summary.witnessedPublications, 1);
  assert.equal(summary.unmatchedWitnesses, 1);
  assert.equal(summary.mismatchedWitnesses, 4);
});

test('counts changed visits separately and leaves a sender-only echo unproven', () => {
  const audit = new ChatPublicationAudit(rosters, profile);
  const receipts = accounts.map((_, index) => receipt(index));
  receipts[0].roomEpoch = otherRoom;
  receipts[1].location = 'tables';
  addReceipts(audit, receipts);
  assert.deepEqual(audit.finish([2, 2, 2]), {
    receipts: 6, uniquePublications: 6, duplicatePublications: 0, eligiblePublications: 3,
    ineligiblePublications: 1, witnessedPublications: 0, unmatchedWitnesses: 0, mismatchedWitnesses: 0,
    changedVisits: 2, peerDeliveryP95Ms: null,
  });
});

test('rejects incomplete rosters, cross-worker account claims, oversized pages and incomplete receipt counts', () => {
  assert.throws(() => new ChatPublicationAudit([[accounts[0]], rosters[1], rosters[2]], profile), /invalid-chat-audit-roster/);
  assert.throws(() => new ChatPublicationAudit([[accounts[1], accounts[3]], rosters[1], rosters[2]], profile), /invalid-chat-audit-roster/);
  assert.throws(() => new ChatPublicationAudit([rosters[0], [{ ...accounts[1], senderId: 'seat-0' }, accounts[4]], rosters[2]], profile),
    /invalid-chat-audit-roster/);
  const audit = new ChatPublicationAudit(rosters, profile);
  assert.throws(() => audit.receipts(1, [receipt(0)]), /invalid-chat-audit-receipts/);
  assert.throws(() => audit.receipts(0, [{ ...receipt(0), offeredAtMs: 2000 }]), /invalid-chat-audit-receipts/);
  assert.throws(() => audit.receipts(0, [{ ...receipt(0), secret: 'refuse' }]), /invalid-chat-audit-receipts/);
  assert.throws(() => audit.receipts(0, [receipt(0), receipt(0), receipt(0)]), /invalid-chat-audit-receipts/);
  assert.throws(() => audit.witnesses(0, Array(CHAT_AUDIT_PAGE_SIZE + 1).fill(witness(2, 0))), /invalid-chat-audit-witnesses/);
  assert.throws(() => audit.finish([2, 2, 2]), /chat-audit-publication-count-mismatch/);
  addReceipts(audit);
  assert.throws(() => audit.witnesses(1, [witness(2, 0)]), /invalid-chat-audit-witnesses/);
  audit.witnesses(0, [witness(2, 0, -3)]);
  assert.throws(() => audit.receipts(0, []), /invalid-chat-audit-phase/);
  assert.equal(audit.finish([2, 2, 2]).mismatchedWitnesses, 1);
});
