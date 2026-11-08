import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { temporaryDatabase } from '../scripts/database-test';
import { assertOwnedLoadDatabase, setLoadDatabaseRun } from '../scripts/load-stand-ownership';

test('load stand attests the exact temporary database and its configured connection limit', async () => {
  const database = await temporaryDatabase({ maxConnections: 250 });
  const env = { ...database.env, LOAD_LOBBY_RUN_ID: randomUUID() };
  const client = new Client({ host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE,
    user: env.PGUSER, password: env.PGPASSWORD, ssl: false });
  try {
    await assert.rejects(assertOwnedLoadDatabase(database.env), /use-temporary-postgresql-wrapper/);
    await assert.rejects(assertOwnedLoadDatabase(env), /load-database-not-owned/);
    await setLoadDatabaseRun(env);
    assert.equal(await assertOwnedLoadDatabase(env), env.LOAD_LOBBY_RUN_ID);
    const otherRun = { ...env, LOAD_LOBBY_RUN_ID: randomUUID() };
    await assert.rejects(assertOwnedLoadDatabase(otherRun), /load-database-not-owned/);
    await assert.rejects(setLoadDatabaseRun(otherRun), /load-database-not-fresh/);
    assert.equal(await assertOwnedLoadDatabase(env), env.LOAD_LOBBY_RUN_ID);
    await client.connect();
    const { rows: [settings] } = await client.query('SHOW max_connections');
    assert.equal(settings.max_connections, '250');
    await client.query('CREATE DATABASE unrelated');
    await assert.rejects(assertOwnedLoadDatabase(env), /load-database-not-owned/);
  } finally {
    await client.end();
    await database.cleanup();
  }
});
