import { randomUUID } from 'node:crypto';
import { AUDIT_SCHEMA_VERSION, isAuditRecord, type AuditAttempt, type AuditScope, type AuditSourceRef } from './contract';
import { PostgresDatabase, databaseConfig } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { AuditEvidence } from './evidence';

export type AuditAttemptObservation = Omit<AuditAttempt, 'schemaVersion' | 'scope' | 'type'>;
export type AuditAttemptSink = (observation: AuditAttemptObservation) => void;
type CaptureGap = { count: number; firstAtMs: number; lastAtMs: number };
type CaptureWriter = {
  record: (attempt: AuditAttempt) => Promise<unknown>;
  gap: (gap: CaptureGap) => Promise<unknown>;
};

/** Use only on routes whose locked wallet snapshot includes ledger entries in descending ID order. */
export function auditDemoLedgerSnapshot(schema: string | undefined, wallet: unknown): AuditSourceRef | null {
  if (!schema || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || !wallet || typeof wallet !== 'object') return null;
  const { entries } = wallet as { entries?: unknown };
  if (!Array.isArray(entries)) return null;
  const id: unknown = entries[0]?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null;
  return { namespace: schema + '.demo_ledger', rowId: String(id) };
}

export async function migrateAuditAttemptCapture(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-attempt-capture-v1', statements: [
    `CREATE TABLE audit_attempt_capture_gaps(
      dataset_id uuid REFERENCES audit_datasets(id), producer_id uuid, missing_count bigint NOT NULL CHECK(missing_count>0),
      first_at_ms bigint NOT NULL, last_at_ms bigint NOT NULL CHECK(last_at_ms>=first_at_ms),
      PRIMARY KEY(dataset_id,producer_id)
    )`,
  ] });
}

/** A bounded observer queue. Never await it from a wallet request or room command. */
export class AuditAttemptRecorder {
  private queue: AuditAttempt[] = [];
  private drain?: Promise<void>;
  private accepting = true;
  private lost: CaptureGap | null = null;
  private published = 0;

  constructor(private readonly scope: AuditScope, private readonly writer: CaptureWriter,
    private readonly onGap: (count: number) => void, private readonly capacity = 128) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid audit attempt queue capacity');
  }

  readonly record: AuditAttemptSink = observation => {
    const attempt: AuditAttempt = {
      ...observation, schemaVersion: AUDIT_SCHEMA_VERSION, scope: this.scope, type: 'attempt',
    };
    if (!this.accepting || this.queue.length >= this.capacity || !isAuditRecord(attempt)) {
      this.markLost(Number.isSafeInteger(attempt.occurredAtMs) && attempt.occurredAtMs >= 0 ? attempt.occurredAtMs : Date.now());
    } else {
      this.queue.push(attempt);
    }
    this.schedule();
  };

  private markLost(at: number) {
    this.lost = this.lost
      ? { count: this.lost.count + 1, firstAtMs: Math.min(this.lost.firstAtMs, at), lastAtMs: Math.max(this.lost.lastAtMs, at) }
      : { count: 1, firstAtMs: at, lastAtMs: at };
    // Keep an operational signal even when the database itself is unavailable.
    const count = this.lost.count;
    if (count === 1 || count % this.capacity === 0) {
      try { this.onGap(count); } catch { /* Diagnostics cannot interfere with the observed action. */ }
    }
  }

  private schedule() {
    if (this.drain) return;
    let processedGapCount = 0;
    this.drain = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        try { await this.writer.record(next); }
        catch {
          // Release the backlog during an outage, then accept fresh observations on the next drain.
          this.markLost(next.occurredAtMs);
          for (const dropped of this.queue.splice(0)) this.markLost(dropped.occurredAtMs);
        }
      }
      const gap = this.lost;
      processedGapCount = gap?.count ?? 0;
      if (gap && gap.count > this.published) {
        try { await this.writer.gap(gap); this.published = gap.count; }
        catch { /* Retain the cumulative gap for a subsequent flush. */ }
      }
    }).finally(() => {
      this.drain = undefined;
      if (this.queue.length || (this.lost?.count ?? 0) > processedGapCount) this.schedule();
    });
  }

  async flush() {
    this.schedule();
    while (this.drain) await this.drain;
  }

  async stop() {
    this.accepting = false;
    await this.flush();
  }
}

/** Operator provisions and starts the test dataset before enabling the transport observer. */
export function startAuditAttemptRuntime(env: NodeJS.ProcessEnv = process.env) {
  const schema = env.ROYAL_AUDIT_SCHEMA, datasetId = env.ROYAL_AUDIT_TEST_DATASET_ID;
  if (schema === undefined && datasetId === undefined) return;
  if (!schema || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || !datasetId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(datasetId)) {
    throw new Error('Audit attempts require a valid schema and test dataset ID');
  }
  const db = new PostgresDatabase(schema, { existingSchema: true, config: {
    ...databaseConfig(env), max: 1, statement_timeout: 2000, lock_timeout: 500, application_name: 'royal/audit-attempts',
  } });
  const producerId = randomUUID();
  const scope: AuditScope = { datasetId, environment: 'test' };
  const evidence = new AuditEvidence(db, schema);
  const writer: CaptureWriter = {
    record: attempt => evidence.record(attempt),
    gap: gap => db.prepare(`INSERT INTO audit_attempt_capture_gaps(dataset_id,producer_id,missing_count,first_at_ms,last_at_ms)
      SELECT id,?, ?, ?, ? FROM audit_datasets WHERE id=? AND environment='test' AND sealed_at_ms IS NULL FOR SHARE
      ON CONFLICT(dataset_id,producer_id) DO UPDATE SET missing_count=EXCLUDED.missing_count,
      first_at_ms=EXCLUDED.first_at_ms,last_at_ms=EXCLUDED.last_at_ms`)
      .run(producerId, gap.count, gap.firstAtMs, gap.lastAtMs, datasetId),
  };
  const recorder = new AuditAttemptRecorder(scope, writer, count => {
    console.warn(JSON.stringify({ event: 'audit-attempt-capture-gap', datasetId, producerId, missingCount: count }));
  });
  return {
    record: recorder.record,
    async close() {
      await recorder.stop();
      await db.close();
    },
  };
}
