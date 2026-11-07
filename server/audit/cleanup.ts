import { createHash } from 'node:crypto';
import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { auditCleanupSourceRelations, inspectAuditCleanupSources } from './cleanup-guards';
import { inspectAuditExportFiles, removeAuditExportFiles, revalidateAuditExportFiles, type AuditExportFileManifest } from './cleanup-files';
import { auditCleanupCrossReferences, auditCleanupTables, deleteAuditCleanupRows, inspectAuditCleanupRows,
  type CleanupRowManifest } from './cleanup-inventory';
import { AuditDatasets, type AuditSourceSchemas } from './datasets';
import { isReplayId } from './replay-package';

type Request = { datasetId: string; sources: AuditSourceSchemas; filesRoot: string };
type ManifestBody = {
  schemaVersion: 1;
  datasetId: string;
  environment: 'test';
  auditSchema: string;
  sources: AuditSourceSchemas;
  startedAtMs: number;
  sealedAtMs: number | null;
  rows: CleanupRowManifest[];
  files: AuditExportFileManifest;
  protectedSourceSha256: string;
  blockers: string[];
};
export type AuditCleanupManifest = ManifestBody & { sha256: string };
type Journal = {
  sha256: string; manifest: AuditCleanupManifest; live_dataset_id: string; started_at_ms: number; files_completed_at_ms: number | null;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Invalid audit cleanup manifest value');
  return encoded;
}

const digest = (body: unknown) => createHash('sha256').update(canonical(body)).digest('hex');
const relation = (schema: string, table: string) => identifier(schema) + '.' + identifier(table);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class AuditCleanupBlocked extends Error {
  constructor(readonly blockers: string[]) { super('Audit cleanup blocked'); }
}

export async function installAuditCleanup(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-cleanup-v1', statements: [
    `CREATE TABLE audit_cleanup_runs (
      test_dataset_id uuid PRIMARY KEY REFERENCES audit_datasets(id),
      live_dataset_id uuid NOT NULL UNIQUE REFERENCES audit_datasets(id),
      sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
      manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=1048576),
      started_at_ms bigint NOT NULL,
      files_completed_at_ms bigint CHECK(files_completed_at_ms>=started_at_ms),
      CHECK(test_dataset_id<>live_dataset_id)
    )`,
    'REVOKE ALL ON TABLE audit_cleanup_runs FROM PUBLIC',
  ] });
}

async function testDataset(db: PostgresDatabase, datasetId: string) {
  if (!isReplayId(datasetId)) throw new AuditCleanupBlocked(['invalid-test-dataset-id']);
  const row = await db.prepare(`SELECT started_at_ms,sealed_at_ms FROM ONLY ${relation(db.schema,'audit_datasets')}
    WHERE id=? AND environment='test'`).get(datasetId);
  if (!row) throw new AuditCleanupBlocked(['test-dataset-required']);
  return row as { started_at_ms: number; sealed_at_ms: number | null };
}

export async function requireAuditCleanupExportDataset(db: PostgresDatabase, datasetId: string) {
  if (!db.inTransaction) throw new Error('Managed audit export registration requires the dataset lock');
  await testDataset(db, datasetId);
  const journal = await db.prepare('SELECT to_regclass(?) IS NOT NULL AS present').get(db.schema + '.audit_cleanup_runs');
  if (journal?.present && await currentJournal(db, datasetId)) throw new AuditCleanupBlocked(['test-dataset-already-cleaned']);
}

async function snapshot(db: PostgresDatabase, input: Request, files: AuditExportFileManifest) {
  const dataset = await testDataset(db, input.datasetId);
  const inspected = await auditCleanupTables(db);
  const rowSet = await inspectAuditCleanupRows(db, input.datasetId, inspected.tables);
  const sources = inspected.blockers.length ? { blockers: [], proof: digest('unavailable'), refKeys: [] }
    : await inspectAuditCleanupSources(db, input.sources, input.datasetId);
  const overlaps = inspected.blockers.length ? [] : await auditCleanupCrossReferences(db, input.datasetId, inspected.tables, sources.refKeys);
  const otherActive = await db.prepare(`SELECT 1 FROM ${relation(db.schema,'audit_datasets')}
    WHERE id<>? AND sealed_at_ms IS NULL LIMIT 1`).get(input.datasetId);
  const blockers = [...inspected.blockers, ...rowSet.blockers, ...sources.blockers, ...overlaps];
  if (dataset.sealed_at_ms === null) blockers.push('test-dataset-not-sealed');
  if (otherActive) blockers.push('another-dataset-is-active');
  const body: ManifestBody = {
    schemaVersion: 1, datasetId: input.datasetId, environment: 'test', auditSchema: db.schema,
    sources: { game: input.sources.game, ...(input.sources.payments ? { payments: input.sources.payments } : {}) },
    startedAtMs: dataset.started_at_ms, sealedAtMs: dataset.sealed_at_ms, rows: rowSet.manifest, files,
    protectedSourceSha256: sources.proof, blockers: [...new Set(blockers)].sort(),
  };
  return { manifest: { ...body, sha256: digest(body) }, source: sources };
}

/** The preview never installs schemas, seals a dataset, or changes an export. */
export async function previewAuditCleanup(db: PostgresDatabase, input: Request): Promise<AuditCleanupManifest> {
  await testDataset(db, input.datasetId);
  const files = await inspectAuditExportFiles(input.filesRoot, input.datasetId);
  return db.transaction(async () => {
    await db.exec("SET LOCAL transaction_timeout='30s'; SET LOCAL statement_timeout='3s'; SET LOCAL TIME ZONE 'UTC'");
    return (await snapshot(db, input, files)).manifest;
  }, { readOnly: true });
}

