import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Room } from '@colyseus/sdk';
import type { LobbyState } from '../server/state';
import { LoadChatV2Session, type LoadChatV2Transport } from '../scripts/load-chat-v2-session';
import { ChatV2WorkloadLedger, ChatV2WorkloadPlan } from '../scripts/load-chat-v2-workload';
import { CHAT_CONFIRMATION_TIMEOUT_MS, chatMessageIdTimestamp, createChatMessageId, type ChatV2Batch,
  type ChatV2Publication, type ChatV2Send, type ChatV2ServerPackets, type ChatV2Visit } from '../src/shared/chat';

type Packet = keyof ChatV2ServerPackets;
const serverTimeMs = 1_800_000_000_000;
const sender = 'own-synthetic-sender';
const roomEpoch = '70826a90-25d0-4f02-91e0-8c630f490055';
const publicationId = 'bcf0f919-3c62-4307-b61b-530f8559f2c2';
const visit: ChatV2Visit = { roomEpoch, visitId: 1, location: 'arcade', initialCursor: 5 };

class FakeRoom implements LoadChatV2Transport {
  connection = { isOpen: true };
  failSend = false;
  readonly outbound: { type: string; value: unknown }[] = [];
  readonly handlers = new Map<Packet, (value: unknown) => void>();

  onMessage(type: Packet, handler: (value: unknown) => void) {
    assert(!this.handlers.has(type));
    this.handlers.set(type, handler);
    return () => { this.handlers.delete(type); };
  }

  send(type: string, value: unknown) {
    if (this.failSend) throw new Error('Test transport write failed');
    this.outbound.push({ type, value });
  }

  emit(type: Packet, value: unknown) { this.handlers.get(type)?.(value); }
  negotiate() { this.emit('chat.ready', { version: 2, serverTimeMs }); }
  get last() { return this.outbound.at(-1); }
}

function fixture(steadyPerSecond = 1, seconds = 1) {
  const clock = { at: 0 };
  const ledger = new ChatV2WorkloadLedger(new ChatV2WorkloadPlan({ clients: 1, steadyPerSecond, seconds }));
  return { clock, ledger, session: new LoadChatV2Session(0, ledger, () => clock.at), room: new FakeRoom() };
}

function batch(messages: ChatV2Publication[], scope = visit, fromCursor = scope.initialCursor): ChatV2Batch {
  return { roomEpoch: scope.roomEpoch, visitId: scope.visitId, fromCursor,
    scannedThrough: messages.at(-1)?.publicationSeq ?? fromCursor, messages, hasMore: false, reset: false };
}

test('a Colyseus Room exposes the required V2 transport and negotiation only offers through V1 history', () => {
  const structurallyCompatible: Room<LobbyState> extends LoadChatV2Transport ? true : false = true;
  assert(structurallyCompatible);
  const { session, room, clock, ledger } = fixture();
  const slot = { cohort: 'steady', index: 0 } as const;
  clock.at = -50;
  session.attach(room, sender);
  assert.deepEqual(room.outbound, [{ type: 'history', value: { version: 1, offerVersion: 2 } }]);
  assert.equal(session.offer(slot, 'hi'), undefined);
  room.emit('chat.visit', visit);
  room.negotiate();
  assert(session.ready);
  assert.equal(session.offer(slot, 'hi'), undefined);
  room.emit('chat.visit', null);
  clock.at = 15;
  assert.equal(session.offer(slot, 'hi'), undefined);
  room.emit('chat.visit', visit);
  const messageId = session.offer(slot, '  Hello  ');
  assert.equal(chatMessageIdTimestamp(messageId), serverTimeMs + 65);
  assert.deepEqual(room.last, { type: 'chat.send', value: { messageId, roomEpoch, visitId: 1, text: 'Hello' } });
  assert.equal(ledger.summary().steady.offered, 1);
  assert.throws(() => session.offer(slot, 'duplicate'), /slot order/);
  assert.equal(room.outbound.length, 2);
});

