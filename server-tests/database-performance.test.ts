import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig, PostgresDatabase } from '../server/database';
import { applySchemaMigration } from '../server/database-migrations';

test('account locks serialize the same account across pools while other accounts progress', async () => {
  const first = new PostgresDatabase(':memory:');
  const second = new PostgresDatabase(first.schema);
  let releaseFirst!: () => void, firstStarted!: () => void;
  const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  try {
    await Promise.all([first.ready, second.ready]);
    await first.exec("CREATE TABLE balances(account_id text PRIMARY KEY,units bigint NOT NULL); INSERT INTO balances VALUES('a',0),('b',0)");
    const holding = first.transaction(async () => {
      const balance = await first.prepare("SELECT units FROM balances WHERE account_id='a'").get();
      firstStarted(); await gate;
      await first.prepare("UPDATE balances SET units=? WHERE account_id='a'").run(balance!.units + 1);
    }, { lockKey: 'account:a' });
    await started;
    let sameAccountFinished = false;
    const waiting = second.transaction(async () => {
      const balance = await second.prepare("SELECT units FROM balances WHERE account_id='a'").get();
      await second.prepare("UPDATE balances SET units=? WHERE account_id='a'").run(balance!.units + 1);
      sameAccountFinished = true;
    }, { lockKey: 'account:a' });
    await second.transaction(async () => {
      await second.prepare("UPDATE balances SET units=1 WHERE account_id='b'").run();
    }, { lockKey: 'account:b' });
    assert.equal(sameAccountFinished, false);
    releaseFirst(); await Promise.all([holding, waiting]);
    assert.deepEqual(await first.prepare('SELECT * FROM balances ORDER BY account_id').all(), [{ account_id: 'a', units: 2 }, { account_id: 'b', units: 1 }]);
    await assert.rejects(first.transaction(async () => {
      await first.prepare("UPDATE balances SET units=999 WHERE account_id='a'").run();
      throw new Error('abort');
    }, { lockKey: 'account:a' }), /abort/);
    assert.equal((await first.prepare("SELECT units FROM balances WHERE account_id='a'").get())!.units, 2);
    await assert.rejects(first.transaction(() => first.transaction(async () => {}, { lockKey: 'account:b' }), { lockKey: 'account:a' }), /same lock key/);
  } finally { releaseFirst?.(); await first.dropSchema(); await Promise.all([first.close(), second.close()]); }
});

test('NUMERIC results preserve values beyond JavaScript precision', async () => {
  const db = new PostgresDatabase(':memory:');
  try {
    assert.deepEqual(await db.prepare("SELECT 9007199254740993::numeric AS huge,1.00000000000000000001::numeric AS precise,42::numeric AS small").get(),
      { huge: '9007199254740993', precise: '1.00000000000000000001', small: 42 });
    await assert.rejects(db.prepare('SELECT 9007199254740993::bigint AS unsafe').get(), /safe JavaScript range/);
  } finally { await db.dropSchema(); await db.close(); }
});

test('schema migrations apply once, reject mutation and atomically roll back failed data changes', async () => {
  const db = new PostgresDatabase(':memory:');
  try {
    await db.exec('CREATE TABLE events(id bigint PRIMARY KEY,account_id text,created_at bigint,payload text); CREATE TABLE marker(id bigint PRIMARY KEY)');
    const indexes = [{ name: 'events_recent_v1', table: 'events', columns: ['account_id', 'created_at DESC'], where: 'account_id IS NOT NULL' },
      { name: 'events_payload_v1', table: 'events', columns: ["(payload::jsonb->>'owner')", 'id'], where: "account_id='a'" }];
    const migration = { id: 'test-v1', statements: ['INSERT INTO marker VALUES(1)'], indexes };
    await Promise.all([applySchemaMigration(db, migration), applySchemaMigration(db, migration)]);
    await applySchemaMigration(db, migration);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM marker').get())!.n, 1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM _royal_migrations').get())!.n, 1);
    await assert.rejects(applySchemaMigration(db, { ...migration, statements: ['INSERT INTO marker VALUES(2)'] }), /has changed/);
    await assert.rejects(applySchemaMigration(db, { id: 'fail-v1', indexes, statements: ['INSERT INTO marker VALUES(2)', 'INSERT INTO missing_table VALUES(1)'] }), /does not exist/);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM marker').get())!.n, 1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM _royal_migrations').get())!.n, 1);
    await assert.rejects(applySchemaMigration(db, { id: 'collision-v1', indexes: [{ name: 'events_recent_v1', table: 'events', columns: ['id'] }], statements: [] }), /different definition/);
    await db.exec(`CREATE INDEX literal_collision ON events ((payload::jsonb->>'user Id'));
      CREATE INDEX grouping_collision ON events (((created_at+id)*id))`);
    await assert.rejects(applySchemaMigration(db, { id: 'literal-collision-v1', indexes: [{ name: 'literal_collision', table: 'events', columns: ["(payload::jsonb->>'userId')"] }], statements: [] }), /different definition/);
    await assert.rejects(applySchemaMigration(db, { id: 'grouping-collision-v1', indexes: [{ name: 'grouping_collision', table: 'events', columns: ['(created_at+id*id)'] }], statements: [] }), /different definition/);
    await db.exec('CREATE TABLE other_events (LIKE events); CREATE INDEX table_collision ON other_events(account_id,created_at DESC)');
    await assert.rejects(applySchemaMigration(db, { id: 'table-collision-v1', indexes: [{ name: 'table_collision', table: 'events', columns: ['account_id','created_at DESC'] }], statements: [] }), /different definition/);
    await assert.rejects(db.transaction(() => applySchemaMigration(db, { id: 'nested-v1', statements: [] })), /outside application transactions/);
  } finally { await db.dropSchema(); await db.close(); }
});

test('database timeouts reject unbounded configuration and short pauses reuse a connection', async () => {
  const config = databaseConfig({ PGHOST: 'localhost', PGDATABASE: 'royal', PGUSER: 'app' });
  assert.ok(config.idleTimeoutMillis! > 1000);
  assert.throws(() => databaseConfig({ PGHOST: 'localhost', PGDATABASE: 'royal', PGUSER: 'app', PGPOOL_IDLE_MS: '0' }), /outside the supported range/);
  assert.throws(() => databaseConfig({ PGHOST: 'localhost', PGDATABASE: 'royal', PGUSER: 'app', PGSTATEMENT_TIMEOUT_MS: 'Infinity' }), /outside the supported range/);
  const db = new PostgresDatabase(':memory:');
  try {
    const first = (await db.prepare('SELECT pg_backend_pid() AS pid').get())!.pid;
    await new Promise(resolve => setTimeout(resolve, 1250));
    const second = (await db.prepare('SELECT pg_backend_pid() AS pid').get())!.pid;
    assert.equal(first, second);
  } finally { await db.dropSchema(); await db.close(); }
});
