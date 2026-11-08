import assert from 'node:assert/strict';
import { parseChatV2Send, type ChatV2Batch, type ChatV2Publication, type ChatV2Result,
  type ChatV2ResumeResult, type ChatV2Send } from '../src/shared/chat';
import { MAX_MEASUREMENT_SECONDS } from './load-stand-limits';
import { BoundedSamples } from './load-websocket-diagnostics';

export type ChatV2WorkloadProfile = Readonly<{
  clients: number;
  seconds: number;
  steadyPerSecond: number;
  movingClients?: number;
  burst?: Readonly<{ count: number; atSecond: number }>;
}>;
type Cohort = 'steady' | 'burst';
type Shard = Readonly<{ index: number; count: number }>;
export type ChatV2WorkloadSlot = Readonly<{
  cohort: Cohort;
  index: number;
  accountIndex: number;
  dueAtMs: number;
  offerBeforeMs: number;
}>;

const isInteger = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
const burstFrameMs = 20;

/** Millisecond offsets are relative to one common measurement start, including across shards. */
export class ChatV2WorkloadPlan {
  readonly profile: ChatV2WorkloadProfile;
  readonly shard: Shard;
  readonly clientsInShard: number;
  readonly movingClients: number;
  readonly planned: Readonly<Record<Cohort, number>>;
  private readonly totals: Readonly<Record<Cohort, number>>;

  constructor(profile: ChatV2WorkloadProfile, shard: Shard = { index: 0, count: 1 }) {
    const { clients, seconds, steadyPerSecond, movingClients, burst } = profile;
    if (!isInteger(clients, 1, 10_000) || !isInteger(seconds, 1, MAX_MEASUREMENT_SECONDS)
      || !isInteger(steadyPerSecond, 0, 333) || (!steadyPerSecond && !burst)
      || (movingClients !== undefined && !isInteger(movingClients, 0, clients))
      || (burst && (!isInteger(burst.count, 1, clients) || !isInteger(burst.atSecond, 0, seconds - 1)))
      || !isInteger(shard.count, 1, clients) || !isInteger(shard.index, 0, shard.count - 1)) {
      throw new RangeError('Invalid V2 workload profile or shard');
    }
    this.profile = { clients, seconds, steadyPerSecond, ...(movingClients === undefined ? {} : { movingClients }), burst: burst && { ...burst } };
    this.shard = { ...shard };
    const steady = seconds * steadyPerSecond;
    this.totals = { steady, burst: burst?.count ?? 0 };
    const shardSize = (accounts: number) => Math.floor((accounts + shard.count - 1 - shard.index) / shard.count);
    this.clientsInShard = shardSize(clients);
    this.movingClients = shardSize(movingClients ?? clients);
    this.planned = { steady: Math.floor(steady / clients) * this.clientsInShard + shardSize(steady % clients),
      burst: shardSize(this.totals.burst) };
  }

  moves(accountIndex: number) {
    const cutoff = this.profile.movingClients ?? this.profile.clients;
    return isInteger(accountIndex, 0, cutoff - 1) && accountIndex % this.shard.count === this.shard.index;
  }

  slot(cohort: Cohort, index: number): ChatV2WorkloadSlot {
    const { clients, steadyPerSecond, burst } = this.profile;
    const accountIndex = index % clients;
    assert(isInteger(index, 0, this.totals[cohort] - 1) && accountIndex % this.shard.count === this.shard.index,
      'Slot does not belong to this workload shard');
    if (cohort === 'burst') {
      assert(burst);
      const frame = Math.floor(index * 1_000 / (burst.count * burstFrameMs));
      return { cohort, index, accountIndex, dueAtMs: burst.atSecond * 1_000 + frame * burstFrameMs,
        offerBeforeMs: (burst.atSecond + 1) * 1_000 };
    }
    return { cohort, index, accountIndex, dueAtMs: index * 1_000 / steadyPerSecond,
      offerBeforeMs: (Math.floor(index / steadyPerSecond) + 1) * 1_000 };
  }

  *slots(): Generator<ChatV2WorkloadSlot, void> {
    const steady = this.slotsFor('steady'), burst = this.slotsFor('burst');
    let nextSteady = steady.next(), nextBurst = burst.next();
    while (!nextSteady.done || !nextBurst.done) {
      if (!nextSteady.done && (nextBurst.done || nextSteady.value.dueAtMs <= nextBurst.value.dueAtMs)) {
        yield nextSteady.value;
        nextSteady = steady.next();
      } else if (!nextBurst.done) {
        yield nextBurst.value;
        nextBurst = burst.next();
      }
    }
  }

