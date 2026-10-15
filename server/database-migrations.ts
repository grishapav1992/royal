import { createHash, randomUUID } from 'node:crypto';
import { PostgresDatabase, identifier } from './database';

export type SchemaIndex = { name: string; table: string; columns: string[]; where?: string };
export type SchemaMigration = { id: string; statements: string[]; indexes?: SchemaIndex[] };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const objectName = (name: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error('Invalid migration object name');
  return identifier(name);
};
// Index expressions are trusted source code, never request input.
const columnSql = (column: string) => /^[a-z_][a-z0-9_]*(?:\s+(?:ASC|DESC))?$/i.test(column)
  ? column.replace(/^([a-z_][a-z0-9_]*)/i, name => objectName(name)) : column;
const indexShape = (sql: string) => sql.slice(sql.indexOf(' USING btree '));

/** Forward-only migrations: concurrent indexes, followed by atomic data/constraint changes. */
export async function applySchemaMigration(db: PostgresDatabase, migration: SchemaMigration) {
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(migration.id)) throw new Error('Invalid schema migration id');
  if (db.inTransaction) throw new Error('Schema migrations must run outside application transactions');
  await db.ready;
  const checksum = digest(migration);
  const client = await db.pool.connect();
  const migrationTable = identifier(db.schema) + '._royal_migrations';
  let locked = false, inTransaction = false, releaseError: Error | undefined, temporaryTable: string | undefined;
  let settings: { lock_timeout: string; statement_timeout: string } | undefined;
  try {
    settings = (await client.query("SELECT current_setting('lock_timeout') AS lock_timeout,current_setting('statement_timeout') AS statement_timeout")).rows[0];
    await client.query("SELECT set_config('lock_timeout','5s',false),set_config('statement_timeout','5min',false)");
    // A blocking SELECT holds a virtual transaction that concurrent index creation
    // may itself need to wait for. Poll between completed statements instead.
    const deadline = Date.now() + 120000;
    let delay = 50;
    while (!locked) {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', ['migrations:' + db.schema])).rows[0].locked;
      if (locked) break;
      if (Date.now() >= deadline) throw new Error('Schema migration lock wait exceeded its deadline');
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 1000);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS ${migrationTable} (
      id text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const applied = await client.query(`SELECT checksum FROM ${migrationTable} WHERE id=$1`, [migration.id]);
    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum) throw new Error('Applied schema migration has changed: ' + migration.id);
      return;
    }
    for (const index of migration.indexes ?? []) {
      if (!index.columns.length || index.columns.some(column => !column.trim() || /;|--|\/\*/.test(column)) || /;|--|\/\*/.test(index.where ?? '')) throw new Error('Invalid index expression');
      const qualifiedName = identifier(db.schema) + '.' + objectName(index.name);
      const sql = `CREATE INDEX ${objectName(index.name)} ON ${identifier(db.schema)}.${objectName(index.table)} USING btree (${index.columns.map(columnSql).join(',')})${index.where ? ' WHERE ' + index.where : ''}`;
      // Let PostgreSQL canonicalize the definition on an empty temporary relation.
      // Text normalization cannot safely distinguish JSON keys, literals or arithmetic grouping.
      temporaryTable = objectName('_royal_index_shape_' + randomUUID().replaceAll('-', '').slice(0, 12));
      await client.query(`CREATE TEMP TABLE ${temporaryTable} (LIKE ${identifier(db.schema)}.${objectName(index.table)})`);
      await client.query(sql.replace(objectName(index.name), '"_royal_expected_index"')
        .replace(identifier(db.schema) + '.' + objectName(index.table), 'pg_temp.' + temporaryTable));
      const expected = indexShape((await client.query("SELECT pg_get_indexdef(to_regclass('pg_temp._royal_expected_index')) AS definition")).rows[0].definition);
      const inspect = () => client.query(`SELECT pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,
        i.indisunique AS unique,i.indrelid=$2::regclass AS correct_table,
        EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid) AS constrained
        FROM pg_index i WHERE i.indexrelid=to_regclass($1)`, [qualifiedName, identifier(db.schema) + '.' + objectName(index.table)]);
      let existing = await inspect();
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (!row.correct_table || row.unique || row.constrained || indexShape(row.definition) !== expected) throw new Error('Existing migration index has a different definition: ' + index.name);
        if (!row.valid || !row.ready) await client.query('DROP INDEX CONCURRENTLY ' + qualifiedName);
      }
      await client.query(sql.replace('CREATE INDEX ', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS '));
      existing = await inspect();
      if (!existing.rowCount || !existing.rows[0].correct_table || !existing.rows[0].valid || !existing.rows[0].ready || indexShape(existing.rows[0].definition) !== expected) throw new Error('Migration index verification failed: ' + index.name);
      await client.query('DROP TABLE pg_temp.' + temporaryTable); temporaryTable = undefined;
    }
    await client.query('BEGIN'); inTransaction = true;
    await client.query("SET LOCAL lock_timeout='2s'");
    for (const sql of migration.statements) await client.query(sql);
    await client.query(`INSERT INTO ${migrationTable}(id,checksum) VALUES($1,$2)`, [migration.id, checksum]);
    await client.query('COMMIT'); inTransaction = false;
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    try {
      if (temporaryTable) await client.query('DROP TABLE IF EXISTS pg_temp.' + temporaryTable);
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['migrations:' + db.schema]);
      if (settings) await client.query("SELECT set_config('lock_timeout',$1,false),set_config('statement_timeout',$2,false)", [settings.lock_timeout, settings.statement_timeout]);
    } catch (error) { releaseError = error instanceof Error ? error : new Error('Migration connection reset failed'); }
    client.release(releaseError);
  }
}