test('parses server messages and witnesses only the sender publication in the active visit', () => {
  const { session, room, clock, ledger } = fixture();
  session.attach(room, sender);
  room.negotiate();
  room.emit('chat.visit', visit);
  const messageId = session.offer({ cohort: 'steady', index: 0 }, 'Hello');
  const own = { publicationId, publicationSeq: 6, senderId: sender, name: 'A', text: 'Hello', time: serverTimeMs };
  clock.at = 9;
  room.emit('chat.result', { messageId, status: 'accepted' });
  clock.at = 11;
  room.emit('chat.batch', batch([own], { ...visit, visitId: 2 }));
  room.emit('chat.batch', batch([{ ...own, senderId: 'peer' }]));
  room.emit('chat.batch', batch([{ ...own, system: true }]));
  assert.equal(ledger.summary().unmatchedPublications, 0);
  assert.throws(() => room.emit('chat.batch', batch([own], visit, 4)), /before the active visit/);
  room.emit('chat.batch', batch([own]));
  clock.at = 12;
  room.emit('chat.result', { messageId, status: 'published', publicationId });
  assert.equal(session.unresolved, 0);
  assert.equal(ledger.summary().steady.acknowledgement.p95, 9);
  assert.equal(ledger.summary().steady.delivery.p95, 11);
  assert.equal(ledger.summary().unmatchedPublications, 0);
  assert.throws(() => room.emit('chat.result', { messageId, status: 'other' }), /Invalid V2 result/);
  assert.throws(() => room.emit('chat.batch', { messages: [] }), /Invalid V2 chat batch/);
});

test('pre-start negotiation calibrates UUIDs independently of the common workload start', () => {
  let monotonic = 100, startAt = 0;
  const ledger = new ChatV2WorkloadLedger(new ChatV2WorkloadPlan({ clients: 1, steadyPerSecond: 1, seconds: 1 }));
  const session = new LoadChatV2Session(0, ledger, () => monotonic - startAt, () => monotonic);
  const room = new FakeRoom();
  session.attach(room, sender);
  room.negotiate();
  assert(session.ready);
  assert(!session.visitReady);
  room.emit('chat.visit', visit);
  assert(session.visitReady);
  startAt = 500;
  monotonic = 510;
  const id = session.offer({ cohort: 'steady', index: 0 }, 'A scheduled message');
  assert.equal(chatMessageIdTimestamp(id), serverTimeMs + 410);
  assert.equal(ledger.summary().steady.offerLag.p50, 10);
});

test('reconnect requests original IDs even before a visit, then replays only a missing matching envelope', () => {
  const { session, room, clock, ledger } = fixture(2);
  session.attach(room, sender);
  room.negotiate();
  room.emit('chat.visit', visit);
  const acceptedId = session.offer({ cohort: 'steady', index: 0 }, 'Accepted');
  room.emit('chat.result', { messageId: acceptedId, status: 'accepted' });
  clock.at = 500;
  const messageId = session.offer({ cohort: 'steady', index: 1 }, 'Lost ACK');
  const initial = room.last?.value as ChatV2Send;
  const staleResult = room.handlers.get('chat.result');
  const next = new FakeRoom();
  clock.at = 600;
  session.attach(next, sender);
  assert.equal(room.handlers.size, 0);
  staleResult?.({ messageId, status: 'published', publicationId });
  session.recover();
  assert.equal(next.outbound.length, 1);
  next.negotiate();
  session.recover();
  session.recover();
  assert.equal(next.outbound.length, 2);
  assert.deepEqual(next.last, { type: 'chat.resume', value: { messageIds: [acceptedId, messageId] } });
  assert.throws(() => next.emit('chat.resume', { results: [{ messageId, status: 'not_found' }] }), /outstanding request/);
  next.emit('chat.resume', { results: [{ messageId, status: 'not_found' }, { messageId: acceptedId, status: 'accepted' }] });
  session.recover();
  next.emit('chat.visit', { ...visit, visitId: 2 });
  session.recover();
  assert.equal(next.outbound.length, 2);
  next.emit('chat.visit', visit);
  session.recover();
  assert.deepEqual(next.last, { type: 'chat.send', value: initial });
  next.emit('chat.result', { messageId, status: 'published', publicationId });
  assert.equal(ledger.summary().steady.published, 1);
  assert.equal(ledger.summary().steady.retryAttempts, 1);
  assert.equal(session.unresolved, 1);
});

