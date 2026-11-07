import { randomUUID } from 'node:crypto';
import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { migrateAuditEvidence } from './evidence';
import { migrateAuditAttemptCapture } from './attempts';
import { migrateAuditOperationLookup } from './check-repeats';
import { migrateAuditReplayPackages } from './replay-store';
import { migrateAuditRiskSignals } from './risk-store';

export type AuditSourceSchemas = { game: string; payments?: string };

const gameLedgers = ['demo_ledger', 'capro_pending_ledger'];
const gameCheckpoint = ['demo_wallets', 'capro_pending_balances', 'demo_casino_sessions', 'demo_flight_sessions',
  'demo_mines_sessions', 'virtual_pvp_holds', 'flag_tote_rounds', 'flag_tote_tickets', 'skin_purchases'];
const paymentCheckpoint = ['crypto_wallets', 'crypto_operations', 'crypto_wallet_holds'];

const relation = (schema: string, table: string) => identifier(schema) + '.' + identifier(table);
const namespace = (schema: string, table: string) => schema + '.' + table;

export async function migrateAuditDatasets(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-datasets-v1', statements: [
    `CREATE TABLE audit_datasets(
      id uuid PRIMARY KEY, environment text NOT NULL CHECK(environment IN ('test','live')),
      started_at_ms bigint NOT NULL, sealed_at_ms bigint CHECK(sealed_at_ms >= started_at_ms)
    )`,
    'CREATE UNIQUE INDEX audit_one_active_dataset ON audit_datasets ((true)) WHERE sealed_at_ms IS NULL',
    `CREATE TABLE audit_dataset_sources(
      dataset_id uuid REFERENCES audit_datasets(id), source_namespace text,
      PRIMARY KEY(dataset_id,source_namespace)
    )`,
    `CREATE TABLE audit_opening_balances(
      dataset_id uuid REFERENCES audit_datasets(id), account_id text, source_namespace text,
      available_units numeric(78,0), reserved_units numeric(78,0), pending_units numeric(78,0),
      PRIMARY KEY(dataset_id,source_namespace,account_id)
    )`,
    `CREATE TABLE audit_opening_obligations(
      dataset_id uuid REFERENCES audit_datasets(id), account_id text, source_namespace text, entity_id text,
      state text NOT NULL, principal_units numeric(78,0),
      PRIMARY KEY(dataset_id,source_namespace,account_id,entity_id)
    )`,
    `CREATE TABLE audit_posting_refs(
      dataset_id uuid NOT NULL, source_namespace text NOT NULL, source_row_id bigint NOT NULL,
      account_id text NOT NULL, operation_id text NOT NULL, occurred_at_ms bigint NOT NULL,
      PRIMARY KEY(dataset_id,source_namespace,source_row_id),
      FOREIGN KEY(dataset_id,source_namespace) REFERENCES audit_dataset_sources(dataset_id,source_namespace)
    )`,
    `CREATE INDEX audit_posting_refs_player ON audit_posting_refs
      (dataset_id,account_id,occurred_at_ms,source_namespace,source_row_id)`,
  ] });
}

/** Operator-only cutover. The source schemas must be on the audit database's PostgreSQL connection. */
export class AuditDatasets {
  readonly ready: Promise<void>;
  private readonly sources: AuditSourceSchemas;
  private readonly ledgers: string[];

  constructor(private readonly db: PostgresDatabase, sources: AuditSourceSchemas, options?: { existingSchema?: boolean }) {
    const schemas = [db.schema, sources.game, ...(sources.payments === undefined ? [] : [sources.payments])];
    if (new Set(schemas).size !== schemas.length || schemas.some(schema => !/^[a-z_][a-z0-9_]{0,62}$/.test(schema))) {
      throw new Error('Audit and source schemas must be distinct PostgreSQL schema names');
    }
    this.sources = { ...sources };
    this.ledgers = [
      ...gameLedgers.map(table => namespace(sources.game, table)),
      ...(sources.payments ? [namespace(sources.payments, 'crypto_ledger')] : []),
    ].sort();
    this.ready = options?.existingSchema ? db.ready : migrateAuditDatasets(db).then(() => migrateAuditEvidence(db)).then(() => migrateAuditAttemptCapture(db))
      .then(() => migrateAuditOperationLookup(db)).then(() => migrateAuditReplayPackages(db)).then(() => migrateAuditRiskSignals(db));
  }

  private async optionalTable(schema: string, table: string) {
    return !!(await this.db.prepare('SELECT to_regclass(?) IS NOT NULL AS present').get(namespace(schema, table)))?.present;
  }

