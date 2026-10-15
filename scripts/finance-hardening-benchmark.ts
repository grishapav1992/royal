import pg from 'pg';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { temporaryFinanceDatabase } from './finance-postgres';
import { FINANCE_SCHEMA } from '../server/finance/schema';
import { FINANCE_DEPOSIT_MIGRATION } from '../server/finance/deposit-schema';
import { migrateFinance } from '../server/finance/store';
import { DEPOSIT_GENESIS, DEPOSIT_NETWORK, DEPOSIT_TOKEN, scanSimulatedDeposits, simulationBlock, simulationSource } from '../server/finance/deposits';

// Recreates the review's large history in an isolated local PostgreSQL, never a configured server.
const db = await temporaryFinanceDatabase();
let observer: pg.Pool | undefined;
try {
  await db.admin.query('DROP SCHEMA royal_finance CASCADE');
  await db.admin.query(FINANCE_SCHEMA); await db.admin.query(FINANCE_DEPOSIT_MIGRATION);
  await db.store.createUser('benchmark');
  const { address } = await db.store.depositAddress('benchmark');
  const seed = await db.admin.connect(), started = performance.now();
  try {
    await seed.query('BEGIN'); await seed.query("SET LOCAL session_replication_role='replica'");
    const { rows } = await seed.query("SELECT id,bucket FROM royal_finance.accounts WHERE owner_id='system'");
    await seed.query(`WITH made AS (INSERT INTO royal_finance.journals(id,kind,source)
      SELECT gen_random_uuid(),'simulate_capital','benchmark:'||i FROM generate_series(1,2000000) i RETURNING id)
      INSERT INTO royal_finance.entries(journal_id,position,account_id,delta)
      SELECT id,0,$1::uuid,-1 FROM made UNION ALL SELECT id,1,$2::uuid,1 FROM made`,
    [rows.find(row => row.bucket === 'assets').id, rows.find(row => row.bucket === 'house_available').id]);
    await seed.query("UPDATE royal_finance.accounts SET balance=CASE WHEN bucket='assets' THEN -2000000 ELSE 2000000 END WHERE owner_id='system' AND bucket IN ('assets','house_available')");
    await seed.query('COMMIT');
  } finally { await seed.query('ROLLBACK'); seed.release(); }
  console.log(JSON.stringify({ fixture_entries: 4000000, seed_ms: Math.round(performance.now() - started) }));
  const migration = performance.now(); await migrateFinance(db.admin);
  await db.admin.query('ANALYZE royal_finance.entries');
  await db.admin.query(`CREATE ROLE finance_ingest LOGIN PASSWORD ${pg.escapeLiteral(db.runtime.options.password as string)}`);
  await db.admin.query('GRANT royal_finance_observer TO finance_ingest');
  observer = new pg.Pool({ ...db.runtime.options, password: db.runtime.options.password, user: 'finance_ingest', options: '-c transaction_timeout=15000' });
  const events = Array.from({ length: 100 }, (_, n) => ({ txId: createHash('sha256').update('benchmark_' + n).digest('hex'),
    logIndex: 0, contract: DEPOSIT_TOKEN, from: 'simulation:external', to: address, amountUnits: '1', scale: 6, success: true, symbol: 'USDT' }));
  const block = simulationBlock(1, DEPOSIT_GENESIS, events);
  const sources = ['a', 'b'].map(sourceId => simulationSource({ sourceId, network: DEPOSIT_NETWORK, finalizedHeight: 1, blocks: [block] }));
  const begin = performance.now(), result = await scanSimulatedDeposits(observer, sources);
  const elapsed = Math.round(performance.now() - begin);
  if (result.credited !== 100 || (await db.store.snapshot('benchmark')).availableUnits !== '100') throw new Error('Benchmark failed');
  console.log(JSON.stringify({ ok: true, environment: 'simulation', history_entries: 4000000,
    migration_ms: Math.round(begin - migration), block_events: 100, block_ms: elapsed, credited: result.credited,
    cursor_height: result.cursorHeight, transaction_timeout: '15s' }));
} finally { await observer?.end(); await db.cleanup(); }
