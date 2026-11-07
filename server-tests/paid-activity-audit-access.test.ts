import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { installAuditReportAccess } from '../server/audit/report-access';
import { readAuditSummary } from '../server/audit/report-summary';

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

    const loginConfig = (user: string) => databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
      PGUSER: user, PGPASSWORD: password, PGPASSWORD_FILE: '', PGPOOL_MAX: '2' });
    const login = (user: string) => {
      const client = new PostgresDatabase(owner.schema, { existingSchema: user !== outsiderRole,
        readOnly: user === outsiderRole,
        config: loginConfig(user) });
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
      const bobJob = await begin(bob, datasetB, { source: sourceB, postingId: '1' }, 'detail');
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

    await t.test('one export slot covers different roles, datasets and export kinds', async () => {
      const range = { fromMs: 1000, toMs: 2000 };
      const outcomes = await Promise.allSettled([begin(alice), begin(bob, datasetB, range, 'summary')]);
      const first = outcomes[0], second = outcomes[1];
      const admitted = first.status === 'fulfilled' ? first : second;
      const denied = first.status === 'rejected' ? first : second;
      assert(admitted.status === 'fulfilled' && denied.status === 'rejected');
      assert.equal(denied.reason.code, '55P03');
      const active = admitted.value;
      const blockedRole = first.status === 'fulfilled' ? bobRole : aliceRole;
      const blocked = first.status === 'fulfilled' ? bob : alice;
      const blockedDataset = first.status === 'fulfilled' ? datasetB : datasetA;
      await assert.rejects(readAuditSummary(loginConfig(blockedRole), { schema: owner.schema, datasetId: blockedDataset,
        filters: range }), { code: 'report-busy', jobId: null });
      await assert.rejects(begin(blocked, blockedDataset, { replayId: randomUUID() }, 'replay'), { code: '55P03' });
      assert.equal((await owner.prepare(`SELECT count(*)::int AS n FROM ${jobs} WHERE status='running'`).get())?.n, 1);
      await owner.prepare(`WITH fixture AS (SELECT clock_timestamp() AS now)
        UPDATE ${jobs} SET started_at=fixture.now-interval '6 minutes',expires_at=fixture.now-interval '1 minute'
        FROM fixture WHERE id=?`).run(active);
      const replacement = await begin(blocked, blockedDataset, { replayId: randomUUID() }, 'replay');
      assert.deepEqual(await owner.prepare(`SELECT status,reason FROM ${jobs} WHERE id=?`).get(active),
        { status: 'expired', reason: 'lease-expired' });
      await finish(blocked, replacement, 'cancelled', null, null, 'cancelled');
      const available = await begin(alice);
      await finish(alice, available);
    });

    await t.test('standby publication locks pinned grants and terminal jobs occupy the slot until drained', async () => {
      const standbyBegin = (actor: PostgresDatabase, dataset = datasetA) => actor.prepare(
        `SELECT ${audit}.audit_report_begin_standby(?,'player',?::jsonb) AS id`)
        .get(dataset, JSON.stringify(filters)).then(row => row!.id as string);
      const authorize = (actor: PostgresDatabase, jobId: string) => actor.prepare(
        `SELECT ${audit}.audit_report_authorize_standby_publish(?)`).get(jobId);
      await assert.rejects(standbyBegin(alice), { code: '42501' });
      await owner.exec(`GRANT EXECUTE ON FUNCTION ${audit}.audit_report_begin_standby(uuid,text,jsonb),
        ${audit}.audit_report_authorize_standby_publish(uuid) TO ${identifier(readerRole)}`);
      const live = randomUUID();
      await owner.prepare(`INSERT INTO ${audit}.audit_datasets VALUES(?,'live',0,1000)`).run(live);
      await owner.prepare(`INSERT INTO ${audit}.audit_dataset_sources VALUES(?,?)`).run(live, sourceA);
      await owner.prepare(`INSERT INTO ${acl} VALUES(?,?,?),(?,?,?)`).run(aliceRole, live, sourceA, aliceRole, datasetA, sourceB);
      await assert.rejects(standbyBegin(alice, live), { code: '42501' });

      const job = await standbyBegin(alice);
      assert.deepEqual(await owner.prepare(`SELECT reader_route,standby_sources,standby_drained_at FROM ${jobs} WHERE id=?`).get(job),
        { reader_route: 'standby', standby_sources: [sourceA, sourceB].sort(), standby_drained_at: null });
      await assert.rejects(authorize(bob, job), { code: '42501' });
      const revoke = () => owner.prepare(`DELETE FROM ${acl} WHERE operator_name=? AND dataset_id=? AND source_namespace=?`)
        .run(aliceRole, datasetA, sourceB);
      const tryConcurrentWrite = (write: () => Promise<unknown>) => owner.transaction(async () => {
        await owner.exec("SET LOCAL lock_timeout='50ms'");
        await write();
      }, { lockKey: 'standby-publication-test' });
      await alice.transaction(async () => {
        await authorize(alice, job);
        await assert.rejects(tryConcurrentWrite(revoke), { code: '55P03' });
        await assert.rejects(tryConcurrentWrite(() =>
          owner.prepare(`UPDATE ${jobs} SET expires_at=expires_at WHERE id=?`).run(job)), { code: '55P03' });
      });
      await revoke();
      await assert.rejects(authorize(alice, job), { code: '42501' });
      await finish(alice, job, 'cancelled', 0, 0, 'cancelled');
      await assert.rejects(alice.prepare(`UPDATE ${jobs} SET standby_drained_at=clock_timestamp() WHERE id=?`).run(job),
        { code: '42501' });
      await assert.rejects(begin(bob, datasetB, { fromMs: 1000, toMs: 2000 }, 'summary'), { code: '55P03' });
      await owner.prepare(`UPDATE ${jobs} SET standby_drained_at=clock_timestamp() WHERE id=?`).run(job);
      const primary = await begin(alice);
      await assert.rejects(authorize(alice, primary), { code: '42501' });
      await finish(alice, primary);
    });
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await source.close();
    await owner.close();
  }
});
