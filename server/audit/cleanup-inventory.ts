import { identifier, type PostgresDatabase } from '../database';

// Child tables precede their parents. The dataset row is retained as a sealed identity.
const deletionOrder = [
  'audit_reconcile_requests', 'audit_report_acl', 'audit_export_jobs', 'audit_replay_fragments',
  'audit_replay_packages', 'audit_risk_signals', 'audit_attempt_capture_gaps', 'audit_evidence',
  'audit_opening_obligations', 'audit_opening_balances', 'audit_posting_refs', 'audit_dataset_sources',
] as const;
type CleanupTable = (typeof deletionOrder)[number];
const optionalTables = new Set<CleanupTable>(['audit_reconcile_requests', 'audit_report_acl', 'audit_export_jobs']);
export type CleanupRowManifest = { table: CleanupTable; rows: number; sha256: string; limited: boolean };
const maxRows = 20_000;
const maxTableBytes = 64 * 1024 * 1024;
const maxForeignRecords = 2048;
const maxForeignBytes = 16 * 1024 * 1024;

const jsonColumns = [
  ['audit_evidence', 'payload'], ['audit_replay_packages', 'manifest'], ['audit_replay_fragments', 'fragment'],
  ['audit_risk_signals', 'signal'], ['audit_reconcile_requests', 'result'],
] as const;

export async function auditCleanupTables(db: PostgresDatabase) {
  const rows = await db.prepare(`SELECT c.relname AS name,c.relkind,
      c.relkind='r' AND c.relpersistence='p' AND NOT c.relrowsecurity AND NOT EXISTS(
        SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid
      ) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid) AS ordinary,
      EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='dataset_id'
        AND a.attnum>0 AND NOT a.attisdropped) AS scoped
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=? AND c.relkind IN ('r','p','f')`).all(db.schema);
  const present = new Map(rows.map(row => [row.name as string, row]));
  const known = new Set<string>([...deletionOrder, 'audit_datasets']);
  const tables = deletionOrder.filter(table => present.get(table)?.ordinary && present.get(table)?.scoped);
  const blockers: string[] = [];
  if (rows.some(row => row.scoped && !known.has(row.name)) ||
      deletionOrder.some(table => present.has(table) && !tables.includes(table)) ||
      !present.get('audit_datasets')?.ordinary) blockers.push('unknown-audit-table');
  if (deletionOrder.some(table => !optionalTables.has(table) && !tables.includes(table))) {
    blockers.push('audit-schema-incomplete');
  }
  return { tables, blockers };
}

export async function inspectAuditCleanupRows(db: PostgresDatabase, datasetId: string, tables: readonly CleanupTable[]) {
  const manifest: CleanupRowManifest[] = [], blockers: string[] = [];
  const schema = identifier(db.schema);
  for (const table of tables) {
    const row = await db.prepare(`WITH picked AS MATERIALIZED (
        SELECT * FROM ONLY ${schema}.${identifier(table)} WHERE dataset_id=? LIMIT ?
      ), payloads AS MATERIALIZED (SELECT pg_catalog.to_jsonb(picked)::text AS body FROM picked),
      sizes AS (SELECT count(*)::int AS rows,COALESCE(sum(pg_catalog.octet_length(body)),0) AS bytes FROM payloads)
      SELECT sizes.rows,sizes.bytes,CASE WHEN sizes.rows<=? AND sizes.bytes<=? THEN (
        SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(
          pg_catalog.string_agg(digest,'' ORDER BY digest COLLATE "C"),''),'UTF8')),'hex')
        FROM (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex') AS digest
          FROM payloads) hashes
      ) END AS sha256 FROM sizes`).get(datasetId, maxRows + 1, maxRows, maxTableBytes);
    const limited = typeof row?.sha256 !== 'string';
    if (limited) blockers.push('inventory-limit:' + table);
    manifest.push({ table, rows: row!.rows, sha256: row?.sha256 ?? '', limited });
  }
  const unexpectedConstraint = await db.prepare(`SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class parent ON parent.oid=c.confrelid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_catalog.pg_class child ON child.oid=c.conrelid
    JOIN pg_catalog.pg_namespace cn ON cn.oid=child.relnamespace
    WHERE c.contype='f' AND pn.nspname=? AND parent.relname=ANY(?::text[])
      AND (c.confdeltype NOT IN ('a','r') OR NOT (cn.nspname=? AND child.relname=ANY(?::text[]))) LIMIT 1`)
    .get(db.schema, tables, db.schema, tables);
  const trigger = await db.prepare(`SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=? AND c.relname=ANY(?::text[]) AND NOT t.tgisinternal AND t.tgenabled<>'D' LIMIT 1`)
    .get(db.schema, tables);
  if (unexpectedConstraint || trigger) blockers.push('unexpected-audit-dependency');
  if (tables.includes('audit_export_jobs') && await db.prepare(`SELECT 1 FROM ${schema}.audit_export_jobs
    WHERE dataset_id=? AND status='running' AND expires_at>pg_catalog.clock_timestamp() LIMIT 1`).get(datasetId)) {
    blockers.push('active-export-jobs');
  }
  if (tables.includes('audit_reconcile_requests') && await db.prepare(`SELECT 1 FROM ${schema}.audit_reconcile_requests
    WHERE dataset_id=? AND status IN ('queued','running') LIMIT 1`).get(datasetId)) blockers.push('active-reconcile-requests');
  return { manifest, blockers };
}

