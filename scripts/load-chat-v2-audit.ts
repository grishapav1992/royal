import { isChatLocation, type ChatLocation } from '../src/shared/chat';
import { CHAT_AUDIT_PAGE_SIZE, CHAT_AUDIT_SENDER_ID, type AuditAccount, type AuditObserver, type AuditReceipt,
  type AuditWitness, type ChatAuditSummary } from './load-chat-v2-audit-types';
import { ChatV2WorkloadPlan, type ChatV2WorkloadProfile } from './load-chat-v2-workload';
import { StandError } from './load-stand-contract';
import { BoundedSamples } from './load-websocket-diagnostics';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const maxWorkers = 32;
const workerClockToleranceMs = 2;
const maxDrainAndCollectionMs = 45_000;

function record(value: unknown, keys: readonly string[], code: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || !keys.every(key => Object.hasOwn(value, key))) throw new StandError(code);
  return value as Record<string, unknown>;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function boundedTime(value: unknown, endMs: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < endMs;
}

function route(value: Record<string, unknown>, code: string): { roomEpoch: string; location: ChatLocation } {
  const { roomEpoch, location } = value;
  if (typeof roomEpoch !== 'string' || !uuid.test(roomEpoch) || typeof location !== 'string' || !isChatLocation(location)) {
    throw new StandError(code);
  }
  return { roomEpoch, location };
}

type Publication = { accountIndex: number; observerIndex: number; publicationSeq: number | null; offeredAtMs: number; witnessed: boolean };

/** Correlates private IPC evidence from one dedicated generator parent. Only aggregate counters leave this parent. */
export class ChatPublicationAudit {
  private readonly accounts: AuditAccount[];
  private readonly observersByShard: AuditObserver[][];
  private readonly observerByAccount: number[];
  private readonly publicationLimits: number[];
  private readonly receiptsByShard: number[];
  private readonly publications = new Map<string, Publication>();
  private readonly delivery = new BoundedSamples();
  private readonly totalLimit: number;
  private readonly sendEndMs: number;
  private receiptsSeen = 0;
  private witnessesSeen = 0;
  private eligible = 0;
  private unmatched = 0;
  private mismatched = 0;
  private changedVisits = 0;
  private phase: 'receipts' | 'witnesses' | 'finished' = 'receipts';

  constructor(rosters: readonly unknown[], profile: ChatV2WorkloadProfile) {
    if (!Array.isArray(rosters)) throw new StandError('invalid-chat-audit-roster-count');
    const shards = rosters.length;
    if (!integer(shards, 1, Math.min(maxWorkers, profile.clients))) throw new StandError('invalid-chat-audit-roster-count');
    const plans = Array.from({ length: shards }, (_, index) => new ChatV2WorkloadPlan(profile, { index, count: shards }));
    this.publicationLimits = plans.map(plan => plan.planned.steady + plan.planned.burst);
    this.totalLimit = this.publicationLimits.reduce((sum, count) => sum + count, 0);
    this.sendEndMs = profile.seconds * 1_000;
    this.accounts = Array<AuditAccount>(profile.clients);
    this.observersByShard = Array.from({ length: shards }, () => []);
    this.observerByAccount = Array<number>(profile.clients).fill(-1);
    this.receiptsByShard = Array<number>(shards).fill(0);
    const roomSessions = new Set<string>();
    for (const [shard, roster] of rosters.entries()) {
      const code = 'invalid-chat-audit-roster';
      if (!Array.isArray(roster) || roster.length !== plans[shard].clientsInShard) throw new StandError(code);
      for (const row of roster) {
        const item = record(row, ['accountIndex', 'senderId', 'roomEpoch', 'location'], code);
        const { accountIndex, senderId } = item, channel = route(item, code);
        if (!this.validAccount(accountIndex, shard) || this.accounts[accountIndex] || typeof senderId !== 'string' || !CHAT_AUDIT_SENDER_ID.test(senderId)) {
          throw new StandError(code);
        }
        const socket = channel.roomEpoch + ':' + senderId;
        if (roomSessions.has(socket)) throw new StandError(code);
        roomSessions.add(socket);
        this.accounts[accountIndex] = { accountIndex, senderId, ...channel };
      }
    }
    this.assignObservers();
  }

  observers(shard: number): AuditObserver[] {
    this.requireShard(shard);
    return this.observersByShard[shard].map(observer => ({ ...observer }));
  }

  receipts(shard: number, rows: readonly unknown[]) {
    this.requireShard(shard);
    if (this.phase !== 'receipts') throw new StandError('invalid-chat-audit-phase');
    const code = 'invalid-chat-audit-receipts';
    if (!Array.isArray(rows) || rows.length > CHAT_AUDIT_PAGE_SIZE
      || this.receiptsByShard[shard] + rows.length > this.publicationLimits[shard]) throw new StandError(code);
    const receipts = Array.from(rows, raw => this.receipt(raw, shard, code));
    this.receiptsByShard[shard] += receipts.length;
    this.receiptsSeen += receipts.length;
    for (const row of receipts) {
      if (this.publications.has(row.publicationId)) continue;
      const sender = this.accounts[row.accountIndex];
      const changed = sender.roomEpoch !== row.roomEpoch || sender.location !== row.location;
      const observerIndex = changed ? -1 : this.observerByAccount[row.accountIndex];
      if (changed) this.changedVisits++;
      if (observerIndex >= 0) this.eligible++;
      this.publications.set(row.publicationId, { accountIndex: row.accountIndex, observerIndex,
        publicationSeq: row.publicationSeq, offeredAtMs: row.offeredAtMs, witnessed: false });
    }
  }

