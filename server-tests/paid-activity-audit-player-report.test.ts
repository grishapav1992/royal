import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { AuditDatasets } from '../server/audit/datasets';
import { installAuditReportAccess } from '../server/audit/report-access';
import { AuditPlayerReportError, exportAuditPlayer, openAuditReportReader, runAuditReport } from '../server/audit/report-player';
import { installAuditPlayerReport, playerColumns, type PlayerReportRow } from '../server/audit/report-player-source';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';

async function atLedgerTime<T>(t: TestContext, time: number, action: () => Promise<T>) {
  const mocked = t.mock.method(Date, 'now', () => time);
  try { return await action(); }
  finally { mocked.mock.restore(); }
}

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), payments = new PostgresDatabase(':memory:');
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close(), payments.close()]); });
  const directory = await mkdtemp(join(tmpdir(), 'royal-player-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const reader = 'audit_csv_it_reader_' + suffix, owner = 'audit_csv_it_owner_' + suffix;
  const other = 'audit_csv_it_other_' + suffix, password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(reader)} NOLOGIN;
    CREATE ROLE ${identifier(owner)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(other)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(reader)} TO ${identifier(owner)},${identifier(other)};
    ALTER ROLE ${identifier(owner)} SET temp_file_limit='32MB';
    ALTER ROLE ${identifier(other)} SET temp_file_limit='32MB'`);
  const login = (name: string) => databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: name, PGPASSWORD: password, PGPASSWORD_FILE: '', PGPOOL_MAX: '2' });
  const account = randomUUID(), opponent = randomUUID(), playId = randomUUID(), cryptoId = randomUUID();
  const fromMs = Date.UTC(2026, 0, 10, 12, 30, 0, 125), toMs = fromMs + 1000;
  for (const db of [game, payments]) {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(account, opponent);
  }
  const wallet = new DemoWalletStore(game, () => 0);
  const crypto = new CryptoStore(payments, cryptoConfig({}), {} as CryptoProvider, undefined, () => fromMs - 1);
  const deposit = (accountId: string, amount: number) =>
    wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount });
  const play = (accountId: string, id: string) => wallet.operate(accountId, { id, kind: 'play', gameId: 'royal-plinko',
    input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1, amount: 1 });
  await atLedgerTime(t, fromMs, () => deposit(account, 100));
  await atLedgerTime(t, fromMs, () => deposit(opponent, 100));
  await crypto.creditStarsDeposit(account, randomUUID(), '1000000', 'opening-' + suffix, 100);
  const sources = { game: game.schema, payments: payments.schema };
  const { datasetId } = await new AuditDatasets(audit, sources).startTest();
  await installAuditReportAccess(audit, reader);
  await installAuditPlayerReport(audit, reader, sources);
  await atLedgerTime(t, fromMs - 1, () => deposit(account, 1));
  const settled = await atLedgerTime(t, fromMs, () => play(account, playId));
  await atLedgerTime(t, fromMs, () => play(account, playId));
  await atLedgerTime(t, fromMs, () => play(opponent, randomUUID()));
  await atLedgerTime(t, toMs, () => deposit(account, 1));
  // A large canonical ledger value checks export precision beyond runtime wallet caps.
  const exact = '9007199254740993123', realBalance = (BigInt(exact) + 1000000n).toString();
  await payments.prepare(`INSERT INTO crypto_ledger(account_id,operation_id,entry_key,
    available_delta,reserved_delta,counterparty_delta,balance_units,reserved_units,created_at)
    VALUES (?,?,?,?::bigint,0,-(?::bigint),?::bigint,0,?)`).run(
    account, cryptoId, 'deposit:fixture:' + cryptoId, exact, exact, realBalance, fromMs);

  const gameSource = game.schema + '.demo_ledger', paymentSource = payments.schema + '.crypto_ledger';
  const grant = (operator: string, namespace: string) => audit.prepare(
    'INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)').run(operator, datasetId, namespace);
  await grant(owner, gameSource);
  await grant(other, gameSource);
  const filters = { accountId: account, fromMs, toMs };
  const options = { schema: audit.schema, datasetId, filters, limits: { pageSize: 1 } };
  const auditSchema = identifier(audit.schema);
  const destination = (name: string) => join(directory, name + '.csv');
  return { audit, auditSchema, account, opponent, datasetId, directory, destination, owner, other, login, grant, options,
    fromMs, playId, gameSource, paymentSource, cryptoId, exact, realBalance, payout: settled.gameRound!.payoutUnits };
}

function csvRows(content: string): PlayerReportRow[] {
  assert(content.endsWith('\n'));
  const lines = content.slice(0, -1).split('\n');
  assert.equal(lines.shift(), playerColumns.map(name => '"' + name + '"').join(','));
  // This fixture contains separator-free scalars. The writer tests cover CSV escaping.
  return lines.map(line => {
    const fields = line.split(',');
    assert.equal(fields.length, playerColumns.length);
    return Object.fromEntries(playerColumns.map((column, index) => [
      column, fields[index] === '' ? null : fields[index].replace(/^"|"$/g, ''),
    ])) as PlayerReportRow;
  });
}

test('player CSV uses scoped report credentials, real capture and bounded PostgreSQL pages', async t => {
  const f = await fixture(t);
  const journal = (jobId: string) => f.audit.prepare(`SELECT operator_name,dataset_id,status,row_count,byte_count,reason
    FROM audit_export_jobs WHERE id=?`).get(jobId);
  const start = (actor: pg.Client) => actor.query(`SELECT ${f.auditSchema}.audit_report_begin($1,'player',$2::jsonb) AS id`,
    [f.datasetId, JSON.stringify(f.options.filters)]).then(result => result.rows[0].id as string);
  const page = (actor: pg.Client, job: string, cursor?: { at: string; source: string; id: string }) =>
    actor.query(`SELECT ${f.auditSchema}.audit_report_player_page($1,$2,$3,$4,1) AS page`,
      [job, cursor?.at ?? null, cursor?.source ?? null, cursor?.id ?? null]);
  const cancel = (actor: pg.Client, job: string) =>
    actor.query(`SELECT ${f.auditSchema}.audit_report_finish($1,'cancelled',0,0,'cancelled')`, [job]);
  const readerBusy = { code: '55P03', constraint: 'audit_export_reader_slot' };
  const read = (name: string) => readFile(f.destination(name), 'utf8');
  const run = (name: string, changes?: Partial<Pick<Parameters<typeof exportAuditPlayer>[1], 'filters' | 'limits'>>) =>
    exportAuditPlayer(f.login(f.owner), { ...f.options, ...changes, destination: f.destination(name) });

  await t.test('only the job owner reads the selected account through the projection', async () => {
    const owner = new pg.Client(f.login(f.owner)), other = new pg.Client(f.login(f.other));
    try {
      await Promise.all([owner.connect(), other.connect()]);
      await owner.query('BEGIN');
      let rolledBack: string;
      try {
        rolledBack = await start(owner);
        await assert.rejects(page(owner, rolledBack), { code: '42501' });
      } finally {
        await owner.query('ROLLBACK');
      }
      assert.equal(await journal(rolledBack), undefined);
      const job = await start(owner);
      try {
        const first = (await page(owner, job)).rows[0].page;
        assert.equal(first.scanned, 1);
        assert.equal(first.rows[0].account_id, f.account);
        assert.equal(first.rows[0].source, f.gameSource);
        assert.equal(first.rows[0].operation_id, f.playId);
        await assert.rejects(page(other, job), { code: '42501' });
        for (const relation of [f.gameSource, f.paymentSource, f.auditSchema + '.audit_posting_refs',
          f.auditSchema + '.audit_report_acl', f.auditSchema + '.audit_export_jobs']) {
          await assert.rejects(owner.query('SELECT * FROM ' + relation), { code: '42501' });
        }
        await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
          .run(f.owner, f.datasetId, f.gameSource);
        try { await assert.rejects(page(owner, job), { code: '42501' }); }
        finally { await f.grant(f.owner, f.gameSource); }
      } finally {
        await cancel(owner, job);
      }
      await assert.rejects(page(owner, job), { code: '42501' });
    } finally {
      await Promise.all([owner.end(), other.end()]);
    }
  });

  await t.test('only one backend holds the export slot until its read transaction ends', async () => {
    const owner = new pg.Client(f.login(f.owner)), duplicate = new pg.Client(f.login(f.owner));
    const other = new pg.Client(f.login(f.other));
    try {
      await Promise.all([owner.connect(), duplicate.connect(), other.connect()]);
      const job = await start(duplicate);
      await owner.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      const first = (await page(owner, job)).rows[0].page;
      await assert.rejects(page(duplicate, job), readerBusy);
      await assert.rejects(page(other, job), { code: '42501' });
      const second = (await page(owner, job, first.cursor)).rows[0].page;
      assert.notEqual(second.cursor.id, first.cursor.id);
      assert.equal(second.rows[0].movement_type, 'payout');

      await cancel(duplicate, job);
      assert.equal((await journal(job))?.status, 'cancelled');
      await assert.rejects(start(other), readerBusy);
      for (const [kind, filters] of [['summary', f.options.filters], ['replay', { replayId: randomUUID() }]]) {
        await assert.rejects(other.query(`SELECT ${f.auditSchema}.audit_report_begin($1,$2,$3::jsonb)`,
          [f.datasetId, kind, JSON.stringify(filters)]), readerBusy);
      }
      const detail = await other.query(`SELECT ${f.auditSchema}.audit_report_begin($1,'detail',$2::jsonb) AS id`,
        [f.datasetId, JSON.stringify({ source: f.gameSource, postingId: first.cursor.id })]);
      await cancel(other, detail.rows[0].id);

      await owner.query('COMMIT');
      await assert.rejects(page(duplicate, job), { code: '42501' });
      const replacement = await start(other);
      assert.equal((await page(other, replacement)).rows[0].page.scanned, 1);
      await cancel(other, replacement);
    } finally {
      await Promise.all([owner.end(), duplicate.end(), other.end()]);
    }
  });

  await t.test('a projection slot conflict after admission records a controlled busy outcome', async () => {
    const first = new pg.Client(f.login(f.owner)), duplicate = new pg.Client(f.login(f.owner));
    let jobId: string | null = null;
    try {
      await Promise.all([first.connect(), duplicate.connect()]);
      await assert.rejects(runAuditReport(f.login(f.owner), f.options, 'player', 5_000, async (_settings, _schema, id) => {
        jobId = id;
        await first.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
        await page(first, id);
        await page(duplicate, id);
        return { rowCount: 0, bytes: 0 };
      }), error => error instanceof AuditPlayerReportError && error.code === 'report-busy' && error.jobId === jobId);
      assert.deepEqual(await journal(jobId!), { operator_name: f.owner, dataset_id: f.datasetId,
        status: 'failed', row_count: 0, byte_count: 0, reason: 'report-busy' });
    } finally {
      await Promise.all([first.end(), duplicate.end()]);
    }
  });

  await t.test('cancelling a blocked PostgreSQL query keeps admission closed while its backend is working', async () => {
    const blocker = await f.audit.pool.connect(), other = new pg.Client(f.login(f.other));
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    const waitFor = async (predicate: () => Promise<boolean>) => {
      const deadline = performance.now() + 3_000;
      do {
        if (await predicate()) return;
        await pause(5);
      } while (performance.now() < deadline);
      assert.fail('Timed out waiting for the report backend');
    };
    try {
      await other.connect();
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE ' + f.gameSource + ' IN ACCESS EXCLUSIVE MODE');
      let backend: number | undefined;
      pending = runAuditReport(f.login(f.owner), { ...f.options, signal: controller.signal }, 'player', 10_000,
        async (settings, _schema, jobId, signal) => {
          // Leave time to inspect the backend independently of the report runner's ordinary lock budget.
          const reader = await openAuditReportReader({ ...settings, lock_timeout: 8_000, statement_timeout: 9_000 }, jobId, signal);
          try {
            // Keep the fixture backend alive after client disconnect to exercise the admission fence.
            await reader.connection.query("SET LOCAL client_connection_check_interval='0'");
            backend = (await reader.connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            await page(reader.connection, jobId);
            return { rowCount: 0, bytes: 0 };
          } finally { await reader.finish(); }
        }).then(() => null, (error: unknown) => error);
      await waitFor(async () => backend !== undefined && !!await f.audit.prepare(`SELECT 1 FROM pg_stat_activity a
        JOIN pg_locks l ON l.pid=a.pid AND l.locktype='advisory' AND l.granted
        WHERE a.pid=? AND a.wait_event_type='Lock' AND a.query LIKE '%audit_report_player_page%'`).get(backend));
      controller.abort();
      const stopped = await pending;
      assert(stopped instanceof AuditPlayerReportError && stopped.code === 'cancelled' && stopped.jobId);
      assert.equal((await journal(stopped.jobId))?.status, 'cancelled');
      await assert.rejects(start(other), readerBusy);
      await blocker.query('ROLLBACK');
      await waitFor(async () => !await f.audit.prepare('SELECT 1 FROM pg_stat_activity WHERE pid=?').get(backend));
      await cancel(other, await start(other));
    } finally {
      controller.abort();
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await Promise.all([other.end(), pending]);
    }
  });

  await t.test('the named CSV export continues when PostgreSQL rejects connection polling', async t => {
    const query = pg.Client.prototype.query;
    let rejectedSettings = 0;
    const mock = t.mock.method(pg.Client.prototype, 'query', function (this: pg.Client, ...args: unknown[]) {
      if (typeof args[0] !== 'string' || !args[0].includes("name='client_connection_check_interval'")) {
        return Reflect.apply(query, this, args);
      }
      // Use a real PostgreSQL GUC error with the SQLSTATE returned by unsupported builds.
      return Reflect.apply(query, this, ["SELECT pg_catalog.set_config('client_connection_check_interval','-1ms',false)"])
        .catch((error: unknown) => {
          assert.equal((error as { code?: string }).code, '22023');
          rejectedSettings++;
          throw error;
        });
    });
    try {
      const exported = await run('connection-polling-unavailable');
      assert.equal(rejectedSettings, 1);
      assert.deepEqual(csvRows(await read('connection-polling-unavailable')).map(row => row.operation_id), [f.playId, f.playId]);
      assert.deepEqual(await journal(exported.jobId), { operator_name: f.owner, dataset_id: f.datasetId,
        status: 'succeeded', row_count: 2, byte_count: exported.bytes, reason: null });
    } finally { mock.mock.restore(); }
  });

  await t.test('account, date, source and game filters select unique canonical postings', async () => {
    const authorized = await run('game-source-only');
    const authorizedRows = csvRows(await read('game-source-only'));
    assert.equal(authorized.rowCount, 2);
    assert.deepEqual(authorizedRows.map(row => [row.source, row.account_id, row.operation_id]),
      Array.from({ length: 2 }, () => [f.gameSource, f.account, f.playId]));
    assert.deepEqual(authorizedRows.map(row => row.movement_type), ['stake', 'payout']);
    assert.deepEqual(authorizedRows.map(row => row.amount_units), ['-100', f.payout]);
    assert.deepEqual(authorizedRows.map(row => row.expected_balance_basis), ['adjacent', 'adjacent']);
    assert.equal(authorizedRows[0].expected_balance_units, '10000');
    assert(authorizedRows.every(row => row.expected_balance_units === row.stored_balance_units));
    assert.deepEqual(await journal(authorized.jobId), { operator_name: f.owner, dataset_id: f.datasetId,
      status: 'succeeded', row_count: 2, byte_count: authorized.bytes, reason: null });

    await f.grant(f.owner, f.paymentSource);
    const all = await run('all-sources');
    const contents = await read('all-sources');
    const allRows = csvRows(contents);
    assert.equal(all.rowCount, 3);
    assert.equal(all.bytes, Buffer.byteLength(contents));
    const refs = await f.audit.prepare(`SELECT source_namespace,source_row_id::text FROM audit_posting_refs
      WHERE dataset_id=? AND account_id=? AND occurred_at_ms=? ORDER BY occurred_at_ms,source_namespace,source_row_id`)
      .all(f.datasetId, f.account, f.fromMs);
    assert.deepEqual(allRows.map(row => [row.source, row.posting_id]), refs.map(row => [row.source_namespace, row.source_row_id]));
    assert.equal(new Set(allRows.map(row => JSON.stringify([row.source, row.posting_id]))).size, allRows.length);
    assert(allRows.every(row => row.occurred_at === new Date(f.fromMs).toISOString()));
    const real = allRows.find(row => row.operation_id === f.cryptoId)!;
    assert.deepEqual([real.contour, real.asset, real.scale, real.amount_units, real.reserved_delta_units,
      real.expected_balance_basis, real.expected_balance_units, real.stored_balance_units],
    ['real', 'USDT', '6', f.exact, '0', 'opening', f.realBalance, f.realBalance]);

    const filters = { ...f.options.filters, category: 'casino' as const, gameId: 'royal-plinko',
      modeId: 'normal', asset: 'VIRTUAL_USD', contour: 'virtual' as const };
    const filtered = await run('casino-filter', { filters });
    assert.equal(filtered.rowCount, 2);
    assert.deepEqual(csvRows(await read('casino-filter')), authorizedRows);
    const opponent = await run('opponent', { filters: { ...f.options.filters, accountId: f.opponent } });
    assert.equal(opponent.rowCount, 2);
    assert(csvRows(await read('opponent')).every(row => row.account_id === f.opponent));
  });

  await t.test('scan and byte limits journal failure and leave no export or temporary file', async () => {
    const completed = (await readdir(f.directory)).sort();
    const cases = [
      { name: 'scan-limit', filters: { ...f.options.filters, gameId: 'missing-game' },
        limits: { pageSize: 1, maxScanned: 1 } },
      { name: 'byte-limit', filters: f.options.filters,
        limits: { pageSize: 1, maxBytes: Buffer.byteLength(playerColumns.map(name => '"' + name + '"').join(',') + '\n') + 1 } },
    ];
    for (const { name, filters, limits } of cases) {
      let jobId: string | null = null;
      await assert.rejects(run(name, { filters, limits }), error => {
        if (!(error instanceof AuditPlayerReportError) || error.code !== name) return false;
        jobId = error.jobId;
        return !!jobId;
      });
      assert.deepEqual(await journal(jobId!), { operator_name: f.owner, dataset_id: f.datasetId,
        status: 'failed', row_count: 0, byte_count: 0, reason: name });
      assert.deepEqual((await readdir(f.directory)).sort(), completed);
    }
  });

  await t.test('the command uses an explicit operator URL file and returns the published CSV summary', async () => {
    const config = f.login(f.owner);
    const url = new URL('postgresql://localhost');
    url.hostname = config.host!;
    url.port = String(config.port);
    url.pathname = '/' + encodeURIComponent(config.database!);
    url.username = config.user!;
    if (typeof config.password !== 'string') throw new Error('Missing test login password');
    url.password = config.password;
    const secret = join(f.directory, 'operator-url');
    const destination = f.destination('command');
    const { fromMs, toMs } = f.options.filters;
    await writeFile(secret, url.toString() + '\n', { flag: 'wx', mode: 0o600 });
    try {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx',
        fileURLToPath(new URL('../scripts/audit.ts', import.meta.url)), 'player', '--schema', f.options.schema,
        '--dataset', f.datasetId, '--account', f.account, '--from', new Date(fromMs).toISOString(),
        '--to', new Date(toMs).toISOString(), '--output', destination, '--asset', 'USDT'],
      { timeout: 20_000, env: { ...process.env, ROYAL_AUDIT_DB_URL_FILE: secret, ROYAL_AUDIT_PGSSLMODE: 'disable' } });
      assert.equal(stderr, '');
      const summary = JSON.parse(stdout);
      const content = await read('command');
      assert.deepEqual(summary, { jobId: summary.jobId, rowCount: 1, bytes: Buffer.byteLength(content) });
      assert.deepEqual(csvRows(content).map(row => [row.operation_id, row.amount_units]), [[f.cryptoId, f.exact]]);
      assert.deepEqual(await journal(summary.jobId), { operator_name: f.owner, dataset_id: f.datasetId,
        status: 'succeeded', row_count: 1, byte_count: summary.bytes, reason: null });
    } finally {
      await rm(secret, { force: true });
    }
  });
});