  private *slotsFor(cohort: Cohort): Generator<ChatV2WorkloadSlot, void> {
    const { clients } = this.profile, { index, count } = this.shard;
    for (let start = 0; start < this.totals[cohort]; start += clients) {
      for (let ordinal = start + index; ordinal < Math.min(start + clients, this.totals[cohort]); ordinal += count) {
        yield this.slot(cohort, ordinal);
      }
    }
  }
}

type Terminal = Exclude<ChatV2Result, { status: 'accepted' | 'retry_later' | 'id_conflict' }>;
type Result = ChatV2Result | ChatV2ResumeResult;
type Entry = {
  cohort: Cohort;
  accountIndex: number;
  envelope: ChatV2Send;
  offeredAtMs: number;
  offerLagMs: number;
  retries: number;
  firstResponse?: Result['status'];
  deferred: boolean;
  resumeMiss: boolean;
  acknowledgedAtMs?: number;
  terminal?: { result: Terminal; atMs: number };
};
type Witness = { accountIndex: number; roomEpoch: string; publicationSeq: number; atMs: number };
type Publication = { entry?: Entry; witness?: Witness };

const sameEnvelope = (a: ChatV2Send, b: ChatV2Send) => a.messageId === b.messageId && a.text === b.text
  && a.roomEpoch === b.roomEpoch && a.visitId === b.visitId;
const terminalKey = (result: Terminal) => result.status === 'published' ? result.publicationId : result.reasonCode;

/** Per-shard observations. Callers provide authenticated sender indices and parsed protocol events. */
export class ChatV2WorkloadLedger {
  private readonly entries = new Map<string, Entry>();
  private readonly offeredSlots = { steady: new Set<number>(), burst: new Set<number>() };
  private readonly publications = new Map<string, Publication>();

  constructor(readonly plan: ChatV2WorkloadPlan) {}

  offer(cohort: Cohort, index: number, envelope: ChatV2Send, atMs: number) {
    const slot = this.plan.slot(cohort, index);
    const parsed = parseChatV2Send(envelope);
    assert(parsed.ok && sameEnvelope(parsed.value, envelope), 'Expected a canonical V2 send');
    assert(atMs >= slot.dueAtMs && atMs < slot.offerBeforeMs, 'Send is outside its planned offer window');
    assert(!this.entries.has(envelope.messageId) && !this.offeredSlots[cohort].has(index), 'Duplicate first send or schedule slot');
    this.offeredSlots[cohort].add(index);
    this.entries.set(envelope.messageId, { cohort, accountIndex: slot.accountIndex, envelope: parsed.value,
      offeredAtMs: atMs, offerLagMs: atMs - slot.dueAtMs, retries: 0, deferred: false, resumeMiss: false });
  }

  retry(accountIndex: number, envelope: ChatV2Send, atMs: number) {
    const entry = this.entry(accountIndex, envelope.messageId, atMs);
    assert(sameEnvelope(entry.envelope, envelope), 'Retry changed the original V2 envelope');
    entry.retries++;
  }

  observeResult(accountIndex: number, result: Result, atMs: number) {
    const entry = this.entry(accountIndex, result.messageId, atMs);
    assert(result.status !== 'id_conflict', 'The server reported an ID conflict for a canonical send');
    if (result.status === 'retry_later') entry.deferred = true;
    else if (result.status === 'not_found') entry.resumeMiss = true;
    else if (result.status === 'accepted') {
      assert(entry.terminal?.result.status !== 'expired', 'An accepted send also expired');
      entry.acknowledgedAtMs ??= atMs;
    } else {
      assert(result.status !== 'expired' || entry.acknowledgedAtMs === undefined, 'An accepted send also expired');
      const previous = entry.terminal?.result;
      assert(!previous || (previous.status === result.status && terminalKey(previous) === terminalKey(result)),
        'Conflicting terminal V2 results');
      if (result.status === 'published') {
        const publication = this.publication(result.publicationId);
        assert(!publication.entry || publication.entry === entry, 'A publication was assigned to multiple sends');
        if (publication.witness) this.verifyWitness(entry, publication.witness);
        publication.entry = entry;
      }
      entry.terminal ??= { result: { ...result }, atMs };
    }
    entry.firstResponse ??= result.status;
  }

