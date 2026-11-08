import assert from 'node:assert/strict';
import { CHAT_CONFIRMATION_TIMEOUT_MS, CHAT_V2_RESUME_LIMIT, ROOM_CHAT_PROTOCOL, ROOM_CHAT_PROTOCOL_V2,
  chatV2FirstAdmissionAge, createChatMessageId, parseChatV2Batch, parseChatV2Ready, parseChatV2Result,
  parseChatV2ResumeResponse, parseChatV2Send, parseChatV2Visit, type ChatV2ClientPackets, type ChatV2ResumeResult,
  type ChatV2Result, type ChatV2Send, type ChatV2ServerPackets, type ChatV2Visit } from '../src/shared/chat';
import type { ChatV2WorkloadLedger, ChatV2WorkloadSlot } from './load-chat-v2-workload';
import type { AuditAccount, AuditWitness } from './load-chat-v2-audit-types';

type Outbound = Pick<ChatV2ClientPackets, 'chat.send' | 'chat.resume'> & {
  history: { version: typeof ROOM_CHAT_PROTOCOL; offerVersion: typeof ROOM_CHAT_PROTOCOL_V2 };
};

/** The relevant subset of an SDK Room. As on a WebSocket, inbound messages arrive outside send(). */
export type LoadChatV2Transport = {
  readonly connection: { readonly isOpen: boolean };
  send<K extends keyof Outbound>(type: K, value: Outbound[K]): void;
  onMessage(type: keyof ChatV2ServerPackets, handler: (value: unknown) => void): () => void;
};

type Pending = {
  envelope: ChatV2Send;
  accepted: boolean;
  retryNotBeforeMs: number;
  checkAtMs: number;
  missing: boolean;
};
type Connection = {
  transport: LoadChatV2Transport;
  senderId: string;
  unbind: (() => void)[];
  clock?: { serverTimeMs: number; receivedAtMs: number };
  visit?: ChatV2Visit | null;
  resume?: Set<string>;
};

/** One authenticated synthetic account. The caller owns the socket, reconnection, deadlines and recovery ticks. */
export class LoadChatV2Session {
  private connection?: Connection;
  private peerObserver?: { senderId?: string; observe: (witness: AuditWitness) => void };
  private readonly pending = new Map<string, Pending>();
  private readonly lastOffered = { steady: -1, burst: -1 };

  constructor(private readonly accountIndex: number, private readonly ledger: ChatV2WorkloadLedger,
    private readonly now: () => number, private readonly monotonicNow = now) {}

  get ready() {
    return Boolean(this.connection?.transport.connection.isOpen && this.connection.clock);
  }

  get visitReady() { return this.ready && Boolean(this.connection?.visit); }

  get unresolved() { return this.pending.size; }

  get auditAccount(): AuditAccount | undefined {
    const connection = this.connection, visit = connection?.visit;
    if (!connection || !this.ready || !visit) return;
    return { accountIndex: this.accountIndex, senderId: connection.senderId, roomEpoch: visit.roomEpoch, location: visit.location };
  }

  observePeers(senderId: string | undefined, observe: (witness: AuditWitness) => void) {
    this.peerObserver = { senderId, observe };
  }

  attach(transport: LoadChatV2Transport, senderId: string) {
    assert(transport.connection.isOpen && senderId, 'Chat V2 requires an open socket and its authenticated sender identity');
    this.detach();
    const connection: Connection = { transport, senderId, unbind: [] };
    this.connection = connection;
    const listen = (type: keyof ChatV2ServerPackets, handle: (value: unknown) => void) => {
      connection.unbind.push(transport.onMessage(type, value => {
        if (this.connection === connection && transport.connection.isOpen) handle(value);
      }));
    };
    try {
      listen('chat.ready', value => {
        const ready = parseChatV2Ready(value);
        assert(ready, 'Invalid V2 ready packet');
        connection.clock ??= { serverTimeMs: ready.serverTimeMs, receivedAtMs: this.monotonicNow() };
      });
      listen('chat.visit', value => {
        if (!connection.clock) return;
        const visit = parseChatV2Visit(value);
        assert(visit !== undefined, 'Invalid V2 visit packet');
        connection.visit = visit;
      });
      listen('chat.result', value => {
        if (!connection.clock) return;
        const result = parseChatV2Result(value);
        assert(result, 'Invalid V2 result packet');
        this.observeResult(result, this.now());
      });
      listen('chat.resume', value => {
        if (!connection.clock) return;
        const response = parseChatV2ResumeResponse(value), requested = connection.resume;
        assert(requested && response?.results.length === requested.size && response.results.every(row => requested.has(row.messageId)),
          'V2 resume response does not match the outstanding request');
        connection.resume = undefined;
        const atMs = this.now();
        for (const result of response.results) this.observeResult(result, atMs);
      });
      listen('chat.batch', value => {
        if (!connection.clock) return;
        const batch = parseChatV2Batch(value), visit = connection.visit;
        assert(batch, 'Invalid V2 chat batch');
        if (!visit || batch.roomEpoch !== visit.roomEpoch || batch.visitId !== visit.visitId) return;
        assert(batch.fromCursor >= visit.initialCursor, 'V2 chat batch starts before the active visit');
        const atMs = this.now();
        for (const message of batch.messages) {
          if (message.system) continue;
          if (message.senderId === connection.senderId) this.ledger.observePublication(this.accountIndex, batch, message, atMs);
          else if (this.peerObserver && (this.peerObserver.senderId === undefined || message.senderId === this.peerObserver.senderId)) {
            this.peerObserver.observe({ publicationId: message.publicationId, accountIndex: this.accountIndex, senderId: message.senderId,
              roomEpoch: visit.roomEpoch, location: visit.location, publicationSeq: message.publicationSeq, atMs });
          }
        }
      });
      transport.send('history', { version: ROOM_CHAT_PROTOCOL, offerVersion: ROOM_CHAT_PROTOCOL_V2 });
    } catch (error) {
      this.detach();
      throw error;
    }
  }

