import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type pg from 'pg';
import { attestDistributedChatLoadStand, openDistributedChatLoadStand, readPrivateChatLoadManifest } from './chat-load-distributed-stand';

const role = 'royal_chat_load_chat';
const runId = '53c95b19-9ae5-4da5-ae67-52b4f480505d';
const systemIdentifier = '7671976502377001351';
const generatorHostId = 'a'.repeat(64), primaryHostId = 'b'.repeat(64), standbyHostId = 'c'.repeat(64);
const password = 'd'.repeat(64);
const gigabyte = 1024 ** 3;
const fixture = () => ({ format: 1, purpose: 'royal-chat-load-distributed', runId, expiresAtUnixMs: Date.now() + 60_000, generatorHostId,
  primary: { port: 23789, hostId: primaryHostId, freeDiskBytes: 16 * gigabyte },
  standby: { port: 23790, hostId: standbyHostId, freeDiskBytes: 12 * gigabyte }, systemIdentifier, minimumReplayLsn: '1/8', password });

type Row = Record<string, unknown>;
function fake(overrides: { primary?: Row; standby?: Row; sender?: Row; receiver?: Row; noMarker?: number;
  noConnect?: number; noClose?: number; noQuery?: number; extraSender?: boolean; abort?: AbortController } = {}) {
  const configurations: pg.ClientConfig[] = [], closed: number[] = [], queries: { port: number; text: string; values?: unknown[] }[] = [];
  const connect = (configuration: pg.ClientConfig) => {
    configurations.push(configuration);
    const port = configuration.port!, standby = port === 23790;
    const identity = { login: role, role, database: role, marker: runId, host_id: standby ? standbyHostId : primaryHostId,
      system_identifier: systemIdentifier, recovery: standby, read_only: 'on', fsync: 'on', commit_mode: 'on',
      standby_names: standby ? '' : 'FIRST 1 (royal_chat_load_standby)', wal_level: 'replica', max_connections: 60,
      reserved_connections: 3, wal_senders: 4, client_connections: 2, unrelated_databases: 0, owns_database: true,
      unprivileged: true, no_server_privileges: true, can_read_stats: true, role_limit: -1, database_limit: -1,
      ...(standby ? overrides.standby : overrides.primary) };
    return {
      async connect() { if (port === overrides.noConnect) throw new Error(`private ${password}`); },
      async query(text: string, values?: unknown[]) {
        queries.push({ port, text, values });
        if (port === overrides.noQuery) throw new Error(`private query ${password}`);
        if (text.includes('pg_control_system')) return { rows: [identity] };
        if (text.includes('public.stand_probe')) return { rows: port === overrides.noMarker ? [] : [{ reached: true }] };
        if (text.includes('pg_stat_replication')) {
          const sender = { application_name: 'royal_chat_load_standby', state: 'streaming', sync_state: 'sync',
            flush_lsn: '1/8', replay_lsn: '1/8', local_flush_lsn: '1/10', ...overrides.sender };
          return { rows: overrides.extraSender ? [sender, sender] : [sender] };
        }
        if (text.includes('pg_stat_wal_receiver')) {
          overrides.abort?.abort(new Error(`private abort ${password}`));
          return { rows: [{ status: 'streaming', flushed_lsn: '1/10', receive_lsn: '1/10', replay_lsn: '1/8', ...overrides.receiver }] };
        }
        assert.fail('Unexpected query');
      },
      async end() { closed.push(port); if (port === overrides.noClose) throw new Error(`private close ${password}`); },
    };
  };
  return { configurations, closed, queries, connect };
}

