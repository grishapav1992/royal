import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import type { PostgresDatabase } from '../server/database';
import type { PvpRoom } from '../server/pvp/room';
import type { PvpStore } from '../server/pvp/store';
import type { startAuditLoadLockObserver } from './audit-load-lock-observer';

type Interval = { from: number; to: number };
const actions = ['create', 'accept', 'cancel', 'resign'] as const;
export type AuditLoadPvpAction = typeof actions[number];
type Command = { id: string; action: AuditLoadPvpAction };
type LockQuery = Interval & { scope: 'schema' | 'key'; observedWaitLowerBoundMs?: number };
type Transaction = Interval & { body?: Interval; checkout?: Interval; begin?: Interval; advisory?: LockQuery };
type Stage = Interval & { transaction?: Transaction };
export type AuditLoadPvpTrace = Command & {
  room: Interval; command?: Stage; sync?: Stage; matches?: Interval;
};
export type AuditLoadPvpSample = Interval & { ok: boolean; pvp?: Command };

function stamp(): Interval {
  const now = performance.now();
  return { from: now, to: now };
}

/** Installed only in the disposable wallet child. Retries reuse IDs and keep the first trace. */
export function installAuditLoadPvpTiming(room: PvpRoom, store: PvpStore, database: PostgresDatabase, schema: string,
  lockObserver: Awaited<ReturnType<typeof startAuditLoadLockObserver>>) {
  type Admission = { timing: Transaction; client?: PoolClient };
  const scope = new AsyncLocalStorage<{ trace: AuditLoadPvpTrace; stage?: Stage; admission?: Admission }>();
  const traces = new Map<string, AuditLoadPvpTrace>();
  const observedPools = new WeakSet<Pool>();
  const observedClients = new WeakSet<PoolClient>();
  const maxTraces = 8 * 16 * 3;
  const roomCommand = room.command;
  const storeCommand = store.command.bind(store), syncRoom = store.syncRoom.bind(store), roomMatches = store.roomMatches.bind(store);
  const transaction = database.transaction;
  const advisorySql = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';

  const observeClient = (client: PoolClient) => {
    if (observedClients.has(client)) return;
    observedClients.add(client);
    const query = client.query;
    client.query = function (this: PoolClient, ...args: unknown[]) {
      const admission = scope.getStore()?.admission;
      if (!admission || admission.timing.body || admission.client !== this) return Reflect.apply(query, this, args);
      const { timing } = admission;
      if (args[0] === 'BEGIN' && args.length === 1 && !timing.begin) {
        const begin = timing.begin = stamp();
        return (Reflect.apply(query, this, args) as Promise<unknown>).finally(() => { begin.to = performance.now(); });
      }
      const key = args[0] === advisorySql && args.length === 2 && Array.isArray(args[1]) ? args[1][0] : undefined;
      if (typeof key !== 'string' || (key !== schema && !key.startsWith(schema + ':key:')) || timing.advisory) {
        return Reflect.apply(query, this, args);
      }
      const advisory: LockQuery = timing.advisory = { ...stamp(), scope: key === schema ? 'schema' : 'key' };
      const pid = (this as PoolClient & { processID?: number }).processID;
      const result = Reflect.apply(query, this, args) as Promise<unknown>;
      const untrack = typeof pid === 'number' ? lockObserver.track(pid, key, waitMs => {
        advisory.observedWaitLowerBoundMs = Math.max(advisory.observedWaitLowerBoundMs ?? 0, waitMs);
      }) : undefined;
      return result.finally(() => { advisory.to = performance.now(); untrack?.(); });
    } as PoolClient['query'];
  };
  const observePool = (pool: Pool) => {
    if (observedPools.has(pool)) return;
    observedPools.add(pool);
    const connect = pool.connect;
    pool.connect = function (this: Pool, ...args: unknown[]) {
      const admission = scope.getStore()?.admission;
      // pg.Pool.query uses callback checkout. Only the outer transaction's promise is measured.
      if (!admission || args.length || admission.timing.checkout) return Reflect.apply(connect, this, args);
      const checkout = admission.timing.checkout = stamp();
      return (Reflect.apply(connect, this, args) as Promise<PoolClient>)
        .finally(() => { checkout.to = performance.now(); })
        .then(client => {
          admission.client = client;
          observeClient(client);
          return client;
        });
    } as Pool['connect'];
  };

  room.command = function (session, value) {
    const input = value as Partial<Command> | undefined;
    if (typeof input?.id !== 'string' || input.id.length !== 36 || !input.action || !actions.includes(input.action) ||
        traces.size >= maxTraces || traces.has(input.id)) return roomCommand.call(this, session, value);
    const trace = { id: input.id, action: input.action, room: stamp() };
    traces.set(trace.id, trace);
    return scope.run({ trace }, async () => {
      try { return await roomCommand.call(this, session, value); }
      finally { trace.room.to = performance.now(); }
    });
  };

  const measure = <T>(name: 'command' | 'sync' | 'matches', work: () => Promise<T>) => {
    const current = scope.getStore();
    if (!current || current.trace[name]) return work();
    const stage = current.trace[name] = stamp();
    return scope.run({ trace: current.trace, stage: name === 'matches' ? undefined : stage }, async () => {
      try { return await work(); }
      finally { stage.to = performance.now(); }
    });
  };
  store.command = (...args) => measure('command', () => storeCommand(...args));
  store.syncRoom = (...args) => measure('sync', () => syncRoom(...args));
  store.roomMatches = (...args) => measure('matches', () => roomMatches(...args));

  database.transaction = function <T>(this: PostgresDatabase, callback: () => Promise<T>,
    options?: Parameters<PostgresDatabase['transaction']>[1]) {
    const current = scope.getStore(), stage = current?.stage;
    if (!current || !stage || this.schema !== schema || this.inTransaction || stage.transaction) {
      return (transaction<T>).call(this, callback, options);
    }
    observePool(this.pool);
    const timing: Transaction = stage.transaction = stamp();
    return scope.run({ trace: current.trace, stage, admission: { timing } }, () => (transaction<T>).call(this, async () => {
      const body = timing.body = stamp();
      try { return await callback(); }
      finally { body.to = performance.now(); }
    }, options)).finally(() => { timing.to = performance.now(); });
  };

  return () => {
    const result = [...traces.values()];
    traces.clear();
    return result;
  };
}

