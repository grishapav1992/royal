import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  CHAT_V2_FIRST_ADMISSION_MS, CHAT_V2_FUTURE_TOLERANCE_MS, CHAT_V2_HISTORY_LIMIT, CHAT_V2_RESUME_LIMIT,
  ROOM_CHAT_PROTOCOL, ROOM_CHAT_PROTOCOL_V2, chatMessageIdTimestamp, chatV2FirstAdmissionAge, createChatMessageId,
  parseChatV2Batch, parseChatV2HistoryRequest, parseChatV2Ready, parseChatV2ReadyRequest, parseChatV2Result,
  parseChatV2ResumeRequest, parseChatV2ResumeResponse, parseChatV2Send, parseChatV2Visit,
  type ChatV2Send, type ChatV2Visit,
} from '../src/shared/chat';
import { decideChatV2Send, fingerprintChatV2Envelope, readChatV2Resume, type ChatV2StoredReceipt } from '../server/chatProtocolV2';

const NOW = 1_645_557_742_000;
const MESSAGE_ID = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
const ROOM_EPOCH = '601c144d-7064-4e29-8ce0-91f0829946f0';
const VISIT = { roomEpoch: ROOM_EPOCH, visitId: 12, location: 'arcade', initialCursor: 5 } satisfies ChatV2Visit;
const SEND = { messageId: MESSAGE_ID, text: 'Привет 🌍', roomEpoch: ROOM_EPOCH, visitId: VISIT.visitId } satisfies ChatV2Send;
const PUBLICATION_ID = '56708784-314f-4f7a-8d61-a931ac924440';

test('V2 negotiates explicitly and distinguishes a closed visit from an invalid packet', () => {
  assert.equal(ROOM_CHAT_PROTOCOL, 1);
  assert.equal(ROOM_CHAT_PROTOCOL_V2, 2);
  assert.deepEqual(parseChatV2ReadyRequest({ version: 2 }), { version: 2 });
  assert.equal(parseChatV2ReadyRequest({ version: 1 }), undefined);
  assert.equal(parseChatV2ReadyRequest({ version: 2, accountId: 'alice' }), undefined);
  assert.deepEqual(parseChatV2Ready({ version: 2, serverTimeMs: NOW }), { version: 2, serverTimeMs: NOW });
  assert.equal(parseChatV2Ready({ version: 2, serverTimeMs: -1 }), undefined);
  assert.deepEqual(parseChatV2Visit({ ...VISIT, roomEpoch: ROOM_EPOCH.toUpperCase() }), VISIT);
  assert.equal(parseChatV2Visit(null), null);
  assert.equal(parseChatV2Visit({ ...VISIT, location: 'street' }), undefined);
});

test('UUIDv7 carries the server-relative time and has a precise first admission window', () => {
  assert.equal(chatMessageIdTimestamp(MESSAGE_ID.toUpperCase()), NOW);
  assert.equal(chatMessageIdTimestamp(createChatMessageId(NOW)), NOW);
  assert.equal(chatMessageIdTimestamp(createChatMessageId(2 ** 48 - 1)), 2 ** 48 - 1);
  assert.throws(() => createChatMessageId(2 ** 48), RangeError);
  assert.equal(chatMessageIdTimestamp(randomUUID()), undefined);
  assert.equal(chatMessageIdTimestamp(MESSAGE_ID.replace('-98c4-', '-78c4-')), undefined);
  assert.equal(chatMessageIdTimestamp(MESSAGE_ID + '\n'), undefined);
  assert.equal(chatV2FirstAdmissionAge(MESSAGE_ID, NOW + CHAT_V2_FIRST_ADMISSION_MS - 1), 'valid');
  assert.equal(chatV2FirstAdmissionAge(MESSAGE_ID, NOW + CHAT_V2_FIRST_ADMISSION_MS), 'expired');
  assert.equal(chatV2FirstAdmissionAge(MESSAGE_ID, NOW - CHAT_V2_FUTURE_TOLERANCE_MS), 'valid');
  assert.equal(chatV2FirstAdmissionAge(MESSAGE_ID, NOW - CHAT_V2_FUTURE_TOLERANCE_MS - 1), 'future');
});

