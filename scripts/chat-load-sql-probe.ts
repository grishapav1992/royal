import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createChatMessageId } from '../src/shared/chat';
import { startLocalChatLoadStand } from './chat-load-stand';
import { ChatSqlProbe, chatSqlQuotaPartition, type SqlProbeAdmission, type SqlProbeRequest, type SqlProbeTiming } from './chat-load-sql-store';
import { BoundedSamples } from './load-websocket-diagnostics';
import { CHAT_SQL_PREFILL_MAX_REQUESTS } from './chat-load-sql-prefill';

const admissionBatchLimit = 128;
const workerBatchLimit = 64;
const accountCount = 10_000;
const roomCapacity = 30;
const burstFrameMs = 20;
const drainMs = 5_000;
const outputName = 'local-chat-sql-probe.json';
const identitySeed = 'royal-chat-sql-fixture-v1';

type Options = {
  directory: string;
  seconds: number;
  rate: number;
  burst: number;
  burstAt: number;
  admissionWorkers: number;
  workers: number;
  quotaPartitions: number;
  prefill: number;
};
type Slot = { cohort: 'steady' | 'burst'; dueAt: number; offerBefore: number; accountIndex: number; originSeq: number };
type Identity = { accountId: string; messageId: string };
type Observation = Slot & {
  accountId: string;
  offeredAt: number;
  admission?: SqlProbeAdmission['status'];
  acknowledgedAt?: number;
  result?: 'published' | 'rejected';
  finishedAt?: number;
};

function int(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  const number = value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
  assert(Number.isSafeInteger(number) && number >= min && number <= max, `Invalid --${name} value`);
  return number;
}