  detach() {
    const connection = this.connection;
    if (!connection) return;
    this.connection = undefined;
    for (const unbind of connection.unbind) unbind();
    for (const row of this.pending.values()) {
      row.missing = false;
      row.checkAtMs = row.retryNotBeforeMs;
    }
  }

  offer(slot: Pick<ChatV2WorkloadSlot, 'cohort' | 'index'>, text: string): string | undefined {
    const { cohort, index, accountIndex, dueAtMs, offerBeforeMs } = this.ledger.plan.slot(slot.cohort, slot.index);
    assert(accountIndex === this.accountIndex && index > this.lastOffered[cohort], 'Invalid slot order for this V2 sender');
    const connection = this.connection, visit = connection?.visit;
    if (!connection?.transport.connection.isOpen || !connection.clock || !visit) return;
    const preparingAtMs = this.now();
    if (!(preparingAtMs >= dueAtMs && preparingAtMs < offerBeforeMs)) return;
    const messageId = createChatMessageId(this.serverNow(connection.clock));
    const parsed = parseChatV2Send({ messageId, text, roomEpoch: visit.roomEpoch, visitId: visit.visitId });
    assert(parsed.ok, 'Invalid synthetic V2 chat text');
    const atMs = this.now();
    if (!(atMs >= dueAtMs && atMs < offerBeforeMs)) return;
    connection.transport.send('chat.send', parsed.value);
    this.ledger.offer(cohort, index, parsed.value, atMs, visit.location);
    this.lastOffered[cohort] = index;
    this.pending.set(messageId, { envelope: parsed.value, accepted: false, retryNotBeforeMs: atMs,
      checkAtMs: atMs + CHAT_CONFIRMATION_TIMEOUT_MS, missing: false });
    return messageId;
  }

  /** Perform one bounded recovery step. At most one status request can await a reply on each socket. */
  recover() {
    const connection = this.connection;
    if (!connection?.transport.connection.isOpen || !connection.clock) return;
    const atMs = this.now();
    const serverTimeMs = this.serverNow(connection.clock);
    let resent = 0;
    const messageIds: string[] = [];
    for (const [messageId, row] of this.pending) {
      if (connection.resume?.has(messageId)) continue;
      const { envelope } = row;
      if (row.missing && atMs >= row.retryNotBeforeMs && connection.visit?.roomEpoch === envelope.roomEpoch
        && connection.visit.visitId === envelope.visitId && chatV2FirstAdmissionAge(messageId, serverTimeMs) === 'valid') {
        if (resent >= CHAT_V2_RESUME_LIMIT) continue;
        connection.transport.send('chat.send', envelope);
        this.ledger.retry(this.accountIndex, envelope, atMs);
        row.missing = false;
        row.checkAtMs = atMs + CHAT_CONFIRMATION_TIMEOUT_MS;
        resent++;
      } else if (atMs >= row.checkAtMs && !connection.resume && messageIds.length < CHAT_V2_RESUME_LIMIT) {
        messageIds.push(messageId);
      }
    }
    if (!messageIds.length) return;
    connection.resume = new Set(messageIds);
    try { connection.transport.send('chat.resume', { messageIds }); }
    catch (error) { connection.resume = undefined; throw error; }
  }

  private serverNow(clock: NonNullable<Connection['clock']>) {
    return clock.serverTimeMs + Math.max(0, Math.floor(this.monotonicNow() - clock.receivedAtMs));
  }

  private observeResult(result: ChatV2Result | ChatV2ResumeResult, atMs: number) {
    this.ledger.observeResult(this.accountIndex, result, atMs);
    const row = this.pending.get(result.messageId);
    if (!row) return;
    switch (result.status) {
      case 'accepted':
        row.accepted = true;
        row.missing = false;
        row.checkAtMs = Math.max(row.retryNotBeforeMs, atMs + CHAT_CONFIRMATION_TIMEOUT_MS);
        break;
      case 'retry_later':
        row.missing = false;
        row.retryNotBeforeMs = Math.max(row.retryNotBeforeMs, atMs + result.retryAfterMs);
        row.checkAtMs = row.retryNotBeforeMs;
        break;
      case 'not_found':
        row.missing = !row.accepted;
        row.checkAtMs = Math.max(row.retryNotBeforeMs, atMs + CHAT_CONFIRMATION_TIMEOUT_MS);
        break;
      default:
        this.pending.delete(result.messageId);
    }
  }
}
