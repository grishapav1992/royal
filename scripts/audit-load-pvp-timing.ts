import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import type { AccountStore } from '../server/accounts';
import type { PostgresDatabase } from '../server/database';
import type { PvpRoom } from '../server/pvp/room';
import type { AuditLoadLockHolder, startAuditLoadLockObserver } from './audit-load-lock-observer';

type Interval = { from: number; to: number };
const actions = ['create', 'accept', 'cancel', 'resign'] as const;
export type AuditLoadPvpAction = typeof actions[number];
type Command = { id: string; action: AuditLoadPvpAction };
const holderKinds = ['pvp-command', 'pvp-sync', 'pvp-sweep', 'pvp-adjudicate', 'combat-recovery', 'progression', 'other'] as const;
type HolderKind = typeof holderKinds[number];
type LockQuery = Interval & { scope: 'schema' | 'key'; observedWaitLowerBoundMs?: number; holders: HolderKind[] };
type Transaction = Interval & { body?: Interval; checkout?: Interval; begin?: Interval; advisory?: LockQuery };
type Stage = Interval & { transaction?: Transaction; readOnlyTransaction?: Transaction };
export type AuditLoadPvpTrace = Command & {
  room: Interval; command?: Stage; sync?: Stage;
};
export type AuditLoadPvpSample = Interval & { ok: boolean; pvp?: Command };

function stamp(): Interval {
  const now = performance.now();
  return { from: now, to: now };
}

export function createAuditLoadLockOwnerIndex() {
  const recent = new Map<number, Array<Interval & { kind: HolderKind }>>();
  return {
    record(pid: number, from: number, to: number, kind: HolderKind) {
      if (from >= to) return;
      const history = recent.get(pid) ?? [];
      history.push({ from, to, kind });
      if (history.length > 32) history.shift();
      recent.delete(pid);
      recent.set(pid, history);
      const oldest = recent.keys().next().value;
      if (recent.size > 32 && oldest !== undefined) recent.delete(oldest);
    },
    find({ pid, transactionStartMs }: AuditLoadLockHolder) {
      const matches = recent.get(pid)?.filter(entry => entry.from <= transactionStartMs && transactionStartMs < entry.to);
      return matches?.length === 1 ? matches[0].kind : undefined;
    },
  };
}