function fixtureId(kind: 'account' | 'room', index: number) {
  const hex = createHash('sha256').update(`${identitySeed}:${kind}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readOptions(): Options {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { seconds: { type: 'string' }, rate: { type: 'string' }, burst: { type: 'string' },
      'burst-at': { type: 'string' }, 'admission-workers': { type: 'string' }, workers: { type: 'string' },
      'quota-partitions': { type: 'string' }, prefill: { type: 'string' } },
  });
  assert.equal(positionals.length, 1,
    'Usage: node --import tsx scripts/chat-load-sql-probe.ts <owned-artifact-directory> [--seconds 3 --rate 40 --burst 0 --burst-at 1 --prefill 0 --quota-partitions 1]');
  // The one-host experiment is deliberately shorter than the target 30-minute run.
  const seconds = int(values.seconds, 3, 1, 120, 'seconds');
  const admissionWorkers = int(values['admission-workers'], 4, 1, 8, 'admission-workers');
  const workers = int(values.workers, 4, 1, 8, 'workers');
  const quotaPartitions = int(values['quota-partitions'], 1, 1, 8, 'quota-partitions');
  assert([1, 2, 4, 8].includes(quotaPartitions) && admissionWorkers % quotaPartitions === 0 && workers % quotaPartitions === 0,
    'Quota partitions must divide both worker counts evenly');
  return {
    directory: resolve(positionals[0]), seconds, rate: int(values.rate, 40, 1, 333, 'rate'),
    burst: int(values.burst, 0, 0, 10_000, 'burst'),
    burstAt: int(values['burst-at'], Math.min(1, seconds - 1), 0, seconds - 1, 'burst-at'),
    admissionWorkers, workers, quotaPartitions,
    prefill: int(values.prefill, 0, 0, CHAT_SQL_PREFILL_MAX_REQUESTS, 'prefill'),
  };
}

function* arrivals(options: Options, startedAt: number): Generator<Slot, void> {
  const burstStart = startedAt + options.burstAt * 1_000;
  let steady = 0, burst = 0, originSeq = 0;
  while (steady < options.rate * options.seconds || burst < options.burst) {
    const steadyAt = steady < options.rate * options.seconds ? startedAt + steady * 1_000 / options.rate : Infinity;
    // Emit the burst in frames. A one-second profile cannot depend on the
    // scheduler waking up for its last arrival a fraction of a millisecond before the cutoff.
    const burstAt = burst < options.burst
      ? burstStart + Math.floor(burst * 1_000 / (options.burst * burstFrameMs)) * burstFrameMs : Infinity;
    if (steadyAt <= burstAt) {
      const index = steady++;
      yield { cohort: 'steady', dueAt: steadyAt, offerBefore: startedAt + (Math.floor(index / options.rate) + 1) * 1_000,
        accountIndex: index % accountCount, originSeq: ++originSeq };
    } else {
      yield { cohort: 'burst', dueAt: burstAt, offerBefore: burstStart + 1_000,
        accountIndex: burst++, originSeq: ++originSeq };
    }
  }
}

function matchResults<T extends Identity>(sent: readonly Identity[], results: readonly T[], apply: (result: T) => void) {
  const expected = new Map(sent.map(({ accountId, messageId }) => [messageId, accountId]));
  assert.equal(expected.size, sent.length, 'Repeated ID in one probe batch');
  assert.equal(results.length, expected.size, 'Probe batch result count differs from its input');
  for (const result of results) {
    assert(expected.has(result.messageId) && result.accountId === expected.get(result.messageId),
      'Unexpected probe result identity');
    expected.delete(result.messageId);
    apply(result);
  }
}

function percentiles(samples: number[]) {
  samples.sort((a, b) => a - b);
  const p = (percentile: number) => samples.length ? samples[Math.ceil(samples.length * percentile) - 1] : null;
  return { samples: samples.length, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: p(1) };
}

function summarize(rows: readonly Observation[], planned: number, deadline: number) {
  const counts = { accepted: 0, duplicate: 0, id_conflict: 0, busy: 0, expired: 0, unacknowledged: 0,
    published: 0, rejected: 0, pending: 0, finishedByDeadline: 0 };
  const offerLag: number[] = [], acknowledgement: number[] = [], result: number[] = [];
  for (const row of rows) {
    offerLag.push(row.offeredAt - row.dueAt);
    counts[row.admission ?? 'unacknowledged']++;
    if (row.acknowledgedAt !== undefined) acknowledgement.push(row.acknowledgedAt - row.offeredAt);
    if (row.finishedAt !== undefined && row.result) {
      counts[row.result]++;
      counts.finishedByDeadline += Number(row.finishedAt <= deadline);
      result.push(row.finishedAt - row.offeredAt);
    } else if (row.admission === 'accepted') counts.pending++;
  }
  return { planned, offered: rows.length, missed: planned - rows.length, ...counts,
    offerLag: percentiles(offerLag), acknowledgement: percentiles(acknowledgement), result: percentiles(result) };
}

function walBytes(start: string, end: string) {
  const lsn = (value: string) => {
    assert.match(value, /^[\dA-F]+\/[\dA-F]+$/i);
    const [high, low] = value.split('/').map(part => BigInt('0x' + part));
    return (high << 32n) + low;
  };
  const bytes = lsn(end) - lsn(start);
  assert(bytes >= 0n, 'Probe WAL position moved backwards');
  return bytes.toString();
}

function createTimingCollector() {
  const phases = new Map<SqlProbeTiming['phase'], { items: number; pool: BoundedSamples; work: BoundedSamples; commit: BoundedSamples }>();
  return {
    add(timing: SqlProbeTiming) {
      let entry = phases.get(timing.phase);
      if (!entry) {
        entry = { items: 0, pool: new BoundedSamples(), work: new BoundedSamples(), commit: new BoundedSamples() };
        phases.set(timing.phase, entry);
      }
      entry.items += timing.items;
      entry.pool.add(timing.poolMs);
      entry.work.add(timing.workMs);
      entry.commit.add(timing.commitMs);
    },
    summary: () => Object.fromEntries([...phases].map(([phase, row]) => [phase,
      { items: row.items, poolMs: row.pool.summary(), workMs: row.work.summary(), commitMs: row.commit.summary() }])),
  };
}

function emptyResourceSummary() {
  return { samples: 0, replicaUnavailableSamples: 0, peakPool: 0, peakPoolBusy: 0, peakPoolWaiting: 0,
    peakActive: 0, peakLockWaits: 0, peakSyncWaits: 0, peakPending: 0, peakFlushLagBytes: 0, peakReplayLagBytes: 0,
    maxQueryMs: 0, maxGapMs: 0, firstSampleMs: null as number | null, lastSampleMs: null as number | null };
}

async function sampleResources(probe: ChatSqlProbe, startedAt: number, options: Options, signal: AbortSignal) {
  const all = emptyResourceSummary(), burst = emptyResourceSummary();
  const burstStart = startedAt + options.burstAt * 1_000;
  while (!signal.aborted) {
    const began = performance.now();
    const row = await probe.sample();
    const ended = performance.now();
    const groups = options.burst && began >= burstStart && ended < burstStart + 1_000 ? [all, burst] : [all];
    for (const group of groups) {
      group.samples++;
      group.maxQueryMs = Math.max(group.maxQueryMs, ended - began);
      const relative = ended - startedAt;
      group.firstSampleMs ??= relative;
      if (group.lastSampleMs !== null) group.maxGapMs = Math.max(group.maxGapMs, relative - group.lastSampleMs);
      group.lastSampleMs = relative;
      group.replicaUnavailableSamples += Number(!row.replicaReady);
      group.peakPool = Math.max(group.peakPool, row.pool.total);
      group.peakPoolBusy = Math.max(group.peakPoolBusy, row.pool.total - row.pool.idle);
      group.peakPoolWaiting = Math.max(group.peakPoolWaiting, row.pool.waiting);
      group.peakActive = Math.max(group.peakActive, row.active);
      group.peakLockWaits = Math.max(group.peakLockWaits, row.lockWaits);
      group.peakSyncWaits = Math.max(group.peakSyncWaits, row.syncWaits);
      group.peakPending = Math.max(group.peakPending, row.pending);
      group.peakFlushLagBytes = Math.max(group.peakFlushLagBytes, row.flushLagBytes ?? 0);
      group.peakReplayLagBytes = Math.max(group.peakReplayLagBytes, row.replayLagBytes ?? 0);
    }
    try { await delay(50, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
  if (burst.firstSampleMs !== null && burst.lastSampleMs !== null) {
    const offset = options.burstAt * 1_000;
    burst.maxGapMs = Math.max(burst.maxGapMs, burst.firstSampleMs - offset, offset + 1_000 - burst.lastSampleMs);
  }
  return { targetIntervalMs: 50, all, burst };
}

async function measure(probe: ChatSqlProbe, options: Options, controller: AbortController,
  accounts: readonly string[], rooms: readonly string[]) {
  const { signal } = controller;
  const prefill = options.prefill ? await probe.prefill(accounts, rooms, options.prefill) : { requests: 0, publications: 0 };
  const observed = new Map<string, Observation>();
  const inFlight = new Set<Promise<void>>();
  const queues = Array.from({ length: options.quotaPartitions }, () => ({ slots: [] as Slot[], busy: 0 }));
  const accountPartitions = accounts.map(accountId => chatSqlQuotaPartition(accountId, options.quotaPartitions));
  const admissionLimit = options.admissionWorkers / options.quotaPartitions;
  const before = await probe.stats();
  assert(before.accepted === prefill.requests && before.published === prefill.requests && before.feed === prefill.publications
    && before.pending === 0 && before.rejected === 0 && before.outbox === 0, 'Unexpected initial SQL probe state');
  const startedAt = performance.now() + 100;
  const wallStartMs = Date.now() + 100;
  const endsAt = startedAt + options.seconds * 1_000;
  const deadline = endsAt + drainMs;
  const burstDeadline = startedAt + (options.burstAt + 1) * 1_000 + drainMs;
  let schedulerDone = false, accepted = 0, finished = 0, staleClaims = 0, peakInFlight = 0;
  let failure: unknown;
  const fail = (error: unknown) => {
    failure ??= error;
    controller.abort();
  };

  const offer = (slots: readonly Slot[], partition: number) => {
    const batch = slots.map(slot => {
      const messageId = createChatMessageId(Math.floor(wallStartMs + slot.dueAt - startedAt));
      const request: SqlProbeRequest = { accountId: accounts[slot.accountIndex], location: 'arcade', originSeq: prefill.requests + slot.originSeq,
        envelope: { messageId, roomEpoch: rooms[Math.floor(slot.accountIndex / roomCapacity)], visitId: 1,
          text: `Добрый вечер, участник ${slot.originSeq}` } };
      return { slot, request, messageId };
    });
    const ids = new Set(batch.map(({ messageId }) => messageId));
    assert(ids.size === batch.length && batch.every(({ messageId }) => !observed.has(messageId)), 'Synthetic ID collision');
    let eligible = batch;
    let requests = batch.map(({ request }) => request);
    let offeredAt = performance.now();
    while (eligible.some(({ slot }) => offeredAt >= slot.offerBefore)) {
      eligible = eligible.filter(({ slot }) => offeredAt < slot.offerBefore);
      requests = eligible.map(({ request }) => request);
      offeredAt = performance.now();
    }
    if (!eligible.length) return;
    const admission = probe.admit(requests);
    for (const { slot, request, messageId } of eligible) {
      observed.set(messageId, { ...slot, accountId: request.accountId, offeredAt });
    }
    const pending = admission.then(results => {
      const acknowledgedAt = performance.now();
      matchResults(eligible.map(({ request, messageId }) => ({ accountId: request.accountId, messageId })), results, result => {
        const row = observed.get(result.messageId)!;
        row.admission = result.status;
        row.acknowledgedAt = acknowledgedAt;
        if (result.status === 'accepted') accepted++;
      });
    }).catch(fail).finally(() => { inFlight.delete(pending); queues[partition].busy--; });
    inFlight.add(pending);
    queues[partition].busy++;
    peakInFlight = Math.max(peakInFlight, inFlight.size);
  };

  const work = async (partition: number) => {
    while (!signal.aborted && performance.now() < deadline) {
      if (schedulerDone && !inFlight.size && finished === accepted) return;
      const claims = await probe.claim(workerBatchLimit, { index: partition, count: options.quotaPartitions });
      if (!claims.length) { await delay(5, undefined, { signal }); continue; }
      const results = await probe.finish(claims);
      const finishedAt = performance.now();
      matchResults(claims, results, result => {
        if (result.status === 'stale') { staleClaims++; return; }
        const row = observed.get(result.messageId);
        assert(row && row.accountId === result.accountId && !row.result, 'Repeated or unknown terminal probe result');
        row.result = result.status;
        row.finishedAt = finishedAt;
        finished++;
      });
    }
  };

  const monitoring = new AbortController();
  const resources = sampleResources(probe, startedAt, options, monitoring.signal).catch(fail);
  const workers = Array.from({ length: options.workers }, (_, index) => work(index % options.quotaPartitions).catch(fail));
  try {
    const plan = arrivals(options, startedAt);
    let next = plan.next();
    while (performance.now() < endsAt) {
      signal.throwIfAborted();
      const now = performance.now();
      while (!next.done && next.value.dueAt <= now) {
        const slot = next.value;
        if (slot.offerBefore > now) queues[accountPartitions[slot.accountIndex]].slots.push(slot);
        next = plan.next();
      }
      for (const [partition, queue] of queues.entries()) {
        while (queue.busy < admissionLimit && queue.slots.length) {
          const readyAt = performance.now();
          const slots = queue.slots.splice(0, admissionBatchLimit).filter(slot => slot.offerBefore > readyAt);
          if (slots.length) offer(slots, partition);
        }
      }
      if (next.done && queues.every(queue => !queue.slots.length)) break;
      const wakeIn = next.done ? 1 : Math.max(1, Math.min(5, next.value.dueAt - performance.now()));
      await delay(wakeIn, undefined, { signal });
    }
  } catch (error) {
    fail(error);
  } finally {
    schedulerDone = true;
    await Promise.all(inFlight);
    await Promise.all(workers);
    monitoring.abort();
  }
  const resourceSamples = await resources;
  if (failure !== undefined) throw failure;
  signal.throwIfAborted();
  assert(resourceSamples?.all.samples && (!options.burst || resourceSamples.burst.samples), 'Incomplete SQL probe resource sampling');

  const after = await probe.stats();
  const database = { accepted: after.accepted - before.accepted, pending: after.pending,
    published: after.published - before.published, rejected: after.rejected, outbox: after.outbox,
    feed: after.feed - before.feed, walLsn: after.walLsn };
  const rows = [...observed.values()];
  const steady = summarize(rows.filter(row => row.cohort === 'steady'), options.seconds * options.rate, deadline);
  const burst = summarize(rows.filter(row => row.cohort === 'burst'), options.burst, burstDeadline);
  assert.equal(database.accepted, steady.accepted + burst.accepted, 'Observed ACKs and stored requests differ');
  assert.equal(database.pending, steady.pending + burst.pending, 'Observed and stored pending counts differ');
  assert.equal(database.published, steady.published + burst.published, 'Observed and stored publications differ');
  assert.equal(database.rejected, steady.rejected + burst.rejected, 'Observed and stored rejections differ');
  assert.equal(database.feed, database.published, 'SQL probe feed delta mismatch');
  assert.equal(database.accepted, database.published + database.rejected + database.pending, 'Stored requests do not reconcile');
  assert(rows.every(row => !row.result || row.admission === 'accepted'), 'Terminal result has no acceptance receipt');
  const integrityPassed = resourceSamples.all.replicaUnavailableSamples === 0 && after.pending === 0 && after.outbox === 0
    && steady.unacknowledged + burst.unacknowledged === 0
    && steady.duplicate + burst.duplicate + steady.id_conflict + burst.id_conflict === 0;
  const steadyProfilePassed = steady.offered / steady.planned >= .99 && steady.acknowledgement.p95Ms !== null
    && steady.acknowledgement.p95Ms <= 250 && (steady.offered - steady.accepted) / steady.offered <= .001
    && steady.result.p95Ms !== null && steady.result.p95Ms <= 1_000
    && steady.published === steady.accepted && steady.finishedByDeadline === steady.accepted;
  const burstProfilePassed = burst.planned === 0 || (burst.offered === burst.planned && burst.accepted === burst.planned
    && burst.published === burst.planned && burst.finishedByDeadline === burst.planned);
  return { steady, burst, database, prefill, primaryDatabaseBytes: { before: before.databaseBytes, after: after.databaseBytes },
    resources: resourceSamples, walBytes: walBytes(before.walLsn, after.walLsn), peakInFlight, staleClaims,
    integrityPassed, steadyProfilePassed, burstProfilePassed,
    localProfilePassed: integrityPassed && steadyProfilePassed && burstProfilePassed };
}

async function main() {
  const options = readOptions();
  const artifactRoot = join(await realpath(process.cwd()), 'artifacts', 'work');
  assert(await realpath(options.directory) === options.directory && dirname(options.directory) === artifactRoot,
    'Use an owned directory under artifacts/work');
  const reportPath = resolve(options.directory, outputName);
  await lstat(reportPath).then(() => { throw new Error('Use a new artifact directory for each probe'); },
    error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const stand = await startLocalChatLoadStand(options.directory, controller.signal);
    let result: Awaited<ReturnType<typeof measure>>;
    const timings = createTimingCollector();
    try {
      assert(!options.prefill || stand.report.freeDiskBytes >= 10 * 1024 ** 3, 'Not enough free space for prefill');
      const accounts = Array.from({ length: accountCount }, (_, index) => fixtureId('account', index));
      const rooms = Array.from({ length: Math.ceil(accountCount / roomCapacity) }, (_, index) => fixtureId('room', index));
      const probe = await ChatSqlProbe.open(stand.chat, stand.runId, undefined, timings.add);
      try { result = await measure(probe, options, controller, accounts, rooms); }
      finally { await probe.close(); }
    } finally { await stand.cleanup(); }
    controller.signal.throwIfAborted();
    assert.equal(await realpath(options.directory), options.directory, 'Probe artifact directory changed');
    const { directory: _directory, ...profile } = options;
    const report = { qualification: 'preliminary_single_host', topology: 'generator_workers_and_postgres_on_one_host',
      targetAccepted: false, cleanupConfirmed: true,
      profile: { ...profile, burstFrameMs, identitySeed }, stand: stand.report, ...result, transactions: timings.summary() };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report));
    if (!report.localProfilePassed) process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Local chat SQL probe failed');
    process.exitCode = 1;
  }
}
