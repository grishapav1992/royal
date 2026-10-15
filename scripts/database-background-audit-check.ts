import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseConfig, PostgresDatabase } from '../server/database';
import { TronReadStore, type ReaderConfig } from '../server/finance/tron-store';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
import { NilePlayLedger } from '../server/finance/nile-play-ledger';

// Run only against an explicitly marked isolated restore. No migrations or business writes.
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(json(canonical(value))).digest('hex');
const argumentsByName = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!['--scope', '--iterations'].includes(name) || !value || argumentsByName.has(name)) {
    throw new Error('Expected --scope deposits|all and optional --iterations 1..100');
  }
  argumentsByName.set(name, value);
}
const scope = argumentsByName.get('--scope') ?? 'deposits';
const iterations = Number(argumentsByName.get('--iterations') ?? '1');
if (!['deposits', 'all'].includes(scope) || !Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('Invalid audit workload scope or iteration count');
}
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? '')
  || process.env.DATABASE_PERFORMANCE_CLONE !== 'true' || process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_FILE?.trim()) {
  throw new Error('Background audits require an explicitly isolated loopback PostgreSQL clone');
}
const probe = new pg.Client({ ...databaseConfig(), options: '-c default_transaction_read_only=on' });
try {
  await probe.connect();
  if ((await probe.query("SELECT current_setting('royal.performance_clone',true) AS marker")).rows[0].marker !== 'on') {
    throw new Error('The PostgreSQL server is not marked as an isolated performance clone');
  }
} finally { await probe.end(); }

const databases: PostgresDatabase[] = [];
const database = (schema: string, role: string) => {
  const db = new PostgresDatabase(schema, { readOnly: true,
    config: databaseConfig({ ...process.env, PGUSER: role, PGPOOL_MAX: '1', PGAPPNAME: 'royal/load-audit/' + schema }) });
  databases.push(db);
  return db;
};
const overallStart = performance.now();
try {
  const depositsDb = database('royal_nile_deposits', 'royal_nile_deposits_app');
  await depositsDb.ready;
  const depositConfig = JSON.parse((await depositsDb.prepare('SELECT config FROM state WHERE id=1').get())!.config);
  const pool = await depositsDb.hasTable('deposit_pool')
    ? JSON.parse((await depositsDb.prepare('SELECT manifest FROM deposit_pool').get())!.manifest) : undefined;
  const deposits = new NileTestLedger(depositsDb.schema, depositConfig, true, pool, depositsDb);
  const stores: { name: string; ready: Promise<void>; audit(): Promise<unknown> }[] = [
    { name: 'deposits', ready: deposits.ready, audit: () => deposits.audit() },
  ];
  if (scope === 'all') {
    const readerDb = database('royal_tron_reader', 'royal_tron_reader_app');
    const playDb = database('royal_nile_play', 'royal_nile_play_app');
    await Promise.all([readerDb.ready, playDb.ready]);
    const readerState = (await readerDb.prepare('SELECT * FROM reader_state WHERE id=1').get())!;
    const readerConfig: ReaderConfig = { network: 'nile', startHeight: readerState.start_height,
      origins: JSON.parse(readerState.origins) };
    const playConfig = JSON.parse((await playDb.prepare('SELECT config FROM state WHERE id=1').get())!.config);
    const reader = new TronReadStore(readerDb.schema, readerConfig, true, readerDb);
    const play = new NilePlayLedger(playDb.schema, playConfig, true, undefined, pool, playDb);
    stores.unshift({ name: 'reader', ready: reader.ready, audit: () => reader.audit() });
    stores.push({ name: 'play', ready: play.ready, audit: () => play.audit() });
  }
  await Promise.all(stores.map(store => store.ready));
  const initializationMs = Math.round(performance.now() - overallStart);
  const runs: { iteration: number; name: string; startedAt: string; completedAt: string; elapsedMs: number; resultSha256: string }[] = [];
  for (let iteration = 1; iteration <= iterations; iteration++) {
    for (const store of stores) {
      const startedAt = new Date().toISOString();
      const start = performance.now();
      const result = await store.audit();
      const completedAt = new Date().toISOString();
      if (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) {
        throw new Error('An isolated clone audit did not confirm integrity');
      }
      runs.push({ iteration, name: store.name, startedAt, completedAt,
        elapsedMs: Math.round(performance.now() - start), resultSha256: hash(result) });
    }
  }
  const report = { ok: true, isolatedClone: true, readOnly: true, scope, iterations, initializationMs,
    totalElapsedMs: Math.round(performance.now() - overallStart), runs };
  if (process.env.DATABASE_BACKGROUND_AUDIT_REPORT) {
    await writeFile(process.env.DATABASE_BACKGROUND_AUDIT_REPORT, json(report) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(json(report));
} finally {
  await Promise.all(databases.map(db => db.close()));
}
