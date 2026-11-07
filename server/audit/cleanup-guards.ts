import { createHash } from 'node:crypto';
import { identifier, type PostgresDatabase } from '../database';
import type { AuditSourceSchemas } from './datasets';

const maximumPostingRefs = 20_000;
const maximumProtectedRows = 20_000;
const maximumProtectedRowBytes = 1024 * 1024;
const maximumProtectedTableBytes = 32 * 1024 * 1024;
const sourceProofTimeBudgetMs = 10_000;
const ledgerEdgeRows = 16;
const maxLedgerId = 9_223_372_036_854_775_807n;
const validName = (value: string) => /^[a-z_][a-z0-9_]{0,62}$/.test(value);
const validId = (value: unknown): value is string => typeof value === 'string' &&
  /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= maxLedgerId;
const datasetUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const relation = (schema: string, table: string) => identifier(schema) + '.' + identifier(table);
const rowDigest = "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(to_jsonb(s)::text,'UTF8')),'hex')";
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type AuditCleanupPostingRef = { sourceNamespace: string; rowId: string };
type Source = {
  schema: string;
  table: string;
  optional?: boolean;
  proof?: 'wallet' | 'retained';
  ledger?: true;
  open?: string;
};
type Inventory = { oid: string; ordinary: boolean; selectable: boolean };

function definitions(db: PostgresDatabase, { game, payments }: AuditSourceSchemas): Source[] {
  const names = [db.schema, game, ...(payments === undefined ? [] : [payments])];
  if (names.some(name => !validName(name)) || new Set(names).size !== names.length) {
    throw new Error('Invalid audit cleanup source configuration');
  }
  const g = identifier(game);
  const inGame: Omit<Source, 'schema'>[] = [
    { table: 'demo_ledger', ledger: true },
    { table: 'capro_pending_ledger', ledger: true },
    { table: 'demo_wallets', proof: 'wallet' },
    { table: 'capro_pending_balances', proof: 'wallet', open: "s.pending_units<>'0'" },
    { table: 'demo_operations', proof: 'retained' },
    { table: 'demo_casino_sessions', proof: 'retained', open: "s.state NOT IN ('settled','lost','cashed_out') OR s.reserved_units<>0" },
    { table: 'demo_casino_requests', proof: 'retained' },
    { table: 'demo_flight_sessions', proof: 'retained', open: "s.state='active' OR s.reserved_units<>0" },
    { table: 'demo_flight_requests', proof: 'retained' },
    { table: 'demo_mines_sessions', proof: 'retained', open: "s.state='active' OR s.reserved_units<>0" },
    { table: 'demo_mines_requests', proof: 'retained' },
    { table: 'virtual_pvp_banks', proof: 'retained', open: "s.state='open'" },
    { table: 'virtual_pvp_holds', proof: 'retained', open: "s.state='held'" },
    { table: 'flag_tote_rounds', proof: 'retained', open: `s.state IN ('open','racing') AND
      EXISTS (SELECT 1 FROM ${g}.flag_tote_tickets t WHERE t.round_id=s.id)` },
    { table: 'flag_tote_tickets', proof: 'retained' },
    { table: 'flag_tote_reservations', proof: 'retained', open: 'true' },
    { table: 'skin_purchases', proof: 'retained', open: "s.state='reserved'" },
    { table: 'pvp_matches', proof: 'retained', optional: true, open: `s.status NOT IN ('finished','cancelled') AND
      CASE WHEN pg_catalog.pg_input_is_valid(s.payload,'jsonb') THEN
        NOT (COALESCE(s.payload::jsonb #>> '{challenge,mode}','')='free' AND
          COALESCE(s.payload::jsonb #>> '{challenge,stakeUnits}','')='0')
      ELSE true END` },
    { table: 'pvp_requests', proof: 'retained', optional: true },
    { table: 'combat_matches', proof: 'retained', optional: true, open: "s.state='active'" },
    { table: 'combat_seats', proof: 'retained', optional: true, open: 'true' },
    { table: 'nowpayments_sandbox_deposits', proof: 'retained', optional: true, open: "s.state NOT IN ('finished','failed','refunded','expired')" },
    { table: 'capro_transactions', proof: 'retained', optional: true },
    { table: 'removed_casino_settlements', proof: 'retained', optional: true },
    { table: 'payment_credit_wallets', proof: 'wallet', optional: true, open: 's.reserved_units<>0' },
    { table: 'payment_credit_events', proof: 'retained', optional: true },
  ];
  const inPayments: Omit<Source, 'schema'>[] = [
    { table: 'crypto_ledger', ledger: true },
    { table: 'crypto_wallets', proof: 'wallet', open: 's.reserved_units<>0' },
    { table: 'crypto_operations', proof: 'retained', open: "s.state NOT IN ('finished','rejected','expired','refunded')" },
    { table: 'crypto_wallet_holds', proof: 'retained', open: 'true' },
    { table: 'payment_outbox', proof: 'retained', open: 's.delivered_at IS NULL' },
    { table: 'finance_adjustments', proof: 'retained', optional: true },
    { table: 'telegram_stars_orders', proof: 'retained', optional: true, open: `s.state='checkout'
      OR (s.state='waiting' AND (s.checkout_id IS NOT NULL OR
        s.expires_at>extract(epoch from pg_catalog.transaction_timestamp())*1000))
      OR s.state NOT IN ('waiting','checkout','paid','refunded','expired')` },
  ];
  return [
    ...inGame.map(source => ({ ...source, schema: game })),
    ...(payments ? inPayments.map(source => ({ ...source, schema: payments })) : []),
  ].sort((a, b) => sourceName(a) < sourceName(b) ? -1 : sourceName(a) > sourceName(b) ? 1 : 0);
}

