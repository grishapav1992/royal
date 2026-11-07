import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import type { AuditEvent } from '../server/audit/contract';

test('audit evidence is idempotent, shares the source transaction and cannot extend a sealed dataset', async t => {
  const game = new PostgresDatabase(':memory:');
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const accountId = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?)').run(accountId);
  const wallet = new DemoWalletStore(game);
  await wallet.ready;
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const scope = await datasets.startTest();
  const evidence = new AuditEvidence(game, audit.schema);
  const operationId = randomUUID();
  const event: AuditEvent = {
    schemaVersion: 1, scope: { datasetId: scope.datasetId, environment: scope.environment },
    type: 'event', occurredAtMs: Date.now(), eventId: 'auto-1', sequence: '1',
    accountId, operationId, entity: { category: 'casino', kind: 'round', gameId: 'github-crash', modeId: 'normal',
      rulesVersion: '1', source: { namespace: game.schema + '.demo_casino_sessions', rowId: JSON.stringify([accountId, operationId]) },
      ticketId: null }, event: 'settled', reasonCode: 'timeout', postings: [],
  };
  await assert.rejects(game.transaction(async () => {
    assert.equal(await evidence.record(event), 'recorded');
    await assert.rejects(datasets.sealTest(scope.datasetId), { code: '55P03' });
    throw new Error('source transaction failed');
  }), /source transaction failed/);
  assert.deepEqual(await audit.prepare('SELECT evidence_id FROM audit_evidence').all(), []);

  assert.equal(await evidence.record(event), 'recorded');
  assert.equal(await evidence.record(event), 'replayed');
  await assert.rejects(evidence.record({ ...event, reasonCode: 'changed' }), /different content/);
  await assert.rejects(evidence.record({ ...event, eventId: 'wrong-environment', scope: { ...event.scope, environment: 'live' } }),
    /active matching dataset/);
  await assert.rejects(evidence.record({ ...event, rawRequest: 'excluded' }), /Invalid audit evidence/);
  await datasets.sealTest(scope.datasetId);
  assert.equal(await evidence.record(event), 'replayed');
  await assert.rejects(evidence.record({ ...event, eventId: 'too-late' }), /active matching dataset/);
});
