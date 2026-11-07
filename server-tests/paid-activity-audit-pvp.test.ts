import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { registeredAuditMode } from '../server/audit/mode-registry';
import { resolvePvpPosting, type PvpPostingKey } from '../server/audit/pvp';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';

async function fixture(t: TestContext) {
  const db = new PostgresDatabase(':memory:');
  t.after(() => db.close());
  const a = { accountId: randomUUID(), name: 'Fixture A', roomId: 'audit-pvp-fixture' };
  const b = { accountId: randomUUID(), name: 'Fixture B', roomId: a.roomId };
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(a.accountId, b.accountId);
  const wallet = new DemoWalletStore(db);
  await wallet.ready;
  for (const actor of [a, b]) {
    await wallet.operate(actor.accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  }
  const ledger = new VirtualPvpLedger(db, wallet);
  const store = new PvpStore(ledger);
  const now = 1794059700000;
  let combatClock = now;
  const combat = new NileCombatEscrow(ledger, () => combatClock);
  await Promise.all([store.ready, combat.ready]);
  await store.syncRoom(a.roomId, [a, b].map(actor => ({ ...actor, connected: true, available: true })), now);
  async function postings(gameId: string, matchId: string, stage: 'hold' | 'final') {
    const operationId = 'pvp:' + matchId + ':' + stage;
    const rows = await db.prepare('SELECT id::text AS id,account_id FROM demo_ledger WHERE operation_id=? ORDER BY id').all(operationId);
    return rows.map(row => ({ rowId: row.id, accountId: row.account_id, operationId, gameId } satisfies PvpPostingKey));
  }
  return { db, a, b, ledger, store, combat, now, postings, advanceCombat: (ms: number) => { combatClock += ms; } };
}

test('standard PvP distinguishes same operation keys by account and resolves both draw returns', async t => {
  const f = await fixture(t);
  const create = await f.store.command(f.a, {
    id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: f.b.accountId,
  }, f.now);
  const matchId = create.active!.id;
  await f.store.command(f.b, { id: randomUUID(), action: 'accept', challengeId: matchId }, f.now + 1);
  const holds = await f.postings('chess', matchId, 'hold');
  assert.equal(holds.length, 2);
  assert.equal(holds[0].operationId, holds[1].operationId);
  assert.notEqual(holds[0].rowId, holds[1].rowId);

  for (const hold of holds) {
    const result = await f.db.transaction(() => resolvePvpPosting(f.db, hold), { readOnly: true });
    assert.ok(result);
    assert.equal(result.stage, 'hold');
    assert.equal(result.bank.state, 'open');
    assert.equal(result.hold.state, 'held');
    assert.equal(result.hold.stakeUnits, '1000');
    assert.equal(result.hold.payoutCapacityUnits, '1900');
    assert.equal(result.hold.source.rowId, JSON.stringify([matchId, hold.accountId]));
    assert.equal(result.entity.source.namespace, f.db.schema + '.pvp_matches');
    assert.equal(result.entity.rulesVersion, null);
    assert.equal(result.coverage, 'partial');
    assert.equal(result.operation, null);
    assert.equal(result.origin, 'unknown');
  }

  for (const actor of [f.a, f.b]) {
    await f.store.command(actor, { id: randomUUID(), action: 'ready', challengeId: matchId }, f.now + 2);
  }
  await f.store.adjudicate(f.a.roomId, matchId, null, 'draw', f.now + 3);
  const returns = await f.postings('chess', matchId, 'final');
  assert.equal(returns.length, 2);
  for (const row of returns) {
    const result = await resolvePvpPosting(f.db, row);
    assert.ok(result);
    assert.equal(result.bank.state, 'refunded');
    assert.equal(result.bank.reason, 'draw');
    assert.equal(result.bank.feeUnits, '0');
    assert.equal(result.bank.winnerId, null);
    assert.equal(result.hold.state, 'refunded');
    assert.deepEqual(result.openingObligationKey, {
      sourceNamespace: f.db.schema + '.virtual_pvp_holds', accountId: row.accountId, entityId: matchId,
    });
  }

  const row = holds[0];
  for (const invalid of [
    { ...row, rowId: '9223372036854775808' },
    { ...row, rowId: '01' },
    { ...row, accountId: holds[1].accountId },
    { ...row, gameId: 'pool' },
    { ...row, operationId: 'pvp:' + randomUUID() + ':hold' },
    { ...row, operationId: 'pvp:' + matchId + ':final' },
  ]) assert.equal(await resolvePvpPosting(f.db, invalid), null);
});

test('negotiated Tsuefa keeps verified v4 rules and does not guess which request caused a posting', async t => {
  const f = await fixture(t);
  const invitation = await f.store.command(f.a, {
    id: randomUUID(), action: 'invite', gameId: 'tsu-e-fa', stakeUnits: '1000000', targetId: f.b.accountId,
  }, f.now);
  const matchId = invitation.active!.id;
  await f.store.command(f.b, { id: randomUUID(), action: 'accept', challengeId: matchId }, f.now + 1);
  assert.equal((await f.postings('tsu-e-fa', matchId, 'hold')).length, 0);
  for (const actor of [f.a, f.b]) {
    await f.store.command(actor, { id: randomUUID(), action: 'duel-ready', challengeId: matchId, termsRevision: 0 }, f.now + 2);
  }
  const holds = await f.postings('tsu-e-fa', matchId, 'hold');
  assert.equal(holds.length, 2);
  for (const hold of holds) {
    const result = await resolvePvpPosting(f.db, hold);
    assert.ok(result);
    assert.equal(result.entity.rulesVersion, '4');
    assert.equal(result.entity.modeId, 'stake');
    assert.equal(result.coverage, 'complete');
    assert.equal(result.origin, 'unknown');
    assert.equal(result.operation, null);
  }
  await f.store.command(f.b, { id: randomUUID(), action: 'resign', challengeId: matchId }, f.now + 3);
  const payouts = await f.postings('tsu-e-fa', matchId, 'final');
  assert.equal(payouts.length, 1);
  const result = await resolvePvpPosting(f.db, payouts[0]);
  assert.ok(result);
  assert.equal(result.entity.source.rowId, matchId);
  assert.equal(result.bank.state, 'settled');
  assert.equal(result.bank.reason, 'resign');
  assert.equal(result.bank.winnerId, f.a.accountId);
  assert.equal(result.bank.feeUnits, '10');
  assert.equal(result.operation, null);
});

test('named PvP detail reports verified Tsuefa rules and no inferred chess version', async t => {
  const f = await fixture(t);
  const audit = new PostgresDatabase(':memory:');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const reader = 'audit_pvp_reader_' + suffix, operator = 'audit_pvp_operator_' + suffix;
  const password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(reader)} NOLOGIN;
    CREATE ROLE ${identifier(operator)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(reader)} TO ${identifier(operator)};
    ALTER ROLE ${identifier(operator)} SET temp_file_limit='32MB'`);
  t.after(async () => {
    try {
      await audit.exec(`DROP OWNED BY ${identifier(reader)}; DROP ROLE ${identifier(operator)},${identifier(reader)}`);
    } finally {
      await audit.close();
    }
  });
  const sources = { game: f.db.schema };
  const { datasetId } = await new AuditDatasets(audit, sources).startTest();
  await installAuditReportAccess(audit, reader);
  await installAuditDetailReport(audit, reader, sources);
  const source = f.db.schema + '.demo_ledger';
  await audit.prepare('INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)')
    .run(operator, datasetId, source);
  const config = databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: operator, PGPASSWORD: password, PGPASSWORD_FILE: '' });

  const chess = await f.store.command(f.a, {
    id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: f.b.accountId,
  }, f.now);
  const chessId = chess.active!.id;
  await f.store.command(f.b, { id: randomUUID(), action: 'accept', challengeId: chessId }, f.now + 1);
  for (const actor of [f.a, f.b]) {
    await f.store.command(actor, { id: randomUUID(), action: 'ready', challengeId: chessId }, f.now + 2);
  }
  await f.store.adjudicate(f.a.roomId, chessId, null, 'draw', f.now + 3);

  const tsu = await f.store.command(f.a, {
    id: randomUUID(), action: 'invite', gameId: 'tsu-e-fa', stakeUnits: '1000000', targetId: f.b.accountId,
  }, f.now + 4);
  const tsuId = tsu.active!.id;
  await f.store.command(f.b, { id: randomUUID(), action: 'accept', challengeId: tsuId }, f.now + 5);
  for (const actor of [f.a, f.b]) {
    await f.store.command(actor, { id: randomUUID(), action: 'duel-ready', challengeId: tsuId, termsRevision: 0 }, f.now + 6);
  }

  for (const [gameId, matchId, version, amount] of [
    ['chess', chessId, null, '-1000'], ['tsu-e-fa', tsuId, '4', '-100'],
  ] as const) {
    const [hold] = await f.postings(gameId, matchId, 'hold');
    assert(hold);
    const posting = await resolvePvpPosting(f.db, hold);
    assert(posting);
    const detail = await readAuditDetail(config, {
      schema: audit.schema, datasetId, filters: { source, postingId: hold.rowId },
    });
    const anchor = detail.anchor;
    assert.equal(detail.status, 'found');
    assert(anchor);
    assert.deepEqual(anchor.source, posting.source);
    assert.deepEqual(
      [anchor.accountId, anchor.operationId, anchor.entityId, anchor.movement, anchor.amountUnits],
      [hold.accountId, hold.operationId, matchId, 'reserve', amount],
    );
    assert.deepEqual([anchor.category, anchor.gameId, anchor.modeId, anchor.rulesVersion],
      [posting.entity.category, posting.entity.gameId, posting.entity.modeId, posting.entity.rulesVersion]);
    assert.deepEqual([anchor.category, anchor.gameId, anchor.modeId, anchor.rulesVersion], ['pvp', gameId, 'stake', version]);
  }
  assert.equal(registeredAuditMode('tsu-e-fa', 'stake', 4)?.replayProfile, 'pvp-turn-based');
  assert.equal(registeredAuditMode('chess', 'stake', 4), null);
});

test('combat recovery links both credits to a single timed-out bank with no client attempt', async t => {
  const f = await fixture(t);
  const match = { id: randomUUID(), accounts: [f.a.accountId, f.b.accountId], stakeUnits: '10000000' };
  await f.combat.fund(f.a.accountId, match);
  await f.combat.fund(f.a.accountId, match);
  const holds = await f.postings('mortal-kombat', match.id, 'hold');
  assert.equal(holds.length, 2);
  for (const hold of holds) {
    const result = await resolvePvpPosting(f.db, hold);
    assert.ok(result);
    assert.equal(result.entity.source.namespace, f.db.schema + '.combat_matches');
    assert.equal(result.entity.rulesVersion, null);
    assert.equal(result.hold.stakeUnits, '1000');
    assert.equal(result.operation, null);
  }
  f.advanceCombat(150_001);
  await f.combat.recoverExpired();
  await f.combat.recoverExpired();
  const returns = await f.postings('mortal-kombat', match.id, 'final');
  assert.equal(returns.length, 2);
  for (const entry of returns) {
    const result = await resolvePvpPosting(f.db, entry);
    assert.ok(result);
    assert.equal(result.entity.source.rowId, match.id);
    assert.equal(result.bank.reason, 'expired');
    assert.equal(result.bank.state, 'refunded');
    assert.equal(result.hold.state, 'refunded');
    assert.equal(result.origin, 'automatic');
    assert.equal(result.operation, null);
  }
});

test('a committed bank remains linkable when durable game details are missing', async t => {
  const f = await fixture(t);
  const matchId = randomUUID();
  await f.ledger.pvpHold(f.a.accountId, { matchId, gameId: 'pool', stakeUnits: '10000000' }, f.now);
  const [hold] = await f.postings('pool', matchId, 'hold');
  const result = await resolvePvpPosting(f.db, hold);
  assert.ok(result);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.entity.rulesVersion, null);
  assert.deepEqual(result.entity.source, result.bank.source);
  assert.equal(result.entity.source.namespace, f.db.schema + '.virtual_pvp_banks');
});
