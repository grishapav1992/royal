import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { AuditDatasets } from '../server/audit/datasets';
import { installAuditReportAccess } from '../server/audit/report-access';
import { readAuditSummary } from '../server/audit/report-summary';
import { AUDIT_SUMMARY_SCAN_CAP, installAuditSummaryReport, type SummaryReport } from '../server/audit/report-summary-source';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { FlagToteStore } from '../server/flagTote';
import { PaymentCredits } from '../server/payments/credits';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { TOTE_TIMING } from '../src/shared/flagTote';

async function atLedgerTime<T>(t: TestContext, time: () => number, action: () => Promise<T>) {
  const mocked = t.mock.method(Date, 'now', time);
  try { return await action(); }
  finally { mocked.mock.restore(); }
}

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), payments = new PostgresDatabase(':memory:');
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close(), payments.close()]); });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const group = 'audit_summary_reader_' + suffix, owner = 'audit_summary_owner_' + suffix;
  const other = 'audit_summary_other_' + suffix, password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(group)} NOLOGIN;
    CREATE ROLE ${identifier(owner)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(other)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(group)} TO ${identifier(owner)},${identifier(other)};
    ALTER ROLE ${identifier(owner)} SET temp_file_limit='32MB';
    ALTER ROLE ${identifier(other)} SET temp_file_limit='32MB'`);
  const clients: pg.Client[] = [];
  t.after(async () => { await Promise.all(clients.map(client => client.end())); });
  const config = (user: string) => databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: user, PGPASSWORD: password, PGPASSWORD_FILE: '', PGPOOL_MAX: '2' });
  const login = async (user: string) => {
    const client = new pg.Client(config(user));
    clients.push(client);
    await client.connect();
    return client;
  };
  const a = randomUUID(), b = randomUUID();
  for (const db of [game, payments]) {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(a, b);
  }
  const fromMs = Date.UTC(2026, 0, 10), toMs = fromMs + TOTE_TIMING.period;
  const wallet = new DemoWalletStore(game, () => 0);
  const crypto = new CryptoStore(payments, cryptoConfig({}), {} as CryptoProvider, undefined, () => fromMs + 10);
  const credits = new PaymentCredits(game);
  for (const account of [a, b]) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 100 });
  await Promise.all([crypto.ready, credits.ready]);
  const schemas = { game: game.schema, payments: payments.schema };
  const { datasetId } = await new AuditDatasets(audit, schemas).startTest();
  await installAuditReportAccess(audit, group);
  await installAuditSummaryReport(audit, group, schemas);
  const gameSource = game.schema + '.demo_ledger', paymentSource = payments.schema + '.crypto_ledger';
  const grant = (operator: string, namespace: string) => audit.prepare(
    'INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)').run(operator, datasetId, namespace);
  for (const [operator, source] of [[owner, gameSource], [owner, paymentSource], [other, gameSource]]) {
    await grant(operator, source);
  }

  const pvp = new VirtualPvpLedger(game, wallet);
  await atLedgerTime(t, () => fromMs + 100, async () => {
    for (const winnerId of [a, null]) {
      const matchId = randomUUID();
      for (const account of [a, b]) await pvp.pvpHold(account, { matchId, gameId: 'chess', stakeUnits: '1000000' });
      await pvp.pvpFinish(a, { matchId, winnerId, reason: winnerId ? 'win' : 'draw' });
    }
  });
  let toteTime = fromMs + 1;
  const tote = new FlagToteStore(game, account => wallet.snapshotInTransaction(account), wallet.ready, () => toteTime, () => 0);
  const round = (await tote.snapshot(a)).round;
  await atLedgerTime(t, () => fromMs + 101, async () => {
    for (const [account, country, stakeUnits] of [[a, 'FR', '100'], [a, 'BR', '200'], [b, 'DE', '100']]) {
      await tote.bet(account, { id: randomUUID(), roundId: round.id, rulesVersion: 1, country, stakeUnits });
    }
  });
  toteTime = round.finishesAt;
  let ledgerTick = toteTime;
  await atLedgerTime(t, () => ledgerTick++, () => tote.advance());
  const poolCredits = await game.prepare(`SELECT created_at,amount_units FROM demo_ledger
    WHERE operation_id=? ORDER BY id`).all('flag-tote:' + round.id + ':final');
  assert.equal(poolCredits.length, 2);
  assert(poolCredits[1].created_at > poolCredits[0].created_at);

  const starsId = randomUUID(), charge = 'summary-' + suffix;
  await crypto.creditStarsDeposit(a, starsId, '1000000', charge, 100);
  const mirror = { event_id: createHash('sha256').update('deposit:telegram-stars:' + charge).digest('hex'),
    user_id: a, payment_id: starsId, kind: 'deposit', currency: 'USDT', scale: 6, deposit_amount: '1',
    available_delta_units: '1000000', reserved_delta_units: '0', created_at: fromMs + 10 };
  await credits.apply(mirror);
  const exact = '9007199254740993123';
  const post = async (id: string, key: string, available: string, reserved: string, at: number) => {
    await payments.prepare(`INSERT INTO crypto_ledger(account_id,operation_id,entry_key,
      available_delta,reserved_delta,counterparty_delta,balance_units,reserved_units,created_at)
      VALUES (?,?,?,?::bigint,?::bigint,?::bigint,0,0,?)`)
      .run(b, id, key, available, reserved, String(-BigInt(available) - BigInt(reserved)), at);
  };
  const largeId = randomUUID(), paid = randomUUID(), refunded = randomUUID();
  await post(largeId, 'deposit:fixture:' + largeId, exact, '0', fromMs + 10);
  await post(paid, 'reserve:' + paid, '-300', '300', fromMs - 1);
  await post(paid, 'paid:' + paid, '0', '-300', fromMs + 20);
  await post(refunded, 'reserve:' + refunded, '-100', '100', fromMs + 21);
  await post(refunded, 'refund:' + refunded, '100', '-100', fromMs + 22);
  const missingAt = toMs + 20;
  await audit.prepare(`INSERT INTO audit_posting_refs(dataset_id,source_namespace,source_row_id,account_id,operation_id,occurred_at_ms)
    VALUES (?,?,500000,?,?,?)`).run(datasetId, gameSource, a, randomUUID(), missingAt);
  const unknown = randomUUID();
  await post(unknown, 'unknown:' + unknown, '40', '0', missingAt);

  const ownerLogin = await login(owner), otherLogin = await login(other);
  const schema = identifier(audit.schema);
  const begin = (client: pg.Client, filters: object) => client.query(
    `SELECT ${schema}.audit_report_begin($1,'summary',$2::jsonb) AS id`,
    [datasetId, JSON.stringify(filters)]).then(result => result.rows[0].id as string);
  const read = (client: pg.Client, job: string) => client.query<{ summary: SummaryReport }>(
    `SELECT ${schema}.audit_report_summary($1) AS summary`, [job]).then(result => result.rows[0].summary);
  const finish = (client: pg.Client, job: string) => client.query(
    `SELECT ${schema}.audit_report_finish($1,'cancelled',0,0,'cancelled')`, [job]);
  const run = async (filters: object = { fromMs, toMs }, client = ownerLogin) => {
    const job = await begin(client, filters);
    try { return await read(client, job); }
    finally { await finish(client, job); }
  };
  return { audit, owner, ownerLogin, otherLogin, begin, read, finish, run, fromMs, toMs, datasetId,
    a, exact, gameSource, paymentSource, poolCredits, missingAt, operatorConfig: config(owner) };
}

test('period summary reports exact scoped totals, confirmations, refunds and single commissions', async t => {
  const f = await fixture(t);
  const get = (summary: SummaryReport, category: string | null, movement: string, contour = 'virtual') =>
    summary.rows.find(row => row.category === category && row.movement_type === movement && row.contour === contour)!;

  await t.test('a committed summary job is scoped to its login and current source ACL', async () => {
    await f.ownerLogin.query('BEGIN');
    try {
      const uncommitted = await f.begin(f.ownerLogin, { fromMs: f.fromMs, toMs: f.toMs });
      await assert.rejects(f.read(f.ownerLogin, uncommitted), { code: '42501' });
    } finally { await f.ownerLogin.query('ROLLBACK'); }
    const job = await f.begin(f.ownerLogin, { fromMs: f.fromMs, toMs: f.toMs });
    try {
      await assert.rejects(f.read(f.otherLogin, job), { code: '42501' });
      const limited = await f.run({ fromMs: f.fromMs, toMs: f.toMs }, f.otherLogin);
      assert.deepEqual(limited.sources, [f.gameSource]);
      assert(limited.rows.length > 0 && limited.rows.every(row => row.contour === 'virtual'));
      await f.audit.prepare('DELETE FROM audit_report_acl WHERE operator_name=? AND dataset_id=? AND source_namespace=?')
        .run(f.owner, f.datasetId, f.paymentSource);
      try { assert.deepEqual((await f.read(f.ownerLogin, job)).sources, [f.gameSource]); }
      finally {
        await f.audit.prepare('INSERT INTO audit_report_acl VALUES (?,?,?)').run(f.owner, f.datasetId, f.paymentSource);
      }
    } finally { await f.finish(f.ownerLogin, job); }
    await assert.rejects(f.read(f.ownerLogin, job), { code: '42501' });
  });

  await t.test('scope, date and typed groups include canonical money and exclude the payment mirror', async () => {
    const result = await f.run();
    assert.equal(result.datasetId, f.datasetId);
    assert.equal(result.environment, 'test');
    assert.match(result.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(result.sources, [f.gameSource, f.paymentSource].sort());
    assert.deepEqual(result.gaps, { unavailablePostings: 0, unclassifiedPostings: 0,
      invalidWithdrawalPostings: 0, unavailableFees: 0, feesExcludedForAccount: false });
    assert.equal(result.scanned, 17);
    const deposit = get(result, null, 'deposit', 'real');
    assert.deepEqual([deposit.asset, deposit.scale, deposit.posting_count, deposit.amount_units],
      ['USDT', '6', '2', String(BigInt(f.exact) + 1_000_000n)]);
    const paid = get(result, null, 'withdrawal-paid', 'real');
    assert.deepEqual([paid.posting_count, paid.amount_units, paid.reserved_delta_units, paid.confirmed_withdrawal_units],
      ['1', '0', '-300', '300']);
    const reserve = get(result, null, 'withdrawal-reserve', 'real');
    assert.deepEqual([reserve.posting_count, reserve.amount_units, reserve.confirmed_withdrawal_units], ['1', '-100', null]);
    const refund = get(result, null, 'refund', 'real');
    assert.deepEqual([refund.posting_count, refund.amount_units, refund.confirmed_withdrawal_units], ['1', '100', null]);
    assert.deepEqual([get(result, 'pvp', 'refund').posting_count, get(result, 'pvp', 'refund').amount_units], ['2', '200']);
    assert.deepEqual([get(result, 'pvp', 'fee').posting_count, get(result, 'pvp', 'fee').fee_units], ['0', '10']);
    assert.deepEqual([get(result, 'totalizator', 'payout').posting_count, get(result, 'totalizator', 'payout').amount_units], ['2', '380']);
    assert.deepEqual([get(result, 'totalizator', 'fee').posting_count, get(result, 'totalizator', 'fee').fee_units], ['0', '20']);
    assert.equal(get(result, 'pvp', 'fee').amount_units, null);

    const firstAt = f.poolCredits[0].created_at, secondAt = f.poolCredits[1].created_at;
    const first = await f.run({ fromMs: firstAt, toMs: secondAt, category: 'totalizator' });
    const second = await f.run({ fromMs: secondAt, toMs: secondAt + 1, category: 'totalizator' });
    assert.equal(get(first, 'totalizator', 'fee').fee_units, '20');
    assert.equal(get(first, 'totalizator', 'payout').posting_count, '1');
    assert.equal(get(second, 'totalizator', 'payout').posting_count, '1');
    assert.equal(get(second, 'totalizator', 'fee'), undefined);
    const account = await f.run({ fromMs: f.fromMs, toMs: f.toMs, accountId: f.a, category: 'pvp' });
    assert.equal(account.gaps.feesExcludedForAccount, true);
    assert.equal(get(account, 'pvp', 'payout').amount_units, '190');
    assert.equal(get(account, 'pvp', 'refund').amount_units, '100');
    assert.equal(get(account, 'pvp', 'fee'), undefined);
  });

  await t.test('coverage remains visible under category filters and excessive windows fail without totals', async () => {
    const gaps = await f.run({ fromMs: f.missingAt, toMs: f.missingAt + 1, category: 'casino' });
    assert.equal(gaps.scanned, 2);
    assert.equal(gaps.gaps.unavailablePostings, 1);
    assert.equal(gaps.gaps.unclassifiedPostings, 1);
    assert.deepEqual(gaps.rows, []);
    const capAt = f.toMs + 100;
    await f.audit.prepare(`INSERT INTO audit_posting_refs(dataset_id,source_namespace,source_row_id,account_id,operation_id,occurred_at_ms)
      SELECT ?::uuid,?,n+1000000,?,'fixture-overflow',?::bigint FROM generate_series(1,?::bigint) n`)
      .run(f.datasetId, f.gameSource, f.a, capAt, AUDIT_SUMMARY_SCAN_CAP + 1);
    await assert.rejects(f.run({ fromMs: capAt, toMs: capAt + 1, category: 'casino' }),
      { code: '54000', message: 'Audit summary scan limit exceeded' });
  });

  await t.test('the reader and CLI journal exact output sizes under the named operator login', async t => {
    const filters = { fromMs: f.fromMs, toMs: f.toMs, category: 'totalizator' as const };
    const input = { schema: f.audit.schema, datasetId: f.datasetId, filters };
    const journal = (jobId: string) => f.audit.prepare(`SELECT operator_name,kind,status,row_count,byte_count,reason
      FROM audit_export_jobs WHERE id=?`).get(jobId);
    const direct = await readAuditSummary(f.operatorConfig, input);
    assert.equal(get(direct, 'totalizator', 'fee').fee_units, '20');
    assert.deepEqual(await journal(direct.jobId), { operator_name: f.owner, kind: 'summary', status: 'succeeded',
      row_count: direct.rows.length, byte_count: Buffer.byteLength(JSON.stringify(direct) + '\n'), reason: null });

    const directory = await mkdtemp(join(tmpdir(), 'royal-summary-cli-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const url = new URL('postgresql://localhost');
    const { host, port, database, user, password } = f.operatorConfig;
    url.hostname = host!;
    url.port = String(port);
    url.pathname = '/' + encodeURIComponent(database!);
    url.username = user!;
    if (typeof password !== 'string') throw new Error('Missing test login password');
    url.password = password;
    const secret = join(directory, 'operator-url');
    await writeFile(secret, url.toString() + '\n', { flag: 'wx', mode: 0o600 });
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx',
      fileURLToPath(new URL('../scripts/audit.ts', import.meta.url)), 'summary', '--schema', input.schema,
      '--dataset', f.datasetId, '--from', new Date(f.fromMs).toISOString(), '--to', new Date(f.toMs).toISOString(),
      '--category', 'totalizator'],
    { timeout: 20_000, env: { ...process.env, ROYAL_AUDIT_DB_URL_FILE: secret, ROYAL_AUDIT_PGSSLMODE: 'disable' } });
    assert.equal(stderr, '');
    const output = JSON.parse(stdout) as SummaryReport & { jobId: string };
    assert.deepEqual(output.rows, direct.rows);
    assert.deepEqual(await journal(output.jobId), { operator_name: f.owner, kind: 'summary', status: 'succeeded',
      row_count: output.rows.length, byte_count: Buffer.byteLength(stdout), reason: null });
  });
});