test('returns a redacted topology only after both exact synthetic endpoints were attested and closed', async () => {
  const pg = fake(), manifest = fixture();
  const stand = await attestDistributedChatLoadStand(manifest, generatorHostId, pg.connect);
  assert.equal(stand.runId, runId);
  assert.equal(stand.expiresAtUnixMs, manifest.expiresAtUnixMs);
  assert.deepEqual(stand.primaryIdentity, { hostId: primaryHostId, systemIdentifier });
  assert.deepEqual(stand.chat, { port: 23789, role, password });
  assert.deepEqual(pg.closed.sort(), [23789, 23790]);
  assert.equal(pg.configurations.length, 2);
  for (const config of pg.configurations) {
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.user, role);
    assert.equal(config.database, role);
    assert.equal(config.ssl, false);
    assert.match(config.options ?? '', /default_transaction_read_only=on/);
    assert.match(config.options ?? '', /search_path=pg_catalog/);
  }
  assert.equal(pg.queries.length, 6);
  assert(pg.queries.every(query => /^\s*SELECT\b/.test(query.text)));
  assert(pg.queries.filter(query => query.text.includes('public.stand_probe')).every(query => query.values?.[0] === runId));
  assert.deepEqual(stand.report.replication, { state: 'streaming', sync_state: 'sync' });
  assert.equal(stand.report.primary.availableConnections, 55);
  assert.equal(stand.report.standby.replayLsn, '1/8');
  assert.equal(stand.report.freeDiskBytes, 12 * gigabyte);
  assert.deepEqual(stand.report.disk, { source: 'provisioning-manifest', sqlVerified: false,
    primaryFreeBytes: 16 * gigabyte, standbyFreeBytes: 12 * gigabyte });
  assert.equal(stand.report.separateFailureDomains, 'unverified');
  const report = JSON.stringify(stand.report);
  assert(!report.includes(password) && !report.includes(systemIdentifier) && !report.includes('23789'));
});

test('rejects invalid, expired, reused, oversized or non-loopback connection configuration before opening clients', async () => {
  const valid = fixture(), pg = fake();
  for (const malformed of [null, { ...valid, purpose: 'production' }, { ...valid, role: 'postgres' }, { ...valid, runId: 'old-run' },
    { ...valid, generatorHostId: primaryHostId }, { ...valid, primary: { ...valid.primary, hostId: generatorHostId } },
    { ...valid, standby: { ...valid.standby, hostId: primaryHostId } }, { ...valid, standby: { ...valid.standby, port: valid.primary.port } },
    { ...valid, primary: { ...valid.primary, host: 'db.example.test' } }, { ...valid, standby: { ...valid.standby, port: 66_000 } },
    { ...valid, standby: { ...valid.standby, freeDiskBytes: '10GB' } }, { ...valid, expiresAtUnixMs: Date.now() - 1 },
    { ...valid, expiresAtUnixMs: Date.now() + 5 * 60 * 60 * 1_000 }, { ...valid, systemIdentifier: '18446744073709551616' },
    { ...valid, minimumReplayLsn: '0/00' }, { ...valid, minimumReplayLsn: '1/100000000' }, { ...valid, password: 'plain text' }]) {
    await assert.rejects(attestDistributedChatLoadStand(malformed, generatorHostId, pg.connect), /^DistributedChatStandError: chat-stand-/);
  }
  await assert.rejects(attestDistributedChatLoadStand(valid, 'e'.repeat(64), pg.connect), /chat-stand-not-distinct/);
  assert.equal(pg.configurations.length, 0);
});

test('wrong node identity, role, privileges, durability or topology fails before reading the readiness marker on that endpoint', async () => {
  for (const change of [{ login: 'postgres' }, { database: 'royal_game' }, { marker: 'other-run' }, { host_id: primaryHostId },
    { system_identifier: '1' }, { recovery: false }, { read_only: 'off' }, { commit_mode: 'off' }, { fsync: 'off' }, { wal_level: 'minimal' },
    { unrelated_databases: 1 }, { owns_database: false }, { unprivileged: false }, { no_server_privileges: false }, { can_read_stats: false }]) {
    const pg = fake({ standby: change });
    await assert.rejects(attestDistributedChatLoadStand(fixture(), generatorHostId, pg.connect), /chat-stand-standby-attestation-failed/);
    assert(pg.queries.filter(query => query.port === 23790).every(query => query.text.includes('pg_control_system')));
    assert.deepEqual(pg.closed.sort(), [23789, 23790]);
  }
});