test('retry-later delay survives disconnect and a lost acceptance read does not cause a resend', () => {
  const { session, room, clock, ledger } = fixture();
  session.attach(room, sender);
  room.negotiate();
  room.emit('chat.visit', visit);
  const messageId = session.offer({ cohort: 'steady', index: 0 }, 'Hello');
  room.emit('chat.result', { messageId, status: 'retry_later', reasonCode: 'commit_unknown', retryAfterMs: 125 });
  const next = new FakeRoom();
  session.attach(next, sender);
  next.negotiate();
  next.emit('chat.visit', visit);
  clock.at = 124;
  session.recover();
  assert.equal(next.outbound.length, 1);
  clock.at = 125;
  session.recover();
  assert.deepEqual(next.last, { type: 'chat.resume', value: { messageIds: [messageId] } });
  next.emit('chat.result', { messageId, status: 'accepted' });
  next.emit('chat.resume', { results: [{ messageId, status: 'not_found' }] });
  session.recover();
  assert.equal(next.outbound.length, 2);
  clock.at += CHAT_CONFIRMATION_TIMEOUT_MS;
  session.recover();
  assert.equal(next.outbound.length, 3);
  assert.equal(next.last?.type, 'chat.resume');
  assert.equal(ledger.summary().steady.retryAttempts, 0);
  assert.equal(ledger.summary().steady.acceptedWithoutTerminal, 1);
});

test('large recovery batches are capped, exact and independent of response order', () => {
  const { session, room, clock } = fixture(51);
  session.attach(room, sender);
  room.negotiate();
  room.emit('chat.visit', visit);
  clock.at = 999;
  const ids = Array.from({ length: 51 }, (_, index) => session.offer({ cohort: 'steady', index }, `Synthetic message ${index}`));
  assert(ids.every(Boolean));
  const next = new FakeRoom();
  session.attach(next, sender);
  next.negotiate();
  session.recover();
  assert.deepEqual(next.last, { type: 'chat.resume', value: { messageIds: ids.slice(0, 50) } });
  const foreign = createChatMessageId(serverTimeMs);
  const unexpected = [...ids.slice(0, 49), foreign];
  assert.throws(() => next.emit('chat.resume', { results: unexpected.map(messageId => ({ messageId, status: 'accepted' })) }),
    /outstanding request/);
  next.emit('chat.resume', { results: ids.slice(0, 50).reverse().map(messageId => ({ messageId, status: 'accepted' })) });
  session.recover();
  assert.deepEqual(next.last, { type: 'chat.resume', value: { messageIds: ids.slice(50) } });
});

test('transport failures do not consume a planned first offer', () => {
  const { session, room, clock, ledger } = fixture();
  const slot = { cohort: 'steady', index: 0 } as const;
  session.attach(room, sender);
  room.negotiate();
  room.emit('chat.visit', visit);
  room.failSend = true;
  assert.throws(() => session.offer(slot, 'Hello'), /write failed/);
  assert.equal(ledger.summary().steady.offered, 0);
  room.failSend = false;
  clock.at = 1_000;
  assert.equal(session.offer(slot, 'Hello'), undefined);
  assert.equal(ledger.summary().steady.missed, 1);
  assert.equal(room.outbound.length, 1);
});