const rounded = (value: number) => Number(value.toFixed(3));
const elapsed = (span: Interval) => rounded(span.to - span.from);

export function summarizeAuditLoadPvpTiming(samples: AuditLoadPvpSample[], traces: AuditLoadPvpTrace[], firstReport?: Interval) {
  const byId = new Map(traces.map(trace => [trace.id, trace]));
  const successful = samples.filter(sample => sample.ok && sample.pvp).sort((a, b) => (a.to - a.from) - (b.to - b.from));
  const correlate = (sample: AuditLoadPvpSample) => {
    const trace = sample.pvp && byId.get(sample.pvp.id);
    const clientMs = elapsed(sample);
    const firstReportOverlap = firstReport !== undefined && sample.from < firstReport.to && sample.to > firstReport.from;
    if (!trace || trace.action !== sample.pvp?.action || !trace.command || !trace.sync || !trace.matches) {
      return { action: sample.pvp?.action, clientMs, firstReportOverlap, server: null };
    }
    const { command, sync, matches, room } = trace;
    const transaction = (stage: Stage) => {
      const timing = stage.transaction;
      if (!timing?.body) return null;
      return {
        admissionMs: rounded(timing.body.from - timing.from),
        checkoutMs: timing.checkout ? elapsed(timing.checkout) : null,
        beginMs: timing.begin ? elapsed(timing.begin) : null,
        advisoryMs: timing.advisory ? elapsed(timing.advisory) : null,
        advisoryScope: timing.advisory?.scope ?? null,
        observedWaitLowerBoundMs: timing.advisory?.observedWaitLowerBoundMs === undefined
          ? null : rounded(timing.advisory.observedWaitLowerBoundMs),
        bodyMs: elapsed(timing.body),
        finishMs: rounded(timing.to - timing.body.to),
      };
    };
    return { action: trace.action, clientMs, firstReportOverlap, server: {
      roomMs: elapsed(room), beforeStoreMs: rounded(command.from - room.from),
      commandMs: elapsed(command), commandTransaction: transaction(command),
      beforeSyncMs: rounded(sync.from - command.to), syncMs: elapsed(sync), syncTransaction: transaction(sync),
      beforeRoomMatchesMs: rounded(matches.from - sync.to), roomMatchesMs: elapsed(matches),
      afterRoomMatchesMs: rounded(room.to - matches.to),
    } };
  };
  const complete = (row: ReturnType<typeof correlate>) => !!row.server?.commandTransaction && !!row.server.syncTransaction;
  const summarize = (rows: ReturnType<typeof correlate>[]) => ({
    completed: rows.length, matched: rows.filter(complete).length,
    overlappingFirstReport: rows.filter(row => row.firstReportOverlap).length,
    p95: rows[Math.ceil(rows.length * 0.95) - 1] ?? null, slowest: rows.at(-1) ?? null,
  });
  const rows = successful.map(correlate);
  return {
    traced: traces.length, completed: rows.length, matched: rows.filter(complete).length,
    observedAdvisoryWaits: {
      command: traces.filter(trace => trace.command?.transaction?.advisory?.observedWaitLowerBoundMs !== undefined).length,
      sync: traces.filter(trace => trace.sync?.transaction?.advisory?.observedWaitLowerBoundMs !== undefined).length,
    },
    stake: summarize(rows.filter(row => row.action === 'create' || row.action === 'accept')),
    settlement: summarize(rows.filter(row => row.action === 'cancel' || row.action === 'resign')),
    actions: Object.fromEntries(actions.map(action => [action, summarize(rows.filter(row => row.action === action))])),
  };
}