  witnesses(shard: number, rows: readonly unknown[]) {
    this.requireShard(shard);
    if (this.phase === 'finished') throw new StandError('invalid-chat-audit-phase');
    const code = 'invalid-chat-audit-witnesses';
    if (!Array.isArray(rows) || rows.length > CHAT_AUDIT_PAGE_SIZE || this.witnessesSeen + rows.length > this.totalLimit) throw new StandError(code);
    const witnesses = Array.from(rows, raw => this.witness(raw, shard, code));
    this.phase = 'witnesses';
    this.witnessesSeen += witnesses.length;
    for (const row of witnesses) {
      const publication = this.publications.get(row.publicationId);
      if (!publication) { this.unmatched++; continue; }
      const sender = this.accounts[publication.accountIndex];
      const elapsedMs = row.atMs - publication.offeredAtMs;
      if (publication.witnessed || publication.observerIndex !== row.accountIndex || sender.senderId !== row.senderId
        || sender.roomEpoch !== row.roomEpoch || sender.location !== row.location || publication.publicationSeq !== row.publicationSeq
        || elapsedMs < -workerClockToleranceMs) {
        this.mismatched++;
        continue;
      }
      publication.witnessed = true;
      this.delivery.add(Math.max(0, elapsedMs));
    }
  }

  finish(expectedPublishedByShard: readonly number[]): ChatAuditSummary {
    if (this.phase === 'finished') throw new StandError('invalid-chat-audit-phase');
    if (!Array.isArray(expectedPublishedByShard) || expectedPublishedByShard.length !== this.receiptsByShard.length
      || !this.receiptsByShard.every((count, index) => count === expectedPublishedByShard[index])) {
      throw new StandError('chat-audit-publication-count-mismatch');
    }
    this.phase = 'finished';
    const uniquePublications = this.publications.size, delivery = this.delivery.summary();
    this.publications.clear();
    return {
      receipts: this.receiptsSeen, uniquePublications, duplicatePublications: this.receiptsSeen - uniquePublications,
      eligiblePublications: this.eligible, ineligiblePublications: uniquePublications - this.eligible - this.changedVisits,
      witnessedPublications: delivery.count, unmatchedWitnesses: this.unmatched, mismatchedWitnesses: this.mismatched,
      changedVisits: this.changedVisits, peerDeliveryP95Ms: delivery.count ? delivery.p95 : null,
    };
  }

  private assignObservers() {
    const groups = new Map<string, AuditAccount[]>();
    for (const account of this.accounts) {
      const key = account.roomEpoch + ':' + account.location;
      const group = groups.get(key) ?? [];
      group.push(account);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [first, second] = group;
      const shards = this.observersByShard.length;
      this.observersByShard[first.accountIndex % shards].push({ accountIndex: first.accountIndex });
      this.observersByShard[second.accountIndex % shards].push({ accountIndex: second.accountIndex, senderId: first.senderId });
      for (const account of group) {
        this.observerByAccount[account.accountIndex] = account === first ? second.accountIndex : first.accountIndex;
      }
    }
  }

  private requireShard(shard: number) {
    if (!integer(shard, 0, this.observersByShard.length - 1)) throw new StandError('invalid-chat-audit-shard');
  }

  private validAccount(index: unknown, shard: number): index is number {
    return integer(index, 0, this.accounts.length - 1) && index % this.observersByShard.length === shard;
  }

  private receipt(raw: unknown, shard: number, code: string): AuditReceipt {
    const item = record(raw, ['publicationId', 'accountIndex', 'roomEpoch', 'location', 'publicationSeq', 'offeredAtMs'], code);
    const { publicationId, accountIndex, publicationSeq, offeredAtMs } = item;
    if (typeof publicationId !== 'string' || !uuid.test(publicationId) || !this.validAccount(accountIndex, shard)
      || (publicationSeq !== null && !integer(publicationSeq, 1)) || !boundedTime(offeredAtMs, this.sendEndMs)) throw new StandError(code);
    return { publicationId, accountIndex, publicationSeq, offeredAtMs, ...route(item, code) };
  }

  private witness(raw: unknown, shard: number, code: string): AuditWitness {
    const item = record(raw, ['publicationId', 'accountIndex', 'senderId', 'roomEpoch', 'location', 'publicationSeq', 'atMs'], code);
    const { publicationId, accountIndex, senderId, publicationSeq, atMs } = item;
    if (typeof publicationId !== 'string' || !uuid.test(publicationId) || !this.validAccount(accountIndex, shard)
      || typeof senderId !== 'string' || !CHAT_AUDIT_SENDER_ID.test(senderId) || !integer(publicationSeq, 1)
      || !boundedTime(atMs, this.sendEndMs + maxDrainAndCollectionMs)) throw new StandError(code);
    return { publicationId, accountIndex, senderId, publicationSeq, atMs, ...route(item, code) };
  }
}
