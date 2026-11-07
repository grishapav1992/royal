import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { reconcileStoredPvpMatch } from '../server/audit/check-pvp';
import { AuditDatasets } from '../server/audit/datasets';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const a = { accountId: randomUUID(), name: 'Fixture A', roomId: 'check-pvp-fixture' };
  const b = { accountId: randomUUID(), name: 'Fixture B', roomId: a.roomId };
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(a.accountId, b.accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  for (const actor of [a, b]) {
    await wallet.operate(actor.accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  }
  const ledger = new VirtualPvpLedger(game, wallet);
  const store = new PvpStore(ledger);
  const now = 1794059700000;
  let combatClock = now;
  const combat = new NileCombatEscrow(ledger, () => combatClock);
  const datasets = new AuditDatasets(audit, { game: game.schema });
  await Promise.all([store.ready, combat.ready, datasets.ready]);
  await store.syncRoom(a.roomId, [a, b].map(actor => ({ ...actor, connected: true, available: true })), now);
  async function chess() {
    const response = await store.command(a, {
      id: randomUUID(), action: 'create', gameId: 'chess', stakeUnits: '10000000', targetId: b.accountId,
    }, now);
    return response.active!.id;
  }
  async function ready(matchId: string) {
    await store.command(b, { id: randomUUID(), action: 'accept', challengeId: matchId }, now + 1);
    for (const actor of [a, b]) {
      await store.command(actor, { id: randomUUID(), action: 'ready', challengeId: matchId }, now + 2);
    }
  }
  return {
    game, audit, a, b, store, combat, datasets, chess, ready, now,
    advanceCombat: (ms: number) => { combatClock += ms; },
    check: (datasetId: string, matchId: string) => reconcileStoredPvpMatch(audit, game, datasetId, matchId),
  };
}

test('open principal is distinct from payout capacity and one settled bank charges commission once', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const matchId = await f.chess();
  const pending = await f.check(datasetId, matchId);
  assert.equal(pending.status, 'pending');
  assert.deepEqual(pending.findings, []);
  assert.equal(pending.bank?.gameRulesVersion, null);
  assert.equal(pending.bank?.moneyRulesVersion, 'virtual-usdt-pvp-v1');
  assert.equal(pending.participants[0].hold?.payoutCapacityUnits, '1900');
  assert.deepEqual(pending.totals, { stakeUnits: '1000', payoutUnits: '0', refundUnits: '0', feeUnits: '0', remainderUnits: '1000' });

  await f.ready(matchId);
  await f.store.adjudicate(f.a.roomId, matchId, f.a.accountId, 'win', f.now + 3);
  await f.store.adjudicate(f.a.roomId, matchId, f.a.accountId, 'win', f.now + 4);
  const result = await f.check(datasetId, matchId);
  assert.equal(result.status, 'match');
  assert.deepEqual(result.findings, []);
  assert.equal(result.bank?.winnerId, f.a.accountId);
  assert.deepEqual(result.totals, { stakeUnits: '2000', payoutUnits: '1900', refundUnits: '0', feeUnits: '100', remainderUnits: '0' });
  const byAccount = new Map(result.participants.map(participant => [participant.accountId, participant]));
  assert.deepEqual(byAccount.get(f.a.accountId)?.postings.map(row => row.units), ['-1000', '1900']);
  assert.deepEqual(byAccount.get(f.b.accountId)?.postings.map(row => row.units), ['-1000']);
  assert.equal(new Set(result.participants.flatMap(participant => participant.postings.map(posting => posting.source.rowId))).size, 3);
});

test('draw returns both stakes, and cancellation returns only the accepted stake without a fee', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const draw = await f.chess();
  await f.ready(draw);
  await f.store.adjudicate(f.a.roomId, draw, null, 'draw', f.now + 3);
  const returned = await f.check(datasetId, draw);
  assert.equal(returned.status, 'match');
  assert.equal(returned.bank?.reason, 'draw');
  assert.equal(returned.participants.length, 2);
  assert.ok(returned.participants.every(participant => participant.postings.at(-1)?.entryType === 'refund'));
  assert.deepEqual(returned.totals, { stakeUnits: '2000', payoutUnits: '0', refundUnits: '2000', feeUnits: '0', remainderUnits: '0' });

  const cancelled = await f.chess();
  await f.store.command(f.a, { id: randomUUID(), action: 'cancel', challengeId: cancelled }, f.now + 1);
  const refund = await f.check(datasetId, cancelled);
  assert.equal(refund.status, 'match');
  assert.equal(refund.bank?.reason, 'cancel');
  assert.equal(refund.participants.length, 1);
  assert.deepEqual(refund.totals, { stakeUnits: '1000', payoutUnits: '0', refundUnits: '1000', feeUnits: '0', remainderUnits: '0' });
});

test('Tsuefa v4 reconciles its smallest negotiated stake in exact cents', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const invite = await f.store.command(f.a, {
    id: randomUUID(), action: 'invite', gameId: 'tsu-e-fa', stakeUnits: '100000', targetId: f.b.accountId,
  }, f.now);
  const matchId = invite.active!.id;
  await f.store.command(f.b, { id: randomUUID(), action: 'accept', challengeId: matchId }, f.now + 1);
  assert.equal((await f.check(datasetId, matchId)).status, 'not-captured');
  for (const actor of [f.a, f.b]) {
    await f.store.command(actor, { id: randomUUID(), action: 'duel-ready', challengeId: matchId, termsRevision: 0 }, f.now + 2);
  }
  await f.store.command(f.b, { id: randomUUID(), action: 'resign', challengeId: matchId }, f.now + 3);
  const result = await f.check(datasetId, matchId);
  assert.equal(result.status, 'match');
  assert.equal(result.bank?.gameRulesVersion, '4');
  assert.equal(result.bank?.reason, 'resign');
  assert.deepEqual(result.totals, { stakeUnits: '20', payoutUnits: '19', refundUnits: '0', feeUnits: '1', remainderUnits: '0' });
});

