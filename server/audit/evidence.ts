import { createHash } from 'node:crypto';
import { isAuditRecord } from './contract';
import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';

export async function migrateAuditEvidence(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-evidence-v1', statements: [
    `CREATE TABLE audit_evidence(
      dataset_id uuid REFERENCES audit_datasets(id), kind text CHECK(kind IN ('event','attempt','replay')),
      evidence_id text, account_id text, occurred_at_ms bigint NOT NULL, payload jsonb NOT NULL,
      PRIMARY KEY(dataset_id,kind,evidence_id)
    )`,
    `CREATE INDEX audit_evidence_player ON audit_evidence(dataset_id,account_id,occurred_at_ms,kind,evidence_id)`,
  ] });
}

/** Use the source database instance to include an event in an existing source transaction. */
export class AuditEvidence {
  private readonly tables: string;
  constructor(private readonly db: PostgresDatabase, auditSchema: string) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(auditSchema)) throw new Error('Invalid audit schema');
    this.tables = identifier(auditSchema) + '.';
  }

  async record(value: unknown): Promise<'recorded' | 'replayed'> {
    if (!isAuditRecord(value) || value.type === 'posting') throw new Error('Invalid audit evidence');
    const id = value.type === 'event' ? value.eventId : value.type === 'attempt' ? value.attemptId : value.replayId;
    const account = value.type === 'replay' ? null : value.accountId;
    const { datasetId, environment } = value.scope;
    const { type, occurredAtMs } = value;
    const payload = JSON.stringify(value);
    const find = () => this.db.prepare(`SELECT payload=?::jsonb AS matches FROM ${this.tables}audit_evidence
      WHERE dataset_id=? AND kind=? AND evidence_id=?`).get(payload, datasetId, type, id);
    const replay = (previous: { matches?: boolean }) => {
      if (!previous.matches) throw new Error('Audit evidence ID reused with different content');
      return 'replayed' as const;
    };
    const write = async () => {
      const previous = await find();
      if (previous) return replay(previous);
      const dataset = await this.db.prepare(`SELECT environment,started_at_ms,sealed_at_ms FROM ${this.tables}audit_datasets
        WHERE id=? FOR SHARE`).get(datasetId);
      if (!dataset || dataset.environment !== environment || dataset.sealed_at_ms !== null || occurredAtMs < dataset.started_at_ms) {
        throw new Error('Audit evidence requires an active matching dataset');
      }
      const result = await this.db.prepare(`INSERT INTO ${this.tables}audit_evidence
        (dataset_id,kind,evidence_id,account_id,occurred_at_ms,payload) VALUES (?,?,?,?,?,?::jsonb)
        ON CONFLICT DO NOTHING`).run(datasetId, type, id, account, occurredAtMs, payload);
      if (result.changes) return 'recorded' as const;
      return replay((await find())!);
    };
    if (this.db.inTransaction) return write();
    const key = createHash('sha256').update(JSON.stringify([datasetId, type, id])).digest('hex');
    return this.db.transaction(write, { lockKey: 'paid-audit-evidence:' + key });
  }
}
