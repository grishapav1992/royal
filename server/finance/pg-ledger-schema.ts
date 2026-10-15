import { PostgresDatabase } from '../database';

const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';

export async function ledgerTrigger(db: PostgresDatabase, table: string, name: string, operation: string, body: string) {
  const fn = identifier(name + '_fn');
  await db.exec(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $ledger$
    BEGIN ${body} IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END;
    $ledger$;
    DROP TRIGGER IF EXISTS ${identifier(name)} ON ${identifier(table)};
    CREATE TRIGGER ${identifier(name)} BEFORE ${operation} ON ${identifier(table)}
      FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
}

export async function immutableLedgerTables(db: PostgresDatabase, tables: string[], message: string) {
  for (const table of tables) for (const operation of ['UPDATE', 'DELETE']) {
    await ledgerTrigger(db, table, `immutable_${table}_${operation}`, operation,
      `RAISE EXCEPTION '${message.replaceAll("'", "''")}';`);
  }
}
