import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PostgresDatabase, parameterSql, rowsDigest } from '../server/database';
import { migrateLegacyDatabases } from '../scripts/database-migrate';

test('parameter conversion preserves SQL literals and comments', () => {
  assert.equal(parameterSql("SELECT '?' AS text, ? AS id -- ?\n/* ? */"), "SELECT '?' AS text, $1 AS id -- ?\n/* ? */");
  assert.equal(parameterSql('SELECT $$?$$, $body$?$body$, ?'), 'SELECT $$?$$, $body$?$body$, $1');
});

test('separate PostgreSQL connections serialize commits and rollbacks', async () => {
  const first = new PostgresDatabase(':memory:');
  await first.exec('CREATE TABLE balance(id INTEGER PRIMARY KEY,units INTEGER NOT NULL); INSERT INTO balance VALUES(1,0)');
  const second = new PostgresDatabase(first.schema);
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).transaction(async () => {
      const db = index % 2 ? first : second;
      const row = await db.prepare('SELECT units FROM balance WHERE id=?').get(1);
      await db.prepare('UPDATE balance SET units=? WHERE id=?').run(row!.units + 1, 1);
    })));
    await assert.rejects(first.transaction(async () => {
      await first.prepare('UPDATE balance SET units=999 WHERE id=1').run();
      throw new Error('rollback');
    }), /rollback/);
    assert.equal((await second.prepare('SELECT units FROM balance WHERE id=1').get())!.units, 20);
    await first.transaction(async () => first.transaction(async () => first.prepare('UPDATE balance SET units=21 WHERE id=1').run()));
    assert.equal((await second.prepare('SELECT units FROM balance WHERE id=1').get())!.units, 21);
  } finally { await first.dropSchema(); await Promise.all([first.close(), second.close()]); }
});

test('offline importer preserves password/session bytes, money, exact JSON and identity ordering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-import-'));
  const file = join(directory, 'legacy.sqlite');
  const source = new DatabaseSync(file);
  source.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE,password TEXT,created_at INTEGER);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),expires INTEGER);
    CREATE TABLE demo_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT REFERENCES accounts(id),amount_units INTEGER,payload TEXT);
    CREATE TABLE demo_flight_sessions(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),started_at INTEGER);
    INSERT INTO accounts VALUES('alice','alice@example.test','salt:exact-hash',1791446400000);
    INSERT INTO sessions VALUES('session-hash','alice',1794038400000);
    INSERT INTO demo_ledger VALUES(99,'alice',100000000000,'{ "exact": "json bytes" }');
    INSERT INTO demo_flight_sessions VALUES('flight-a','alice',1791446400000);
    INSERT INTO demo_flight_sessions VALUES('flight-b','alice',1791446400000);`);
  source.close();
  const db = new PostgresDatabase('royal_game');
  try {
    await db.ready;
    const report = await migrateLegacyDatabases([{ schema: 'royal_game', path: file }]);
    assert.equal(report.schemas[0].tables.reduce((sum, table) => sum + table.count, 0), 5);
    assert.deepEqual(await db.prepare('SELECT password,created_at AS createdAt FROM accounts').get(), { password: 'salt:exact-hash', createdAt: 1791446400000 });
    assert.equal((await db.prepare('SELECT expires FROM sessions').get())!.expires, 1794038400000);
    assert.equal((await db.prepare('SELECT amount_units FROM demo_ledger').get())!.amount_units, 100000000000);
    assert.equal((await db.prepare('SELECT payload FROM demo_ledger').get())!.payload, '{ "exact": "json bytes" }');
    assert.deepEqual((await db.prepare('SELECT id FROM demo_flight_sessions ORDER BY sequence_id').all()).map(row => row.id), ['flight-a', 'flight-b']);
    const next = await db.prepare("INSERT INTO demo_ledger(account_id,amount_units,payload) VALUES('alice',1,'{}') RETURNING id").run();
    assert.equal(next.lastInsertRowid, 100);
    await assert.rejects(migrateLegacyDatabases([{ schema: 'royal_game', path: file }]), /not empty/);
    const archive = join(directory, 'snapshot.pg.json');
    await db.snapshot(archive);
    const restored = await PostgresDatabase.restore(archive);
    try {
      for (const table of ['accounts', 'sessions', 'demo_ledger', 'demo_flight_sessions']) assert.equal(rowsDigest(await restored.prepare('SELECT * FROM ' + table).all()), rowsDigest(await db.prepare('SELECT * FROM ' + table).all()));
      await assert.rejects(restored.prepare("INSERT INTO sessions VALUES('bad','missing',1)").run(), /foreign key/);
      const appended = await restored.prepare("INSERT INTO demo_ledger(account_id,amount_units,payload) VALUES('alice',2,'{}') RETURNING id").run();
      assert.equal(appended.lastInsertRowid, 101);
    } finally { await restored.dropSchema(); await restored.close(); }
  } finally { await db.dropSchema(); await db.close(); await rm(directory, { recursive: true, force: true }); }
});

async function nileBindingsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'royal-bindings-import-'));
  const path = join(directory, 'nile.sqlite'), bindingsPath = join(directory, 'bindings.json');
  const config = { network: 'nile', asset: 'USDT_NILE_TEST', addresses: [
    { userId: 'nile-user-a', address: 'TNileAddressA' }, { userId: 'nile-user-b', address: 'TNileAddressB' },
  ] };
  const configText = JSON.stringify(config);
  const source = new DatabaseSync(path);
  source.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE state(id INTEGER PRIMARY KEY,config TEXT NOT NULL);
    CREATE TABLE addresses(user_id TEXT PRIMARY KEY,address TEXT NOT NULL UNIQUE);
    CREATE TABLE deposits(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES addresses(user_id),amount_units INTEGER NOT NULL);`);
  source.prepare('INSERT INTO state VALUES(1,?)').run(configText);
  for (const address of config.addresses) source.prepare('INSERT INTO addresses VALUES(?,?)').run(address.userId, address.address);
  source.prepare('INSERT INTO deposits VALUES(?,?,?)').run('deposit-a', 'nile-user-a', 1234567890);
  source.close();
  const boundAt = Date.now() - 60000;
  const manifest = { version: 1, network: 'nile', asset: 'USDT_NILE_TEST',
    configSha256: createHash('sha256').update(configText).digest('hex'), bindings: [
      { accountId: randomUUID(), userId: 'nile-user-a', address: 'TNileAddressA', boundAt },
      { accountId: randomUUID(), userId: 'nile-user-b', address: 'TNileAddressB', boundAt: boundAt + 1234 },
    ] };
  return { directory, path, bindingsPath, configText, manifest };
}