test('send validates the exact client envelope and fingerprints its normalized UTF-8 fields', () => {
  const wire = { ...SEND, messageId: MESSAGE_ID.toUpperCase(), roomEpoch: ROOM_EPOCH.toUpperCase(), text: '\tПривет\u007f🌍\r' };
  assert.deepEqual(parseChatV2Send(wire), { ok: true, value: SEND });
  assert.equal(fingerprintChatV2Envelope(wire), '159c26fe253ada52221c819d46ec913446b780b36a8f29d8083097446b5a7bbf');
  assert.equal(fingerprintChatV2Envelope({ ...SEND, messageId: createChatMessageId(NOW) }), fingerprintChatV2Envelope(SEND));
  assert.notEqual(fingerprintChatV2Envelope({ ...SEND, visitId: VISIT.visitId + 1 }), fingerprintChatV2Envelope(SEND));
  assert.deepEqual(parseChatV2Send({ ...SEND, accountId: 'alice' }), { ok: false, messageId: MESSAGE_ID, reasonCode: 'invalid_payload' });
  assert.deepEqual(parseChatV2Send({ ...SEND, visitId: 0 }), { ok: false, messageId: MESSAGE_ID, reasonCode: 'invalid_payload' });
  assert.deepEqual(parseChatV2Send({ ...SEND, messageId: randomUUID() }), { ok: false, reasonCode: 'invalid_payload' });
  assert.equal(parseChatV2Send({ ...SEND, text: '🌍'.repeat(150) }).ok, true);
  assert.deepEqual(parseChatV2Send({ ...SEND, text: '🌍'.repeat(151) }), { ok: false, messageId: MESSAGE_ID, reasonCode: 'invalid_text' });
  assert.deepEqual(parseChatV2Send({ ...SEND, text: '\t\n' }), { ok: false, messageId: MESSAGE_ID, reasonCode: 'invalid_text' });
});

test('resume and history packets enforce bounds and preserve filtered cursor ranges', () => {
  const another = createChatMessageId(NOW);
  assert.deepEqual(parseChatV2ResumeRequest({ messageIds: [MESSAGE_ID.toUpperCase(), MESSAGE_ID, another] }), { messageIds: [MESSAGE_ID, another] });
  assert.equal(parseChatV2ResumeRequest({ messageIds: Array(CHAT_V2_RESUME_LIMIT + 1).fill(MESSAGE_ID) }), undefined);
  assert.equal(parseChatV2ResumeRequest({ accountId: 'alice', messageIds: [MESSAGE_ID] }), undefined);
  const history = { visitId: VISIT.visitId, afterCursor: 5, limit: CHAT_V2_HISTORY_LIMIT };
  assert.deepEqual(parseChatV2HistoryRequest(history), history);
  assert.equal(parseChatV2HistoryRequest({ ...history, afterCursor: 2 ** 53 }), undefined);
  assert.equal(parseChatV2HistoryRequest({ ...history, limit: CHAT_V2_HISTORY_LIMIT + 1 }), undefined);

  const batch = { roomEpoch: ROOM_EPOCH, visitId: VISIT.visitId, fromCursor: 5, scannedThrough: 8, messages: [], hasMore: true, reset: false };
  assert.deepEqual(parseChatV2Batch(batch), batch);
  const drained = { ...batch, scannedThrough: batch.fromCursor, hasMore: false };
  assert.deepEqual(parseChatV2Batch(drained), drained);
  assert.equal(parseChatV2Batch({ ...drained, hasMore: true }), undefined);
  const publication = { publicationId: PUBLICATION_ID, publicationSeq: 8, senderId: 'player', name: 'Name', text: 'f**k', time: NOW };
  assert.deepEqual(parseChatV2Batch({ ...batch, messages: [publication] })?.messages, [publication]);
  assert.deepEqual(parseChatV2Batch({ ...batch, messages: [{ ...publication, messageId: MESSAGE_ID, accountId: 'alice' }] })?.messages, [publication]);
  assert.equal(parseChatV2Batch({ ...batch, messages: [publication, { ...publication, publicationSeq: 7 }] }), undefined);
  assert.equal(parseChatV2Batch({ ...batch, messages: [{ ...publication, publicationSeq: 9 }] }), undefined);
});

test('wire results require fields for their status and recovery contains only receipt metadata', () => {
  const accepted = { messageId: MESSAGE_ID, status: 'accepted' } as const;
  const published = { messageId: MESSAGE_ID, status: 'published', publicationId: PUBLICATION_ID } as const;
  assert.deepEqual(parseChatV2Result(accepted), accepted);
  assert.deepEqual(parseChatV2Result(published), published);
  assert.equal(parseChatV2Result({ ...accepted, publicationId: PUBLICATION_ID }), undefined);
  assert.equal(parseChatV2Result({ messageId: MESSAGE_ID, status: 'published' }), undefined);
  assert.equal(parseChatV2Result({ messageId: MESSAGE_ID, status: 'cancelled', reasonCode: 'spam' }), undefined);
  assert.equal(parseChatV2Result({ messageId: MESSAGE_ID, status: 'retry_later', reasonCode: 'busy', retryAfterMs: 2 ** 31 }), undefined);
  const retry = { messageId: MESSAGE_ID, status: 'retry_later', reasonCode: 'commit_unknown', retryAfterMs: 1000 } as const;
  assert.deepEqual(parseChatV2Result(retry), retry);
  const absent = { messageId: createChatMessageId(NOW), status: 'not_found' } as const;
  assert.equal(parseChatV2Result(absent), undefined);
  assert.deepEqual(parseChatV2ResumeResponse({ results: [{ ...published, text: 'private body' }, absent] }), { results: [published, absent] });
  assert.equal(parseChatV2ResumeResponse({ results: [published, accepted] }), undefined);
});

