import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { AuditDatasets } from '../../server/audit/datasets';
import { installAuditReportAccess } from '../../server/audit/report-access';
import { installAuditReplayReport } from '../../server/audit/report-replay-source';
import { cryptoConfig } from '../../server/crypto/config';
import type { CryptoProvider } from '../../server/crypto/nowpayments';
import { CryptoStore } from '../../server/crypto/store';
import { databaseConfig, PostgresDatabase } from '../../server/database';
import { DemoWalletStore } from '../../server/demoWallet';
import { FinanceStore, migrateFinance } from '../../server/finance/store';
import { PaymentOutbox } from '../../server/payments/outbox';
import { VirtualPvpLedger } from '../../server/pvp/virtual-wallet';
import { seedAuditLoadReplay } from '../../scripts/audit-load-replay-fixture';
import { CARIBBEAN_GAME } from '../../src/shared/caribbeanTreasures';

const port = process.argv[2];
const password = process.env.ROYAL_AUDIT_RESTORE_FIXTURE_PASSWORD;
assert.equal(process.env.NODE_ENV, 'test');
assert(port && /^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535);
assert(password && /^[a-f0-9]{64}$/.test(password));
const config = databaseConfig({
  PGHOST: '127.0.0.1', PGPORT: port, PGDATABASE: 'royal_finance_sim',
  PGUSER: 'finance_schema_owner', PGPASSWORD: password, PGSSLMODE: 'disable',
});
const admin = new pg.Pool(config);
const databases: PostgresDatabase[] = [];
let financeRuntime: pg.Pool | undefined;
try {
  const { rows: [fixture] } = await admin.query(`SELECT current_setting('royal.audit_restore_fixture',true) AS marker,
    current_setting('server_version_num')::int / 10000 AS major,
    NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname LIKE 'royal_%') AS empty`);
  assert.deepEqual(fixture, { marker: 'synthetic', major: 17, empty: true });

  await migrateFinance(admin);
  for (const role of ['finance_app', 'finance_ingest', 'royal_game_app', 'royal_payments_app']) {
    await admin.query('CREATE ROLE ' + pg.escapeIdentifier(role) + ' LOGIN PASSWORD ' + pg.escapeLiteral(password));
  }
  await admin.query(`GRANT royal_finance_runtime TO finance_app WITH INHERIT TRUE;
    GRANT royal_finance_observer TO finance_ingest WITH INHERIT TRUE;
    GRANT CREATE ON DATABASE royal_finance_sim TO royal_game_app,royal_payments_app`);
  financeRuntime = new pg.Pool({ ...config, user: 'finance_app' });
  const finance = new FinanceStore(financeRuntime);
  await finance.checkRuntimeRole();
  await finance.createUser('synthetic-audit-restore');
  await finance.execute('simulator', randomUUID(), 'simulate_deposit', {
    userId: 'synthetic-audit-restore', eventId: randomUUID(), amountUnits: '4000000',
  });

  const game = new PostgresDatabase('royal_game', { config: { ...config, user: 'royal_game_app' } });
  const payments = new PostgresDatabase('royal_payments', { config: { ...config, user: 'royal_payments_app' } });
  const audit = new PostgresDatabase('royal_audit', { config });
  databases.push(game, payments, audit);
  const accounts: [string, string] = [randomUUID(), randomUUID()];
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(...accounts);
  await payments.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await payments.prepare('INSERT INTO accounts VALUES (?)').run(accounts[0]);
  const wallet = new DemoWalletStore(game);
  const bank = new VirtualPvpLedger(game, wallet);
  for (const account of accounts) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 1000 });
  await bank.ready;
  const outbox = new PaymentOutbox(payments, 'http://fixture.invalid', 'a'.repeat(64), Promise.resolve(), async () => {
    throw new Error('Synthetic restore fixture does not deliver payment events');
  });
  const crypto = new CryptoStore(payments, cryptoConfig({}), {} as CryptoProvider, outbox.ready,
    undefined, undefined, change => outbox.record(change));
  await crypto.ready;
  const sources = { game: game.schema, payments: payments.schema };
  const datasets = new AuditDatasets(audit, sources);
  const { datasetId } = await datasets.startTest();
  await audit.exec('CREATE ROLE royal_audit_reader NOLOGIN; CREATE ROLE royal_audit_recorder LOGIN');
  await installAuditReportAccess(audit, 'royal_audit_reader');
  await installAuditReplayReport(audit, 'royal_audit_reader', sources);
  await audit.exec(`GRANT USAGE ON SCHEMA royal_audit TO royal_audit_recorder;
    GRANT SELECT ON audit_datasets,audit_dataset_sources TO royal_audit_recorder;
    GRANT UPDATE (capture_lock_permission) ON audit_datasets TO royal_audit_recorder;
    GRANT SELECT,INSERT ON audit_evidence,audit_attempt_capture_gaps TO royal_audit_recorder;
    GRANT UPDATE (missing_count,first_at_ms,last_at_ms) ON audit_attempt_capture_gaps TO royal_audit_recorder`);
  const replay = await seedAuditLoadReplay(game, audit, bank, { datasetId, environment: 'test' }, accounts);
  const accepted = await wallet.expansion.operate(accounts[0], {
    id: randomUUID(), gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1,
    settings: { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } },
  });
  assert.equal(accepted.session.state, 'active');
  assert.equal(accepted.replayed, false);
  const payment = randomUUID();
  await crypto.creditStarsDeposit(accounts[0], payment, '4000000', 'synthetic-' + payment, Date.now());
  const captured = await audit.prepare(`SELECT count(*) AS count FROM audit_posting_refs
    WHERE dataset_id=? AND source_namespace=?`).get(datasetId, 'royal_payments.crypto_ledger');
  assert.equal(captured?.count, 1);
  assert(replay.events > 0);
} finally {
  await Promise.all([...databases.map(database => database.close()), financeRuntime?.end(), admin.end()]);
}
