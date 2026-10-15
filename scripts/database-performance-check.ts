import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseConfig, PostgresDatabase } from '../server/database';
import { TronReadStore, type ReaderConfig } from '../server/finance/tron-store';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
import { NilePlayLedger } from '../server/finance/nile-play-ledger';

// Run on an isolated restore, never against a live service. Output contains no rows or identities.
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? '') || process.env.DATABASE_PERFORMANCE_CLONE !== 'true'
  || process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_FILE?.trim()) {
  throw new Error('Database performance checks require an explicitly isolated loopback PostgreSQL clone');
}
const probe = new pg.Client(databaseConfig());
try {
  await probe.connect();
  if ((await probe.query("SELECT current_setting('royal.performance_clone',true) AS marker")).rows[0].marker !== 'on') {
    throw new Error('The PostgreSQL server is not marked as an isolated performance clone');
  }
} finally { await probe.end(); }
const applyMigrations = process.argv.includes('--apply-migrations');
const store = (schema: string, role: string) => new PostgresDatabase(schema, {
  config: databaseConfig({ ...process.env, PGUSER: role }),
});
const databases = {
  game: store('royal_game','royal_game_app'), reader: store('royal_tron_reader','royal_tron_reader_app'),
  deposits: store('royal_nile_deposits','royal_nile_deposits_app'), play: store('royal_nile_play','royal_nile_play_app'),
};
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(json(canonical(value))).digest('hex');
let accountStore: { close(): Promise<void> } | undefined;
try {
  await Promise.all(Object.values(databases).map(db => db.ready));
  const readerState = (await databases.reader.prepare('SELECT * FROM reader_state').get())!;
  const readerConfig: ReaderConfig = { network: 'nile', startHeight: readerState.start_height, origins: JSON.parse(readerState.origins) };
  const depositConfig = JSON.parse((await databases.deposits.prepare('SELECT config FROM state').get())!.config);
  const playConfig = JSON.parse((await databases.play.prepare('SELECT config FROM state').get())!.config);
  const pool = await databases.deposits.hasTable('deposit_pool') ? JSON.parse((await databases.deposits.prepare('SELECT manifest FROM deposit_pool').get())!.manifest) : undefined;
  const reader = new TronReadStore(databases.reader.schema, readerConfig, !applyMigrations, databases.reader);
  const deposits = new NileTestLedger(databases.deposits.schema, depositConfig, !applyMigrations, pool, databases.deposits);
  const play = new NilePlayLedger(databases.play.schema, playConfig, !applyMigrations, undefined, pool, databases.play);
  await Promise.all([reader.ready, deposits.ready, play.ready]);
  if (applyMigrations) {
    process.env.AUTH_DB_PATH = databases.game.schema;
    process.env.PGUSER = 'royal_game_app';
    const { accounts } = await import('../server/accounts');
    accountStore = accounts; await accounts.ready;
  }
  const metrics: Record<string, { queries: number; returnedRows: number; returnedJsonBytes: number }> = {};
  for (const [name, db] of Object.entries(databases)) {
    const item = metrics[name] = { queries: 0, returnedRows: 0, returnedJsonBytes: 0 };
    const observed = db as any, query = observed.query.bind(db);
    observed.query = async (...args: unknown[]) => {
      const result = await query(...args);
      for (const value of Array.isArray(result) ? result : [result]) {
        item.queries++; item.returnedRows += value.rows?.length ?? 0;
        item.returnedJsonBytes += Buffer.byteLength(json(value.rows ?? []));
      }
      return result;
    };
  }
  const audits: Record<string, unknown> = {};
  for (const [name, store] of Object.entries({ reader, deposits, play })) {
    const start = performance.now();
    const result = await store.audit();
    audits[name] = { elapsedMs: Math.round(performance.now() - start), resultSha256: hash(result),
      metrics: structuredClone(metrics[name]) };
  }
  const beforeWallet = structuredClone(metrics.deposits);
  const walletStart = performance.now();
  const status = await deposits.status();
  const wallet = { elapsedMs: Math.round(performance.now() - walletStart), resultSha256: hash(status),
    queries: metrics.deposits.queries - beforeWallet.queries,
    returnedJsonBytes: metrics.deposits.returnedJsonBytes - beforeWallet.returnedJsonBytes };
  const counts = await databases.game.prepare(`SELECT (SELECT count(*) FROM accounts) AS accounts,
    (SELECT count(*) FROM sessions) AS sessions,(SELECT count(*) FROM demo_ledger) AS ledger,
    (SELECT count(*) FROM demo_ledger WHERE amount_units IS NULL OR balance_units IS NULL) AS legacyMoneyRows`).get();
  const report = { ok: true, isolatedClone: true, appliedMigrations: applyMigrations, audits, wallet, game: counts,
    measurement: 'JSON bytes of returned rows, excluding initialization; elapsed time on a warm isolated clone' };
  if (process.env.DATABASE_PERFORMANCE_REPORT) await writeFile(process.env.DATABASE_PERFORMANCE_REPORT, json(report) + '\n', { mode: 0o600 });
  console.log(json(report));
} finally {
  await accountStore?.close();
  await Promise.all(Object.values(databases).map(db => db.close()));
}
