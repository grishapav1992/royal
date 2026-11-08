import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { runLocalWalletAuthorizationPhase } from './chat-load-wallet-authorization-ab';
import { lockDistributedWalletGame, parseWalletManifestPair, walletGameRole } from './chat-load-wallet-distributed';
import { temporaryDatabase } from './database-test';

const generatorHostId = 'a'.repeat(64), gameHostId = 'b'.repeat(64);
const profile = { durationSeconds: 2, authorizationRate: 40 };

function manifest(phase: 'baseline' | 'chat-on') {
  return { format: 1, purpose: 'royal-chat-load-wallet-distributed', phase, runId: randomUUID(),
    expiresAtUnixMs: Date.now() + 60_000, generatorHostId,
    game: { port: phase === 'baseline' ? 41_001 : 41_002, hostId: gameHostId, freeDiskBytes: 8 * 1024 ** 3 },
    systemIdentifier: phase === 'baseline' ? '7012345678901234567' : '8012345678901234567',
    password: randomBytes(32).toString('hex'), profile };
}

test('wallet manifests require a matched A/B profile with fresh and distinct game identities', () => {
  const a = manifest('baseline'), b = manifest('chat-on');
  assert.equal(parseWalletManifestPair(a, b, generatorHostId)[1].runId, b.runId);
  const invalid = [
    { ...b, phase: 'baseline' }, { ...b, runId: a.runId }, { ...b, systemIdentifier: a.systemIdentifier }, { ...b, password: a.password },
    { ...b, game: { ...b.game, port: a.game.port } }, { ...b, game: { ...b.game, host: '192.0.2.1' } },
    { ...b, game: { ...b.game, hostId: 'c'.repeat(64) } }, { ...b, game: { ...b.game, hostId: generatorHostId } },
    { ...b, game: { ...b.game, freeDiskBytes: 1 } }, { ...b, profile: { ...profile, authorizationRate: 41 } },
    { ...b, profile: { ...profile, durationSeconds: 1801 } }, { ...b, expiresAtUnixMs: Date.now() + 1_000 },
  ];
  for (const value of invalid) assert.throws(() => parseWalletManifestPair(a, value, generatorHostId), /wallet-stand-/);
  assert.throws(() => parseWalletManifestPair(a, b, 'd'.repeat(64)), /wallet-stand-invalid-manifest/);
});

test('a real synthetic game primary is checked before mutations, re-attested in the wallet child and used only once', async () => {
  const root = resolve('artifacts/work');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'chat-wallet-distributed-test-'));
  const output = join(directory, 'wallet-chat-on.json');
  try {
    const database = await temporaryDatabase();
    try {
      const a = manifest('baseline'), b = manifest('chat-on');
      b.game.port = Number(database.env.PGPORT);
      if (a.game.port === b.game.port) a.game.port++;
      const config = { host: '127.0.0.1', port: b.game.port, ssl: false, connectionTimeoutMillis: 3_000 };
      const admin = new pg.Client({ ...config, user: 'postgres', database: 'postgres', password: database.env.PGPASSWORD });
      try {
        await admin.connect();
        await admin.query('DROP DATABASE royal_test');
        await admin.query(`CREATE ROLE ${walletGameRole} LOGIN PASSWORD ${pg.escapeLiteral(b.password)}`);
        await admin.query(`CREATE DATABASE ${walletGameRole} OWNER ${walletGameRole}`);
        await admin.query(`ALTER DATABASE ${walletGameRole} SET royal.chat_load_run_id = ${pg.escapeLiteral(b.runId)}`);
        await admin.query(`ALTER DATABASE ${walletGameRole} SET royal.chat_load_node_id = ${pg.escapeLiteral(gameHostId)}`);
        b.systemIdentifier = (await admin.query('SELECT system_identifier::text FROM pg_control_system()')).rows[0].system_identifier;
        if (a.systemIdentifier === b.systemIdentifier) a.systemIdentifier = '10';
      } finally { await admin.end(); }
      const setup = new pg.Client({ ...config, user: 'postgres', database: walletGameRole, password: database.env.PGPASSWORD });
      try {
        await setup.connect();
        await setup.query(`CREATE SCHEMA royal_game AUTHORIZATION ${walletGameRole}`);
        await setup.query(`GRANT EXECUTE ON FUNCTION pg_control_system() TO ${walletGameRole}`);
      } finally { await setup.end(); }
      const [, phase] = parseWalletManifestPair(a, b, generatorHostId);
      await assert.rejects(lockDistributedWalletGame({ ...phase, systemIdentifier: a.systemIdentifier }), /wallet-stand-game-identity-mismatch/);
      await assert.rejects(lockDistributedWalletGame({ ...phase, runId: a.runId }), /wallet-stand-game-identity-mismatch/);
      const membership = new pg.Client({ ...config, user: 'postgres', database: walletGameRole, password: database.env.PGPASSWORD });
      try {
        await membership.connect();
        await membership.query(`CREATE ROLE unsafe_fixture_role CREATEROLE; GRANT unsafe_fixture_role TO ${walletGameRole}`);
        await assert.rejects(lockDistributedWalletGame(phase), /wallet-stand-game-identity-mismatch/);
        await membership.query(`REVOKE unsafe_fixture_role FROM ${walletGameRole}; DROP ROLE unsafe_fixture_role`);
      } finally { await membership.end(); }
      const guard = await lockDistributedWalletGame(phase);
      try {
        assert.equal(guard.settings.fsync, true);
        await assert.rejects(lockDistributedWalletGame(phase), /wallet-stand-phase-in-use/);
        await assert.rejects(runLocalWalletAuthorizationPhase({ ...guard.stand,
          identity: { ...guard.stand.identity, hostId: 'c'.repeat(64) } }, directory, 'chat-on', profile), { code: 'ENOENT' });
        await assert.rejects(lstat(output), { code: 'ENOENT' });
        // The read-only preflight, competing lease and rejected child must all leave a fresh schema.
        const read = new pg.Client({ ...config, user: walletGameRole, database: walletGameRole, password: b.password });
        try {
          await read.connect();
          const result = await read.query("SELECT to_regclass('royal_game.accounts') AS accounts");
          assert.equal(result.rows[0].accounts, null);
        } finally { await read.end(); }
        const result = await runLocalWalletAuthorizationPhase(guard.stand, directory, 'chat-on', profile);
        assert(result.passed);
        assert.equal(result.authorization?.verified, 80);
        assert.equal(result.measured.completed, 54);
        assert(!((await readFile(output, 'utf8')).includes(b.password)));
      } finally { await guard.close(); }
      await assert.rejects(lockDistributedWalletGame(phase), /wallet-stand-game-schema-not-fresh/);
    } finally { await database.cleanup(); }
  } finally {
    await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
});
