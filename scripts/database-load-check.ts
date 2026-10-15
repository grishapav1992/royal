import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';

// This writes synthetic demo coins only in an explicitly marked, isolated restore.
type Mode = 'distinct' | 'hot' | 'read';
class LoadCheckError extends Error { constructor(readonly category: string) { super(category); } }
const ensure: (condition: unknown, category: string) => asserts condition = (condition, category) => {
  if (!condition) throw new LoadCheckError(category);
};
const options = () => {
  const args = process.argv.slice(2), values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    ensure(['--duration-seconds', '--workers', '--mode', '--accounts', '--history-per-account'].includes(args[index]) && args[index + 1]
      && !values.has(args[index]), 'invalid_arguments');
    values.set(args[index], args[index + 1]);
  }
  const durationSeconds = Number(values.get('--duration-seconds') ?? '10');
  const workers = (values.get('--workers') ?? '1,4,16,64').split(',').map(Number);
  const modes = (values.get('--mode') ?? 'distinct,hot,read').split(',') as Mode[];
  const accountCount = Number(values.get('--accounts') ?? '2048');
  const historyPerAccount = Number(values.get('--history-per-account') ?? '0');
  ensure(Number.isInteger(durationSeconds) && durationSeconds >= 1 && durationSeconds <= 30, 'invalid_duration');
  ensure(workers.length <= 4 && workers.length === new Set(workers).size && workers.every(value => [1,4,16,64].includes(value)), 'invalid_workers');
  ensure(modes.length <= 3 && modes.length === new Set(modes).size && modes.every(value => ['distinct','hot','read'].includes(value)), 'invalid_modes');
  ensure(Number.isInteger(accountCount) && accountCount >= 1024 && accountCount <= 8192, 'invalid_account_count');
  ensure([0,50].includes(historyPerAccount), 'invalid_history_count');
  return { durationSeconds, workers, modes, accountCount, historyPerAccount, seedRowsPerAccount: Math.max(1,historyPerAccount) };
};
function errorCategory(error: unknown) {
  if (error instanceof LoadCheckError) return error.category;
  if (error instanceof WalletError) return 'wallet_' + error.status;
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return 'sqlstate_' + code;
  if (typeof code === 'string' && ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE'].includes(code)) return code.toLowerCase();
  return 'unexpected_error';
}
function latencies(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const value = (fraction: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : 0;
  return { samples: values.length, p50Ms: value(.50), p95Ms: value(.95), p99Ms: value(.99), maxMs: value(1) };
}
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);

async function main() {
  const config = options();
  ensure(process.env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? '')
    && process.env.DATABASE_PERFORMANCE_CLONE === 'true' && !process.env.DATABASE_URL?.trim()
    && !process.env.DATABASE_URL_FILE?.trim(), 'isolated_clone_required');
  const poolConfig = databaseConfig({ ...process.env, PGUSER: 'royal_game_app', PGAPPNAME: 'royal/load-check' });
  const probe = new pg.Client(poolConfig);
  try {
    await probe.connect();
    const marker = (await probe.query("SELECT current_setting('royal.performance_clone',true) AS marker,current_user AS role")).rows[0];
    ensure(marker.marker === 'on' && marker.role === 'royal_game_app', 'isolated_server_marker_required');
    const schema = await probe.query("SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='royal_game' AND table_name IN ('accounts','demo_wallets','demo_operations','demo_ledger','demo_mines_sessions','demo_flight_sessions')");
    ensure(Number(schema.rows[0].count) === 6, 'restored_game_schema_required');
  } finally { await probe.end(); }
  const db = new PostgresDatabase('royal_game', { config: poolConfig });
  const wallet = new DemoWalletStore(db);
  const runId = randomUUID().replaceAll('-', '');
  const id = (number: number) => `${runId.slice(0,8)}-${runId.slice(8,12)}-4${runId.slice(13,16)}-a${runId.slice(17,20)}-${number.toString(16).padStart(12,'0')}`;
  const accountIds = Array.from({ length: config.accountCount }, (_, index) => id(index + 1));
  const emails = accountIds.map((_, index) => `db-load-${runId}-${index}@royal.example`);
  const seedIds = accountIds.map(accountId => {
    const digest = createHash('md5').update(runId + ':' + accountId + ':1').digest('hex');
    return `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20)}`;
  });
  const createdAt = Date.now(), seedUnits = config.seedRowsPerAccount * 100;
  const expected = new Map(accountIds.map(accountId => [accountId, 0]));
  let operationSequence = config.accountCount * 2;
  let seeded = false, cleanupOk = false;
  const stages: Record<string, unknown>[] = [];
  const gameDigest = async () => {
    const hash = createHash('sha256');
    const tables = await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname='royal_game' ORDER BY tablename").all();
    for (const { tablename } of tables) {
      // Only aggregate digests leave PostgreSQL. No existing account data is reported.
      const row = await db.prepare('SELECT count(*) AS n,md5(COALESCE(string_agg(md5(row_to_json(t)::text),\'\' ORDER BY md5(row_to_json(t)::text)),\'\')) AS digest FROM royal_game.' + identifier(tablename) + ' t').get();
      hash.update(json([tablename, row]));
    }
    return hash.digest('hex');
  };
  const check = async () => {
    const rows = await db.pool.query(`SELECT a.id,w.balance*100+w.fraction_units AS balance_units,
      COALESCE(l.n,0) AS ledger_rows,COALESCE(l.units,0)::text AS ledger_units,COALESCE(o.n,0) AS operations,
      COALESCE(l.non_deposits,0) AS non_deposits,COALESCE(l.duplicates,0) AS duplicates,
      COALESCE(l.bad_units,0) AS bad_units,COALESCE(l.bad_progression,0) AS bad_progression
      FROM royal_game.accounts a LEFT JOIN royal_game.demo_wallets w ON w.account_id=a.id
      LEFT JOIN (SELECT account_id,count(*) AS n,sum(amount_units) AS units,
        count(*) FILTER (WHERE entry_type<>'deposit' OR kind<>'deposit') AS non_deposits,
        count(*)-count(DISTINCT operation_id) AS duplicates,
        count(*) FILTER (WHERE amount_units<>100 OR amount<>1 OR balance_units<>balance*100) AS bad_units,
        count(*)-count(DISTINCT balance_units) AS bad_progression FROM royal_game.demo_ledger
        WHERE account_id=ANY($1::text[]) GROUP BY account_id) l ON l.account_id=a.id
      LEFT JOIN (SELECT account_id,count(*) AS n FROM royal_game.demo_operations
        WHERE account_id=ANY($1::text[]) GROUP BY account_id) o ON o.account_id=a.id
      WHERE a.id=ANY($1::text[])`, [accountIds]);
    let mismatches = rows.rows.length !== accountIds.length ? 1 : 0;
    for (const row of rows.rows) {
      const count = expected.get(row.id)!;
      if (Number(row.balance_units) !== seedUnits + count * 100 || row.ledger_units !== String(seedUnits + count * 100)
        || Number(row.ledger_rows) !== count + config.seedRowsPerAccount || Number(row.operations) !== count + config.seedRowsPerAccount
        || Number(row.non_deposits) !== 0 || Number(row.duplicates) !== 0 || Number(row.bad_units) !== 0 || Number(row.bad_progression) !== 0) mismatches++;
    }
    return { ok: mismatches === 0, checkedAccounts: rows.rows.length, mismatchedAccounts: mismatches,
      committedNewDeposits: [...expected.values()].reduce((sum, count) => sum + count, 0) };
  };
  let originalDigest: string | undefined, finalDigest: string | undefined;
  try {
    await wallet.ready;
    originalDigest = await gameDigest();
    await db.transaction(async () => {
      await db.prepare(`INSERT INTO accounts(id,email,name,password,created_at)
        SELECT id,email,'DB load test',?,? FROM unnest(?::text[],?::text[]) AS t(id,email)`).run('0'.repeat(32) + ':' + '0'.repeat(128), createdAt, accountIds, emails);
      await db.prepare(`INSERT INTO demo_wallets(account_id,balance,fraction_units)
        SELECT id,?,0 FROM unnest(?::text[]) AS t(id)`).run(config.seedRowsPerAccount,accountIds);
      await db.prepare(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source)
        SELECT account_id,md5(?||':'||account_id||':'||n)::uuid::text,'deposit',1,n,?,100,n*100,'deposit','royal-coins'
        FROM unnest(?::text[]) AS t(account_id) CROSS JOIN generate_series(1,?) AS s(n)`).run(runId,createdAt - 60001,accountIds,config.seedRowsPerAccount);
      await db.prepare(`INSERT INTO demo_operations(account_id,operation_id,kind,amount,result,request_key)
        SELECT account_id,md5(?||':'||account_id||':'||n)::uuid::text,'deposit',1,'{}','["deposit",1,null,null,null]'
        FROM unnest(?::text[]) AS t(account_id) CROSS JOIN generate_series(1,?) AS s(n)`).run(runId,accountIds,config.seedRowsPerAccount);
    }, { lockKey: 'load-seed:' + runId });
    seeded = true;
    ensure((await check()).ok, 'seed_integrity_failed');
    // The generated fixture changes table sizes; measure with current planner statistics.
    for (const table of ['accounts','demo_wallets','demo_operations','demo_ledger']) await db.exec('ANALYZE royal_game.' + identifier(table));
    // Warm actual indexed paths without counting them as measured work.
    await Promise.all(accountIds.slice(0,64).map(accountId => wallet.snapshot(accountId)));
    for (const mode of config.modes) for (const workers of config.workers) {
      const startedAt = new Date().toISOString();
      const started = performance.now(), deadline = started + config.durationSeconds * 1000;
      console.log(json({ event: 'load_stage_start', mode, workers, startedAt }));
      let cursor = 0, completed = 0, admitted = 0, committedNewDeposits = 0;
      let waitingPeak = 0, connectionPeak = 0, activePeak = 0, inFlight = 0;
      const successfulLatencies: number[] = [], failedLatencies: number[] = [];
      const errors: Record<string, number> = {};
      const monitor = setInterval(() => {
        waitingPeak = Math.max(waitingPeak, db.pool.waitingCount);
        connectionPeak = Math.max(connectionPeak, db.pool.totalCount);
      },100);
      try {
        await Promise.all(Array.from({ length: workers }, async () => {
          while (performance.now() < deadline) {
            const index = mode === 'hot' ? 0 : cursor++ % accountIds.length;
            const accountId = accountIds[index];
            const begin = performance.now();
            admitted++; inFlight++; activePeak = Math.max(activePeak,inFlight);
            try {
              if (mode === 'distinct') {
                const operationId = id(++operationSequence);
                await wallet.operate(accountId, { id: operationId, kind: 'deposit', amount: 1 });
                expected.set(accountId, expected.get(accountId)! + 1); committedNewDeposits++;
              } else if (mode === 'hot') {
                await wallet.operate(accountId, { id: seedIds[0], kind: 'deposit', amount: 1 });
              }
              const snapshot = await wallet.snapshot(accountId);
              ensure(Number.isFinite(snapshot.balance) && snapshot.entries.length <= 50, 'invalid_wallet_snapshot');
              completed++; successfulLatencies.push(performance.now() - begin);
            } catch (error) {
              const category = errorCategory(error);
              errors[category] = (errors[category] ?? 0) + 1;
              failedLatencies.push(performance.now() - begin);
            } finally { inFlight--; }
          }
        }));
      } finally { clearInterval(monitor); }
      const ended = performance.now();
      const completedAt = new Date().toISOString();
      const integrity = await check();
      const stage = { mode, workers, offeredConcurrency: workers, poolMaximum: poolConfig.max,
        startedAt, completedAt,
        durationSeconds: config.durationSeconds, elapsedSecondsIncludingDrain: rounded((ended - started)/1000),
        drainMs: rounded(Math.max(0,ended-deadline)), admitted, completed, failed: admitted - completed,
        completedOperationsPerSecond: rounded(completed/((ended-started)/1000)), committedNewDeposits,
        successfulLatency: Object.fromEntries(Object.entries(latencies(successfulLatencies)).map(([key,value]) => [key,rounded(value)])),
        failedLatency: Object.fromEntries(Object.entries(latencies(failedLatencies)).map(([key,value]) => [key,rounded(value)])),
        errors, waitingPeak, connectionPeak, activePeak, allInFlightDrained: inFlight === 0, integrity };
      stages.push(stage);
      console.log(json({ event: 'load_stage', ...stage }));
      ensure(integrity.ok && inFlight === 0, 'stage_integrity_failed');
    }
    // A changed request under the same id must be rejected without producing money.
    let conflictRejected = false;
    try { await wallet.operate(accountIds[0], { id: seedIds[0], kind: 'deposit', amount: 2 }); }
    catch (error) { conflictRejected = error instanceof WalletError && error.status === 409; }
    ensure(conflictRejected && (await check()).ok, 'idempotency_conflict_failed');
  } finally {
    try { if (seeded) {
      // All identifiers and ownership fields must still match this run before cleanup.
      await db.transaction(async () => {
        const owned = await db.prepare('SELECT count(*) AS n FROM accounts WHERE id=ANY(?::text[]) AND email=ANY(?::text[]) AND created_at=? AND name=\'DB load test\'').get(accountIds,emails,createdAt);
        ensure(Number(owned?.n) === accountIds.length, 'synthetic_cleanup_guard_failed');
        const result = await db.prepare('DELETE FROM accounts WHERE id=ANY(?::text[]) AND email=ANY(?::text[]) AND created_at=? AND name=\'DB load test\'').run(accountIds,emails,createdAt);
        ensure(result.changes === accountIds.length, 'synthetic_cleanup_failed');
      }, { lockKey: 'load-cleanup:' + runId });
      finalDigest = await gameDigest(); cleanupOk = finalDigest === originalDigest;
    } } finally { await db.close(); }
  }
  ensure(cleanupOk, 'existing_game_rows_changed');
  const ok = stages.every(stage => stage.failed === 0);
  const report = { ok, isolatedClone: true, schema: 'royal_game', nativeGameRole: true, accountCount: config.accountCount,
    requestedHistoryPerAccount: config.historyPerAccount, historicalLedgerRows: config.accountCount * config.seedRowsPerAccount,
    seedCoinsPerAccount: seedUnits/100, poolMaximum: poolConfig.max, stages, existingGameRowsPreserved: cleanupOk,
    syntheticAccountsRemoved: cleanupOk, idempotencyConflictRejected: true,
    measurement: 'Closed-loop logical operations. Distinct: unique 1-coin demo deposit plus indexed wallet snapshot. Hot: same committed deposit replay plus indexed snapshot, no new writes. Read: indexed wallet snapshot. Admission stops at the configured deadline; already admitted work drains before validation. No HTTP, password hashing, frontend or real payments.' };
  if (process.env.DATABASE_LOAD_REPORT) await writeFile(process.env.DATABASE_LOAD_REPORT,json(report)+'\n',{ mode: 0o600, flag: 'wx' });
  console.log(json(report));
  if (!ok) process.exitCode = 1;
}

try { await main(); }
catch (error) { console.error(json({ ok: false, errorCategory: errorCategory(error) })); process.exitCode = 1; }