  private async fence(tables: string[]) {
    // Both boundaries exclude in-flight source writes without a lock in the wallet's usual path.
    const names = [...new Set(tables)].sort().map(name => {
      const [schema, table] = name.split('.');
      return relation(schema, table);
    });
    await this.db.exec('SET LOCAL statement_timeout = 3000');
    await this.db.exec(`LOCK TABLE ${names.join(', ')} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
  }

  private async attachCapture(install: boolean) {
    const fn = relation(this.db.schema, 'audit_capture_posting_v1');
    const sources = relation(this.db.schema, 'audit_dataset_sources');
    const datasets = relation(this.db.schema, 'audit_datasets');
    const refs = relation(this.db.schema, 'audit_posting_refs');
    if (install) await this.db.exec(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $audit$
      BEGIN
        INSERT INTO ${refs}(dataset_id,source_namespace,source_row_id,account_id,operation_id,occurred_at_ms)
          SELECT ds.dataset_id,ds.source_namespace,NEW.id,NEW.account_id,NEW.operation_id,NEW.created_at
          FROM ${sources} ds JOIN ${datasets} d ON d.id=ds.dataset_id
          WHERE d.sealed_at_ms IS NULL AND ds.source_namespace=TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME;
        RETURN NEW;
      END
      $audit$;
      REVOKE ALL ON FUNCTION ${fn}() FROM PUBLIC`);
    for (const ledger of this.ledgers) {
      const current = await this.db.prepare(`SELECT tgfoid=to_regprocedure(?) AS correct, tgenabled,
        tgdeferrable,tginitdeferred,tgtype
        FROM pg_trigger WHERE tgrelid=to_regclass(?) AND tgname='royal_audit_posting_v1'`).get(fn + '()', ledger);
      if (current) {
        if (!current.correct || current.tgenabled !== 'O' || !current.tgdeferrable || !current.tginitdeferred || current.tgtype !== 5) {
          throw new Error('Conflicting audit capture on ' + ledger);
        }
        continue;
      }
      if (!install) throw new Error('Audit capture is missing on ' + ledger);
      const [schema, table] = ledger.split('.');
      await this.db.exec(`CREATE CONSTRAINT TRIGGER royal_audit_posting_v1
        AFTER INSERT ON ${relation(schema, table)} DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    }
  }

  private async createCheckpoint<E extends 'test' | 'live'>(environment: E) {
    const { game, payments } = this.sources;
    const sandbox = await this.optionalTable(game,'nowpayments_sandbox_deposits');
    const stars = !!payments && await this.optionalTable(payments,'telegram_stars_orders');
    await this.fence([
      ...this.ledgers,
      ...gameCheckpoint.map(table => namespace(game,table)),
      ...(sandbox ? [namespace(game,'nowpayments_sandbox_deposits')] : []),
      ...(payments ? paymentCheckpoint.map(table => namespace(payments,table)) : []),
      ...(payments && stars ? [namespace(payments,'telegram_stars_orders')] : []),
    ]);
    await this.attachCapture(environment === 'test');
    const datasetId = randomUUID();
    const row = await this.db.prepare(`INSERT INTO audit_datasets(id,environment,started_at_ms)
      VALUES (?,?,floor(extract(epoch FROM clock_timestamp())*1000)::bigint) RETURNING started_at_ms`).get(datasetId,environment);
    for (const ledger of this.ledgers) await this.db.prepare('INSERT INTO audit_dataset_sources VALUES (?,?)').run(datasetId,ledger);
    await this.openingBalances(datasetId);
    await this.openingObligations(datasetId,sandbox,stars);
    return { datasetId, environment, startedAtMs: Number(row!.started_at_ms) };
  }

  private async openingBalances(id: string) {
    const { game, payments } = this.sources;
    await this.db.prepare(`INSERT INTO audit_opening_balances(dataset_id,account_id,source_namespace,available_units,pending_units)
      SELECT ?,COALESCE(w.account_id,p.account_id),?,COALESCE(w.balance::numeric*100+w.fraction_units,0),
        COALESCE(p.pending_units::numeric,0)
      FROM ${relation(game,'demo_wallets')} w FULL JOIN ${relation(game,'capro_pending_balances')} p USING(account_id)`)
      .run(id, namespace(game,'demo_ledger'));
    if (payments) {
      await this.db.prepare(`INSERT INTO audit_opening_balances(dataset_id,account_id,source_namespace,available_units,reserved_units)
        SELECT ?,account_id,?,balance_units,reserved_units FROM ${relation(payments,'crypto_wallets')}`)
        .run(id, namespace(payments,'crypto_ledger'));
    }
  }

  private async openingObligations(id: string, sandbox: boolean, stars: boolean) {
    const { game, payments } = this.sources;
    const copy = (schema: string, table: string, query: string) => this.db.prepare(
      `INSERT INTO audit_opening_obligations(dataset_id,source_namespace,account_id,entity_id,state,principal_units)
       SELECT ?,?,${query}`).run(id, namespace(schema,table));
    for (const table of ['demo_casino_sessions','demo_flight_sessions','demo_mines_sessions']) {
      const principal = table === 'demo_casino_sessions' ? 'NULL' : 'amount::numeric*100';
      await copy(game, table, `account_id,id,state,${principal} FROM ${relation(game,table)} WHERE state='active'`);
    }
    await copy(game,'virtual_pvp_holds', `account_id,match_id,state,stake_units FROM ${relation(game,'virtual_pvp_holds')} WHERE state='held'`);
    await copy(game,'skin_purchases', `account_id,id,state,amount_cents FROM ${relation(game,'skin_purchases')} WHERE state='reserved'`);
    await copy(game,'flag_tote_tickets', `t.account_id,t.id,r.state,t.stake_units
      FROM ${relation(game,'flag_tote_tickets')} t JOIN ${relation(game,'flag_tote_rounds')} r ON r.id=t.round_id
      WHERE r.state IN ('open','racing')`);
    if (sandbox) await copy(game,'nowpayments_sandbox_deposits', `account_id,id,state,NULL
      FROM ${relation(game,'nowpayments_sandbox_deposits')} WHERE state NOT IN ('finished','failed','refunded','expired')`);
    if (payments) {
      await copy(payments,'crypto_operations', `account_id,id,state,CASE WHEN kind='withdrawal' THEN amount_units END
        FROM ${relation(payments,'crypto_operations')}
        WHERE state NOT IN ('finished','rejected','expired','refunded')`);
      await copy(payments,'crypto_wallet_holds', `account_id,operation_id,'review',NULL FROM ${relation(payments,'crypto_wallet_holds')}`);
      if (stars) await copy(payments,'telegram_stars_orders', `account_id,id,state,NULL
        FROM ${relation(payments,'telegram_stars_orders')} WHERE state IN ('waiting','checkout')`);
    }
  }

  async startTest() {
    await this.ready;
    return this.db.transaction(async () => {
      const existing = await this.db.prepare(`SELECT id::text,environment,started_at_ms FROM audit_datasets WHERE sealed_at_ms IS NULL`).get();
      if (existing) {
        const registered = (await this.db.prepare('SELECT source_namespace FROM audit_dataset_sources WHERE dataset_id=? ORDER BY source_namespace')
          .all(existing.id)).map(row => row.source_namespace);
        if (existing.environment !== 'test' || JSON.stringify(registered) !== JSON.stringify(this.ledgers)) {
          throw new Error('Another audit dataset is active');
        }
        return { datasetId: String(existing.id), environment: 'test' as const, startedAtMs: Number(existing.started_at_ms) };
      }
      return this.createCheckpoint('test');
    }, { lockKey: 'audit-dataset' });
  }

  /** Used after the validated test rows are removed, in the same cutover transaction. */
  async startLiveInCleanupTransaction(sealedTestId: string) {
    if (!this.db.inTransaction || !await this.db.prepare(`SELECT 1 FROM audit_datasets d
      WHERE d.id=? AND d.environment='test' AND d.sealed_at_ms IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM audit_dataset_sources s WHERE s.dataset_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM audit_datasets active WHERE active.sealed_at_ms IS NULL)`).get(sealedTestId)) {
      throw new Error('Live audit checkpoint requires a cleaned sealed test dataset');
    }
    return this.createCheckpoint('live');
  }

  async sealTest(datasetId: string) {
    await this.ready;
    return this.db.transaction(async () => {
      const row = await this.db.prepare("SELECT sealed_at_ms FROM audit_datasets WHERE id=? AND environment='test' FOR UPDATE NOWAIT").get(datasetId);
      if (!row) throw new Error('Unknown test audit dataset');
      if (row.sealed_at_ms !== null) return;
      const tables = (await this.db.prepare('SELECT source_namespace FROM audit_dataset_sources WHERE dataset_id=?')
        .all(datasetId)).map(row => String(row.source_namespace));
      await this.fence(tables);
      await this.db.prepare(`UPDATE audit_datasets SET sealed_at_ms=GREATEST(started_at_ms,
        floor(extract(epoch FROM clock_timestamp())*1000)::bigint) WHERE id=?`).run(datasetId);
    }, { lockKey: 'audit-dataset' });
  }
}
