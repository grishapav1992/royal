import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { migrateFinance, FinanceStore } from '../server/finance/store';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Always creates an isolated database. It never reads production connection strings.
export async function temporaryFinanceDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'royal-finance-'));
  const port = await freePort();
  const password = randomBytes(32).toString('hex');
  const postgres = new EmbeddedPostgres({ databaseDir: directory, port, user: 'postgres', password,
    persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  let started = false;
  let admin: pg.Pool | undefined, runtime: pg.Pool | undefined;
  const cleanup = async () => {
    await runtime?.end(); await admin?.end();
    if (started) await postgres.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await postgres.initialise(); await postgres.start(); started = true;
    await postgres.createDatabase('finance_simulation');
    const config = { host: '127.0.0.1', port, database: 'finance_simulation', password, connectionTimeoutMillis: 5000 };
    admin = new pg.Pool({ ...config, user: 'postgres' });
    await migrateFinance(admin);
    await admin.query(`CREATE ROLE finance_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT`);
    await admin.query('GRANT royal_finance_runtime TO finance_app');
    runtime = new pg.Pool({ ...config, user: 'finance_app', max: 12, statement_timeout: 10000 });
    const store = new FinanceStore(runtime);
    await store.checkRuntimeRole();
    const restart = async () => {
      // Drain every connection before restarting so no old worker survives recovery.
      await runtime!.end(); await admin!.end(); await postgres.stop(); started = false;
      await postgres.start(); started = true;
      admin = new pg.Pool({ ...config, user: 'postgres' });
      runtime = new pg.Pool({ ...config, user: 'finance_app', max: 12, statement_timeout: 10000 });
      const freshStore = new FinanceStore(runtime);
      await freshStore.checkRuntimeRole();
      return { store: freshStore, admin, runtime, cleanup, restart };
    };
    return { store, admin, runtime, cleanup, restart };
  } catch (error) { await cleanup(); throw error; }
}