function sourceName(source: Source) {
  return source.schema + '.' + source.table;
}

async function readInventory(db: PostgresDatabase, sources: Source[]): Promise<Map<string, Inventory>> {
  const rows = await db.prepare(`SELECT n.nspname||'.'||c.relname AS name,c.oid::text AS oid,
    c.relkind='r' AND c.relpersistence='p' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i
      WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS ordinary,
    NOT c.relrowsecurity AND pg_catalog.has_table_privilege(c.oid,'SELECT')
      AND pg_catalog.has_schema_privilege(n.oid,'USAGE') AS selectable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY(?::text[]) AND c.relname=ANY(?::text[])`)
    .all([...new Set(sources.map(source => source.schema))], sources.map(source => source.table));
  const declared = new Set(sources.map(sourceName));
  return new Map(rows.flatMap(row => declared.has(row.name)
    ? [[row.name, { oid: row.oid, ordinary: row.ordinary === true, selectable: row.selectable === true }] as const] : []));
}

/** Lock these sorted relations before an apply-side read in the same READ COMMITTED transaction. */
export async function auditCleanupSourceRelations(db: PostgresDatabase, sources: AuditSourceSchemas): Promise<string[]> {
  const declared = definitions(db, sources);
  const present = await readInventory(db, declared);
  return declared.map(sourceName).filter(name => present.get(name)?.ordinary);
}

function validRefKeys(keys: readonly AuditCleanupPostingRef[], ledgers: Set<string>) {
  if (!Array.isArray(keys) || keys.length > maximumPostingRefs) return false;
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key || typeof key !== 'object' || !ledgers.has(key.sourceNamespace) || !validId(key.rowId)) return false;
    const id = key.sourceNamespace + '/' + key.rowId;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

async function sourceRead<T>(db: PostgresDatabase, name: string, blockers: Set<string>, read: () => Promise<T>) {
  await db.exec('SAVEPOINT audit_cleanup_source_read');
  try {
    const result = await read();
    await db.exec('RELEASE SAVEPOINT audit_cleanup_source_read');
    return result;
  } catch {
    await db.exec('ROLLBACK TO SAVEPOINT audit_cleanup_source_read');
    await db.exec('RELEASE SAVEPOINT audit_cleanup_source_read');
    blockers.add('source-read-failed:' + name);
    return undefined;
  }
}