test('combat recovery accounts for opening holds without inventing pre-cutover postings', async t => {
  const f = await fixture(t);
  const match = { id: randomUUID(), accounts: [f.a.accountId, f.b.accountId], stakeUnits: '10000000' };
  await f.combat.fund(f.a.accountId, match);
  const { datasetId } = await f.datasets.startTest();
  const opening = await f.check(datasetId, match.id);
  assert.equal(opening.status, 'pending');
  assert.ok(opening.participants.every(participant => participant.openingStakeUnits === '1000' && participant.postings.length === 0));
  f.advanceCombat(150_001);
  await f.combat.recoverExpired();
  await f.combat.recoverExpired();
  const result = await f.check(datasetId, match.id);
  assert.equal(result.status, 'match');
  assert.equal(result.bank?.reason, 'expired');
  assert.ok(result.participants.every(participant => participant.openingStakeUnits === '1000' &&
    participant.postings.length === 1 && participant.postings[0].units === '1000'));
  assert.deepEqual(result.totals, { stakeUnits: '2000', payoutUnits: '0', refundUnits: '2000', feeUnits: '0', remainderUnits: '0' });
});

test('duplicate payouts and wrong commission are independently detectable in captured evidence', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const matchId = await f.chess();
  await f.ready(matchId);
  await f.store.adjudicate(f.a.roomId, matchId, f.a.accountId, 'win', f.now + 3);
  await f.game.transaction(async () => {
    const balance = await demoBalanceUnits(f.game, f.a.accountId) + 1900;
    await saveDemoUnits(f.game, f.a.accountId, balance);
    await recordDemoUnits(f.game, f.a.accountId, 'pvp:' + matchId + ':final', 'win', 1900, balance, 'pvp:chess');
  });
  const duplicate = await f.check(datasetId, matchId);
  assert.equal(duplicate.status, 'mismatch');
  assert.deepEqual(duplicate.findings.map(finding => finding.code), ['duplicate-credit', 'bank-not-conserved']);
  assert.equal(duplicate.totals?.payoutUnits, '3800');
  assert.equal(duplicate.totals?.feeUnits, '100');
  assert.equal(duplicate.totals?.remainderUnits, '-1900');
  assert.equal(duplicate.findings[0].accountId, f.a.accountId);
  await f.game.prepare('UPDATE virtual_pvp_banks SET fee_units=200 WHERE match_id=?').run(matchId);
  const wrongFee = await f.check(datasetId, matchId);
  assert.equal(wrongFee.status, 'mismatch');
  assert.equal(wrongFee.findings.filter(finding => finding.code === 'commission-mismatch').length, 1);
  assert.equal(wrongFee.totals?.feeUnits, '200');
});

test('a sealed dataset does not absorb a later participant or final result', async t => {
  const f = await fixture(t);
  const first = await f.datasets.startTest();
  const matchId = await f.chess();
  await f.datasets.sealTest(first.datasetId);
  const next = await f.datasets.startTest();
  await f.ready(matchId);
  const stillOpen = await f.check(first.datasetId, matchId);
  assert.equal(stillOpen.status, 'pending');
  assert.deepEqual(stillOpen.participants.map(participant => participant.accountId), [f.a.accountId]);
  await f.store.adjudicate(f.a.roomId, matchId, f.a.accountId, 'win', f.now + 3);
  const old = await f.check(first.datasetId, matchId);
  assert.equal(old.status, 'insufficient-data');
  assert.deepEqual(old.findings.map(finding => finding.code), ['terminal-not-captured']);
  assert.deepEqual(old.participants.map(participant => participant.accountId), [f.a.accountId]);
  assert.equal(old.bank?.state, null);
  assert.equal(old.bank?.winnerId, null);
  assert.equal(old.bank?.feeUnits, null);
  assert.equal(old.participants[0].hold?.state, null);
  assert.equal(old.totals, null);

  const current = await f.check(next.datasetId, matchId);
  assert.equal(current.status, 'match');
  assert.equal(current.participants.find(participant => participant.accountId === f.a.accountId)?.openingStakeUnits, '1000');
  assert.equal(current.totals?.feeUnits, '100');
  assert.equal((await f.check(randomUUID(), matchId)).status, 'not-captured');
});

test('a missing captured credit is a source gap and cannot be reported as a proven absent payout', async t => {
  const f = await fixture(t);
  const { datasetId } = await f.datasets.startTest();
  const matchId = await f.chess();
  await f.ready(matchId);
  await f.store.adjudicate(f.a.roomId, matchId, f.a.accountId, 'win', f.now + 3);
  await f.game.prepare('DELETE FROM demo_ledger WHERE operation_id=? AND account_id=?')
    .run('pvp:' + matchId + ':final', f.a.accountId);
  const result = await f.check(datasetId, matchId);
  assert.equal(result.status, 'insufficient-data');
  assert.deepEqual(result.findings.map(finding => finding.code), ['source-unavailable']);
  assert.equal(result.totals, null);
});