/** Installed only in the disposable wallet child. Retries reuse IDs and keep the first trace. */
export function installAuditLoadPvpTiming(room: PvpRoom, services: Pick<AccountStore, 'pvp' | 'combat' | 'progression'>,
  database: PostgresDatabase, schema: string,
  lockObserver: Awaited<ReturnType<typeof startAuditLoadLockObserver>>) {
  type Admission = { timing?: Transaction; owner?: HolderKind; client?: PoolClient; entered?: boolean };
  const scope = new AsyncLocalStorage<{ trace?: AuditLoadPvpTrace; stage?: Stage; admission?: Admission; owner?: HolderKind }>();
  const { pvp: store, combat, progression } = services;
  const owners = createAuditLoadLockOwnerIndex();
  const traces = new Map<string, AuditLoadPvpTrace>();
  const observedPools = new WeakSet<Pool>();
  const observedClients = new WeakSet<PoolClient>();
  const maxTraces = 8 * 16 * 3;
  const roomCommand = room.command;
  const storeCommand = store.command.bind(store), syncRoom = store.syncRoomState.bind(store);
  const sweep = store.sweep.bind(store), adjudicate = store.adjudicate.bind(store);
  const recoverExpired = combat.recoverExpired.bind(combat), processPending = progression.processPending.bind(progression);
  const transaction = database.transaction;
  const advisorySql = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';

  const observeClient = (client: PoolClient) => {
    if (observedClients.has(client)) return;
    observedClients.add(client);
    const query = client.query;
    client.query = function (this: PoolClient, ...args: unknown[]) {
      const admission = scope.getStore()?.admission;
      if (!admission || admission.entered || admission.client !== this) return Reflect.apply(query, this, args);
      const { timing } = admission;
      const pid = (this as PoolClient & { processID?: number }).processID;
      if (args.length === 1 && (args[0] === 'BEGIN' || args[0] === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')) {
        const begin = timing && (timing.begin = stamp());
        const from = Date.now();
        return (Reflect.apply(query, this, args) as Promise<unknown>).then(result => {
          if (typeof pid === 'number' && admission.owner) owners.record(pid, from, Date.now() + 1, admission.owner);
          return result;
        }).finally(() => { if (begin) begin.to = performance.now(); });
      }
      const key = args[0] === advisorySql && args.length === 2 && Array.isArray(args[1]) ? args[1][0] : undefined;
      if (!timing || typeof key !== 'string' || (key !== schema && !key.startsWith(schema + ':key:')) || timing.advisory) {
        return Reflect.apply(query, this, args);
      }
      const advisory: LockQuery = timing.advisory = { ...stamp(), scope: key === schema ? 'schema' : 'key', holders: [] };
      const result = Reflect.apply(query, this, args) as Promise<unknown>;
      const untrack = typeof pid === 'number' ? lockObserver.track(pid, key, (waitMs, holders) => {
        advisory.observedWaitLowerBoundMs = Math.max(advisory.observedWaitLowerBoundMs ?? 0, waitMs);
        for (const holder of holders) {
          const kind = owners.find(holder);
          if (kind && !advisory.holders.includes(kind)) advisory.holders.push(kind);
        }
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
      if (!admission || args.length || admission.client) return Reflect.apply(connect, this, args);
      const checkout = admission.timing && (admission.timing.checkout = stamp());
      return (Reflect.apply(connect, this, args) as Promise<PoolClient>)
        .finally(() => { if (checkout) checkout.to = performance.now(); })
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

  const measure = <T>(name: 'command' | 'sync', work: () => Promise<T>) => {
    const current = scope.getStore();
    if (!current?.trace || current.trace[name]) return work();
    const stage = current.trace[name] = stamp();
    return scope.run({ ...current, stage }, async () => {
      try { return await work(); }
      finally { stage.to = performance.now(); }
    });
  };
  const withOwner = <T>(owner: HolderKind, work: () => Promise<T>) => scope.run({ ...scope.getStore(), owner }, work);
  store.command = (...args) => withOwner('pvp-command', () => measure('command', () => storeCommand(...args)));
  store.syncRoomState = (...args) => withOwner('pvp-sync', () => measure('sync', () => syncRoom(...args)));
  store.sweep = (...args) => withOwner('pvp-sweep', () => sweep(...args));
  store.adjudicate = (...args) => withOwner('pvp-adjudicate', () => adjudicate(...args));
  combat.recoverExpired = (...args) => withOwner('combat-recovery', () => recoverExpired(...args));
  progression.processPending = (...args) => withOwner('progression', () => processPending(...args));

  database.transaction = function <T>(this: PostgresDatabase, callback: () => Promise<T>,
    options?: Parameters<PostgresDatabase['transaction']>[1]) {
    const current = scope.getStore(), stage = current?.stage;
    const owner = !options?.readOnly && options?.lockKey === undefined ? current?.owner ?? 'other' : undefined;
    const slot = options?.readOnly ? 'readOnlyTransaction' : 'transaction';
    const traceAdmission = stage && !stage[slot];
    if (this.schema !== schema || this.inTransaction || (!traceAdmission && !owner)) {
      return (transaction<T>).call(this, callback, options);
    }
    observePool(this.pool);
    const timing: Transaction | undefined = traceAdmission ? stage[slot] = stamp() : undefined;
    const admission: Admission = { timing, owner };
    return scope.run({ ...current, admission }, () => (transaction<T>).call(this, async () => {
      admission.entered = true;
      if (!timing) return callback();
      const body = timing.body = stamp();
      try { return await callback(); }
      finally { body.to = performance.now(); }
    }, options)).finally(() => { if (timing) timing.to = performance.now(); });
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
    if (!trace || trace.action !== sample.pvp?.action || !trace.command || !trace.sync) {
      return { action: sample.pvp?.action, clientMs, firstReportOverlap, server: null };
    }
    const { command, sync, room } = trace;
    const transaction = (timing?: Transaction) => {
      if (!timing?.body) return null;
      return {
        admissionMs: rounded(timing.body.from - timing.from),
        checkoutMs: timing.checkout ? elapsed(timing.checkout) : null,
        beginMs: timing.begin ? elapsed(timing.begin) : null,
        advisoryMs: timing.advisory ? elapsed(timing.advisory) : null,
        advisoryScope: timing.advisory?.scope ?? null,
        advisoryHolders: timing.advisory?.holders ?? [],
        observedWaitLowerBoundMs: timing.advisory?.observedWaitLowerBoundMs === undefined
          ? null : rounded(timing.advisory.observedWaitLowerBoundMs),
        bodyMs: elapsed(timing.body),
        finishMs: rounded(timing.to - timing.body.to),
      };
    };
    return { action: trace.action, clientMs, firstReportOverlap, server: {
      roomMs: elapsed(room), beforeStoreMs: rounded(command.from - room.from),
      commandMs: elapsed(command), commandTransaction: transaction(command.transaction),
      beforeSyncMs: rounded(sync.from - command.to), syncMs: elapsed(sync),
      syncTransaction: transaction(sync.transaction ?? sync.readOnlyTransaction),
      syncProbeTransaction: sync.transaction ? transaction(sync.readOnlyTransaction) : null,
      syncReadOnly: !sync.transaction && !!sync.readOnlyTransaction, afterSyncMs: rounded(room.to - sync.to),
    } };
  };
  const complete = (row: ReturnType<typeof correlate>) => !!row.server?.commandTransaction && !!row.server.syncTransaction;
  const summarize = (rows: ReturnType<typeof correlate>[]) => ({
    completed: rows.length, matched: rows.filter(complete).length,
    overlappingFirstReport: rows.filter(row => row.firstReportOverlap).length,
    p95: rows[Math.ceil(rows.length * 0.95) - 1] ?? null, slowest: rows.at(-1) ?? null,
  });
  const rows = successful.map(correlate);
  const observations = (stage: 'command' | 'sync') => {
    const waits = traces.flatMap(trace => {
      const advisory = trace[stage]?.transaction?.advisory;
      return advisory?.observedWaitLowerBoundMs === undefined ? [] : [advisory];
    });
    return { observed: waits.length, unattributed: waits.filter(wait => !wait.holders.length).length,
      byKind: Object.fromEntries(holderKinds.map(kind => [kind, waits.filter(wait => wait.holders.includes(kind)).length])) };
  };
  const commandHolders = observations('command'), syncHolders = observations('sync');
  return {
    traced: traces.length, completed: rows.length, matched: rows.filter(complete).length,
    readOnlySyncs: rows.filter(row => row.server?.syncReadOnly).length,
    observedAdvisoryWaits: { command: commandHolders.observed, sync: syncHolders.observed },
    holderObservations: { command: commandHolders, sync: syncHolders },
    stake: summarize(rows.filter(row => row.action === 'create' || row.action === 'accept')),
    settlement: summarize(rows.filter(row => row.action === 'cancel' || row.action === 'resign')),
    actions: Object.fromEntries(actions.map(action => [action, summarize(rows.filter(row => row.action === action))])),
  };
}
