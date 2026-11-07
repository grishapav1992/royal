import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startAuditAttemptRuntime, type AuditAttemptObservation } from '../server/audit/attempts';
import { AuditDatasets } from '../server/audit/datasets';
import { TsuTurnReplayCapture } from '../server/audit/replay-pvp-tsu-capture';
import { AuditReplayStore } from '../server/audit/replay-store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import type { PvpRequest } from '../src/shared/pvp';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';

const observation = (): AuditAttemptObservation => ({
  attemptId: randomUUID(), occurredAtMs: Date.now(), accountId: randomUUID(), operationId: randomUUID(), entity: null,
  transport: 'http', route: '/api/demo-wallet/operations', decision: 'unknown',
  response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' }, delivery: 'closed',
});

test('a restricted recorder uses the opt-in file credential and cannot modify wallet or dataset state', async t => {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const privateDirectory = await mkdtemp(join(tmpdir(), 'royal-audit-recorder-'));
  const credential = join(privateDirectory, 'recorder-url');
  const adminCredential = join(privateDirectory, 'owner-url');
  const role = identifier('recorder_' + randomBytes(8).toString('hex'));
  const rolePassword = randomBytes(32).toString('hex');
  t.after(async () => {
    await audit.exec('DROP OWNED BY ' + role + '; DROP ROLE ' + role).catch(() => {});
    await Promise.all([game.close(), audit.close(), rm(privateDirectory, { recursive: true, force: true })]);
  });
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  const wallet = new DemoWalletStore(game);
  const ledger = new VirtualPvpLedger(game, wallet);
  const pvp = new PvpStore(ledger), combat = new NileCombatEscrow(ledger);
  await Promise.all([pvp.ready, combat.ready]);
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId } = await datasets.startTest();
  const auditName = identifier(audit.schema), source = identifier(game.schema);
  await audit.exec(`CREATE ROLE ${role} LOGIN PASSWORD '${rolePassword}';
    GRANT USAGE ON SCHEMA ${auditName} TO ${role};
    GRANT SELECT ON audit_datasets, audit_dataset_sources TO ${role};
    GRANT UPDATE (capture_lock_permission) ON audit_datasets TO ${role};
    GRANT SELECT, INSERT ON audit_evidence, audit_attempt_capture_gaps TO ${role};
    GRANT UPDATE (missing_count, first_at_ms, last_at_ms) ON audit_attempt_capture_gaps TO ${role}`);
  const url = (username: string, password: string) => {
    const url = new URL('postgres://' + process.env.PGHOST + ':' + process.env.PGPORT + '/' + process.env.PGDATABASE);
    url.username = username;
    url.password = password;
    return String(url);
  };
  await writeFile(credential, url(role.slice(1, -1), rolePassword), { mode: 0o600 });
  await writeFile(adminCredential, url(process.env.PGUSER!, process.env.PGPASSWORD!), { mode: 0o600 });
  const env = { NODE_ENV: 'production', ROYAL_AUDIT_SCHEMA: audit.schema,
    ROYAL_AUDIT_TEST_DATASET_ID: datasetId, ROYAL_AUDIT_LIVE_DATASET_ID: '', ROYAL_AUDIT_RECORDER_DB_URL_FILE: credential,
    PGUSER: 'application_login_is_not_used', PGHOST: 'unreachable.invalid', PGDATABASE: 'must_not_fall_back' };
  const runtime = startAuditAttemptRuntime(env, game.schema);
  assert.ok(runtime);
  try {
    assert.equal(await runtime.ready, true);
    const accepted = observation();
    runtime.record(accepted);
    runtime.record({ ...accepted, occurredAtMs: -1 });
    await runtime.close();
    const evidence = await audit.prepare('SELECT evidence_id FROM audit_evidence WHERE dataset_id=?').all(datasetId);
    assert.deepEqual(evidence, [{ evidence_id: accepted.attemptId }]);
    const gaps = await audit.prepare('SELECT missing_count FROM audit_attempt_capture_gaps WHERE dataset_id=?').all(datasetId);
    assert.deepEqual(gaps, [{ missing_count: 1 }]);
  } finally { await runtime.close(); }

  const recorder = new PostgresDatabase(audit.schema, { existingSchema: true, config: databaseConfig({ DATABASE_URL_FILE: credential }) });
  try {
    for (const statement of [
      'UPDATE audit_datasets SET started_at_ms=0', 'UPDATE audit_datasets SET sealed_at_ms=started_at_ms',
      'DELETE FROM audit_datasets', 'DELETE FROM audit_evidence', 'INSERT INTO audit_posting_refs DEFAULT VALUES',
      `UPDATE ${source}.demo_wallets SET balance=0`, `SELECT id FROM ${source}.accounts`,
    ]) await assert.rejects(recorder.exec(statement), { code: '42501' });
    await assert.rejects(recorder.exec('UPDATE audit_datasets SET capture_lock_permission=false'), { code: '23514' });
  } finally { await recorder.close(); }

  await audit.exec(`GRANT USAGE ON SCHEMA ${source} TO ${role};
    GRANT SELECT ON ${source}.demo_ledger, ${source}.virtual_pvp_banks, ${source}.virtual_pvp_holds,
      ${source}.pvp_matches, ${source}.combat_matches, ${source}.pvp_requests TO ${role};
    GRANT SELECT ON audit_posting_refs, audit_opening_obligations TO ${role};
    GRANT SELECT, INSERT ON audit_replay_packages, audit_replay_fragments TO ${role}`);
  const replayRecorder = startAuditAttemptRuntime({ ...env, ROYAL_AUDIT_TSU_REPLAY: '1' }, game.schema)!;
  const actors = ['First','Second'].map(name => ({ accountId: randomUUID(), name, roomId: 'dedicated-audit-recorder' }));
  let matchId: string;
  try {
    assert.equal(await replayRecorder.ready, true);
    assert.ok(replayRecorder.recordTsu);
    const capture = new TsuTurnReplayCapture(replayRecorder.recordTsu);
    for (const actor of actors) {
      await game.prepare('INSERT INTO accounts VALUES (?)').run(actor.accountId);
      await wallet.operate(actor.accountId, { id: randomUUID(), kind: 'deposit', amount: 10 });
    }
    let now = Date.now();
    const command = async (seat: number, request: PvpRequest) => {
      const actor = actors[seat], snapshot = await pvp.command(actor, request, ++now);
      capture.observeCommand(actor.accountId, request, snapshot);
      return snapshot;
    };
    await pvp.syncRoom(actors[0].roomId, actors.map(actor => ({ ...actor, connected: true, available: true })), now);
    const invited = await command(0, { action: 'invite', id: randomUUID(), gameId: 'tsu-e-fa',
      targetId: actors[1].accountId, stakeUnits: '100000' });
    matchId = invited.active!.id;
    await command(1, { action: 'accept', id: randomUUID(), challengeId: matchId });
    for (const seat of [0, 1]) await command(seat, { action: 'duel-ready', id: randomUUID(), challengeId: matchId, termsRevision: 0 });
    await command(0, { action: 'move', id: randomUUID(), challengeId: matchId, revision: 0,
      move: { kind: 'choose', round: 1, choice: 'paper' } });
    await command(1, { action: 'resign', id: randomUUID(), challengeId: matchId });
  } finally { await replayRecorder.close(); }
  const replay = await new AuditReplayStore(audit).read({ datasetId, environment: 'test' }, matchId);
  assert.equal(replay.status, 'verified');
  if (replay.status === 'verified') {
    assert.equal(replay.value.manifest.coverage, 'complete');
    const events = replay.value.fragments.flatMap(fragment => fragment.events);
    assert.deepEqual(events[0].money?.map(row => row.units), ['-10', '-10']);
    assert.deepEqual(events.at(-1)?.money?.map(row => row.units), ['19']);
  }

  const warnings: string[] = [];
  t.mock.method(console, 'warn', (warning: string) => { warnings.push(warning); });
  assert.equal(startAuditAttemptRuntime({ ...env, ROYAL_AUDIT_RECORDER_DB_URL_FILE: undefined }, game.schema), undefined);
  assert.equal(startAuditAttemptRuntime({ ...env, ROYAL_AUDIT_RECORDER_DB_URL_FILE: '' }, game.schema), undefined);
  for (const invalid of [
    { ...env, ROYAL_AUDIT_RECORDER_DB_URL_FILE: adminCredential }, { ...env, ROYAL_AUDIT_TEST_DATASET_ID: randomUUID() },
  ]) {
    const inactive = startAuditAttemptRuntime(invalid, game.schema)!;
    try {
      assert.equal(await inactive.ready, false);
      inactive.record(observation());
    } finally { await inactive.close(); }
  }
  await audit.exec(`GRANT USAGE ON SCHEMA ${source} TO ${role};
    GRANT UPDATE (balance) ON ${source}.demo_wallets TO ${role}`);
  const sourceWriter = startAuditAttemptRuntime(env, game.schema)!;
  try { assert.equal(await sourceWriter.ready, false); }
  finally { await sourceWriter.close(); }
  await audit.exec(`REVOKE UPDATE (balance) ON ${source}.demo_wallets FROM ${role}`);
  await audit.exec(`GRANT UPDATE (started_at_ms) ON audit_datasets TO ${role}`);
  const overprivileged = startAuditAttemptRuntime(env, game.schema)!;
  try { assert.equal(await overprivileged.ready, false); }
  finally { await overprivileged.close(); }
  assert.deepEqual(warnings.map(value => JSON.parse(value)), [
    { event: 'audit-attempt-capture-disabled', reason: 'credential' },
    { event: 'audit-attempt-capture-disabled', reason: 'credential' },
    { event: 'audit-attempt-capture-disabled', reason: 'database' },
    { event: 'audit-attempt-capture-disabled', reason: 'database' },
    { event: 'audit-attempt-capture-disabled', reason: 'database' },
    { event: 'audit-attempt-capture-disabled', reason: 'database' },
  ]);
  assert.equal((await audit.prepare('SELECT count(*)::integer AS count FROM audit_evidence').get())?.count, 1);
});