test('requires a single named synchronous sender, streaming receiver and WAL/marker reach', async () => {
  for (const [alter, code] of [
    [{ primary: { standby_names: '*' } }, /chat-stand-invalid-sync-configuration/],
    [{ extraSender: true }, /chat-stand-replication-not-ready/],
    [{ sender: { application_name: 'other' } }, /chat-stand-replication-not-ready/],
    [{ sender: { sync_state: 'async' } }, /chat-stand-replication-not-ready/],
    [{ receiver: { status: 'stopped' } }, /chat-stand-replication-not-ready/],
    [{ sender: { flush_lsn: null } }, /chat-stand-invalid-wal-evidence/],
    [{ sender: { flush_lsn: '0/FFFFFFFF' } }, /chat-stand-wal-not-reached/],
    [{ receiver: { replay_lsn: '1/7' } }, /chat-stand-wal-not-reached/],
    [{ noMarker: 23790 }, /chat-stand-run-marker-missing/],
  ] as const) {
    const pg = fake(alter);
    await assert.rejects(attestDistributedChatLoadStand(fixture(), generatorHostId, pg.connect), code);
    assert.deepEqual(pg.closed.sort(), [23789, 23790]);
  }
});

test('requires configured connection limits and enough live headroom on both nodes', async () => {
  for (const primary of [{ max_connections: 59 }, { client_connections: 38 }, { reserved_connections: 40 },
    { role_limit: 21 }, { database_limit: 0 }, { wal_senders: 0 }]) {
    const pg = fake({ primary });
    await assert.rejects(attestDistributedChatLoadStand(fixture(), generatorHostId, pg.connect), /chat-stand-insufficient-postgres-limits/);
    assert.deepEqual(pg.closed.sort(), [23789, 23790]);
  }
});

test('masks connection, SQL, cleanup and signal errors and closes both clients', async () => {
  const abort = new AbortController();
  for (const [alter, code] of [[{ noConnect: 23789 }, 'chat-stand-primary-attestation-failed'],
    [{ noQuery: 23790 }, 'chat-stand-standby-attestation-failed'], [{ noClose: 23789 }, 'chat-stand-primary-close-failed'],
    [{ abort }, 'chat-stand-interrupted']] as const) {
    const pg = fake(alter);
    await assert.rejects(attestDistributedChatLoadStand(fixture(), generatorHostId, pg.connect, abort.signal), (error: Error) => {
      assert.equal(error.message, code);
      assert(!String(error.stack).includes(password));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(pg.closed.sort(), [23789, 23790]);
  }
});

test('non-Linux platforms refuse a distributed private manifest before accessing its path', { skip: process.platform === 'linux' }, async () => {
  await assert.rejects(openDistributedChatLoadStand(password), { message: 'chat-stand-private-linux-generator-required' });
});

test('Linux private manifest access rejects broad modes, links, malformed data and oversize before returning data',
  { skip: process.platform !== 'linux' }, async t => {
    const root = resolve('artifacts/work');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'chat-distributed-manifest-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'manifest.json'), manifest = fixture();
    await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
    assert.deepEqual(await readPrivateChatLoadManifest(path), manifest);
    await chmod(path, 0o640);
    await assert.rejects(readPrivateChatLoadManifest(path), /chat-stand-private-manifest-required/);
    await chmod(path, 0o600);
    const symlinkPath = join(directory, 'alias.json');
    await symlink(path, symlinkPath);
    await assert.rejects(readPrivateChatLoadManifest(symlinkPath), /chat-stand-private-manifest-required/);
    const hardlinkPath = join(directory, 'duplicate.json');
    await link(path, hardlinkPath);
    await assert.rejects(readPrivateChatLoadManifest(path), /chat-stand-private-manifest-required/);
    await rm(hardlinkPath);
    for (const data of [Buffer.from([0xff]), Buffer.alloc(8 * 1024 + 1), Buffer.from('')]) {
      await writeFile(path, data);
      await assert.rejects(readPrivateChatLoadManifest(path), /chat-stand-private-manifest-required/);
    }
  });
