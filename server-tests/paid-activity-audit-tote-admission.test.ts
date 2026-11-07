import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startAuditAttemptRuntime } from '../server/audit/attempts';
import { TOTE_ADMISSION_CLOCK } from '../server/audit/check-tote';
import { isAuditRecord } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { buildCapturedToteReplay } from '../server/audit/replay-tote';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { FlagToteStore } from '../server/flagTote';
import { TOTE_TIMING } from '../src/shared/flagTote';

test('captures the actual admission check after commit and leaves replay, rejection and rollback distinct', async t => {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const accountId = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?)').run(accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 10 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId } = await datasets.startTest();
  let now = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period;
  let failSnapshot = false;
  const store = new FlagToteStore(game, id => {
    if (failSnapshot) throw new Error('fixture rolls back the transaction');
    return wallet.snapshotInTransaction(id);
  }, wallet.ready, () => now);
  const { round } = await store.snapshot(accountId);
  const runtime = startAuditAttemptRuntime({ ...process.env, ROYAL_AUDIT_SCHEMA: audit.schema,
    ROYAL_AUDIT_TEST_DATASET_ID: datasetId, ROYAL_AUDIT_TOTE_ADMISSION: '1',
  }, game.schema);
  assert(runtime?.recordToteAdmission);
  t.after(() => runtime.close());
  store.setAdmissionObserver(runtime.recordToteAdmission);
  const ticket = { id: randomUUID(), roundId: round.id, country: 'US', rulesVersion: 1, stakeUnits: '100' };

  now = round.closesAt - 2;
  failSnapshot = true;
  await assert.rejects(store.bet(accountId, { ...ticket, id: randomUUID() }), /rolls back/);
  failSnapshot = false;
  now = round.closesAt - 1;
  assert.equal((await store.bet(accountId, ticket)).replayed, false);
  now = round.closesAt;
  assert.equal((await store.bet(accountId, ticket)).replayed, true);
  await assert.rejects(store.bet(accountId, { ...ticket, country: 'BR' }), { status: 409 });
  await assert.rejects(store.bet(accountId, { ...ticket, id: randomUUID() }), { status: 409 });
  await runtime.close();

  const rows = await audit.prepare("SELECT payload FROM audit_evidence WHERE dataset_id=? AND kind='event'").all(datasetId);
  assert.equal(rows.length, 1);
  const event: unknown = rows[0].payload;
  assert(isAuditRecord(event) && event.type === 'event');
  assert.equal(event.reasonCode, TOTE_ADMISSION_CLOCK);
  assert.equal(event.operationId, ticket.id);
  assert.equal(event.occurredAtMs, round.closesAt - 1);
  assert.equal(event.entity.ticketId, ticket.id);
  const debit = await game.prepare("SELECT id::text,created_at FROM demo_ledger WHERE source='flag-tote' AND entry_type='bet'").all();
  assert.equal(debit.length, 1);
  assert.notEqual(debit[0].created_at, event.occurredAtMs);
  assert.deepEqual(event.postings, [{ namespace: game.schema + '.demo_ledger', rowId: debit[0].id }]);
  const replay = await buildCapturedToteReplay(audit, { datasetId, gameSchema: game.schema, poolId: round.id, replayId: randomUUID() });
  assert.equal(replay.status, 'built');
  const recordedTicket = replay.value.fragments.flatMap(fragment => fragment.events).find(item => item.pool?.kind === 'ticket')?.pool;
  assert(recordedTicket?.kind === 'ticket');
  assert.equal(recordedTicket.admittedAtMs, round.closesAt - 1);
});
