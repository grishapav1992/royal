import { randomUUID } from 'node:crypto';
import { AUDIT_SCHEMA_VERSION, isAuditRecord, type AuditAttempt, type AuditScope, type AuditSourceRef } from './contract';
import { PostgresDatabase, databaseConfig } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { AuditEvidence } from './evidence';
import { chessReplayWriter } from './replay-chess-storage';
import { combatReplayWriter } from './replay-pvp-realtime';
import { cardsReplayWriter } from './replay-pvp-cards-storage';
import { sportReplayWriter } from './replay-pvp-sport';
import { tsuReplayWriter } from './replay-pvp-tsu-storage';
import { toteAdmissionWriter } from './tote-admission';

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
  await applySchemaMigration(db, { id: 'paid-activity-audit-recorder-lock-v1', statements: [
    `ALTER TABLE audit_datasets ADD COLUMN capture_lock_permission boolean NOT NULL DEFAULT true CHECK (capture_lock_permission)`,
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

async function recorderReady(db: PostgresDatabase, scope: AuditScope, gameSchema?: string) {
  return db.transaction(async () => {
    const role = await db.prepare(`SELECT 1 FROM pg_roles r
      WHERE r.rolname=current_user AND r.rolname=session_user AND r.rolname<>'royal_game_app'
        AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
        AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN (?,?)
          AND has_schema_privilege(r.oid,n.oid,'CREATE'))`).get(db.schema, gameSchema ?? null);
    if (!role) return false;
    const permissions = await db.prepare(`SELECT
      has_table_privilege('audit_evidence','SELECT') AND has_table_privilege('audit_evidence','INSERT')
      AND has_table_privilege('audit_attempt_capture_gaps','SELECT') AND has_table_privilege('audit_attempt_capture_gaps','INSERT')
      AND has_column_privilege('audit_attempt_capture_gaps','missing_count','UPDATE')
      AND has_column_privilege('audit_attempt_capture_gaps','first_at_ms','UPDATE')
      AND has_column_privilege('audit_attempt_capture_gaps','last_at_ms','UPDATE')
      AND has_column_privilege('audit_datasets','capture_lock_permission','UPDATE')
      AND NOT has_table_privilege('audit_datasets','INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='audit_datasets'::regclass
        AND attnum>0 AND NOT attisdropped AND attname<>'capture_lock_permission'
        AND has_column_privilege(attrelid,attnum,'UPDATE')) AS allowed`).get();
    if (!permissions?.allowed) return false;
    const sourceWrites = await db.prepare(`SELECT 1 FROM audit_dataset_sources s
      JOIN pg_namespace n ON n.nspname=split_part(s.source_namespace,'.',1)
      WHERE s.dataset_id=? AND (has_schema_privilege(n.oid,'CREATE') OR EXISTS(
        SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','f')
          AND (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES')))) LIMIT 1`).get(scope.datasetId);
    if (sourceWrites) return false;
    // Exercise the actual boundary lock using the restricted login before attaching observers.
    return !!await db.prepare(`SELECT 1 FROM audit_datasets
      WHERE id=? AND environment=? AND sealed_at_ms IS NULL
        AND (?::text IS NULL OR EXISTS(SELECT 1 FROM audit_dataset_sources s
          WHERE s.dataset_id=audit_datasets.id AND s.source_namespace=?))
      FOR SHARE`).get(scope.datasetId, scope.environment, gameSchema ?? null, gameSchema ? gameSchema + '.demo_ledger' : null);
  });
}

/** Operator provisions the active dataset before enabling the transport observer. */
export function startAuditAttemptRuntime(env: NodeJS.ProcessEnv = process.env, gameSchema?: string) {
  const schema = env.ROYAL_AUDIT_SCHEMA || undefined;
  const test = env.ROYAL_AUDIT_TEST_DATASET_ID || undefined, live = env.ROYAL_AUDIT_LIVE_DATASET_ID || undefined;
  const configuredId = live ?? test;
  if (schema === undefined && configuredId === undefined) return;
  const disabled = (reason: 'configuration' | 'credential' | 'database') =>
    console.warn(JSON.stringify({ event: 'audit-attempt-capture-disabled', reason }));
  if ((live !== undefined && test !== undefined) || !schema || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || !configuredId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuredId)) {
    if (env.NODE_ENV === 'test') throw new Error('Audit attempts require a valid schema and exactly one test or live dataset ID');
    disabled('configuration');
    return;
  }
  const credential = env.ROYAL_AUDIT_RECORDER_DB_URL_FILE;
  let config: ReturnType<typeof databaseConfig>;
  try {
    if (credential !== undefined) {
      config = databaseConfig({ DATABASE_URL_FILE: credential, PGSSLMODE: env.ROYAL_AUDIT_PGSSLMODE,
        PGSSLROOTCERT: env.ROYAL_AUDIT_PGSSLROOTCERT, PGCONNECT_TIMEOUT_MS: '2000' });
      const url = new URL(config.connectionString ?? '');
      if (!url.username || !url.password || !url.hostname || url.pathname.length < 2 || url.search || url.hash) {
        throw new Error('Incomplete recorder URL');
      }
    } else if (env.NODE_ENV === 'test') config = databaseConfig(env);
    else {
      disabled('credential');
      return;
    }
  } catch {
    disabled('credential');
    return;
  }
  const datasetId = configuredId.toLowerCase();
  const db = new PostgresDatabase(schema, { existingSchema: true, config: {
    ...config, max: 1, statement_timeout: 2000, lock_timeout: 500, application_name: 'royal/audit-attempts',
  } });
  const producerId = randomUUID();
  const scope: AuditScope = { datasetId, environment: live !== undefined ? 'live' : 'test' };
  let accepting = credential === undefined;
  const ready = accepting ? Promise.resolve(true) : recorderReady(db, scope, gameSchema).then(value => value, () => false).then(value => {
    accepting = value;
    if (!value) disabled('database');
    return value;
  });
  const gate = <T>(record?: (value: T) => void) => record && ((value: T) => { if (accepting) record(value); });
  const chess = env.ROYAL_AUDIT_CHESS_REPLAY === '1' && gameSchema ? chessReplayWriter(db, scope, gameSchema) : undefined;
  const combat = env.ROYAL_AUDIT_COMBAT_REPLAY === '1' && gameSchema ? combatReplayWriter(db, scope, gameSchema) : undefined;
  const card = env.ROYAL_AUDIT_CARD_REPLAY === '1' && gameSchema ? cardsReplayWriter(db, scope, gameSchema) : undefined;
  const sport = env.ROYAL_AUDIT_SPORT_REPLAY === '1' && gameSchema ? sportReplayWriter(db, scope, gameSchema) : undefined;
  const tsu = env.ROYAL_AUDIT_TSU_REPLAY === '1' && gameSchema ? tsuReplayWriter(db, scope, gameSchema) : undefined;
  const tote = env.ROYAL_AUDIT_TOTE_ADMISSION === '1' && gameSchema ? toteAdmissionWriter(db, scope, gameSchema) : undefined;
  const evidence = new AuditEvidence(db, schema);
  const writer: CaptureWriter = {
    record: attempt => evidence.record(attempt),
    gap: gap => db.prepare(`INSERT INTO audit_attempt_capture_gaps(dataset_id,producer_id,missing_count,first_at_ms,last_at_ms)
      SELECT id,?, ?, ?, ? FROM audit_datasets WHERE id=? AND environment=? AND sealed_at_ms IS NULL FOR SHARE
      ON CONFLICT(dataset_id,producer_id) DO UPDATE SET missing_count=EXCLUDED.missing_count,
      first_at_ms=EXCLUDED.first_at_ms,last_at_ms=EXCLUDED.last_at_ms`)
      .run(producerId, gap.count, gap.firstAtMs, gap.lastAtMs, datasetId, scope.environment),
  };
  const recorder = new AuditAttemptRecorder(scope, writer, count => {
    console.warn(JSON.stringify({ event: 'audit-attempt-capture-gap', datasetId, producerId, missingCount: count }));
  });
  return {
    ready,
    record: (value: AuditAttemptObservation) => { if (accepting) recorder.record(value); },
    recordChess: gate(chess?.record),
    recordCombat: gate(combat?.record),
    recordCard: gate(card?.record),
    recordSport: gate(sport?.record),
    recordTsu: gate(tsu?.record),
    recordToteAdmission: gate(tote?.record),
    async close() {
      await ready;
      accepting = false;
      await Promise.all([recorder.stop(), chess?.stop(), combat?.stop(), card?.stop(), sport?.stop(), tsu?.stop(), tote?.stop()]);
      await db.close();
    },
  };
}