  /** Record a sender's own publication on its socket. Filter to that sender before calling. History may repeat the same ID. */
  observePublication(accountIndex: number, batch: Pick<ChatV2Batch, 'roomEpoch'>,
    message: Pick<ChatV2Publication, 'publicationId' | 'publicationSeq'>, atMs: number) {
    const { clients } = this.plan.profile, shard = this.plan.shard;
    assert(isInteger(accountIndex, 0, clients - 1) && accountIndex % shard.count === shard.index
      && Number.isFinite(atMs) && atMs >= 0, 'Invalid V2 publication observation');
    const publication = this.publication(message.publicationId);
    const witness = { accountIndex, roomEpoch: batch.roomEpoch, publicationSeq: message.publicationSeq, atMs };
    if (publication.entry) this.verifyWitness(publication.entry, witness);
    const previous = publication.witness;
    assert(!previous || (previous.accountIndex === accountIndex && previous.roomEpoch === batch.roomEpoch
      && previous.publicationSeq === message.publicationSeq), 'Conflicting V2 publication observations');
    if (!previous || atMs < previous.atMs) publication.witness = witness;
  }

  summary() {
    let unmatchedPublications = 0;
    for (const publication of this.publications.values()) unmatchedPublications += Number(!publication.entry);
    return { steady: this.summarize('steady'), burst: this.summarize('burst'), unmatchedPublications };
  }

  private summarize(cohort: Cohort) {
    const planned = this.plan.planned[cohort], offered = this.offeredSlots[cohort].size;
    const counts = { retryAttempts: 0, firstResponseRetryLater: 0, deferred: 0, resumeMiss: 0, unanswered: 0,
      acknowledgements: 0, acceptanceConfirmed: 0, acceptedWithoutTerminal: 0, unresolved: 0,
      published: 0, rejected: 0, cancelled: 0, expired: 0, terminalByDeadline: 0, witnessed: 0 };
    const offerLag = new BoundedSamples(), acknowledgement = new BoundedSamples(), delivery = new BoundedSamples();
    const { seconds, burst } = this.plan.profile;
    const deadline = (cohort === 'burst' && burst ? burst.atSecond + 1 : seconds) * 1_000 + 5_000;
    for (const entry of this.entries.values()) {
      if (entry.cohort !== cohort) continue;
      offerLag.add(entry.offerLagMs);
      counts.retryAttempts += entry.retries;
      counts.firstResponseRetryLater += Number(entry.firstResponse === 'retry_later');
      counts.deferred += Number(entry.deferred);
      counts.resumeMiss += Number(entry.resumeMiss);
      counts.unanswered += Number(entry.firstResponse === undefined);
      if (entry.acknowledgedAtMs !== undefined) {
        counts.acknowledgements++;
        acknowledgement.add(entry.acknowledgedAtMs - entry.offeredAtMs);
      }
      const terminal = entry.terminal;
      counts.acceptanceConfirmed += Number(entry.acknowledgedAtMs !== undefined || terminal?.result.status === 'published');
      if (!terminal) {
        counts.unresolved++;
        counts.acceptedWithoutTerminal += Number(entry.acknowledgedAtMs !== undefined);
        continue;
      }
      counts[terminal.result.status]++;
      counts.terminalByDeadline += Number(terminal.atMs <= deadline);
      if (terminal.result.status === 'published') {
        const witness = this.publications.get(terminal.result.publicationId)?.witness;
        if (witness) { counts.witnessed++; delivery.add(witness.atMs - entry.offeredAtMs); }
      }
    }
    return { planned, offered, missed: planned - offered, ...counts, offerLag: offerLag.summary(),
      acknowledgement: acknowledgement.summary(), delivery: delivery.summary() };
  }

  private entry(accountIndex: number, messageId: string, atMs: number) {
    const entry = this.entries.get(messageId);
    assert(entry && entry.accountIndex === accountIndex && Number.isFinite(atMs) && atMs >= entry.offeredAtMs,
      'V2 observation does not match an offered send');
    return entry;
  }

  private publication(publicationId: string) {
    const existing = this.publications.get(publicationId);
    if (existing) return existing;
    assert(this.publications.size < this.plan.planned.steady + this.plan.planned.burst, 'Too many publication IDs');
    const publication: Publication = {};
    this.publications.set(publicationId, publication);
    return publication;
  }

  private verifyWitness(entry: Entry, witness: Witness) {
    assert(entry.accountIndex === witness.accountIndex && entry.envelope.roomEpoch === witness.roomEpoch
      && witness.atMs >= entry.offeredAtMs, 'V2 publication does not match its original send');
  }
}