test('SQLite Nile bindings import preserves account owners, binding times and verified row digests', async () => {
  const fixture = await nileBindingsFixture(), prefix = 'preview_bindings_' + randomUUID().replaceAll('-', '') + '_';
  const db = new PostgresDatabase(prefix + 'royal_nile_deposits');
  try {
    await db.ready; await writeFile(fixture.bindingsPath, JSON.stringify(fixture.manifest));
    const report = await migrateLegacyDatabases([{ schema: 'royal_nile_deposits', path: fixture.path, bindingsPath: fixture.bindingsPath }], undefined, prefix);
    const rows = fixture.manifest.bindings.map(row => ({ account_id: row.accountId, user_id: row.userId, address: row.address, bound_at: row.boundAt }));
    assert.deepEqual(await db.prepare('SELECT * FROM account_bindings ORDER BY user_id').all(), rows);
    assert.deepEqual(await db.prepare(`SELECT b.account_id AS accountId,b.bound_at AS boundAt,d.amount_units AS amountUnits
      FROM account_bindings b JOIN deposits d ON d.user_id=b.user_id`).get(),
    { accountId: fixture.manifest.bindings[0].accountId, boundAt: fixture.manifest.bindings[0].boundAt, amountUnits: 1234567890 });
    assert.equal((await db.prepare('SELECT config FROM state WHERE id=1').get())!.config, fixture.configText);
    assert.deepEqual(report.schemas[0].tables.find(table => table.name === 'account_bindings'), { name: 'account_bindings', count: 2, sha256: rowsDigest(rows) });
    await assert.rejects(db.prepare('INSERT INTO account_bindings VALUES(?,?,?,?)').run(randomUUID(), 'nile-user-a', 'TNileAddressA', Date.now()), /unique/);
  } finally { await db.dropSchema(); await db.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test('malformed or conflicting Nile bindings roll back the complete SQLite import', async context => {
  const fixture = await nileBindingsFixture(), gamePath = join(fixture.directory, 'game.sqlite');
  const game = new DatabaseSync(gamePath);
  game.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('source-owner')"); game.close();
  const cases: { name: string; change: (manifest: typeof fixture.manifest) => unknown }[] = [
    { name: 'wrong configuration digest', change: manifest => ({ ...manifest, configSha256: '0'.repeat(64) }) },
    { name: 'unexpected manifest field', change: manifest => ({ ...manifest, ignored: true }) },
    { name: 'address does not belong to user', change: manifest => ({ ...manifest, bindings: [{ ...manifest.bindings[0], address: 'TNileAddressB' }] }) },
    { name: 'invalid account owner', change: manifest => ({ ...manifest, bindings: [{ ...manifest.bindings[0], accountId: 'invalid-owner' }] }) },
    { name: 'future binding time', change: manifest => ({ ...manifest, bindings: [{ ...manifest.bindings[0], boundAt: Date.now() + 60000 }] }) },
    { name: 'duplicate deposit user', change: manifest => ({ ...manifest, bindings: [manifest.bindings[0], { ...manifest.bindings[0], accountId: manifest.bindings[1].accountId }] }) },
    { name: 'duplicate account owner', change: manifest => ({ ...manifest, bindings: [manifest.bindings[0], { ...manifest.bindings[1], accountId: manifest.bindings[0].accountId }] }) },
  ];
  try {
    for (const invalid of cases) await context.test(invalid.name, async () => {
      const prefix = 'preview_invalid_' + randomUUID().replaceAll('-', '') + '_';
      const nile = new PostgresDatabase(prefix + 'royal_nile_deposits'), accounts = new PostgresDatabase(prefix + 'royal_game');
      try {
        await Promise.all([nile.ready, accounts.ready]);
        await writeFile(fixture.bindingsPath, JSON.stringify(invalid.change(fixture.manifest)));
        await assert.rejects(migrateLegacyDatabases([
          { schema: 'royal_game', path: gamePath }, { schema: 'royal_nile_deposits', path: fixture.path, bindingsPath: fixture.bindingsPath },
        ], undefined, prefix), /Invalid legacy Nile binding/);
        for (const db of [nile, accounts]) assert.deepEqual(await db.prepare('SELECT tablename FROM pg_tables WHERE schemaname=?').all(db.schema), []);
      } finally { await Promise.all([nile.dropSchema(), accounts.dropSchema()]); await Promise.all([nile.close(), accounts.close()]); }
    });
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
