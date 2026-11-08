import { AsyncLocalStorage } from 'node:async_hooks';
import type { PostgresDatabase } from '../server/database';
import type { PvpRoom } from '../server/pvp/room';
import type { PvpStore } from '../server/pvp/store';

type Interval = { from: number; to: number };
const actions = ['create', 'accept', 'cancel', 'resign'] as const;
export type AuditLoadPvpAction = typeof actions[number];
type Command = { id: string; action: AuditLoadPvpAction };
type Transaction = Interval & { body?: Interval };
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
export function installAuditLoadPvpTiming(room: PvpRoom, store: PvpStore, database: PostgresDatabase, schema: string) {
  const scope = new AsyncLocalStorage<{ trace: AuditLoadPvpTrace; stage?: Stage }>();
  const traces = new Map<string, AuditLoadPvpTrace>();
  const maxTraces = 8 * 16 * 3;
  const roomCommand = room.command;
  const storeCommand = store.command.bind(store), syncRoom = store.syncRoom.bind(store), roomMatches = store.roomMatches.bind(store);
  const transaction = database.transaction;

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
    const stage = scope.getStore()?.stage;
    if (!stage || this.schema !== schema || this.inTransaction || stage.transaction) {
      return (transaction<T>).call(this, callback, options);
    }
    const timing: Transaction = stage.transaction = stamp();
    return (transaction<T>).call(this, async () => {
      const body = timing.body = stamp();
      try { return await callback(); }
      finally { body.to = performance.now(); }
    }, options).finally(() => { timing.to = performance.now(); });
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
    const transaction = (stage: Stage) => stage.transaction?.body ? {
      admissionMs: rounded(stage.transaction.body.from - stage.transaction.from),
      bodyMs: elapsed(stage.transaction.body),
      finishMs: rounded(stage.transaction.to - stage.transaction.body.to),
    } : null;
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
    stake: summarize(rows.filter(row => row.action === 'create' || row.action === 'accept')),
    settlement: summarize(rows.filter(row => row.action === 'cancel' || row.action === 'resign')),
    actions: Object.fromEntries(actions.map(action => [action, summarize(rows.filter(row => row.action === action))])),
  };
}