type SourceKey = { sourceNamespace: string; rowId: string };

function refersToRemovedEvidence(root: unknown, datasetId: string, postingKeys: Set<string>, auditNamespaces: Set<string>) {
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.datasetId === datasetId || record.dataset_id === datasetId) return true;
    if (typeof record.namespace === 'string' && typeof record.rowId === 'string') {
      if (postingKeys.has(JSON.stringify([record.namespace, record.rowId]))) return true;
      if (auditNamespaces.has(record.namespace) && record.rowId.startsWith('[') && record.rowId.length <= 2048) {
        try {
          const tuple: unknown = JSON.parse(record.rowId);
          if (Array.isArray(tuple) && tuple[0] === datasetId) return true;
        } catch { /* Only structured references count as tuple keys. */ }
      }
    }
    for (const item of Object.values(record)) pending.push(item);
  }
  return false;
}

export async function auditCleanupCrossReferences(
  db: PostgresDatabase, datasetId: string, tables: readonly CleanupTable[], refs: readonly SourceKey[],
) {
  const schema = identifier(db.schema), blockers: string[] = [];
  const foreign = await db.prepare(`SELECT id FROM ${schema}.audit_datasets WHERE id<>? LIMIT 129`).all(datasetId);
  if (foreign.length > 128) return ['foreign-dataset-scan-limit'];
  if (foreign.length && tables.includes('audit_posting_refs') && await db.prepare(`SELECT 1
    FROM ${schema}.audit_posting_refs owned CROSS JOIN pg_catalog.unnest(?::uuid[]) d(id)
    JOIN ${schema}.audit_posting_refs other ON other.dataset_id=d.id AND other.source_namespace=owned.source_namespace
      AND other.source_row_id=owned.source_row_id
    WHERE owned.dataset_id=? LIMIT 1`).get(foreign.map(row => row.id), datasetId)) blockers.push('shared-posting-reference');
  const postingKeys = new Set(refs.map(ref => JSON.stringify([ref.sourceNamespace, ref.rowId])));
  const auditNamespaces = new Set(tables.map(table => db.schema + '.' + table));
  for (const [table, column] of jsonColumns) {
    if (!tables.includes(table) || !foreign.length) continue;
    const rows = await db.prepare(`WITH picked AS MATERIALIZED (
        SELECT ${identifier(column)} AS body FROM ${schema}.${identifier(table)}
        WHERE dataset_id=ANY(?::uuid[]) AND ${identifier(column)} IS NOT NULL LIMIT ?
      ), sized AS MATERIALIZED (SELECT body,pg_catalog.octet_length(body::text) AS bytes FROM picked)
      SELECT bytes,CASE WHEN sum(bytes) OVER ()<=? THEN body END AS body FROM sized`)
      .all(foreign.map(row => row.id), maxForeignRecords + 1, maxForeignBytes);
    if (rows.length > maxForeignRecords || rows.some(row => row.body === null)) {
      blockers.push('foreign-reference-scan-limit:' + table);
    } else if (rows.some(row => refersToRemovedEvidence(row.body, datasetId, postingKeys, auditNamespaces))) {
      blockers.push('foreign-derived-reference:' + table);
    }
  }
  return blockers;
}

export async function deleteAuditCleanupRows(db: PostgresDatabase, datasetId: string, manifest: readonly CleanupRowManifest[]) {
  if (!db.inTransaction) throw new Error('Audit deletion requires a protected transaction');
  const schema = identifier(db.schema);
  for (const table of deletionOrder) {
    const expected = manifest.find(row => row.table === table);
    if (!expected) continue;
    const result = await db.prepare(`DELETE FROM ONLY ${schema}.${identifier(table)} WHERE dataset_id=?`).run(datasetId);
    if (expected.limited || result.changes !== expected.rows ||
        await db.prepare(`SELECT 1 FROM ONLY ${schema}.${identifier(table)} WHERE dataset_id=? LIMIT 1`).get(datasetId)) {
      throw new Error('Audit cleanup deletion count changed');
    }
  }
}
