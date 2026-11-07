import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DemoWalletStore } from '../server/demoWallet';
import { PostgresDatabase } from '../server/database';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { reconcileStoredAuditOperation } from '../server/audit/check-repeats';
import { auditCommandRoutes, observeAuditIntent } from '../server/audit/intents';
import type { AuditAttempt } from '../server/audit/contract';

test('R-03 keeps a stake and its payout separate and detects an extra canonical debit', async t => {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  const accountId = randomUUID(), other = randomUUID();
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(accountId, other);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  for (const id of [accountId, other]) await wallet.operate(id, { id: randomUUID(), kind: 'deposit', amount: 10 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId } = await datasets.startTest();
  const scope = { datasetId, environment: 'test' } as const;
  const operationId = randomUUID(), route = auditCommandRoutes.core;
  const command = { id: operationId, kind: 'play', gameId: 'royal-plinko', amount: 0.1,
    rulesVersion: 1, stakePolicyVersion: 1, input: { risk: 'easy', rows: 12 } };
  await wallet.operate(accountId, command);
  await wallet.operate(other, { ...command, amount: 0.2 });
  const operation = { datasetId, accountId, operationId, route };
  const run = () => reconcileStoredAuditOperation(audit, game.schema, operation);
  const first = await run();
  assert.equal(first.status, 'insufficient-data');
  assert.equal(first.money.status, 'match');
  assert.equal(first.money.postings.length, 2);
  assert.deepEqual(first.attempts, []);
  const attempt: AuditAttempt = {
    schemaVersion: 1, scope, type: 'attempt', accountId, operationId, attemptId: randomUUID(), route,
    occurredAtMs: Date.now(), entity: null, transport: 'http', response: 'formed', statusCode: 200,
    decision: 'unknown', balance: { state: 'absent' },
    intentFingerprint: observeAuditIntent(route, accountId, operationId, command)!,
  };
  assert.match(attempt.intentFingerprint!, /^[0-9a-f]{64}$/);
  const evidence = new AuditEvidence(audit, audit.schema);
  await evidence.record(attempt);
  assert.equal((await run()).status, 'match');
  // Isolated corruption fixture. The extra source row has a distinct primary key.
  await game.prepare(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source,game_name)
    SELECT account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source,game_name
    FROM demo_ledger WHERE account_id=? AND operation_id=? AND entry_type='bet'`).run(accountId, operationId);
  const duplicate = await run();
  assert.equal(duplicate.status, 'mismatch');
  assert.equal(duplicate.money.reason, 'command-money-plan-mismatch');
  assert.equal(duplicate.money.postings.length, 3);
  assert.equal(new Set(duplicate.money.postings.map(ref => ref.rowId)).size, 3);
  const foreign = await reconcileStoredAuditOperation(audit, game.schema, { ...operation, accountId: other });
  assert.equal(foreign.money.status, 'match');
  assert.equal(foreign.money.postings.length, 2);
});

test('R-03 detects a successful changed intent and marks a lost outcome as insufficient', async t => {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const accountId = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?)').run(accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId } = await datasets.startTest();
  const scope = { datasetId, environment: 'test' } as const;
  const operationId = randomUUID(), route = auditCommandRoutes.core;
  const command = { id: operationId, kind: 'deposit', amount: 10 };
  await wallet.operate(accountId, command);
  const evidence = new AuditEvidence(audit, audit.schema);
  const attempt: AuditAttempt = {
    schemaVersion: 1, scope, type: 'attempt', accountId, operationId, attemptId: randomUUID(), route,
    occurredAtMs: Date.now(), entity: null, transport: 'http', response: 'not-observed', statusCode: null,
    decision: 'unknown', balance: { state: 'not-recorded' }, delivery: 'closed',
    intentFingerprint: observeAuditIntent(route, accountId, operationId, { ...command, amount: 20 })!,
  };
  const check = () => reconcileStoredAuditOperation(audit, game.schema, { datasetId, accountId, operationId, route });
  await evidence.record(attempt);
  assert.equal((await check()).attempts[0].reason, 'different-intent-decision-unavailable');
  await evidence.record({ ...attempt, attemptId: randomUUID(), response: 'formed', statusCode: 200,
    balance: { state: 'absent' }, delivery: 'handed-off' });
  const result = await check();
  assert.equal(result.money.status, 'match');
  assert.equal(result.status, 'mismatch');
  assert.ok(result.attempts.some(item => item.reason === 'different-intent-succeeded'));
  await datasets.sealTest(datasetId);
  assert.deepEqual(await check(), result);
});