async function currentJournal(db: PostgresDatabase, id: string) {
  const row = await db.prepare(`SELECT sha256,manifest,live_dataset_id::text,started_at_ms,files_completed_at_ms
    FROM ${relation(db.schema,'audit_cleanup_runs')} WHERE test_dataset_id=?`).get(id);
  return row as Journal | undefined;
}

function verifyJournal(db: PostgresDatabase, input: Request, expectedSha256: string, row: Journal) {
  const { sha256, ...body } = row.manifest;
  if (row.sha256 !== expectedSha256 || sha256 !== expectedSha256 || digest(body) !== expectedSha256 ||
      body.datasetId !== input.datasetId || body.auditSchema !== db.schema || body.environment !== 'test' ||
      body.sources.game !== input.sources.game || body.sources.payments !== input.sources.payments) {
    throw new AuditCleanupBlocked(['cleanup-journal-mismatch']);
  }
}

async function lockTables(db: PostgresDatabase, names: string[]) {
  const quoted = [...new Set(names)].sort().map(name => {
    const [schema, table, extra] = name.split('.');
    if (extra !== undefined || ![schema,table].every(part => /^[a-z_][a-z_0-9]{0,62}$/.test(part ?? ''))) {
      throw new AuditCleanupBlocked(['invalid-source-relation']);
    }
    return relation(schema,table);
  });
  if (quoted.length) await db.exec('LOCK TABLE ' + quoted.map(name => 'ONLY ' + name).join(', ') + ' IN SHARE ROW EXCLUSIVE MODE NOWAIT');
}

/** Recheck the reviewed plan, purge only audit rows and create a fresh live checkpoint atomically. */
export async function applyAuditCleanup(db: PostgresDatabase, input: Request & { expectedSha256: string }) {
  if (!hash(input.expectedSha256)) throw new AuditCleanupBlocked(['invalid-manifest-sha256']);
  if ((await testDataset(db, input.datasetId)).sealed_at_ms === null) throw new AuditCleanupBlocked(['test-dataset-not-sealed']);
  const known = await currentJournal(db, input.datasetId);
  if (known) verifyJournal(db, input, input.expectedSha256, known);
  const files = known ? null : await inspectAuditExportFiles(input.filesRoot, input.datasetId);
  const datasets = new AuditDatasets(db, input.sources, { existingSchema: true });
  const row = known ?? await db.transaction(async () => {
    await db.exec("SET LOCAL transaction_timeout='30s'; SET LOCAL statement_timeout='3s'; SET LOCAL TIME ZONE 'UTC'");
    const repeated = await currentJournal(db, input.datasetId);
    if (repeated) {
      verifyJournal(db, input, input.expectedSha256, repeated);
      return repeated;
    }
    const { tables, blockers } = await auditCleanupTables(db);
    if (blockers.length) throw new AuditCleanupBlocked(blockers);
    const sources = await auditCleanupSourceRelations(db, input.sources);
    await lockTables(db, [...tables, 'audit_datasets', 'audit_cleanup_runs'].map(table => db.schema + '.' + table).concat(sources));
    const before = await snapshot(db, input, files!);
    if (before.manifest.blockers.length) throw new AuditCleanupBlocked(before.manifest.blockers);
    if (before.manifest.sha256 !== input.expectedSha256) throw new AuditCleanupBlocked(['manifest-changed']);
    await revalidateAuditExportFiles(input.filesRoot, before.manifest.files);
    await deleteAuditCleanupRows(db, input.datasetId, before.manifest.rows);
    const live = await datasets.startLiveInCleanupTransaction(input.datasetId);
    await db.prepare(`INSERT INTO ${relation(db.schema,'audit_cleanup_runs')}
      (test_dataset_id,live_dataset_id,sha256,manifest,started_at_ms) VALUES (?,?,?,?::jsonb,?)`)
      .run(input.datasetId, live.datasetId, input.expectedSha256, JSON.stringify(before.manifest), live.startedAtMs);
    const after = await inspectAuditCleanupSources(db, input.sources, input.datasetId, before.source.refKeys);
    if (after.blockers.length || after.proof !== before.source.proof) throw new AuditCleanupBlocked(['protected-source-changed']);
    return { sha256: input.expectedSha256, manifest: before.manifest, live_dataset_id: live.datasetId,
      started_at_ms: live.startedAtMs, files_completed_at_ms: null };
  }, { lockKey: 'audit-dataset' });

  const result = { testDatasetId: input.datasetId, liveDatasetId: row.live_dataset_id, liveStartedAtMs: row.started_at_ms,
    sha256: row.sha256 };
  if (row.files_completed_at_ms === null) {
    try {
      const filesResult = await removeAuditExportFiles(input.filesRoot, row.manifest.files);
      await db.prepare(`UPDATE ${relation(db.schema,'audit_cleanup_runs')}
        SET files_completed_at_ms=GREATEST(started_at_ms,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
        WHERE test_dataset_id=? AND sha256=? AND files_completed_at_ms IS NULL`).run(input.datasetId, row.sha256);
      return { ...result, status: 'complete' as const, files: filesResult };
    } catch {
      return { ...result, status: 'files-pending' as const };
    }
  }
  return { ...result, status: 'complete' as const };
}
