import pg from 'pg';
import { migrateFinance } from '../server/finance/store';
import { financeDatabaseConfig, requireFinanceSimulation } from '../server/finance/config';
import { readFileSync } from 'node:fs';

requireFinanceSimulation();
const pool = new pg.Pool(financeDatabaseConfig(true));
try {
  await migrateFinance(pool);
  for (const [name, membership, file] of [
    ['finance_app', 'royal_finance_runtime', process.env.FINANCE_BOOTSTRAP_APP_PASSWORD_FILE],
    ['finance_ingest', 'royal_finance_observer', process.env.FINANCE_BOOTSTRAP_OBSERVER_PASSWORD_FILE],
  ] as const) {
    if (!file) continue;
    const password = readFileSync(file, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Application database password must be 32 random bytes encoded as hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [name]);
      if (existing.rows.some(row => Object.values(row).some(Boolean))) throw new Error('Unexpected elevated finance login');
      if (existing.rows.length === 0) await client.query(`CREATE ROLE ${pg.escapeIdentifier(name)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`);
      else await client.query(`ALTER ROLE ${pg.escapeIdentifier(name)} LOGIN INHERIT PASSWORD ${pg.escapeLiteral(password)}`);
      await client.query(`GRANT ${pg.escapeIdentifier(membership)} TO ${pg.escapeIdentifier(name)} WITH INHERIT TRUE`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  console.log('Financial simulation schema ready');
}
finally { await pool.end(); }
