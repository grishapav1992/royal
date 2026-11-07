import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIT_SCHEMA_VERSION, auditModeKey, auditSourceKey, isAuditMode, isAuditModeRegistry, isAuditRecord } from '../server/audit/contract.ts';

const scope = { datasetId: 'test-session-a', environment: 'test' };
const header = { schemaVersion: AUDIT_SCHEMA_VERSION, scope, occurredAtMs: 1794059700000 };
const asset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 };
const entity = { category: 'casino', kind: 'round', gameId: 'royal-plinko', modeId: 'normal',
  rulesVersion: '1', source: { namespace: 'royal_game.demo_operations', rowId: '["player-a","operation-a"]' }, ticketId: null };
const operation = { accountId: 'player-a', operationId: 'operation-a', entity };
const source = { namespace: 'royal_game.demo_ledger', rowId: '9007199254740993' };
const posting = { ...header, ...operation, type: 'posting', source, sequence: '9007199254740993', coverage: 'complete',
  movement: 'stake', asset, availableDeltaUnits: '-100', reservedDeltaUnits: null, availableAfterUnits: '30216', reservedAfterUnits: null };

test('postings keep signed units and distinct source rows for one operation', () => {
  const win = { ...posting, source: { ...source, rowId: '9007199254740994' }, movement: 'payout', availableDeltaUnits: '0' };
  assert.ok(isAuditRecord(posting));
  assert.ok(isAuditRecord(win));
  assert.equal(posting.operationId, win.operationId);
  assert.notEqual(auditSourceKey(posting.source), auditSourceKey(win.source));
  assert.notEqual(auditSourceKey(posting.source), auditSourceKey({ ...source, namespace: 'royal_payments.crypto_ledger' }));
  for (const value of [10, '1.50', '1e2', '-0', '+1', '01', ' 1', null]) {
    assert.equal(isAuditRecord({ ...posting, availableDeltaUnits: value }), false);
  }
  assert.equal(isAuditRecord({ ...posting, sequence: 9007199254740992 }), false);
  assert.equal(isAuditRecord({ ...posting, asset: { ...asset, scale: 19 } }), false);
  assert.ok(isAuditRecord({ ...posting, scope, asset: { contour: 'real', code: 'USDT', scale: 6 },
    entity: null, movement: 'withdrawal-paid', availableDeltaUnits: '0', reservedDeltaUnits: '-1000000' }));
});

test('an automatic game event can link postings without a client attempt', () => {
  const event = { ...header, type: 'event', entity, eventId: 'auto-close', sequence: '2',
    accountId: null, operationId: null, event: 'settled', reasonCode: 'timeout', postings: [source] };
  assert.ok(isAuditRecord(event));
  assert.equal(isAuditRecord({ ...event, postings: [source, { ...source }] }), false);
  assert.equal(isAuditRecord({ ...event, entity: { ...entity, kind: 'match' } }), false);
  assert.equal(isAuditRecord({ ...event, entity: { ...entity, ticketId: 'ticket-a' } }), false);
  assert.ok(isAuditRecord({ ...event, entity: { ...entity, category: 'totalizator', kind: 'pool', ticketId: 'ticket-a' } }));
});

test('attempts retain a wrong response, an unobserved response and a successful replay separately', () => {
  const attempt = { ...header, ...operation, type: 'attempt', attemptId: 'attempt-1',
    transport: 'http', route: '/api/demo-wallet/operations', decision: 'accepted', response: 'formed',
    statusCode: 200, balance: { state: 'value', asset, units: '-100', snapshot: source } };
  const lost = { ...attempt, attemptId: 'attempt-2', response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' } };
  const replay = { ...attempt, attemptId: 'attempt-3', decision: 'replayed',
    balance: { state: 'value', asset, units: '30216', snapshot: { ...source, rowId: '9007199254740995' } } };
  for (const record of [attempt, lost, replay]) assert.ok(isAuditRecord(record));
  assert.notEqual(attempt.balance.units, posting.availableAfterUnits);
  assert.equal(replay.operationId, attempt.operationId);
  assert.equal(isAuditRecord({ ...lost, balance: attempt.balance }), false);
  assert.ok(isAuditRecord({ ...lost, delivery: 'closed' }));
  assert.ok(isAuditRecord({ ...attempt, delivery: 'handed-off' }));
  assert.equal(isAuditRecord({ ...lost, delivery: 'handed-off' }), false);
  assert.equal(isAuditRecord({ ...attempt, delivery: 'received' }), false);
  assert.equal(isAuditRecord({ ...attempt, route: '/api/demo-wallet/operations?token=value' }), false);
  assert.equal(isAuditRecord({ ...attempt, requestBody: 'not an audited field' }), false);
  assert.ok(isAuditRecord({ ...attempt, transport: 'websocket', route: 'pvp', statusCode: null, balance: { state: 'absent' } }));
});

test('registry separates modes and accepted versions and rejects invalid profiles', () => {
  const mode = { gameId: 'example', modeId: 'normal', rulesVersion: '1', category: 'casino', replayProfile: 'casino-steps' };
  const other = { ...mode, modeId: 'pool', category: 'totalizator', replayProfile: 'pool-steps' };
  assert.ok(isAuditMode(mode));
  assert.ok(isAuditModeRegistry([mode, other, { ...mode, rulesVersion: '2' }]));
  assert.notEqual(auditModeKey(mode), auditModeKey(other));
  assert.equal(isAuditModeRegistry([mode, { ...mode }]), false);
  assert.equal(isAuditMode({ ...mode, replayProfile: 'pvp-realtime' }), false);
  assert.equal(isAuditMode({ ...mode, rulesVersion: null }), false);
});

test('a complete replay requires pinned rules, ordered bounds and terminal evidence', () => {
  const replay = { ...header, type: 'replay', entity, replayId: 'replay-a', profile: 'casino-steps', engineVersion: 'build-a',
    formatVersion: 1, coverage: 'complete', firstSequence: '0', lastSequence: '2', terminalEventId: 'close-a', sha256: 'a'.repeat(64) };
  assert.ok(isAuditRecord(replay));
  assert.equal(isAuditRecord({ ...replay, firstSequence: '3' }), false);
  assert.equal(isAuditRecord({ ...replay, lastSequence: null }), false);
  assert.equal(isAuditRecord({ ...replay, sha256: null }), false);
  assert.equal(isAuditRecord({ ...replay, entity: { ...entity, rulesVersion: null } }), false);
  assert.ok(isAuditRecord({ ...replay, coverage: 'partial', terminalEventId: null, sha256: null }));
  assert.equal(isAuditRecord({ ...replay, profile: 'pool-steps' }), false);
  assert.equal(isAuditRecord({ ...replay, schemaVersion: 2 }), false);
});
