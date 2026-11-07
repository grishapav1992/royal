import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { installAuditReportAccess } from '../server/audit/report-access';

test('audit report roles enforce dataset grants, journal ownership and export leases in PostgreSQL', async t => {
  const owner = new PostgresDatabase(':memory:');
  const source = new PostgresDatabase(':memory:');
  const roleSuffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const readerRole = 'audit_reader_' + roleSuffix;
  const cleanupRole = 'audit_cleanup_' + roleSuffix;
  const aliceRole = 'audit_alice_' + roleSuffix;
  const bobRole = 'audit_bob_' + roleSuffix;
  const outsiderRole = 'audit_outside_' + roleSuffix;
  const password = randomUUID();
  const clients: PostgresDatabase[] = [];
  const sourceA = source.schema + '.demo_ledger';
  const sourceB = source.schema + '.crypto_ledger';
  const datasetA = randomUUID();
  const datasetB = randomUUID();
  const filters = { accountId: 'player-example', fromMs: 1000, toMs: 2000, category: 'casino',
    gameId: 'mines', modeId: 'classic', asset: 'NILE', contour: 'virtual' };
  const audit = identifier(owner.schema);
  const sourceSchema = identifier(source.schema);
  const acl = audit + '.audit_report_acl';
  const jobs = audit + '.audit_export_jobs';
  const begin = (actor: PostgresDatabase, dataset = datasetA, selection: unknown = filters, kind = 'player') =>
    actor.prepare(`SELECT ${audit}.audit_report_begin(?, ?, ?::jsonb) AS id`).get(dataset, kind, JSON.stringify(selection))
      .then(row => row!.id as string);
  const finish = (actor: PostgresDatabase, job: string, outcome = 'succeeded', count: number | null = 2,
    bytes: number | null = 28, reason: string | null = null) =>
    actor.prepare(`SELECT ${audit}.audit_report_finish(?, ?, ?, ?, ?)`).get(job, outcome, count, bytes, reason);

  try {
    await owner.exec(`CREATE ROLE ${identifier(readerRole)} NOLOGIN;
      CREATE ROLE ${identifier(cleanupRole)} NOLOGIN;
      CREATE ROLE ${identifier(aliceRole)} LOGIN PASSWORD '${password}';
      CREATE ROLE ${identifier(bobRole)} LOGIN PASSWORD '${password}';
      CREATE ROLE ${identifier(outsiderRole)} LOGIN PASSWORD '${password}';
      GRANT ${identifier(readerRole)} TO ${identifier(aliceRole)},${identifier(bobRole)}`);
    await assert.rejects(installAuditReportAccess(owner, aliceRole), /unprivileged NOLOGIN/);
    await assert.rejects(installAuditReportAccess(owner, 'not a role'), /Invalid PostgreSQL report role/);
    await installAuditReportAccess(owner, readerRole);
    await installAuditReportAccess(owner, readerRole);
    await source.exec(`CREATE TABLE demo_ledger(account_id text);
      CREATE TABLE crypto_ledger(account_id text);
      INSERT INTO demo_ledger VALUES('fixture-demo');
      INSERT INTO crypto_ledger VALUES('fixture-crypto')`);
    await owner.prepare(`INSERT INTO ${audit}.audit_datasets VALUES(?, 'test', 0, 1000), (?, 'test', 1000, NULL)`)
      .run(datasetA, datasetB);
    await owner.prepare(`INSERT INTO ${audit}.audit_dataset_sources VALUES(?, ?), (?, ?), (?, ?)`)
      .run(datasetA, sourceA, datasetA, sourceB, datasetB, sourceB);
    await owner.prepare(`INSERT INTO ${acl} VALUES(?, ?, ?), (?, ?, ?)`)
      .run(aliceRole, datasetA, sourceA, bobRole, datasetB, sourceB);

    const login = (user: string) => {
      const client = new PostgresDatabase(owner.schema, { existingSchema: user !== outsiderRole,
        readOnly: user === outsiderRole,
        config: databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
          PGUSER: user, PGPASSWORD: password, PGPASSWORD_FILE: '', PGPOOL_MAX: '2' }) });
      clients.push(client);
      return client;
    };
    const alice = login(aliceRole);
    const bob = login(bobRole);
    const outsider = login(outsiderRole);

    await t.test('server assigns operator and scope and each operator can close only their own job', async () => {
      await assert.rejects(begin(alice, datasetB), { code: '42501' });
      await assert.rejects(begin(alice, randomUUID()), { code: '42501' });
      await assert.rejects(begin(outsider), { code: '42501' });
      const aliceJob = await alice.transaction(async () => {
        await alice.exec(`SET LOCAL ROLE ${identifier(readerRole)}`);
        return begin(alice);
      });
      const bobJob = await begin(bob, datasetB, { accountId: 'player-example', fromMs: 1000, toMs: 2000 });
      const started = await owner.prepare(`SELECT operator_name,dataset_id,kind,filters,status,
        extract(epoch FROM expires_at-started_at)::bigint AS lease_seconds FROM ${jobs} WHERE id=?`).get(aliceJob);
      assert.deepEqual(started, { operator_name: aliceRole, dataset_id: datasetA, kind: 'player', filters, status: 'running', lease_seconds: 300 });
      await assert.rejects(finish(bob, aliceJob), { code: '42501' });
      await assert.rejects(finish(alice, bobJob), { code: '42501' });
      await finish(alice, aliceJob);
      await finish(bob, bobJob, 'cancelled', null, null, 'cancelled');
      await assert.rejects(finish(alice, aliceJob), { code: '42501' });
      assert.deepEqual(await owner.prepare(`SELECT status,row_count,byte_count,reason,
        finished_at IS NOT NULL AS finished FROM ${jobs} WHERE id=?`).get(aliceJob),
      { status: 'succeeded', row_count: 2, byte_count: 28, reason: null, finished: true });
      assert.deepEqual(await owner.prepare(`SELECT status,reason FROM ${jobs} WHERE id=?`).get(bobJob),
        { status: 'cancelled', reason: 'cancelled' });
    });

    await t.test('report credentials cannot query source and journal tables or assume cleanup rights', async () => {
      for (const sql of [
        `SELECT * FROM ${sourceSchema}.demo_ledger`,
        `SELECT * FROM ${sourceSchema}.crypto_ledger`,
        `SELECT * FROM ${audit}.audit_datasets`,
        `SELECT * FROM ${audit}.audit_dataset_sources`,
        `SELECT * FROM ${acl}`,
        `SELECT * FROM ${jobs}`,
        `INSERT INTO ${acl} SELECT * FROM ${acl}`,
        `UPDATE ${jobs} SET status='failed'`,
        `DELETE FROM ${audit}.audit_datasets`,
        `TRUNCATE ${jobs}`,
        `CREATE TABLE ${audit}.report_override(id uuid)`,
        `SET ROLE ${identifier(cleanupRole)}`,
      ]) await assert.rejects(alice.exec(sql), { code: '42501' }, sql);
    });

    await t.test('filters and journal outcomes have bounded fields and controlled values', async () => {
      for (const selection of [
        null,
        [filters],
        { ...filters, operator: bobRole },
        { ...filters, sourceNamespace: sourceB },
        { ...filters, accountId: undefined },
        { ...filters, accountId: 'x'.repeat(129) },
        { ...filters, fromMs: '1000' },
        { ...filters, fromMs: 1000.25 },
        { ...filters, fromMs: -1 },
        { ...filters, fromMs: 2000 },
        { ...filters, fromMs: 0, toMs: 31 * 24 * 60 * 60 * 1000 + 1 },
        { ...filters, fromMs: Number.MAX_SAFE_INTEGER, toMs: Number.MAX_SAFE_INTEGER + 1 },
        { ...filters, category: 'payments' },
        { ...filters, contour: null },
        { ...filters, gameId: 'extra words' },
        { ...filters, modeId: false },
        { ...filters, asset: 'usd' },
      ]) await assert.rejects(begin(alice, datasetA, selection), { code: '22023' }, JSON.stringify(selection));
      await assert.rejects(begin(alice, datasetA, filters, 'anything'), { code: '22023' });
      const job = await begin(alice, datasetA, { ...filters, toMs: filters.fromMs + 31 * 24 * 60 * 60 * 1000 });
      await assert.rejects(finish(alice, job, 'succeeded', null), { code: '22023' });
      await assert.rejects(finish(alice, job, 'succeeded', -1), { code: '22023' });
      await assert.rejects(finish(alice, job, 'succeeded', 2, Number.MAX_SAFE_INTEGER + 1), { code: '22023' });
      await assert.rejects(finish(alice, job, 'failed', null, null, 'arbitrary user text'), { code: '22023' });
      await assert.rejects(finish(alice, job, 'expired', null, null, 'lease-expired'), { code: '22023' });
      await finish(alice, job, 'failed', null, null, 'scan-limit');
      assert.deepEqual(await owner.prepare(`SELECT status,row_count,byte_count,reason FROM ${jobs} WHERE id=?`).get(job),
        { status: 'failed', row_count: null, byte_count: null, reason: 'scan-limit' });
    });

    await t.test('concurrent begins keep one active job and a later begin records an expired lease', async () => {
      const outcomes = await Promise.allSettled([begin(alice), begin(alice)]);
      const started = outcomes.filter(outcome => outcome.status === 'fulfilled');
      const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
      assert.equal(started.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, '55P03');
      const job = started[0].value;
      await owner.prepare(`WITH fixture AS (SELECT clock_timestamp() AS now)
        UPDATE ${jobs} SET started_at=fixture.now-interval '6 minutes',expires_at=fixture.now-interval '1 minute'
        FROM fixture WHERE id=?`).run(job);
      await assert.rejects(finish(alice, job), { code: '42501' });
      const replacement = await begin(alice);
      assert.notEqual(replacement, job);
      assert.deepEqual(await owner.prepare(`SELECT status,reason,finished_at IS NOT NULL AS finished FROM ${jobs} WHERE id=?`).get(job),
        { status: 'expired', reason: 'lease-expired', finished: true });
      await finish(alice, replacement);
    });
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await source.close();
    await owner.close();
  }
});