/** Run inside the caller's snapshot. Keep refKeys only in memory for the post-delete proof. */
export async function inspectAuditCleanupSources(db: PostgresDatabase, sources: AuditSourceSchemas, datasetId: string,
  previousRefKeys?: readonly AuditCleanupPostingRef[]): Promise<{ blockers: string[]; proof: string; refKeys: AuditCleanupPostingRef[] }> {
  if (!db.inTransaction) throw new Error('Audit cleanup inspection requires a caller transaction');
  if (!datasetUuid.test(datasetId)) throw new Error('Invalid audit cleanup dataset identity');
  const deadline = performance.now() + sourceProofTimeBudgetMs;
  const declared = definitions(db, sources), available = await readInventory(db, declared);
  const ledgers = new Set(declared.filter(source => source.ledger).map(sourceName));
  const blockers = new Set<string>(), protectedProof: unknown[] = [], ledgerProof: unknown[] = [], postingProof: unknown[] = [];
  const audit = identifier(db.schema);
  const referenceTable = audit + '.audit_posting_refs';
  for (const pair of [['combat_matches', 'combat_seats'], ['payment_credit_wallets', 'payment_credit_events'], ['pvp_matches', 'pvp_requests']]) {
    const [a, b] = pair.map(table => sources.game + '.' + table);
    if (available.has(a) !== available.has(b)) blockers.add('source-unavailable:' + (available.has(a) ? b : a));
  }
  let refKeys: AuditCleanupPostingRef[] = [];
  if (previousRefKeys === undefined) {
    const registered = await db.prepare(`SELECT source_namespace FROM ${audit}.audit_dataset_sources
      WHERE dataset_id=? ORDER BY source_namespace LIMIT ?`).all(datasetId, ledgers.size + 1);
    if (registered.length !== ledgers.size || registered.some(row => !ledgers.has(row.source_namespace))) {
      blockers.add('dataset-source-set-mismatch');
    }
    const selected = await db.prepare(`SELECT source_namespace,source_row_id::text AS row_id FROM ${referenceTable}
      WHERE dataset_id=? ORDER BY source_namespace,source_row_id LIMIT ?`).all(datasetId, maximumPostingRefs + 1);
    if (selected.length > maximumPostingRefs) blockers.add('posting-reference-limit');
    else refKeys = selected.map(row => ({ sourceNamespace: row.source_namespace, rowId: row.row_id }));
  } else if (!validRefKeys(previousRefKeys, ledgers)) blockers.add('posting-reference-invalid');
  else refKeys = previousRefKeys.map(({ sourceNamespace, rowId }) => ({ sourceNamespace, rowId }));

  if (!validRefKeys(refKeys, ledgers)) {
    blockers.add('posting-reference-invalid');
    refKeys = [];
  }
  const chosen = new Map<string, string[]>();
  for (const { sourceNamespace, rowId } of refKeys) {
    const rows = chosen.get(sourceNamespace);
    if (rows) rows.push(rowId);
    else chosen.set(sourceNamespace, [rowId]);
  }

  for (const source of declared) {
    if (performance.now() >= deadline) {
      blockers.add('source-proof-time-limit');
      break;
    }
    const name = sourceName(source);
    const found = available.get(name);
    if (!found) {
      if (!source.optional) blockers.add('source-unavailable:' + name);
      continue;
    }
    if (!found.ordinary || !found.selectable) {
      blockers.add('source-unavailable:' + name);
      continue;
    }
    const table = relation(source.schema, source.table);
    if (source.open) {
      const open = await sourceRead(db, name, blockers, () => db.prepare(`SELECT 1 FROM ${table} s WHERE ${source.open} LIMIT 1`).get());
      if (open) blockers.add('open-financial-source:' + name);
    }
    if (source.proof) {
      const rows = await sourceRead(db, name, blockers, () => db.prepare(`SELECT sizes.bytes,
        CASE WHEN sizes.bytes<=${maximumProtectedRowBytes}
          THEN pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload.body,'UTF8')),'hex') END AS digest
        FROM (SELECT * FROM ${table} LIMIT ?) s
        CROSS JOIN LATERAL (SELECT to_jsonb(s)::text AS body OFFSET 0) payload
        CROSS JOIN LATERAL (SELECT octet_length(payload.body) AS bytes OFFSET 0) sizes`).all(maximumProtectedRows + 1));
      if (rows && (rows.length > maximumProtectedRows || rows.some(row => !row.digest) ||
          rows.reduce((sum, row) => sum + Number(row.bytes), 0) > maximumProtectedTableBytes)) {
        blockers.add(source.proof + '-proof-limit:' + name);
      } else if (rows) protectedProof.push([name, rows.length, fingerprint(rows.map(row => row.digest).sort())]);
    }
    if (!source.ledger) continue;
    const edges = await sourceRead(db, name, blockers, () => db.prepare(`
      (SELECT s.id::text AS id,${rowDigest} AS digest FROM ${table} s ORDER BY s.id ASC LIMIT ?)
      UNION ALL
      (SELECT s.id::text AS id,${rowDigest} AS digest FROM ${table} s ORDER BY s.id DESC LIMIT ?)`)
      .all(ledgerEdgeRows, ledgerEdgeRows));
    if (edges) {
      // Sort the exact edge rows independently of UNION execution order.
      const edgeKeys = edges.map(row => row.id + ':' + row.digest).sort();
      ledgerProof.push([name, edgeKeys]);
    }
    const selected = chosen.get(name) ?? [];
    if (!selected.length) continue;
    const verifyCapture = previousRefKeys === undefined;
    const rows = await sourceRead(db, name, blockers, () => db.prepare(`SELECT s.id::text AS id,${rowDigest} AS digest
      FROM unnest(?::bigint[]) k(id) JOIN ${table} s ON s.id=k.id
      ${verifyCapture ? `JOIN ${referenceTable} r ON r.dataset_id=? AND r.source_namespace=?
        AND r.source_row_id=s.id AND r.account_id=s.account_id AND r.operation_id=s.operation_id AND r.occurred_at_ms=s.created_at` : ''}
      ORDER BY s.id`).all(selected, ...(verifyCapture ? [datasetId, name] : [])));
    if (!rows || rows.length !== selected.length) blockers.add('captured-posting-unavailable:' + name);
    if (rows) postingProof.push([name, rows.map(row => [row.id, row.digest])]);
  }
  if (performance.now() >= deadline) blockers.add('source-proof-time-limit');
  const inventory = declared.flatMap(source => {
    const name = sourceName(source), found = available.get(name);
    return found ? [[name, found.oid]] : [];
  });
  return {
    blockers: [...blockers].sort(),
    proof: fingerprint({ version: 1, datasetId, ledgerNamespaces: [...ledgers], inventory, protectedProof, ledgerProof, postingProof }),
    refKeys,
  };
}