test('same-account replay precedes age and visit checks and changed payload conflicts', async () => {
  const result = { messageId: MESSAGE_ID, status: 'published', publicationId: PUBLICATION_ID } as const;
  const receipt: ChatV2StoredReceipt = { accountId: 'alice', fingerprint: fingerprintChatV2Envelope(SEND), result };
  const find = async (key: { accountId: string; messageId: string }) => {
    assert.deepEqual(key, { accountId: 'alice', messageId: MESSAGE_ID });
    return receipt;
  };
  const later = NOW + CHAT_V2_FIRST_ADMISSION_MS;
  const getCurrentVisit = () => assert.fail('a known receipt bypasses current visit lookup');
  assert.deepEqual(await decideChatV2Send('alice', SEND, getCurrentVisit, later, find), { kind: 'result', result });
  for (const changed of [{ ...SEND, text: 'New text' }, { ...SEND, visitId: 13 }, { ...SEND, roomEpoch: randomUUID() }]) {
    assert.deepEqual(await decideChatV2Send('alice', changed, getCurrentVisit, later, find), {
      kind: 'result', result: { messageId: MESSAGE_ID, status: 'id_conflict', reasonCode: 'id_conflict' },
    });
  }
});

test('fresh admission reads the current visit after an in-flight receipt lookup resolves', async () => {
  const lookup = Promise.withResolvers<ChatV2StoredReceipt | undefined>();
  let currentVisit: ChatV2Visit = VISIT;
  let reads = 0;
  const decision = decideChatV2Send('alice', SEND, () => { reads++; return currentVisit; }, NOW, () => lookup.promise);
  assert.equal(reads, 0);
  currentVisit = { ...VISIT, visitId: VISIT.visitId + 1 };
  lookup.resolve(undefined);
  assert.deepEqual(await decision, { kind: 'result', result: { messageId: MESSAGE_ID, status: 'cancelled', reasonCode: 'visit_changed' } });
  assert.equal(reads, 1);
});

test('fresh admission and batch recovery treat foreign receipts as absent', async () => {
  const result = { messageId: MESSAGE_ID, status: 'accepted' } as const;
  const other = { accountId: 'bob', fingerprint: fingerprintChatV2Envelope(SEND), result };
  const find = async () => other;
  assert.deepEqual(await decideChatV2Send('alice', SEND, () => VISIT, NOW, find), { kind: 'new', fingerprint: other.fingerprint });
  assert.deepEqual(await decideChatV2Send('alice', SEND, () => null, NOW, find), {
    kind: 'result', result: { messageId: MESSAGE_ID, status: 'cancelled', reasonCode: 'visit_changed' },
  });
  assert.deepEqual(await decideChatV2Send('alice', SEND, () => VISIT, NOW + CHAT_V2_FIRST_ADMISSION_MS, find), {
    kind: 'result', result: { messageId: MESSAGE_ID, status: 'expired', reasonCode: 'message_id_expired' },
  });
  assert.deepEqual(await decideChatV2Send('alice', SEND, () => VISIT, NOW - CHAT_V2_FUTURE_TOLERANCE_MS - 1, find), {
    kind: 'result', result: { messageId: MESSAGE_ID, status: 'rejected', reasonCode: 'message_id_in_future' },
  });

  const expired = createChatMessageId(NOW - CHAT_V2_FIRST_ADMISSION_MS);
  const ownId = createChatMessageId(NOW - CHAT_V2_FIRST_ADMISSION_MS - 1);
  const own = { messageId: ownId, status: 'published', publicationId: PUBLICATION_ID } as const;
  const request = { messageIds: [ownId, MESSAGE_ID, expired] };
  assert.deepEqual(await readChatV2Resume('alice', request, NOW, async (accountId, ids) => {
    assert.equal(accountId, 'alice'); assert.deepEqual(ids, request.messageIds);
    return [other, { accountId, fingerprint: 'unused for status', result: { ...own, text: 'private body' } }];
  }), { results: [own, { messageId: MESSAGE_ID, status: 'not_found' }, { messageId: expired, status: 'expired', reasonCode: 'message_id_expired' }] });
});
