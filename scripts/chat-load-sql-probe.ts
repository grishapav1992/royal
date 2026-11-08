import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createChatMessageId } from '../src/shared/chat';
import { startLocalChatLoadStand } from './chat-load-stand';
import { openChatSqlProbe, type ChatSqlProbe, type SqlProbeAdmission, type SqlProbeRequest } from './chat-load-sql-store';

const admissionBatchLimit = 128;
const workerBatchLimit = 64;
const accountCount = 10_000;
const roomCapacity = 30;
const burstFrameMs = 20;
const drainMs = 5_000;
const outputName = 'local-chat-sql-probe.json';

type Options = {
  directory: string;
  seconds: number;
  rate: number;
  burst: number;
  burstAt: number;
  admissionWorkers: number;
  workers: number;
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

function readOptions(): Options {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { seconds: { type: 'string' }, rate: { type: 'string' }, burst: { type: 'string' },
      'burst-at': { type: 'string' }, 'admission-workers': { type: 'string' }, workers: { type: 'string' } },
  });
  assert.equal(positionals.length, 1,
    'Usage: node --import tsx scripts/chat-load-sql-probe.ts <owned-artifact-directory> [--seconds 3 --rate 40 --burst 0 --burst-at 1]');
  // The one-host experiment is deliberately shorter than the target 30-minute run.
  const seconds = int(values.seconds, 3, 1, 120, 'seconds');
  return {
    directory: resolve(positionals[0]), seconds, rate: int(values.rate, 40, 1, 333, 'rate'),
    burst: int(values.burst, 0, 0, 10_000, 'burst'),
    burstAt: int(values['burst-at'], Math.min(1, seconds - 1), 0, seconds - 1, 'burst-at'),
    admissionWorkers: int(values['admission-workers'], 4, 1, 8, 'admission-workers'),
    workers: int(values.workers, 4, 1, 8, 'workers'),
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

async function measure(probe: ChatSqlProbe, options: Options, controller: AbortController) {
  const { signal } = controller;
  const accounts = Array.from({ length: accountCount }, () => randomUUID());
  const rooms = Array.from({ length: Math.ceil(accountCount / roomCapacity) }, () => randomUUID());
  const observed = new Map<string, Observation>();
  const inFlight = new Set<Promise<void>>();
  const before = await probe.stats();
  assert([before.accepted, before.pending, before.published, before.rejected, before.outbox].every(count => count === 0),
    'Probe database was not empty');
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

  const offer = (slots: readonly Slot[]) => {
    const batch = slots.map(slot => {
      const messageId = createChatMessageId(Math.floor(wallStartMs + slot.dueAt - startedAt));
      const request: SqlProbeRequest = { accountId: accounts[slot.accountIndex], location: 'arcade', originSeq: slot.originSeq,
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
    }).catch(fail).finally(() => { inFlight.delete(pending); });
    inFlight.add(pending);
    peakInFlight = Math.max(peakInFlight, inFlight.size);
  };

  const work = async () => {
    while (!signal.aborted && performance.now() < deadline) {
      if (schedulerDone && !inFlight.size && finished === accepted) return;
      const claims = await probe.claim(workerBatchLimit);
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

  const workers = Array.from({ length: options.workers }, () => work().catch(fail));
  try {
    const plan = arrivals(options, startedAt);
    let next = plan.next();
    while (!next.done && performance.now() < endsAt) {
      signal.throwIfAborted();
      const now = performance.now();
      if (inFlight.size < options.admissionWorkers && next.value.dueAt <= now) {
        const slots: Slot[] = [];
        while (!next.done && next.value.dueAt <= now && slots.length < admissionBatchLimit) {
          if (next.value.offerBefore > now) slots.push(next.value);
          next = plan.next();
        }
        offer(slots);
      } else {
        await delay(Math.max(1, Math.min(5, next.value.dueAt - now)), undefined, { signal });
      }
    }
  } catch (error) {
    fail(error);
  } finally {
    schedulerDone = true;
    await Promise.all(inFlight);
    await Promise.all(workers);
  }
  if (failure !== undefined) throw failure;
  signal.throwIfAborted();

  const after = await probe.stats();
  const rows = [...observed.values()];
  const steady = summarize(rows.filter(row => row.cohort === 'steady'), options.seconds * options.rate, deadline);
  const burst = summarize(rows.filter(row => row.cohort === 'burst'), options.burst, burstDeadline);
  assert.equal(after.accepted, steady.accepted + burst.accepted, 'Observed ACKs and stored requests differ');
  assert.equal(after.pending, steady.pending + burst.pending, 'Observed and stored pending counts differ');
  assert.equal(after.published, steady.published + burst.published, 'Observed and stored publications differ');
  assert.equal(after.rejected, steady.rejected + burst.rejected, 'Observed and stored rejections differ');
  assert.equal(after.accepted, after.published + after.rejected + after.pending, 'Stored requests do not reconcile');
  assert(rows.every(row => !row.result || row.admission === 'accepted'), 'Terminal result has no acceptance receipt');
  const integrityPassed = after.pending === 0 && after.outbox === 0 && steady.unacknowledged + burst.unacknowledged === 0
    && steady.duplicate + burst.duplicate + steady.id_conflict + burst.id_conflict === 0;
  const steadyProfilePassed = steady.offered / steady.planned >= .99 && steady.acknowledgement.p95Ms !== null
    && steady.acknowledgement.p95Ms <= 250 && (steady.offered - steady.accepted) / steady.offered <= .001
    && steady.result.p95Ms !== null && steady.result.p95Ms <= 1_000
    && steady.published === steady.accepted && steady.finishedByDeadline === steady.accepted;
  const burstProfilePassed = burst.planned === 0 || (burst.offered === burst.planned && burst.accepted === burst.planned
    && burst.published === burst.planned && burst.finishedByDeadline === burst.planned);
  return { steady, burst, database: after, walBytes: walBytes(before.walLsn, after.walLsn), peakInFlight, staleClaims,
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
    try {
      const probe = await openChatSqlProbe(stand.chat, stand.runId);
      try { result = await measure(probe, options, controller); }
      finally { await probe.close(); }
    } finally { await stand.cleanup(); }
    controller.signal.throwIfAborted();
    assert.equal(await realpath(options.directory), options.directory, 'Probe artifact directory changed');
    const { directory: _directory, ...profile } = options;
    const report = { qualification: 'preliminary_single_host', topology: 'generator_workers_and_postgres_on_one_host',
      targetAccepted: false, cleanupConfirmed: true,
      profile: { ...profile, burstFrameMs }, stand: stand.report, ...result };
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
